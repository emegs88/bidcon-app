// ============================================================================
// Webhook do WhatsApp (Meta Cloud API) — WHATSAPP-01 · F1+F2+F3.
// ----------------------------------------------------------------------------
// F1 cuida do encanamento: handshake GET + POST que valida assinatura,
// deduplica por wa_message_id e grava a mensagem recebida em wa_conversas/
// wa_mensagens (projeto xtv — ver migration 0046 e a nota de correção de
// arquitetura nnv→xtv nela).
//
// F2+F3 (esta fatia): depois de gravar a mensagem do cliente, se
// WHATSAPP_AGENT_ATIVO==="true" (kill-switch, default desligado) e a
// conversa não estiver opt-out nem escalada pra humano, chama o cérebro do
// Time Prosperito (lib/whatsapp/cerebro.ts — reaproveita persona/compliance
// do /api/atende) e responde via Graph API (lib/whatsapp/graph.ts). Falha
// do agente é capturada em try/catch e NUNCA derruba o ack 200 do webhook —
// só loga. Escopo desta fatia é mais enxuto que o §10.3 completo da spec
// (sem orquestrador em rota separada, sem debounce/lock, sem tools de
// busca via RPC, sem guardrail module dedicado — ver relatório da sessão).
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
//   texto digitado livremente (text.body); 6) Fatia F2+F3: se ativo e a
//   conversa está livre (sem opt-out, status!=='humano'), gera e envia a
//   resposta do Time Prosperito (await dentro do try/catch — ver nota
//   abaixo sobre a escolha de não usar fire-and-forget literal);
//   7) SEMPRE 200 (exceto assinatura inválida) — webhook não deve fazer a
//   Meta reenviar por erro de aplicação, mesmo padrão de
//   /api/hooks/novo-cadastro.
//
// Nota de desenho (F2+F3): o pedido original falava em "fire-and-forget".
// Em runtime serverless (Vercel/Node), uma promise não aguardada corre risco
// real de ser encerrada junto com a função antes de terminar — não é
// fire-and-forget seguro, é só "talvez rode". Por isso o processamento do
// agente é AGUARDADO (await) dentro do try/catch: a falha nunca derruba o
// 200 (mesmo efeito pedido), mas o trabalho tem garantia de rodar até o
// fim antes da função retornar. Efeito colateral: o ack pode demorar um
// pouco mais quando o agente está ativo (1 chamada Anthropic + 1 chamada
// Graph API, tipicamente poucos segundos) — aceitável nesta fatia; um
// mecanismo de fila/waitUntil fica para uma fatia de blindagem (F4) se a
// latência dessa ack virar problema real em produção.
//
// service_role (createXtvClient): usado aqui porque não há sessão de
// usuário (mensagem chega de fora, sem cookie) — mesmo motivo de
// /api/atende. NUNCA vai ao client.
// ============================================================================
import { NextResponse } from "next/server";
import crypto from "crypto";
import { createXtvClient } from "@/lib/supabase-xtv";
import { gerarRespostaWhatsApp, agenteValido } from "@/lib/whatsapp/cerebro";
import { sendText } from "@/lib/whatsapp/graph";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

    const conteudo =
      m.text?.body ??
      m.button?.text ??
      m.interactive?.button_reply?.title ??
      m.interactive?.list_reply?.title ??
      "";

    const { data: conversa, error: errConversa } = await db
      .from("wa_conversas")
      .upsert({ telefone }, { onConflict: "telefone", ignoreDuplicates: false })
      .select("id, status, agente_ativo, opt_out")
      .single();
    if (errConversa || !conversa) continue;

    await db.from("wa_mensagens").insert({
      conversa_id: conversa.id,
      papel: "cliente",
      conteudo,
      wa_message_id: waMessageId,
    });

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

    // Fatia F2+F3 — Time Prosperito responde, se ligado (kill-switch) e a
    // conversa está livre (sem opt-out — nem o histórico nem esta mesma
    // mensagem — e não escalada pra humano). Nunca responde à própria
    // mensagem de opt-out.
    const podeResponder =
      process.env.WHATSAPP_AGENT_ATIVO === "true" &&
      !acabaDeOptarSair &&
      conversa.opt_out !== true &&
      conversa.status !== "humano";

    if (podeResponder) {
      try {
        const resultado = await gerarRespostaWhatsApp(
          db,
          conversa.id,
          agenteValido(conversa.agente_ativo)
        );
        if (resultado) {
          await sendText({
            conversaId: conversa.id,
            telefone,
            texto: resultado.texto,
            agente: resultado.agenteQueRespondeu,
            tokensIn: resultado.tokensIn,
            tokensOut: resultado.tokensOut,
          });

          const updates: Record<string, unknown> = {};
          if (
            resultado.proximoAgente &&
            resultado.proximoAgente !== resultado.agenteQueRespondeu
          ) {
            updates.agente_ativo = resultado.proximoAgente;
          }
          if (resultado.escalarHumano) {
            updates.status = "humano";
          }
          if (Object.keys(updates).length > 0) {
            await db.from("wa_conversas").update(updates).eq("id", conversa.id);
          }
        }
      } catch (e) {
        // Falha do agente NUNCA derruba o ack 200 do webhook — só loga.
        console.error(
          "[whatsapp] falha ao gerar/enviar resposta do agente:",
          e instanceof Error ? e.message : e
        );
      }
    }
  }

  return NextResponse.json({ ok: true });
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
