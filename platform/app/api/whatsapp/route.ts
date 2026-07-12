// ============================================================================
// Webhook do WhatsApp (Meta Cloud API) — WHATSAPP-01 · F1 (Fundação).
// ----------------------------------------------------------------------------
// F1 só cuida do encanamento: handshake GET + POST que valida assinatura,
// deduplica por wa_message_id e grava a mensagem recebida em wa_conversas/
// wa_mensagens (projeto xtv — ver migration 0046 e a nota de correção de
// arquitetura nnv→xtv nela). NENHUMA lógica de Claude, NENHUM envio de
// resposta via Graph API ainda — isso é F2 (Eco) e F3 (Cérebro), ver
// docs/WHATSAPP-01-SPEC.md.
//
// GET: handshake exigido pela Meta ao configurar o webhook (hub.mode=
//   subscribe + hub.verify_token == WHATSAPP_VERIFY_TOKEN → devolve
//   hub.challenge).
// POST: 1) valida X-Hub-Signature-256 (HMAC-SHA256 com WHATSAPP_APP_SECRET,
//   comparação timing-safe) — assinatura ausente/inválida => 401, nada é
//   processado; 2) ignora eventos que não sejam `messages` (statuses,
//   echoes — fora de escopo F1); 3) dedup por wa_message_id; 4) upsert da
//   conversa por telefone + insert da mensagem (papel='cliente'); 5) SEMPRE
//   200 (exceto assinatura inválida) — webhook não deve fazer a Meta
//   reenviar por erro de aplicação, mesmo padrão de /api/hooks/novo-cadastro.
//
// service_role (createXtvClient): usado aqui porque não há sessão de
// usuário (mensagem chega de fora, sem cookie) — mesmo motivo de
// /api/atende. NUNCA vai ao client.
// ============================================================================
import { NextResponse } from "next/server";
import crypto from "crypto";
import { createXtvClient } from "@/lib/supabase-xtv";

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

// --- Validação de assinatura (HMAC-SHA256, timing-safe) ---------------------
function assinaturaValida(corpoBruto: string, assinatura: string | null): boolean {
  const segredo = process.env.WHATSAPP_APP_SECRET;
  if (!segredo || !assinatura) return false;

  const esperado =
    "sha256=" + crypto.createHmac("sha256", segredo).update(corpoBruto).digest("hex");

  const bufAssinatura = Buffer.from(assinatura);
  const bufEsperado = Buffer.from(esperado);
  if (bufAssinatura.length !== bufEsperado.length) return false;
  return crypto.timingSafeEqual(bufAssinatura, bufEsperado);
}

// Shape mínimo do envelope da Meta que nos interessa em F1 (texto e
// interativas); campos não usados aqui ficam como unknown de propósito.
type MensagemMeta = {
  id?: string;
  from?: string;
  text?: { body?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
};

// --- POST: recebe eventos; F1 só grava (sem Claude, sem resposta) ----------
export async function POST(req: Request) {
  const corpoBruto = await req.text();

  if (!assinaturaValida(corpoBruto, req.headers.get("x-hub-signature-256"))) {
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
      m.interactive?.button_reply?.title ??
      m.interactive?.list_reply?.title ??
      "";

    const { data: conversa, error: errConversa } = await db
      .from("wa_conversas")
      .upsert({ telefone }, { onConflict: "telefone", ignoreDuplicates: false })
      .select("id")
      .single();
    if (errConversa || !conversa) continue;

    await db.from("wa_mensagens").insert({
      conversa_id: conversa.id,
      papel: "cliente",
      conteudo,
      wa_message_id: waMessageId,
    });
  }

  return NextResponse.json({ ok: true });
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
