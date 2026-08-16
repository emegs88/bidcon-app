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
// OS SETE STATUS, MEDIDOS NO ENUM EM 16/08/2026
//
//   pendente · aguardando_template · enviado · respondeu · esgotado ·
//   excluido · erro
//
// Repare em `respondeu` (não "respondido") e em `erro`, que existe no enum e
// não aparecia em lista nenhuma do código. Um status que ninguém conta é um
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

/** Quem ainda espera alguma coisa da casa. */
export const STATUS_ESPERANDO = ["pendente", "aguardando_template", "enviado"] as const;

/**
 * Quem saiu da fila, por qualquer porta. `erro` está aqui de propósito: a linha
 * parou de andar, então não é espera — mas é um encerramento que ninguém
 * escolheu, e por isso o painel o mostra separado dos outros.
 */
export const STATUS_ENCERRADOS = ["respondeu", "esgotado", "excluido", "erro"] as const;

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
