// TIR (Taxa Interna de Retorno) mensal por bisseção sobre fluxo de caixa
// arbitrário — extraído de app/api/analista-grupos/route.ts (motor validado
// em produção pro simulador Porto) pra ficar reaproveitável por qualquer
// superfície que precise de custo efetivo real (venda nova Disal, PDF de
// proposta, etc). Comportamento idêntico ao original — só mudou o local.

/**
 * TIR mensal por bisseção (robusta; Newton puro estoura em fluxos com sinal
 * trocando mais de uma vez, como o de consórcio: saídas, depois entrada
 * grande na contemplação, depois mais saídas).
 *
 * `fluxo[0]` é o valor no mês 0 (normalmente 0 ou uma saída inicial),
 * `fluxo[t]` o valor no mês t. Retorna a taxa mensal `i` tal que
 * VPL(i) = 0, ou `null` quando não há raiz no intervalo [-90%, +500%]
 * a.m. — ou seja, quando o fluxo NÃO fecha numa taxa única (ex.:
 * contemplação tardia sem lance: paga quase tudo antes de receber o
 * crédito). Esse `null` é informação, não erro — deve virar um texto de
 * fallback explícito ("não fecha numa taxa única neste cenário"), nunca
 * ser omitido silenciosamente.
 */
export function tirMensal(fluxo: number[]): number | null {
  const npv = (r: number) =>
    fluxo.reduce((s, f, t) => s + f / Math.pow(1 + r, t), 0);
  let lo = -0.9, hi = 5.0;
  let flo = npv(lo), fhi = npv(hi);
  if (isNaN(flo) || isNaN(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-7) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

/** Converte taxa mensal (fração, ex. 0.0059) pra taxa anual equivalente
 *  (fração, ex. 0.0731) via juros compostos: (1+i)^12 - 1. */
export function anualEquivalente(iMensal: number): number {
  return Math.pow(1 + iMensal, 12) - 1;
}

/**
 * TIR mensal via varredura + bisseção, retornando a MENOR raiz positiva —
 * a economicamente relevante ("custo de financiamento"). Fluxos com um
 * pico de entrada no meio (ex.: crédito recebido na contemplação, entre
 * anos de parcela) trocam de sinal MAIS de uma vez; bisseção ingênua com
 * bounds fixos (`tirMensal` acima) pode falhar (os dois extremos caem do
 * mesmo lado) mesmo havendo uma raiz válida perto de zero — problema
 * clássico de TIR múltipla. Não usada por analista-grupos (que mantém o
 * `tirMensal` original, comportamento de produção inalterado); usada pelo
 * custo efetivo de plano novo Disal (lib/disal/custo-efetivo-plano-novo.ts).
 */
export function tirMensalMenorRaiz(
  fluxo: number[],
  opts?: { passo?: number; rMin?: number; rMax?: number }
): number | null {
  const passo = opts?.passo ?? 0.0005;
  const rMin = opts?.rMin ?? -0.5;
  const rMax = opts?.rMax ?? 2.0;
  const npv = (r: number) => fluxo.reduce((s, f, t) => s + f / Math.pow(1 + r, t), 0);

  let rAnt = rMin;
  let fAnt = npv(rAnt);
  for (let r = rMin + passo; r <= rMax + 1e-12; r += passo) {
    const f = npv(r);
    if (Number.isFinite(fAnt) && Number.isFinite(f) && fAnt * f < 0) {
      let lo = rAnt, hi = r, flo = fAnt;
      for (let i = 0; i < 100; i++) {
        const mid = (lo + hi) / 2;
        const fm = npv(mid);
        if (Math.abs(fm) < 1e-9) return mid;
        if (flo * fm < 0) { hi = mid; } else { lo = mid; flo = fm; }
      }
      return (lo + hi) / 2;
    }
    rAnt = r; fAnt = f;
  }
  return null;
}
