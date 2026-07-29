// ============================================================================
// Teste-fumaça de RENDER do simulador Disal.
//
// Runner nativo do Node (mesmo padrão dos outros *.test.ts). Rodar:
//   npx tsx --test lib/simulador-disal.test.tsx
//
// POR QUÊ este arquivo existe: o preview do PR #3 quebrou com
// "ReferenceError: Cannot access 'aq' before initialization" ao adicionar a
// primeira carta, em qualquer segmento e nos dois modos. Causa: no corpo do
// componente, `resumirCenario()` era CHAMADO acima da declaração de
// `projecaoDisponivel` (temporal dead zone). Como a função só lê essa
// variável depois do `if (!temCarteira) return null`, o render com carteira
// VAZIA passava — e era exatamente esse o único caminho que `tsc` e
// `next build` exercitavam. TypeScript não faz análise de TDZ através de
// chamada de função: o build ficou verde com a página quebrada.
//
// O que este teste faz de diferente: renderToString EXECUTA o corpo do
// componente. Com a carteira já preenchida via `estadoInicial`, ele percorre
// o mesmo caminho do usuário que adiciona uma carta — e explode no TDZ.
//
// Não substitui teste de interação (não há clique nem efeito aqui:
// renderToString não roda useEffect). Cobre a classe de erro que derrubou o
// preview: qualquer coisa que estoure ao AVALIAR o componente com carteira.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import {
  SimuladorDisalConteudo,
  type EstadoInicialSimulador,
} from "../app/interno/simulador-disal/SimuladorDisalConteudo";

function render(estadoInicial?: EstadoInicialSimulador): string {
  return renderToString(<SimuladorDisalConteudo estadoInicial={estadoInicial} />);
}

test("renderiza com a carteira vazia (estado de entrada da tela)", () => {
  const html = render();
  assert.ok(html.length > 0);
  assert.ok(html.includes("Disal"), "o cabeçalho da tela aparece");
});

// O caso que quebrou em produção: carteira NÃO vazia. Uma carta de cada tipo,
// nos dois modos — a matriz que o Emerson reproduziu no preview.
const CARTAS = [
  { rotulo: "veículo R$ 150 mil", carta: { tipo: "veiculo" as const, credito: 150_000, quantidade: 1 } },
  { rotulo: "imóvel R$ 300 mil", carta: { tipo: "imovel" as const, credito: 300_000, quantidade: 1 } },
];
const MODOS = ["juncao", "independente"] as const;

for (const modo of MODOS) {
  for (const { rotulo, carta } of CARTAS) {
    test(`renderiza com 1 carta de ${rotulo} no modo ${modo}`, () => {
      const html = render({ cartas: [carta], modo });
      assert.ok(html.length > 0);
      // se o corpo do componente tivesse estourado, renderToString teria
      // lançado antes daqui — a asserção abaixo só confirma que a carteira
      // realmente entrou no render, e não que caímos no caminho vazio.
      assert.ok(
        html.includes("Prazo até quitar") || html.includes("Poder de compra") || html.includes("Crédito total"),
        "o bloco da carteira foi renderizado",
      );
    });
  }
}

test("renderiza com junção de várias cartas (o caso dos presets)", () => {
  // "Junção 3× R$ 400 mil imóvel" — um dos presets de 1 clique
  const html = render({ cartas: [{ tipo: "imovel", credito: 400_000, quantidade: 3 }], modo: "juncao" });
  assert.ok(html.includes("Poder de compra"), "rótulo de junção presente");
});

test("renderiza com lance e cenário C declarados", () => {
  // combinação do comparador "Lance 30% · C=12"
  const html = render({
    cartas: [{ tipo: "imovel", credito: 300_000, quantidade: 3 }],
    modo: "juncao",
    lancePct: 30,
    cJuncao: 12,
  });
  assert.ok(html.length > 0);
});

test("renderiza no cenário em que a TIR não fecha (fallback em R$)", () => {
  // C tardio em junção de imóvel: nem a nominal nem a corrigida fecham, e a
  // tela troca a taxa por dois totais. É um caminho de render diferente.
  const html = render({
    cartas: [{ tipo: "imovel", credito: 300_000, quantidade: 3 }],
    modo: "juncao",
    cJuncao: 72,
  });
  assert.ok(html.includes("não fecha numa taxa única"), "o fallback honesto foi renderizado");
});

test("renderiza na Base 75% Light", () => {
  const html = render({ cartas: [{ tipo: "veiculo", credito: 150_000, quantidade: 2 }], base: "75" });
  assert.ok(html.length > 0);
});

test("o bloco de comissão NÃO aparece sem grade (Disal cadastrada, zero grades)", () => {
  // no render do servidor o fetch de /api/comissoes não roda, então
  // gradesDisal é null — mesmo efeito de grades: []. O bloco fica mudo.
  const html = render({ cartas: [{ tipo: "imovel", credito: 300_000, quantidade: 1 }] });
  assert.ok(!html.includes("Comissão Prospere"), "sem grade, nada de comissão na tela");
});
