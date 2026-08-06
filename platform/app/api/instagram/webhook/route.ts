// ============================================================================
// Webhook do Instagram (Messaging API) — INSTA-01.
// ----------------------------------------------------------------------------
// Espelho deliberado de app/api/whatsapp/route.ts (F1 + F4a). Mesma sequência,
// mesmas garantias, mesmas mensagens de erro. O que muda é SÓ o transporte:
//
//   WhatsApp                          Instagram
//   --------                          ---------
//   entry[].changes[].value.messages  entry[].messaging[]
//   m.id                              m.message.mid
//   m.from (telefone E.164)           m.sender.id (IGSID)
//   WHATSAPP_VERIFY_TOKEN             IG_VERIFY_TOKEN
//   WHATSAPP_APP_SECRET               IG_APP_SECRET
//   graph.facebook.com                graph.instagram.com (lib/instagram/graph.ts)
//
// O que NÃO muda, de propósito, porque canal não muda regra de negócio:
//   - opt-out (SAIR/PARAR/...) — importado de lib/opt-out.ts, MESMA lista;
//   - gate humano/opt_out/status e o kill-switch WHATSAPP_AGENT_ATIVO;
//   - dedup por id de mensagem (wa_mensagens.wa_message_id é UNIQUE);
//   - debounce, lock e cérebro — reaproveitados inteiros via
//     processarJobsWhatsapp(), que agora roteia o ENVIO por job.canal.
//
// Por que o job vai pro mesmo processarJobsWhatsapp: o cérebro
// (lib/whatsapp/cerebro.ts) não sabe nem precisa saber de canal — ele lê
// wa_mensagens e devolve texto. Duplicar aquele fluxo pra IG criaria duas
// verdades sobre debounce/lock/guardrail. Ver o adaptador enviarPorCanal()
// em lib/whatsapp/processar-background.ts.
//
// ASSINATURA (X-Hub-Signature-256): a Meta assina com o App Secret do APP,
// e um app tem UM secret que assina todos os produtos pendurados nele. Não
// dá pra afirmar por leitura de doc qual app está assinando este webhook —
// então o motivo da recusa é LOGADO com nome próprio
// ("assinatura_nao_confere") e o 401 é devolvido. O primeiro POST real do
// Instagram é que decide: se der assinatura_nao_confere com IG_APP_SECRET
// preenchido, o secret configurado é do app errado. Medir, não assumir.
//
// wa_conversas no canal 'instagram': a coluna `telefone` guarda o IGSID da
// pessoa (numérico, 16-17 dígitos) — ver migration 0067_insta_canal.sql,
// que também cria o UNIQUE(telefone, canal) usado como alvo do upsert aqui.
//
// SEMPRE 200 fora de assinatura inválida — webhook que devolve 5xx faz a
// Meta reenviar e, na pior hipótese, derrubar a inscrição. Env ausente
// devolve erro nomeado, nunca 500 cru.
// ============================================================================
import { NextResponse } from "next/server";
import crypto from "crypto";
import { waitUntil } from "@vercel/functions";
import { createXtvClient } from "@/lib/supabase-xtv";
import { registrarMensagemSistema } from "@/lib/whatsapp/sistema";
import { processarJobsWhatsapp, type WaJob } from "@/lib/whatsapp/processar-background";
import { ehTextoOptOut } from "@/lib/opt-out";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Mesmo raciocínio do webhook do WhatsApp: o ack é rápido, mas o
// processamento em background (debounce 8s + Anthropic + envio) é medido
// pela Vercel como parte da mesma invocação.
export const maxDuration = 180;

// --- GET: handshake da Meta -------------------------------------------------
export async function GET(req: Request) {
  const url = new URL(req.url);
  const modo = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const desafio = url.searchParams.get("hub.challenge");

  if (
    modo === "subscribe" &&
    !!process.env.IG_VERIFY_TOKEN &&
    token === process.env.IG_VERIFY_TOKEN &&
    desafio
  ) {
    // A Meta espera o challenge cru no corpo, sem JSON em volta.
    return new Response(desafio, { status: 200 });
  }

  // Distingue "não configurei a env" de "token errado" no LOG (não na
  // resposta — a resposta pra Meta é sempre a mesma, sem dar pista).
  console.error(
    "[instagram/webhook] handshake recusado:",
    JSON.stringify({
      modo,
      envPresente: !!process.env.IG_VERIFY_TOKEN,
      tokenConfere: !!process.env.IG_VERIFY_TOKEN && token === process.env.IG_VERIFY_TOKEN,
      temDesafio: !!desafio,
    })
  );
  return NextResponse.json({ erro: "handshake_invalido" }, { status: 403 });
}

// --- Assinatura -------------------------------------------------------------
// Mesma construção do webhook do WhatsApp: HMAC-SHA256 sobre os BYTES CRUS
// do corpo (não sobre o objeto reserializado — JSON.stringify reordena e
// reformata, e aí a assinatura nunca fecharia), comparação timing-safe.
function assinaturaValida(
  corpoBruto: string,
  assinaturaHeader: string | null
): { valida: boolean; motivo?: string } {
  const segredo = process.env.IG_APP_SECRET;
  if (!segredo) return { valida: false, motivo: "segredo_ausente_env(IG_APP_SECRET)" };
  if (!assinaturaHeader) return { valida: false, motivo: "header_ausente" };

  const prefixo = "sha256=";
  if (!assinaturaHeader.startsWith(prefixo)) {
    return { valida: false, motivo: "header_sem_prefixo_sha256" };
  }
  const recebidoHex = assinaturaHeader.slice(prefixo.length);
  const esperadoHex = crypto
    .createHmac("sha256", segredo)
    .update(corpoBruto, "utf8")
    .digest("hex");

  const a = Buffer.from(recebidoHex, "utf8");
  const b = Buffer.from(esperadoHex, "utf8");
  // timingSafeEqual lança se os tamanhos diferem — checar antes.
  if (a.length !== b.length) return { valida: false, motivo: "tamanho_hex_diferente" };
  if (!crypto.timingSafeEqual(a, b)) return { valida: false, motivo: "assinatura_nao_confere" };
  return { valida: true };
}

// --- Extração dos eventos ---------------------------------------------------
// Shape medido (06/08/2026, docs da Instagram Platform + payloads públicos):
//   { object: "instagram", entry: [ { id, time, messaging: [ {
//       sender: { id }, recipient: { id }, timestamp,
//       message: { mid, text, is_echo? } } ] } ] }
// Reactions/seen/postbacks chegam com outras chaves no lugar de `message`.
type EventoIg = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: unknown[] };
  // presentes em outros tipos de evento — só usados pra nomear o skip
  reaction?: unknown;
  read?: unknown;
  postback?: unknown;
  referral?: unknown;
};

function extrairEventos(corpo: unknown): EventoIg[] {
  const entry = (corpo as { entry?: unknown })?.entry;
  if (!Array.isArray(entry)) return [];
  const saida: EventoIg[] = [];
  for (const e of entry) {
    const messaging = (e as { messaging?: unknown })?.messaging;
    if (!Array.isArray(messaging)) continue;
    for (const m of messaging) saida.push(m as EventoIg);
  }
  return saida;
}

/** Nome do tipo do evento, só pra log de skip. Nunca joga fora silenciosamente. */
function tipoEvento(ev: EventoIg): string {
  if (ev.message?.is_echo) return "echo";
  if (ev.message && typeof ev.message.text === "string") return "text";
  if (ev.message?.attachments) return "attachment";
  if (ev.reaction) return "reaction";
  if (ev.read) return "read";
  if (ev.postback) return "postback";
  if (ev.referral) return "referral";
  return "desconhecido";
}

// --- POST -------------------------------------------------------------------
export async function POST(req: Request) {
  const corpoBruto = await req.text();
  const assinatura = req.headers.get("x-hub-signature-256");

  const check = assinaturaValida(corpoBruto, assinatura);
  if (!check.valida) {
    // Motivo no log (nunca no corpo da resposta, e nunca o segredo nem o
    // payload). É este log que responde "o secret é do app pai ou do app
    // do Instagram?" no primeiro POST real.
    console.error("[instagram/webhook] assinatura inválida:", check.motivo);
    return NextResponse.json({ erro: "assinatura_invalida" }, { status: 401 });
  }

  let evento: unknown;
  try {
    evento = JSON.parse(corpoBruto);
  } catch {
    console.error("[instagram/webhook] corpo não é JSON válido");
    return NextResponse.json({ status: "ignorado" });
  }

  const objeto = (evento as { object?: string })?.object;
  if (objeto !== "instagram") {
    console.log("[ig-skip] object inesperado:", JSON.stringify(objeto ?? null));
    return NextResponse.json({ status: "ignorado" });
  }

  const eventos = extrairEventos(evento);
  if (eventos.length === 0) {
    return NextResponse.json({ status: "ignorado" });
  }

  const db = createXtvClient();
  const jobs: WaJob[] = [];

  for (const ev of eventos) {
    const tipo = tipoEvento(ev);

    // Echo (mensagem que NÓS mandamos, devolvida pelo webhook), leitura,
    // reação, postback, anexo: fora do escopo desta fatia. Silencioso pro
    // cliente, visível no log.
    if (tipo !== "text") {
      console.log("[ig-skip]", tipo);
      continue;
    }

    const mid = ev.message?.mid;
    if (!mid) {
      console.log("[ig-skip] text_sem_mid");
      continue;
    }

    // Dedup — a Meta reenvia o mesmo evento quando não recebe 200 a tempo.
    // wa_mensagens.wa_message_id é UNIQUE; esta checagem evita depender do
    // erro do banco pra saber que já vimos isto.
    const { data: existente } = await db
      .from("wa_mensagens")
      .select("id")
      .eq("wa_message_id", mid)
      .maybeSingle();
    if (existente) continue;

    const igsid = ev.sender?.id;
    if (!igsid) {
      console.log("[ig-skip] text_sem_sender");
      continue;
    }

    const conteudo = ev.message?.text ?? "";

    // Upsert por (telefone, canal) — alvo criado na migration 0067. NÃO usa
    // onConflict "telefone" (chave do WhatsApp) de propósito: se um IGSID
    // colidir com um telefone existente, isto FALHA alto (violação do
    // UNIQUE(telefone) que continua lá) em vez de fundir silenciosamente a
    // conversa de duas pessoas diferentes. Falhar é recuperável; misturar não.
    const { data: conversa, error: errConversa } = await db
      .from("wa_conversas")
      .upsert(
        { telefone: igsid, canal: "instagram" },
        { onConflict: "telefone,canal", ignoreDuplicates: false }
      )
      .select("id, status, agente_ativo, opt_out")
      .single();

    if (errConversa || !conversa) {
      console.error(
        "[instagram/webhook] falha no upsert da conversa:",
        errConversa?.message ?? "sem_dado"
      );
      continue;
    }

    const { data: msgInserida, error: errMsg } = await db
      .from("wa_mensagens")
      .insert({
        conversa_id: conversa.id,
        papel: "cliente",
        conteudo,
        wa_message_id: mid,
      })
      .select("id")
      .single();

    if (errMsg || !msgInserida) {
      console.error(
        "[instagram/webhook] falha ao inserir mensagem:",
        errMsg?.message ?? "sem_dado"
      );
      continue;
    }

    // Reabertura: cliente que volta a falar numa conversa encerrada põe ela
    // de volta em 'ativo' e deixa rastro na thread — mesmo comportamento do
    // WhatsApp, pelo mesmo motivo (o painel precisa contar a história).
    if (conversa.status === "encerrado") {
      await db.from("wa_conversas").update({ status: "ativo" }).eq("id", conversa.id);
      await registrarMensagemSistema({
        conversaId: conversa.id,
        conteudo: "Conversa reaberta: o cliente respondeu no Instagram.",
        agente: "sistema",
      });
    }

    // Opt-out: MESMA lista do WhatsApp (lib/opt-out.ts). No Instagram só
    // existe a forma "texto digitado" — não há quick reply de template
    // aqui, porque esta fatia não dispara template no IG.
    const acabaDeOptarSair = ehTextoOptOut(conteudo);
    if (acabaDeOptarSair) {
      await db.from("wa_conversas").update({ opt_out: true }).eq("id", conversa.id);
    }

    const podeResponder =
      process.env.WHATSAPP_AGENT_ATIVO === "true" &&
      !acabaDeOptarSair &&
      conversa.opt_out !== true &&
      (conversa.status ?? null) !== "humano";

    console.log(
      "[instagram][diag] msg persistida",
      JSON.stringify({
        msgId: msgInserida.id,
        igsidMascarado: igsid.slice(0, 4) + "***" + igsid.slice(-2),
        kill_switch_raw: process.env.WHATSAPP_AGENT_ATIVO ?? "(unset)",
        acabaDeOptarSair,
        conversaOptOut: conversa.opt_out,
        conversaStatus: conversa.status,
        agenteAtivo: conversa.agente_ativo,
        podeResponder,
      })
    );

    if (podeResponder) {
      jobs.push({
        conversaId: conversa.id,
        telefone: igsid, // mesma coluna; no canal instagram é o IGSID
        msgInseridaId: msgInserida.id,
        anexoId: null, // anexo de IG não é tratado nesta fatia (ver [ig-skip])
        conversaOptOut: conversa.opt_out === true,
        conversaStatus: conversa.status ?? null,
        agenteAtivo: conversa.agente_ativo ?? null,
        podeResponder,
        canal: "instagram",
      });
    }
  }

  if (jobs.length > 0) {
    if (contextoVercelSuportaWaitUntil()) {
      waitUntil(processarJobsWhatsapp(db, jobs));
    } else {
      console.error(
        "[instagram/webhook] contexto @vercel/request-context ausente — processando em fallback síncrono antes do ack."
      );
      await processarJobsWhatsapp(db, jobs);
    }
  }

  return NextResponse.json({ ok: true });
}

// Mesma checagem do webhook do WhatsApp (ver comentário longo lá): waitUntil
// só segura a invocação viva se a Vercel tiver publicado o contexto; sem ele
// a chamada não lança nada e a promise morre em silêncio quando o container
// congela. Detecta e cai pro await síncrono. Duplicado aqui em vez de
// importado porque a função vive dentro do route.ts do WhatsApp, que é um
// Route Handler — o Next não permite export arbitrário de lá.
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
