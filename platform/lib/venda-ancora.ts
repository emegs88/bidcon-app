// ============================================================================
// Venda Âncora — cálculo PURO da venda da carta pós-contemplação (uso INTERNO).
// ----------------------------------------------------------------------------
// USO INTERNO da equipe Prospere (PROSPERE byAncora). Estes números (crédito
// líquido, venda do crédito, lucro nominal, lucro a valor presente) NUNCA
// aparecem para cliente/parceiro — vivem atrás do gate @prospere.com.br + RLS.
// Compliance: nada aqui é promessa de contemplação nem oferta ao cliente; é
// ferramenta de trabalho da equipe.
//
// FONTE DAS FÓRMULAS ("Fluxo Banco de Cotas" abas Lance fixo / Lance limitado):
//   Comum às duas modalidades:
//     saldo devedor      = crédito × (1 + taxa administração)          [se não informado]
//     crédito líquido     = crédito − abate do lance
//     venda do crédito    = crédito líquido × %venda        (metade nas planilhas)
//     lucro nominal       = venda do crédito − parcelas já pagas
//     lucro a valor pres. = venda descontada por juro-alvo ao mês (1.1% nas planilhas)
//   Diferença entre modalidades (o que "abate" do crédito):
//     fixo     → lance embutido = crédito × embutido%   (abate do próprio crédito)
//     limitado → lance limitado = saldo devedor × limite% (abate do saldo)
//
//   Na aba fixo (linha 3): crédito 100000, embutido 24800 (24,8%), saldo 124000,
//   crédito líquido 75200, venda 37600 (=75200×0,5), lucro nominal 37263,64
//   (=37600 − 336,36 de 1 parcela paga), parcela comprador 452,97 (PRA corrigida).
//   Na aba limitado (linha 3): lance limitado 49600 (=124000×0,40), crédito
//   líquido 50400, venda 25200 (=50400×0,5), parcela comprador 339,73.
//
// PRINCÍPIO: função pura. Entrada -> saída. Sem I/O, sem rede, sem mutação.
// Campo faltante que impeça um derivado vira `null` (nunca 0 inventado).
// ============================================================================

// A venda pós-contemplação parte do abate obtido no lance. "fixo" embute % do
// crédito; "limitado" aplica % sobre o saldo devedor do grupo.
export type ModalidadeVenda = "fixo" | "limitado";

export type EntradaVenda = {
  // crédito-base do bem (valor da carta) antes de qualquer reajuste.
  credito: number;

  // reajuste opcional do crédito por índice (INCC/IPCA) — fração acumulada.
  // Ex.: 0.05 = +5%. Aplicado ANTES do abate. Ausente => sem reajuste.
  reajusteAcumulado?: number | null;

  // taxa de administração do grupo (fração). Usada só para estimar o saldo
  // devedor quando ele não é informado. Ex.: 0.24.
  taxaAdministracao?: number | null;
  // saldo devedor atual do grupo (R$). Se informado, tem prioridade sobre a
  // estimativa por taxa de administração.
  saldoDevedor?: number | null;

  // modalidade e percentual do abate (frações). Config manual por grupo.
  modalidade: ModalidadeVenda;
  // fixo: % embutido sobre o crédito (ex.: 0.248). limitado: % sobre o saldo (ex.: 0.40).
  abatePct?: number | null;

  // %venda da carta líquida (fração). Ex.: 0.30 (Bidcon direto) ou 0.50 (planilha).
  vendaPct?: number | null;

  // parcelas já pagas até a contemplação (R$ somados) — para o lucro nominal.
  parcelasPagasRs?: number | null;
  // parcela mensal repassada ao comprador da carta (R$). Só exibida, não deriva nada.
  parcelaComprador?: number | null;

  // juro-alvo ao mês para trazer a venda a valor presente (fração). Ex.: 0.011.
  // meses até liquidar a venda. Sem os dois => lucro a valor presente = null.
  juroMes?: number | null;
  mesesAteVenda?: number | null;
};

export type ResultadoVenda = {
  creditoReajustado: number;   // crédito após INCC/IPCA (igual se sem reajuste)
  saldoDevedor: number | null; // informado ou estimado por taxa adm.
  abateRs: number;             // R$ abatido no lance (embutido ou limitado)
  creditoLiquido: number;      // crédito − abate
  vendaRs: number;             // crédito líquido × %venda
  vendaPct: number;            // %venda aplicado (fração)
  lucroNominal: number | null; // venda − parcelas pagas (null se parcelas não informadas)
  lucroPresente: number | null;// venda trazida a valor presente (null se juro/meses ausentes)
  parcelaComprador: number | null; // repasse ao comprador (informado; null se ausente)
  avisos: string[];
};

function centavos(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Calcula a venda da carta pós-contemplação a partir dos parâmetros informados
 * pela equipe. PURA: não lê banco, não faz rede, não muta a entrada.
 */
export function calcularVenda(e: EntradaVenda): ResultadoVenda {
  const avisos: string[] = [];

  // 1) crédito reajustado por índice (INCC/IPCA), se informado.
  const fatorReajuste = 1 + (e.reajusteAcumulado ?? 0);
  const creditoReajustado = centavos(e.credito * fatorReajuste);

  // 2) saldo devedor: informado tem prioridade; senão estima por taxa adm.
  let saldoDevedor: number | null = null;
  if (e.saldoDevedor != null) {
    saldoDevedor = centavos(e.saldoDevedor);
  } else if (e.taxaAdministracao != null) {
    saldoDevedor = centavos(creditoReajustado * (1 + e.taxaAdministracao));
  }

  // 3) abate do lance conforme a modalidade.
  //    fixo     → % sobre o crédito reajustado
  //    limitado → % sobre o saldo devedor (precisa do saldo)
  const abatePct = e.abatePct ?? 0;
  let abateRs = 0;
  if (e.modalidade === "fixo") {
    abateRs = centavos(creditoReajustado * abatePct);
  } else {
    if (saldoDevedor == null) {
      avisos.push(
        "Lance limitado sem saldo devedor: informe o saldo (ou a taxa adm. para estimar)."
      );
    } else {
      abateRs = centavos(saldoDevedor * abatePct);
    }
  }

  // 4) crédito líquido = crédito reajustado − abate do lance.
  const creditoLiquido = centavos(creditoReajustado - abateRs);

  // 5) venda do crédito líquido pelo %venda (0,30 Bidcon direto, 0,50 planilha).
  const vendaPct = e.vendaPct ?? 0;
  const vendaRs = centavos(creditoLiquido * vendaPct);

  // 6) lucro nominal = venda − parcelas já pagas (null se não informadas).
  const lucroNominal =
    e.parcelasPagasRs != null
      ? centavos(vendaRs - e.parcelasPagasRs)
      : null;

  // 7) lucro a valor presente: desconta a venda pelo juro-alvo ao mês.
  //    Precisa de juro E meses; senão fica null (não inventamos taxa).
  let lucroPresente: number | null = null;
  if (e.juroMes != null && e.mesesAteVenda != null && e.mesesAteVenda >= 0) {
    const fator = Math.pow(1 + e.juroMes, e.mesesAteVenda);
    const vendaPresente = fator > 0 ? vendaRs / fator : vendaRs;
    lucroPresente =
      e.parcelasPagasRs != null
        ? centavos(vendaPresente - e.parcelasPagasRs)
        : centavos(vendaPresente);
  }

  return {
    creditoReajustado,
    saldoDevedor,
    abateRs,
    creditoLiquido,
    vendaRs,
    vendaPct,
    lucroNominal,
    lucroPresente,
    parcelaComprador: e.parcelaComprador ?? null,
    avisos,
  };
}

export const LABEL_MODALIDADE_VENDA: Record<ModalidadeVenda, string> = {
  fixo: "Lance fixo (embute % do crédito)",
  limitado: "Lance limitado (% sobre o saldo)",
};
