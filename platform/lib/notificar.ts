// ============================================================================
// Notificação de carta nova — STUB (preparado agora, NÃO dispara ainda)
// ----------------------------------------------------------------------------
// O sync horário chama notificarCartaNova(carta) quando detecta uma cota NOVA.
// HOJE esta função NÃO envia push: apenas devolve o payload que será usado
// quando o OneSignal for plugado. O registro do evento (push_pendente=true)
// acontece na rota do cron, na mesma transação do insert da carta.
//
// ────────────────────────────────────────────────────────────────────────────
// TODO(OneSignal): plugar o disparo real AQUI. Pré-requisitos (fase do app,
//   tarefa do Emerson): criar conta OneSignal, configurar APNs (iOS) e FCM
//   (Android), guardar ONESIGNAL_APP_ID + ONESIGNAL_REST_API_KEY como env vars
//   de SERVIDOR (nunca no repo/client). Só então trocar o stub por uma chamada
//   POST à API do OneSignal usando a segmentação abaixo.
// ────────────────────────────────────────────────────────────────────────────
//
// COMPLIANCE (inviolável): a mensagem NÃO pode prometer contemplação nem usar
//   "investimento", "rendimento" ou "garantido". Só fato: tipo + crédito + CTA.

export type CartaNotificavel = {
  numeroExterno: number;
  tipo: "imovel" | "veiculo";
  valorCredito: number;
};

export type PushPayload = {
  titulo: string;
  mensagem: string;
  // segmentação para quando o OneSignal entrar: por tipo de bem e faixa de valor
  segmento: {
    tipo: "imovel" | "veiculo";
    faixaValor: "ate_100k" | "100k_300k" | "300k_700k" | "acima_700k";
  };
  // deep-link sugerido (rota pública do site que lista a cota)
  url: string;
};

function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function faixaDe(valor: number): PushPayload["segmento"]["faixaValor"] {
  if (valor <= 100_000) return "ate_100k";
  if (valor <= 300_000) return "100k_300k";
  if (valor <= 700_000) return "300k_700k";
  return "acima_700k";
}

/**
 * Monta (mas NÃO dispara) o push de carta nova. Texto compliance-safe:
 * informa tipo e crédito, sem promessa de contemplação/prazo.
 * Quando o OneSignal entrar, é só enviar este payload.
 */
export function notificarCartaNova(carta: CartaNotificavel): PushPayload {
  const bem = carta.tipo === "imovel" ? "imóvel" : "veículo";
  const payload: PushPayload = {
    titulo: `Nova carta de ${bem} na bidcon`,
    // fato puro — sem "garantido", sem "contemplação", sem "investimento"
    mensagem: `Carta de ${bem} disponível: crédito de ${brl(
      carta.valorCredito
    )}. Toque para ver os detalhes.`,
    segmento: { tipo: carta.tipo, faixaValor: faixaDe(carta.valorCredito) },
    url: "https://www.bidcon.com.br/",
  };

  // STUB: não envia nada. O disparo real entra no TODO(OneSignal) acima.
  // (Sem console em produção; a intenção fica registrada em eventos_sync.)
  return payload;
}
