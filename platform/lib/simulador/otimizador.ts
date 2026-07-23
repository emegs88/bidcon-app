// ============================================================================
// Bidcon — Simulador Conta Notarial para Parceiros (fatia SIM-PARCEIRO-01.2,
// FASE 1 — "MELHOR CESTA").
// ----------------------------------------------------------------------------
// Otimizador determinístico e puro (zero I/O, zero Supabase, zero aleatoriedade)
// que sugere a(s) melhor(es) cesta(s) de cartas pro modo LEVANTAMENTO DE CAPITAL.
// Reaproveita só o motor já validado (`engine.ts`) — nunca recalcula líquido/TIR
// por conta própria.
//
// Objetivo do usuário (o parceiro): "quero X de líquido pro cliente" (ou "quero
// o máximo de líquido possível") escolhendo, dentre o estoque disponível (já
// filtrado pelo chip de segmento ativo da 01.1 — quem filtra é quem chama esta
// função, não este módulo), a combinação de cartas que entrega isso com o MENOR
// custo financeiro (TIR do cliente) — nunca o inverso. TIR mais baixa é sempre
// melhor pro cliente, então a métrica de ranking é sempre TIR ascendente,
// independente do tipo de objetivo (o objetivo só decide QUAIS cestas entram na
// disputa; ex.: líquido mínimo filtra por um piso de líquido).
//
// MÉTODO (decidido por Emerson — evita busca exaustiva sobre o estoque inteiro,
// que pode ter centenas/milhares de cartas):
//   1) Pré-filtro: reduz o universo a um "pool" de até 40 cartas mais eficientes
//      por dois critérios (entrada/crédito baixa, parcela/crédito baixa) — uma
//      cota "cara" relativa ao próprio crédito raramente entra numa cesta ótima.
//   2) Busca exaustiva de cestas de 1 a 4 cartas DENTRO desse pool de 40
//      (C(40,1)+...+C(40,4) ≈ 91k combinações) — filtra primeiro pelas
//      restrições/objetivo (cálculo barato, O(nCartas)) e só chama a TIR
//      (Newton-Raphson, mais caro) pras combinações que sobrevivem ao filtro.
//   3) Busca local por trocas ("swap"): a partir das melhores cestas achadas no
//      passo 2, tenta adicionar ou trocar UMA carta por vez usando um pool
//      secundário maior (até 150 cartas, mesmo critério de eficiência) — cobre
//      cartas fora do top-40 que só compensam em combinação com outras.
//      Delimitado (não é o estoque inteiro, mesmo chamado de "universo mais
//      amplo") por custo computacional: cada tentativa de troca exige recalcular
//      a TIR da cesta candidata.
//   4) Rankeia os sobreviventes por TIR ascendente (menor custo financeiro
//      primeiro); desempate por maior líquido, depois por cesta mais simples
//      (menos cartas). Retorna as 3 melhores cestas distintas.
//
// Nenhum texto novo fora do léxico aprovado é produzido aqui — este módulo só
// devolve números e a lista de cartas; o rótulo fixo de compliance ("Sugestão
// calculada pelo motor (TIR). Revise antes de enviar.") é responsabilidade da
// UI, não deste arquivo.
// ============================================================================

import {
  type CotaSim,
  type ParamsFundo,
  liquidoCliente,
  parcelaNoMes,
  tirComNet0,
} from "./engine";

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

/** Objetivo do parceiro pro levantamento de capital. Discriminado por `tipo`:
 * - "liquido_minimo": só entram na disputa cestas com líquido >= liquidoMinimo.
 * - "liquido_maximo": sem piso — toda cesta que passar nas restrições concorre
 *   (a métrica final de ranking continua sendo TIR, não o valor do líquido). */
export type ObjetivoOtimizador =
  | { tipo: "liquido_minimo"; liquidoMinimo: number }
  | { tipo: "liquido_maximo" };

/** Restrições opcionais do parceiro. `maxCartas` é sempre limitado a 5 (teto de
 * negócio da junção via Conta Notarial), mesmo se o chamador passar um valor
 * maior. */
export interface RestricoesOtimizador {
  parcelaMaxMes1?: number;
  prazoMax?: number;
  maxCartas?: number;
}

/** Uma cesta candidata avaliada — números vêm 100% do motor (`engine.ts`),
 * nunca recalculados aqui. */
export interface CandidatoCesta {
  cotas: CotaSim[];
  entrada: number;
  liquido: number;
  tir: number;
  parcelaMes1: number;
  prazoMax: number;
  nCartas: number;
}

export interface ParamsOtimizador {
  cotas: CotaSim[]; // universo já filtrado pelo chip de segmento ativo (01.1)
  taxaTransferencia: number;
  paramsFundo: ParamsFundo;
  objetivo: ObjetivoOtimizador;
  restricoes?: RestricoesOtimizador;
}

const TETO_MAX_CARTAS = 5;
const TAMANHO_POOL_EXAUSTIVO = 40;
const TAMANHO_POOL_REFINO = 150;
const MAX_COMBO_EXAUSTIVO = 4;
const QTD_SEMENTES_REFINO = 5;
const MAX_ITER_REFINO = 10;
const TOP_N_RESULTADO = 3;

// ---------------------------------------------------------------------------
// Ranking / eficiência
// ---------------------------------------------------------------------------

/** Razão entrada/crédito — quanto menor, mais "eficiente" a cota pro pool. */
function razaoEntrada(c: CotaSim): number {
  return c.credito > 0 ? c.entrada / c.credito : Infinity;
}
/** Razão parcela/crédito — idem, pro peso mensal da cota. */
function razaoParcela(c: CotaSim): number {
  return c.credito > 0 ? c.parcela / c.credito : Infinity;
}

/** Seleciona até `n` cartas mais eficientes por entrada/crédito e
 * parcela/crédito (união das duas metades melhores de cada ranking; completa
 * com o restante do ranking por entrada/crédito se a união não bater `n` por
 * sobreposição alta entre os dois critérios). Se o universo já é <= n,
 * devolve tudo — não há o que pré-filtrar. */
function selecionarPoolEficiente(cotas: CotaSim[], n: number): CotaSim[] {
  if (cotas.length <= n) return cotas;
  const porEntrada = [...cotas].sort((a, b) => razaoEntrada(a) - razaoEntrada(b));
  const porParcela = [...cotas].sort((a, b) => razaoParcela(a) - razaoParcela(b));
  const metade = Math.ceil(n / 2);
  const pool = new Map<string, CotaSim>();
  for (const c of porEntrada.slice(0, metade)) pool.set(c.id, c);
  for (const c of porParcela.slice(0, metade)) pool.set(c.id, c);
  if (pool.size < n) {
    for (const c of porEntrada) {
      if (pool.size >= n) break;
      pool.set(c.id, c);
    }
  }
  return [...pool.values()].slice(0, n);
}

// ---------------------------------------------------------------------------
// Combinações (gerador iterativo — evita profundidade de recursão e permite
// early-exit natural via `for...of`)
// ---------------------------------------------------------------------------

function* combinacoes<T>(arr: T[], k: number): Generator<T[]> {
  const n = arr.length;
  if (k <= 0 || k > n) return;
  const indices = Array.from({ length: k }, (_, i) => i);
  for (;;) {
    yield indices.map((i) => arr[i]);
    let i = k - 1;
    while (i >= 0 && indices[i] === n - k + i) i--;
    if (i < 0) return;
    indices[i]++;
    for (let j = i + 1; j < k; j++) indices[j] = indices[j - 1] + 1;
  }
}

// ---------------------------------------------------------------------------
// Avaliação de cesta — separa o cálculo BARATO (líquido, parcela, prazo — só
// aritmética, O(nCartas)) do cálculo CARO (TIR — Newton-Raphson/bisseção), pra
// só pagar o custo da TIR nas cestas que já passaram nos filtros baratos.
// ---------------------------------------------------------------------------

interface AvaliacaoBarata {
  entrada: number;
  liquido: number;
  parcelaMes1: number;
  prazoMax: number;
  nCartas: number;
}

function avaliarBarato(
  cotas: CotaSim[],
  taxaTransferencia: number,
  paramsFundo: ParamsFundo,
): AvaliacaoBarata {
  const entrada = cotas.reduce((s, c) => s + c.entrada, 0);
  return {
    entrada,
    liquido: liquidoCliente(cotas, entrada, taxaTransferencia, paramsFundo),
    parcelaMes1: parcelaNoMes(cotas, 1),
    prazoMax: Math.max(0, ...cotas.map((c) => c.prazo)),
    nCartas: cotas.length,
  };
}

function satisfazRestricoes(av: AvaliacaoBarata, restricoes: RestricoesOtimizador | undefined): boolean {
  if (!restricoes) return true;
  if (restricoes.parcelaMaxMes1 != null && av.parcelaMes1 > restricoes.parcelaMaxMes1) return false;
  if (restricoes.prazoMax != null && av.prazoMax > restricoes.prazoMax) return false;
  return true;
}

function satisfazObjetivo(av: AvaliacaoBarata, objetivo: ObjetivoOtimizador): boolean {
  if (objetivo.tipo === "liquido_minimo") return av.liquido >= objetivo.liquidoMinimo;
  return true; // liquido_maximo: sem piso — toda cesta viável concorre
}

/** Avalia uma cesta por completo (barato + TIR) — só chamar depois que a
 * avaliação barata já passou nos filtros, pra não pagar Newton-Raphson à toa. */
function avaliarCompleto(
  cotas: CotaSim[],
  barato: AvaliacaoBarata,
): CandidatoCesta | null {
  const tir = tirComNet0(cotas, barato.liquido);
  if (tir == null) return null; // não converge numa taxa única — descarta
  return {
    cotas,
    entrada: barato.entrada,
    liquido: barato.liquido,
    tir,
    parcelaMes1: barato.parcelaMes1,
    prazoMax: barato.prazoMax,
    nCartas: barato.nCartas,
  };
}

/** Ordena por TIR ascendente (menor custo financeiro primeiro); desempate por
 * maior líquido, depois por cesta mais simples (menos cartas). */
function comparar(a: CandidatoCesta, b: CandidatoCesta): number {
  if (a.tir !== b.tir) return a.tir - b.tir;
  if (a.liquido !== b.liquido) return b.liquido - a.liquido;
  return a.nCartas - b.nCartas;
}

function chaveCesta(cotas: CotaSim[]): string {
  return cotas
    .map((c) => c.id)
    .sort()
    .join("|");
}

// ---------------------------------------------------------------------------
// Etapa 1 — busca exaustiva no pool top-40
// ---------------------------------------------------------------------------

function buscaExaustiva(
  pool: CotaSim[],
  maxComboSize: number,
  taxaTransferencia: number,
  paramsFundo: ParamsFundo,
  objetivo: ObjetivoOtimizador,
  restricoes: RestricoesOtimizador | undefined,
): CandidatoCesta[] {
  const achados: CandidatoCesta[] = [];
  for (let k = 1; k <= maxComboSize; k++) {
    for (const combo of combinacoes(pool, k)) {
      const barato = avaliarBarato(combo, taxaTransferencia, paramsFundo);
      if (!satisfazRestricoes(barato, restricoes)) continue;
      if (!satisfazObjetivo(barato, objetivo)) continue;
      const completo = avaliarCompleto(combo, barato);
      if (completo) achados.push(completo);
    }
  }
  return achados;
}

// ---------------------------------------------------------------------------
// Etapa 2 — refino local por adição/troca de UMA carta por vez, usando um pool
// secundário maior (top-150) — cobre cartas fora do top-40 que só compensam em
// combinação com outras já na cesta.
// ---------------------------------------------------------------------------

function refinarPorTrocas(
  semente: CandidatoCesta,
  poolRefino: CotaSim[],
  maxCartas: number,
  taxaTransferencia: number,
  paramsFundo: ParamsFundo,
  objetivo: ObjetivoOtimizador,
  restricoes: RestricoesOtimizador | undefined,
): CandidatoCesta {
  let atual = semente;
  // Hill-climbing por "melhor movimento" (steepest-improvement): em cada
  // iteração, varre TODOS os movimentos de adição/troca a partir do estado
  // ATUAL (fixo durante toda a varredura) e aplica só o melhor encontrado —
  // nunca muta `atual`/`idsAtuais`/`foraDaCesta` no meio da varredura. Isso é
  // proposital: uma varredura "first-improvement" que reatribui `atual`
  // enquanto ainda itera sobre um `foraDaCesta` já desatualizado pode
  // adicionar a mesma carta duas vezes (cesta com IDs duplicados) e furar o
  // teto de `maxCartas` (o `if (atual.nCartas < maxCartas)` só seria checado
  // uma vez, não a cada adição). Recalcular o estado a cada iteração evita os
  // dois problemas por construção.
  for (let iter = 0; iter < MAX_ITER_REFINO; iter++) {
    const idsAtuais = new Set(atual.cotas.map((c) => c.id));
    const foraDaCesta = poolRefino.filter((c) => !idsAtuais.has(c.id));
    let melhorMovimento: CandidatoCesta | null = null;

    const considerar = (tentativaCotas: CotaSim[]) => {
      const barato = avaliarBarato(tentativaCotas, taxaTransferencia, paramsFundo);
      if (!satisfazRestricoes(barato, restricoes) || !satisfazObjetivo(barato, objetivo)) return;
      const tentativa = avaliarCompleto(tentativaCotas, barato);
      if (!tentativa || comparar(tentativa, atual) >= 0) return;
      if (!melhorMovimento || comparar(tentativa, melhorMovimento) < 0) melhorMovimento = tentativa;
    };

    // (a) tentar ADICIONAR uma carta, se ainda há espaço até o teto
    if (atual.nCartas < maxCartas) {
      for (const candidata of foraDaCesta) considerar([...atual.cotas, candidata]);
    }

    // (b) tentar TROCAR uma carta da cesta por outra de fora
    for (const cotaAtual of atual.cotas) {
      for (const candidata of foraDaCesta) {
        considerar(atual.cotas.map((c) => (c.id === cotaAtual.id ? candidata : c)));
      }
    }

    if (!melhorMovimento) break; // nenhum movimento melhora — ótimo local atingido
    atual = melhorMovimento;
  }
  return atual;
}

// ---------------------------------------------------------------------------
// Função pública
// ---------------------------------------------------------------------------

/** Sugere até 3 cestas candidatas pro levantamento de capital, ordenadas por
 * TIR do cliente ascendente (menor custo financeiro primeiro). `cotas` já deve
 * vir filtrada pelo chip de segmento ativo (quem chama decide o universo —
 * este módulo não sabe nada sobre segmento/UI). Retorna `[]` quando nenhuma
 * combinação viável é encontrada (universo vazio, restrições impossíveis, ou
 * nenhuma cesta atinge o líquido mínimo pedido). */
export function sugerirMelhorCesta(params: ParamsOtimizador): CandidatoCesta[] {
  const { cotas, taxaTransferencia, paramsFundo, objetivo, restricoes } = params;
  if (cotas.length === 0) return [];

  const maxCartas = Math.max(1, Math.min(restricoes?.maxCartas ?? TETO_MAX_CARTAS, TETO_MAX_CARTAS));
  const maxComboExaustivo = Math.min(MAX_COMBO_EXAUSTIVO, maxCartas);

  const poolExaustivo = selecionarPoolEficiente(cotas, TAMANHO_POOL_EXAUSTIVO);
  const achados = buscaExaustiva(
    poolExaustivo,
    maxComboExaustivo,
    taxaTransferencia,
    paramsFundo,
    objetivo,
    restricoes,
  );
  if (achados.length === 0) return [];

  achados.sort(comparar);
  const sementes = achados.slice(0, QTD_SEMENTES_REFINO);

  const poolRefino = selecionarPoolEficiente(cotas, TAMANHO_POOL_REFINO);
  const refinados = sementes.map((s) =>
    refinarPorTrocas(s, poolRefino, maxCartas, taxaTransferencia, paramsFundo, objetivo, restricoes),
  );

  // Dedup por conjunto de IDs (refino pode convergir sementes diferentes pra
  // mesma cesta) — mantém só a melhor ocorrência de cada cesta distinta.
  const porChave = new Map<string, CandidatoCesta>();
  for (const c of [...achados, ...refinados]) {
    const chave = chaveCesta(c.cotas);
    const existente = porChave.get(chave);
    if (!existente || comparar(c, existente) < 0) porChave.set(chave, c);
  }

  return [...porChave.values()].sort(comparar).slice(0, TOP_N_RESULTADO);
}
