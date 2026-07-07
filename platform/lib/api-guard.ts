// Camada de auth compartilhada pelos endpoints públicos do lead (atende,
// interesse): allowlist de Origin/Referer + rate-limit por IP + headers CORS.
//
// Extraído de app/api/atende/route.ts para reuso sem duplicação — mantenha
// os DOIS endpoints (atende e interesse) importando daqui.

// --- AUTH camada 1: allowlist de origem -------------------------------------
// Só aceitamos chamadas vindas do próprio site/app Bidcon. Fora disso -> 403.
// Conferimos Origin; na ausência dele, caímos para o host do Referer.
export const ORIGENS_PERMITIDAS = new Set<string>([
  "https://bidcon.com.br",
  "https://www.bidcon.com.br",
  "https://app.bidcon.com.br",
]);

export function hostDe(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// Retorna true se a requisição tem origem confiável.
export function origemPermitida(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin) return ORIGENS_PERMITIDAS.has(origin);
  // Sem Origin (ex.: navegação same-origin em alguns browsers): usa o Referer.
  const refOrigin = hostDe(req.headers.get("referer"));
  if (refOrigin) return ORIGENS_PERMITIDAS.has(refOrigin);
  // Sem Origin nem Referer confiável -> nega.
  return false;
}

// --- AUTH camada 2: rate-limit por IP ---------------------------------------
// Teto de 20 req/min por IP, janela fixa de 60s. Store em memória por instância
// (aceitável no MVP; some ao reiniciar/escalar horizontalmente).
// TODO(escala): trocar por Upstash/Redis para um contador compartilhado entre
// instâncias e persistente entre deploys.
export const RATE_LIMITE = 20;
export const RATE_JANELA_MS = 60_000;
const rateStore = new Map<string, { count: number; reset: number }>();

// Extrai o IP do cliente: primeiro item de x-forwarded-for, com fallback.
export function ipDe(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const primeiro = xff.split(",")[0]?.trim();
    if (primeiro) return primeiro;
  }
  return req.headers.get("x-real-ip")?.trim() || "desconhecido";
}

// Retorna true se o IP ESTOUROU o teto (deve ser bloqueado com 429).
export function rateLimitExcedido(ip: string): boolean {
  const agora = Date.now();
  const reg = rateStore.get(ip);
  if (!reg || agora >= reg.reset) {
    rateStore.set(ip, { count: 1, reset: agora + RATE_JANELA_MS });
    return false;
  }
  reg.count += 1;
  return reg.count > RATE_LIMITE;
}

// --- CORS --------------------------------------------------------------------
// bidcon.com.br (vitrine) chama app.bidcon.com.br (API) -> cross-origin.
// Nunca usamos wildcard: ecoamos o Origin da requisição SE ele estiver na
// allowlist, e sempre mandamos Vary: Origin (evita cache poisoning em CDN).

// Monta os headers CORS para respostas normais (POST) — inclui
// Access-Control-Allow-Origin (eco condicional) e Vary: Origin.
export function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin");
  const headers: Record<string, string> = { Vary: "Origin" };
  if (origin && ORIGENS_PERMITIDAS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

// Monta os headers da resposta de preflight (OPTIONS): tudo de corsHeaders()
// mais os headers específicos de preflight (métodos, headers permitidos, TTL).
export function corsPreflightHeaders(req: Request): HeadersInit {
  return {
    ...corsHeaders(req),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
  };
}

// Handler pronto para export async function OPTIONS(req) nos dois endpoints:
// responde 204 com os headers de preflight.
export function handlePreflight(req: Request): Response {
  return new Response(null, { status: 204, headers: corsPreflightHeaders(req) });
}
