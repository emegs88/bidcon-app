// ============================================================================
// Helpers de KYC — validação de upload, signed URL e sanitização de OCR.
// SERVIDOR-ONLY no caso da signed URL (usa createAdminClient). As constantes e
// validações puras (LIMITES, validarArquivo) também rodam no client para dar
// feedback imediato — a revalidação acontece no servidor (/api/kyc/enviar).
// ============================================================================
import { createAdminClient } from "@/lib/supabase-admin";
import { violaCompliance } from "@/lib/ia";

// ----- Buckets privados (criados no painel; policies em 0008_kyc.sql) --------
export const BUCKET_DOC = "kyc-doc";
export const BUCKET_SELFIE = "kyc-selfie";
export const BUCKET_RENDA = "kyc-renda";

export type KycBucket =
  | typeof BUCKET_DOC
  | typeof BUCKET_SELFIE
  | typeof BUCKET_RENDA;

// ----- Limites de upload (revalidados no servidor) ---------------------------
// Documento/selfie: imagem (JPEG/PNG/WebP) ou PDF. Renda: idem + PDF.
export const MAX_BYTES = 8 * 1024 * 1024; // 8 MB por arquivo
export const MIME_IMAGEM = ["image/jpeg", "image/png", "image/webp"] as const;
export const MIME_DOC = [...MIME_IMAGEM, "application/pdf"] as const;

export type ResultadoValidacao = { ok: true } | { ok: false; erro: string };

// Validação pura (tamanho + MIME). `permitirPdf` libera application/pdf.
export function validarArquivo(
  arquivo: { size: number; type: string },
  permitirPdf: boolean
): ResultadoValidacao {
  if (arquivo.size <= 0) return { ok: false, erro: "Arquivo vazio." };
  if (arquivo.size > MAX_BYTES) {
    return { ok: false, erro: "Arquivo acima de 8 MB." };
  }
  const permitidos = permitirPdf ? MIME_DOC : MIME_IMAGEM;
  if (!(permitidos as readonly string[]).includes(arquivo.type)) {
    return {
      ok: false,
      erro: permitirPdf
        ? "Use JPG, PNG, WebP ou PDF."
        : "Use uma imagem JPG, PNG ou WebP.",
    };
  }
  return { ok: true };
}

// ----- CPF — validação de dígitos verificadores (não consulta nada externo) --
export function cpfValido(cpf: string | null | undefined): boolean {
  const d = (cpf ?? "").replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (fatorInicial: number, ate: number): number => {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(d[i]) * (fatorInicial - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return calc(10, 9) === Number(d[9]) && calc(11, 10) === Number(d[10]);
}

// Normaliza CPF para 11 dígitos (sem máscara) para gravar no banco.
export function soDigitos(v: string | null | undefined): string {
  return (v ?? "").replace(/\D/g, "");
}

// ----- Caminho do arquivo no bucket: '{uid}/{nome}' --------------------------
// A policy de storage (0008) exige que o primeiro segmento seja o user_id.
export function pathDe(uid: string, nome: string): string {
  return `${uid}/${nome}`;
}

// ----- Signed URL (server-only) ---------------------------------------------
// Gera URL temporária para o admin VER um arquivo privado. TTL curto (default
// 60s). Só chamar DEPOIS de checar papel (admin) no handler/página.
export async function signedUrl(
  bucket: KycBucket,
  path: string | null | undefined,
  ttlSegundos = 60
): Promise<string | null> {
  if (!path) return null;
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(path, ttlSegundos);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

// ----- Sanitização de texto de OCR -------------------------------------------
// O texto bruto do OCR NUNCA é exibido ao cliente nem vetorizado. Quando for
// guardado/mostrado ao admin, passa por esta barreira: se contiver termo
// proibido (régua de compliance + sigilo de mecânica), devolvemos vazio para
// não propagar conteúdo sensível por engano. Reusa a lista de lib/ia.ts.
export function sanitizarOcr(texto: string | null | undefined): string {
  const t = (texto ?? "").trim();
  if (!t) return "";
  if (violaCompliance(t)) return "";
  return t;
}
