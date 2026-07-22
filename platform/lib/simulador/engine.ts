// ============================================================================
// Bidcon — Simulador Conta Notarial para Parceiros (fatia SIM-PARCEIRO-01).
// ----------------------------------------------------------------------------
// Engine de cálculo puro (sem I/O, sem Supabase) — porta fiel do protótipo HTML
// já validado (`simulador-conta-notarial-bidcon.html`) para os dois objetivos:
//   (a) Aquisição direta — cliente paga a entrada via Conta Notarial;
//   (b) Levantamento de capital — um fundo parceiro paga a entrada, cliente
//       recebe o líquido em conta e assume a escala de parcelas.
//
// Valores de entrada (`entrada`, `parcela`, `custoAmEstoque`) vindos do banco
// são FINAIS — já incluem a intermediação da Bidcon. Este módulo NUNCA
// recalcula esses valores; apenas os usa como insumo para as somas de cesta
// (junção) e para o custo financeiro (TIR) da operação de Conta Notarial.
//
// Custo financeiro é sempre TIR ao mês (Newton-Raphson com fallback por
// bisseção) — nunca percentual nominal simples.
// ============================================================================

export interface CotaSim {
  id: string;
  ref: string; // "#"+numero_externo ?? id.slice(0,6)
  administradoraId: string;
  administradoraNome: string;
  credito: number; // valor_credito
  entrada: number; // valor_entrada (FINAL — nunca recalcular)
  prazo: number; // qtd_parcelas
  parcela: number; // valor_parcela
  custoAmEstoque: number | null; // bidcon_custo_am (referência, não recalculado)
  exclusiva: boolean;
}

export interface FaixaEscala {
  de: number;
  ate: number;
  valor: number;
  ativas: number;
}

/** Soma das parcelas de todas as cotas da cesta que ainda estão "ativas" no mês t
 * (prazo >= t). Parcelas de valor final (FINAL, nunca recalculadas). */
export function parcelaNoMes(cotas: CotaSim[], t: number): number {
  return cotas.reduce((s, c) => (c.prazo >= t ? s + c.parcela : s), 0);
}

/** Escala (faixas) de parcela mensal da cesta — muda de valor toda vez que uma
 * cota termina o próprio prazo e sai da soma. Base para a tabela/gráfico do
 * demonstrativo. */
export function escalaParcelas(cotas: CotaSim[]): FaixaEscala[] {
  const prazos = [...new Set(cotas.map((c) => c.prazo).filter((p) => p > 0))].sort(
    (a, b) => a - b,
  );
  const out: FaixaEscala[] = [];
  let de = 1;
  for (const p of prazos) {
    out.push({
      de,
      ate: p,
      valor: parcelaNoMes(cotas, de),
      ativas: cotas.filter((c) => c.prazo >= de).length,
    });
    de = p + 1;
  }
  return out;
}

/** Saldo devedor total da cesta = soma de (prazo × parcela) por cota — todas
 * as parcelas futuras de todas as cotas, sem desconto a valor presente. */
export function saldoDevedor(cotas: CotaSim[]): number {
  return cotas.reduce((s, c) => s + c.prazo * c.parcela, 0);
}

/**
 * Solver compartilhado de TIR mensal por fluxo de caixa: recebe `net0` (valor
 * líquido no mês 0, positivo = entrada de caixa) e paga a escala de parcelas
 * da cesta nos meses 1..N. Newton-Raphson com fallback por bisseção quando a
 * derivada degenera ou diverge. Retorna `null` quando não há solução (mês 0
 * não-positivo ou cesta sem prazo).
 *
 * Reaproveitado tanto pela aquisição direta (`tirMensal`, net0 = poder de
 * compra − desembolso inicial) quanto pelo levantamento de capital
 * (`tirCliente`, net0 = líquido recebido pelo cliente).
 */
export function tirComNet0(cotas: CotaSim[], net0: number): number | null {
  const maxP = Math.max(0, ...cotas.map((c) => c.prazo));
  if (net0 <= 0 || maxP === 0) return null;

  const npv = (i: number) => {
    let s = net0;
    for (let t = 1; t <= maxP; t++) s -= parcelaNoMes(cotas, t) / Math.pow(1 + i, t);
    return s;
  };
  const dnpv = (i: number) => {
    let s = 0;
    for (let t = 1; t <= maxP; t++) s += (t * parcelaNoMes(cotas, t)) / Math.pow(1 + i, t + 1);
    return s;
  };

  let i = 0.01;
  for (let k = 0; k < 80; k++) {
    const f = npv(i);
    const d = dnpv(i);
    if (!Number.isFinite(f) || !Number.isFinite(d) || d === 0) break;
    let ni = i - f / d;
    if (ni <= -0.99) ni = (i - 0.99) / 2;
    if (Math.abs(ni - i) < 1e-10) return ni;
    i = ni;
  }

  // fallback: bisseção
  let lo = 1e-6;
  let hi = 1.0;
  if (npv(lo) < 0) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (npv(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * TIR mensal do modo aquisição direta. Fluxo: mês 0 = poder de compra
 * (Σ crédito) − desembolso inicial (entrada total + taxa de transferência);
 * meses 1..N = −parcelaNoMes(t).
 */
export function tirMensal(cotas: CotaSim[], desembolsoInicial: number): number | null {
  const poderCompra = cotas.reduce((s, c) => s + c.credito, 0);
  const net0 = poderCompra - desembolsoInicial;
  return tirComNet0(cotas, net0);
}

/** Converte taxa mensal (fração) pra taxa anual equivalente (fração) via
 * juros compostos: (1+i)^12 - 1. Nunca usar percentual nominal simples. */
export function anualEquivalente(iMensal: number): number {
  return Math.pow(1 + iMensal, 12) - 1;
}

// ============================================================================
// MODO LEVANTAMENTO DE CAPITAL — fundo parceiro paga a entrada; cliente
// recebe o líquido em conta e assume a escala de parcelas, com o TIR do
// CLIENTE calculado sobre o líquido recebido (não sobre o desembolso do
// fundo).
// ============================================================================

export interface ParamsFundo {
  fundoPct: number; // remuneração do fundo, % sobre a entrada financiada
  ccb: number; // estruturação/emissão de CCB, R$ fixo
  iofPct: number; // IOF, % sobre a entrada financiada
  taxaNoLiquido: boolean; // deduzir a taxa de transferência do líquido?
}

export function custosFundo(
  entrada: number,
  p: ParamsFundo,
): { iof: number; ccb: number; rem: number; total: number } {
  const iof = (entrada * p.iofPct) / 100;
  const rem = (entrada * p.fundoPct) / 100;
  return { iof, ccb: p.ccb, rem, total: iof + p.ccb + rem };
}

/** Crédito líquido que o cliente recebe em conta no levantamento de capital:
 * crédito total − entrada (paga pelo fundo) − custos do fundo (IOF + CCB +
 * remuneração) [− taxa de transferência, se `taxaNoLiquido`]. */
export function liquidoCliente(
  cotas: CotaSim[],
  entrada: number,
  taxa: number,
  p: ParamsFundo,
): number {
  const credito = cotas.reduce((s, c) => s + c.credito, 0);
  let l = credito - entrada - custosFundo(entrada, p).total;
  if (p.taxaNoLiquido) l -= taxa;
  return l;
}

/** TIR do CLIENTE no levantamento de capital: recebe o líquido no mês 0,
 * paga a escala de parcelas da cesta nos meses seguintes. */
export function tirCliente(
  cotas: CotaSim[],
  entrada: number,
  taxa: number,
  p: ParamsFundo,
): number | null {
  const net0 = liquidoCliente(cotas, entrada, taxa, p);
  return tirComNet0(cotas, net0);
}
