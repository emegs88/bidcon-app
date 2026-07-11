// Rate-limit por IP dedicado ao conector MCP público (app/api/mcp/route.ts).
//
// Deliberadamente ISOLADO do store de lib/api-guard.ts: aquele atende
// /api/atende e /api/interesse (tráfego do site/app Bidcon, origem
// restrita); este atende clients MCP (Claude e afins), sem restrição de
// origem. Compartilhar o mesmo Map misturaria as duas cotas.
//
// Mesma forma/lógica de lib/api-guard.ts (janela fixa de 60s, Map em
// memória por instância — aceitável no MVP, some ao reiniciar/escalar
// horizontalmente).
// TODO(escala): trocar por Upstash/Redis para um contador compartilhado
// entre instâncias e persistente entre deploys.
export const MCP_RATE_LIMITE = 30;
export const MCP_RATE_JANELA_MS = 60_000;
const mcpRateStore = new Map<string, { count: number; reset: number }>();

// Retorna true se o IP ESTOUROU o teto (deve ser bloqueado com 429).
export function mcpRateLimitExcedido(ip: string): boolean {
  const agora = Date.now();
  const reg = mcpRateStore.get(ip);
  if (!reg || agora >= reg.reset) {
    mcpRateStore.set(ip, { count: 1, reset: agora + MCP_RATE_JANELA_MS });
    return false;
  }
  reg.count += 1;
  return reg.count > MCP_RATE_LIMITE;
}
