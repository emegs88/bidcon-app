// ============================================================================
// Custo efetivo mensal (TIR) de um plano NOVO Disal — regra permanente do
// Emerson: "toda simulação termina em TIR" (ver plano
// noble-herding-melody.md). Reaproveita o motor de bisseção validado em
// produção (lib/tir.ts, extraído de app/api/analista-grupos/route.ts) sobre
// um fluxo de caixa real de plano novo (não é o mesmo fluxo de cessão de
// carta contemplada — sem comissão de 7%, sem T empírico por grupo).
// ----------------------------------------------------------------------------
// Modelo de fluxo (fechado com o Emerson):
//   C = mês de contemplação — SEMPRE um cenário de referência declarado,
//       nunca uma promessa (default 36 imóvel / 24 veículo, vindo de quem
//       chama esta lib — não hardcoded aqui).
//   t=1..n: −parcela do mês (nominal, ou reajustada em degrau anual quando
//       comIndice=true).
//   t=C: soma +creditoLíquido −lanceProprioRS. Quando comIndice=true, o
//       crédito recebido em C TAMBÉM carrega o mesmo fator acumulado até
//       C — no consórcio real o crédito contratado é corrigido pelo
//       índice enquanto não contemplado (é por isso que a parcela também
//       cresce: ela é % do crédito). Validado numericamente contra o caso
//       de referência do Emerson (imóvel 300k, C=36, sem lance): sem
//       correção 0,593% a.m.; com INCC 5% a.a. projetado (parcela E
//       crédito corrigidos) 1,050% a.m. — bate exato. (Correção anterior
//       desta lib, que só reajustava a parcela e mantinha o crédito
//       nominal, dava 1,272% a.m. — não batia; foi um erro de premissa
//       meu, não uma instrução do Emerson.)
//   Nunca os dois lados do lance no mesmo mês — embutido já está embutido
//       na redução do crédito líquido, não é uma saída de caixa separada.
//   Lance total abate parcelas finais (reduz n), mesma mecânica do
//       simular() da Porto, sem a parte de veredito/tempo esperado (Disal
//       venda nova não tem corte_ultimo empírico).
// ============================================================================
import { tirMensalMenorRaiz, anualEquivalente } from "@/lib/tir";
import type { ChaveIndiceBcb } from "@/lib/indices-bcb";

export type FaseFluxo = { meses: number; valor: number };

export type ParamsFluxoPlanoNovo = {
  /** Fases contíguas cobrindo os meses 1..N (auto: 1 fase; imóvel: 3). */
  fases: FaseFluxo[];
  credito: number;
  /** % do crédito em lance total (embutido + próprio). Default 0. */
  lancePct?: number;
  /** % do crédito em lance embutido (reduz o crédito líquido recebido em
   *  C). Default 0 — Disal ainda não tem teto de embutido publicado
   *  (pendência com o coordenador); nunca inventar um teto aqui. */
  lanceEmbutidoPct?: number;
  /** Mês de contemplação (cenário de referência, não promessa). */
  C: number;
  /** Aplica reajuste em degrau anual nas parcelas pós-mês 1 (não no
   *  crédito recebido em C). */
  comIndice?: boolean;
  /** % a.a. do índice (INCC/IPCA), usado só quando comIndice=true. */
  indiceAnualPct?: number;
};

/** Fase ativa num dado mês (1-indexado), varrendo as fases contíguas. */
function faseNoMes(fases: FaseFluxo[], mes: number): FaseFluxo {
  let acumulado = 0;
  for (const f of fases) {
    acumulado += f.meses;
    if (mes <= acumulado) return f;
  }
  return fases[fases.length - 1];
}

function totalMeses(fases: FaseFluxo[]): number {
  return fases.reduce((s, f) => s + f.meses, 0);
}

/**
 * Monta o fluxo de caixa mensal (índice 0 = mês da assinatura, sem
 * desembolso — venda nova não tem comissão de 7% como a cessão de carta
 * contemplada; índice t = mês t) pra alimentar tirMensal().
 */
export function fluxoPlanoNovo(params: ParamsFluxoPlanoNovo): number[] {
  const {
    fases,
    credito,
    lancePct = 0,
    lanceEmbutidoPct = 0,
    C,
    comIndice = false,
    indiceAnualPct,
  } = params;

  const n = totalMeses(fases);
  const cRef = Math.max(1, Math.min(C, n));
  const emb = Math.max(0, lanceEmbutidoPct);
  const proprio = Math.max(0, lancePct - emb);
  const creditoLiquido = credito * (1 - emb / 100);
  const lanceProprioRS = (credito * proprio) / 100;

  const g = comIndice && indiceAnualPct != null ? indiceAnualPct / 100 : 0;
  const parcelaReferenciaAbate = faseNoMes(fases, cRef).valor;
  const abateMeses =
    lancePct > 0 && parcelaReferenciaAbate > 0
      ? Math.floor((credito * lancePct) / 100 / parcelaReferenciaAbate)
      : 0;
  const nTotal = Math.max(cRef, n - abateMeses);

  // fator acumulado até o mês C — o crédito contratado é corrigido pelo
  // mesmo índice enquanto não contemplado (mesma razão da parcela crescer:
  // ambos são função do crédito corrigido). Ver nota no cabeçalho do
  // arquivo — validado contra o caso de referência do Emerson.
  const fatorEmC = g > 0 ? Math.pow(1 + g, Math.floor((cRef - 1) / 12)) : 1;
  const creditoLiquidoCorrigido = creditoLiquido * fatorEmC;
  const lanceProprioCorrigido = lanceProprioRS * fatorEmC;

  const fluxo: number[] = [0]; // t=0: sem desembolso na assinatura
  for (let t = 1; t <= nTotal; t++) {
    const nominal = faseNoMes(fases, t).valor;
    const fator = g > 0 ? Math.pow(1 + g, Math.floor((t - 1) / 12)) : 1;
    let f = -(nominal * fator);
    if (t === cRef) f += creditoLiquidoCorrigido - lanceProprioCorrigido;
    fluxo.push(f);
  }
  return fluxo;
}

export type ResultadoCustoEfetivo = {
  semCorrecao: { mensal: number; anual: number } | null;
  comIndice: { mensal: number; anual: number } | null;
};

/** Calcula os dois números do custo efetivo (sem correção / com índice
 *  projetado) pro cenário C informado. `indiceAnualPct` ausente/null
 *  (índice indisponível) → `comIndice` sai null, nunca inventado. */
export function custoEfetivoPlanoNovo(params: {
  fases: FaseFluxo[];
  credito: number;
  lancePct?: number;
  lanceEmbutidoPct?: number;
  C: number;
  indiceAnualPct?: number | null;
}): ResultadoCustoEfetivo {
  const { fases, credito, lancePct, lanceEmbutidoPct, C, indiceAnualPct } = params;

  const fluxoSem = fluxoPlanoNovo({ fases, credito, lancePct, lanceEmbutidoPct, C, comIndice: false });
  const tirSem = tirMensalMenorRaiz(fluxoSem);
  const semCorrecao = tirSem != null ? { mensal: tirSem, anual: anualEquivalente(tirSem) } : null;

  let comIndice: ResultadoCustoEfetivo["comIndice"] = null;
  if (indiceAnualPct != null) {
    const fluxoCom = fluxoPlanoNovo({
      fases,
      credito,
      lancePct,
      lanceEmbutidoPct,
      C,
      comIndice: true,
      indiceAnualPct,
    });
    const tirCom = tirMensalMenorRaiz(fluxoCom);
    comIndice = tirCom != null ? { mensal: tirCom, anual: anualEquivalente(tirCom) } : null;
  }

  return { semCorrecao, comIndice };
}

// ---------------------------------------------------------------------------
// Formatação de texto — o modelo (vendanova) cita esses textos VERBATIM,
// nunca recompõe números/enumerações de cabeça (fix do bug de composição
// observado em wa_mensagens id=48).
// ---------------------------------------------------------------------------
const fmtPct2 = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct1 = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Nome de exibição pro rótulo, a partir do campo `indice` já existente no
 *  boletim estático ("INCC" | "IPCA" | "IGP-M", case-insensitive). */
export function chaveIndiceBcb(indiceNome: string): ChaveIndiceBcb | null {
  const n = indiceNome.trim().toUpperCase();
  if (n === "INCC" || n.startsWith("INCC")) return "incc";
  if (n === "IPCA") return "ipca";
  if (n === "IGP-M" || n === "IGPM") return "igpm";
  return null;
}

/**
 * Texto final do custo efetivo, com os 2 fallbacks acordados: "não fecha
 * numa taxa única" (tirMensal→null) e "projeção indisponível" (índice
 * ausente ou TIR com correção não fecha). Formato exato (canal
 * WhatsApp/site — texto passa pelo guardrail `sanitizarCompliance` em
 * lib/ia.ts, aplicado à resposta INTEIRA do modelo em
 * app/api/atende/route.ts:764, inclusive trechos citados verbatim de
 * tool):
 * "custo efetivo (cenário: carta de crédito no mês {C}): {i1}% a.m. ·
 * {i2}% a.m. com {INDICE} projetado a {g}% a.a. (acumulado 12m) —
 * estimativa"
 *
 * CORREÇÃO (Emerson, 2/4): a versão anterior usava "contemplação no mês
 * {C}" — a âncora `CONTEMPLA_ANCORAS` ("contempl...") seguida de um
 * token temporal ("N mes") dentro da janela de 40 caracteres de
 * `prometeDataContemplacao()` (lib/ia.ts) engolia a frase inteira e
 * devolvia o fallback genérico — quebrando silenciosamente a regra
 * "toda simulação termina em TIR" em produção. "Carta de crédito" não é
 * âncora de contemplação (não está em CONTEMPLA_ANCORAS) e comunica o
 * mesmo cenário de referência sem disparar a barreira. Válido só pro
 * texto citado em chat; PDF/simulador estático (fora do guardrail,
 * que só envolve saída de modelo em canal vivo) podem usar
 * "contemplação no mês N" — mais claro pro documento — se um consumidor
 * futuro precisar dessa variante, adicionar parâmetro, não reverter
 * esta.
 */
export function formatarCustoEfetivoTexto(params: {
  resultado: ResultadoCustoEfetivo;
  C: number;
  indiceNome?: string; // "INCC" | "IPCA" | "IGP-M"
  indiceAnualPct?: number | null;
}): string {
  const { resultado, C, indiceNome, indiceAnualPct } = params;
  const prefixo = `custo efetivo (cenário: carta de crédito no mês ${C})`;

  if (resultado.semCorrecao == null) {
    return `${prefixo}: não fecha numa taxa única neste cenário`;
  }

  const i1 = fmtPct2(resultado.semCorrecao.mensal * 100);

  if (resultado.comIndice == null || indiceAnualPct == null || !indiceNome) {
    return `${prefixo}: ${i1}% a.m. — projeção indisponível no momento`;
  }

  const i2 = fmtPct2(resultado.comIndice.mensal * 100);
  const g = fmtPct1(indiceAnualPct);
  return `${prefixo}: ${i1}% a.m. · ${i2}% a.m. com ${indiceNome} projetado a ${g}% a.a. (acumulado 12m) — estimativa`;
}

/**
 * Texto pronto da enumeração de fases — o modelo cita verbatim (nunca
 * recompõe a soma de meses de cabeça). Auto (1 fase): "84x de R$ 1.328,13".
 * Imóvel (3 fases): "12x de R$ 2.247,81 + 207x de R$ 1.947,81 + 1x de
 * R$ 1.959,81 (220 parcelas)".
 */
export function formatarFasesTexto(fases: FaseFluxo[]): string {
  const partes = fases.map((f) => `${f.meses}x de ${fmtBRL(f.valor)}`);
  if (fases.length === 1) return partes[0];
  return `${partes.join(" + ")} (${totalMeses(fases)} parcelas)`;
}
