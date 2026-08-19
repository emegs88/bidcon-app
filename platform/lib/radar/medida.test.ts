// ============================================================================
// Teste de lib/radar/medida.ts — as guardas de "medi e deu zero ≠ não consegui
// medir" (Regra 19).
// ----------------------------------------------------------------------------
// DUAS NATUREZAS, e o arquivo é dividido por elas de propósito, porque tratá-las
// como uma só foi o erro original:
//
//   VEREDITO (contagemMedida, listaMedida) — o número vira a resposta do vigia.
//     Zero inventado aqui faz o vigia AFIRMAR algo que ninguém mediu.
//
//   BASELINE (separarPorBaseline) — o número é o PATAMAR contra o qual se mede
//     regressão. Zero inventado aqui não faz o vigia gritar: faz ele CALAR para
//     sempre naquela fonte, porque `houveRegressao` sai cedo em `baseline <= 0`
//     com "nunca amostrou ⇒ não regrediu" (limiar.ts). O conserto, portanto,
//     não é "não julga o ciclo" — é a fonte ficar FORA da comparação daquele
//     ciclo, que é coisa distinta de "comparei e passou".
//
// Todo bloco tem CONTROLE: um caso que passa pela guarda e produz o valor
// medido. Sem ele, uma guarda que recusasse TUDO passaria neste arquivo, e o
// vigia ficaria mudo com os testes verdes — que é o defeito, não a cura.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  contagemMedida,
  listaMedida,
  separarPorBaseline,
  type AmostraDaFonte,
} from "@/lib/radar/medida";

// ---------------------------------------------------------------------------
// VEREDITO — contagemMedida
// ---------------------------------------------------------------------------

test("VEREDITO contagemMedida: zero MEDIDO volta 0, e 0 é um fato", () => {
  // Este é o caso que o `?? 0` destruía por igualar ao caso de baixo. Zero
  // medido tem de chegar ao vigia como zero, senão o FAROL nunca mais alarma.
  assert.equal(contagemMedida({ count: 0, error: null }), 0);
  // CONTROLE: número normal atravessa inteiro, sem transformação.
  assert.equal(contagemMedida({ count: 7, error: null }), 7);
});

test("VEREDITO contagemMedida: count null SEM error volta null — o caso que passou meses no ar", () => {
  /* A sutileza inteira da Regra 19. `if (!erro)` parece defensivo e não é:
   * head+count desativado, resposta sem o header de contagem e RLS cortando a
   * contagem produzem, os TRÊS, `error: null` com `count: null`. Foi assim que
   * o `publicadosHoje ?? 0` virou o veredito "publicou zero" num dia em que o
   * FAROL publicou quatro vezes. */
  assert.equal(contagemMedida({ count: null, error: null }), null);
  assert.equal(contagemMedida({ error: null }), null);
  assert.equal(contagemMedida({}), null);
});

test("VEREDITO contagemMedida: error volta null mesmo com count presente", () => {
  // Se houve erro, o número que veio junto não é confiável — nem quando é 0.
  assert.equal(contagemMedida({ count: 0, error: new Error("RLS") }), null);
  assert.equal(contagemMedida({ count: 12, error: { message: "timeout" } }), null);
});

test("VEREDITO contagemMedida: NaN e Infinity não são medição", () => {
  /* NaN comparado a qualquer limiar é falso: passaria por toda guarda numérica
   * sem alarmar. Alarme mudo é pior que alarme falso, porque ninguém percebe. */
  assert.equal(contagemMedida({ count: Number.NaN, error: null }), null);
  assert.equal(contagemMedida({ count: Number.POSITIVE_INFINITY, error: null }), null);
});

// ---------------------------------------------------------------------------
// VEREDITO — listaMedida (o mesmo defeito, com disfarce melhor)
// ---------------------------------------------------------------------------

test("VEREDITO listaMedida: lista vazia MEDIDA volta [], que é 'olhei e não há nada'", () => {
  const vazia = listaMedida<{ id: number }>({ data: [], error: null });
  assert.deepEqual(vazia, []);
  // CONTROLE: lista com conteúdo atravessa idêntica.
  assert.deepEqual(listaMedida({ data: [{ id: 1 }], error: null }), [{ id: 1 }]);
});

test("VEREDITO listaMedida: data null SEM error volta null, não []", () => {
  /* Este era o mais traiçoeiro dos quatro. `?? []` fazia a leitura falha virar
   * uma casa limpa: volume zero de quarentena E — pior — toda chave
   * `reincidente:*` marcada como julgada, fechando na FASE 3 os alertas de
   * cartas que continuam voltando. Nada disso faz barulho. */
  assert.equal(listaMedida({ data: null, error: null }), null);
  assert.equal(listaMedida({}), null);
});

test("VEREDITO listaMedida: error volta null mesmo com data presente", () => {
  assert.equal(listaMedida({ data: [], error: new Error("boom") }), null);
  assert.equal(listaMedida({ data: [{ id: 1 }], error: { message: "boom" } }), null);
});

// ---------------------------------------------------------------------------
// BASELINE — separarPorBaseline (NATUREZA DIFERENTE das de cima)
// ---------------------------------------------------------------------------

const cheia = (espera: number | null): AmostraDaFonte => ({
  espera,
  lidas: 198,
  recebidas: 198,
});

test("BASELINE separarPorBaseline: fonte SEM baseline sai da comparação — não vira zero nem vira julgada", () => {
  /* A diferença que o Emerson exigiu preservar: aqui o zero inventado não faz o
   * vigia gritar, faz ele emudecer. Com `espera ?? 0`, a fonte cujo campo não
   * veio no evento caía no atalho `baseline <= 0` de `houveRegressao` e nunca
   * mais alarmava — enquanto a condição seguia marcada como julgada, fechando o
   * que estivesse aberto. Ela precisa ficar de FORA, não "aprovada". */
  const { comparaveis, semBaseline } = separarPorBaseline([
    ["CARTAS", cheia(null)],
    ["PLAYCONTEMPLADAS", cheia(1)],
  ]);
  assert.deepEqual(semBaseline, ["CARTAS"]);
  // CONTROLE: a outra fonte NÃO foi arrastada junto. Uma guarda que jogasse
  // todo mundo para fora passaria no assert de cima e mataria o vigia inteiro.
  assert.equal(comparaveis.length, 1);
  assert.equal(comparaveis[0][0], "PLAYCONTEMPLADAS");
  assert.equal(comparaveis[0][1].espera, 1);
});

test("BASELINE separarPorBaseline: espera=0 DECLARADO é comparável — zero medido não é ausência", () => {
  /* A fonte que declara zero de verdade continua entrando na comparação. É o
   * `houveRegressao` que decide sair cedo, e ali a saída está CERTA: quem nunca
   * amostrou não regrediu. O que não pode é a fonte sem medição herdar esse
   * caminho por engano. */
  const { comparaveis, semBaseline } = separarPorBaseline([["CARTAS", cheia(0)]]);
  assert.deepEqual(semBaseline, []);
  assert.equal(comparaveis.length, 1);
  assert.equal(comparaveis[0][1].espera, 0);
});

test("BASELINE separarPorBaseline: NaN e Infinity contam como sem baseline", () => {
  const { comparaveis, semBaseline } = separarPorBaseline([
    ["A", cheia(Number.NaN)],
    ["B", cheia(Number.POSITIVE_INFINITY)],
    ["C", cheia(3)],
  ]);
  assert.deepEqual(semBaseline.sort(), ["A", "B"]);
  // CONTROLE: a fonte sã sobreviveu à peneira.
  assert.deepEqual(
    comparaveis.map(([f]) => f),
    ["C"]
  );
});

test("BASELINE separarPorBaseline: lidas e recebidas atravessam intactas", () => {
  /* A separação é sobre `espera` e só sobre ela. Se ela começasse a mexer nos
   * outros dois campos, a taxa medida sairia errada e o vigia alarmaria pelo
   * motivo errado — que é um jeito de "funcionar" difícil de perceber. */
  const { comparaveis } = separarPorBaseline([
    ["CARTAS", { espera: 1, lidas: 198, recebidas: 0 }],
  ]);
  assert.deepEqual(comparaveis[0][1], { espera: 1, lidas: 198, recebidas: 0 });
});

test("BASELINE separarPorBaseline: entrada vazia devolve as duas listas vazias", () => {
  const { comparaveis, semBaseline } = separarPorBaseline(new Map());
  assert.deepEqual(comparaveis, []);
  assert.deepEqual(semBaseline, []);
});

test("BASELINE separarPorBaseline: aceita Map, que é o que a rota passa", () => {
  // A rota monta um `Map<string, AmostraDaFonte>`. Se a assinatura só aceitasse
  // array, o acoplamento apareceria como conversão na rota — fora do alcance
  // do arnês, que é justamente onde este módulo existe para não deixar nada.
  const m = new Map<string, AmostraDaFonte>([
    ["CARTAS", cheia(null)],
    ["ITAU", cheia(2)],
  ]);
  const { comparaveis, semBaseline } = separarPorBaseline(m);
  assert.deepEqual(semBaseline, ["CARTAS"]);
  assert.deepEqual(
    comparaveis.map(([f]) => f),
    ["ITAU"]
  );
});
