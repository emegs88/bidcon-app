// ============================================================================
// Custo efetivo mensal de uma carta — MESMA fórmula já usada no site estático
// (public/*.html → `taxaEfetiva`). Aritmética pura sobre dados públicos do bem
// (crédito, entrada, parcela, prazo). NÃO usa administradora/taxa/fundo.
// ----------------------------------------------------------------------------
// Resolve, por bisseção, a taxa mensal `i` que iguala o valor presente das
// parcelas (Price) ao saldo financiado (crédito − entrada). Resultado em % a.m.
//
//   saldo = max(0, crédito − entrada)
//   VP(i) = parcela · (1 − (1+i)^−prazo) / i      (com VP(0) = parcela · prazo)
//   acha i tal que VP(i) = saldo  →  retorna i · 100  (% ao mês)
//
// Retorna null quando não há custo a exibir (dados ausentes, ou parcela·prazo
// ≤ saldo: paga-se ≤ que se recebe). Rótulo na UI é neutro ("custo efetivo
// ~X%/mês") — nunca "juros"/"CET"/"taxa de financiamento".
// ============================================================================

/** Taxa mensal efetiva (% a.m.) p/ saldo financiado em `prazo` parcelas. */
export function taxaEfetivaMensal(
  saldo: number,
  parcela: number,
  prazo: number
): number | null {
  if (!(saldo > 0) || !(parcela > 0) || !(prazo > 0)) return null;
  if (parcela * prazo <= saldo) return null; // paga ≤ que recebe: sem custo

  const vp = (i: number): number =>
    i === 0 ? parcela * prazo : (parcela * (1 - Math.pow(1 + i, -prazo))) / i;

  let lo = 1e-9;
  let hi = 1; // satura em 100%/mês
  if (vp(hi) > saldo) return 100 * hi;

  for (let k = 0; k < 200; k++) {
    const m = (lo + hi) / 2;
    const val = vp(m);
    if (Math.abs(val - saldo) < 1e-6) return 100 * m;
    if (val > saldo) lo = m;
    else hi = m;
  }
  return ((lo + hi) / 2) * 100;
}

/**
 * Custo efetivo de uma carta a partir dos campos públicos. Saldo = crédito −
 * entrada. Retorna null se faltar parcela/prazo (não dá pra estimar).
 */
export function custoEfetivoCarta(carta: {
  valor_credito: number;
  valor_entrada: number | null;
  valor_parcela: number | null;
  qtd_parcelas: number | null;
}): number | null {
  const { valor_credito, valor_entrada, valor_parcela, qtd_parcelas } = carta;
  if (valor_parcela == null || qtd_parcelas == null) return null;
  const saldo = Math.max(0, valor_credito - (valor_entrada ?? 0));
  return taxaEfetivaMensal(saldo, valor_parcela, qtd_parcelas);
}

/**
 * Custo efetivo de uma JUNÇÃO de cartas (mesmo segmento). Cartas com prazos
 * diferentes NÃO têm um custo conjunto bem-definido pela fórmula Price (o fluxo
 * de parcelas não é constante); então usamos a MÉDIA das taxas individuais
 * PONDERADA pelo saldo financiado de cada carta:
 *
 *   taxa_junção = Σ(taxa_i · saldo_i) / Σ(saldo_i)
 *
 * Só entram na média as cartas com custo calculável (parcela + prazo). Retorna
 * null quando nenhuma carta da seleção tem custo a exibir. NUNCA somamos a
 * parcela de todas com o prazo de uma só (isso subestimaria a taxa).
 */
export function custoEfetivoJuncao(
  cartas: {
    valor_credito: number;
    valor_entrada: number | null;
    valor_parcela: number | null;
    qtd_parcelas: number | null;
  }[]
): number | null {
  let somaPeso = 0;
  let somaPonderada = 0;
  for (const c of cartas) {
    const taxa = custoEfetivoCarta(c);
    if (taxa == null) continue; // sem custo calculável: fica de fora da média
    const saldo = Math.max(0, c.valor_credito - (c.valor_entrada ?? 0));
    if (!(saldo > 0)) continue;
    somaPeso += saldo;
    somaPonderada += taxa * saldo;
  }
  if (!(somaPeso > 0)) return null;
  return somaPonderada / somaPeso;
}

/** Formata a taxa como "X,XX% a.m." (pt-BR), ou "—" quando indisponível. */
export function fmtCustoEfetivo(taxa: number | null): string {
  if (taxa == null) return "—";
  return taxa.toFixed(2).replace(".", ",") + "% a.m.";
}
