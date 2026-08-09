// ============================================================================
// lib/farol/score.ts — o que rendeu lá fora, e o que a casa deve gravar hoje
// AUTORIZADO: Emerson Gomes dos Santos — FAROL-SCORE-01, 09/08/2026:
//   "algoritmos de análise viral, vídeos e pautas por segmento, encontrar o
//    perfeito. (...) 'Viral' não é views absolutos — é desempenho acima da
//    própria linha de base. Um vídeo com 20 mil views num canal que costuma
//    fazer 2 mil é um sinal MUITO mais forte que 200 mil views num canal de 2
//    milhões: o primeiro rompeu, o segundo só existiu."
// ----------------------------------------------------------------------------
// PARA QUE ISTO EXISTE. O OLHEIRO (0073) traz o que o nicho publicou. Isto lê
// aquela pilha e responde uma pergunta só: QUAL SEGMENTO merece a peça de hoje,
// e com que evidência numérica. Nada aqui escreve roteiro; ele diz onde apontar.
//
// TUDO É PURO. Nenhuma função deste arquivo abre banco, lê env (exceto o
// kill-switch, que mora em segmentos.ts) ou chama rede. Recebe array, devolve
// array. É o que torna a simulação com dados sintéticos possível — e é como o
// Emerson vai ver a cara da recomendação antes de existir dado real.
//
// ============================================================================
// A ARITMÉTICA DA OS, AUDITADA ANTES DE IMPLEMENTAR
// ============================================================================
// A ordem é explícita e foi implementada LITERALMENTE. Onde a medição
// discordou da prosa, a fórmula autorizada prevaleceu e o achado está aqui —
// medição antes de opinião, e a opinião fica declarada em vez de virar código
// silencioso.
//
// ACHADO 1 — RECÊNCIA MULTIPLICATIVA INVERTE O RANKING NO LADO NEGATIVO.
//   `score = composto * exp(-dias/30)`, com `composto` sendo soma de z-scores,
//   que é uma quantidade COM SINAL. Para composto > 0 a recência faz o que se
//   espera: envelheceu, vale menos. Para composto < 0 ela faz o OPOSTO —
//   multiplicar um número negativo por um fator pequeno o aproxima de zero, ou
//   seja, MELHORA a posição dele.
//     z = -2,0 aos 90 dias → -2,0 × 0,0498 = -0,0996
//     z = -2,0 ao 1 dia    → -2,0 × 0,9672 = -1,9344
//   Entre dois vídeos igualmente ruins, o VELHO ganha do novo. Se algum dia a
//   lista de um segmento só tiver vídeos abaixo da média da janela, o topo
//   seria ocupado pelo lixo mais antigo.
//   O QUE FOI FEITO: a fórmula ficou como está (é a especificação autorizada) e
//   a recomendação ganhou uma PORTA DE ELEGIBILIDADE — só entra no top-5 quem
//   tem `composto > 0`, isto é, quem está acima da média da própria janela.
//   Isso torna o defeito inalcançável no caminho de decisão sem reescrever a
//   fórmula por conta própria. E é semanticamente melhor de qualquer forma:
//   "abaixo da média dos concorrentes" não é evidência de pauta nenhuma.
//
// ACHADO 2 — `exp(-dias/30)` NÃO É MEIA-VIDA DE 30 DIAS.
//   O comentário da OS diz "30 dias = meia-vida". A fórmula escrita é uma
//   CONSTANTE DE TEMPO de 30 dias: aos 30 dias ela vale exp(-1) = 0,3679, não
//   0,5. A meia-vida real da fórmula escrita é 30 × ln2 = 20,79 dias.
//   Meia-vida verdadeira de 30 dias seria `exp(-ln2 * dias / 30)`.
//   O QUE FOI FEITO: implementada a FÓRMULA, não a legenda — porque é a fórmula
//   que estava no bloco de código. A constante está isolada em
//   `CONSTANTE_DECAIMENTO_DIAS`, então trocar a intenção é mudar uma linha.
//
// ACHADO 3 — `comentarios` NÃO EXISTE EM `farol_videos`.
//   `engajamento = (likes + comentarios) / max(1, views)` precisa da coluna, e
//   a 0073 gravou views, likes e duracao_s apenas. A boa notícia é que o dado é
//   grátis: `videos.list` já devolve `statistics.commentCount` na MESMA chamada
//   que traz views e likes — custo adicional de cota igual a zero.
//   O QUE FOI FEITO: a migração desta fatia adiciona a coluna, e aqui
//   `comentarios` ausente/nulo entra como 0 (o engajamento fica subestimado,
//   nunca inventado).
//
// ACHADO 4 — DOIS ESQUEMAS DE PESO CONCORREM NA MESMA LISTA.
//   Vídeo com base de canal completa pontua 0,50/0,30/0,20 sobre três termos;
//   vídeo `base_incompleta` pontua 0,60/0,40 sobre dois. São escalas
//   diferentes ordenadas juntas. A OS mandou marcar, e marcar é o que resolve:
//   a flag viaja até a saída e a confiança do segmento cai quando o topo é
//   feito de base incompleta. Não foi normalizado por conta própria.
//
// ACHADO 5 — `duracao-alvo = mediana da duração dos outliers` COLIDE COM A
//   RÉGUA MEDIDA. `duracao_alvo` por fôrma foi MEDIDA em FORMULAS-03 a partir
//   da nossa própria contagem de palavras (25/32/40s de fala). "Mediana da
//   duração dos outliers" traria a duração de vídeo de concorrente no YouTube,
//   que costuma ser de minutos e não diz nada sobre um Short nosso de 25–40s.
//   O QUE FOI FEITO: os dois campos saem lado a lado e com papéis distintos.
//   `duracao_alvo` (o teto que o render obedece) continua vindo da fôrma;
//   `duracao_mercado_s` sai como EVIDÊNCIA, filtrado a durações plausíveis de
//   formato curto, e NUNCA é usado para render.
//
// ACHADO 6 — O `indice` DA PARTE 3 SOMA GRANDEZAS DE UNIDADES DIFERENTES.
//   `0.35*retencao + 0.35*pct_nao_seguidores + 0.20*z(shares+saves) + 0.10*z(leads)`
//   soma frações (0..1) com z-scores (≈ -3..+3). Com retenção de 41%, o termo
//   vale 0,35 × 0,41 = 0,14; o termo de z, com peso menor (0,20), alcança ±0,6.
//   Os termos de menor peso DOMINAM o índice. Implementado literalmente, com o
//   achado declarado — e ele está dormente enquanto a partida a frio valer,
//   porque com menos de 10 peças medidas o interno não decide nada.
//
// ACHADO 7 — A PARTE 3 NÃO TEM FONTE DE DADO. `farol_metricas` não existe em
//   lugar nenhum do repositório (medido por varredura) e FAROL-METRICAS-01 não
//   foi construída. Portanto `indice()` e `agregar()` nascem como funções puras
//   TESTADAS E SEM CHAMADOR: a coleta é de outra OS. Consequência prática: a
//   regra de partida a frio vai disparar em 100% das execuções até lá, e a
//   saída dirá `confianca: 'baixa'` — que é exatamente o comportamento pedido.
//
// ACHADO 8 — O `score` GRAVADO SÓ COMPARA DENTRO DO PRÓPRIO LOTE. z-score é
//   relativo à janela: o mesmo vídeo, sem mudar uma view, muda de score quando
//   a coorte muda. Guardar em `farol_videos` (como a OS pede) está certo para
//   ler o ranking do dia; NÃO serve para série histórica. Por isso
//   `calculado_em` é gravado junto — dois scores com `calculado_em` diferente
//   não são comparáveis, e a coluna é o que deixa isso visível.
//
// ============================================================================
// A DESCOBERTA QUE MUDA O DESENHO DA PARTE 4
// ============================================================================
// Os 8 segmentos da OS SÃO as 8 fôrmas de `formulas.ts`, um a um, na mesma
// ordem (medido; a tabela está em segmentos.ts). Logo o passo "cruzar com o
// índice interno das nossas fôrmas naquele segmento" tem exatamente UM
// candidato por segmento — o índice interno não escolhe fôrma, porque não há
// entre o que escolher.
// A decisão real que esta rotina toma é QUAL SEGMENTO gravar hoje. Fôrma,
// persona e duração-alvo vêm de carona, por `FORMULA_DO_SEGMENTO`. O índice
// interno, quando existir, entra como DESEMPATE e como ajuste de confiança —
// não como seletor de fôrma.
// ============================================================================

import {
  FORMULA_DO_SEGMENTO,
  SEGMENTOS,
  type Segmento,
} from "./segmentos";
import {
  formulaPorId,
  type Formula,
  type Persona,
  type TipoBem,
} from "./formulas";

// ----------------------------------------------------------------------------
// AS CONSTANTES. Todas nomeadas de propósito: a OS é uma ordem viva e cada uma
// destas é um número que o Emerson pode querer mexer sem ler o corpo do código.
// ----------------------------------------------------------------------------

/** Mínimo de vídeos de um canal para a mediana valer como linha de base.
 *  Ordem literal: "min. 5 vídeos; <5 = base_canal indefinida". */
export const MIN_AMOSTRAS_BASE = 5;

/** A coorte do z-score. "z() = z-score dentro da janela de 90 dias". */
export const JANELA_Z_DIAS = 90;

/** A janela da recomendação. "os 5 vídeos externos de maior score na janela de
 *  30 dias". É mais estreita que a do z de propósito: a coorte quer amostra, a
 *  recomendação quer atualidade. */
export const JANELA_RECOMENDACAO_DIAS = 30;

/** O 30 de `exp(-dias/30)`. Ver ACHADO 2: é constante de tempo, e a meia-vida
 *  efetiva dela é 20,79 dias. */
export const CONSTANTE_DECAIMENTO_DIAS = 30;

/** Quantos vídeos por segmento entram na evidência. */
export const TOP_POR_SEGMENTO = 5;

/** Partida a frio: "com menos de 10 peças nossas medidas, o interno NÃO
 *  decide". */
export const MIN_PECAS_INTERNAS = 10;

/** Teto de duração para um vídeo do mercado servir de evidência de formato
 *  curto. Ver ACHADO 5 — acima disto é outro formato e não informa nada sobre
 *  um Short de 25–40s. */
export const TETO_DURACAO_CURTA_S = 180;

/** Pesos com linha de base do canal disponível. */
export const PESOS_COMPLETO = {
  outlier: 0.5,
  velocidade: 0.3,
  engajamento: 0.2,
} as const;

/** Pesos quando `base_canal` é indefinida — "o vídeo entra com peso só de
 *  velocidade+engajamento (0.60/0.40)". */
export const PESOS_INCOMPLETO = {
  velocidade: 0.6,
  engajamento: 0.4,
} as const;

/** Pesos do índice interno da Parte 3. Ver ACHADO 6. */
export const PESOS_INDICE = {
  retencao: 0.35,
  pct_nao_seguidores: 0.35,
  shares_saves: 0.2,
  leads: 0.1,
} as const;

const MS_POR_DIA = 86_400_000;

// ============================================================================
// ESTATÍSTICA — as "20 linhas" que a OS mandou não importar de biblioteca
// ============================================================================

/** Mediana. Array vazio → null (nunca 0: zero é um valor, ausência não é). */
export function mediana(valores: readonly number[]): number | null {
  const v = valores.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const meio = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
}

export function media(valores: readonly number[]): number | null {
  const v = valores.filter((n) => Number.isFinite(n));
  if (v.length === 0) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/** Desvio padrão POPULACIONAL (divide por n). A coorte É a população aqui —
 *  não é amostra de um universo maior, é o conjunto inteiro de vídeos da
 *  janela. Usar n-1 seria corrigir um viés que não existe neste uso. */
export function desvioPadrao(valores: readonly number[]): number | null {
  const v = valores.filter((n) => Number.isFinite(n));
  if (v.length === 0) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const soma = v.reduce((acc, n) => acc + (n - m) * (n - m), 0);
  return Math.sqrt(soma / v.length);
}

/**
 * z-score de cada valor contra a média e o desvio da PRÓPRIA lista.
 *
 * O GUARDA IMPORTA MAIS QUE A FÓRMULA. Com n < 2, ou com todos os valores
 * iguais (desvio zero), a divisão devolveria NaN ou Infinity — e um NaN entra
 * silencioso num `sort`, onde ele não é maior nem menor que nada, e embaralha o
 * ranking sem erro nenhum no log. Nestes casos todo mundo recebe 0, que é a
 * leitura honesta: "ninguém se destaca desta coorte".
 */
export function zScores(valores: readonly number[]): number[] {
  if (valores.length < 2) return valores.map(() => 0);
  const m = media(valores);
  const sd = desvioPadrao(valores);
  if (m === null || sd === null || sd === 0) return valores.map(() => 0);
  return valores.map((n) => (Number.isFinite(n) ? (n - m) / sd : 0));
}

/** `recencia = exp(-dias / 30)`. Ver ACHADO 2 sobre o nome "meia-vida". */
export function recencia(dias: number): number {
  return Math.exp(-Math.max(0, dias) / CONSTANTE_DECAIMENTO_DIAS);
}

/** Idade em dias inteiros, com o piso da OS: "dias = max(1, hoje - publicado_em)".
 *  O piso existe porque `views/dias` explodiria com um vídeo de 2 horas de vida. */
export function diasDesde(publicado: Date, agora: Date): number {
  return Math.max(1, Math.floor((agora.getTime() - publicado.getTime()) / MS_POR_DIA));
}

// ============================================================================
// PARTE 1 — SCORE EXTERNO
// ============================================================================

/** Uma linha de `farol_videos`, tolerante: tudo que o YouTube pode não mandar
 *  vem nulo, e nulo nunca vira número inventado. */
export type VideoBruto = {
  video_id: string;
  canal: string;
  titulo?: string | null;
  publicado_em?: string | Date | null;
  views?: number | null;
  likes?: number | null;
  /** ACHADO 3: coluna nova. Ausente → conta 0, engajamento subestimado. */
  comentarios?: number | null;
  duracao_s?: number | null;
  segmento?: Segmento | null;
};

export type VideoPontuado = {
  video_id: string;
  canal: string;
  titulo: string | null;
  segmento: Segmento | null;
  duracao_s: number | null;
  dias: number;
  velocidade: number;
  engajamento: number;
  /** null quando o canal tem menos de MIN_AMOSTRAS_BASE vídeos, ou quando a
   *  mediana deu 0 (dividir por ela daria Infinity). */
  base_canal: number | null;
  outlier: number | null;
  base_incompleta: boolean;
  /** A soma ponderada dos z, ANTES da recência. É o que a porta de
   *  elegibilidade lê (ACHADO 1). */
  composto: number;
  recencia: number;
  score: number;
  /** Fora da janela do z: pontuado (serve de linha de base) mas nunca
   *  recomendável. */
  fora_da_janela: boolean;
};

/** Um vídeo sem `publicado_em` não tem idade, e sem idade não há velocidade,
 *  recência nem elegibilidade. Exposto para o chamador poder CONTAR o que foi
 *  descartado em vez de descobrir um sumiço silencioso. */
export function pontuavel(v: VideoBruto): boolean {
  return dataDe(v.publicado_em) !== null;
}

function dataDe(valor: string | Date | null | undefined): Date | null {
  if (!valor) return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * O cálculo inteiro da Parte 1, em um passe.
 *
 * DUAS JANELAS DIFERENTES, DE PROPÓSITO. `base_canal` é calculada sobre TODOS
 * os vídeos recebidos do canal — a linha de base quer amostra, e cortá-la em 90
 * dias jogaria fora justamente o histórico que define o "normal" daquele canal.
 * Já o z-score sai da coorte de `janelaDias` — porque comparar um vídeo de
 * ontem com um de 2 anos atrás não é comparar maçã com maçã.
 *
 * Vídeos fora da janela continuam saindo (marcados), porque foram eles que
 * formaram a mediana e sumir com eles esconderia a evidência.
 */
export function pontuar(
  videos: readonly VideoBruto[],
  opcoes?: { agora?: Date; janelaDias?: number },
): VideoPontuado[] {
  const agora = opcoes?.agora ?? new Date();
  const janela = opcoes?.janelaDias ?? JANELA_Z_DIAS;

  // 1) Grandezas cruas por vídeo.
  const base = videos
    .map((v) => {
      const publicado = dataDe(v.publicado_em);
      if (publicado === null) return null;
      const dias = diasDesde(publicado, agora);
      const views = num(v.views);
      const velocidade = views / dias;
      const engajamento = (num(v.likes) + num(v.comentarios)) / Math.max(1, views);
      return { v, dias, velocidade, engajamento };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // 2) Linha de base por canal, sobre TODO o histórico recebido.
  const porCanal = new Map<string, number[]>();
  for (const b of base) {
    const lista = porCanal.get(b.v.canal);
    if (lista) lista.push(b.velocidade);
    else porCanal.set(b.v.canal, [b.velocidade]);
  }
  const baseDoCanal = new Map<string, number | null>();
  for (const [canal, velocidades] of porCanal) {
    if (velocidades.length < MIN_AMOSTRAS_BASE) {
      baseDoCanal.set(canal, null); // "nunca inventar mediana com 2 amostras"
      continue;
    }
    const m = mediana(velocidades);
    // Mediana 0 (canal com metade dos vídeos zerados) dividiria em Infinity.
    baseDoCanal.set(canal, m !== null && m > 0 ? m : null);
  }

  // 3) A coorte do z: só quem está dentro da janela.
  const dentro = base.filter((b) => b.dias <= janela);

  // Três coortes, não uma. A do outlier exclui quem não tem outlier — incluir
  // um zero de mentira para eles deslocaria a média de todo mundo.
  const comOutlier = dentro
    .map((b) => {
      const bc = baseDoCanal.get(b.v.canal) ?? null;
      return bc === null ? null : { b, outlier: b.velocidade / bc };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const zOutlier = zScores(comOutlier.map((x) => Math.log1p(x.outlier)));
  const zVelocidade = zScores(dentro.map((b) => Math.log1p(b.velocidade)));
  const zEngajamento = zScores(dentro.map((b) => b.engajamento));

  const zOutlierPorId = new Map<string, number>();
  comOutlier.forEach((x, i) => zOutlierPorId.set(x.b.v.video_id, zOutlier[i]));
  const zVelPorId = new Map<string, number>();
  const zEngPorId = new Map<string, number>();
  dentro.forEach((b, i) => {
    zVelPorId.set(b.v.video_id, zVelocidade[i]);
    zEngPorId.set(b.v.video_id, zEngajamento[i]);
  });

  // 4) Composto, recência, score.
  return base.map((b) => {
    const bc = baseDoCanal.get(b.v.canal) ?? null;
    const outlier = bc === null ? null : b.velocidade / bc;
    const base_incompleta = outlier === null;
    const fora_da_janela = b.dias > janela;

    const zv = zVelPorId.get(b.v.video_id) ?? 0;
    const ze = zEngPorId.get(b.v.video_id) ?? 0;
    const zo = zOutlierPorId.get(b.v.video_id) ?? 0;

    const composto = base_incompleta
      ? PESOS_INCOMPLETO.velocidade * zv + PESOS_INCOMPLETO.engajamento * ze
      : PESOS_COMPLETO.outlier * zo +
        PESOS_COMPLETO.velocidade * zv +
        PESOS_COMPLETO.engajamento * ze;

    const rec = recencia(b.dias);

    return {
      video_id: b.v.video_id,
      canal: b.v.canal,
      titulo: b.v.titulo ?? null,
      segmento: b.v.segmento ?? null,
      duracao_s: typeof b.v.duracao_s === "number" ? b.v.duracao_s : null,
      dias: b.dias,
      velocidade: b.velocidade,
      engajamento: b.engajamento,
      base_canal: bc,
      outlier,
      base_incompleta,
      composto,
      recencia: rec,
      score: composto * rec,
      fora_da_janela,
    };
  });
}

// ============================================================================
// PARTE 3 — SCORE INTERNO
// ----------------------------------------------------------------------------
// FUNÇÕES PURAS SEM COLETOR. `farol_metricas` não existe e FAROL-METRICAS-01
// não foi construída (ACHADO 7). O que está aqui é a matemática, testada com
// fixture, pronta para o dia em que houver dado. Nada nesta seção é chamado por
// rota nenhuma hoje — e é assim de propósito, não por esquecimento.
// ============================================================================

export type MetricaPeca = {
  peca_id: string;
  /** id da fôrma: "P1".."P8". */
  formula: string;
  persona: Persona;
  segmento: Segmento | null;
  /** Retenção média, FRAÇÃO 0..1 (41% = 0.41). Ver ACHADO 6. */
  retencao: number;
  /** Alcance em não-seguidores, FRAÇÃO 0..1. */
  pct_nao_seguidores: number;
  salvamentos: number;
  compartilhamentos: number;
  comentarios: number;
  /** Conversas novas com origem naquele dia. */
  leads: number;
};

export type PecaIndexada = MetricaPeca & { indice: number };

/**
 * `indice = 0.35*retencao + 0.35*pct_nao_seguidores + 0.20*z(shares+saves) + 0.10*z(leads)`
 *
 * Os dois z saem da coorte de peças passada na chamada — por isso a função
 * recebe a LISTA e não uma peça: um índice de peça isolada não existe.
 */
export function indices(pecas: readonly MetricaPeca[]): PecaIndexada[] {
  const zEngajo = zScores(pecas.map((p) => num(p.compartilhamentos) + num(p.salvamentos)));
  const zLeads = zScores(pecas.map((p) => num(p.leads)));
  return pecas.map((p, i) => ({
    ...p,
    indice:
      PESOS_INDICE.retencao * num(p.retencao) +
      PESOS_INDICE.pct_nao_seguidores * num(p.pct_nao_seguidores) +
      PESOS_INDICE.shares_saves * zEngajo[i] +
      PESOS_INDICE.leads * zLeads[i],
  }));
}

export type Agregado = {
  chave: string;
  n: number;
  media: number;
  minimo: number;
  maximo: number;
};

/**
 * "Agregar por fôrma, por persona e por segmento: média + intervalo (n pequeno
 * mostra o n, sempre)."
 *
 * `n` é campo obrigatório da saída justamente para que ninguém consiga exibir a
 * média sem exibir de quantas peças ela veio.
 */
export function agregar(
  pecas: readonly PecaIndexada[],
  por: "formula" | "persona" | "segmento",
): Agregado[] {
  const grupos = new Map<string, number[]>();
  for (const p of pecas) {
    const chave = String(p[por] ?? "sem_" + por);
    const lista = grupos.get(chave);
    if (lista) lista.push(p.indice);
    else grupos.set(chave, [p.indice]);
  }
  return [...grupos.entries()]
    .map(([chave, vs]) => ({
      chave,
      n: vs.length,
      media: media(vs) ?? 0,
      minimo: Math.min(...vs),
      maximo: Math.max(...vs),
    }))
    .sort((a, b) => b.media - a.media);
}

// ============================================================================
// PARTE 4 — O CASAMENTO
// ============================================================================

export type Confianca = "baixa" | "media" | "alta";

export type EvidenciaVideo = {
  video_id: string;
  titulo: string | null;
  canal: string;
  outlier: number | null;
  score: number;
  dias: number;
  base_incompleta: boolean;
};

export type RecomendacaoSegmento = {
  segmento: Segmento;
  formula: string;
  persona: Persona;
  /** O TETO da fôrma, medido em FORMULAS-03. É o que o render obedece. */
  duracao_alvo: number;
  /** Mediana da duração dos vídeos de evidência, filtrada a formato curto.
   *  EVIDÊNCIA APENAS — nunca alimenta render (ACHADO 5). */
  duracao_mercado_s: number | null;
  score_medio: number;
  outlier_medio: number | null;
  n_videos: number;
  /** true se QUALQUER vídeo do topo entrou sem linha de base do canal. */
  base_incompleta: boolean;
  /** null enquanto a partida a frio valer. */
  indice_interno: number | null;
  n_pecas_internas: number;
  confianca: Confianca;
  por_que: string;
  top: readonly EvidenciaVideo[];
};

export type SaidaRecomendacao = {
  gerado_em: string;
  /** true quando temos menos de MIN_PECAS_INTERNAS peças medidas. */
  partida_a_frio: boolean;
  n_pecas_medidas: number;
  confianca: Confianca;
  /** Ordenados por força da evidência externa. O primeiro é a recomendação. */
  segmentos: readonly RecomendacaoSegmento[];
  /** Segmento sem evidência elegível, ou incompatível com o tipo do dia.
   *  Sai com o motivo escrito para o painel não precisar adivinhar. */
  sem_recomendacao: readonly { segmento: Segmento; motivo: string }[];
};

function n1(v: number): string {
  return v.toFixed(1).replace(".", ",");
}

function pct(v: number): string {
  return Math.round(v * 100) + "%";
}

/**
 * A rotina do "encontrar o perfeito".
 *
 * COMO ELA DECIDE, na ordem:
 *  1. Filtra a evidência: dentro de JANELA_RECOMENDACAO_DIAS, com segmento
 *     classificado, e `composto > 0` — a porta do ACHADO 1.
 *  2. Agrupa por segmento, ordena por score, pega TOP_POR_SEGMENTO.
 *  3. Descarta segmento cuja fôrma não serve ao tipo de carta do dia (uma
 *     recomendação de P7 num dia de imóvel não é recomendação, é ruído).
 *  4. Ordena os segmentos por score médio da evidência.
 *  5. Se houver 10+ peças nossas medidas, o índice interno entra como ajuste;
 *     abaixo disso ele NÃO decide e a confiança é 'baixa' — literal da OS.
 */
export function recomendarPauta(entrada: {
  videos: readonly VideoPontuado[];
  pecas?: readonly MetricaPeca[];
  agora?: Date;
  /** Tipo da carta do dia. Omitido = não filtra por tipo. */
  tipo?: TipoBem;
  janelaDias?: number;
}): SaidaRecomendacao {
  const agora = entrada.agora ?? new Date();
  const janela = entrada.janelaDias ?? JANELA_RECOMENDACAO_DIAS;
  const pecas = entrada.pecas ?? [];

  const n_pecas_medidas = pecas.length;
  const partida_a_frio = n_pecas_medidas < MIN_PECAS_INTERNAS;

  // O interno só é calculado quando tem direito de opinar.
  const agregadoPorSegmento = new Map<string, Agregado>();
  const agregadoPorFormula = new Map<string, Agregado>();
  if (!partida_a_frio) {
    const idx = indices(pecas);
    for (const a of agregar(idx, "segmento")) agregadoPorSegmento.set(a.chave, a);
    for (const a of agregar(idx, "formula")) agregadoPorFormula.set(a.chave, a);
  }

  const elegiveis = entrada.videos.filter(
    (v) =>
      v.segmento !== null &&
      !v.fora_da_janela &&
      v.dias <= janela &&
      v.composto > 0, // ACHADO 1
  );

  const porSegmento = new Map<Segmento, VideoPontuado[]>();
  for (const v of elegiveis) {
    const s = v.segmento as Segmento;
    const lista = porSegmento.get(s);
    if (lista) lista.push(v);
    else porSegmento.set(s, [v]);
  }

  const recomendacoes: RecomendacaoSegmento[] = [];
  const sem_recomendacao: { segmento: Segmento; motivo: string }[] = [];

  for (const segmento of SEGMENTOS) {
    const idFormula = FORMULA_DO_SEGMENTO[segmento];
    const formula: Formula | null = formulaPorId(idFormula);
    if (!formula) {
      sem_recomendacao.push({
        segmento,
        motivo: `fôrma ${idFormula} não existe em formulas.ts`,
      });
      continue;
    }

    if (entrada.tipo && !formula.tipos.includes(entrada.tipo)) {
      sem_recomendacao.push({
        segmento,
        motivo: `fôrma ${formula.id} não serve a carta de ${entrada.tipo}`,
      });
      continue;
    }

    const lista = (porSegmento.get(segmento) ?? [])
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_POR_SEGMENTO);

    if (lista.length === 0) {
      sem_recomendacao.push({
        segmento,
        motivo: `sem vídeo acima da média nos últimos ${janela} dias`,
      });
      continue;
    }

    const outliers = lista
      .map((v) => v.outlier)
      .filter((n): n is number => typeof n === "number");
    const outlier_medio = media(outliers);
    const score_medio = media(lista.map((v) => v.score)) ?? 0;
    const base_incompleta = lista.some((v) => v.base_incompleta);

    const duracoesCurtas = lista
      .map((v) => v.duracao_s)
      .filter((d): d is number => typeof d === "number" && d > 0 && d <= TETO_DURACAO_CURTA_S);
    const duracao_mercado_s = mediana(duracoesCurtas);

    const agSeg = agregadoPorSegmento.get(segmento) ?? null;
    const agForm = agregadoPorFormula.get(formula.id) ?? null;
    const interno = agSeg ?? agForm;
    const indice_interno = partida_a_frio ? null : (interno?.media ?? null);
    const n_pecas_internas = partida_a_frio ? 0 : (interno?.n ?? 0);

    recomendacoes.push({
      segmento,
      formula: formula.id,
      persona: formula.persona,
      duracao_alvo: formula.duracao_alvo,
      duracao_mercado_s,
      score_medio,
      outlier_medio,
      n_videos: lista.length,
      base_incompleta,
      indice_interno,
      n_pecas_internas,
      confianca: confiancaDe({
        partida_a_frio,
        n_videos: lista.length,
        base_incompleta,
        n_pecas_internas,
      }),
      por_que: porQue({
        segmento,
        formula,
        lista,
        outlier_medio,
        base_incompleta,
        partida_a_frio,
        indice_interno,
        n_pecas_internas,
        pecas,
      }),
      top: lista.map((v) => ({
        video_id: v.video_id,
        titulo: v.titulo,
        canal: v.canal,
        outlier: v.outlier,
        score: v.score,
        dias: v.dias,
        base_incompleta: v.base_incompleta,
      })),
    });
  }

  recomendacoes.sort((a, b) => b.score_medio - a.score_medio);

  return {
    gerado_em: agora.toISOString(),
    partida_a_frio,
    n_pecas_medidas,
    // A confiança global é a do topo — é ele que vira pauta.
    confianca: partida_a_frio ? "baixa" : (recomendacoes[0]?.confianca ?? "baixa"),
    segmentos: recomendacoes,
    sem_recomendacao,
  };
}

/**
 * A escada da confiança, escrita por extenso para poder ser discutida.
 *  - partida a frio → SEMPRE 'baixa'. Ordem literal, sem exceção.
 *  - 'alta' exige três coisas juntas: evidência plural (3+ vídeos), toda ela
 *    com linha de base do canal, e nosso próprio histórico com 3+ peças.
 *  - o resto é 'media'; um vídeo só, ou topo feito de base incompleta, é
 *    'baixa'.
 */
export function confiancaDe(e: {
  partida_a_frio: boolean;
  n_videos: number;
  base_incompleta: boolean;
  n_pecas_internas: number;
}): Confianca {
  if (e.partida_a_frio) return "baixa";
  if (e.n_videos < 2 || e.base_incompleta) return "baixa";
  if (e.n_videos >= 3 && e.n_pecas_internas >= 3) return "alta";
  return "media";
}

/**
 * A frase de evidência. Modelo pedido na OS:
 *   "3 vídeos de aluguel com outlier médio 4.2x nos últimos 12 dias; nossa P1
 *    tem retenção de 41% em 3 peças"
 *
 * Duas metades, e a segunda SÓ APARECE quando existe. Na partida a frio a
 * frase termina na primeira — inventar "nossa P1 tem retenção de 41% em 2
 * peças" seria exatamente o "fingir estatística com n=2" que a OS proibiu.
 */
function porQue(e: {
  segmento: Segmento;
  formula: Formula;
  lista: readonly VideoPontuado[];
  outlier_medio: number | null;
  base_incompleta: boolean;
  partida_a_frio: boolean;
  indice_interno: number | null;
  n_pecas_internas: number;
  pecas: readonly MetricaPeca[];
}): string {
  const dias = Math.max(...e.lista.map((v) => v.dias));
  const rotulo = e.segmento.toLowerCase().replace(/_/g, " ");
  const plural = e.lista.length === 1 ? "vídeo" : "vídeos";

  let externo: string;
  if (e.outlier_medio !== null) {
    externo =
      `${e.lista.length} ${plural} de ${rotulo} com outlier médio ` +
      `${n1(e.outlier_medio)}x nos últimos ${dias} dias`;
  } else {
    // Sem linha de base do canal não existe outlier — dizer "outlier 0x" seria
    // mentira. A evidência vira a velocidade crua, e a falta é declarada.
    const vel = media(e.lista.map((v) => v.velocidade)) ?? 0;
    externo =
      `${e.lista.length} ${plural} de ${rotulo} a ${Math.round(vel)} views/dia ` +
      `nos últimos ${dias} dias (canal sem linha de base: menos de ` +
      `${MIN_AMOSTRAS_BASE} vídeos)`;
  }
  if (e.base_incompleta && e.outlier_medio !== null) {
    externo += " (parte do topo sem linha de base do canal)";
  }

  if (e.partida_a_frio) {
    return externo + "; sem histórico nosso medido, o externo decide sozinho";
  }
  if (e.indice_interno === null || e.n_pecas_internas === 0) {
    return externo + `; nossa ${e.formula.id} ainda não tem peça medida`;
  }

  const doSegmento = e.pecas.filter((p) => p.formula === e.formula.id);
  const retencao = media(doSegmento.map((p) => num(p.retencao)));
  const peca = e.n_pecas_internas === 1 ? "peça" : "peças";
  if (retencao !== null && doSegmento.length > 0) {
    return (
      externo +
      `; nossa ${e.formula.id} tem retenção de ${pct(retencao)} em ` +
      `${doSegmento.length} ${doSegmento.length === 1 ? "peça" : "peças"}`
    );
  }
  return (
    externo +
    `; nossa ${e.formula.id} tem índice ${n1(e.indice_interno)} em ` +
    `${e.n_pecas_internas} ${peca}`
  );
}
