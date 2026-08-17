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

/**
 * Horas de DIA ÚTIL sem carta nova antes de o silêncio virar alerta.
 *
 * CORREÇÃO DE 16/08/2026, e ela desfez um defeito meu que já estava no ar.
 * Este limiar nasceu 12, em HORA CORRIDA, escrito antes de eu medir o vão
 * normal entre uma carta e a próxima. A medição, feita depois:
 *
 *   15h  qui 13/08 18h → sex 14/08 08h   noite comum
 *   14h  ter 11/08 19h → qua 12/08 08h   noite comum
 *   14h, 14h, 13h                        outras noites comuns
 *   62h  sex 07/08 19h → seg 10/08 08h   fim de semana
 *
 * Ou seja: em hora corrida, 12 dispararia TODA NOITE, e duas vezes por fim de
 * semana. Vigia que toca todo dia não é vigia — é o ruído que treina a pessoa a
 * fechar a tela sem ler, e aí o dia em que ele estiver certo não vai importar.
 *
 * Contado em hora útil, a maior parada NORMAL é 15 (as noites continuam
 * somando, porque a noite de terça é hora de quarta; o fim de semana some do
 * denominador). 20 dá uma folga de um terço sobre o pior normal observado — o
 * suficiente para não alarmar num feriado de emenda ou numa manhã lenta, e
 * pouco o bastante para que uma segunda-feira inteira parada apareça no mesmo
 * dia.
 */
export const HORAS_UTEIS_SEM_MOVIMENTO = 20;

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
 * "SYNC SAUDÁVEL QUE NÃO MOVE NADA" — o vigia que a ordem chamou de mais
 * importante de todos, e o único cuja primeira versão eu escrevi errado.
 *
 * A condição é esta: o sync se declara bem — fontes_ok, fontes_falha zero, os
 * ciclos rodando de hora em hora — e mesmo assim nenhuma carta nova entra. É a
 * mesma família do `sync_raw_ausente`: o sistema passa no próprio exame
 * enquanto para de fazer o trabalho. O vigia de NÍVEL não pega isso, porque o
 * nível não caiu; 2423 disponíveis é número saudável enquanto a vitrine
 * envelhece por baixo.
 *
 * O QUE EU TINHA ESCRITO AQUI, E QUE A MEDIÇÃO DERRUBOU. A versão anterior
 * dizia, como prova de que a condição era real: "1008 cartas novas em 14/08, 1
 * em 15/08, 0 em 16/08". Medi depois, e não havia parada nenhuma. 15/08 é
 * SÁBADO e 16/08 é DOMINGO. Em seis semanas de histórico, TODO domingo é zero —
 * 12/07, 02/08, 09/08, 16/08, sem uma exceção — e sábado é zero em quatro dos
 * seis. O fornecedor publica em dia útil. O silêncio do fim de semana é o
 * comportamento normal do mundo, não um defeito do nosso lado.
 *
 * Por isso a contagem é em HORA ÚTIL (ver `horasUteisEntre`), e não em hora
 * corrida: em hora corrida não existe limiar que sirva. Um que cale a noite
 * (>15) ainda grita todo sábado; um que cale o fim de semana (>62) não vê uma
 * segunda-feira inteira parada. O problema nunca foi o número — era o relógio.
 *
 * A GUARDA DE CONTRADIÇÃO. Só alarma quando o sync se diz SAUDÁVEL. Com fonte
 * falhando, quem explica o silêncio é o vigia de divergência ou o de amostra,
 * que sabem QUAL fonte caiu; este abriria uma segunda linha dizendo "nada se
 * moveu" sem acrescentar nada, e duas linhas para um problema só é como um
 * painel deixa de ser lido.
 */
export function vigiaEstoqueSemMovimento(entrada: {
  /**
   * Horas de DIA ÚTIL desde a última carta nova. O nome carrega a unidade de
   * propósito: passar hora corrida aqui faz o vigia disparar toda noite, que
   * foi exatamente o defeito corrigido em 16/08.
   */
  horasUteisSemCartaNova: number;
  ciclosNoPeriodo: number;
  /** Fontes que responderam bem no último ciclo. */
  fontesOk?: number;
  /** Fontes que falharam. Qualquer número acima de zero cala este vigia. */
  fontesFalha?: number;
  limiteHoras?: number;
}): Alerta | null {
  const {
    horasUteisSemCartaNova,
    ciclosNoPeriodo,
    fontesOk,
    fontesFalha,
    limiteHoras = HORAS_UTEIS_SEM_MOVIMENTO,
  } = entrada;
  if (!Number.isFinite(horasUteisSemCartaNova) || horasUteisSemCartaNova < limiteHoras) {
    return null;
  }
  // Sem ciclo rodado no período, o silêncio é do cron, não do estoque — e quem
  // avisa disso é o heartbeat, não este vigia. Alarmar aqui apontaria o dedo
  // para o lugar errado.
  if (ciclosNoPeriodo <= 0) return null;

  // A guarda de contradição. `undefined` passa: quem não mediu o estado das
  // fontes não é obrigado a fingir que mediu, e o vigia continua valendo pela
  // parada em si. Zero fontes ok, por outro lado, é sync que não rodou.
  if (Number.isFinite(fontesFalha) && (fontesFalha as number) > 0) return null;
  if (Number.isFinite(fontesOk) && (fontesOk as number) <= 0) return null;

  return {
    tipo: TIPO_ESTOQUE,
    chave: CHAVE_ESTOQUE_SEM_MOVIMENTO,
    severidade: horasUteisSemCartaNova >= limiteHoras * 2 ? "grave" : "aviso",
    // "horas úteis" escrito na cara, porque quem lê o alerta às 22h de um
    // domingo precisa entender por que o número é menor do que o relógio dele
    // sugere.
    titulo: `Sync sem falha e nenhuma carta nova há ${Math.floor(horasUteisSemCartaNova)}h úteis, com ${ciclosNoPeriodo} ciclos rodados`,
    detalhe: {
      horas_uteis: horasUteisSemCartaNova,
      ciclos: ciclosNoPeriodo,
      limite: limiteHoras,
      fontes_ok: fontesOk ?? null,
      fontes_falha: fontesFalha ?? null,
    },
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
