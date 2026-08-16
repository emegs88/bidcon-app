// ============================================================================
// lib/radar/vigias.ts — FATIA SENTINELA-RADAR-01, Parte 2
// O JULGAMENTO dos cinco vigias, separado da MEDIÇÃO.
// AUTORIZADO: Emerson, 15/08/2026.
// ----------------------------------------------------------------------------
// Cada função aqui recebe números já medidos e devolve `Alerta | null`. Nenhuma
// delas toca banco, rede ou relógio — a hora e a data chegam por parâmetro. É o
// que permite testar "o RADAR alarma quando deve, e cala quando não deve" sem
// levantar Postgres e sem esperar dar 15h de um domingo.
//
// ----------------------------------------------------------------------------
// UM ALERTA POR CONDIÇÃO, NÃO POR OCORRÊNCIA
//
// A ordem foi literal nisto, e o par (`tipo`, `chave`) é como ela vira regra de
// máquina em vez de promessa. A medição mostrou por que importa: entre 15/08
// 21:00 e 16/08, `sync_raw_ausente` apareceu 18 vezes. Não são 18 problemas —
// são 3 fontes (CARTAS, PIFFER, CBC) batendo no MESMO endpoint
// (`/api/cotas-extra?admin=1`) ao longo de 6 ciclos. Um alerta por ocorrência
// encheria a tela com 18 linhas dizendo a mesma coisa; um alerta por condição
// abre 3 linhas — uma por fonte — e cada uma conta 6 ocorrências.
//
// Quem grava é a rota, com índice único parcial em (tipo, chave) enquanto o
// alerta está aberto. Quem NOMEIA a condição é este arquivo.
//
// ----------------------------------------------------------------------------
// SEVERIDADE: DUAS, NÃO CINCO
//
// 'aviso'  — olhe quando puder.
// 'grave'  — alguma coisa parou de funcionar.
//
// Escala de cinco níveis vira decoração: ninguém distingue "alto" de "muito
// alto" sob pressão, e a distinção não muda o que a pessoa faz. Duas mudam.
// ============================================================================
import {
  houveRegressao,
  idadeEmDias,
  limiarDeDivergencia,
  quedaRelativa,
  ultrapassou,
  type Limiar,
  type OpcoesLimiar,
} from "./limiar";

export type Severidade = "aviso" | "grave";

export type Alerta = {
  /** Qual vigia. Agrupa na tela. */
  tipo: string;
  /** A CONDIÇÃO específica dentro do vigia. Único enquanto aberto. */
  chave: string;
  severidade: Severidade;
  /** Uma linha, legível por quem não escreveu o código. */
  titulo: string;
  /** Os números que sustentam o título. O painel mostra; o histórico guarda. */
  detalhe: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// VIGIA 1 — divergência de sync, com limiar da própria fonte
// ---------------------------------------------------------------------------

export const TIPO_DIVERGENCIA = "sync_divergencia";

export function vigiaDivergenciaSync(entrada: {
  fonte: string;
  /** Divergências do ciclo mais recente desta fonte. */
  divergencias: number;
  /** Divergências dos ciclos anteriores DELA — o limiar sai daqui. */
  historico: readonly number[];
  opcoes?: OpcoesLimiar;
}): Alerta | null {
  const { fonte, divergencias, historico, opcoes } = entrada;
  const limiar = limiarDeDivergencia(historico, opcoes);
  if (!ultrapassou(divergencias, limiar)) return null;

  // Dobrar o limiar não é "um pouco pior": é a diferença entre uma fonte
  // oscilando e uma fonte que mudou de comportamento.
  const severidade: Severidade = divergencias > limiar.valor * 2 ? "grave" : "aviso";
  return {
    tipo: TIPO_DIVERGENCIA,
    chave: fonte,
    severidade,
    titulo: `${fonte}: ${divergencias} divergências no ciclo (limiar ${limiar.valor})`,
    detalhe: { fonte, divergencias, limiar: limiar.valor, base: limiar.base, n: limiar.n },
  };
}

// ---------------------------------------------------------------------------
// VIGIA 2 — a prova de amostra ("prova dos 7%"), alarmando na REGRESSÃO
// ---------------------------------------------------------------------------

export const TIPO_AMOSTRA = "sync_amostra";

/** Queda mínima, em pontos de taxa, para virar alerta. */
export const QUEDA_AMOSTRA = 0.3;

export function vigiaProvaAmostra(entrada: {
  fonte: string;
  /** Quantas linhas o ciclo leu. */
  lidas: number;
  /** Quantas voltaram com o cru — é o que a prova confere. */
  recebidas: number;
  /** Taxa que ESTA fonte sustentava antes, 0..1. */
  baselineTaxa: number;
  queda?: number;
}): Alerta | null {
  const { fonte, lidas, recebidas, baselineTaxa, queda = QUEDA_AMOSTRA } = entrada;
  // Ciclo que não leu nada não prova nem desmente: dividir por zero aqui daria
  // taxa NaN, e NaN comparado a qualquer coisa é falso — alarme mudo. Sair
  // cedo é dizer "não sei" em vez de dizer "está tudo bem".
  if (!Number.isFinite(lidas) || lidas <= 0) return null;

  const taxa = recebidas / lidas;
  if (!houveRegressao(taxa, baselineTaxa, queda)) return null;

  // Zero absoluto NÃO é o gatilho — mas, uma vez que houve regressão, chegar a
  // zero diz que o canal não caiu: parou.
  const severidade: Severidade = recebidas === 0 ? "grave" : "aviso";
  return {
    tipo: TIPO_AMOSTRA,
    chave: fonte,
    severidade,
    titulo: `${fonte}: prova de amostra caiu de ${pct(baselineTaxa)} para ${pct(taxa)}`,
    detalhe: { fonte, lidas, recebidas, taxa, baseline: baselineTaxa, queda_minima: queda },
  };
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

// ---------------------------------------------------------------------------
// VIGIA 3 — estoque
// ---------------------------------------------------------------------------

export const TIPO_ESTOQUE = "estoque";

/**
 * As duas chaves do estoque saem daqui, e não de literais soltos, porque quem
 * ABRE o alerta (este arquivo) e quem RESOLVE (a rota de varredura) precisam
 * concordar caractere por caractere. Se divergirem, a rota fecha uma condição
 * que ninguém abriu e deixa aberta a que devia fechar — sem erro nenhum na
 * tela. Constante compartilhada transforma esse desencontro em erro de tipo.
 */
export const CHAVE_ESTOQUE_NIVEL = "nivel";
export const CHAVE_ESTOQUE_SEM_MOVIMENTO = "sem_movimento";

/** Queda de nível que vira alerta (fração da linha de base). */
export const QUEDA_ESTOQUE = 0.2;
/** Horas sem carta nova antes de o silêncio virar alerta. */
export const HORAS_SEM_MOVIMENTO = 12;

export function vigiaEstoqueNivel(entrada: {
  disponiveisAgora: number;
  disponiveisBaseline: number;
  queda?: number;
}): Alerta | null {
  const { disponiveisAgora, disponiveisBaseline, queda = QUEDA_ESTOQUE } = entrada;
  const caiu = quedaRelativa(disponiveisAgora, disponiveisBaseline);
  if (caiu === null || caiu < queda) return null;
  return {
    tipo: TIPO_ESTOQUE,
    chave: CHAVE_ESTOQUE_NIVEL,
    severidade: caiu >= 0.5 ? "grave" : "aviso",
    titulo: `Estoque disponível caiu ${Math.round(caiu * 100)}% (${disponiveisBaseline} → ${disponiveisAgora})`,
    detalhe: { agora: disponiveisAgora, baseline: disponiveisBaseline, queda: caiu },
  };
}

/**
 * O estoque PARADO é um estado diferente do estoque caindo, e é o que estava
 * acontecendo sem aviso quando esta fatia foi escrita: 1008 cartas novas em
 * 14/08, 1 em 15/08, 0 em 16/08 com 5 ciclos rodados. O nível não tinha caído
 * — 2423 disponíveis, número saudável — e por isso um vigia só de nível teria
 * ficado calado enquanto a vitrine envelhecia.
 */
export function vigiaEstoqueSemMovimento(entrada: {
  horasSemCartaNova: number;
  ciclosNoPeriodo: number;
  limiteHoras?: number;
}): Alerta | null {
  const { horasSemCartaNova, ciclosNoPeriodo, limiteHoras = HORAS_SEM_MOVIMENTO } = entrada;
  if (!Number.isFinite(horasSemCartaNova) || horasSemCartaNova < limiteHoras) return null;
  // Sem ciclo rodado no período, o silêncio é do cron, não do estoque — e quem
  // avisa disso é o heartbeat, não este vigia. Alarmar aqui apontaria o dedo
  // para o lugar errado.
  if (ciclosNoPeriodo <= 0) return null;
  return {
    tipo: TIPO_ESTOQUE,
    chave: CHAVE_ESTOQUE_SEM_MOVIMENTO,
    severidade: horasSemCartaNova >= limiteHoras * 2 ? "grave" : "aviso",
    titulo: `Nenhuma carta nova há ${Math.floor(horasSemCartaNova)}h, com ${ciclosNoPeriodo} ciclos rodados`,
    detalhe: { horas: horasSemCartaNova, ciclos: ciclosNoPeriodo, limite: limiteHoras },
  };
}

// ---------------------------------------------------------------------------
// VIGIA 4 — FAROL sem publicar
// ---------------------------------------------------------------------------

export const TIPO_FAROL = "farol";
export const CHAVE_FAROL_SEM_PUBLICAR = "sem_publicar";

/**
 * Hora de São Paulo depois da qual o silêncio do FAROL vira alerta. O cron do
 * post diário roda 14h UTC (11h SP); 16h SP dá duas horas de folga para
 * retentativa antes de alguém ser incomodado.
 */
export const HORA_COBRANCA_FAROL = 16;

export function vigiaFarolSemPublicar(entrada: {
  horaSP: number;
  publicadosHoje: number;
  horaLimite?: number;
}): Alerta | null {
  const { horaSP, publicadosHoje, horaLimite = HORA_COBRANCA_FAROL } = entrada;
  if (!Number.isFinite(horaSP) || horaSP < horaLimite) return null;
  if (publicadosHoje > 0) return null;
  return {
    tipo: TIPO_FAROL,
    chave: CHAVE_FAROL_SEM_PUBLICAR,
    severidade: "aviso",
    titulo: `FAROL não publicou nada até as ${horaSP}h`,
    detalhe: { hora_sp: horaSP, limite: horaLimite, publicados: publicadosHoje },
  };
}

// ---------------------------------------------------------------------------
// VIGIA 5 — fila do Sentinela envelhecendo
// ---------------------------------------------------------------------------

export const TIPO_FILA_SENTINELA = "sentinela_fila";
export const CHAVE_FILA_ENVELHECENDO = "envelhecendo";

/**
 * Três dias. Não é número redondo por acaso: o espaçamento entre toques é 72h,
 * então uma linha esperando mais que isso não está no ritmo — está parada.
 *
 * Este vigia existe por um caso concreto. As 21 linhas captadas em 04/08
 * ficaram ONZE DIAS em `aguardando_template` sem que nada acusasse. Fila
 * invisível é fila morta, e a invisibilidade custou onze dias de silêncio com
 * gente que tinha perguntado alguma coisa.
 */
export const DIAS_FILA_PARADA = 3;

export function vigiaFilaSentinela(entrada: {
  maisAntigaEm: Date | null;
  quantasEsperando: number;
  agora: Date;
  limiteDias?: number;
}): Alerta | null {
  const { maisAntigaEm, quantasEsperando, agora, limiteDias = DIAS_FILA_PARADA } = entrada;
  if (!maisAntigaEm || quantasEsperando <= 0) return null;
  const dias = idadeEmDias(maisAntigaEm, agora);
  if (!Number.isFinite(dias) || dias < limiteDias) return null;
  return {
    tipo: TIPO_FILA_SENTINELA,
    chave: CHAVE_FILA_ENVELHECENDO,
    severidade: dias >= limiteDias * 2 ? "grave" : "aviso",
    titulo: `Fila do Sentinela parada: ${quantasEsperando} esperando, a mais antiga há ${Math.floor(dias)} dias`,
    detalhe: {
      esperando: quantasEsperando,
      dias: Math.floor(dias),
      mais_antiga_em: maisAntigaEm.toISOString(),
      limite_dias: limiteDias,
    },
  };
}

// ---------------------------------------------------------------------------
// VIGIA 6 e 7 — quarentena. CARTAS DISTINTAS, nunca eventos.
// CORREÇÃO DA COORDENAÇÃO, 16/08/2026, e ela desfez um erro meu.
// ---------------------------------------------------------------------------
//
// Eu relatei "95 cartas barradas em 24h contra 1 aprovada" e concluí que a
// fonte tinha desabado. Estava errado. A medição, refeita:
//
//   95 eventos · 4 numero_externo distintos · 95 carta_id distintos
//
// São QUATRO cartas (PLAYCONTEMPLADAS 18531/30242/82515 e PIFFER 182340) se
// reinserindo uma vez por ciclo, 24 ciclos. Não é a porta quebrada: é a porta
// funcionando 24 vezes. O `sync_fim` com `fontes_falha=0` estava certo, e quem
// estava errado era o meu relatório.
//
// A ARMADILHA, e ela é fina: deduplicar por `carta_id` NÃO resolve. Cada ciclo
// grava uma linha nova, então `count(distinct carta_id)` também devolve 95. A
// identidade da carta no mundo é `numero_externo`; `carta_id` é a identidade da
// LINHA. Um vigia escrito com o campo de aparência mais óbvia — o que tem "id"
// no nome — nasceria gritando 95 por um problema que são 4.
//
// E o volume de hoje não é alto: é o MENOR da série. Cartas distintas
// quarentenadas por dia, 14 dias: mínimo 4, p50 28, p90 47, máximo 70. Os 4 de
// hoje são o piso histórico. Ou seja: a quarentena não explica o estoque
// parado, e eu tinha oferecido justamente ela como explicação.

export const TIPO_QUARENTENA = "quarentena";
export const CHAVE_QUARENTENA_VOLUME = "volume";

/**
 * 47 cartas distintas por dia = p90 medido em 14 dias (p50 28, máximo 70).
 * O limiar nasce do banco, como o de divergência: abaixo do p90 este vigia
 * alarmaria na metade dos dias normais, e alerta que toca todo dia é alerta
 * que ninguém lê.
 */
export const QUARENTENA_DISTINTAS_DIA = 47;

export function vigiaQuarentenaVolume(entrada: {
  /**
   * Cartas DISTINTAS por `numero_externo` na janela. Quem passar contagem de
   * eventos aqui recebe um alerta falso de volume — é o erro que esta fatia
   * corrigiu, e o nome do campo existe para não deixar repetir.
   */
  cartasDistintas: number;
  /** Eventos brutos. Não entram no julgamento; entram no detalhe, para provar. */
  eventos: number;
  limite?: number;
}): Alerta | null {
  const { cartasDistintas, eventos, limite = QUARENTENA_DISTINTAS_DIA } = entrada;
  if (!Number.isFinite(cartasDistintas) || cartasDistintas < limite) return null;
  return {
    tipo: TIPO_QUARENTENA,
    chave: CHAVE_QUARENTENA_VOLUME,
    severidade: cartasDistintas >= limite * 1.5 ? "grave" : "aviso",
    titulo: `Quarentena alta: ${cartasDistintas} cartas distintas na janela (limiar ${limite})`,
    // `eventos` ao lado de `cartas_distintas` de propósito: quem ler o alerta vê
    // na hora que os dois números são diferentes, e por quê.
    detalhe: { cartas_distintas: cartasDistintas, eventos, limite },
  };
}

/**
 * Reincidência é OUTRA natureza de problema, e por isso é outro alerta.
 *
 * Volume alto = a fonte piorou agora. Reincidência = uma carta específica é
 * lixo permanente do lado do fornecedor, e nenhum ciclo nosso vai consertar:
 * ela vai ser barrada de novo, e de novo, para sempre. O conserto é lá.
 *
 * 24 ciclos = um dia inteiro de sync horário. O limiar saiu da distribuição:
 * das 260 cartas já quarentenadas, 137 (53%) aconteceram UMA vez só — o normal
 * é quarentenar e sumir. p50=1, p90=17. Limiar 12 pegaria 55 cartas, limiar 18
 * pegaria 25, limiar 24 pega 12 em toda a história, espalhadas por 4 dias. O
 * cotovelo está entre 18 e 24, e 24 é o único que também significa alguma coisa
 * fora da estatística: "barrada o dia inteiro".
 *
 * O alerta se resolve sozinho quando a carta para de aparecer — foi o que
 * aconteceu com o lote anterior (98, 520, 413, 565), que reincidiu 161 ciclos
 * por 6,8 dias e cessou em 10/08.
 */
export const CICLOS_REINCIDENTE = 24;

export function vigiaQuarentenaReincidente(entrada: {
  /** Identidade da carta NO MUNDO. Nunca `carta_id`, que muda a cada ciclo. */
  numeroExterno: number;
  fonte: string;
  ciclos: number;
  limite?: number;
}): Alerta | null {
  const { numeroExterno, fonte, ciclos, limite = CICLOS_REINCIDENTE } = entrada;
  if (!Number.isFinite(ciclos) || ciclos < limite) return null;
  return {
    tipo: TIPO_QUARENTENA,
    // Uma condição POR CARTA: cada uma é um conserto diferente, do lado do
    // fornecedor. Agrupar as quatro numa linha só esconderia qual é qual.
    chave: `reincidente:${numeroExterno}`,
    severidade: ciclos >= limite * 2 ? "grave" : "aviso",
    titulo: `${fonte} carta ${numeroExterno}: barrada em ${ciclos} ciclos seguidos — lixo permanente na fonte`,
    detalhe: { numero_externo: numeroExterno, fonte, ciclos, limite },
  };
}

// ---------------------------------------------------------------------------

/** Todos os tipos que o RADAR pode abrir. O painel usa para agrupar. */
export const TIPOS_RADAR = [
  TIPO_DIVERGENCIA,
  TIPO_AMOSTRA,
  TIPO_ESTOQUE,
  TIPO_FAROL,
  TIPO_FILA_SENTINELA,
  TIPO_QUARENTENA,
] as const;

export type { Limiar };
