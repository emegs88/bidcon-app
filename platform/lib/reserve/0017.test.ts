// ============================================================================
// Bidcon Repasse — testes de conformidade da migration 0017 (Fatia 1).
// ----------------------------------------------------------------------------
// Runner NATIVO do Node: `node:test` + `node:assert` (ZERO dependência nova).
// Rodar:  npx tsx --test lib/reserve/0017.test.ts
//
// Estes testes NÃO tocam o banco. São de PARIDADE ESTÁTICA: leem o texto do
// arquivo SQL `0017_repasse.sql` e travam a coerência entre o SCHEMA e o motor
// canônico `repasse-pricing.ts` — mesmo espírito de `reserve.test.ts`, que
// trava a máquina de estados TS contra a lista da RPC (0016 §5.4).
//
// O que garantimos:
//   1) 0017 é ADITIVA: nenhum comando destrutivo (drop table/column, delete,
//      truncate) e a 0016 não é referenciada para remoção.
//   2) O CHECK de `reserva_legs.beneficiary_type` na 0017 contém TODOS os 8
//      valores originais da 0016 + os 3 novos, e cada RepasseBeneficiaryType do
//      motor está representado no CHECK (paridade motor↔SQL).
//   3) Os campos de repasse pedidos (saldo_devedor, parcela, parcelas_restantes,
//      reajuste_anual, segmento, exigencia_garantia_pct, cet_alvo, tipo REPASSE)
//      existem como `add column if not exists` (aditivos).
//   4) Os CHECKs de `segmento` e `tipo` casam com o motor (Segmento; VENDA/REPASSE).
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import type { RepasseBeneficiaryType, Segmento } from "./repasse-pricing";
import { PARAMS_SEGMENTO, EXIGENCIA_GARANTIA_PCT_DEFAULT } from "./repasse-pricing";

// ---- carrega o SQL da 0017 como texto -------------------------------------
const AQUI = dirname(fileURLToPath(import.meta.url));
const SQL_PATH = resolve(AQUI, "../../supabase/migrations/0017_repasse.sql");
const SQL = readFileSync(SQL_PATH, "utf8");
const SQL_LOWER = SQL.toLowerCase();

// Os 8 beneficiários originais da 0016 que a 0017 tem de PRESERVAR.
const BENEF_0016 = [
  "SELLER",
  "PLATFORM",
  "SOURCING_PARTNER",
  "SELLING_PARTNER",
  "OVERRIDE",
  "CREDIT_PROVIDER",
  "REFUND_BUYER",
  "NOTARY_COSTS",
] as const;

// Espelho literal de RepasseBeneficiaryType (repasse-pricing.ts, linhas 113-118).
// Se o motor mudar, ESTA lista muda — e o teste acusa a divergência com o SQL.
const BENEF_REPASSE: RepasseBeneficiaryType[] = [
  "REPASSANTE_DEPOSITO",
  "PLATFORM",
  "PARTNER_CAPTATION",
  "NOTARY_COSTS",
  "CAPTADOR_NET",
];

// Segmentos do motor (chaves de PARAMS_SEGMENTO).
const SEGMENTOS = Object.keys(PARAMS_SEGMENTO) as Segmento[];

// ============================================================================
// CASO 1 — 0017 é aditiva: nenhum comando destrutivo
// ============================================================================
test("0017 não contém comando destrutivo (drop table/column, delete, truncate)", () => {
  assert.equal(/drop\s+table/.test(SQL_LOWER), false, "sem DROP TABLE");
  assert.equal(/drop\s+column/.test(SQL_LOWER), false, "sem DROP COLUMN");
  assert.equal(/\btruncate\b/.test(SQL_LOWER), false, "sem TRUNCATE");
  // DELETE de linhas (não confundir com 'on delete' de FK, que é permitido)
  assert.equal(/delete\s+from/.test(SQL_LOWER), false, "sem DELETE FROM");
});

test("os únicos DROP são de CONSTRAINT ... IF EXISTS (recriação idempotente)", () => {
  const drops = SQL_LOWER.match(/drop\s+constraint[^;]*/g) ?? [];
  assert.ok(drops.length > 0, "há drops de constraint (recriação de CHECK)");
  for (const d of drops) {
    assert.ok(d.includes("if exists"), `drop de constraint sem IF EXISTS: "${d}"`);
  }
});

test("toda coluna nova entra como ADD COLUMN IF NOT EXISTS (aditivo)", () => {
  // não pode haver `add column` sem `if not exists` (evita quebra em re-run)
  const addsSemGuard = SQL_LOWER.match(/add\s+column\s+(?!if\s+not\s+exists)/g) ?? [];
  assert.equal(addsSemGuard.length, 0, "todo ADD COLUMN precisa de IF NOT EXISTS");
});

// ============================================================================
// CASO 2 — CHECK de beneficiary_type: preserva os 8 e soma os 3 (paridade motor)
// ============================================================================
test("o CHECK de beneficiary_type preserva os 8 valores da 0016", () => {
  for (const b of BENEF_0016) {
    assert.ok(SQL.includes(`'${b}'`), `0017 tem de manter o beneficiário '${b}'`);
  }
});

test("o CHECK de beneficiary_type cobre todo RepasseBeneficiaryType do motor", () => {
  for (const b of BENEF_REPASSE) {
    assert.ok(SQL.includes(`'${b}'`), `RepasseBeneficiaryType '${b}' ausente no CHECK`);
  }
});

test("os 3 aditivos de repasse estão presentes (PARTNER_CAPTATION + par entrada/saída)", () => {
  for (const novo of ["PARTNER_CAPTATION", "REPASSANTE_DEPOSITO", "CAPTADOR_NET"]) {
    assert.ok(SQL.includes(`'${novo}'`), `beneficiário novo '${novo}' ausente`);
  }
});

// ============================================================================
// CASO 3 — campos de repasse pedidos existem, como aditivos nullable
// ============================================================================
test("reservas ganha os campos de repasse pedidos (aditivos)", () => {
  const campos = [
    "saldo_devedor",
    "parcela",
    "parcelas_restantes",
    "reajuste_anual",
    "segmento",
    "cet_alvo",
    "exigencia_garantia_pct",
    "avaliacao_laudo",
  ];
  for (const c of campos) {
    const re = new RegExp(`add\\s+column\\s+if\\s+not\\s+exists\\s+${c}\\b`, "i");
    assert.ok(re.test(SQL), `campo '${c}' precisa vir como ADD COLUMN IF NOT EXISTS`);
  }
});

test("a coluna `tipo` distingue VENDA (default) de REPASSE", () => {
  assert.ok(/add\s+column\s+if\s+not\s+exists\s+tipo\b/i.test(SQL), "coluna tipo aditiva");
  assert.ok(SQL.includes("'VENDA'"), "tipo aceita VENDA (default)");
  assert.ok(SQL.includes("'REPASSE'"), "tipo aceita REPASSE");
});

test("administradoras ganha exigencia_garantia_pct com default do motor (100)", () => {
  assert.ok(
    /alter\s+table\s+public\.administradoras[\s\S]*?exigencia_garantia_pct/i.test(SQL),
    "administradoras recebe exigencia_garantia_pct"
  );
  // o default do banco espelha EXIGENCIA_GARANTIA_PCT_DEFAULT do motor
  assert.equal(EXIGENCIA_GARANTIA_PCT_DEFAULT, 100);
  assert.ok(
    /exigencia_garantia_pct[\s\S]*?default\s+100/i.test(SQL),
    "default do banco = 100 (espelha o motor)"
  );
});

test("a seção de administradoras é condicional via to_regclass (0016 não depende de administradoras)", () => {
  // DELTA-8 ③: administradoras ainda não é entidade própria do banco (é atributo
  // do dado — passport/extrato). A 0017 só toca a tabela SE ela já existir.
  assert.ok(
    /to_regclass\(\s*'public\.administradoras'\s*\)\s*is\s+not\s+null/i.test(SQL),
    "administradoras precisa estar atrás de guard to_regclass"
  );
  // e o guard precisa envolver justamente o ALTER TABLE de administradoras
  assert.ok(
    /to_regclass\(\s*'public\.administradoras'\s*\)\s*is\s+not\s+null[\s\S]*?alter\s+table\s+public\.administradoras/i.test(
      SQL
    ),
    "o ALTER TABLE de administradoras precisa estar dentro do guard condicional"
  );
});

// ============================================================================
// CASO 4 — CHECKs de segmento e tipo casam com o motor
// ============================================================================
test("o CHECK de segmento cobre exatamente os Segmentos do motor", () => {
  for (const s of SEGMENTOS) {
    assert.ok(SQL.includes(`'${s}'`), `segmento '${s}' do motor ausente no CHECK`);
  }
  // e o motor hoje tem exatamente AUTOMOVEL e IMOVEL
  assert.deepEqual([...SEGMENTOS].sort(), ["AUTOMOVEL", "IMOVEL"]);
});

test("segmento é nullable no CHECK (reservas de VENDA não têm segmento)", () => {
  assert.ok(
    /segmento\s+is\s+null\s+or\s+segmento\s+in/i.test(SQL),
    "CHECK de segmento admite null"
  );
});

// ============================================================================
// CASO 5 — a 0016 permanece intocada (a 0017 não a altera)
// ============================================================================
test("0017 não referencia a 0016 para remoção (0016 fica intocada)", () => {
  // a 0017 só faz ALTER TABLE aditivo; não recria nem dropa objetos da 0016
  assert.equal(/drop\s+table\s+[^;]*reserva/i.test(SQL), false, "não dropa tabela de reserva");
  assert.equal(/drop\s+function/i.test(SQL_LOWER), false, "não dropa RPC da 0016");
  assert.equal(/create\s+or\s+replace\s+function/i.test(SQL_LOWER), false, "não recria RPC");
});
