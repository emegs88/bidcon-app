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
import { consolidarFases, totalMesesItem, type ItemCarteira } from "./carteira";

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
// JUNÇÃO de cartas — N cotas do MESMO segmento somadas para adquirir UM bem.
// (Correção de escopo do Emerson, 28/07: não é portfólio de cotas
// independentes. Cotas de segmentos diferentes não se juntam — a tela
// bloqueia a mistura, e este modelo pressupõe esse bloqueio.)
//
// A diferença que muda o número: o poder de compra combinado só existe
// quando TODAS as cotas estiverem contempladas. Logo o crédito NÃO entra
// aos poucos, cota a cota — entra de uma vez só, no cenário da ÚLTIMA
// contemplação (`C`). Creditar cada cota no seu próprio mês adiantaria
// dinheiro que o cliente ainda não pode usar e baratearia a junção no
// papel.
//
// Saída (t=1..N): soma das parcelas ativas de todas as cotas em cada mês,
//   via consolidarFases() — que já derruba a parcela em degraus quando uma
//   cota curta termina antes das longas. As parcelas seguem até o fim de
//   cada plano, inclusive depois de C, igual ao modelo de cota única.
// Entrada: poder de compra combinado inteiro em C, corrigido pelo mesmo
//   fator acumulado que o fluxoPlanoNovo aplica ao crédito de uma cota só.
// Não é média das TIRs individuais: a taxa que zera a soma dos fluxos não
//   é a média das taxas que zeram cada fluxo.
// Sem lance: a tela Disal não tem entrada de lance (lancePct=0 no modelo de
//   cota única também). Se um dia tiver, entra aqui pela mesma mecânica de
//   abate de parcelas finais do fluxoPlanoNovo, não por atalho.
// ---------------------------------------------------------------------------

/** Mês de referência por tipo de cota — usado só no modo INDEPENDENTE, onde
 *  cada cota recebe a sua carta no seu próprio mês. */
export type CenarioCarteira = { veiculo: number; imovel: number };

/** Lance próprio (recurso do bolso do cliente) aplicado à carteira inteira.
 *  Embutido fica de fora de propósito: a Disal não publicou teto de embutido
 *  (pendência com o coordenador) e inventar um teto seria inventar regra. */
export type LanceCarteira = { lanceProprioPct?: number };

// Saída comum aos dois modos: soma das parcelas ativas mês a mês, com degrau
// anual do índice quando comIndice. O lance total abate parcelas FINAIS
// (encurta o plano), mesma mecânica do fluxoPlanoNovo — não é uma saída de
// caixa extra no mês 1.
function esqueletoSaidas(
  fases: FaseFluxo[],
  n: number,
  g: number,
  nEfetivo: number,
): number[] {
  const fluxo: number[] = new Array(nEfetivo + 1).fill(0); // t=0: sem desembolso
  for (let t = 1; t <= nEfetivo; t++) {
    const fator = g > 0 ? Math.pow(1 + g, Math.floor((t - 1) / 12)) : 1;
    fluxo[t] = -(faseNoMes(fases, t).valor * fator);
  }
  return fluxo;
}

function abaterPorLance(fases: FaseFluxo[], n: number, cRef: number, lanceRS: number): number {
  if (lanceRS <= 0) return n;
  const parcelaRef = faseNoMes(fases, cRef).valor;
  if (!(parcelaRef > 0)) return n;
  const abateMeses = Math.floor(lanceRS / parcelaRef);
  return Math.max(cRef, n - abateMeses);
}

/**
 * Fluxo da JUNÇÃO: uma entrada só, do poder de compra combinado, no mês da
 * ÚLTIMA contemplação. Ver a nota de escopo acima.
 */
export function fluxoJuncao(params: {
  itens: ItemCarteira[];
  /** Mês da ÚLTIMA contemplação — cenário declarado, nunca promessa.
   *  Clampado a [1, prazo da cota mais longa]. */
  C: number;
  comIndice?: boolean;
  indiceAnualPct?: number;
  lance?: LanceCarteira;
}): number[] {
  const { itens, C, comIndice = false, indiceAnualPct, lance } = params;
  const ativos = itens.filter((i) => i.quantidade > 0 && i.fases.length > 0);
  const fases = consolidarFases(ativos);
  const n = totalMeses(fases);
  if (n <= 0) return [];

  const g = comIndice && indiceAnualPct != null ? indiceAnualPct / 100 : 0;
  const cRef = Math.max(1, Math.min(Math.round(C), n));
  const poderDeCompra = ativos.reduce((s, i) => s + i.credito * i.quantidade, 0);
  const lancePct = Math.max(0, lance?.lanceProprioPct ?? 0);
  const lanceRS = (poderDeCompra * lancePct) / 100;

  const nEfetivo = abaterPorLance(fases, n, cRef, lanceRS);
  const fluxo = esqueletoSaidas(fases, n, g, nEfetivo);

  const fatorEmC = g > 0 ? Math.pow(1 + g, Math.floor((cRef - 1) / 12)) : 1;
  fluxo[cRef] += (poderDeCompra - lanceRS) * fatorEmC;

  return fluxo;
}

/**
 * Fluxo INDEPENDENTE: cada cota recebe a sua própria carta no mês de
 * referência do seu tipo. Não há poder de compra combinado aqui — são cotas
 * que não se juntam, cada uma comprando o seu bem. É o modelo do commit
 * 96a665d, mantido porque continua sendo o certo para esse caso.
 */
export function fluxoIndependente(params: {
  itens: ItemCarteira[];
  C: CenarioCarteira;
  comIndice?: boolean;
  indiceAnualPct?: number;
  lance?: LanceCarteira;
}): number[] {
  const { itens, C, comIndice = false, indiceAnualPct, lance } = params;
  const ativos = itens.filter((i) => i.quantidade > 0 && i.fases.length > 0);
  const fases = consolidarFases(ativos);
  const n = totalMeses(fases);
  if (n <= 0) return [];

  const g = comIndice && indiceAnualPct != null ? indiceAnualPct / 100 : 0;
  const lancePct = Math.max(0, lance?.lanceProprioPct ?? 0);
  const creditoTotal = ativos.reduce((s, i) => s + i.credito * i.quantidade, 0);
  const cMax = Math.max(1, ...ativos.map((i) => Math.min(C[i.tipo], totalMesesItem(i))));
  const nEfetivo = abaterPorLance(fases, n, cMax, (creditoTotal * lancePct) / 100);
  const fluxo = esqueletoSaidas(fases, n, g, nEfetivo);

  for (const item of ativos) {
    const cRef = Math.max(1, Math.min(C[item.tipo], totalMesesItem(item), nEfetivo));
    const fator = g > 0 ? Math.pow(1 + g, Math.floor((cRef - 1) / 12)) : 1;
    const bruto = item.credito * item.quantidade;
    fluxo[cRef] += (bruto - (bruto * lancePct) / 100) * fator;
  }
  return fluxo;
}

/**
 * Custo efetivo dos dois modos. Devolve `null` em cada lado que não fecha
 * numa taxa única — nunca um número aproximado no lugar.
 *
 * Sobre a raiz escolhida: o fluxo da junção troca de sinal mais de uma vez
 * (paga, recebe o poder de compra combinado, volta a pagar), então pode ter
 * MAIS DE UMA TIR matematicamente válida. A convenção aqui é a MENOR raiz
 * positiva (tirMensalMenorRaiz) — a economicamente relevante, o "custo de
 * financiamento". Trocar essa convenção muda o número mostrado ao cliente.
 *
 * `indiceAnualPct`: um índice só. Quem chama deve passar null se houver mais
 * de um índice em jogo — um fator único sobre índices diferentes produziria
 * um custo que não corresponde a nenhum contrato.
 */
export function custoEfetivoCarteira(params: {
  itens: ItemCarteira[];
  modo?: "juncao" | "independente";
  /** número = mês da última contemplação (junção); objeto = por tipo (independente) */
  C: number | CenarioCarteira;
  indiceAnualPct?: number | null;
  lance?: LanceCarteira;
}): ResultadoCustoEfetivo {
  const { itens, modo = "juncao", C, indiceAnualPct, lance } = params;

  const monta = (comIndice: boolean) =>
    modo === "juncao"
      ? fluxoJuncao({ itens, C: C as number, comIndice, indiceAnualPct: indiceAnualPct ?? undefined, lance })
      : fluxoIndependente({
          itens,
          C: C as CenarioCarteira,
          comIndice,
          indiceAnualPct: indiceAnualPct ?? undefined,
          lance,
        });

  const fluxoSem = monta(false);
  const tirSem = fluxoSem.length > 0 ? tirMensalMenorRaiz(fluxoSem) : null;
  const semCorrecao = tirSem != null ? { mensal: tirSem, anual: anualEquivalente(tirSem) } : null;

  let comIndice: ResultadoCustoEfetivo["comIndice"] = null;
  if (indiceAnualPct != null) {
    const fluxoCom = monta(true);
    const tirCom = fluxoCom.length > 0 ? tirMensalMenorRaiz(fluxoCom) : null;
    comIndice = tirCom != null ? { mensal: tirCom, anual: anualEquivalente(tirCom) } : null;
  }

  return { semCorrecao, comIndice };
}

// ---------------------------------------------------------------------------
// Decisão de qual métrica mostrar na junção (regra do Emerson, 28/07)
//
// C >= 48 → a métrica principal passa a ser a TIR COM correção projetada
// (crédito E parcela corrigidos, modelo já validado neste arquivo). Motivo
// medido: em junção de imóvel com C tardio o fluxo nominal deixa de ter raiz
// — o VPL não troca de sinal em nenhuma taxa —, e é justamente o cenário
// realista (quanto mais cartas, mais tarde a última contemplação).
//
// Se NEM a corrigida fechar, a tela mostra só totais em R$. Nunca um
// percentual nominal simples no lugar de uma TIR ausente: um número que
// parece taxa mas não é seria pior que a ausência.
// ---------------------------------------------------------------------------
export const C_LIMIAR_CORRECAO = 48;

export type MetricaJuncao =
  | { tipo: "tir_nominal"; mensal: number; anual: number }
  | { tipo: "tir_corrigida"; mensal: number; anual: number }
  | { tipo: "totais" };

export function escolherMetricaJuncao(resultado: ResultadoCustoEfetivo, C: number): MetricaJuncao {
  if (C >= C_LIMIAR_CORRECAO) {
    if (resultado.comIndice != null) {
      return { tipo: "tir_corrigida", ...resultado.comIndice };
    }
    return { tipo: "totais" };
  }
  if (resultado.semCorrecao != null) {
    return { tipo: "tir_nominal", ...resultado.semCorrecao };
  }
  if (resultado.comIndice != null) {
    return { tipo: "tir_corrigida", ...resultado.comIndice };
  }
  return { tipo: "totais" };
}

/** Totais do fallback: o que se paga ao longo do plano e o poder de compra
 *  já corrigido até o cenário C. Dois números em R$, sem taxa nenhuma. */
export function totaisFallbackJuncao(params: {
  fases: FaseFluxo[];
  poderDeCompra: number;
  C: number;
  indiceAnualPct?: number | null;
}): { totalPagoProjetado: number; poderDeCompraCorrigido: number; projetado: boolean } {
  const { fases, poderDeCompra, C, indiceAnualPct } = params;
  const g = indiceAnualPct != null ? indiceAnualPct / 100 : 0;
  const n = totalMeses(fases);
  const cRef = Math.max(1, Math.min(Math.round(C), n));
  let total = 0;
  for (let t = 1; t <= n; t++) {
    const fator = g > 0 ? Math.pow(1 + g, Math.floor((t - 1) / 12)) : 1;
    total += faseNoMes(fases, t).valor * fator;
  }
  const fatorEmC = g > 0 ? Math.pow(1 + g, Math.floor((cRef - 1) / 12)) : 1;
  return {
    totalPagoProjetado: total,
    poderDeCompraCorrigido: poderDeCompra * fatorEmC,
    projetado: g > 0,
  };
}

// ---------------------------------------------------------------------------
// Projeção da parcela com índice — MESMA convenção de degrau anual usada nos
// fluxos acima (fator = (1+g)^floor((t−1)/12)), para que a tabela e o gráfico
// da tela mostrem exatamente a parcela que entra no cálculo da TIR. Se as
// duas divergissem, o vendedor mostraria um número e cobraria outro.
//
// `indiceAnualPct` ausente/null = projeção indisponível: devolve a série
// NOMINAL. Quem chama tem de rotular como nominal — nunca inventar fator.
// ---------------------------------------------------------------------------

/** Parcela mês a mês (índice 0 = mês 1) já projetada. */
export function projetarParcelaMensal(fases: FaseFluxo[], indiceAnualPct?: number | null): number[] {
  const n = totalMeses(fases);
  const g = indiceAnualPct != null ? indiceAnualPct / 100 : 0;
  const serie: number[] = [];
  for (let t = 1; t <= n; t++) {
    const fator = g > 0 ? Math.pow(1 + g, Math.floor((t - 1) / 12)) : 1;
    serie.push(faseNoMes(fases, t).valor * fator);
  }
  return serie;
}

export type AnoProjetado = {
  ano: number;
  mesInicio: number;
  mesFim: number;
  primeira: number;
  ultima: number;
  /** true quando alguma cota termina no meio do ano e a parcela muda. */
  mudaNoAno: boolean;
};

/** Mesma série, agrupada em anos do plano (1..12, 13..24, ...). */
export function projetarParcelaAnual(
  fases: FaseFluxo[],
  indiceAnualPct?: number | null,
): AnoProjetado[] {
  const serie = projetarParcelaMensal(fases, indiceAnualPct);
  const anos: AnoProjetado[] = [];
  for (let inicio = 0; inicio < serie.length; inicio += 12) {
    const trecho = serie.slice(inicio, inicio + 12);
    const primeira = trecho[0];
    const ultima = trecho[trecho.length - 1];
    anos.push({
      ano: anos.length + 1,
      mesInicio: inicio + 1,
      mesFim: inicio + trecho.length,
      primeira,
      ultima,
      mudaNoAno: trecho.some((v) => Math.abs(v - primeira) > 0.005),
    });
  }
  return anos;
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
  /** Substitui a descrição do cenário — usado pela carteira multi-cota, onde
   *  cotas de tipos diferentes recebem a carta em meses diferentes e um `C`
   *  único mentiria. Ausente = texto de sempre, byte a byte. NUNCA usar
   *  âncora de contemplação aqui: ver a nota do guardrail acima. */
  cenario?: string;
}): string {
  const { resultado, C, indiceNome, indiceAnualPct, cenario } = params;
  const prefixo = `custo efetivo (cenário: ${cenario ?? `carta de crédito no mês ${C}`})`;

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
