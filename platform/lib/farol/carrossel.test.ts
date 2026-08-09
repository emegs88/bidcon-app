// ============================================================================
// lib/farol/carrossel.test.ts — a intercalação e a legenda da tabela da semana
// AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-VISUAL-02", 09/08/2026.
// ----------------------------------------------------------------------------
// Runner NATIVO do Node, mesmo padrão de lib/farol/reel-texto.test.ts. Rodar:
//   npx tsx --tsconfig tsconfig.test.json --test lib/farol/carrossel.test.ts
//
// POR QUE ESTE ARQUIVO EXISTE. As duas funções aqui falham CALADAS. Um
// carrossel com 5 imóveis e 1 veículo publica normalmente e fica bonito; só
// quem for contar percebe que a alternância morreu. E uma legenda que perde o
// "% a.m." é reprovada pelo `revisarLegenda()` só em produção, no sábado, com
// o cron já rodando — tarde demais para descobrir por print.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { intercalar, montarLegendaCarrossel, CARTAS_POR_CARROSSEL } from "./carrossel";
import { revisarLegenda, alavancagem } from "./selecao";
import type { CartaCarrossel } from "@/lib/carrossel-formato";

/**
 * Carta mínima para o teste. Só os campos que as duas funções olham.
 *
 * `credito` e `parcela` ENTRARAM COMO PARÂMETRO EM 09/08/2026 e isso não é
 * detalhe. Até aqui a fábrica fixava 300.000 e 2.500 em TODA carta, o que dava
 * alavancagem 120 para todo mundo: com a regra nova, o ranking empatava sempre
 * e quem decidia era o desempate por custo. Os testes continuariam verdes com a
 * camada de alavancagem inteiramente morta — passariam a testar a regra ANTIGA
 * usando o comparador NOVO, que é o pior tipo de teste verde.
 */
function carta(
  id: string,
  tipo: "imovel" | "veiculo",
  custoAm: number,
  credito = 300_000,
  parcela = 2_500
): CartaCarrossel {
  return {
    id,
    tipo,
    tipoLabel: tipo === "imovel" ? "Imóvel" : "Veículo",
    administradora: "Teste",
    credito,
    entrada: 90_000,
    parcela,
    parcelas: 120,
    custoAm,
    exclusiva: false,
  };
}

// As listas chegam ORDENADAS PELA REGRA DA CASA — é o contrato de
// `candidatos()`: filtro por teto de custo, ranking por alavancagem
// (crédito ÷ parcela), desempate por menor custo e depois maior crédito.
// Repare que dentro de cada lista a alavancagem CAI enquanto o custo SOBE: é
// assim que a vitrine se comporta de verdade, e é o que impede este arquivo de
// passar por acaso caso alguém troque um critério pelo outro.
const IMOVEIS = [
  carta("i1", "imovel", 0.40, 400_000, 2_000), // alavancagem 200
  carta("i2", "imovel", 0.45, 360_000, 2_000), //              180
  carta("i3", "imovel", 0.50, 320_000, 2_000), //              160
  carta("i4", "imovel", 0.55, 300_000, 2_000), //              150
];
const VEICULOS = [
  carta("v1", "veiculo", 0.42, 380_000, 2_000), // alavancagem 190
  carta("v2", "veiculo", 0.47, 340_000, 2_000), //              170
  carta("v3", "veiculo", 0.52, 310_000, 2_000), //              155
  carta("v4", "veiculo", 0.57, 280_000, 2_000), //              140
];

test("intercalar: 6 slides, 3 de cada tipo, alternando", () => {
  const fila = intercalar(IMOVEIS, VEICULOS);
  assert.equal(fila.length, 6);
  assert.deepEqual(
    fila.map((c) => c.id),
    ["i1", "v1", "i2", "v2", "i3", "v3"]
  );
});

test("intercalar: começa por quem vence a REGRA DA CASA, não por um tipo fixo", () => {
  // O nome deste teste dizia "mais barato" até 09/08/2026. Não diz mais, e a
  // carta escolhida mostra por quê: v0 é a MAIS CARA do conjunto (0,90% a.m.
  // contra 0,40% do i1) e mesmo assim abre o carrossel, porque entrega 250 de
  // crédito por real de parcela contra 200 do imóvel. Sob a regra antiga ela
  // perderia; sob a regra nova ela é o destaque. Se alguém reverter a
  // comparação para o custo, este é o teste que cai.
  const v0 = carta("v0", "veiculo", 0.90, 500_000, 2_000); // alavancagem 250
  assert.ok(alavancagem(v0) > alavancagem(IMOVEIS[0]));
  assert.ok(v0.custoAm! > IMOVEIS[0].custoAm!, "o caso perde a graça se v0 for o mais barato");

  const fila = intercalar(IMOVEIS, [v0, ...VEICULOS]);
  assert.equal(fila[0].id, "v0");
  assert.equal(fila[0].tipo, "veiculo");
});

test("intercalar: o slide de abertura é o MESMO que a regra escolheria sozinha", () => {
  // A coerência de vitrine que a OS exige: o carrossel não pode abrir com uma
  // carta e o post do dia sair com outra. Como as duas passam pelo mesmo
  // comparador, a primeira carta da fila tem que ser a de melhor colocação
  // entre TODAS as candidatas, ignorando a alternância.
  const todas = [...IMOVEIS, ...VEICULOS].sort((a, b) => alavancagem(b) - alavancagem(a));
  assert.equal(intercalar(IMOVEIS, VEICULOS)[0].id, todas[0].id);
});

test("intercalar: quando um lado acaba, o outro completa sem deixar buraco", () => {
  const fila = intercalar(IMOVEIS, [carta("v1", "veiculo", 0.42)]);
  assert.equal(fila.length, 5, "4 imóveis + 1 veículo — não inventa carta");
  assert.equal(fila.filter((c) => c.tipo === "veiculo").length, 1);
});

test("intercalar: lista vazia devolve vazio, sem estourar", () => {
  assert.deepEqual(intercalar([], []), []);
});

test("intercalar: nunca repete a mesma carta", () => {
  const fila = intercalar(IMOVEIS, VEICULOS);
  assert.equal(new Set(fila.map((c) => c.id)).size, fila.length);
});

test("intercalar: respeita a quantidade pedida", () => {
  assert.equal(intercalar(IMOVEIS, VEICULOS, 3).length, 3);
  // O default é o que a rota usa; se alguém mexer nele, este teste grita.
  assert.equal(CARTAS_POR_CARROSSEL, 6);
});

test("legenda: passa no compliance da casa", () => {
  const legenda = montarLegendaCarrossel(intercalar(IMOVEIS, VEICULOS));
  assert.equal(
    revisarLegenda(legenda),
    null,
    "a legenda do carrossel não pode ser reprovada pelo linter"
  );
});

test("legenda: todo percentual sai como '% a.m.'", () => {
  const legenda = montarLegendaCarrossel(intercalar(IMOVEIS, VEICULOS));
  // Conta quantos '%' existem e quantos vêm seguidos de ' a.m.'. Se um dia
  // alguém acrescentar um número solto, os dois deixam de bater.
  const totais = (legenda.match(/%/g) ?? []).length;
  const aoMes = (legenda.match(/% a\.m\./g) ?? []).length;
  assert.equal(totais, aoMes, "existe percentual sem ' a.m.' na legenda");
});

test("legenda: uma linha por carta, na MESMA ordem dos slides", () => {
  const fila = intercalar(IMOVEIS, VEICULOS);
  const legenda = montarLegendaCarrossel(fila);
  // A ordem é o que liga a legenda ao arrastar do carrossel: o item 3 da
  // legenda tem que ser o slide 4 (capa + 3).
  const indices = fila.map((_, i) => legenda.indexOf(`${i + 1}. `));
  assert.ok(indices.every((p) => p >= 0), "faltou linha de alguma carta");
  for (let i = 1; i < indices.length; i++) {
    assert.ok(indices[i] > indices[i - 1], "as linhas saíram fora de ordem");
  }
});

test("legenda: menciona a Conta Notarial e o rótulo de IA", () => {
  const legenda = montarLegendaCarrossel(intercalar(IMOVEIS, VEICULOS));
  assert.ok(legenda.includes("Conta Notarial"));
  assert.ok(legenda.includes("assistente IA da Bidcon"));
});

test("legenda: cabe no limite de 2200 caracteres do Instagram", () => {
  // Medido na doc: legenda de post aceita até 2.200 caracteres. Seis cartas com
  // crédito de sete dígitos é o pior caso realista.
  const caras = Array.from({ length: 6 }, (_, i) =>
    carta(`x${i}`, i % 2 === 0 ? "imovel" : "veiculo", 0.4 + i / 100)
  ).map((c) => ({ ...c, credito: 2_385_990, parcela: 18_999, parcelas: 200 }));
  const legenda = montarLegendaCarrossel(caras);
  assert.ok(
    legenda.length <= 2200,
    `legenda com ${legenda.length} caracteres — o Instagram corta em 2200`
  );
});
