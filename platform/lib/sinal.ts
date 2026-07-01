// ============================================================================
// Sinal da reserva da cota (modelo Lance, etapa 4) — regra num ÚNICO lugar.
// ----------------------------------------------------------------------------
// O sinal é 2% do CRÉDITO da carta e vale para "segurar" a cota por alguns dias
// úteis. Quando o cliente segue para a entrada (etapa 6), o sinal já pago é
// DESCONTADO da entrada (paga-se só o residual). Aritmética pura sobre dados
// factuais do bem (crédito, entrada). Não usa administradora/taxa/fundo/comissão.
//
// COMPLIANCE: nada aqui promete contemplação/prazo/rendimento. É só cálculo de
// valores da própria operação de compra da cota.
// ============================================================================

/** Percentual do sinal sobre o crédito (2%). Um lugar só para mudar, se preciso. */
export const SINAL_PERCENTUAL = 0.02;

/** Validade padrão da reserva do sinal, em dias úteis (referência Lance). */
export const SINAL_VALIDADE_DIAS_UTEIS = 3;

/** Arredonda para centavos (2 casas), evitando ruído de ponto flutuante. */
function centavos(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/**
 * Valor do sinal = 2% do crédito. Retorna null quando o crédito não é positivo
 * (dado ausente/inválido) — a UI decide como exibir a ausência.
 */
export function valorSinal(valorCredito: number | null | undefined): number | null {
  if (valorCredito == null || !(valorCredito > 0)) return null;
  return centavos(valorCredito * SINAL_PERCENTUAL);
}

/**
 * Residual da entrada = entrada − sinal (nunca negativo). Se a entrada não
 * estiver definida, retorna null (não há entrada a estimar). Se o sinal exceder
 * a entrada, o residual é zero (não devolvemos diferença aqui — é só exibição).
 */
export function residualEntrada(
  valorEntrada: number | null | undefined,
  sinal: number | null | undefined
): number | null {
  if (valorEntrada == null) return null;
  const s = sinal ?? 0;
  return centavos(Math.max(0, valorEntrada - s));
}

/**
 * Resumo dos valores do sinal a partir dos campos factuais da carta/processo.
 * Retorna sinal (2% do crédito) e o residual da entrada já descontado o sinal.
 */
export function resumoSinal(input: {
  valor_credito: number | null | undefined;
  valor_entrada: number | null | undefined;
}): { sinal: number | null; residualEntrada: number | null } {
  const sinal = valorSinal(input.valor_credito);
  return {
    sinal,
    residualEntrada: residualEntrada(input.valor_entrada, sinal),
  };
}
