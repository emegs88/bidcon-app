// ============================================================================
// MEDIDA — a fronteira entre "medi e deu zero" e "não consegui medir"
// ============================================================================
//
// Este módulo existe porque a distinção acima não sobrevive dentro da rota.
// Lá ela vira uma linha de `??` no meio de trezentas outras, invisível na
// revisão e inalcançável pelo arnês de testes — que foi exatamente como o
// `publicadosHoje ?? 0` ficou meses no ar abrindo alerta falso do FAROL.
//
// O DEFEITO, em uma frase: coalescer leitura para zero apaga a diferença entre
// um fato e uma ignorância, e o registro nasce mentindo com número plausível.
//
// E ele tem DOIS lados, sendo o segundo o mais perigoso:
//
//   FALSO ALARME    — a contagem falhou, virou 0, e o vigia gritou "não
//                     publicou nada" num dia em que publicou quatro vezes.
//                     Barulhento, portanto alguém percebe.
//
//   FALSO SILÊNCIO  — a contagem falhou, virou 0, o vigia saiu cedo por uma
//   + FECHAMENTO      guarda legítima ("fila vazia não envelhece", "sem ciclo
//                     o silêncio é do cron"), e a condição — marcada ANTES de
//                     se saber se houve medição — foi dada por julgada. A fase
//                     de resolução então FECHA um alerta legítimo na força de
//                     uma leitura que não aconteceu. Silencioso, portanto
//                     ninguém percebe. Um vigia que nunca alarma é
//                     indistinguível de uma casa saudável.
//
// A regra da casa (Regra 19): contador que alimenta julgamento é
// `number | null`; null NÃO julga e NÃO entra em `julgadas`; e marcar vem
// DEPOIS da guarda, nunca antes.

/**
 * Reduz uma leitura de contagem do PostgREST ao que o RADAR precisa saber.
 *
 * A sutileza que custou caro: **`count` volta `null` SEM `error`**. Testar só
 * `if (!erro)` parece defensivo e não é — foi o que deixou o FAROL passar.
 * Cabeçalho de contagem ausente, `head` sem `count`, política cortando a
 * contagem: em todos, `error` é null e `count` é null.
 *
 * Devolve o número quando ele foi medido, e `null` quando não foi. Zero medido
 * volta como `0`, que é um fato, e é justamente o que o `??` destruía.
 */
export function contagemMedida(res: {
  count?: number | null;
  error?: unknown;
}): number | null {
  if (res.error) return null;
  return typeof res.count === "number" && Number.isFinite(res.count) ? res.count : null;
}

/**
 * O mesmo para leitura de lista, onde o disfarce é ainda melhor: lista vazia
 * não parece um número suspeito, parece uma casa limpa. `[]` é uma medição —
 * "olhei e não há nada". `null` é a ausência dela.
 */
export function listaMedida<T>(res: { data?: T[] | null; error?: unknown }): T[] | null {
  if (res.error) return null;
  return Array.isArray(res.data) ? res.data : null;
}

/** Uma fonte vista no ciclo mais recente, antes de sabermos se é comparável. */
export type AmostraDaFonte = {
  espera: number | null;
  lidas: number;
  recebidas: number;
};

/**
 * Separa as fontes COMPARÁVEIS das que ficaram sem baseline.
 *
 * ESTE CASO É DE OUTRA NATUREZA, e a diferença importa. Nos contadores acima,
 * o zero inventado vira um VEREDITO. Aqui ele vira um PATAMAR: `espera` é o
 * que a fonte declara sustentar, e `houveRegressao` sai cedo em
 * `baseline <= 0` com "nunca amostrou ⇒ não regrediu" — o que está certo para
 * uma fonte que de fato declara zero.
 *
 * Com `espera ?? 0`, a fonte cujo campo simplesmente não veio no evento herdava
 * esse mesmo caminho: o vigia da prova de amostra nascia MUDO para ela, para
 * sempre, e a condição ainda era marcada como julgada — fechando o que
 * estivesse aberto. O conserto não é "não julga o ciclo": é a fonte ficar
 * **fora da comparação daquele ciclo**, que é coisa distinta de "comparei e
 * passou", e distinta também de "a fonte está bem".
 */
export function separarPorBaseline(
  vistas: Iterable<[string, AmostraDaFonte]>
): {
  comparaveis: Array<[string, AmostraDaFonte & { espera: number }]>;
  semBaseline: string[];
} {
  const comparaveis: Array<[string, AmostraDaFonte & { espera: number }]> = [];
  const semBaseline: string[] = [];
  for (const [fonte, m] of vistas) {
    if (m.espera === null || !Number.isFinite(m.espera)) {
      semBaseline.push(fonte);
      continue;
    }
    comparaveis.push([fonte, { ...m, espera: m.espera }]);
  }
  return { comparaveis, semBaseline };
}
