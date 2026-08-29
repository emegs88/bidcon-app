// ============================================================================
// CARTA-IDENTIDADE-01 — desambiguar carta quando só existe o número.
// ----------------------------------------------------------------------------
// O QUE FOI MEDIDO (xtv, vw_carousel_cartas). Duas colunas porque a segunda
// medição desmentiu a primeira — e para pior. Ficam as duas: uma linha só diria
// "é assim", e duas dizem "está PIORANDO", que é outra informação.
//
//                                                    23/08        28/08
//   cartas na vitrine viva ....................      2.306        2.295
//   refs distintos ............................      1.345        1.232
//   refs AMBÍGUOS (>1 carta sob o mesmo ref) ..        956        1.061
//   cartas envolvidas nesses refs .............      1.912        2.124
//        ... como fatia da vitrine ............        83%        92,5%
//   refs ambíguos que misturam IMÓVEL e VEÍCULO        545          641
//   maior diferença de crédito sob um ref ..... R$ 1.864.310  R$ 1.389.251
//   diferença média ........................... R$   161.063  R$   167.468
//
// O CONTROLE que a Regra 9 exige, e que faltava na primeira medição: quantos
// refs continuariam ambíguos DEPOIS de desempatar por (crédito, entrada)?
//
//   refs ambíguos que o par (crédito, entrada) NÃO resolve ......... 0
//
// Zero em 1.061. Isso não é promessa de que `ainda_ambiguo` nunca acontece — o
// caminho existe e é testado, porque duas cartas com mesmo ref, mesmo crédito e
// mesma entrada são indistinguíveis com o que o cliente viu na tela. É a prova
// de que, no acervo de hoje, o desempate escolhido resolve o problema inteiro em
// vez de metade dele. Se esse zero virar diferente de zero, o caminho de
// escalonamento é que passa a carregar o peso — e aí vale re-medir antes de
// culpar a rota.
//
// NOTA DE COLUNA: a view expõe `ref` / `credito` / `entrada`; a TABELA `cartas`,
// que /api/atende consulta, usa `numero_externo` / `valor_credito` /
// `valor_entrada`. Os nomes deste arquivo seguem a TABELA, que é o que chega
// aqui. Medir na view e escrever para a tabela é fácil de confundir.
//
// O caso concreto que abriu a investigação: `numero_externo = 1`, mesma
// `fonte` ('360prospere'), duas cartas disponíveis —
//   0f08a1d9  PLAYCONTEMPLADAS  veículo  crédito  R$    10.749
//   2c07a633  CARTAS            imóvel   crédito  R$ 1.296.300
//
// Ou seja: `numero_externo` nunca foi identidade. É índice de linha de
// planilha, reiniciado a cada origem de importação. O `id` (uuid) é a única
// identidade estável — e é por isso que IDENTIDADE-01 / D-4 já manda preferir
// o uuid em app/api/atende/route.ts.
//
// O DEFEITO QUE ISTO CONSERTA. O fallback por número naquela rota fazia
// `.eq("numero_externo", ref).maybeSingle()`. `maybeSingle()` pede ao
// PostgREST UM objeto; quando duas linhas casam, a resposta é erro
// (PGRST116), não uma escolha. O código tratava esse erro como falha de
// banco e ESCALAVA para humano. Resultado: para 83% da vitrine, o caminho de
// fallback — a app antiga em cache e os cards hidratados client-side do
// cotas-extra, que mandam `ref` sem `id` — nunca conseguia travar carta
// nenhuma. Não era um erro visível: era uma reserva que silenciosamente
// virava escalonamento.
//
// A SAÍDA, E POR QUE ELA É SEGURA. O `carta_foco` que o widget manda já traz
// `credito` e `entrada` — os mesmos dois campos que o passo 4b da rota já
// usava para conferir se a linha continuava sendo a mesma carta. Então a
// informação para desempatar SEMPRE esteve na mão; faltava usá-la antes do
// banco reduzir tudo a um objeto só. Aqui a lista inteira de homônimas é
// recebida e o empate é resolvido por esses dois valores.
//
// O QUE ESTA FUNÇÃO NÃO FAZ: escolher no chute. Se depois de comparar
// crédito e entrada ainda sobrar mais de uma candidata, ela devolve
// `ainda_ambiguo` e quem chama escala para humano. Duas cartas com mesmo
// número, mesmo crédito e mesma entrada são indistinguíveis com o que o
// cliente viu na tela — e travar a errada é pior que não travar.
// ============================================================================

/** Forma mínima que a desambiguação precisa enxergar de uma linha de `cartas`.
 *  Genérica de propósito: quem chama passa a linha inteira do banco e recebe
 *  a linha inteira de volta, sem este módulo saber das outras colunas. */
export type LinhaComValores = {
  valor_credito: unknown;
  valor_entrada: unknown;
};

export type ResultadoDesambiguacao<T> =
  | { carta: T; motivo: "unica" | "desempatada" }
  | { carta: null; motivo: "vazio" | "nenhuma_bate" | "ainda_ambiguo" };

/** Mesma tolerância do passo 4b de /api/atende: compara em reais inteiros.
 *  Centavos de reajuste não podem quebrar a identidade — e não quebram a
 *  desambiguação porque duas cartas distintas sob o mesmo número diferem, na
 *  média medida, em R$ 161 mil. */
function mesmoValor(a: unknown, b: unknown): boolean {
  const na = Math.round(Number(a));
  const nb = Math.round(Number(b));
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
}

/**
 * Escolhe, entre as cartas que compartilham o mesmo `numero_externo`, aquela
 * cujos crédito e entrada batem com o que o cliente tinha na tela.
 *
 * - lista vazia .................................... `vazio`
 * - uma só candidata, e ela bate .................... `unica`
 * - uma só candidata, e ela NÃO bate ................ `nenhuma_bate`
 * - várias, exatamente uma bate ..................... `desempatada`
 * - várias, nenhuma bate ............................ `nenhuma_bate`
 * - várias, mais de uma bate ........................ `ainda_ambiguo`
 *
 * `unica` e `desempatada` são separadas de propósito: quem chama pode querer
 * logar que houve empate desfeito (sinal de que o número está sobrecarregado)
 * sem que isso vire erro.
 */
export function desambiguarPorValores<T extends LinhaComValores>(
  linhas: readonly T[],
  alvo: { credito: number; entrada: number }
): ResultadoDesambiguacao<T> {
  if (!linhas.length) return { carta: null, motivo: "vazio" };

  const batem = linhas.filter(
    (l) => mesmoValor(l.valor_credito, alvo.credito) && mesmoValor(l.valor_entrada, alvo.entrada)
  );

  if (batem.length === 1) {
    return { carta: batem[0], motivo: linhas.length === 1 ? "unica" : "desempatada" };
  }
  if (batem.length === 0) return { carta: null, motivo: "nenhuma_bate" };
  return { carta: null, motivo: "ainda_ambiguo" };
}
