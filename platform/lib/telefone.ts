// Normalização de telefone BR — extraído de
// platform/app/api/whatsapp/disparo/route.ts (DISPARO-01) pra ser
// reaproveitado pela FATIA 1 (venda nova Disal), sem mudar comportamento.
// Aceita telefone com ou sem DDI 55, extrai só dígitos. Formato final igual
// ao que o Meta manda no webhook (DDI+DDD+número, sem "+") — E.164 sem o
// prefixo "+", mesmo padrão já usado em wa_conversas.telefone.
export function normalizarTelefoneBR(raw: unknown): string | null {
  const digitos = String(raw ?? "").replace(/\D/g, "");
  if (digitos.length === 12 || digitos.length === 13) {
    return digitos.startsWith("55") ? digitos : null;
  }
  if (digitos.length === 10 || digitos.length === 11) {
    return "55" + digitos;
  }
  return null;
}
