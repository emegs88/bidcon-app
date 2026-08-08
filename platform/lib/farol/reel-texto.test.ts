// ============================================================================
// lib/farol/reel-texto.test.ts — o número que o porta-voz FALA
// AUTORIZADO: Emerson Gomes dos Santos — decisão 3 da coordenação de 08/08/2026:
// "valorFalado(): corrigir a colagem — '2 milhões, 385 mil e 990 reais'
//  (vírgula entre as classes, ' e ' só antes da última). Micro-fatia, com teste."
// ----------------------------------------------------------------------------
// Runner NATIVO do Node, mesmo padrão de lib/comissao.test.ts. Rodar:
//   npx tsx --tsconfig tsconfig.test.json --test lib/farol/reel-texto.test.ts
//
// POR QUE ESTE ARQUIVO EXISTE. `valorFalado` é a única função do projeto cujo
// resultado ninguém LÊ na revisão: ele vira áudio no TTS e sai pela boca do
// porta-voz. Um erro aqui não aparece em print, não aparece na legenda, não
// aparece no banco — aparece no ouvido de quem assiste, uma vez, e some. É
// exatamente o tipo de defeito que fica anos no ar. Por isso ele ganha teste
// enquanto o resto do reel-texto.ts é medido pela bancada de fôrmas.
//
// O DEFEITO SÓ APARECE COM TRÊS CLASSES AO MESMO TEMPO. Por isso passou: as
// cartas que rodaram até 08/08 caíam em duas ("1 milhão e 132 mil"). A carta de
// R$ 2.385.990 do Itaú, que entrou na bancada das fôrmas, é a que revelou. Os
// valores abaixo NÃO são inventados: são os das cartas reais que já rodaram
// (2.385.990 e 1.132.000 da bancada; 33.707 e 710.000 dos dois reels que já
// foram ao ar) mais os degraus de fronteira.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";

import { valorFalado, custoFalado } from "./reel-texto";

test("três classes: vírgula entre elas, ' e ' só antes da última", () => {
  // A carta do Itaú da bancada de fôrmas — o caso da decisão 3.
  assert.equal(valorFalado(2385990), "2 milhões, 385 mil e 990 reais");
  assert.equal(valorFalado(1245919), "1 milhão, 245 mil e 919 reais");
});

test("duas classes: ' e ' entre elas, sem vírgula", () => {
  assert.equal(valorFalado(1132000), "1 milhão e 132 mil reais");
  assert.equal(valorFalado(255300), "255 mil e 300 reais");
  assert.equal(valorFalado(33707), "33 mil e 707 reais"); // reel de 08/08
  assert.equal(valorFalado(3500), "3 mil e 500 reais");
});

test("uma classe só: nem vírgula nem ' e '", () => {
  assert.equal(valorFalado(250000), "250 mil reais");
  assert.equal(valorFalado(710000), "710 mil reais"); // reel de 07/08
  assert.equal(valorFalado(890), "890 reais");
  assert.equal(valorFalado(1), "1 reais"); // ver nota de concordância abaixo
});

test("milhão redondo pede 'de reais'", () => {
  // Segundo conserto, declarado no header de reel-texto.ts: terminando no
  // milhão o português exige o "de". Crédito redondo de R$ 1.000.000 é dos
  // mais comuns em imóvel — este caso ia ao ar falado errado.
  assert.equal(valorFalado(1000000), "1 milhão de reais");
  assert.equal(valorFalado(2000000), "2 milhões de reais");
  // Mas some assim que vem outra classe atrás:
  assert.equal(valorFalado(1000500), "1 milhão e 500 reais");
  assert.equal(valorFalado(2385990).endsWith("de reais"), false);
});

test("singular e plural do milhão", () => {
  assert.ok(valorFalado(1000000).startsWith("1 milhão"));
  assert.ok(valorFalado(2000000).startsWith("2 milhões"));
});

test("arredonda para o real inteiro — comportamento DECLARADO no header", () => {
  // Não é um bug: o header de reel-texto.ts declara que os centavos não são
  // audíveis como informação e que o valor exato vive na legenda e na página.
  assert.equal(valorFalado(3499.87), "3 mil e 500 reais");
  assert.equal(valorFalado(890.4), "890 reais");
});

test("zero e negativo não viram frase quebrada", () => {
  assert.equal(valorFalado(0), "zero reais");
  assert.equal(valorFalado(-5), "zero reais");
  assert.equal(valorFalado(NaN), "zero reais");
});

// ----------------------------------------------------------------------------
// NOTAS DE LIMITE — o que este teste NÃO cobre, escrito para não parecer
// esquecimento:
//
// 1) CONCORDÂNCIA DO "1 real". `valorFalado(1)` devolve "1 reais". Não
//    consertei: nenhum campo do reel (crédito, entrada, parcela) chega a
//    R$ 1,00, e o conserto exigiria mexer no sufixo, que é o mesmo ponto que a
//    decisão 3 tocou. Fica MEDIDO e escrito aqui.
// 2) BILHÃO não existe: R$ 2.385.990.000 sairia "2385 milhões...". Ver header
//    de reel-texto.ts.
// 3) `custoFalado` é derivado de `pctAoMes()` de propósito (header). O teste
//    abaixo prova só a DERIVAÇÃO — o número em si é medido no teste do
//    canônico, e duplicá-lo aqui seria criar a segunda fonte que o header
//    justamente evita.
// ----------------------------------------------------------------------------
test("custoFalado deriva do canônico e obedece ao compliance (% a.m.)", () => {
  const falado = custoFalado(0.71);
  assert.equal(falado, "0,71 por cento ao mês");
  // CLAUDE.md: o custo aparece SEMPRE como taxa ao mês, nunca como rendimento.
  assert.ok(falado.includes("ao mês"));
  assert.ok(!falado.includes("%")); // "%" é do escrito; no falado vira extenso
});
