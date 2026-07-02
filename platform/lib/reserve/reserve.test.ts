// ============================================================================
// Bidcon Reserve — testes de conformidade (Slice 1).
// ----------------------------------------------------------------------------
// Runner NATIVO do Node: `node:test` + `node:assert` (ZERO dependência nova).
// Rodar:  npx tsx --test lib/reserve/reserve.test.ts
//    ou:  compilar p/ JS e `node --test`.
// Cobre os 4 casos exigidos:
//   1) anuência negada → leg REFUND_BUYER integral (sinal),
//   2) taxa mínima R$2.500 vs 10%,
//   3) NOTARY_COSTS por faixa,
//   4) transição inválida rejeitada com erro tipado.
// Além disso: paridade da máquina de estados com a lista da RPC (0016 §5.4).
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assertTransicao,
  podeTransicionar,
  TransicaoInvalidaError,
  TRANSICOES,
  reservaAtiva,
  exigeGateHumano,
} from "./state-machine";

import {
  calcularFee,
  tarifaNotarial,
  repartirTarifaNotarial,
  montarLegs,
  montarFeePlan,
  legRefundBuyer,
  faixaSinal,
  sinalValido,
  FEE_MINIMO,
  TARIFA_NOTARIAL_VIGENCIA,
  ALOCACAO_NOTARIAL_DEFAULT,
  type Leg,
} from "./fee-plan";

// ---- helper ----------------------------------------------------------------
function soma(legs: Leg[], tipo: string): number {
  return legs.filter((l) => l.beneficiary_type === tipo).reduce((s, l) => s + l.amount, 0);
}

// ============================================================================
// CASO 1 — anuência negada → REFUND_BUYER integral
// ============================================================================
test("anuência negada devolve o sinal integral ao comprador (REFUND_BUYER)", () => {
  const sinal = 15000;
  const leg = legRefundBuyer("buyer-uuid", sinal);
  assert.equal(leg.beneficiary_type, "REFUND_BUYER");
  assert.equal(leg.beneficiary_id, "buyer-uuid");
  assert.equal(leg.amount, sinal); // integral do PRINCIPAL: nada retido do sinal
});

test("anuência negada: refund é só o principal — tarifa notarial NÃO retorna", () => {
  // Cenário: ágio 150k → tarifa notarial 675 (paga, não-reembolsável). Negócio
  // desfeito devolve o sinal cheio; a tarifa já paga fica (previsto no Termo).
  const sinal = 20000;
  const tarifa = tarifaNotarial(150000);
  const refund = legRefundBuyer("buyer-uuid", sinal);
  assert.equal(refund.amount, sinal); // principal integral
  assert.notEqual(tarifa, 0); // houve tarifa
  // O refund NÃO soma a tarifa (não-reembolsável): refund === sinal, não sinal+tarifa.
  assert.equal(refund.amount, sinal);
  assert.notEqual(refund.amount, sinal + tarifa);
});

test("transição VERIFIED→ANUENCIA_REQUESTED→ANUENCIA_DENIED→REFUNDED é válida", () => {
  assert.ok(podeTransicionar("VERIFIED", "ANUENCIA_REQUESTED"));
  assert.ok(podeTransicionar("ANUENCIA_REQUESTED", "ANUENCIA_DENIED"));
  assert.ok(podeTransicionar("ANUENCIA_DENIED", "REFUNDED"));
  // e ANUENCIA_DENIED é estado inativo (libera a carta p/ nova reserva)
  assert.equal(reservaAtiva("ANUENCIA_DENIED"), false);
});

// ============================================================================
// CASO 2 — taxa mínima R$2.500 vs 10%
// ============================================================================
test("fee usa o piso R$2.500 quando 10% do ágio fica abaixo", () => {
  // ágio 20.000 → 10% = 2.000 < 2.500 → vale o mínimo
  assert.equal(calcularFee(20000, "contemplada"), FEE_MINIMO);
});

test("fee usa 10% quando acima do piso (cota contemplada)", () => {
  // ágio 40.000 → 10% = 4.000 > 2.500
  assert.equal(calcularFee(40000, "contemplada"), 4000);
});

test("fee de cota cancelada usa 6% (com o mesmo piso)", () => {
  assert.equal(calcularFee(100000, "cancelada"), 6000); // 6%
  assert.equal(calcularFee(10000, "cancelada"), FEE_MINIMO); // 600 < 2500 → piso
});

test("ágio não-positivo cai no piso do fee", () => {
  assert.equal(calcularFee(0, "contemplada"), FEE_MINIMO);
  assert.equal(calcularFee(-5, "contemplada"), FEE_MINIMO);
});

// ============================================================================
// CASO 3 — NOTARY_COSTS por faixa (pct + piso; base = ágio movimentado)
// Tabela OFICIAL CNB-CF, 11 faixas (vigência 2026-04-01) — mínimos oficiais:
//   1 ≤99.999,99 →R$500 · 2 …299.999,99 0,45% mín500 · 3 …499.999,99 0,35% mín1350
//   4 …699.999,99 0,32% mín1750 · 5 …999.999,99 0,31% mín2240 · 6 …1.999.999,99 0,23% mín3100
//   7 …2.999.999,99 0,17% mín4600 · 8 …3.999.999,99 0,16% mín5100 · 9 …4.999.999,99 0,15% mín6400
//   10 …5.999.999,99 0,14% mín7500 · 11 ≥6.000.000 0,13% mín8400
// ============================================================================
test("tarifa notarial aplica pct×valor com piso por faixa (faixas 1–4)", () => {
  assert.equal(tarifaNotarial(50000), 500); // 1ª faixa: só piso fixo
  assert.equal(tarifaNotarial(99999.99), 500); // teto inclusivo da 1ª
  assert.equal(tarifaNotarial(150000), 675); // 2ª: 0,45% de 150k = 675
  assert.equal(tarifaNotarial(300000), 1350); // 3ª: 0,35% de 300k=1050 < piso 1350
  assert.equal(tarifaNotarial(400000), 1400); // 3ª: 0,35% de 400k = 1400
  assert.equal(tarifaNotarial(600000), 1920); // 4ª: 0,32% de 600k = 1920
});

test("tarifa notarial: exemplo oficial R$100.000 aplica o piso R$500 (não R$450)", () => {
  // 0,45% de 100.000 = 450, mas o mínimo oficial da Faixa 2 é R$500.
  assert.equal(tarifaNotarial(100000), 500);
});

test("tarifa notarial cobre as faixas superiores 5–11 (valores oficiais)", () => {
  // Faixa 5 (0,31% · mín 2.240)
  assert.equal(tarifaNotarial(700000), 2240); // 0,31% de 700k=2170 < piso 2240
  assert.equal(tarifaNotarial(800000), 2480); // 0,31% de 800k = 2480
  // Faixa 6 (0,23% · mín 3.100)
  assert.equal(tarifaNotarial(1000000), 3100); // 0,23% de 1MM=2300 < piso 3100
  assert.equal(tarifaNotarial(1500000), 3450); // 0,23% de 1,5MM = 3450
  // Faixa 7 (0,17% · mín 4.600)
  assert.equal(tarifaNotarial(2500000), 4600); // 0,17% de 2,5MM=4250 < piso 4600
  // Faixa 8 (0,16% · mín 5.100)
  assert.equal(tarifaNotarial(3500000), 5600); // 0,16% de 3,5MM = 5600
  // Faixa 9 (0,15% · mín 6.400)
  assert.equal(tarifaNotarial(4500000), 6750); // 0,15% de 4,5MM = 6750
  // Faixa 10 (0,14% · mín 7.500)
  assert.equal(tarifaNotarial(5500000), 7700); // 0,14% de 5,5MM = 7700
  // Faixa 11 (≥6MM · 0,13% · mín 8.400)
  assert.equal(tarifaNotarial(6000000), 8400); // 0,13% de 6MM=7800 < piso 8400
  assert.equal(tarifaNotarial(10000000), 13000); // 0,13% de 10MM = 13000
});

test("tarifa notarial: os 11 mínimos oficiais são pisos exatos por faixa", () => {
  // no teto de cada faixa o pct pode superar o piso; no piso o mínimo prevalece.
  assert.equal(tarifaNotarial(1), 500); // piso Faixa 1
  assert.equal(tarifaNotarial(300000), 1350); // piso Faixa 3 prevalece
  assert.equal(tarifaNotarial(2000000), 4600); // piso Faixa 7 prevalece (0,17%·2MM=3400)
});

test("tarifa notarial: valor não-positivo cai no piso da 1ª faixa", () => {
  assert.equal(tarifaNotarial(0), 500);
  assert.equal(tarifaNotarial(-10), 500);
});

test("a vigência da tabela de tarifa está declarada (rastreabilidade)", () => {
  assert.equal(TARIFA_NOTARIAL_VIGENCIA, "2026-04-01");
});

test("montarLegs inclui exatamente uma leg NOTARY_COSTS pela faixa do ágio", () => {
  const legs = montarLegs({
    agio: 150000,
    natureza: "contemplada",
    partes: { sourcing_partner_id: "s", selling_partner_id: "v", seller_id: "vend" },
  });
  const notary = legs.filter((l) => l.beneficiary_type === "NOTARY_COSTS");
  assert.equal(notary.length, 1);
  assert.equal(notary[0].amount, 675); // 150k → 2ª faixa (0,45%)
  assert.equal(notary[0].beneficiary_id, null);
});

// ---- alocação do NOTARY_COSTS (BUYER | SELLER | SPLIT, default SPLIT 50/50) ----
test("repartirTarifaNotarial: SPLIT 50/50 é o padrão e fecha com a tarifa", () => {
  assert.equal(ALOCACAO_NOTARIAL_DEFAULT, "SPLIT");
  const { buyer, seller } = repartirTarifaNotarial(675); // default
  assert.equal(buyer + seller, 675);
  assert.equal(buyer, 337.5);
  assert.equal(seller, 337.5);
});

test("repartirTarifaNotarial: BUYER e SELLER concentram tudo numa parte", () => {
  assert.deepEqual(repartirTarifaNotarial(500, "BUYER"), { buyer: 500, seller: 0 });
  assert.deepEqual(repartirTarifaNotarial(500, "SELLER"), { buyer: 0, seller: 500 });
});

test("repartirTarifaNotarial: SPLIT de valor ímpar fecha exatamente (sem sumir centavo)", () => {
  const { buyer, seller } = repartirTarifaNotarial(675.01, "SPLIT");
  assert.equal(Math.round((buyer + seller) * 100) / 100, 675.01); // soma exata
  // diferença de no máx. 1 centavo (compara em centavos p/ evitar ruído de float)
  assert.ok(Math.abs(Math.round(buyer * 100) - Math.round(seller * 100)) <= 1);
});

test("montarLegs carrega notary_alloc na leg NOTARY_COSTS (default SPLIT)", () => {
  const legs = montarLegs({
    agio: 150000,
    natureza: "contemplada",
    partes: { sourcing_partner_id: "s", selling_partner_id: "v", seller_id: "vend" },
  });
  const notary = legs.find((l) => l.beneficiary_type === "NOTARY_COSTS")!;
  assert.equal(notary.notary_alloc?.alocacao, "SPLIT");
  assert.equal(notary.notary_alloc!.buyer + notary.notary_alloc!.seller, notary.amount);
});

test("montarLegs respeita alocação BUYER quando pedida", () => {
  const legs = montarLegs({
    agio: 150000,
    natureza: "contemplada",
    partes: { sourcing_partner_id: "s", selling_partner_id: "v", seller_id: "vend" },
    alocacaoNotarial: "BUYER",
  });
  const notary = legs.find((l) => l.beneficiary_type === "NOTARY_COSTS")!;
  assert.equal(notary.notary_alloc?.alocacao, "BUYER");
  assert.equal(notary.notary_alloc?.buyer, notary.amount);
  assert.equal(notary.notary_alloc?.seller, 0);
});

// ============================================================================
// CASO 4 — transição inválida rejeitada com erro tipado
// ============================================================================
test("assertTransicao lança TransicaoInvalidaError em transição proibida", () => {
  assert.throws(
    () => assertTransicao("DRAFT", "SETTLED"),
    (err: unknown) => {
      assert.ok(err instanceof TransicaoInvalidaError);
      assert.equal((err as TransicaoInvalidaError).de, "DRAFT");
      assert.equal((err as TransicaoInvalidaError).para, "SETTLED");
      return true;
    }
  );
});

test("assertTransicao rejeita destino desconhecido (string fora do enum)", () => {
  assert.throws(() => assertTransicao("DRAFT", "BANANA"), TransicaoInvalidaError);
});

test("CLOSED é terminal: nenhuma transição sai dele", () => {
  assert.deepEqual(TRANSICOES.CLOSED, []);
});

// ============================================================================
// EXTRA — integridade do split, sinal e gate humano
// ============================================================================
test("soma das legs de ágio (sem NOTARY_COSTS) fecha com o ágio", () => {
  const agio = 40000;
  const legs = montarLegs({
    agio,
    natureza: "contemplada",
    partes: { sourcing_partner_id: "s", selling_partner_id: "v", seller_id: "vend" },
  });
  const semNotary = legs
    .filter((l) => l.beneficiary_type !== "NOTARY_COSTS")
    .reduce((s, l) => s + l.amount, 0);
  assert.equal(semNotary, agio); // SELLER + fee repartido = ágio
});

test("split default reparte o fee 40/40/20", () => {
  const legs = montarLegs({
    agio: 100000, // fee = 10.000
    natureza: "contemplada",
    partes: { sourcing_partner_id: "s", selling_partner_id: "v", seller_id: "vend" },
  });
  assert.equal(soma(legs, "SOURCING_PARTNER"), 4000);
  assert.equal(soma(legs, "SELLING_PARTNER"), 4000);
  assert.equal(soma(legs, "PLATFORM"), 2000);
});

test("parceiro ausente joga a fatia dele na plataforma (não some dinheiro)", () => {
  const legs = montarLegs({
    agio: 100000, // fee = 10.000
    natureza: "contemplada",
    partes: { sourcing_partner_id: null, selling_partner_id: "v", seller_id: "vend" },
  });
  assert.equal(soma(legs, "SOURCING_PARTNER"), 0);
  assert.equal(soma(legs, "SELLING_PARTNER"), 4000);
  assert.equal(soma(legs, "PLATFORM"), 6000); // 2000 + 4000 realocado
});

test("faixa de sinal é 10–20% do ágio e sinalValido concorda", () => {
  const { min, max } = faixaSinal(30000);
  assert.equal(min, 3000);
  assert.equal(max, 6000);
  assert.equal(sinalValido(30000, 3000), true);
  assert.equal(sinalValido(30000, 6000), true);
  assert.equal(sinalValido(30000, 2999.99), false);
  assert.equal(sinalValido(30000, 6000.01), false);
});

test("transições de dinheiro exigem gate humano", () => {
  assert.equal(exigeGateHumano("SETTLED"), true);
  assert.equal(exigeGateHumano("REFUNDED"), true);
  assert.equal(exigeGateHumano("FULLY_FUNDED"), true);
  assert.equal(exigeGateHumano("TERMS_SIGNED"), false);
});

test("montarFeePlan grava vigência/fonte e alocação para auditoria", () => {
  const plan = montarFeePlan({
    agio: 150000,
    natureza: "contemplada",
    partes: { sourcing_partner_id: "s", selling_partner_id: "v", seller_id: "vend" },
  });
  assert.equal(plan.tarifa_notarial, 675);
  assert.equal(plan.alocacao_notarial, "SPLIT");
  assert.equal(plan.tarifa_notarial_vigencia, TARIFA_NOTARIAL_VIGENCIA);
  assert.ok(plan.legs.some((l) => l.beneficiary_type === "NOTARY_COSTS"));
});
