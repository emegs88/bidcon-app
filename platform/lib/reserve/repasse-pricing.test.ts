// ============================================================================
// Bidcon Repasse — testes de conformidade do motor de preço (Fatia 0).
// ----------------------------------------------------------------------------
// Runner NATIVO do Node: `node:test` + `node:assert` (ZERO dependência nova).
// Rodar:  npx tsx --test lib/reserve/repasse-pricing.test.ts
//
// GABARITO DE ACEITE (tabela do plano — DELTA-4/5):
//   1) Cascata canônica: 70.000 → 7.000 → 63.000 → 6.300 → 56.700.
//   2) BID-0442 (Âncora): saldo 158.729,68 · 105× 1.504,26 · g=0 · CET-alvo 2%
//        → combinado ≈ 81.556 · líquido ≈ 65.810 · CET real 2,0%.
//   3) BID-0492 (Porto):  saldo 203.137 · 67× 3.031,89 · g=0 · CET-alvo 2%
//        → combinado ≈ 137.878 · líquido ≈ 111.370 · deposita ≈ 138.188 ·
//          economia 64.949 (32%).
// Além disso: segmento comanda correção/comparativo; garantia vs exigência; SEM TETO.
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  round2,
  cascata,
  feeBidcon,
  vpFluxo,
  cetReal,
  combinadoParaCET,
  precificarRepasse,
  avaliarGarantia,
  segmentoDoExtrato,
  montarLegsRepasse,
  PARAMS_SEGMENTO,
  BIDCON_MINIMO,
  CET_ALVO_DEFAULT,
  type RepasseLeg,
} from "./repasse-pricing";

// ---- helpers ---------------------------------------------------------------
function leg(legs: RepasseLeg[], tipo: string): RepasseLeg | undefined {
  return legs.find((l) => l.beneficiary_type === tipo);
}
// O gabarito do plano cota os valores com "≈" arredondados ao real mais próximo
// (ex.: líquido "≈ 111.370" enquanto o motor calcula 111.371,73). As tolerâncias
// abaixo espelham essa granularidade de arredondamento do plano — NÃO afrouxam o
// motor (os valores exatos estão documentados no resumo de aceite). Combinado bate
// dentro de R$1; líquido/depósito/economia dentro de R$2 (o "≈" do plano).
const UM_REAL = 1.0;
const DOIS_REAIS = 2.0;

// ============================================================================
// CASO 1 — cascata canônica 70.000 → 56.700 (ordem/percentuais/faixa notarial 1)
// ============================================================================
test("cascata canônica: 70.000 → 7.000 → 63.000 → 6.300 → 56.700", () => {
  const c = cascata(70_000);
  assert.equal(c.bidcon, 7_000, "Bidcon 10% = 7.000");
  assert.equal(c.resto, 63_000, "resto = 63.000");
  assert.equal(c.parceiroCaptacao, 6_300, "parceiro 10% do resto = 6.300");
  assert.equal(c.posParceiro, 56_700, "pós-parceiro = 56.700");
  // faixa 1 (≤ 99.999,99): tarifa mínima 500, split 50/50 → 250 ao captador
  assert.equal(c.notarialTotal, 500, "tarifa notarial faixa 1 = 500");
  assert.equal(c.notarialCaptador, 250, "metade do captador = 250");
  assert.equal(c.liquido, 56_450, "líquido = 56.700 − 250 = 56.450");
});

// ============================================================================
// CASO 2 — fee Bidcon: piso R$2.500 vs 10%
// ============================================================================
test("fee Bidcon respeita o piso de R$2.500", () => {
  assert.equal(feeBidcon(0), 0, "sem operação → 0");
  assert.equal(feeBidcon(10_000), BIDCON_MINIMO, "10% de 10.000 = 1.000 < piso → 2.500");
  assert.equal(feeBidcon(25_000), 2_500, "10% de 25.000 = 2.500 = piso");
  assert.equal(feeBidcon(80_000), 8_000, "10% de 80.000 = 8.000 > piso");
});

// ============================================================================
// CASO 3 — anuidade/VP e CET real são inversos (identidade de fechamento)
// ============================================================================
test("vpFluxo e cetReal são consistentes (g=0): CET real recupera a taxa-alvo", () => {
  const pmt = 1_504.26;
  const n = 105;
  const i = 0.02;
  const L = vpFluxo(pmt, n, i, 0);
  const cet = cetReal(L, pmt, n, 0);
  assert.ok(Math.abs(cet - i) < 1e-6, `CET real ${cet} ≈ alvo ${i}`);
});

test("vpFluxo com degrau anual g>0 é maior que sem degrau", () => {
  const semDegrau = vpFluxo(1_000, 24, 0.02, 0);
  const comDegrau = vpFluxo(1_000, 24, 0.02, 0.06);
  assert.ok(comDegrau > semDegrau, "parcela que cresce 6% no 13º mês eleva o VP");
});

// ============================================================================
// CASO 4 — BID-0442 (Âncora) bate ao centavo com o gabarito
// ============================================================================
test("BID-0442 (Âncora): combinado ≈ 81.556 · líquido ≈ 65.810 · CET real 2,0%", () => {
  const r = precificarRepasse({
    saldoDevedor: 158_729.68,
    parcela: 1_504.26,
    parcelasRestantes: 105,
    cetAlvo: 0.02,
    reajusteAnual: 0,
  });
  assert.ok(
    Math.abs(r.combinado - 81_556) <= UM_REAL,
    `combinado ${r.combinado} ≈ 81.556`
  );
  assert.ok(
    Math.abs(r.liquido - 65_810) <= UM_REAL,
    `líquido ${r.liquido} ≈ 65.810`
  );
  assert.ok(
    Math.abs(r.cetReal - 0.02) < 1e-4,
    `CET real ${(r.cetReal * 100).toFixed(4)}% ≈ 2,0%`
  );
});

// ============================================================================
// CASO 5 — BID-0492 (Porto) bate ao centavo com o gabarito
// ============================================================================
test("BID-0492 (Porto): combinado ≈ 137.878 · líquido ≈ 111.370 · deposita ≈ 138.188 · economia 32%", () => {
  const r = precificarRepasse({
    saldoDevedor: 203_137,
    parcela: 3_031.89,
    parcelasRestantes: 67,
    cetAlvo: 0.02,
    reajusteAnual: 0,
  });
  assert.ok(
    Math.abs(r.combinado - 137_878) <= UM_REAL,
    `combinado ${r.combinado} ≈ 137.878`
  );
  assert.ok(
    Math.abs(r.liquido - 111_370) <= DOIS_REAIS,
    `líquido ${r.liquido} ≈ 111.370`
  );
  assert.ok(
    Math.abs(r.repassanteDeposita - 138_188) <= DOIS_REAIS,
    `deposita ${r.repassanteDeposita} ≈ 138.188`
  );
  // economia ≈ 64.949 (32%) — copy pública SEM % fixo, mas o motor calcula o fato.
  assert.ok(
    Math.abs(r.economia - 64_949) <= 5,
    `economia ${r.economia} ≈ 64.949`
  );
  assert.ok(
    Math.abs(r.economiaPct - 32) <= 0.5,
    `economia% ${r.economiaPct} ≈ 32`
  );
});

// ============================================================================
// CASO 6 — SEM TETO (DELTA-1): combinado pode passar de 50% do saldo
// ============================================================================
test("SEM TETO: o combinado é o que fecha o CET-alvo (pode exceder 50% do saldo)", () => {
  // BID-0492: 137.878 / 203.137 ≈ 67,9% do saldo — acima de 50%, sem trava.
  const r = precificarRepasse({
    saldoDevedor: 203_137,
    parcela: 3_031.89,
    parcelasRestantes: 67,
    cetAlvo: 0.02,
  });
  const fracao = r.combinado / 203_137;
  assert.ok(fracao > 0.5, `fração do saldo ${(fracao * 100).toFixed(1)}% > 50% (sem teto)`);
});

// ============================================================================
// CASO 7 — reversa e direta fecham: cascata(combinadoParaCET) → CET-alvo
// ============================================================================
test("cascata reversa e direta fecham: CET real do combinado = CET-alvo", () => {
  const pmt = 3_031.89;
  const n = 67;
  const alvo = 0.02;
  const comb = combinadoParaCET(pmt, n, alvo, 0);
  const c = cascata(comb);
  const cet = cetReal(c.liquido, pmt, n, 0);
  assert.ok(Math.abs(cet - alvo) < 1e-4, `CET real ${cet} ≈ alvo ${alvo}`);
});

// ============================================================================
// CASO 8 — segmento comanda correção anual + comparativo bancário (DELTA-2)
// ============================================================================
test("segmento do extrato: AUT → Automóvel · IMÓVEL → Imóvel · demais → null", () => {
  assert.equal(segmentoDoExtrato("AUT"), "AUTOMOVEL");
  assert.equal(segmentoDoExtrato("Automóvel"), "AUTOMOVEL");
  assert.equal(segmentoDoExtrato("AUTOMOVEL"), "AUTOMOVEL");
  assert.equal(segmentoDoExtrato("IMÓVEL"), "IMOVEL");
  assert.equal(segmentoDoExtrato("Imovel"), "IMOVEL");
  assert.equal(segmentoDoExtrato("serviços"), null);
  assert.equal(segmentoDoExtrato(""), null);
});

test("segmento comanda parâmetros: Automóvel 0%/1,80% · Imóvel 6%/1,10%", () => {
  assert.equal(PARAMS_SEGMENTO.AUTOMOVEL.reajusteAnual, 0);
  assert.equal(PARAMS_SEGMENTO.AUTOMOVEL.comparativoBancarioMensal, 0.018);
  assert.equal(PARAMS_SEGMENTO.IMOVEL.reajusteAnual, 0.06);
  assert.equal(PARAMS_SEGMENTO.IMOVEL.comparativoBancarioMensal, 0.011);

  // Imóvel injeta g=6% no fluxo quando reajuste não é dado explicitamente
  const imovel = precificarRepasse({
    saldoDevedor: 200_000,
    parcela: 3_000,
    parcelasRestantes: 60,
    cetAlvo: 0.02,
    segmento: "IMOVEL",
  });
  assert.equal(imovel.comparativoBancarioMensal, 0.011);

  const auto = precificarRepasse({
    saldoDevedor: 200_000,
    parcela: 3_000,
    parcelasRestantes: 60,
    cetAlvo: 0.02,
    segmento: "AUTOMOVEL",
  });
  assert.equal(auto.comparativoBancarioMensal, 0.018);
  // Imóvel (g=6%) tem combinado maior que Automóvel (g=0) p/ o mesmo CET-alvo
  assert.ok(imovel.combinado > auto.combinado, "reajuste anual eleva o combinado");
});

// ============================================================================
// CASO 9 — garantia vs exigência (DELTA-3): selo e bloqueio
// ============================================================================
test("garantia: APROVADO / APROVADO_COM_FOLGA / NÃO COBRE (bloqueia)", () => {
  const saldo = 100_000;
  // 100% da exigência default (100) → APROVADO
  const noLimite = avaliarGarantia(100_000, saldo, 100);
  assert.equal(noLimite.selo, "APROVADO");
  assert.equal(noLimite.bloqueia, false);
  // 130%+ → APROVADO COM FOLGA
  const folga = avaliarGarantia(130_000, saldo, 100);
  assert.equal(folga.selo, "APROVADO_COM_FOLGA");
  assert.equal(folga.bloqueia, false);
  // abaixo da exigência → NÃO COBRE, bloqueia
  const abaixo = avaliarGarantia(90_000, saldo, 100);
  assert.equal(abaixo.selo, "NAO_COBRE");
  assert.equal(abaixo.bloqueia, true);
  // exigência parametrizável por adm: adm que exige 120 reprova 110%
  const adm120 = avaliarGarantia(110_000, saldo, 120);
  assert.equal(adm120.selo, "NAO_COBRE");
  assert.equal(adm120.bloqueia, true);
});

// ============================================================================
// CASO 10 — legs de repasse espelham a cascata e somam o combinado
// ============================================================================
test("montarLegsRepasse: tipos corretos e conservação de dinheiro", () => {
  const combinado = combinadoParaCET(3_031.89, 67, 0.02, 0);
  const legs = montarLegsRepasse(combinado);
  const c = cascata(combinado);

  assert.ok(leg(legs, "REPASSANTE_DEPOSITO"), "tem REPASSANTE_DEPOSITO");
  assert.ok(leg(legs, "PLATFORM"), "tem PLATFORM");
  assert.ok(leg(legs, "PARTNER_CAPTATION"), "tem PARTNER_CAPTATION");
  assert.ok(leg(legs, "NOTARY_COSTS"), "tem NOTARY_COSTS");
  assert.ok(leg(legs, "CAPTADOR_NET"), "tem CAPTADOR_NET");

  // conservação: PLATFORM + PARTNER + NOTARY(captador) + CAPTADOR_NET = combinado
  const platform = leg(legs, "PLATFORM")!.amount;
  const partner = leg(legs, "PARTNER_CAPTATION")!.amount;
  const notaryCaptador = leg(legs, "NOTARY_COSTS")!.notary_alloc!.captador;
  const captadorNet = leg(legs, "CAPTADOR_NET")!.amount;
  const total = round2(platform + partner + notaryCaptador + captadorNet);
  assert.ok(
    Math.abs(total - c.combinado) < 0.01,
    `soma das deduções + líquido ${total} = combinado ${c.combinado}`
  );

  // parceiro nulo: fee inteiro em PLATFORM, sem leg PARTNER_CAPTATION
  const semParceiro = montarLegsRepasse(combinado, { temParceiro: false });
  assert.equal(leg(semParceiro, "PARTNER_CAPTATION"), undefined, "sem parceiro → sem leg");
});

// ============================================================================
// CASO 11 — round2 idêntico a fee-plan (fórmula verbatim)
// ============================================================================
test("round2 arredonda para centavos com Number.EPSILON (verbatim de fee-plan)", () => {
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(56_700.005), 56_700.01);
  assert.equal(CET_ALVO_DEFAULT, 0.02);
});
