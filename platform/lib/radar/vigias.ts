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
  /** `null` = NÃO CONSEGUI MEDIR, que não é a mesma coisa que zero. Quem chama
   *  lê uma contagem do banco; leitura que falhou volta null, e null aqui faz o
   *  vigia se calar E o chamador não marcar a condição como julgada — porque
   *  fechar alerta na força de uma leitura que não aconteceu é pior do que não
   *  ter vigia. Antes deste campo ser anulável, a rota fazia `?? 0` e o vigia
   *  gritava "não publicou" quando a verdade era "não perguntei". */
  publicadosHoje: number | null;
  horaLimite?: number;
  /** Início do dia SP considerado na contagem, só para o detalhe: quem lê o
   *  alerta precisa saber qual janela foi medida, não só o resultado. */
  desde?: string;
}): Alerta | null {
  const { horaSP, publicadosHoje, horaLimite = HORA_COBRANCA_FAROL, desde } = entrada;
  if (publicadosHoje === null || !Number.isFinite(publicadosHoje)) return null;
  if (!Number.isFinite(horaSP) || horaSP < horaLimite) return null;
  if (publicadosHoje > 0) return null;
  return {
    tipo: TIPO_FAROL,
    chave: CHAVE_FAROL_SEM_PUBLICAR,
    severidade: "aviso",
    /* O título NÃO embute a hora da observação. `radar_registrar` reescreve
     * `titulo` a cada ocorrência (`titulo = p_titulo` no ramo do UPDATE), então
     * o título seguia a ÚLTIMA varredura enquanto o painel imprime, ao lado,
     * "aberta há X" vindo de `primeira_vez`. O resultado era uma linha que se
     * contradizia: "até as 21h", aberta desde as 18h. O limite é CONSTANTE, a
     * hora corrente não — então só a constante entra no título, e a hora da
     * medição fica no detalhe, onde ser sobrescrita é o comportamento certo. */
    titulo: `FAROL não publicou nada hoje (cobrança a partir das ${horaLimite}h)`,
    detalhe: {
      hora_sp: horaSP,
      limite: horaLimite,
      publicados: publicadosHoje,
      ...(desde ? { desde } : {}),
    },
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
// VIGIA 8 — o Sentinela ENVIA e a Meta recusa
// AUTORIZADO: Emerson, 19/08/2026 — "vigia envio_falha >= N no Radar — 60
// falhas em silêncio nunca mais".
// ---------------------------------------------------------------------------
//
// O QUE ACONTECEU, E POR QUE NENHUM VIGIA VIU
//
// Entre 17 e 19/08/2026 a Meta recusou 75 envios com #132001 "Template name
// does not exist in the translation". Cinco ciclos, quinze recusas cada, zero
// entregues:
//
//   2026-08-17 12:00   falhas 15   entregues 0
//   2026-08-17 18:00   falhas 15   entregues 0
//   2026-08-18 12:00   falhas 15   entregues 0
//   2026-08-18 18:00   falhas 15   entregues 0
//   2026-08-19 12:00   falhas 15   entregues 0
//
// O VIGIA 5 estava de pé e ficou mudo o tempo todo — corretamente, aliás: ele
// olha a IDADE da fila, e a fila não envelhecia, porque a varredura passava
// por ela a cada seis horas. O sistema parecia trabalhar. Fazia barulho de
// trabalho. Só não entregava nada.
//
// A lição, e ela é geral: vigiar a fila não é vigiar o envio. Uma fila que
// gira e não entrega é indistinguível de uma fila saudável para quem só mede
// idade.
//
// O LIMIAR, E POR QUE ELE NÃO NASCEU DO BANCO
//
// A doutrina da casa é tirar limiar de percentil do histórico — foi assim com
// QUARENTENA_DISTINTAS_DIA (47) e HORAS_UTEIS_SEM_MOVIMENTO (20). Aqui não deu,
// e o motivo era que a série medida EM 19/08 era degenerada: `ciclos_com_envio
// 5 · min 15 · p50 15 · p90 15 · max 15 · ciclos_limpos 0`. Todo o histórico de
// envio que existia naquele dia era a própria pane. Não havia período saudável
// do qual extrair normalidade, e fabricar percentil de amostra sem variância
// seria dar cara de estatística a um chute.
//
// Então o número foi escolhido por PROPÓSITO, e isto fica escrito: ver
// FALHAS_NO_CICLO abaixo.
//
// ---------------------------------------------------------------------------
// CORREÇÃO MEDIDA EM 23/08/2026 — o parágrafo acima envelheceu
//
// Fica registrado que envelheceu, em vez de reescrito por cima, porque
// comentário desatualizado é a dívida que esta casa paga mais caro: ele descreve
// um mundo que não existe mais e ninguém desconfia, porque comentário não quebra
// teste. A pane terminou em 19/08 entre 12:01 e 18:01. A série já tem variância,
// e `ciclos_limpos` não é mais 0 — são 3:
//
//   ciclo (UTC)        falhas  entregues   veredito deste vigia
//   2026-08-17 12:00       15          0   GRAVE
//   2026-08-17 18:00       15          0   GRAVE
//   2026-08-18 12:00       15          0   GRAVE
//   2026-08-18 18:00       15          0   GRAVE
//   2026-08-19 12:00       15          0   GRAVE
//   2026-08-19 18:00        0         14   calado
//   2026-08-20 12:00        0         14   calado
//   2026-08-21 12:00        0          1   calado
//
// Isto é o CONTROLE que a Regra 9 exige, e ele veio de graça do dado real: cinco
// ciclos em que o vigia acusa, três em que ele cala, e NENHUM ciclo na zona
// cinzenta. O limiar 3 cai no vão entre 0 e 15 sem encostar em nenhum dos dois
// lados. O número segue escolhido por propósito — mas agora existe amostra
// saudável provando que ele não grita à toa, que é o que faltava em 19/08.

export const TIPO_ENVIO_SENTINELA = "sentinela_envio";
export const CHAVE_ENVIO_FALHANDO = "falhando";

/**
 * TRÊS falhas no mesmo ciclo.
 *
 * Uma falha é rotina: número que não existe mais, pessoa que bloqueou, um
 * timeout. Duas podem ser coincidência no mesmo segundo de instabilidade da
 * Graph. Três, no mesmo ciclo, deixa de ser sobre as pessoas e passa a ser
 * sobre nós — token, template, WABA, payload.
 *
 * O número precisa ser BAIXO por uma razão que o teto da janela impõe: a
 * varredura envia no máximo 15 por execução (MAX_ENVIOS_POR_EXECUCAO), e à
 * medida que a fila drena os ciclos ficam pequenos. Um limiar de 10 ou 15
 * ficaria cego justamente no ciclo de 4 pessoas em que 4 falham — que é tão
 * sistêmico quanto 15 de 15, e mais difícil de perceber.
 */
export const FALHAS_NO_CICLO = 3;

/**
 * Abre alerta quando o ciclo de envio do Sentinela falha em volume.
 *
 * REGRA 19 APLICADA NOS DOIS CONTADORES. `falhas` e `feitos` são
 * `number | null`, e null é "não consegui medir", não zero:
 *
 *   `falhas === null`  ⇒ não julga. Um `?? 0` aqui faria a leitura falha
 *                        virar "nenhuma falha" e o vigia calaria exatamente
 *                        no dia em que o log não respondesse — que é um dia
 *                        suspeito, não um dia limpo.
 *
 *   `feitos === null`  ⇒ julga as falhas, que FORAM medidas, mas não afirma
 *                        "nada passou". A severidade cai para aviso e o null
 *                        viaja visível no detalhe. Calar sobre 15 falhas
 *                        medidas porque o outro contador não veio seria pior
 *                        que a imprecisão da severidade.
 *
 * A SEVERIDADE separa duas coisas que a contagem crua confunde:
 *
 *   grave  — falhou o bastante E **nada saiu** (`feitos === 0`). É a
 *            assinatura da pane sistêmica: o problema não é de quem recebe,
 *            é do que mandamos. Foi este o caso dos cinco ciclos.
 *
 *   aviso  — falhou o bastante mas ALGO saiu. O canal funciona; o defeito é
 *            por destinatário. Merece olhar, não merece acordar ninguém.
 */
export function vigiaEnvioSentinela(entrada: {
  falhas: number | null;
  feitos: number | null;
  limite?: number;
}): Alerta | null {
  const { falhas, feitos, limite = FALHAS_NO_CICLO } = entrada;
  if (falhas === null || !Number.isFinite(falhas)) return null;
  if (falhas < limite) return null;

  const nadaSaiu = feitos === 0;
  const total = feitos === null || !Number.isFinite(feitos) ? null : feitos + falhas;
  return {
    tipo: TIPO_ENVIO_SENTINELA,
    chave: CHAVE_ENVIO_FALHANDO,
    severidade: nadaSaiu ? "grave" : "aviso",
    titulo: nadaSaiu
      ? `Sentinela: ${falhas} envios recusados e NENHUM entregue no ciclo`
      : `Sentinela: ${falhas} envios recusados no ciclo` +
        (total === null ? " (entregues não medidos)" : ` de ${total} tentados`),
    detalhe: {
      falhas,
      // Viaja como null de propósito. Quem ler o alerta precisa distinguir
      // "zero entregues" de "não sei quantos entregaram".
      feitos: feitos === null || !Number.isFinite(feitos) ? null : feitos,
      limite,
    },
  };
}

/**
 * A janela é JULGÁVEL? — a pergunta que a varredura tem de fazer ANTES de
 * `marcar()`, e a razão de ela morar aqui e não em linha na rota.
 *
 * O PROBLEMA, MEDIDO EM 23/08/2026. Marcar uma condição como julgada autoriza a
 * FASE 3 a FECHAR o alerta aberto dela. Este vigia cala quando `falhas` está
 * abaixo do limite — e cala igualzinho quando ninguém tentou enviar coisa
 * alguma. As duas coisas chegariam à FASE 3 como "condição passou".
 *
 * E o segundo caso é o NORMAL, não a exceção. A aritmética dos dois crons:
 *
 *   - Sentinela envia em `0 12,18 * * *` — duas vezes por dia.
 *   - A varredura roda de 3 em 3 horas no minuto 20 — oito vezes por dia,
 *     olhando 3h para trás. (O cron está em `vercel.json`; ele não cabe escrito
 *     aqui porque a barra-asterisco do campo de hora FECHA este comentário.
 *     Descobri isso derrubando o arquivo inteiro: o `tsc` acusou erro de sintaxe
 *     240 linhas adiante, num trecho intocado, e o defeito estava aqui.)
 *
 * Só as passagens de 12:20 e 18:20 enxergam envio. Nas outras SEIS a janela
 * está vazia por desenho. Sem esta guarda, seis vezes por dia a varredura
 * declararia o envio saudável sem ter visto uma tentativa sequer — e fecharia
 * um alerta legítimo de pane usando como prova o silêncio do relógio. Medido no
 * instante em que isto foi escrito: último envio 21/08 12:01, `44,2h` atrás,
 * `envios_na_janela_3h = 0`. A pane de 75 recusas seria apagada por uma janela
 * em que ninguém tentou nada.
 *
 * A ORDEM DAS PORTAS não é arbitrária:
 *
 *   1. `falhas === null` ⇒ não julga. Não medi o que decide o alarme.
 *   2. `falhas >= limite` ⇒ JULGA, mesmo sem `feitos`. Esta porta vem ANTES da
 *      de `feitos` de propósito: o vigia alarma com as falhas que FORAM medidas,
 *      e recusar-se a julgar aqui trocaria um alerta certo por silêncio cômodo.
 *   3. `feitos === null` ⇒ não julga. Falhas abaixo do limite e entregues não
 *      medidos: não dá para afirmar que o ciclo foi saudável, e só quem afirma
 *      isso tem direito de fechar alerta.
 *   4. `falhas + feitos === 0` ⇒ não julga. Ninguém tentou. Mesmo princípio do
 *      `ciclosNoPeriodo <= 0` do vigia de movimento: o silêncio é do ciclo.
 *
 * Sobra um único caminho para o fechamento automático: os dois contadores
 * medidos, pelo menos uma tentativa na janela, e as falhas abaixo do limite —
 * que é a definição exata de "vi o envio funcionar".
 */
export function envioSentinelaJulgavel(entrada: {
  falhas: number | null;
  feitos: number | null;
  limite?: number;
}): { julgar: boolean; motivo: string | null } {
  const { falhas, feitos, limite = FALHAS_NO_CICLO } = entrada;

  if (falhas === null || !Number.isFinite(falhas)) {
    return { julgar: false, motivo: "contagem de falhas indisponivel" };
  }
  if (falhas >= limite) return { julgar: true, motivo: null };
  if (feitos === null || !Number.isFinite(feitos)) {
    return { julgar: false, motivo: "entregues nao medidos e falhas abaixo do limite" };
  }
  if (falhas + feitos === 0) {
    return { julgar: false, motivo: "nenhuma tentativa de envio na janela" };
  }
  return { julgar: true, motivo: null };
}

// ---------------------------------------------------------------------------
// VIGIA 9 — HANDOFF MUDO: o bastão passou e ninguém pegou
// AUTORIZADO: coordenação, 21/08/2026 — HANDOFF-01 item (c).
// ---------------------------------------------------------------------------
//
// A CONDIÇÃO
//
// `wa_conversas.agente_ativo` foi trocado, algum agente de conversa já havia
// falado, e o agente que está ativo AGORA nunca falou uma linha. O cliente ficou
// olhando para a última fala de quem se despediu. Ninguém do outro lado.
//
// Isto é dinheiro parado, não higiene: cada linha aqui é uma pessoa que pediu
// alguma coisa e foi transferida para o silêncio.
//
// POR QUE CHAVE ÚNICA DE VOLUME, E NÃO UMA POR CONVERSA
//
// Medido em 21/08 em produção: 16 conversas neste estado. O painel corta em 12
// linhas (`TETO_LINHAS` em RadarAlertas.tsx). Uma chave por conversa abriria 16
// alertas de uma vez e empurraria os outros oito vigias para fora da tela —
// dívida histórica apagando a vigilância corrente. Um alerta, contagem no
// título, quebra por agente no detalhe. Mesmo padrão de CHAVE_QUARENTENA_VOLUME.
//
// O LIMIAR É 1, E ISSO NÃO É PREGUIÇA DE MEDIR
//
// Em quarentena e em estoque o limiar sai de percentil porque existe um volume
// NORMAL: quarentenar cartas é o sistema funcionando. Aqui não existe volume
// normal. A abertura ativa do handoff leva segundos; qualquer conversa parada
// neste estado por mais de meia hora é defeito, não ritmo. O valor saudável é
// zero, e um percentil de uma série cujo valor saudável é zero não é
// estatística, é enfeite. Declarado, como em FALHAS_NO_CICLO.
//
// O QUE A MEDIÇÃO DE HOJE DIZ SOBRE O CORTE DE 30 MINUTOS
//
// Nenhuma das 16 é recente: a mais nova tem 49,7h e a mais velha 384,3h
// (valentina 10 · caetano 3 · tobias 2 · bento 1). Ou seja, hoje o corte de
// meia hora não separa nada — todas passam. Ele fica assim mesmo, porque é a
// definição certa da condição e porque, depois que a abertura ativa entrar no
// ar, é justamente ele que vai distinguir "acabou de passar o bastão" de
// "passou e morreu".

export const TIPO_HANDOFF = "handoff";
export const CHAVE_HANDOFF_MUDO = "mudo";

/**
 * Minutos que uma conversa pode ficar com agente novo calado antes de contar.
 *
 * Vive aqui, e não solto na consulta, porque quem MEDE (a rota de varredura) e
 * quem JULGA (esta função) precisam concordar no mesmo número. Se a consulta
 * filtrar 30 e o título disser 60, o alerta mente sobre a própria régua.
 */
export const MINUTOS_HANDOFF_MUDO = 30;

/** Conversas mudas a partir das quais o vigia abre. Ver o bloco acima. */
export const HANDOFF_MUDO_MINIMO = 1;

/** Horas de espera a partir das quais deixa de ser aviso e vira grave. */
export const HORAS_HANDOFF_GRAVE = 24;

export function vigiaHandoffMudo(entrada: {
  /**
   * Conversas com agente ativo que nunca falou, já filtradas por
   * MINUTOS_HANDOFF_MUDO. `null` = NÃO CONSEGUI MEDIR (Regra 19): a leitura
   * falhou. Um `?? 0` aqui transformaria banco mudo em "nenhuma conversa
   * parada" — e o chamador ainda fecharia o alerta legítimo que estivesse
   * aberto, porque teria marcado a condição como julgada.
   */
  mudas: number | null;
  /** Idade da mais antiga, em horas. `null` quando não medida. */
  maisAntigaHoras: number | null;
  /** Quebra por agente que ficou parado. Só detalhe; não entra no julgamento. */
  porAgente?: Readonly<Record<string, number>>;
  limite?: number;
  horasGrave?: number;
}): Alerta | null {
  const {
    mudas,
    maisAntigaHoras,
    porAgente,
    limite = HANDOFF_MUDO_MINIMO,
    horasGrave = HORAS_HANDOFF_GRAVE,
  } = entrada;
  if (mudas === null || !Number.isFinite(mudas)) return null;
  if (mudas < limite) return null;

  // Idade não medida NÃO promove a grave: severidade alta precisa de prova.
  const velha =
    maisAntigaHoras !== null &&
    Number.isFinite(maisAntigaHoras) &&
    maisAntigaHoras >= horasGrave;

  const sufixo =
    maisAntigaHoras === null || !Number.isFinite(maisAntigaHoras)
      ? " (idade da mais antiga não medida)"
      : ` — a mais antiga há ${Math.floor(maisAntigaHoras)}h`;

  return {
    tipo: TIPO_HANDOFF,
    chave: CHAVE_HANDOFF_MUDO,
    severidade: velha ? "grave" : "aviso",
    titulo: `${mudas} conversa(s) com agente novo que nunca falou${sufixo}`,
    detalhe: {
      mudas,
      // null viaja visível: "zero horas" e "não sei há quanto tempo" são coisas
      // diferentes, e quem lê o alerta precisa poder distinguir.
      mais_antiga_horas:
        maisAntigaHoras === null || !Number.isFinite(maisAntigaHoras)
          ? null
          : Math.floor(maisAntigaHoras),
      minutos_minimos: MINUTOS_HANDOFF_MUDO,
      limite,
      horas_grave: horasGrave,
      ...(porAgente && Object.keys(porAgente).length > 0
        ? { por_agente: porAgente }
        : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// VIGIA 10 — CONTEÚDO VAZIO: a mensagem do cliente entrou sem nada para ler
// AUTORIZADO: coordenação, 28/08/2026 — OUVIDO-01 v2 item (e).
// ---------------------------------------------------------------------------
//
// A CONDIÇÃO
//
// Uma linha de `wa_mensagens` com `papel = 'cliente'` cujo `conteudo` está nulo
// ou só com espaço. O cérebro não tem o que ler, o turno entra vazio, e o
// cliente não é respondido. Não é higiene de dados: é uma pessoa que falou e
// não foi ouvida.
//
// ESTE VIGIA NASCE DEPOIS DO CONSERTO, E É ISSO QUE ELE MEDE
//
// Os itens (b) e (c) desta mesma fatia fecharam o buraco por dois lados — a
// transcrição no caminho, e a rede honesta (`mereceRede`) quando a transcrição
// falha ou o tipo não é transcrevível. Depois deles, conteúdo vazio de cliente
// deixou de ser possível POR DESENHO.
//
// "Impossível por desenho" é uma afirmação sobre o código que eu escrevi, não
// sobre o mundo. Este vigia é o que torna essa afirmação verificável todo dia:
// se ele fica mudo, a rede segurou; se ele grita, alguma coisa furou a rede e
// nós ficamos sabendo no mesmo dia, em vez de descobrir por um cliente que
// sumiu. A ordem escreveu "o vigia FICA"; a medição corrigiu para NASCE — ele
// nunca existiu.
//
// O LIMIAR É 1, DECLARADO — E A JANELA É O QUE DEIXA ELE CALAR
//
// Medido em 28/08/2026 no xtv, 431 mensagens de cliente: 6 vazias, TODAS de
// espaço em branco, NENHUMA nula. Por dia, em 30 dias: 23 dias com movimento,
// e só 3 deles com vazias (23/08: 1 · 20/08: 2 · 06/08: 2). Vinte dias em zero.
//
// O valor saudável é zero, e percentil de série cujo valor saudável é zero não
// é estatística, é enfeite — mesma razão de HANDOFF_MUDO_MINIMO e de
// FALHAS_NO_CICLO. Declarado em 1.
//
// A JANELA não é detalhe: as seis vazias são históricas e anteriores ao
// conserto. Sem janela, este vigia nasceria aberto sobre uma ferida já costurada
// e NUNCA fecharia, porque a história não muda. Alerta permanentemente aceso é
// ruído, e ruído treina a pessoa a fechar o painel sem ler — exatamente o
// defeito que a correção de 16/08 tirou do vigia de movimento. Com janela, a
// condição se resolve sozinha quando para de acontecer, como `reincidente:*`.
//
// POR QUE O GRAVE É 3, E POR QUE NÃO É PROPORÇÃO
//
// 3 fica um acima do PIOR dia já medido (2) na era em que o defeito estava
// solto. Uma vazia depois do conserto já é furo e merece aviso; três num dia é
// mais do que o sistema quebrado produzia, e isso é outra categoria de notícia.
//
// Considerei promover a grave por proporção (`vazias === total` seria surdez
// completa na janela) e RECUSEI: não tenho um único episódio medido desse
// formato, e limiar sem medição por trás é decoração. `total` viaja no detalhe
// justamente para que a pessoa faça esse juízo com o número na frente — 2 em 42
// e 2 em 2 são situações diferentes, e a contagem sozinha não separa as duas.
//
// `por_tipo` É A PERÍCIA QUE OS SEIS CASOS HISTÓRICOS NÃO TÊM
//
// Medido: as seis vazias têm `tipo`, `media_id` e `mime_type` TODOS nulos — são
// anteriores à 0091, que criou a coluna `tipo`. Não há como saber o que eram.
// Por isso eu NÃO afirmo que a rede de (b)+(c) cobre esses seis casos: não
// tenho o dado para afirmar. `por_tipo` garante que o PRÓXIMO furo chegue com a
// perícia junto — o operador vê QUAL tipo passou, não só que passou.

export const TIPO_CONTEUDO_VAZIO = "conteudo_vazio";
export const CHAVE_CONTEUDO_VAZIO = "cliente";

/**
 * Janela de contagem, em horas.
 *
 * Vive aqui, e não solta na chamada da RPC, pelo mesmo motivo de
 * MINUTOS_HANDOFF_MUDO: quem MEDE (a rota de varredura) e quem JULGA (esta
 * função) têm de concordar no mesmo número. Se a RPC contar 24h e o título
 * disser 48h, o alerta mente sobre a própria régua.
 */
export const HORAS_CONTEUDO_VAZIO = 24;

/** Vazias a partir das quais o vigia abre. Ver o bloco acima: declarado. */
export const CONTEUDO_VAZIO_MINIMO = 1;

/** Vazias a partir das quais deixa de ser aviso e vira grave. */
export const CONTEUDO_VAZIO_GRAVE = 3;

export function vigiaConteudoVazio(entrada: {
  /**
   * Mensagens de cliente que entraram sem conteúdo na janela. `null` = NÃO
   * CONSEGUI MEDIR (Regra 19): a RPC falhou. Um `?? 0` aqui transformaria banco
   * mudo em "nenhuma mensagem perdida" — a pior mentira possível para este
   * vigia em particular, porque ele existe justamente para provar um zero.
   */
  vazias: number | null;
  /**
   * Total de mensagens de cliente na MESMA janela. Não entra no julgamento;
   * viaja no detalhe para dar escala à contagem. `null` quando não medido.
   */
  total: number | null;
  /** Quebra por tipo das vazias. Só perícia; não entra no julgamento. */
  porTipo?: Readonly<Record<string, number>>;
  horas?: number;
  limite?: number;
  limiteGrave?: number;
}): Alerta | null {
  const {
    vazias,
    total,
    porTipo,
    horas = HORAS_CONTEUDO_VAZIO,
    limite = CONTEUDO_VAZIO_MINIMO,
    limiteGrave = CONTEUDO_VAZIO_GRAVE,
  } = entrada;
  if (vazias === null || !Number.isFinite(vazias)) return null;
  if (vazias < limite) return null;

  const severidade: Severidade = vazias >= limiteGrave ? "grave" : "aviso";

  // O total só entra no título quando foi medido. "de 0" seria pior que omitir.
  const escala =
    total === null || !Number.isFinite(total) ? "" : ` de ${total}`;

  return {
    tipo: TIPO_CONTEUDO_VAZIO,
    chave: CHAVE_CONTEUDO_VAZIO,
    severidade,
    titulo: `${vazias}${escala} mensagem(ns) de cliente entraram sem conteúdo nas últimas ${horas}h`,
    detalhe: {
      vazias,
      // null viaja visível: "zero mensagens na janela" e "não sei quantas
      // mensagens houve" são coisas diferentes para quem lê o alerta.
      total: total === null || !Number.isFinite(total) ? null : total,
      horas,
      limite,
      limite_grave: limiteGrave,
      ...(porTipo && Object.keys(porTipo).length > 0 ? { por_tipo: porTipo } : {}),
    },
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
  TIPO_ENVIO_SENTINELA,
  TIPO_QUARENTENA,
  TIPO_HANDOFF,
  TIPO_CONTEUDO_VAZIO,
] as const;

export type { Limiar };
