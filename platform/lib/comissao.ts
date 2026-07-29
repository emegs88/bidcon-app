// ============================================================================
// Grade de comissão da Prospere — seleção e cálculo, puros e testáveis.
//
// Existe como lib separada porque a regra crítica não é aritmética, é de
// ACESSO: a grade servida tem de ser SEMPRE a da administradora pedida.
// Nunca a de outra. Emprestar a grade da Porto para mostrar um número na tela
// da Disal seria inventar receita — e o erro seria silencioso, porque o
// número pareceria plausível.
//
// Estar cadastrada NÃO é o mesmo que ter grade. Uma administradora recém
// cadastrada, sem grade, tem de produzir exatamente o mesmo resultado de uma
// administradora inexistente: nada. É o caso da Disal (id 2, cadastrada em
// 28/07/2026, zero grades).
//
// Comissão é RECEITA da Prospere, paga pela administradora — nunca custo do
// cliente. Não entra em nenhum fluxo de TIR.
// ============================================================================

export type GradeComissao = {
  administradora_id: number | null;
  segmento: string;
  parcelamento_adesao: string;
  pct_total: number | string | null;
  cronograma: number[] | null;
  vigencia_inicio?: string | null;
  vigencia_fim?: string | null;
  observacao: string | null;
};

export type ComissaoProspere = {
  pctTotal: number;
  totalRS: number;
  cronogramaRS: number[];
  parcelas: number;
  observacao: string | null;
};

const cent = (v: number) => Math.round(v * 100) / 100;

/**
 * Grades da administradora PEDIDA, vigentes na data informada.
 *
 * `administradoraId` null (administradora não cadastrada) devolve lista
 * vazia — nunca "todas". Um filtro que degrada para "sem filtro" quando a
 * chave falta é exatamente como grade de terceiro vaza para a tela.
 */
export function gradesVigentesDaAdministradora(
  grades: GradeComissao[],
  administradoraId: number | null,
  hoje: string,
): GradeComissao[] {
  if (administradoraId == null) return [];
  return grades.filter(
    (g) =>
      g.administradora_id === administradoraId &&
      (g.vigencia_inicio == null || g.vigencia_inicio <= hoje) &&
      (g.vigencia_fim == null || g.vigencia_fim >= hoje),
  );
}

/**
 * Grade do segmento dentro de uma lista JÁ filtrada por administradora.
 * Imóvel casa o parcelamento da adesão ("qualquer" → "a_vista"); auto e
 * pesados têm grade única gravada como "qualquer".
 */
export function gradeDoSegmento(
  grades: GradeComissao[],
  segmento: string,
  parcelamentoAdesao: string = "qualquer",
): GradeComissao | null {
  if (grades.length === 0) return null;
  const parcelamento =
    segmento === "imovel" ? (parcelamentoAdesao === "qualquer" ? "a_vista" : parcelamentoAdesao) : "qualquer";
  return grades.find((g) => g.segmento === segmento && g.parcelamento_adesao === parcelamento) ?? null;
}

/** Cálculo. `null` sempre que não houver grade ou pct utilizável — nunca
 *  zero no lugar de ausência: zero é um valor, ausência é a verdade. */
export function calcularComissao(grade: GradeComissao | null, credito: number): ComissaoProspere | null {
  if (!grade) return null;
  const pctTotal = Number(grade.pct_total);
  if (!Number.isFinite(pctTotal)) return null;
  const totalRS = (credito * pctTotal) / 100;
  const pesos = (grade.cronograma ?? []).map(Number).filter((n) => Number.isFinite(n));
  const cronograma = pesos.length ? pesos : [1];
  return {
    pctTotal,
    totalRS: cent(totalRS),
    cronogramaRS: cronograma.map((p) => cent(totalRS * p)),
    parcelas: cronograma.length,
    observacao: grade.observacao ?? null,
  };
}
