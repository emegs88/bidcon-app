// ============================================================================
// Resumo da fila do Sentinela — SENTINELA-RADAR-01, item 1.4
// AUTORIZADO: Emerson, 15/08/2026: "quantas na fila, por status, a mais antiga
// e o motivo. Fila invisível é fila morta."
// ----------------------------------------------------------------------------
// A ARITMÉTICA MORA AQUI, E NÃO NA PÁGINA, pela mesma razão de
// `lib/whatsapp/sala.ts`: `scripts/testes.mjs` varre `lib/` e NÃO varre páginas.
// Contagem por status escrita dentro de um componente é contagem sem teste, e
// contagem sem teste é exatamente o que deixou 21 pessoas onze dias esperando.
//
// ----------------------------------------------------------------------------
// OS DOZE STATUS, REMEDIDOS NO ENUM EM 29/08/2026
//
//   1 pendente               5 esgotado                 9 encerrada_cordialmente
//   2 aguardando_template    6 excluido                10 handoff_humano
//   3 enviado                7 erro                    11 duplicado_telefone
//   4 respondeu              8 encerrado_por_silencio  12 erro_permanente
//
// ----------------------------------------------------------------------------
// ESTE CABEÇALHO JÁ MENTIU, E É POR ISSO QUE A DATA ESTÁ NELE
//
// Até 29/08/2026 estas linhas diziam "OS SETE STATUS, MEDIDOS EM 16/08". O enum
// tinha crescido para doze e ninguém veio aqui. Cinco status passaram a existir
// sem que este arquivo soubesse — e nesse dia a fila real tinha 52 linhas, das
// quais 26 (`encerrado_por_silencio` 25 + `duplicado_telefone` 1) caíam em
// `desconhecidas`. METADE DA FILA classificada como "não sei".
//
// O mecanismo funcionou: nenhuma linha foi contada errado, e o painel gritava.
// O que falhou foi a lista, que é escrita à mão e não tem como se atualizar
// sozinha — teste offline não alcança o enum do banco. Então a defesa real não
// é este comentário: é o contador `desconhecidas` e o alarme que ele acende.
// Quem mexer aqui: a lista envelhece, o alarme não. Não troque um pelo outro.
//
// ----------------------------------------------------------------------------
// POR QUE LISTA FECHADA
//
// Repare em `respondeu` (não "respondido"). Um status que ninguém conta é um
// status onde linhas somem: se três linhas caírem em `erro`, um resumo escrito
// de cabeça as ignoraria e a fila pareceria menor do que é.
//
// Por isso a partição aqui é por LISTA FECHADA e o resto cai em `outros` — em
// vez de `esperando = !encerrado`, que classificaria qualquer status NOVO como
// "esperando" e inflaria a fila, ou o inverso, que o esconderia. Status
// desconhecido aparece com o nome dele, na cara.
// ============================================================================

export type LinhaFila = {
  status: string;
  motivo: string | null;
  tentativas: number;
  criado_em: string;
};

/**
 * Quem ainda espera alguma coisa da casa.
 *
 * `handoff_humano` entrou aqui em 29/08/2026, e é a única das cinco entradas
 * novas que exigiu julgamento em vez de leitura. As outras quatro dizem no
 * próprio nome que acabaram; esta não. A régua usada foi a definição desta
 * lista, escrita acima: quem ainda espera ALGUMA COISA DA CASA. Uma pessoa
 * passada para uma pessoa continua devendo resposta — o robô parou, o
 * atendimento não. Chamar isso de encerrado esconderia exatamente a espera que
 * mais dói, porque é a que alguém prometeu atender.
 *
 * Decidi agora porque hoje `handoff_humano` tem ZERO linhas: a escolha não
 * mexe em nenhum número da tela, e é por isso que ela é barata hoje e cara
 * depois. Se a leitura da casa for outra, é uma linha para mover — e o teste
 * `as duas listas cobrem os doze status` acusa a mudança na hora.
 */
export const STATUS_ESPERANDO = [
  "pendente",
  "aguardando_template",
  "enviado",
  "handoff_humano",
] as const;

/**
 * Quem saiu da fila, por qualquer porta. `erro` está aqui de propósito: a linha
 * parou de andar, então não é espera — mas é um encerramento que ninguém
 * escolheu, e por isso o painel o mostra separado dos outros. `erro_permanente`
 * entra pela mesma porta, e é o mesmo caso levado ao fim: não adianta tentar.
 *
 * `encerrado_por_silencio`, `encerrada_cordialmente` e `duplicado_telefone`
 * são encerramentos limpos — a linha cumpriu o caminho dela e saiu. Os três
 * estavam no enum e fora daqui; `encerrado_por_silencio` sozinho respondia por
 * 25 das 52 linhas da fila em 29/08.
 */
export const STATUS_ENCERRADOS = [
  "respondeu",
  "esgotado",
  "excluido",
  "erro",
  "encerrado_por_silencio",
  "encerrada_cordialmente",
  "duplicado_telefone",
  "erro_permanente",
] as const;

export function estaEsperando(status: string): boolean {
  return (STATUS_ESPERANDO as readonly string[]).includes(status);
}

export function estaEncerrada(status: string): boolean {
  return (STATUS_ENCERRADOS as readonly string[]).includes(status);
}

/** Dias inteiros entre duas datas. Negativo vira 0 — relógio torto não é idade. */
export function diasDesde(iso: string, agora: Date): number | null {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const ms = agora.getTime() - t;
  if (ms < 0) return 0;
  return Math.floor(ms / 86_400_000);
}

export type GrupoStatus = {
  status: string;
  n: number;
  esperando: boolean;
  conhecido: boolean;
  maisAntigaEm: string | null;
  diasMaisAntiga: number | null;
};

export type ResumoFila = {
  total: number;
  esperando: number;
  encerradas: number;
  /** Status que não estão em nenhuma das duas listas. Deve ser 0. */
  desconhecidas: number;
  porStatus: GrupoStatus[];
  porMotivo: { motivo: string; n: number }[];
  /** Soma de `tentativas` entre quem espera. Zero aqui é um fato duro. */
  toquesDados: number;
  maisAntigaEsperandoEm: string | null;
  diasMaisAntigaEsperando: number | null;
};

export function resumirFila(linhas: LinhaFila[], agora: Date): ResumoFila {
  const grupos = new Map<string, { n: number; maisAntigaEm: string | null }>();
  const motivos = new Map<string, number>();

  let esperando = 0;
  let encerradas = 0;
  let desconhecidas = 0;
  let toquesDados = 0;
  let maisAntigaEsperandoEm: string | null = null;

  for (const l of linhas) {
    const g = grupos.get(l.status) ?? { n: 0, maisAntigaEm: null };
    g.n += 1;
    if (g.maisAntigaEm === null || l.criado_em < g.maisAntigaEm) g.maisAntigaEm = l.criado_em;
    grupos.set(l.status, g);

    if (estaEsperando(l.status)) {
      esperando += 1;
      // `tentativas` só conta de quem ainda espera. Somar os encerrados
      // misturaria toque dado com toque devido.
      toquesDados += Number.isFinite(l.tentativas) ? l.tentativas : 0;
      // Só o motivo de QUEM ESPERA. O motivo de uma linha encerrada é história;
      // o de quem espera é o que a casa ainda deve.
      const m = (l.motivo ?? "").trim() || "sem motivo registrado";
      motivos.set(m, (motivos.get(m) ?? 0) + 1);
      if (maisAntigaEsperandoEm === null || l.criado_em < maisAntigaEsperandoEm) {
        maisAntigaEsperandoEm = l.criado_em;
      }
    } else if (estaEncerrada(l.status)) {
      encerradas += 1;
    } else {
      desconhecidas += 1;
    }
  }

  const porStatus: GrupoStatus[] = [...grupos.entries()]
    .map(([status, g]) => ({
      status,
      n: g.n,
      esperando: estaEsperando(status),
      conhecido: estaEsperando(status) || estaEncerrada(status),
      maisAntigaEm: g.maisAntigaEm,
      diasMaisAntiga: g.maisAntigaEm ? diasDesde(g.maisAntigaEm, agora) : null,
    }))
    // Quem espera primeiro; depois o maior grupo. Encerrado é histórico.
    .sort((a, b) => (a.esperando === b.esperando ? b.n - a.n : a.esperando ? -1 : 1));

  const porMotivo = [...motivos.entries()]
    .map(([motivo, n]) => ({ motivo, n }))
    .sort((a, b) => b.n - a.n);

  return {
    total: linhas.length,
    esperando,
    encerradas,
    desconhecidas,
    porStatus,
    porMotivo,
    toquesDados,
    maisAntigaEsperandoEm,
    diasMaisAntigaEsperando: maisAntigaEsperandoEm
      ? diasDesde(maisAntigaEsperandoEm, agora)
      : null,
  };
}
