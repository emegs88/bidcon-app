// ============================================================================
// Financiamento bancário (SAC e Price) — para comparar com consórcio usando a
// MESMA métrica de custo.
//
// Por que existe: a objeção nº 1 do cliente é "no banco eu levo o bem hoje".
// Responder isso exige número, não retórica — e número comparável: o custo
// efetivo mensal aqui sai do MESMO motor de TIR (lib/tir.ts) que roda no
// consórcio. Comparar TIR de um lado com taxa nominal do outro seria trapaça
// aritmética.
//
// A taxa NUNCA tem default nesta lib. Ela vem da proposta bancária que o
// cliente tem na mão — inventar uma taxa de referência seria inventar a
// premissa central da comparação.
//
// Lib pura: sem rede, sem React, sem estado.
// ============================================================================
import { tirMensal } from "@/lib/tir";

export type SistemaAmortizacao = "sac" | "price";
export type UnidadeTaxa = "am" | "aa";

export type ParcelaFinanciamento = {
  n: number;
  valor: number;
  juros: number;
  amortizacao: number;
  saldoDevedor: number;
};

export type ResultadoFinanciamento = {
  sistema: SistemaAmortizacao;
  valorBem: number;
  entrada: number;
  financiado: number;
  /** Taxa mensal efetiva usada no cálculo (fração, ex.: 0.01 = 1% a.m.). */
  taxaMensal: number;
  prazo: number;
  primeiraParcela: number;
  ultimaParcela: number;
  /** Entrada + soma de todas as parcelas. */
  totalPago: number;
  /** Quanto se paga além do valor do bem. */
  custoAlemDoBem: number;
  custoAlemDoBemPct: number;
  /** Custo efetivo ao mês pelo mesmo motor do consórcio. Em Price e SAC sem
   *  tarifas, tem de devolver a própria taxa contratada — é o teste que prova
   *  que o fluxo está montado certo. `null` quando não fecha numa taxa única. */
  tirMes: number | null;
  parcelas: ParcelaFinanciamento[];
};

/** Converte a taxa informada para mensal efetiva. Ao ano → juros compostos
 *  ((1+i)^(1/12) − 1), nunca divisão por 12. */
export function paraTaxaMensal(valorPct: number, unidade: UnidadeTaxa): number {
  const i = valorPct / 100;
  return unidade === "am" ? i : Math.pow(1 + i, 1 / 12) - 1;
}

/** Prestação da Tabela Price. Taxa zero cai na divisão simples. */
export function pricePagamento(pv: number, i: number, n: number): number {
  if (n <= 0) return 0;
  if (i === 0) return pv / n;
  return (pv * i) / (1 - Math.pow(1 + i, -n));
}

export function simularFinanciamento(params: {
  valorBem: number;
  /** % do valor do bem pago como entrada (0 a 100). */
  entradaPct: number;
  taxa: number;
  unidade: UnidadeTaxa;
  prazo: number;
  sistema: SistemaAmortizacao;
}): ResultadoFinanciamento | null {
  const { valorBem, entradaPct, taxa, unidade, prazo, sistema } = params;
  const n = Math.round(prazo);
  if (!(valorBem > 0) || n < 1 || !Number.isFinite(taxa) || taxa < 0) return null;

  const entrada = valorBem * Math.min(100, Math.max(0, entradaPct)) / 100;
  const financiado = valorBem - entrada;
  if (financiado <= 0) return null;

  const i = paraTaxaMensal(taxa, unidade);
  const parcelas: ParcelaFinanciamento[] = [];

  if (sistema === "price") {
    const p = pricePagamento(financiado, i, n);
    let saldo = financiado;
    for (let k = 1; k <= n; k++) {
      const juros = saldo * i;
      const amort = p - juros;
      saldo = Math.max(0, saldo - amort);
      parcelas.push({ n: k, valor: p, juros, amortizacao: amort, saldoDevedor: saldo });
    }
  } else {
    const amort = financiado / n;
    let saldo = financiado;
    for (let k = 1; k <= n; k++) {
      const juros = saldo * i;
      saldo = Math.max(0, saldo - amort);
      parcelas.push({ n: k, valor: amort + juros, juros, amortizacao: amort, saldoDevedor: saldo });
    }
  }

  const somaParcelas = parcelas.reduce((s, p) => s + p.valor, 0);
  const totalPago = entrada + somaParcelas;

  // Fluxo do ponto de vista do cliente: em t=0 ele recebe o bem e paga a
  // entrada (líquido = valor financiado); depois só paga parcelas. Uma única
  // troca de sinal — tirMensal (bisseção) resolve direto.
  const fluxo = [financiado, ...parcelas.map((p) => -p.valor)];
  const tir = tirMensal(fluxo);

  return {
    sistema,
    valorBem,
    entrada,
    financiado,
    taxaMensal: i,
    prazo: n,
    primeiraParcela: parcelas[0]?.valor ?? 0,
    ultimaParcela: parcelas[parcelas.length - 1]?.valor ?? 0,
    totalPago,
    custoAlemDoBem: totalPago - valorBem,
    custoAlemDoBemPct: ((totalPago - valorBem) / valorBem) * 100,
    tirMes: tir,
    parcelas,
  };
}
