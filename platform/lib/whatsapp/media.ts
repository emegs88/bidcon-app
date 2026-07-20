// ============================================================================
// Download de mídia da Meta Graph API + upload pro bucket privado
// `wa-extratos` (Supabase Storage, projeto xtv) — FATIA WHATSAPP-EXTRATO-01.
// SERVIDOR-ONLY (lê WHATSAPP_TOKEN).
// ----------------------------------------------------------------------------
// Fluxo de download é em DOIS passos, como a própria Meta documenta:
//   1) GET https://graph.facebook.com/v21.0/{media_id} com
//      Authorization: Bearer WHATSAPP_TOKEN devolve um envelope JSON com
//      `url` (URL assinada e EFÊMERA, expira em poucos minutos) + metadados
//      (mime_type, sha256, file_size).
//   2) GET nessa `url`, TAMBÉM com Authorization: Bearer WHATSAPP_TOKEN (a
//      url sozinha não autentica — precisa do mesmo token de novo) devolve
//      os bytes crus do arquivo.
//
// Escopo desta fatia: só o caminho Meta direto (Graph API), como pedido.
// Em modo BSP (WHATSAPP_BSP="360dialog") o media_id/URL de download podem
// seguir outro contrato do lado da 360dialog — fora do pedido desta fatia.
// baixarMidia() sempre tenta o caminho Meta; se WHATSAPP_TOKEN não bater
// com o media_id (ex.: relay BSP com media_id de outro namespace), a
// chamada falha e o erro é só logado pelo webhook — nunca derruba o 200.
//
// Upload: bucket PRIVADO `wa-extratos`, criado MANUALMENTE no painel do
// Supabase (mesmo padrão de kyc-doc/processo-docs — ver migrations 0008 e
// 0014: "o agente não cria bucket via SQL", só a policy/schema). Como o
// acesso a este bucket é 100% via service_role (upload aqui, leitura por
// signed URL quando/se existir uma tela admin — nunca client-side), NÃO há
// necessidade de policy de storage.objects: RLS não entra em jogo pra
// service_role. Path: '{conversa_id}/{media_id}.{ext}'.
// ============================================================================
import { createXtvClient } from "@/lib/supabase-xtv";

const GRAPH_VERSION = "v21.0";
const BUCKET = "wa-extratos";
const TIMEOUT_MS = 20_000;

export type MidiaBaixada = {
  bytes: Uint8Array;
  mimeType: string;
  ext: string;
};

const EXT_POR_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function extDoMime(mime: string): string {
  return EXT_POR_MIME[mime] ?? "bin";
}

/** Resolve a URL efêmera do media_id (passo 1) e baixa os bytes (passo 2).
 *  Lança em qualquer falha (env ausente, HTTP não-ok, timeout) — o
 *  chamador (webhook) decide (try/catch, nunca derruba o ack 200). */
export async function baixarMidia(mediaId: string): Promise<MidiaBaixada> {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) throw new Error("env_ausente(WHATSAPP_TOKEN)");

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const respMeta = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    if (!respMeta.ok) throw new Error(`graph_media_meta_${respMeta.status}`);
    const meta = (await respMeta.json()) as { url?: string; mime_type?: string };
    if (!meta.url) throw new Error("graph_media_sem_url");

    const respArquivo = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    if (!respArquivo.ok) throw new Error(`graph_media_download_${respArquivo.status}`);

    const bytes = new Uint8Array(await respArquivo.arrayBuffer());
    const mimeType =
      meta.mime_type ?? respArquivo.headers.get("content-type") ?? "application/octet-stream";
    return { bytes, mimeType, ext: extDoMime(mimeType) };
  } finally {
    clearTimeout(t);
  }
}

/** Sobe os bytes pro bucket privado wa-extratos, path
 *  '{conversaId}/{mediaId}.{ext}'. Lança em falha — o chamador decide. */
export async function subirParaStorage(
  conversaId: string,
  mediaId: string,
  midia: MidiaBaixada
): Promise<string> {
  const db = createXtvClient();
  const path = `${conversaId}/${mediaId}.${midia.ext}`;
  const { error } = await db.storage.from(BUCKET).upload(path, midia.bytes, {
    contentType: midia.mimeType,
    upsert: true,
  });
  if (error) throw new Error(`storage_upload_falhou: ${error.message}`);
  return path;
}
