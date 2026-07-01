// ============================================================================
// Compra da carta — cálculo PURO do crédito líquido da operação (uso INTERNO).
// ----------------------------------------------------------------------------
// USO INTERNO da equipe Prospere (PROSPERE byAncora). Estes números (entrada,
// IOF, emissão de CCB, juros do fundo, crédito líquido) NUNCA aparecem para
// cliente/parceiro — vivem atrás do gate @prospere.com.br + RLS. Compliance:
// nada aqui é promessa de contemplação nem oferta ao cliente; é ferramenta de
// trabalho da equipe.
//
// FONTE DAS FÓRMULAS (prints de referência "Custos para operação em N dias",
// confirmados batendo ao centavo nos dois exemplos):
//
//   crédito líquido = crédito − entrada − IOF − emissão CCB − juros do fundo
//
//   Exemplo A (30 dias):
//     crédito 1.198.365, entrada 551.248 (46%), IOF 5.291,98 (0,96%),
//     CCB 15.000, taxa de transf. ISENTA (riscada no print), juros do fundo
//     60.638 (11%)  →  crédito líquido 566.187,02  ✓
//   Exemplo B (60 dias):
//     crédito 799.049, entrada 367.563 (46%), IOF 3.528,60, CCB 15.000,
//     taxa de transf. ISENTA, juros do fundo 40.432 (11%)
//     →  crédito líquido 372.525,40  ✓
//
// DECISÕES (config manual por grupo, decisão B):
//   - taxa de transferência: ISENTA por padrão (riscada nos prints). Campo
//     manual opcional caso um grupo cobre.
//   - entrada, IOF, juros do fundo: podem ser informados em R$ (prioridade) OU
//     estimados por % sobre o crédito (entrada% ~46, IOF% ~0,96, fundo% ~11).
//   - emissão de CCB: valor fixo em R$ (15.000 nos prints), informado.
//   Campo faltante que impeça um derivado vira `null` (nunca 0 inventado).
//
// PRINCÍPIO: função pura. Entrada -> saída. Sem I/O, sem rede, sem mutação.
// ============================================================================

export type EntradaCompra = {
  // crédito-base do bem (valor da carta).
  credito: number;

  // ENTRADA (valor já amortizado que se paga à vista). Informe em R$ OU em %.
  // R$ tem prioridade sobre o %.
  entradaRs?: number | null;
  entradaPct?: number | null; // fração (ex.: 0.46)

  // IOF da operação. Informe em R$ OU em % sobre o crédito. R$ tem prioridade.
  iofRs?: number | null;
  iofPct?: number | null; // fração (ex.: 0.0096)

  // Emissão de CCB (valor fixo em R$; 15.000 nos prints).
  emissaoCcbRs?: number | null;

  // Taxa de transferência (R$). ISENTA por padrão (null/0). Só preenche se o
  // grupo cobrar.
  taxaTransferenciaRs?: number | null;

  // Juros do fundo. Informe em R$ OU em % sobre o crédito. R$ tem prioridade.
  jurosFundoRs?: number | null;
  jurosFundoPct?: number | null; // fração (ex.: 0.11)

  // parcela e prazo do comprador (para o custo efetivo, mesma fórmula das
  // cartas). Opcionais: sem eles, o custo efetivo sai null.
  parcela?: number | null;
  prazo?: number | null; // meses
};

export type ResultadoCompra = {
  entradaRs: number;        // entrada aplicada (informada ou estimada)
  iofRs: number;            // IOF aplicado (informado ou estimado)
  emissaoCcbRs: number;     // emissão de CCB
  taxaTransferenciaRs: number; // 0 quando isenta
  jurosFundoRs: number;     // juros do fundo (informado ou estimado)
  custosTotais: number;     // IOF + CCB + transf. + juros do fundo
  creditoLiquido: number;   // crédito − entrada − custos
  avisos: string[];
};

function centavos(n: number): number {
  return Math.round(n * 100) / 100;
}

// Resolve um valor "R$ ou % do crédito": R$ tem prioridade; senão aplica a
// fração sobre o crédito; senão null.
function rsOuPct(
  credito: number,
  rs: number | null | undefined,
  pct: number | null | undefined
): number | null {
  if (rs != null) return centavos(rs);
  if (pct != null) return centavos(credito * pct);
  return null;
}

/**
 * Calcula o crédito líquido da compra da carta a partir dos parâmetros da
 * operação. PURA: não lê banco, não faz rede, não muta a entrada.
 */
export function calcularCompra(e: EntradaCompra): ResultadoCompra {
  const avisos: string[] = [];
  const credito = e.credito;

  const entradaRs = rsOuPct(credito, e.entradaRs, e.entradaPct);
  if (entradaRs == null) {
    avisos.push("Entrada não informada: informe o valor (R$) ou o % da entrada.");
  }

  const iofRs = rsOuPct(credito, e.iofRs, e.iofPct);
  const jurosFundoRs = rsOuPct(credito, e.jurosFundoRs, e.jurosFundoPct);
  const emissaoCcbRs = e.emissaoCcbRs != null ? centavos(e.emissaoCcbRs) : 0;
  const taxaTransferenciaRs =
    e.taxaTransferenciaRs != null ? centavos(e.taxaTransferenciaRs) : 0;

  const custosTotais = centavos(
    (iofRs ?? 0) + emissaoCcbRs + taxaTransferenciaRs + (jurosFundoRs ?? 0)
  );

  const creditoLiquido = centavos(credito - (entradaRs ?? 0) - custosTotais);

  return {
    entradaRs: entradaRs ?? 0,
    iofRs: iofRs ?? 0,
    emissaoCcbRs,
    taxaTransferenciaRs,
    jurosFundoRs: jurosFundoRs ?? 0,
    custosTotais,
    creditoLiquido,
    avisos,
  };
}
