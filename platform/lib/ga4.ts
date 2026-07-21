// ============================================================================
// GA4 Measurement Protocol (server-side, fire-and-forget) — FATIA 1 (venda
// nova). Alimenta o FAROL de atribuição com eventos server-side, já que o
// funil de venda nova roda dentro do chat (sem page views tradicionais pra
// marcar cada etapa).
// ----------------------------------------------------------------------------
// Mesmo espírito defensivo dos executores de tool (buscarCartas,
// processarReservaCarta): NUNCA derruba o turno. Sem as env vars
// (GA4_MEASUREMENT_ID/GA4_API_SECRET) -> no-op silencioso (comum em
// desenvolvimento/preview, onde essas envs normalmente não estão setadas).
// Erro de rede/HTTP -> logado, nunca lançado.
//
// client_id: GA4 exige um identificador de "cliente" mesmo em eventos
// server-side sem cookie de navegador — usamos o telefone normalizado como
// seed estável (mesmo cliente = mesmo client_id entre eventos), nunca o
// telefone cru (LGPD: não expor PII num identificador de terceiro).
// ============================================================================
import { createHash } from "node:crypto";

function clientIdDe(seed: string): string {
  // Hash determinístico (não reversível) — mesmo padrão de pseudonimização
  // já usado noutros pontos da plataforma pra evitar vazar PII crua a
  // terceiros (aqui, ao Google).
  return createHash("sha256").update(seed).digest("hex").slice(0, 32);
}

/** Dispara um evento GA4 via Measurement Protocol. Nunca lança — falha vira
 *  log e a função simplesmente retorna, pro chamador nunca precisar de
 *  try/catch. `seedClientId` idealmente é o telefone normalizado (nunca cru
 *  no client_id em si — só como semente de hash). */
export async function enviarEventoGA4(
  nome: string,
  params: Record<string, unknown>,
  seedClientId: string
): Promise<void> {
  const measurementId = process.env.GA4_MEASUREMENT_ID;
  const apiSecret = process.env.GA4_API_SECRET;
  if (!measurementId || !apiSecret || !seedClientId) return;

  try {
    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(
      measurementId
    )}&api_secret=${encodeURIComponent(apiSecret)}`;
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: clientIdDe(seedClientId),
        events: [{ name: nome, params }],
      }),
    });
  } catch (e) {
    console.error(`[ga4] falha ao enviar evento '${nome}':`, e);
  }
}

// Nomes de evento desta fatia — centralizados aqui pra evitar string solta
// espalhada pelos chamadores.
export const GA4_EVENTOS = {
  LEAD_CRIADO: "lead_criado",
  PROPOSTA_ENVIADA: "proposta_enviada",
  // Exportado por completude (mencionado no pedido original) — SEM
  // chamador nesta fatia: não existe fluxo de Pix implementado ainda.
  PIX_ENVIADO: "pix_enviado",
} as const;
