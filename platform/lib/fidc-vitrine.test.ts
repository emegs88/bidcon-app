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
  peneirarPorCusto,
  LOTE_CONSULTA,
  TETO_TELA,
  type CartaVitrine,
} from "@/lib/fidc-vitrine";
import { custoEfetivoCarta } from "@/lib/custo-efetivo";

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

// ---- peneirarPorCusto: a coluna crua não decide -----------------------------
// Medido em 14/08/2026 sobre as 2.422 cartas da vitrine viva: em SEIS tetos
// diferentes, o número de cartas que entravam só pela coluna foi de 2 a 10, e o
// número que entrava só pelo canônico foi ZERO em todos. O arredondamento duplo
// da trigger só empurra para cima — então filtrar pela coluna nunca escondeu
// carta barata, mas mostrava carta CARA a quem pediu teto. Estes testes travam
// o conserto: a peneira canônica RETIRA.

/** Carta de teste. Saldo 70.000 em 100x de R$ 1.000 → canônico ≈ 0,75% a.m. */
function carta(over: Partial<CartaVitrine> = {}): CartaVitrine {
  return {
    id: "id-1",
    ref: 1,
    tipo: "imovel",
    credito: 100000,
    entrada: 30000,
    parcela: 1000,
    parcelas: 100,
    custo_am: 0.7, // a COLUNA, deliberadamente mentindo para baixo
    administradora: "Porto",
    ...over,
  };
}

const CANONICO = custoEfetivoCarta({
  valor_credito: 100000,
  valor_entrada: 30000,
  valor_parcela: 1000,
  qtd_parcelas: 100,
});

test("a carta de teste é mesmo um caso de sobra-inclusão", () => {
  // Se esta âncora cair, os testes abaixo perdem o sentido e viram tautologia.
  assert.ok(CANONICO !== null);
  assert.ok(CANONICO! > 0.7, `canônico ${CANONICO} deveria passar de 0,70`);
  assert.ok(CANONICO! < 0.8, `canônico ${CANONICO} deveria ficar abaixo de 0,80`);
});

test("o número devolvido é o canônico, não o da coluna", () => {
  // A tela do fundo e a peneira precisam falar o MESMO número. Devolver a
  // coluna aqui faria a carta aprovada por 0,75 aparecer escrita como 0,70.
  const [c] = peneirarPorCusto([carta()], null);
  assert.equal(c.custo_am, CANONICO);
  assert.notEqual(c.custo_am, 0.7);
});

test("carta acima do teto é RETIRADA, mesmo com a coluna dizendo que cabe", () => {
  // O defeito inteiro em uma linha: a coluna diz 0,70, o teto é 0,70, o banco
  // deixaria passar — e o fundo ofertaria 24 horas numa carta de 0,75.
  assert.deepEqual(peneirarPorCusto([carta()], 0.7), []);
});

test("carta dentro do teto continua entrando", () => {
  // A peneira retira o que está acima; não pode ficar zelosa e derrubar o resto.
  const saida = peneirarPorCusto([carta()], 0.8);
  assert.equal(saida.length, 1);
  assert.equal(saida[0].id, "id-1");
});

test("sem teto, ninguém é retirado e a ordem é a mesma", () => {
  const entrada = [carta({ id: "a" }), carta({ id: "b" }), carta({ id: "c" })];
  const saida = peneirarPorCusto(entrada, null);
  assert.deepEqual(
    saida.map((c) => c.id),
    ["a", "b", "c"]
  );
});

test("insumo incompleto: sem número, sai COM teto e fica SEM teto", () => {
  // A carta ref 147 do estoque real (parcelas = 0). Ela existe e é ofertável,
  // só não tem custo calculável. Sem filtro, aparece — esconder carta viva por
  // falta de um número seria mentir por omissão. COM filtro, sai: não dá para
  // afirmar que está abaixo de um teto que não se sabe medir.
  const sem = carta({ id: "ref-147", parcelas: 0, custo_am: 0.5 });
  const solta = peneirarPorCusto([sem], null);
  assert.equal(solta.length, 1);
  assert.equal(solta[0].custo_am, null, "a coluna 0,5 não pode sobreviver");
  assert.deepEqual(peneirarPorCusto([sem], 1.5), []);
});

test("a peneira não altera a lista que recebeu", () => {
  // Quem chama reusa a lista original. Mutar aqui trocaria o custo de uma carta
  // por baixo dos panos, num lugar onde ninguém iria procurar.
  const original = carta();
  peneirarPorCusto([original], null);
  assert.equal(original.custo_am, 0.7);
});
