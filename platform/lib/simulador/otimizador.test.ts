// ============================================================================
// Bidcon — Simulador Conta Notarial para Parceiros (fatia SIM-PARCEIRO-01.2,
// FASE 1 — "MELHOR CESTA").
// ----------------------------------------------------------------------------
// Runner NATIVO do Node: `node:test` + `node:assert` (ZERO dependência nova).
// Rodar:  npx tsx --test lib/simulador/otimizador.test.ts
//
// Estratégia de validação: como o otimizador só reaproveita `engine.ts` (nunca
// recalcula líquido/TIR por conta própria), a checagem mais forte não é
// hard-code de números mágicos — é uma força-bruta DE REFERÊNCIA (escrita
// aqui, no teste, independente da implementação do otimizador) que enumera
// TODOS os subconjuntos não-vazios de um universo pequeno (5 cotas → 31
// subconjuntos), calcula líquido/TIR com as MESMAS funções do engine, e
// confirma que o resultado #1 do otimizador bate com o melhor subconjunto
// achado pela força-bruta (dentro de tolerância numérica do solver de TIR).
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import { type CotaSim, type ParamsFundo, liquidoCliente, tirComNet0 } from "./engine";
import { type CandidatoCesta, sugerirMelhorCesta } from "./otimizador";

// ---- fixture: 5 cotas com entrada/parcela/crédito distintos e não-nulos,
// pra que a soma de entrada por cesta (calculada pelo otimizador) tenha
// significado (ao contrário do fixture de engine.test.ts, que usa entrada=0
// por cota — lá a entrada da operação é um parâmetro externo, não a soma). ----
function cotasDataset(): CotaSim[] {
  const base = {
    administradoraId: "adm-1",
    administradoraNome: "Administradora Teste",
    custoAmEstoque: null,
    exclusiva: false,
    tipo: "imovel" as const,
  };
  return [
    { ...base, id: "A", ref: "#A", credito: 300_000, entrada: 30_000, prazo: 180, parcela: 2_000 },
    { ...base, id: "B", ref: "#B", credito: 250_000, entrada: 20_000, prazo: 170, parcela: 1_800 },
    { ...base, id: "C", ref: "#C", credito: 200_000, entrada: 15_000, prazo: 160, parcela: 1_500 },
    { ...base, id: "D", ref: "#D", credito: 150_000, entrada: 10_000, prazo: 150, parcela: 1_200 },
    { ...base, id: "E", ref: "#E", credito: 100_000, entrada: 8_000, prazo: 140, parcela: 900 },
  ];
}

const paramsFundoDefault: ParamsFundo = {
  fundoPct: 11,
  ccb: 15_000.0,
  iofPct: 0.96,
  taxaNoLiquido: false,
};
const taxaTransferencia = 5_000; // irrelevante aqui (taxaNoLiquido=false), mas realista

// ---- força-bruta de referência (independente da implementação do otimizador) ----
function todosSubconjuntosNaoVazios<T>(arr: T[]): T[][] {
  const out: T[][] = [];
  const n = arr.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const sub: T[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) sub.push(arr[i]);
    out.push(sub);
  }
  return out;
}

function compararRef(a: CandidatoCesta, b: CandidatoCesta): number {
  if (a.tir !== b.tir) return a.tir - b.tir;
  if (a.liquido !== b.liquido) return b.liquido - a.liquido;
  return a.nCartas - b.nCartas;
}

function melhorPorForcaBruta(
  cotas: CotaSim[],
  taxa: number,
  paramsFundo: ParamsFundo,
  filtro: (cotas: CotaSim[], entrada: number, liquido: number) => boolean,
): CandidatoCesta | null {
  let melhor: CandidatoCesta | null = null;
  for (const sub of todosSubconjuntosNaoVazios(cotas)) {
    const entrada = sub.reduce((s, c) => s + c.entrada, 0);
    const liquido = liquidoCliente(sub, entrada, taxa, paramsFundo);
    if (!filtro(sub, entrada, liquido)) continue;
    const tir = tirComNet0(sub, liquido);
    if (tir == null) continue;
    const candidato: CandidatoCesta = {
      cotas: sub,
      entrada,
      liquido,
      tir,
      parcelaMes1: sub.reduce((s, c) => (c.prazo >= 1 ? s + c.parcela : s), 0),
      prazoMax: Math.max(0, ...sub.map((c) => c.prazo)),
      nCartas: sub.length,
    };
    if (!melhor || compararRef(candidato, melhor) < 0) melhor = candidato;
  }
  return melhor;
}

// ============================================================================
// Casos básicos / bordas
// ============================================================================

test("universo vazio retorna []", () => {
  const resultado = sugerirMelhorCesta({
    cotas: [],
    taxaTransferencia,
    paramsFundo: paramsFundoDefault,
    objetivo: { tipo: "liquido_maximo" },
  });
  assert.deepEqual(resultado, []);
});

test("objetivo líquido_mínimo inatingível retorna []", () => {
  const resultado = sugerirMelhorCesta({
    cotas: cotasDataset(),
    taxaTransferencia,
    paramsFundo: paramsFundoDefault,
    objetivo: { tipo: "liquido_minimo", liquidoMinimo: 999_999_999 },
  });
  assert.deepEqual(resultado, []);
});

test("resultado nunca excede 3 cestas e vem ordenado por TIR ascendente", () => {
  const resultado = sugerirMelhorCesta({
    cotas: cotasDataset(),
    taxaTransferencia,
    paramsFundo: paramsFundoDefault,
    objetivo: { tipo: "liquido_maximo" },
  });
  assert.ok(resultado.length > 0, "deveria achar ao menos uma cesta viável");
  assert.ok(resultado.length <= 3, "no máximo 3 cestas retornadas");
  for (let i = 1; i < resultado.length; i++) {
    assert.ok(
      resultado[i].tir >= resultado[i - 1].tir - 1e-9,
      "cestas devem vir em ordem de TIR ascendente",
    );
  }
});

test("cestas retornadas são distintas entre si (dedup por conjunto de cartas)", () => {
  const resultado = sugerirMelhorCesta({
    cotas: cotasDataset(),
    taxaTransferencia,
    paramsFundo: paramsFundoDefault,
    objetivo: { tipo: "liquido_maximo" },
  });
  const chaves = resultado.map((c) => [...c.cotas.map((x) => x.id)].sort().join("|"));
  assert.equal(new Set(chaves).size, chaves.length, "não deve haver cestas duplicadas no top-3");
});

// ============================================================================
// Restrições
// ============================================================================

test("restrição maxCartas é respeitada em todas as cestas retornadas", () => {
  const resultado = sugerirMelhorCesta({
    cotas: cotasDataset(),
    taxaTransferencia,
    paramsFundo: paramsFundoDefault,
    objetivo: { tipo: "liquido_maximo" },
    restricoes: { maxCartas: 2 },
  });
  assert.ok(resultado.length > 0);
  for (const c of resultado) assert.ok(c.nCartas <= 2, `cesta com ${c.nCartas} cartas excede maxCartas=2`);
});

test("restrição maxCartas > 5 é sempre limitada ao teto de negócio (5)", () => {
  const resultado = sugerirMelhorCesta({
    cotas: cotasDataset(),
    taxaTransferencia,
    paramsFundo: paramsFundoDefault,
    objetivo: { tipo: "liquido_maximo" },
    restricoes: { maxCartas: 999 },
  });
  for (const c of resultado) assert.ok(c.nCartas <= 5, `teto de negócio de 5 cartas violado: ${c.nCartas}`);
});

test("restrição parcelaMaxMes1 exclui cestas cuja parcela do mês 1 estoura o teto", () => {
  const teto = 3_000; // exclui, por ex., a combinação A+B (2000+1800=3800)
  const resultado = sugerirMelhorCesta({
    cotas: cotasDataset(),
    taxaTransferencia,
    paramsFundo: paramsFundoDefault,
    objetivo: { tipo: "liquido_maximo" },
    restricoes: { parcelaMaxMes1: teto },
  });
  for (const c of resultado) {
    const parcelaMes1 = c.cotas.reduce((s, x) => (x.prazo >= 1 ? s + x.parcela : s), 0);
    assert.ok(parcelaMes1 <= teto + 1e-9, `parcela mês 1 (${parcelaMes1}) excede teto ${teto}`);
  }
});

test("restrição prazoMax exclui cestas com alguma cota de prazo mais longo que o teto", () => {
  const teto = 160; // exclui cotas A (180) e B (170)
  const resultado = sugerirMelhorCesta({
    cotas: cotasDataset(),
    taxaTransferencia,
    paramsFundo: paramsFundoDefault,
    objetivo: { tipo: "liquido_maximo" },
    restricoes: { prazoMax: teto },
  });
  for (const c of resultado) {
    assert.ok(c.prazoMax <= teto, `prazoMax da cesta (${c.prazoMax}) excede teto ${teto}`);
    assert.ok(
      c.cotas.every((x) => x.id !== "A" && x.id !== "B"),
      "cestas com prazoMax<=160 não podem conter as cotas A/B (prazo 180/170)",
    );
  }
});

test("objetivo líquido_mínimo só retorna cestas que atingem o piso pedido", () => {
  const piso = 300_000;
  const resultado = sugerirMelhorCesta({
    cotas: cotasDataset(),
    taxaTransferencia,
    paramsFundo: paramsFundoDefault,
    objetivo: { tipo: "liquido_minimo", liquidoMinimo: piso },
  });
  assert.ok(resultado.length > 0, "deveria existir ao menos uma cesta que atinge o piso");
  for (const c of resultado) assert.ok(c.liquido >= piso - 1e-6, `líquido ${c.liquido} abaixo do piso ${piso}`);
});

// ============================================================================
// Cross-check contra força-bruta independente (universo pequeno o bastante
// pra enumerar os 31 subconjuntos não-vazios de 5 cotas)
// ============================================================================

test("top-1 do otimizador bate com o melhor subconjunto por força-bruta (sem restrições)", () => {
  const cotas = cotasDataset();
  const resultado = sugerirMelhorCesta({
    cotas,
    taxaTransferencia,
    paramsFundo: paramsFundoDefault,
    objetivo: { tipo: "liquido_maximo" },
  });
  const referencia = melhorPorForcaBruta(cotas, taxaTransferencia, paramsFundoDefault, () => true);

  assert.ok(referencia, "força-bruta deveria achar uma cesta viável");
  assert.ok(resultado.length > 0, "otimizador deveria achar uma cesta viável");

  const top1 = resultado[0];
  assert.equal(
    [...top1.cotas.map((c) => c.id)].sort().join("|"),
    [...referencia!.cotas.map((c) => c.id)].sort().join("|"),
    "cesta #1 do otimizador deveria ser a mesma cesta ótima da força-bruta",
  );
  assert.ok(Math.abs(top1.tir - referencia!.tir) < 1e-6, "TIR do top-1 deveria bater com a força-bruta");
});

test("top-1 do otimizador bate com a força-bruta sob restrição de maxCartas=3", () => {
  const cotas = cotasDataset();
  const resultado = sugerirMelhorCesta({
    cotas,
    taxaTransferencia,
    paramsFundo: paramsFundoDefault,
    objetivo: { tipo: "liquido_maximo" },
    restricoes: { maxCartas: 3 },
  });
  const referencia = melhorPorForcaBruta(
    cotas,
    taxaTransferencia,
    paramsFundoDefault,
    (sub) => sub.length <= 3,
  );

  assert.ok(referencia);
  assert.ok(resultado.length > 0);
  const top1 = resultado[0];
  assert.equal(
    [...top1.cotas.map((c) => c.id)].sort().join("|"),
    [...referencia!.cotas.map((c) => c.id)].sort().join("|"),
    "cesta #1 sob maxCartas=3 deveria ser a mesma cesta ótima da força-bruta",
  );
  assert.ok(Math.abs(top1.tir - referencia!.tir) < 1e-6);
});

test("todas as cestas retornadas têm números 100% derivados do engine (liquido/tir recalculados batem)", () => {
  const cotas = cotasDataset();
  const resultado = sugerirMelhorCesta({
    cotas,
    taxaTransferencia,
    paramsFundo: paramsFundoDefault,
    objetivo: { tipo: "liquido_maximo" },
  });
  for (const c of resultado) {
    const liquidoRecalc = liquidoCliente(c.cotas, c.entrada, taxaTransferencia, paramsFundoDefault);
    const tirRecalc = tirComNet0(c.cotas, liquidoRecalc);
    assert.ok(Math.abs(liquidoRecalc - c.liquido) < 1e-6, "líquido da cesta deveria bater com engine.liquidoCliente");
    assert.ok(tirRecalc != null && Math.abs(tirRecalc - c.tir) < 1e-9, "TIR da cesta deveria bater com engine.tirComNet0");
  }
});
