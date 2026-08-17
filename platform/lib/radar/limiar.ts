// ============================================================================
// lib/radar/limiar.ts — FATIA SENTINELA-RADAR-01, Parte 2
// Aritmética pura do RADAR. Sem rede, sem banco, sem `process.env` fora do
// kill-switch. Tudo aqui é função de entrada → saída, e é por isso que dá pra
// testar o julgamento do RADAR sem levantar nada.
// AUTORIZADO: Emerson, 15/08/2026 ("mede eventos_sync primeiro para o limiar
// nascer do banco").
// ----------------------------------------------------------------------------
// POR QUE NÃO EXISTE UMA TABELA DE LIMIARES NESTE ARQUIVO
//
// A tentação era escrever `const LIMIAR = { PIFFER: 92, CBC: 264, ... }` com
// os números que a medição de 16/08 devolveu. Seria mentira em duas semanas:
// limiar escrito à mão congela o dia em que foi escrito, e ninguém reabre o
// arquivo pra recalibrar. O que a medição mostrou não foram cinco números —
// foi que as fontes NÃO TÊM A MESMA DISTRIBUIÇÃO:
//
//   fonte              eventos  p50   p90   p95   maior
//   PIFFER                  69    8    33    50      92
//   PLAYCONTEMPLADAS        65   17   116   153     621
//   CBC                     61    3    81   100     264
//   CARTAS                  54    4    14    22      26
//   LANCE                   25    3    19    19      42
//
// 621 na PLAYCONTEMPLADAS e 26 na CARTAS são o mesmo evento com nomes iguais e
// significados opostos: 26 é o teto histórico da CARTAS, e 100 na
// PLAYCONTEMPLADAS não chega ao p90 dela. Um limiar global erraria dos dois
// lados ao mesmo tempo — calaria a CARTAS e gritaria pela PLAYCONTEMPLADAS.
//
// Então o limiar não é um número: é uma FUNÇÃO da própria história da fonte,
// recalculada a cada varredura. Este arquivo tem a conta; quem lê o histórico
// é a rota.
//
// E o outro lado do mesmo problema: alarmar em "qualquer divergência" teria
// disparado 274 vezes desde 02/08, sendo 34 delas com divergencias=1 e 131
// (48%) com 5 ou menos. Alarme que toca 274 vezes não é alarme, é ruído — e
// ruído treina a pessoa a ignorar, que é o pior estado possível.
// ============================================================================
import { ehDiaUtilBR } from "../data-br";

/** Kill-switch. Nasce desarmado: sem `RADAR=on`, nada disto opera. */
export const ENV_KILL_SWITCH = "RADAR";

export function radarLigado(): boolean {
  return process.env[ENV_KILL_SWITCH] === "on";
}

// ---------------------------------------------------------------------------
// PERCENTIL
// ---------------------------------------------------------------------------

/**
 * Percentil por POSTO MAIS PRÓXIMO (nearest-rank), não por interpolação.
 *
 * A escolha é deliberada: nearest-rank devolve um valor QUE JÁ ACONTECEU. Um
 * limiar interpolado seria um número que nunca foi observado — defensável em
 * estatística, indefensável quando alguém pergunta "de onde saiu esse 93,4?".
 * Aqui a resposta é sempre "foi um evento real, nesta data".
 *
 * `p` em 0..100. Lista vazia devolve null — sem história, sem limiar, e o
 * chamador decide o que fazer com a ausência em vez de receber um 0 disfarçado
 * de medição.
 */
export function percentil(valores: readonly number[], p: number): number | null {
  const limpos = valores.filter((v) => Number.isFinite(v));
  if (limpos.length === 0) return null;
  if (!Number.isFinite(p)) return null;
  const pClamp = Math.min(100, Math.max(0, p));
  const ordenado = [...limpos].sort((a, b) => a - b);
  const posto = Math.ceil((pClamp / 100) * ordenado.length);
  const indice = Math.min(ordenado.length - 1, Math.max(0, posto - 1));
  return ordenado[indice] ?? null;
}

// ---------------------------------------------------------------------------
// LIMIAR DE DIVERGÊNCIA (vigia 1)
// ---------------------------------------------------------------------------

export type Limiar = {
  /** O número acima do qual a divergência vira alerta. */
  valor: number;
  /** De onde ele veio — o painel MOSTRA isto, para o limiar ser auditável. */
  base: "historico" | "piso_sem_historico" | "piso_maior";
  /** Quantos eventos históricos sustentaram a conta. */
  n: number;
};

export type OpcoesLimiar = {
  /** Percentil da própria fonte. Padrão 95: um em vinte já é anormal. */
  percentil?: number;
  /**
   * Piso absoluto. Sem ele, uma fonte quieta alarma no próprio ruído: a CARTAS
   * tem p95 = 22, então 23 divergências — que é nada — viraria alerta.
   */
  piso?: number;
  /**
   * Abaixo disto não há distribuição, há anedota. Com 3 eventos o p95 é o
   * maior dos 3, e o próximo evento maior que ele alarma por definição.
   */
  amostraMinima?: number;
};

export const LIMIAR_PADRAO: Required<OpcoesLimiar> = {
  percentil: 95,
  piso: 50,
  amostraMinima: 10,
};

/**
 * O limiar DESTA fonte, derivado da história DELA.
 *
 * Sem história suficiente, cai no piso e DIZ que caiu (`base`). A distinção
 * importa: "limiar 50 porque o p95 desta fonte é 50" e "limiar 50 porque não
 * sei nada sobre esta fonte" são estados diferentes, e um painel que mostra os
 * dois como "50" esconde justamente o que precisa de atenção.
 */
export function limiarDeDivergencia(
  historico: readonly number[],
  opcoes: OpcoesLimiar = {}
): Limiar {
  const { percentil: p, piso, amostraMinima } = { ...LIMIAR_PADRAO, ...opcoes };
  const limpos = historico.filter((v) => Number.isFinite(v));
  const n = limpos.length;

  if (n < amostraMinima) {
    return { valor: piso, base: "piso_sem_historico", n };
  }
  const pct = percentil(limpos, p);
  if (pct === null) return { valor: piso, base: "piso_sem_historico", n };
  if (pct <= piso) return { valor: piso, base: "piso_maior", n };
  return { valor: pct, base: "historico", n };
}

/**
 * Ultrapassou é ESTRITAMENTE maior. Igualar o p95 é, por definição, coisa que
 * já aconteceu — alarmar na igualdade dispararia sobre o próprio histórico.
 */
export function ultrapassou(atual: number, limiar: Limiar): boolean {
  if (!Number.isFinite(atual)) return false;
  return atual > limiar.valor;
}

// ---------------------------------------------------------------------------
// REGRESSÃO DE TAXA (vigia 2 — a "prova dos 7%")
// ---------------------------------------------------------------------------

/**
 * Alarma quando uma taxa CAIU em relação à própria linha de base — nunca
 * porque ela é zero.
 *
 * A ordem foi explícita: "alarmando na REGRESSÃO e não no zero absoluto". O
 * motivo é medido. A LANCE aparece com `sync_raw_desenho espera=0`: ela nunca
 * amostrou, por desenho. Alarme em zero absoluto tocaria pela LANCE em toda
 * varredura, para sempre, sem nada de errado ter acontecido — e um alarme que
 * toca sempre é indistinguível de um alarme quebrado.
 *
 * O que é anormal é a fonte que amostrava e PAROU. Foi exatamente o que
 * aconteceu em 15/08 às 21:00: CARTAS, PIFFER e CBC passaram a devolver
 * `recebidas=0` num endpoint que antes entregava, e ninguém foi avisado.
 *
 * @param atual     taxa observada agora, 0..1
 * @param baseline  taxa que a mesma fonte sustentava antes, 0..1
 * @param queda     queda mínima, em PONTOS de taxa (0.3 = trinta pontos)
 */
export function houveRegressao(atual: number, baseline: number, queda: number): boolean {
  if (!Number.isFinite(atual) || !Number.isFinite(baseline)) return false;
  if (baseline <= 0) return false; // nunca amostrou ⇒ não regrediu
  if (atual >= baseline) return false;
  return baseline - atual >= queda;
}

// ---------------------------------------------------------------------------
// QUEDA RELATIVA (vigia 3 — estoque despencando)
// ---------------------------------------------------------------------------

/**
 * Quanto caiu, em fração da linha de base. Devolve null quando não há base:
 * dividir por zero devolveria Infinity, que compara verdadeiro contra qualquer
 * limiar e viraria alerta permanente numa fonte que nunca teve estoque.
 *
 * Subida devolve número negativo, de propósito — quem chama decide se cresço
 * demais também interessa. Aqui não interessa: carta nova entrando é o normal.
 */
export function quedaRelativa(atual: number, baseline: number): number | null {
  if (!Number.isFinite(atual) || !Number.isFinite(baseline)) return null;
  if (baseline <= 0) return null;
  return (baseline - atual) / baseline;
}

// ---------------------------------------------------------------------------
// IDADE (vigia 5 — fila envelhecendo)
// ---------------------------------------------------------------------------

const MS_POR_DIA = 86_400_000;

/**
 * Idade em dias, fracionária. Data no futuro devolve negativo em vez de zero:
 * relógio torto é defeito, e arredondar para zero esconderia o defeito.
 */
export function idadeEmDias(desde: Date, agora: Date): number {
  return (agora.getTime() - desde.getTime()) / MS_POR_DIA;
}

// ---------------------------------------------------------------------------
// HORA ÚTIL — o denominador do vigia de "sync saudável que não move nada"
// ---------------------------------------------------------------------------
// Medido em 16/08/2026 sobre `cartas`, e é a medição que salvou o vigia de
// nascer inútil. O vão entre uma carta nova e a próxima, contado em horas
// corridas, tem esta cara:
//
//   62h  sex 07/08 19h → seg 10/08 08h   (fim de semana)
//   19h  sáb 15/08 20h → dom 16/08 14h   (fim de semana, o "estoque parado")
//   15h  qui 13/08 18h → sex 14/08 08h   (noite comum)
//   14h  ter 11/08 19h → qua 12/08 08h   (noite comum)
//
// Um limiar em horas corridas que cale a noite (>15) ainda grita todo sábado,
// e um que cale o fim de semana (>62) não vê uma segunda-feira inteira parada.
// Não existe número que resolva os dois — porque o problema não é o número, é
// o RELÓGIO. Contando só hora útil, as noites continuam somando (a noite de
// terça é hora de quarta) mas o fim de semana some do denominador, e aí um
// único limiar serve.
//
// O maior vão NORMAL em hora útil é 15. É desse 15 que sai o limiar do vigia.
// ---------------------------------------------------------------------------

/**
 * Quantas horas de DIA ÚTIL em São Paulo separam dois instantes.
 *
 * Conta a hora pelo instante em que ela COMEÇA, e caminha de hora em hora em
 * vez de fazer aritmética de calendário: é o mesmo motivo pelo qual `data-br`
 * usa `Intl` em lugar de subtrair três horas. Fuso e semana são calendário, e
 * calendário não se calcula na mão.
 *
 * Janela invertida ou datas inválidas devolvem 0 — nunca negativo. Um vigia que
 * recebe número negativo cala por acidente, e vigia que cala por acidente é a
 * coisa exata que esta fatia inteira existe para não repetir.
 */
export function horasUteisEntre(inicio: Date, fim: Date): number {
  const a = inicio.getTime();
  const b = fim.getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;

  // Teto de sanidade: 90 dias de horas. Sem ele, um `inicio` de 1970 vindo de
  // uma coluna nula viraria 400 mil voltas de laço dentro de uma rota de cron.
  const MAX_VOLTAS = 90 * 24;

  let horas = 0;
  let voltas = 0;
  // Começa no topo da hora do `inicio`, para que a contagem não dependa do
  // minuto em que a medição rodou.
  let cursor = new Date(Math.floor(a / 3_600_000) * 3_600_000);

  while (cursor.getTime() < b && voltas < MAX_VOLTAS) {
    if (ehDiaUtilBR(cursor)) horas += 1;
    cursor = new Date(cursor.getTime() + 3_600_000);
    voltas += 1;
  }
  return horas;
}
