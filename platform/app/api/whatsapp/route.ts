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
//   nada é processado; 2) ignora eventos
//   que não sejam `messages` (statuses, echoes — fora de escopo F1);
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
import { processarJobsWhatsapp, type WaJob } from "@/lib/whatsapp/processar-background";

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
  if (!msgs || msgs.length === 0) {
    // statuses (delivery/read receipts) e echoes: fora de escopo F1.
    return NextResponse.json({ status: "ignorado" });
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

    const { data: conversa, error: errConversa } = await db
      .from("wa_conversas")
      .upsert({ telefone }, { onConflict: "telefone", ignoreDuplicates: false })
      .select("id, status, agente_ativo, opt_out, referral")
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
 *  (text.body), já que o cliente pode simplesmente escrever a frase. */
function ehOptOut(m: MensagemMeta): boolean {
  const candidatos = [
    m.button?.text,
    m.interactive?.button_reply?.title,
    m.text?.body,
  ];
  return candidatos.some(
    (c) => !!c && normalizarTexto(c) === TEXTO_BOTAO_OPT_OUT
  );
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
