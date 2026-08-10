// ============================================================================
// Webhook do WhatsApp (Meta Cloud API) — WHATSAPP-01 · F1+F2+F3 +
// WHATSAPP-EXTRATO-01 + F4a (blindagem: ack imediato + waitUntil).
// ----------------------------------------------------------------------------
// F1 cuida do encanamento: handshake GET + POST que valida assinatura,
// deduplica por wa_message_id e grava a mensagem recebida em wa_conversas/
// wa_mensagens (projeto xtv — ver migration 0046 e a nota de correção de
// arquitetura nnv→xtv nela). F1 é a ÚNICA parte que roda de fato dentro do
// ciclo request/response com a Meta agora (ver F4a abaixo).
//
// F2+F3: depois de gravar a mensagem do cliente, se
// WHATSAPP_AGENT_ATIVO==="true" (kill-switch, default desligado) e a
// conversa não estiver opt-out nem escalada pra humano, chama o cérebro do
// Time Prosperito (lib/whatsapp/cerebro.ts — reaproveita persona/compliance
// do /api/atende) e responde via Graph API (lib/whatsapp/graph.ts). Falha
// do agente é capturada em try/catch e NUNCA derruba o ack 200 do webhook —
// só loga.
//
// WHATSAPP-EXTRATO-01: mensagens do tipo `document`/`image` (extrato de
// cota anexado) ganham um caminho próprio — baixa da Graph Media API
// (lib/whatsapp/media.ts), sobe pro bucket privado `wa-extratos`, extrai os
// campos via IA (lib/whatsapp/extrato.ts) e grava um registro
// 'pendente_revisao' em extratos_cotas (migration 0057). NUNCA escreve em
// `cartas`. Se WHATSAPP_AGENT_ATIVO==="true", responde com um resumo dos
// campos (texto fixo, não gerado pelo modelo — ver resumoExtratoWa em
// lib/whatsapp/extrato.ts). Qualquer falha do caminho de extrato é
// capturada e só loga — mesmo contrato do F2+F3.
//
// F4a (blindagem, 2026-07-21): 3 reproduções ao vivo (12:05:31Z, 14:51:35Z,
// 15:36:01Z) confirmaram inbound persistido + ZERO resposta + ZERO log de
// erro — hipótese forte: a cadeia inteira de F2+F3/EXTRATO-01 (debounce de
// 8s + Anthropic + Graph API, ou download+visão) rodava síncrona dentro do
// mesmo ciclo HTTP do webhook da Meta, vulnerável a um timeout DO LADO DA
// META encerrar a conexão/invocação no meio, sem exceção capturável. Fix:
// F1 (persistência) continua síncrono e rápido (<500ms); o resto
// (EXTRATO-01 + F2+F3, agora em lib/whatsapp/processar-background.ts) roda
// via waitUntil() DEPOIS do ack — desacoplado do ciclo de vida da conexão
// HTTP com a Meta. `db` (service_role, sem cookie/sessão atrelada ao
// Request) é seguro de manter vivo através dessa fronteira.
//
// GET: handshake exigido pela Meta ao configurar o webhook (hub.mode=
//   subscribe + hub.verify_token == WHATSAPP_VERIFY_TOKEN → devolve
//   hub.challenge).
// POST: 1) valida a origem do POST — em modo Meta direto (default), via
//   X-Hub-Signature-256 (HMAC-SHA256 com WHATSAPP_APP_SECRET, comparação
//   timing-safe sobre os bytes crus do hex, sem o prefixo "sha256="); em
//   modo BSP (WHATSAPP_BSP="360dialog"), via segredo compartilhado
//   configurável (WHATSAPP_BSP_WEBHOOK_SECRET) — a 360dialog reenvia o
//   mesmo formato de payload da Cloud API mas não assina com HMAC, ver
//   assinaturaValida()/segredoBspValido() abaixo — inválido em qualquer
//   modo => 401 (com log temporário do motivo, sem vazar segredo/corpo),
//   nada é processado; 2) processa `value.statuses` quando presente
//   (CARROSSEL-OPS-01 Peça 0 — ver processarStatuses abaixo: reflete o
//   destino REAL do outbound em wa_mensagens.status_envio e loga o código
//   de erro da Meta em caso de `failed`); demais eventos que não sejam
//   `messages` (echoes) continuam ignorados;
//   3) dedup por wa_message_id; 4) upsert da conversa por telefone + insert
//   da mensagem (papel='cliente'); 5) Fatia 4-B: opt-out "Não quero
//   receber" (normalizado) => wa_conversas.opt_out=true — detecta nas três
//   formas em que pode chegar: quick reply de TEMPLATE (button.text),
//   quick reply de interativa comum (interactive.button_reply.title) ou
//   texto digitado livremente (text.body); 6) empilha um job leve por
//   mensagem (anexo/F2+F3 ficam pro background); 7) ACK imediato
//   (NextResponse.json({ok:true})) assim que o loop de persistência
//   termina, disparando waitUntil(processarJobsWhatsapp(...)) antes de
//   retornar; 8) SEMPRE 200 (exceto assinatura inválida) — webhook não
//   deve fazer a Meta reenviar por erro de aplicação, mesmo padrão de
//   /api/hooks/novo-cadastro.
//
// service_role (createXtvClient): usado aqui porque não há sessão de
// usuário (mensagem chega de fora, sem cookie) — mesmo motivo de
// /api/atende. NUNCA vai ao client.
// ============================================================================
import { NextResponse } from "next/server";
import crypto from "crypto";
import { waitUntil } from "@vercel/functions";
import { createXtvClient } from "@/lib/supabase-xtv";
import { registrarMensagemSistema } from "@/lib/whatsapp/sistema";
import { processarJobsWhatsapp, type WaJob } from "@/lib/whatsapp/processar-background";
import { etiquetasDaMensagem } from "@/lib/farol/cedente";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// F4a: o ack em si (F1 síncrono) é rápido (<500ms); maxDuration agora
// cobre o processamento em BACKGROUND via waitUntil (EXTRATO-01 até ~50s +
// debounce 8s + Anthropic/Graph API), que a Vercel mede como parte da
// mesma invocação mesmo depois do response já ter saído. 180s dá folga
// confortável pro pior caso combinado numa mesma mensagem — bem dentro do
// que o plano já comprovadamente suporta (sync-cotas usa 800).
export const maxDuration = 180;

// ITEM 5 (FATIA 2 · SEGURANCA-01 · F3.1) — kill_switch_raw / WHATSAPP_AGENT_ATIVO.
// ----------------------------------------------------------------------------
// Confirmado como flag FUNCIONAL real (não morta): controla, sozinha, se o
// Time Prosperito chega a responder no WhatsApp. Lida em dois pontos:
//   - aqui (podeResponder, mais abaixo) e em processar-background.ts (mesma
//     checagem repetida antes de enviar o resumo do extrato) — ambos com
//     `=== "true"` (comparação estrita de string; QUALQUER outro valor,
//     incluindo ausente/undefined, mantém o agente CALADO — default seguro:
//     falha fechada, não aberta).
// Documentada em .env.example (default "false"). Não é usada em nenhum outro
// lugar do código além desses dois pontos de leitura.
// "kill_switch_raw" é só o NOME de uma chave dentro do log de diagnóstico
// SONDA-DIAG (temporário, esforço F4a, ver mais abaixo no POST) — não é uma
// flag separada, é só o valor cru (pré-comparação) desta mesma env var,
// exposto por mensagem pra depurar o F4a. Este log abaixo é o log de BOOT
// (module-scope, roda 1x por cold start do runtime Node) — complementar e
// distinto do SONDA-DIAG per-mensagem, que continua existindo e não deve ser
// removido nesta fatia (pertence à investigação F4a, ainda em aberto).
console.log(
  "[whatsapp/route][boot] kill-switch WHATSAPP_AGENT_ATIVO =",
  JSON.stringify(process.env.WHATSAPP_AGENT_ATIVO ?? null),
  "(agente responde somente quando === \"true\"; qualquer outro valor => agente mudo)"
);

// --- GET: handshake da Meta -------------------------------------------------
export async function GET(req: Request) {
  const url = new URL(req.url);
  const modo = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const desafio = url.searchParams.get("hub.challenge");

  if (
    modo === "subscribe" &&
    !!process.env.WHATSAPP_VERIFY_TOKEN &&
    token === process.env.WHATSAPP_VERIFY_TOKEN &&
    desafio
  ) {
    return new Response(desafio, { status: 200 });
  }
  return NextResponse.json({ erro: "handshake_invalido" }, { status: 403 });
}

// --- Validação de origem do webhook ------------------------------------------
// Modo Meta direto (default): HMAC-SHA256 sobre o corpo cru via
// X-Hub-Signature-256, com WHATSAPP_APP_SECRET (assinaturaValidaMeta).
//
// Modo BSP (WHATSAPP_BSP="360dialog"): o payload que a 360dialog reenvia
// pro nosso webhook tem o mesmo formato da Cloud API, mas a 360dialog NÃO
// assina o corpo com HMAC — não é um recurso que o relay deles oferece (o
// hub.mode/X-Hub-Signature-256 é coisa do App Dashboard da própria Meta,
// que não está no meio dessa configuração). Em vez de HMAC, validamos por
// um segredo compartilhado configurável (WHATSAPP_BSP_WEBHOOK_SECRET) que
// a gente mesmo embute na configuração do webhook do lado da 360dialog —
// como o painel deles não permite header customizado no cadastro da URL,
// o jeito prático é embutir o segredo na própria URL registrada
// (?secret=...); por segurança também aceitamos vir por header
// (X-BSP-Webhook-Secret), pra quando/se o relay usado permitir configurar
// headers. Comparação timing-safe do mesmo jeito que o HMAC do modo Meta.
function bspAtivo(): boolean {
  return process.env.WHATSAPP_BSP === "360dialog";
}

function assinaturaValida(
  req: Request,
  corpoBruto: string
): { valida: boolean; motivo?: string } {
  if (bspAtivo()) {
    return segredoBspValido(req);
  }
  return assinaturaValidaMeta(corpoBruto, req.headers.get("x-hub-signature-256"));
}

function segredoBspValido(req: Request): { valida: boolean; motivo?: string } {
  const esperado = process.env.WHATSAPP_BSP_WEBHOOK_SECRET;
  if (!esperado) return { valida: false, motivo: "bsp_segredo_ausente_env" };

  const url = new URL(req.url);
  const recebido =
    req.headers.get("x-bsp-webhook-secret") ?? url.searchParams.get("secret");
  if (!recebido) return { valida: false, motivo: "bsp_segredo_ausente_request" };

  const bufRecebido = Buffer.from(recebido, "utf8");
  const bufEsperado = Buffer.from(esperado, "utf8");
  if (bufRecebido.length !== bufEsperado.length) {
    return { valida: false, motivo: "bsp_segredo_tamanho_diferente" };
  }

  const ok = crypto.timingSafeEqual(bufRecebido, bufEsperado);
  return { valida: ok, motivo: ok ? undefined : "bsp_segredo_nao_bate" };
}

// Retorna o motivo da rejeição (nunca o segredo nem o corpo) só pra dar pra
// diagnosticar 401 em produção sem vazar dado sensível nos logs.
function assinaturaValidaMeta(
  corpoBruto: string,
  assinaturaHeader: string | null
): { valida: boolean; motivo?: string } {
  const segredo = process.env.WHATSAPP_APP_SECRET;
  if (!segredo) return { valida: false, motivo: "segredo_ausente_env" };
  if (!assinaturaHeader) return { valida: false, motivo: "header_ausente" };

  const prefixo = "sha256=";
  if (!assinaturaHeader.startsWith(prefixo)) {
    return { valida: false, motivo: "header_sem_prefixo_sha256" };
  }

  // Compara o HMAC sobre bytes crus (hex → Buffer), não a string com o
  // prefixo — o prefixo é só marcador de algoritmo da Meta, não faz parte
  // da assinatura em si.
  const recebidoHex = assinaturaHeader.slice(prefixo.length);
  const esperadoHex = crypto
    .createHmac("sha256", segredo)
    .update(corpoBruto, "utf8")
    .digest("hex");

  let bufRecebido: Buffer;
  try {
    bufRecebido = Buffer.from(recebidoHex, "hex");
  } catch {
    return { valida: false, motivo: "header_nao_e_hex" };
  }
  const bufEsperado = Buffer.from(esperadoHex, "hex");

  if (bufRecebido.length !== bufEsperado.length) {
    return {
      valida: false,
      motivo: `tamanho_hex_diferente(recebido=${bufRecebido.length},esperado=${bufEsperado.length})`,
    };
  }

  const ok = crypto.timingSafeEqual(bufRecebido, bufEsperado);
  return { valida: ok, motivo: ok ? undefined : "hmac_nao_bate" };
}

// Shape mínimo do envelope da Meta que nos interessa em F1 (texto,
// interativas e quick reply de TEMPLATE de marketing); campos não usados
// aqui ficam como unknown de propósito.
type MensagemMeta = {
  id?: string;
  from?: string;
  // "text" | "button" | "interactive" | "document" | "image" | ... — só os
  // tipos que este webhook trata de fato são desestruturados abaixo; os
  // demais (audio, video, sticker, location, ...) caem no fallback vazio.
  type?: string;
  text?: { body?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
  // Quick reply de botão de TEMPLATE (carrossel de marketing) chega como
  // messages[].type="button", com o texto em button.text (não em
  // interactive.button_reply.title — esse é só pra botões de mensagem
  // interativa comum, formato diferente).
  button?: { text?: string; payload?: string };
  // Extrato de cota anexado (WHATSAPP-EXTRATO-01) — document tem filename/
  // caption opcionais, image só caption. `id` aqui é o media_id da Graph
  // API, baixado depois via lib/whatsapp/media.ts.
  document?: { id?: string; filename?: string; caption?: string; mime_type?: string };
  image?: { id?: string; caption?: string; mime_type?: string };
  // FATIA 1 (venda nova) — presente só quando a conversa nasce de um anúncio
  // Click-to-WhatsApp (CTWA); a Meta manda esse objeto na PRIMEIRA mensagem
  // do clique. Persistido first-touch-only em wa_conversas.referral (ver
  // captura logo após o upsert da conversa, abaixo) — alimenta atribuição
  // do FAROL. Shape espelha o payload real da Meta; todos os campos são
  // opcionais por completude (nem todo referral traz todos).
  referral?: {
    source_type?: string;
    source_id?: string;
    source_url?: string;
    headline?: string;
    body?: string;
    media_type?: string;
    image_url?: string;
    video_url?: string;
    thumbnail_url?: string;
    ctwa_clid?: string;
  };
};

// --- POST: recebe eventos; F1 só grava (sem Claude, sem resposta) ----------
export async function POST(req: Request) {
  const corpoBruto = await req.text();

  const resultadoAssinatura = assinaturaValida(req, corpoBruto);
  if (!resultadoAssinatura.valida) {
    // LOG TEMPORÁRIO (diagnóstico do 401 em produção) — remover depois de
    // confirmado o motivo. Nunca loga o segredo nem o corpo inteiro, só
    // presença/tamanho, que já basta pra distinguir os casos comuns
    // (env ausente, secret errado/com espaço sobrando, header mal formado).
    // Loga só as envs relevantes ao modo ativo (Meta vs. BSP) pra não
    // confundir diagnóstico com env de um modo que nem está em uso.
    console.error("[whatsapp] assinatura/segredo rejeitado:", {
      modo: bspAtivo() ? "bsp_360dialog" : "meta_direto",
      motivo: resultadoAssinatura.motivo,
      ...(bspAtivo()
        ? {
            temSegredoEnv: !!process.env.WHATSAPP_BSP_WEBHOOK_SECRET,
            tamanhoSegredoEnv: process.env.WHATSAPP_BSP_WEBHOOK_SECRET?.length ?? 0,
            temHeaderOuQuery: !!(
              req.headers.get("x-bsp-webhook-secret") ??
              new URL(req.url).searchParams.get("secret")
            ),
          }
        : {
            temSegredoEnv: !!process.env.WHATSAPP_APP_SECRET,
            tamanhoSegredoEnv: process.env.WHATSAPP_APP_SECRET?.length ?? 0,
            temHeader: !!req.headers.get("x-hub-signature-256"),
          }),
      tamanhoCorpo: corpoBruto.length,
    });
    return NextResponse.json({ erro: "assinatura_invalida" }, { status: 401 });
  }

  let evento: unknown;
  try {
    evento = JSON.parse(corpoBruto);
  } catch {
    // corpo ilegível: 200 pra Meta não reenviar lixo pra sempre.
    return NextResponse.json({ status: "corpo_invalido" }, { status: 200 });
  }

  const valor = (evento as Record<string, unknown>)?.entry as unknown;
  const msgs = extrairMensagens(valor);
  // CONVERSAS-02 — nomes do perfil, casados por wa_id na hora do upsert.
  const nomesPorWaId = extrairNomes(valor);

  // CARROSSEL-OPS-01 Peça 0 — statuses do outbound (sent/delivered/read/
  // failed). Roda ANTES do early return abaixo de propósito: um recibo de
  // entrega chega sozinho no payload, sem `messages` nenhum, e era
  // exatamente por esse early return que ele vinha sendo descartado.
  // Isolado em try/catch próprio (dentro de processarStatuses) pra que
  // nenhum dos dois caminhos possa derrubar o outro — statuses e messages
  // podem vir no mesmo change.
  const statuses = extrairStatuses(valor);
  if (statuses.length > 0) {
    await processarStatuses(statuses);
  }

  if (!msgs || msgs.length === 0) {
    // echoes e demais eventos sem `messages`: fora de escopo F1.
    return NextResponse.json({
      status: statuses.length > 0 ? "statuses_processados" : "ignorado",
    });
  }

  const db = createXtvClient();
  const jobs: WaJob[] = [];

  for (const m of msgs) {
    const waMessageId = m.id;
    if (!waMessageId) continue;

    // dedup: a Meta reenvia eventos em caso de timeout/retry dela mesma.
    const { data: existente } = await db
      .from("wa_mensagens")
      .select("id")
      .eq("wa_message_id", waMessageId)
      .maybeSingle();
    if (existente) continue;

    const telefone = m.from;
    if (!telefone) continue;

    // Extrato de cota anexado (WHATSAPP-EXTRATO-01): document/image trazem
    // um media_id da Graph API que é baixado/processado abaixo, depois do
    // insert em wa_mensagens (precisa do id da própria mensagem primeiro).
    const anexo: { id?: string; filename?: string; caption?: string; mime_type?: string } | undefined =
      m.type === "document" ? m.document : m.type === "image" ? m.image : undefined;

    const conteudo =
      m.text?.body ??
      m.button?.text ??
      m.interactive?.button_reply?.title ??
      m.interactive?.list_reply?.title ??
      anexo?.filename ??
      anexo?.caption ??
      (anexo ? "[anexo sem nome/legenda]" : "");

    // CONVERSAS-02 — o nome entra AQUI, no mesmo upsert, e não numa segunda
    // consulta: é a diferença entre uma ida ao banco e duas por mensagem. A
    // chave só existe quando há nome (ver o bloco de `extrairNomes`): webhook
    // sem `contacts` mantém o nome que já estava.
    const nomePerfil = nomesPorWaId.get(telefone);
    const { data: conversa, error: errConversa } = await db
      .from("wa_conversas")
      .upsert(nomePerfil ? { telefone, nome: nomePerfil } : { telefone }, {
        onConflict: "telefone",
        ignoreDuplicates: false,
      })
      .select("id, status, agente_ativo, opt_out, referral, nome")
      .single();
    if (errConversa || !conversa) continue;

    // FATIA 1 (venda nova) — referral CTWA first-touch: só grava se esta
    // mensagem trouxe `referral` E a conversa ainda não tinha nenhum
    // capturado. Nunca sobrescreve (mesma conversa pode vir de mais de um
    // clique/anúncio ao longo do tempo — vale o primeiro).
    if (m.referral && !conversa.referral) {
      await db.from("wa_conversas").update({ referral: m.referral }).eq("id", conversa.id);
    }

    const { data: msgInserida, error: errMsg } = await db
      .from("wa_mensagens")
      .insert({
        conversa_id: conversa.id,
        papel: "cliente",
        conteudo,
        wa_message_id: waMessageId,
        media_id: anexo?.id ?? null,
      })
      .select("id")
      .single();
    if (errMsg || !msgInserida) continue;

    // ---- Etiqueta de intenção: quem quer VENDER a própria cota --------------
    // Alimenta a última etapa do funil da sala de controle, que até 09/08 não
    // tinha fonte nenhuma. Detector é casamento de palavra-chave (ver
    // lib/farol/cedente.ts) — pista para o atendimento humano chegar primeiro,
    // nunca fato comercial.
    //
    // NUNCA DERRUBA O WEBHOOK. Se a migração 0075 ainda não foi aplicada, o RPC
    // não existe e devolve erro; se o banco piscar, idem. Nos dois casos o
    // resultado é log e segue — perder uma etiqueta é aceitável, perder a
    // resposta ao cliente porque a etiquetagem falhou não é. É por isso que
    // isto vem DEPOIS do insert da mensagem e não faz parte dele.
    for (const tag of etiquetasDaMensagem(conteudo)) {
      const { error: errTag } = await db.rpc("wa_conversa_add_tag", {
        p_conversa: conversa.id,
        p_tag: tag,
      });
      if (errTag) {
        console.warn("[wa] etiqueta não gravada:", { tag, erro: errTag.message });
      }
    }

    // PAINEL-WA-01 item 5 — reabertura. 'encerrado' é arquivo, não bloqueio:
    // cliente que volta a escrever traz a conversa de volta pra fila do bot.
    // Sem isto, o selo "Encerrada" mentiria assim que chegasse mensagem nova,
    // porque `podeResponder` (abaixo) só exclui 'humano'.
    //
    // Vem DEPOIS do insert da mensagem de propósito: a reabertura é
    // consequência do que o cliente escreveu, e a thread deve contar nessa
    // ordem. Enquanto o botão Encerrar não existir, nada grava 'encerrado' e
    // este ramo simplesmente nunca dispara — mudança inerte por construção.
    if (conversa.status === "encerrado") {
      const { error: errReabrir } = await db
        .from("wa_conversas")
        .update({ status: "ativo" })
        .eq("id", conversa.id);
      if (errReabrir) {
        console.error("[whatsapp] falha ao reabrir conversa encerrada:", errReabrir.message);
      } else {
        conversa.status = "ativo";
        await registrarMensagemSistema({
          conversaId: conversa.id as string,
          conteudo: "Conversa reaberta — o cliente voltou a escrever depois do encerramento.",
        });
      }
    }

    // Fatia 4 (LGPD/opt-out) — "não quero receber" marca opt_out=true,
    // detectado em qualquer uma das 3 formas (ver ehOptOut); F2/F3 devem
    // sempre respeitar essa flag antes de qualquer envio proativo. Ver
    // docs/WHATSAPP-01-SPEC.md §10.3.6.
    const acabaDeOptarSair = ehOptOut(m);
    if (acabaDeOptarSair) {
      await db
        .from("wa_conversas")
        .update({ opt_out: true })
        .eq("id", conversa.id);
    }

    // F4a: EXTRATO-01 e F2+F3 não rodam mais aqui — só empilham um job
    // leve com o mínimo necessário. O processamento de fato (download de
    // mídia, chamada de visão, debounce, Anthropic, Graph API) roda em
    // background via waitUntil() depois do ack (ver fora do loop, abaixo).
    // "Nunca responde à própria mensagem de opt-out": acabaDeOptarSair
    // entra no cálculo de podeResponder abaixo, igual ao comportamento
    // anterior.
    const podeResponder =
      process.env.WHATSAPP_AGENT_ATIVO === "true" &&
      !acabaDeOptarSair &&
      conversa.opt_out !== true &&
      conversa.status !== "humano";

    // SONDA-DIAG (temporário, 2026-07-21): instrumentação pra achar onde a
    // invocação está saindo antes do processamento — remover depois que o
    // F4a fechar verde. Sem dado sensível (telefone mascarado).
    console.log(
      "[whatsapp][diag] msg persistida",
      JSON.stringify({
        msgId: msgInserida.id,
        telefoneMascarado: telefone.slice(0, 4) + "***" + telefone.slice(-2),
        kill_switch_raw: process.env.WHATSAPP_AGENT_ATIVO ?? "(unset)",
        acabaDeOptarSair,
        conversaOptOut: conversa.opt_out,
        conversaStatus: conversa.status,
        agenteAtivo: conversa.agente_ativo,
        podeResponder,
        temAnexo: !!anexo?.id,
      })
    );

    if (anexo?.id || podeResponder) {
      jobs.push({
        conversaId: conversa.id,
        telefone,
        msgInseridaId: msgInserida.id,
        anexoId: anexo?.id ?? null,
        conversaOptOut: conversa.opt_out === true,
        conversaStatus: conversa.status ?? null,
        agenteAtivo: conversa.agente_ativo ?? null,
        podeResponder,
      });
    }
  }

  // F4a-FALLBACK (2026-07-21, sonda vermelha pós-deploy do F4a original):
  // @vercel/functions#waitUntil só de fato segura a invocação viva se o
  // runtime tiver publicado o contexto da Vercel em
  // globalThis[Symbol.for("@vercel/request-context")] — ver
  // node_modules/@vercel/functions/{wait-until,get-context}.js:
  // `getContext().waitUntil?.(promise)`. Se esse contexto não existir
  // (ex.: Fluid Compute não habilitado neste projeto/ambiente), a chamada
  // NÃO lança erro nenhum — o `?.()` simplesmente não executa nada, a
  // promise fica "solta" sem ninguém segurando a invocação viva, e o
  // container pode congelar assim que o 200 sai, matando o processamento
  // (debounce/Anthropic/Graph) no meio, silenciosamente. Foi exatamente
  // essa a assinatura reproduzida às 16:21:51Z: respondendo_desde nunca
  // setado (nem chegou a passar dos 8s de debounce) e zero log de erro.
  //
  // Detectamos aqui, na hora, se o contexto existe. Se existir, usamos
  // waitUntil normalmente (ack rápido, ganho real do F4a). Se NÃO existir,
  // caímos pra AWAIT síncrono — mesmo comportamento do código anterior ao
  // F4a (ack mais lento, mas o processamento é garantido até o fim antes
  // do 200 sair, sem risco de morte silenciosa). Nunca fica pior que o
  // estado anterior; melhora sozinho se/quando o contexto passar a existir
  // (Fluid Compute habilitado), sem precisar de outro deploy.
  // SONDA-DIAG (temporário): loga a decisão ANTES de tentar qualquer
  // caminho — se esta linha não aparecer no log, a morte é antes daqui
  // (no loop de persistência acima); se aparecer mas a próxima linha do
  // job (processar-background.ts) não aparecer, a morte é na fronteira
  // waitUntil/await; se ambas aparecerem mas não houver envio, a morte é
  // dentro do processamento (debounce/lock/Anthropic/Graph).
  console.log(
    "[whatsapp][diag] decisão pré-dispatch",
    JSON.stringify({
      jobsCount: jobs.length,
      contextoWaitUntilDisponivel: contextoVercelSuportaWaitUntil(),
    })
  );

  if (jobs.length > 0) {
    if (contextoVercelSuportaWaitUntil()) {
      waitUntil(processarJobsWhatsapp(db, jobs));
    } else {
      console.error(
        "[whatsapp] contexto @vercel/request-context ausente (Fluid Compute indisponível?) — processando em fallback síncrono antes do ack."
      );
      await processarJobsWhatsapp(db, jobs);
    }
  }

  console.log("[whatsapp][diag] prestes a retornar ack 200");
  return NextResponse.json({ ok: true });
}

// Lê o mesmo símbolo global que @vercel/functions usa internamente (ver
// node_modules/@vercel/functions/get-context.js) só pra checar, sem
// efeitos colaterais, se `.waitUntil` está de fato disponível nesta
// invocação — não é API privada nossa, é o mesmo contrato documentado que
// o próprio pacote depende (Symbol.for é global por natureza).
function contextoVercelSuportaWaitUntil(): boolean {
  const SYMBOL_REQUEST_CONTEXT = Symbol.for("@vercel/request-context");
  const contexto = (
    globalThis as unknown as Record<
      symbol,
      { get?: () => { waitUntil?: unknown } } | undefined
    >
  )[SYMBOL_REQUEST_CONTEXT];
  return typeof contexto?.get?.()?.waitUntil === "function";
}

// Texto do quick reply de opt-out usado no template de marketing (carrossel
// da vitrine). Ver docs/WHATSAPP-01-SPEC.md — botão precisa ter esse título
// exato em todos os cards (a Meta exige botões idênticos entre cards). Já
// normalizado (minúsculo, sem pontuação nas pontas) — comparar sempre via
// normalizarTexto().
const TEXTO_BOTAO_OPT_OUT = "não quero receber";

// SENTINELA-01 (04/08/2026): o template de reativação instrui "responda
// SAIR" — palavras universais de descadastro digitadas livremente também
// marcam opt-out. Só valem em text.body como mensagem INTEIRA (após
// normalizarTexto), o que zera falso positivo com frases longas tipo
// "quero sair do consórcio". "cancelar" fica DE FORA de propósito: colide
// com cancelamento de reserva no meio do fluxo. Variante sem acento
// incluída porque normalizarTexto não remove acento.
const PALAVRAS_OPT_OUT = new Set([
  TEXTO_BOTAO_OPT_OUT,
  "nao quero receber",
  "sair",
  "parar",
  "pare",
  "stop",
  "descadastrar",
]);

/** trim + lowercase + remove aspas/pontuação nas pontas (ex.: `"Não quero
 *  receber."` → `não quero receber`), pra comparação tolerante a variações
 *  de digitação/formatação que a Meta ou o cliente podem introduzir. */
function normalizarTexto(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/^[\s"'“”‘’.!?,;:]+|[\s"'“”‘’.!?,;:]+$/g, "");
}

/** true se a mensagem for o opt-out — cobre as três formas como ele pode
 *  chegar: quick reply de TEMPLATE de marketing (messages[].type="button",
 *  texto em button.text), quick reply de mensagem interativa comum
 *  (interactive.button_reply.title) e texto digitado livremente
 *  (text.body). Botões continuam por igualdade exata com o título do
 *  quick reply; texto digitado aceita também as PALAVRAS_OPT_OUT
 *  (SENTINELA-01 — o template promete "responda SAIR"). */
function ehOptOut(m: MensagemMeta): boolean {
  const botoes = [m.button?.text, m.interactive?.button_reply?.title];
  if (botoes.some((c) => !!c && normalizarTexto(c) === TEXTO_BOTAO_OPT_OUT)) {
    return true;
  }
  const texto = m.text?.body;
  return !!texto && PALAVRAS_OPT_OUT.has(normalizarTexto(texto));
}

// ============================================================================
// CONVERSAS-02 — o nome de quem está falando.
// ----------------------------------------------------------------------------
// MEDIDO em 09/08/2026: 27 conversas, 0 com nome. A coluna `wa_conversas.nome`
// existe desde sempre e é nulável; nunca houve quem escrevesse nela. A tela de
// atendimento era, literalmente, uma lista de telefones repetidos — e a Meta
// mandava o nome do perfil em TODO webhook de mensagem, em
// `entry[].changes[].value.contacts[]`, que este arquivo descartava. Não era
// dado que faltava: era dado que chegava e ia para o lixo.
//
// POR QUE O NOME É FRESCO E O REFERRAL É FIRST-TOUCH. Logo abaixo, o `referral`
// só é gravado se ainda não houver nenhum — vale o PRIMEIRO clique, porque a
// pergunta que ele responde é "de onde esta pessoa veio", e origem não muda.
// O nome é o oposto: a pergunta é "como chamo esta pessoa AGORA". Quem trocou
// o nome do perfil trocou de nome; congelar o primeiro faria o operador chamar
// o cliente por um nome que o próprio cliente abandonou. Então este sobrescreve
// e aquele não — a diferença é de propósito, e é o motivo de estarem a dez
// linhas um do outro com regras opostas.
//
// AUSÊNCIA NÃO APAGA. A chave `nome` só entra no upsert quando há nome. Um
// webhook sem `contacts` (acontece) não pode zerar o nome que já tínhamos —
// seria trocar informação por silêncio.
// ============================================================================
type ContatoMeta = {
  wa_id?: string;
  profile?: { name?: string };
};

/**
 * Mapa `wa_id → nome do perfil`, varrendo todas as entries/changes (como
 * `extrairStatuses`, e não como `extrairMensagens`, que só olha a `[0]`).
 *
 * A chave é `wa_id` e não a posição no array: `contacts` e `messages` são
 * listas paralelas por convenção, não por contrato. Casar por índice
 * funcionaria em 99% dos webhooks e trocaria o nome de duas pessoas no 1%
 * restante — e um nome trocado na tela de atendimento é pior que nome nenhum,
 * porque o operador confia nele.
 */
function extrairNomes(entry: unknown): Map<string, string> {
  const mapa = new Map<string, string>();
  if (!Array.isArray(entry)) return mapa;
  for (const e of entry) {
    const changes = (e as Record<string, unknown> | undefined)?.changes;
    if (!Array.isArray(changes)) continue;
    for (const c of changes) {
      const value = (c as Record<string, unknown> | undefined)?.value as
        | Record<string, unknown>
        | undefined;
      const contatos = value?.contacts;
      if (!Array.isArray(contatos)) continue;
      for (const ct of contatos as ContatoMeta[]) {
        const id = ct?.wa_id;
        const nome = ct?.profile?.name?.trim();
        // Nome vazio ou só espaços é ausência, não nome.
        if (id && nome) mapa.set(id, nome.slice(0, 120));
      }
    }
  }
  return mapa;
}

/** Extrai o array de `messages` do envelope `entry[].changes[].value.messages`
 *  da Meta, tolerando ausência de qualquer nível (não lança). */
function extrairMensagens(entry: unknown): MensagemMeta[] | null {
  if (!Array.isArray(entry)) return null;
  const primeiraEntry = entry[0] as Record<string, unknown> | undefined;
  const changes = primeiraEntry?.changes;
  if (!Array.isArray(changes)) return null;
  const primeiraChange = changes[0] as Record<string, unknown> | undefined;
  const value = primeiraChange?.value as Record<string, unknown> | undefined;
  const msgs = value?.messages;
  if (!Array.isArray(msgs) || msgs.length === 0) return null;
  return msgs as MensagemMeta[];
}

// ============================================================================
// CARROSSEL-OPS-01 Peça 0 — statuses do outbound.
// ----------------------------------------------------------------------------
// Motivo (05/08/2026): a Graph ACEITA o envio de template e devolve wamid,
// mas pode descartar a mensagem depois, de forma assíncrona (ex.: ela não
// consegue baixar a URL de imagem do header do carrossel). Nesse caso
// wa_mensagens.status_envio ficava congelado em 'enviado' pra sempre —
// registrarEnvio (lib/whatsapp/graph.ts) grava no INSERT e nada no projeto
// jamais atualizava a coluna. Resultado: "aceito" era indistinguível de
// "entregue" e o código do erro da Meta nunca aparecia em lugar nenhum.
// Esta peça fecha a cegueira lendo `value.statuses`, que a Meta já mandava
// e o webhook descartava.
//
// status_envio deixa de significar só "a Graph aceitou/recusou na hora" e
// passa a refletir o destino real. Coluna é `text` puro, sem CHECK
// (conferido no banco) — 'entregue'/'lida' entram sem migração.
// ============================================================================
type StatusMeta = {
  id?: string;
  status?: string;
  errors?: Array<{
    code?: number;
    title?: string;
    message?: string;
    error_data?: { details?: string };
  }>;
};

const STATUS_ENVIO_POR_STATUS_META: Record<string, string> = {
  sent: "enviado",
  delivered: "entregue",
  read: "lida",
  failed: "falha",
};

// Progresso normal do outbound. 'falha' fica DE FORA de propósito: é
// terminal, aplica sempre e nunca é sobrescrita depois (ver aplicação).
const RANK_STATUS_ENVIO: Record<string, number> = {
  enviado: 1,
  entregue: 2,
  lida: 3,
};

/** Extrai `entry[].changes[].value.statuses` de TODOS os níveis do envelope
 *  (a Meta empacota vários recibos num POST só), tolerando ausência de
 *  qualquer nível — nunca lança. */
function extrairStatuses(entry: unknown): StatusMeta[] {
  if (!Array.isArray(entry)) return [];
  const saida: StatusMeta[] = [];
  for (const e of entry) {
    const changes = (e as Record<string, unknown> | undefined)?.changes;
    if (!Array.isArray(changes)) continue;
    for (const c of changes) {
      const value = (c as Record<string, unknown> | undefined)?.value as
        | Record<string, unknown>
        | undefined;
      const sts = value?.statuses;
      if (Array.isArray(sts)) saida.push(...(sts as StatusMeta[]));
    }
  }
  return saida;
}

/** Aplica cada recibo em wa_mensagens. Idempotente (status repetido =
 *  no-op), nunca rebaixa (delivered não volta pra sent) e trata 'falha'
 *  como terminal. Linha não encontrada pelo wamid = silêncio: recibo de
 *  mensagem antiga ou enviada por fora deste projeto. try/catch por item —
 *  um recibo podre não derruba os outros nem o processamento de messages. */
async function processarStatuses(statuses: StatusMeta[]): Promise<void> {
  const db = createXtvClient();

  for (const s of statuses) {
    try {
      const wamid = s.id;
      const novo = s.status ? STATUS_ENVIO_POR_STATUS_META[s.status] : undefined;
      if (!wamid || !novo) continue;

      // Log ANTES da busca de propósito: se a Meta recusou, o código do
      // erro (131042/131049/...) tem que ficar legível nos runtime logs
      // mesmo que a linha não exista no banco. É por aqui que a dedução
      // às cegas acaba. sent/delivered/read não logam (ruído).
      if (novo === "falha") {
        console.error(
          "[wa-status-failed]",
          JSON.stringify({ wamid, errors: s.errors ?? null })
        );
      }

      const { data: linha } = await db
        .from("wa_mensagens")
        .select("id, status_envio")
        .eq("wa_message_id", wamid)
        .maybeSingle();
      if (!linha) continue;

      const atual = (linha.status_envio as string | null) ?? null;
      if (atual === novo) continue; // idempotente
      if (atual === "falha") continue; // terminal: nada sobrescreve

      if (novo !== "falha") {
        const rankAtual = atual ? (RANK_STATUS_ENVIO[atual] ?? 0) : 0;
        if ((RANK_STATUS_ENVIO[novo] ?? 0) <= rankAtual) continue; // nunca rebaixa
      }

      // `erro` acompanha a falha pra que o diagnóstico caiba numa query só,
      // sem depender da janela de retenção dos runtime logs — mesma coluna
      // que registrarEnvio já usa pra falha síncrona (graph.ts).
      const patch: { status_envio: string; erro?: string } = { status_envio: novo };
      if (novo === "falha") {
        const e = s.errors?.[0];
        const partes = [
          e?.code != null ? `(#${e.code})` : null,
          e?.title ?? e?.message ?? null,
          e?.error_data?.details ?? null,
        ].filter(Boolean);
        patch.erro = partes.length > 0 ? partes.join(" ") : "falha_assincrona_sem_detalhe";
      }

      await db.from("wa_mensagens").update(patch).eq("id", linha.id);
    } catch (erro) {
      console.error(
        "[wa-status] falha ao processar recibo:",
        erro instanceof Error ? erro.message : String(erro)
      );
    }
  }
}
