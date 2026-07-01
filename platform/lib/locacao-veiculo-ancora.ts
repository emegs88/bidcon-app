// ============================================================================
// Locação de veículo (a carta "se paga"?) — cálculo PURO (uso INTERNO).
// ----------------------------------------------------------------------------
// USO INTERNO da equipe Prospere (PROSPERE byAncora). Estes números (locação
// líquida, cobertura da parcela, payback, resultado no prazo, custo efetivo)
// NUNCA aparecem para cliente/parceiro — vivem atrás do gate @prospere.com.br
// + RLS. Nada aqui é promessa de contemplação, de renda ou de locação garantida
// ao cliente; é ferramenta de trabalho da equipe para AVALIAR uma operação.
//
// O QUE FAZ:
//   Dada uma carta (parcela mensal e prazo) e uma LOCAÇÃO mensal estimada do
//   veículo, mostra o quanto a locação cobre a parcela e como fica a conta no
//   prazo. A equipe DIGITA a locação (com sugestões que só preenchem o campo);
//   nada é inventado pelo sistema.
//
// FÓRMULAS (todas as entradas são digitadas pela equipe — NADA é chutado):
//   locaçãoLíquida = locBruta × ocupação% − custosMês − locBruta×ocupação%×comissão%
//                    (ocupação/custos/comissão são OPCIONAIS; ausentes => neutros)
//   coberturaMensal = locaçãoLíquida − parcela         (sobra + / déficit −)
//   coberturaPct    = locaçãoLíquida / parcela         (1.0 = cobre exatamente)
//   totalPago       = parcela × prazo
//   totalLocacao    = locaçãoLíquida × prazo
//   resultadoPrazo  = totalLocacao − totalPago         (ganho/perda no prazo)
//   mesesParaQuitar = ceil(totalPago / locaçãoLíquida) (payback; null se ≤ 0)
//   custoEfetivoAm  = taxaEfetivaMensal(creditoLiquido, parcela, prazo)
//                     (mesma fórmula Price das cartas; delegada a
//                      lib/custo-efetivo) — comparação, quando há crédito líq.
//
// DECISÕES DE MODELAGEM:
//   - Locação é digitada (sugestões só preenchem; a equipe confirma/edita).
//   - Ocupação/custos/comissão são ajustes OPCIONAIS sobre a locação bruta.
//   - Campo faltante que impeça um derivado vira `null` (nunca 0 inventado).
//
// PRINCÍPIO: função pura. Entrada -> saída. Sem I/O, sem rede, sem mutação.
// ============================================================================

import { taxaEfetivaMensal } from "./custo-efetivo";

export type EntradaLocacaoVeiculo = {
  // parcela mensal da carta (R$). Sem ela, não há cobertura a calcular.
  parcela?: number | null;
  // prazo em meses da carta. Sem ele, não há totais/prazo.
  prazo?: number | null;

  // LOCAÇÃO mensal bruta estimada do veículo (R$). Digitada pela equipe.
  locacaoMensal?: number | null;

  // --- ajustes opcionais sobre a locação bruta (ausentes => neutros) ---
  ocupacaoPct?: number | null; // fração (ex.: 0.80 = 80% de ocupação)
  custosMensais?: number | null; // R$/mês (manutenção, seguro, etc.)
  comissaoPct?: number | null; // fração (ex.: 0.15 = 15% sobre a receita)

  // crédito líquido da carta (R$), p/ o custo efetivo de comparação. Opcional.
  creditoLiquido?: number | null;
};

export type ResultadoLocacaoVeiculo = {
  locacaoBruta: number | null; // locação mensal informada
  locacaoLiquida: number | null; // após ocupação/custos/comissão
  parcela: number | null;
  prazo: number | null;
  coberturaMensal: number | null; // locaçãoLíquida − parcela (sobra/déficit)
  coberturaPct: number | null; // locaçãoLíquida / parcela
  cobreParcela: boolean | null; // coberturaMensal >= 0
  totalPago: number | null; // parcela × prazo
  totalLocacao: number | null; // locaçãoLíquida × prazo
  resultadoPrazo: number | null; // totalLocacao − totalPago
  mesesParaQuitar: number | null; // ceil(totalPago / locaçãoLíquida)
  custoEfetivoAm: number | null; // % a.m. (Price) sobre o crédito líquido
  avisos: string[];
};

function centavos(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Avalia se a locação de um veículo cobre a parcela da carta e como fica a
 * conta no prazo. PURA: não lê banco, não faz rede, não muta a entrada. A
 * locação é sempre digitada pela equipe.
 */
export function calcularLocacaoVeiculo(
  e: EntradaLocacaoVeiculo
): ResultadoLocacaoVeiculo {
  const avisos: string[] = [];

  const parcela =
    e.parcela != null && e.parcela > 0 ? centavos(e.parcela) : null;
  const prazo = e.prazo != null && e.prazo > 0 ? Math.floor(e.prazo) : null;

  if (parcela == null) {
    avisos.push("Parcela não informada: cobertura da parcela não calculada.");
  }
  if (prazo == null) {
    avisos.push("Prazo (meses) não informado: totais e prazo não calculados.");
  }

  // Locação bruta.
  const locacaoBruta =
    e.locacaoMensal != null && e.locacaoMensal > 0
      ? centavos(e.locacaoMensal)
      : null;
  if (locacaoBruta == null) {
    avisos.push("Locação mensal não informada: informe o valor estimado.");
  }

  // Locação líquida = bruta × ocupação − custos − (receita × comissão).
  let locacaoLiquida: number | null = null;
  if (locacaoBruta != null) {
    const ocup = e.ocupacaoPct != null ? e.ocupacaoPct : 1;
    const receita = locacaoBruta * ocup; // receita já ajustada pela ocupação
    const comissao = e.comissaoPct != null ? receita * e.comissaoPct : 0;
    const custos = e.custosMensais != null ? e.custosMensais : 0;
    locacaoLiquida = centavos(receita - custos - comissao);
    if (locacaoLiquida < 0) {
      avisos.push(
        "Locação líquida negativa: custos/comissão superam a receita da locação."
      );
    }
  }

  // Cobertura da parcela.
  let coberturaMensal: number | null = null;
  let coberturaPct: number | null = null;
  let cobreParcela: boolean | null = null;
  if (locacaoLiquida != null && parcela != null) {
    coberturaMensal = centavos(locacaoLiquida - parcela);
    coberturaPct = parcela > 0 ? locacaoLiquida / parcela : null;
    cobreParcela = coberturaMensal >= 0;
  }

  // Totais e resultado no prazo.
  let totalPago: number | null = null;
  let totalLocacao: number | null = null;
  let resultadoPrazo: number | null = null;
  if (parcela != null && prazo != null) {
    totalPago = centavos(parcela * prazo);
  }
  if (locacaoLiquida != null && prazo != null) {
    totalLocacao = centavos(locacaoLiquida * prazo);
  }
  if (totalPago != null && totalLocacao != null) {
    resultadoPrazo = centavos(totalLocacao - totalPago);
  }

  // Payback: quantos meses de locação líquida cobrem o total pago.
  let mesesParaQuitar: number | null = null;
  if (totalPago != null && locacaoLiquida != null && locacaoLiquida > 0) {
    mesesParaQuitar = Math.ceil(totalPago / locacaoLiquida);
  }

  // Custo efetivo (% a.m.) sobre o crédito líquido, usando a parcela pelo
  // prazo. Delegado a lib/custo-efetivo (mesma fórmula das cartas). Só quando
  // há crédito líquido informado, parcela e prazo.
  let custoEfetivoAm: number | null = null;
  if (e.creditoLiquido != null && parcela != null && prazo != null) {
    custoEfetivoAm = taxaEfetivaMensal(
      centavos(e.creditoLiquido),
      parcela,
      prazo
    );
  }

  return {
    locacaoBruta,
    locacaoLiquida,
    parcela,
    prazo,
    coberturaMensal,
    coberturaPct,
    cobreParcela,
    totalPago,
    totalLocacao,
    resultadoPrazo,
    mesesParaQuitar,
    custoEfetivoAm,
    avisos,
  };
}
