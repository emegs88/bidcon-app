// ============================================================================
// Teste da leitura de filtros da vitrine do fundo (FIDC-OFERTAS-01 · E2)
// ----------------------------------------------------------------------------
// Só a parte PURA: `normalizarFiltros`, que é onde mora o dano possível. Um
// filtro mal lido não estoura — ele devolve a lista ERRADA, e a pessoa faz uma
// oferta de 24 horas em cima dela sem desconfiar de nada. Erro que não grita é
// erro que precisa de teste.
//
// O caso que mais importa aqui é `null` vs `0`. Se "abc" virasse 0, um campo
// digitado errado passaria a significar "crédito acima de zero" — um filtro de
// verdade, aplicado sem que ninguém tenha pedido.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizarFiltros,
  fatiar,
  LOTE_CONSULTA,
  TETO_TELA,
} from "@/lib/fidc-vitrine";

test("sem parâmetro nenhum: todos os filtros ausentes", () => {
  const f = normalizarFiltros({});
  assert.deepEqual(f, {
    tipo: null,
    creditoMin: null,
    creditoMax: null,
    administradora: null,
    custoMax: null,
  });
});

test("tipo só aceita os dois que existem, ignorando caixa", () => {
  assert.equal(normalizarFiltros({ tipo: "IMOVEL" }).tipo, "imovel");
  assert.equal(normalizarFiltros({ tipo: " veiculo " }).tipo, "veiculo");
  assert.equal(normalizarFiltros({ tipo: "casa" }).tipo, null);
  assert.equal(normalizarFiltros({ tipo: "" }).tipo, null);
});

test("número entra como a pessoa digita — pt-BR ou cru", () => {
  assert.equal(normalizarFiltros({ credito_min: "150000" }).creditoMin, 150000);
  assert.equal(normalizarFiltros({ credito_min: "150.000" }).creditoMin, 150000);
  assert.equal(
    normalizarFiltros({ credito_min: "150.000,50" }).creditoMin,
    150000.5
  );
  assert.equal(normalizarFiltros({ credito_min: "150000.50" }).creditoMin, 150000.5);
  assert.equal(
    normalizarFiltros({ credito_min: "1.234.567,89" }).creditoMin,
    1234567.89
  );
});

test("o ponto ambíguo é decidido por grupo de três, e está registrado", () => {
  // Este teste existe porque a primeira versão errava aqui: apagava todo ponto
  // e "150000.50" virava 15000050 — cem vezes o pedido, sem erro nenhum.
  assert.equal(normalizarFiltros({ credito_min: "150.000" }).creditoMin, 150000);
  assert.equal(normalizarFiltros({ credito_min: "150000.50" }).creditoMin, 150000.5);
  // Assumido: dois dígitos depois do ponto são centavos, não milhar.
  assert.equal(normalizarFiltros({ credito_min: "150.00" }).creditoMin, 150);
});

test("entrada ilegível vira ausente, NUNCA zero", () => {
  // A borda inteira deste arquivo. Zero filtraria; ausente não.
  for (const lixo of ["abc", "", "   ", "R$"]) {
    const f = normalizarFiltros({ credito_min: lixo, custo_max: lixo });
    assert.equal(f.creditoMin, null, `credito_min de ${JSON.stringify(lixo)}`);
    assert.equal(f.custoMax, null, `custo_max de ${JSON.stringify(lixo)}`);
  }
});

test("faixa invertida é corrigida, não recusada", () => {
  const f = normalizarFiltros({ credito_min: "500000", credito_max: "100000" });
  assert.equal(f.creditoMin, 100000);
  assert.equal(f.creditoMax, 500000);
});

test("custo máximo zero ou negativo não é filtro", () => {
  // "custo até 0% a.m." não devolveria carta nenhuma e pareceria vitrine vazia.
  assert.equal(normalizarFiltros({ custo_max: "0" }).custoMax, null);
  assert.equal(normalizarFiltros({ custo_max: "-1" }).custoMax, null);
  assert.equal(normalizarFiltros({ custo_max: "1,2" }).custoMax, 1.2);
});

test("administradora vazia ou só espaço não vira filtro", () => {
  assert.equal(normalizarFiltros({ adm: "   " }).administradora, null);
  assert.equal(normalizarFiltros({ adm: " Porto " }).administradora, "Porto");
});

test("parâmetro repetido na URL usa o primeiro, sem estourar", () => {
  const f = normalizarFiltros({ tipo: ["veiculo", "imovel"] });
  assert.equal(f.tipo, "veiculo");
});

test("o teto de tela é um número declarado, não um literal solto", () => {
  assert.equal(typeof TETO_TELA, "number");
  assert.ok(TETO_TELA > 0);
});

// ---- fatiar: a aritmética que erra em silêncio -----------------------------
// O dano de um erro aqui não é uma exceção: é uma oferta com MENOS cartas do
// que a pessoa marcou, e as que sumiram apareceriam como "saíram da vitrine".
// Perda que se disfarça de fato do mundo é o motivo destes cinco testes.

test("fatiar: nada entra, nada sai", () => {
  assert.deepEqual(fatiar([]), []);
});

test("fatiar: menos que o lote cabe numa fatia só", () => {
  assert.deepEqual(fatiar([1, 2, 3], 100), [[1, 2, 3]]);
});

test("fatiar: o múltiplo exato NÃO produz uma fatia vazia no fim", () => {
  // O `<=` que alguém escreveria por engano criaria [[1,2],[3,4],[]], e a fatia
  // vazia viraria um `.in("id", [])` — consulta que devolve zero linhas e faz
  // todas as cartas do lote parecerem indisponíveis.
  assert.deepEqual(fatiar([1, 2, 3, 4], 2), [
    [1, 2],
    [3, 4],
  ]);
});

test("fatiar: a concatenação é EXATAMENTE a entrada, na ordem", () => {
  // A garantia que importa: ninguém se perde e ninguém se repete. Testado no
  // teto real da tela contra o lote real, e não em números escolhidos a dedo.
  const ids = Array.from({ length: TETO_TELA }, (_, i) => `id-${i}`);
  const fatias = fatiar(ids);
  assert.deepEqual(fatias.flat(), ids);
  assert.equal(new Set(fatias.flat()).size, TETO_TELA);
  assert.equal(fatias.length, Math.ceil(TETO_TELA / LOTE_CONSULTA));
  for (const f of fatias) assert.ok(f.length > 0 && f.length <= LOTE_CONSULTA);
});

test("fatiar: tamanho zero é erro, não laço infinito", () => {
  // Sem esta guarda o `i += 0` trava o processo em silêncio — o pior modo de
  // falhar que existe, porque não deixa rastro nenhum para ler depois.
  assert.throws(() => fatiar([1, 2, 3], 0));
});
