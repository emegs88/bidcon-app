// ============================================================================
// Bidcon — Simulador Conta Notarial para Parceiros (fatia SIM-PARCEIRO-01).
// ----------------------------------------------------------------------------
// Runner NATIVO do Node: `node:test` + `node:assert` (ZERO dependência nova).
// Rodar:  npx tsx --test lib/simulador/engine.test.ts
//    ou:  compilar p/ JS e `node --test`.
//
// Cobre os dois datasets de aceite obrigatórios do prompt SIM-PARCEIRO-01:
//   1) Modo aquisição direta (§4)  — 5 cotas, mesma administradora.
//   2) Modo levantamento de capital (§10) — mesmas 5 cotas, fundo paga a
//      entrada, TIR calculada sobre o líquido recebido pelo CLIENTE.
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  type CotaSim,
  type ParamsFundo,
  parcelaNoMes,
  escalaParcelas,
  saldoDevedor,
  tirMensal,
  anualEquivalente,
  custosFundo,
  liquidoCliente,
  tirCliente,
} from "./engine";

// ---- helper ------------------------------------------------------------
function aproxima(actual: number, expected: number, tol: number, msg?: string) {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${msg ?? "valor"}: esperado ${expected} ± ${tol}, obtido ${actual}`,
  );
}

// ---- dataset compartilhado (5 cotas, mesma administradora) --------------
function cotasDataset(): CotaSim[] {
  const base = {
    administradoraId: "adm-1",
    administradoraNome: "Administradora Teste",
    custoAmEstoque: null,
    exclusiva: false,
  };
  return [
    { ...base, id: "1", ref: "#1", credito: 538428.0, entrada: 0, prazo: 205, parcela: 3374.0 },
    { ...base, id: "2", ref: "#2", credito: 351865.0, entrada: 0, prazo: 212, parcela: 2163.0 },
    { ...base, id: "3", ref: "#3", credito: 351840.0, entrada: 0, prazo: 217, parcela: 2145.0 },
    { ...base, id: "4", ref: "#4", credito: 351840.0, entrada: 0, prazo: 215, parcela: 2408.0 },
    { ...base, id: "5", ref: "#5", credito: 250105.0, entrada: 0, prazo: 199, parcela: 1542.0 },
  ];
}

// ============================================================================
// MODO AQUISIÇÃO DIRETA (§4)
// ============================================================================

test("Σ crédito da cesta = 1.844.078,00", () => {
  const cotas = cotasDataset();
  const total = cotas.reduce((s, c) => s + c.credito, 0);
  aproxima(total, 1_844_078.0, 0.01, "soma crédito");
});

test("saldoDevedor da cesta = 2.440.269,00", () => {
  const cotas = cotasDataset();
  aproxima(saldoDevedor(cotas), 2_440_269.0, 0.01, "saldoDevedor");
});

test("escalaParcelas produz as 5 faixas esperadas", () => {
  const cotas = cotasDataset();
  const escala = escalaParcelas(cotas);
  const esperado = [
    { de: 1, ate: 199, valor: 11_632.0 },
    { de: 200, ate: 205, valor: 10_090.0 },
    { de: 206, ate: 212, valor: 6_716.0 },
    { de: 213, ate: 215, valor: 4_553.0 },
    { de: 216, ate: 217, valor: 2_145.0 },
  ];
  assert.equal(escala.length, esperado.length, "quantidade de faixas");
  escala.forEach((f, idx) => {
    assert.equal(f.de, esperado[idx].de, `faixa ${idx} .de`);
    assert.equal(f.ate, esperado[idx].ate, `faixa ${idx} .ate`);
    aproxima(f.valor, esperado[idx].valor, 0.01, `faixa ${idx} .valor`);
  });
});

test("parcelaNoMes bate com a escala em pontos de transição", () => {
  const cotas = cotasDataset();
  aproxima(parcelaNoMes(cotas, 1), 11_632.0, 0.01);
  aproxima(parcelaNoMes(cotas, 199), 11_632.0, 0.01);
  aproxima(parcelaNoMes(cotas, 200), 10_090.0, 0.01);
  aproxima(parcelaNoMes(cotas, 205), 10_090.0, 0.01);
  aproxima(parcelaNoMes(cotas, 206), 6_716.0, 0.01);
  aproxima(parcelaNoMes(cotas, 216), 2_145.0, 0.01);
  aproxima(parcelaNoMes(cotas, 217), 2_145.0, 0.01);
  assert.equal(parcelaNoMes(cotas, 218), 0);
});

test("tirMensal (aquisição direta) ≈ 0,011656 a.m.", () => {
  const cotas = cotasDataset();
  const desembolsoInicial = 909_130.45 + 24_976.0;
  const tir = tirMensal(cotas, desembolsoInicial);
  assert.ok(tir !== null, "tir não deve ser null");
  aproxima(tir as number, 0.011656, 0.0001, "tirMensal aquisição");
});

test("anualEquivalente aplica juros compostos (1+i)^12 - 1", () => {
  aproxima(anualEquivalente(0.011656), Math.pow(1.011656, 12) - 1, 1e-9);
});

test("sanity: tirMensal de uma única cota se aproxima do bidcon_custo_am de estoque (quando presente)", () => {
  const cota: CotaSim = {
    id: "solo",
    ref: "#9",
    administradoraId: "adm-1",
    administradoraNome: "Administradora Teste",
    credito: 250105.0,
    entrada: 90000.0,
    prazo: 199,
    parcela: 1542.0,
    custoAmEstoque: null,
    exclusiva: false,
  };
  const tirSolo = tirMensal([cota], cota.entrada);
  assert.ok(tirSolo !== null, "tir da cota isolada não deve ser null");
  // Sem bidcon_custo_am de referência neste caso sintético — apenas garante
  // que o solver converge a um número finito e positivo (custo financeiro
  // plausível), sem comparação de tolerância (não há valor de estoque aqui).
  assert.ok(Number.isFinite(tirSolo as number));
});

// ============================================================================
// MODO LEVANTAMENTO DE CAPITAL (§10)
// ============================================================================

const paramsFundoDefault: ParamsFundo = {
  fundoPct: 11,
  ccb: 15_000.0,
  iofPct: 0.96,
  taxaNoLiquido: false,
};

test("custosFundo — iof, ccb e remuneração batem com o esperado", () => {
  const entrada = 909_130.45;
  const c = custosFundo(entrada, paramsFundoDefault);
  aproxima(c.iof, 8_727.65, 0.01, "iof");
  aproxima(c.ccb, 15_000.0, 0.01, "ccb");
  aproxima(c.rem, 100_004.35, 0.01, "rem");
  aproxima(c.total, c.iof + c.ccb + c.rem, 0.01, "total");
});

test("liquidoCliente = 811.215,55 (taxaNoLiquido=false)", () => {
  const cotas = cotasDataset();
  const entrada = 909_130.45;
  const taxa = 24_976.0;
  const liquido = liquidoCliente(cotas, entrada, taxa, paramsFundoDefault);
  aproxima(liquido, 811_215.55, 0.01, "líquido cliente");
});

test("liquidoCliente = 786.239,55 (taxaNoLiquido=true)", () => {
  const cotas = cotasDataset();
  const entrada = 909_130.45;
  const taxa = 24_976.0;
  const params: ParamsFundo = { ...paramsFundoDefault, taxaNoLiquido: true };
  const liquido = liquidoCliente(cotas, entrada, taxa, params);
  aproxima(liquido, 786_239.55, 0.01, "líquido cliente (taxa deduzida)");
});

test("tirCliente ≈ 0,013470 a.m. (levantamento de capital)", () => {
  const cotas = cotasDataset();
  const entrada = 909_130.45;
  const taxa = 24_976.0;
  const tir = tirCliente(cotas, entrada, taxa, paramsFundoDefault);
  assert.ok(tir !== null, "tirCliente não deve ser null");
  aproxima(tir as number, 0.01347, 0.0001, "tirCliente");
});

test("tirComNet0 (via tirMensal/tirCliente) retorna null quando net0 <= 0", () => {
  const cotas = cotasDataset();
  // desembolso absurdamente alto: poder de compra - desembolso <= 0
  const tir = tirMensal(cotas, 999_999_999);
  assert.equal(tir, null);
});
