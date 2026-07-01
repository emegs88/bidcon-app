// ============================================================================
// FIDC (funding da operação) — cálculo PURO (uso INTERNO).
// ----------------------------------------------------------------------------
// USO INTERNO da equipe Prospere (PROSPERE byAncora). "FIDC" é termo de gestão
// e NUNCA aparece para cliente/parceiro — este cálculo (crédito, entrada
// fundeada, custos do fundo, crédito líquido) vive atrás do gate
// @prospere.com.br + RLS. Nada aqui é promessa de contemplação nem oferta ao
// cliente; é ferramenta de trabalho da equipe.
//
// O QUE É (conferido no print de referência da operação):
//   O fundo banca a ENTRADA de uma operação (crédito × entrada%). Sobre essa
//   entrada incidem custos NOMEADOS, e o cliente recebe o CRÉDITO LÍQUIDO —
//   o que sobra do saldo (crédito − entrada) depois de descontados os custos
//   do fundo que NÃO foram dispensados.
//
// FÓRMULAS (todas as taxas/valores são digitados pela equipe — NADA inventado):
//   entrada        = entradaRs  OU  crédito × entradaPct     (R$ prioridade)
//   saldoBruto     = crédito − entrada
//   IOF            = entrada × iofPct                         (custo, % entrada)
//   jurosFundo     = entrada × jurosPct                       (custo, % entrada)
//   emissaoCcb     = R$ fixo                                  (custo)
//   taxaTransf     = R$ fixo (pode ser DISPENSADA)            (custo)
//   custosDoFundo  = Σ custos NÃO dispensados
//   creditoLiquido = saldoBruto − custosDoFundo
//   custoEfetivoAm = taxaEfetivaMensal(creditoLiquido, parcelaMedia, prazoMedio)
//                    (mesma fórmula Price das cartas; delegada a
//                     lib/custo-efetivo) — só quando há parcela/prazo médios.
//
// REFERÊNCIA (print da operação, conferido nos totais):
//   crédito 799.049, entrada 367.563 (46%), prazo médio 179, parcela média
//   5.346, IOF 3.528,60 (0,96%), emissão CCB 15.000, taxa transf. 11.157
//   (DISPENSADA no print), juros do fundo 40.432 (11%), crédito líquido
//   372.525,40 = (799.049 − 367.563) − 40.432 − 3.528,60 − 15.000.  ✓
//   Rodapé do print: "Custos calculados para operação em 60 dias" — o prazo do
//   funding é um dado de contexto (prazoDias), não entra na aritmética acima;
//   as taxas digitadas já são as do período.
//
// DECISÕES DE MODELAGEM (confirmadas no print):
//   - Base dos custos %: a ENTRADA (não o crédito cheio).
//   - IOF e Juros do fundo: % da entrada. Emissão CCB e Taxa de transf.: R$.
//   - Taxa de transferência pode ser DISPENSADA (flag) — quando dispensada não
//     entra no custo nem reduz o crédito líquido (é o caso do print).
//   - Campo faltante que impeça um derivado vira `null` (nunca 0 inventado).
//
// PRINCÍPIO: função pura. Entrada -> saída. Sem I/O, sem rede, sem mutação.
// ============================================================================

import { taxaEfetivaMensal } from "./custo-efetivo";

export type EntradaFidc = {
  // crédito total da operação (valor do bem/carta que puxa o funding).
  credito: number;

  // ENTRADA que o fundo banca. Informe R$ OU % do crédito (R$ prioridade).
  entradaRs?: number | null;
  entradaPct?: number | null; // fração (ex.: 0.46 = 46%)

  // custos do fundo — percentuais incidem sobre a ENTRADA:
  iofPct?: number | null; // fração (ex.: 0.0096 = 0,96%)
  jurosPct?: number | null; // fração (ex.: 0.11 = 11%)
  // custos do fundo — valores fixos em R$:
  emissaoCcbRs?: number | null;
  taxaTransfRs?: number | null;
  // quando true, a taxa de transferência é dispensada (não entra no custo).
  taxaTransfDispensada?: boolean | null;

  // contexto do funding (rodapé "operação em X dias"). Só rótulo; não entra na
  // aritmética — as taxas digitadas já são as do período.
  prazoDias?: number | null;

  // médias da carteira p/ o custo efetivo (opcionais). Sem elas, custoEfetivo
  // fica null.
  prazoMedio?: number | null; // em meses
  parcelaMedia?: number | null; // R$/mês
};

export type ResultadoFidc = {
  credito: number;
  entrada: number; // entrada fundeada (informada ou % do crédito)
  saldoBruto: number; // crédito − entrada
  iof: number; // entrada × iofPct
  jurosFundo: number; // entrada × jurosPct
  emissaoCcb: number; // R$ fixo
  taxaTransf: number; // R$ fixo (0 quando dispensada)
  taxaTransfDispensada: boolean;
  custosDoFundo: number; // Σ custos NÃO dispensados
  creditoLiquido: number; // saldoBruto − custosDoFundo
  custoEfetivoAm: number | null; // % a.m. (Price) sobre o crédito líquido
  avisos: string[];
};

function centavos(n: number): number {
  return Math.round(n * 100) / 100;
}

// Resolve "R$ ou % da base": R$ prioridade; senão fração × base; senão null.
function rsOuPct(
  base: number,
  rs: number | null | undefined,
  pct: number | null | undefined
): number | null {
  if (rs != null) return centavos(rs);
  if (pct != null) return centavos(base * pct);
  return null;
}

/**
 * Calcula o funding FIDC de uma operação a partir do crédito e da entrada
 * fundeada. PURA: não lê banco, não faz rede, não muta a entrada. Taxas/valores
 * são sempre digitados pela equipe.
 */
export function calcularFidc(e: EntradaFidc): ResultadoFidc {
  const avisos: string[] = [];

  const credito = centavos(e.credito ?? 0);
  if (credito <= 0) {
    avisos.push("Sem crédito: informe o crédito total da operação.");
  }

  // Entrada fundeada = R$ informado OU % do crédito.
  const entradaResolvida = rsOuPct(credito, e.entradaRs, e.entradaPct);
  if (entradaResolvida == null) {
    avisos.push("Entrada não informada: informe o valor (R$) ou o % da entrada.");
  }
  const entrada = entradaResolvida ?? 0;

  const saldoBruto = centavos(credito - entrada);

  // Custos percentuais incidem sobre a ENTRADA.
  const iof = e.iofPct != null ? centavos(entrada * e.iofPct) : 0;
  const jurosFundo = e.jurosPct != null ? centavos(entrada * e.jurosPct) : 0;

  // Custos fixos em R$.
  const emissaoCcb = e.emissaoCcbRs != null ? centavos(e.emissaoCcbRs) : 0;
  const taxaTransfDispensada = e.taxaTransfDispensada === true;
  const taxaTransfInformada =
    e.taxaTransfRs != null ? centavos(e.taxaTransfRs) : 0;
  // Dispensada => não entra no custo (valor "ativo" vira 0).
  const taxaTransf = taxaTransfDispensada ? 0 : taxaTransfInformada;

  const custosDoFundo = centavos(iof + jurosFundo + emissaoCcb + taxaTransf);
  const creditoLiquido = centavos(saldoBruto - custosDoFundo);

  if (creditoLiquido < 0 && credito > 0) {
    avisos.push(
      "Crédito líquido negativo: os custos do fundo superam o saldo (crédito − entrada)."
    );
  }

  // Custo efetivo (% a.m.) sobre o crédito líquido, usando a parcela e o prazo
  // médios da carteira. Delegado a lib/custo-efetivo (mesma fórmula das cartas).
  // Retorna null quando não há médias (ou quando parcela×prazo ≤ líquido).
  let custoEfetivoAm: number | null = null;
  if (e.parcelaMedia != null && e.prazoMedio != null && creditoLiquido > 0) {
    custoEfetivoAm = taxaEfetivaMensal(
      creditoLiquido,
      e.parcelaMedia,
      e.prazoMedio
    );
  }

  return {
    credito,
    entrada,
    saldoBruto,
    iof,
    jurosFundo,
    emissaoCcb,
    taxaTransf,
    taxaTransfDispensada,
    custosDoFundo,
    creditoLiquido,
    custoEfetivoAm,
    avisos,
  };
}
