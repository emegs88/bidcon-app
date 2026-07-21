// ============================================================================
// utm.ts — allowlist + sanitização de parâmetros de campanha (UTM/ads).
// ----------------------------------------------------------------------------
// Ajuste obrigatório #4 (aprovação condicional do Emerson, FATIA 1): o corpo
// do POST /api/atende pode trazer um objeto `utm` capturado pelo widget do
// site (query string da página em que o chat abriu) — usado por salvar_lead
// pra registrar a origem do lead em vendas_novas.utm. Só os campos desta
// allowlist são aceitos; qualquer outra chave é descartada (nunca repassamos
// um objeto arbitrário vindo do cliente pro banco).
// ============================================================================
export const UTM_CHAVES_PERMITIDAS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "fbclid",
] as const;

/** Filtra `raw` pela allowlist acima. Cada valor aceito é string, trim, até
 *  200 chars. Objeto vazio (nenhuma chave válida) -> null (nunca grava {}). */
export function sanitizarUtm(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const limpo: Record<string, string> = {};
  for (const chave of UTM_CHAVES_PERMITIDAS) {
    const v = o[chave];
    if (typeof v === "string" && v.trim()) {
      limpo[chave] = v.trim().slice(0, 200);
    }
  }
  return Object.keys(limpo).length ? limpo : null;
}
