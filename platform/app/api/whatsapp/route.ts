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
//   comparação timing-safe sobre os bytes crus do hex, sem o prefixo
//   "sha256=") — assinatura ausente/inválida => 401 (com log temporário do
//   motivo, sem vazar segredo/corpo), nada é processado; 2) ignora eventos
//   que não sejam `messages` (statuses, echoes — fora de escopo F1);
//   3) dedup por wa_message_id; 4) upsert da conversa por telefone + insert
//   da mensagem (papel='cliente'); 5) Fatia 4: quick reply "Não quero
//   receber" (botão do carrossel de marketing) => wa_conversas.opt_out=true;
//   6) SEMPRE 200 (exceto assinatura inválida) — webhook não deve fazer a
//   Meta reenviar por erro de aplicação, mesmo padrão de
//   /api/hooks/novo-cadastro.
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
// Retorna o motivo da rejeição (nunca o segredo nem o corpo) só pra dar pra
// diagnosticar 401 em produção sem vazar dado sensível nos logs.
function assinaturaValida(
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

  const resultadoAssinatura = assinaturaValida(
    corpoBruto,
    req.headers.get("x-hub-signature-256")
  );
  if (!resultadoAssinatura.valida) {
    // LOG TEMPORÁRIO (diagnóstico do 401 em produção) — remover depois de
    // confirmado o motivo. Nunca loga o segredo nem o corpo inteiro, só
    // presença/tamanho, que já basta pra distinguir os casos comuns
    // (env ausente, secret errado/com espaço sobrando, header mal formado).
    console.error("[whatsapp] assinatura rejeitada:", {
      motivo: resultadoAssinatura.motivo,
      temSegredoEnv: !!process.env.WHATSAPP_APP_SECRET,
      tamanhoSegredoEnv: process.env.WHATSAPP_APP_SECRET?.length ?? 0,
      temHeader: !!req.headers.get("x-hub-signature-256"),
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

    // Fatia 4 (LGPD/opt-out) — quick reply "Não quero receber" (botão do
    // carrossel de marketing) marca opt_out=true; F2/F3 devem sempre
    // respeitar essa flag antes de qualquer envio proativo. Ver
    // docs/WHATSAPP-01-SPEC.md §10.3.6.
    if (ehOptOut(m)) {
      await db
        .from("wa_conversas")
        .update({ opt_out: true })
        .eq("id", conversa.id);
    }
  }

  return NextResponse.json({ ok: true });
}

// Texto do quick reply de opt-out usado no template de marketing (carrossel
// da vitrine). Ver docs/WHATSAPP-01-SPEC.md — botão precisa ter esse título
// exato em todos os cards (a Meta exige botões idênticos entre cards).
const TEXTO_BOTAO_OPT_OUT = "não quero receber";

/** true se a mensagem for o quick reply de opt-out (por título, já que o
 *  template ainda não tem `id` de botão fixo definido/aprovado). */
function ehOptOut(m: MensagemMeta): boolean {
  const titulo = m.interactive?.button_reply?.title;
  if (!titulo) return false;
  return titulo.trim().toLowerCase() === TEXTO_BOTAO_OPT_OUT;
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
