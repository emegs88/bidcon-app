// ============================================================================
// Desambiguação de carta por valores — testes de IDENTIDADE, não de aritmética.
//
// Runner NATIVO do Node (mesmo padrão de lib/comissao.test.ts). Rodar:
//   npx tsx --test lib/carta-identidade.test.ts
//
// POR QUÊ este arquivo existe: em 23/08/2026 mediu-se no xtv que
// `numero_externo` NUNCA foi identidade — é índice de linha de planilha,
// reiniciado a cada origem de importação. Na vitrine viva: 2.306 cartas para
// 1.345 refs; 956 refs ambíguos cobrindo 1.912 cartas (83% do estoque); 545
// deles misturando IMÓVEL e VEÍCULO.
//
// As duas linhas usadas abaixo são REAIS, medidas sob `numero_externo = 1`,
// mesma `fonte` ('360prospere'). Não são fixture inventada: são a prova que
// motivou o módulo. Um veículo de R$ 10.749 e um imóvel de R$ 1.296.300
// dividindo o mesmo número.
//
// O que estes testes protegem NÃO é o cálculo — é a recusa. O caso perigoso
// não é errar a conta, é TRAVAR A CARTA ERRADA para um cliente que viu outra
// coisa na tela. Por isso metade dos casos abaixo verifica que a função
// devolve `null`.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";

import { desambiguarPorValores } from "./carta-identidade";

type Linha = { id: string; valor_credito: unknown; valor_entrada: unknown };

// As duas homônimas REAIS sob numero_externo = 1, fonte '360prospere'.
const VEICULO: Linha = { id: "0f08a1d9", valor_credito: 10749, valor_entrada: 3342 };
const IMOVEL: Linha = { id: "2c07a633", valor_credito: 1296300, valor_entrada: 658871 };

test("lista vazia devolve vazio e nunca uma carta", () => {
  const r = desambiguarPorValores([] as Linha[], { credito: 10749, entrada: 3342 });
  assert.equal(r.motivo, "vazio");
  assert.equal(r.carta, null);
});

test("uma candidata que bate devolve unica", () => {
  const r = desambiguarPorValores([VEICULO], { credito: 10749, entrada: 3342 });
  assert.equal(r.motivo, "unica");
  assert.equal(r.carta?.id, "0f08a1d9");
});

test("uma candidata que NAO bate devolve nenhuma_bate, e nao a candidata", () => {
  const r = desambiguarPorValores([VEICULO], { credito: 99999, entrada: 3342 });
  assert.equal(r.motivo, "nenhuma_bate");
  assert.equal(r.carta, null);
});

// O par de casos que prova a correção: MESMO numero_externo, MESMA fonte,
// duas cartas de tipos diferentes. Antes desta função, o banco reduzia isso a
// PGRST116 e a reserva escalava para humano.
test("homonimas reais sob o ref 1: desempata para o VEICULO pelos valores da tela", () => {
  const r = desambiguarPorValores([VEICULO, IMOVEL], { credito: 10749, entrada: 3342 });
  assert.equal(r.motivo, "desempatada");
  assert.equal(r.carta?.id, "0f08a1d9");
});

test("homonimas reais sob o ref 1: desempata para o IMOVEL pelos valores da tela", () => {
  const r = desambiguarPorValores([VEICULO, IMOVEL], { credito: 1296300, entrada: 658871 });
  assert.equal(r.motivo, "desempatada");
  assert.equal(r.carta?.id, "2c07a633");
});

test("a ordem da lista nao decide: inverter as homonimas nao muda a escolha", () => {
  const r = desambiguarPorValores([IMOVEL, VEICULO], { credito: 10749, entrada: 3342 });
  assert.equal(r.motivo, "desempatada");
  assert.equal(r.carta?.id, "0f08a1d9");
});

test("credito bate mas entrada nao: recusa (os DOIS campos sao exigidos)", () => {
  const r = desambiguarPorValores([VEICULO, IMOVEL], { credito: 10749, entrada: 658871 });
  assert.equal(r.motivo, "nenhuma_bate");
  assert.equal(r.carta, null);
});

test("varias candidatas e nenhuma bate: nao escolhe no chute", () => {
  const r = desambiguarPorValores([VEICULO, IMOVEL], { credito: 500000, entrada: 250000 });
  assert.equal(r.motivo, "nenhuma_bate");
  assert.equal(r.carta, null);
});

// O caso que a função se recusa a resolver — e deve se recusar. Duas cartas
// com mesmo numero, mesmo credito e mesma entrada sao indistinguiveis com o
// que o cliente viu na tela. Quem chama escala para humano.
test("duas indistinguiveis devolvem ainda_ambiguo e carta null", () => {
  const gemea: Linha = { id: "outra", valor_credito: 10749, valor_entrada: 3342 };
  const r = desambiguarPorValores([VEICULO, gemea], { credito: 10749, entrada: 3342 });
  assert.equal(r.motivo, "ainda_ambiguo");
  assert.equal(r.carta, null);
});

// Tolerância: compara em reais inteiros. Justificativa medida — duas cartas
// distintas sob o mesmo ref diferem, na média, em R$ 161.063; arredondar
// centavos nao pode aproximar duas identidades.
test("centavo de reajuste nao quebra a identidade", () => {
  const comCentavos: Linha = { id: "cent", valor_credito: 10749.4, valor_entrada: 3341.6 };
  const r = desambiguarPorValores([comCentavos], { credito: 10749, entrada: 3342 });
  assert.equal(r.motivo, "unica");
  assert.equal(r.carta?.id, "cent");
});

test("um reais inteiro de diferenca ja NAO casa", () => {
  const off: Linha = { id: "off", valor_credito: 10750, valor_entrada: 3342 };
  const r = desambiguarPorValores([off], { credito: 10749, entrada: 3342 });
  assert.equal(r.motivo, "nenhuma_bate");
});

test("valor nao numerico nunca casa (null, undefined, texto)", () => {
  const sujas: Linha[] = [
    { id: "a", valor_credito: null, valor_entrada: 3342 },
    { id: "b", valor_credito: undefined, valor_entrada: 3342 },
    { id: "c", valor_credito: "dez mil", valor_entrada: 3342 },
  ];
  const r = desambiguarPorValores(sujas, { credito: 10749, entrada: 3342 });
  assert.equal(r.motivo, "nenhuma_bate");
  assert.equal(r.carta, null);
});

// PostgREST devolve `numeric` como string em vários caminhos. Se isto
// quebrasse, o desempate falharia para TODA carta vinda do banco.
test("string numerica casa (numeric do PostgREST chega como texto)", () => {
  const texto: Linha = { id: "t", valor_credito: "10749.00", valor_entrada: "3342.00" };
  const r = desambiguarPorValores([texto], { credito: 10749, entrada: 3342 });
  assert.equal(r.motivo, "unica");
  assert.equal(r.carta?.id, "t");
});

// Regra 19: alvo ilegível não pode virar "achei". Se o carta_foco chegasse
// com credito NaN, comparar contra qualquer coisa tem que recusar.
test("alvo NaN recusa em vez de casar com qualquer carta", () => {
  const r = desambiguarPorValores([VEICULO, IMOVEL], { credito: NaN, entrada: NaN });
  assert.equal(r.motivo, "nenhuma_bate");
  assert.equal(r.carta, null);
});
