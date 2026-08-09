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
import { revisarLegenda } from "./selecao";
import type { CartaCarrossel } from "@/lib/carrossel-formato";

/** Carta mínima para o teste. Só os campos que as duas funções olham. */
function carta(id: string, tipo: "imovel" | "veiculo", custoAm: number): CartaCarrossel {
  return {
    id,
    tipo,
    tipoLabel: tipo === "imovel" ? "Imóvel" : "Veículo",
    administradora: "Teste",
    credito: 300_000,
    entrada: 90_000,
    parcela: 2_500,
    parcelas: 120,
    custoAm,
    exclusiva: false,
  };
}

// As listas chegam ORDENADAS por custo — é o contrato de `candidatos()`.
const IMOVEIS = [
  carta("i1", "imovel", 0.40),
  carta("i2", "imovel", 0.45),
  carta("i3", "imovel", 0.50),
  carta("i4", "imovel", 0.55),
];
const VEICULOS = [
  carta("v1", "veiculo", 0.42),
  carta("v2", "veiculo", 0.47),
  carta("v3", "veiculo", 0.52),
  carta("v4", "veiculo", 0.57),
];

test("intercalar: 6 slides, 3 de cada tipo, alternando", () => {
  const fila = intercalar(IMOVEIS, VEICULOS);
  assert.equal(fila.length, 6);
  assert.deepEqual(
    fila.map((c) => c.id),
    ["i1", "v1", "i2", "v2", "i3", "v3"]
  );
});

test("intercalar: começa pelo mais barato dos dois, não por um tipo fixo", () => {
  // Aqui o veículo mais barato ganha do imóvel mais barato. O slide 2 do
  // carrossel — o primeiro depois da capa — tem que ser ele.
  const veiculosBaratos = [carta("v1", "veiculo", 0.30), ...VEICULOS];
  const fila = intercalar(IMOVEIS, veiculosBaratos);
  assert.equal(fila[0].id, "v1");
  assert.equal(fila[0].tipo, "veiculo");
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
