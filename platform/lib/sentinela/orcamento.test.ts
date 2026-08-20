// ============================================================================
// Teste do orçamento de relógio da varredura — TENTATIVAS-01
// ----------------------------------------------------------------------------
// Os números não são inventados: são os MEDIDOS em 19/08/2026 nos deltas de
// `sentinela_log`. Pior caso de envio_ok = 4,61s. O caso de regressão é o
// cenário exato que produziu o 504 — teto de 60s, custo real por iteração,
// página de 15 — e ele tem de ACUSAR que 15 não cabem.
//
// O teste que mais importa é o do controle (Regra 9): um orçamento que só sabe
// dizer "cabe" é indistinguível de orçamento nenhum. Por isso, para cada
// afirmação de "cabe", existe a vizinha que devolve "não cabe" um milissegundo
// depois.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  cabeMaisUmaIteracao,
  iteracoesQueCabem,
  type Orcamento,
} from "@/lib/sentinela/orcamento";

/** Pior caso MEDIDO de uma iteração de envio_ok, throttle de 2s incluído. */
const PIOR_CASO_MEDIDO_MS = 4610;

/** O que a rota tinha no dia do 504. */
const COMO_ERA: Orcamento = {
  tetoMs: 60_000,
  custoIteracaoMs: 5000,
  reservaFinalMs: 3000,
};

/** O que a rota passa a ter. */
const COMO_FICA: Orcamento = {
  tetoMs: 300_000,
  custoIteracaoMs: 5000,
  reservaFinalMs: 3000,
};

// ---------------------------------------------------------------- regressão
test("orcamento: o cenario do 504 de 19/08 e' acusado — 15 envios NAO cabiam em 60s", () => {
  // 15 × 4,61s = 69,15s. O comentario antigo da rota dizia "15 × 2s = 30s".
  assert.ok(15 * PIOR_CASO_MEDIDO_MS > COMO_ERA.tetoMs);
  // E o orcamento, com o teto de 60s, teria parado ANTES de estourar.
  assert.equal(iteracoesQueCabem(COMO_ERA), 11);
  assert.ok(iteracoesQueCabem(COMO_ERA) < 15);
});

test("orcamento: com o cinto de 300s a pagina de 15 cabe inteira", () => {
  assert.ok(iteracoesQueCabem(COMO_FICA) >= 15);
  assert.equal(iteracoesQueCabem(COMO_FICA), 59);
});

// ------------------------------------------------------- cabe / NAO cabe
test("orcamento: cabe exatamente ate' o ultimo milissegundo, e um a mais nao cabe", () => {
  const o: Orcamento = { tetoMs: 60_000, custoIteracaoMs: 5000, reservaFinalMs: 3000 };
  // 52.000 + 5.000 + 3.000 = 60.000 = teto → cabe.
  assert.equal(cabeMaisUmaIteracao(o, 52_000), true);
  // CONTROLE: um milissegundo depois, nao cabe.
  assert.equal(cabeMaisUmaIteracao(o, 52_001), false);
});

test("orcamento: a reserva do heartbeat e' respeitada — sem ela a ultima iteracao passaria", () => {
  const comReserva: Orcamento = { tetoMs: 60_000, custoIteracaoMs: 5000, reservaFinalMs: 3000 };
  const semReserva: Orcamento = { ...comReserva, reservaFinalMs: 0 };
  assert.equal(cabeMaisUmaIteracao(comReserva, 55_000), false);
  // CONTROLE: e' a reserva que reprova, nao o custo.
  assert.equal(cabeMaisUmaIteracao(semReserva, 55_000), true);
});

test("orcamento: execucao recem-comecada sempre cabe", () => {
  assert.equal(cabeMaisUmaIteracao(COMO_FICA, 0), true);
});

// ------------------------------------------------------------ relogio torto
test("orcamento: decorrido negativo vira zero — relogio torto nao para a fila", () => {
  assert.equal(cabeMaisUmaIteracao(COMO_FICA, -10_000), true);
});

test("orcamento: decorrido nao-finito FALHA FECHADO", () => {
  assert.equal(cabeMaisUmaIteracao(COMO_FICA, NaN), false);
  assert.equal(cabeMaisUmaIteracao(COMO_FICA, Infinity), false);
  // CONTROLE: o mesmo orcamento aprova um decorrido finito equivalente a zero.
  assert.equal(cabeMaisUmaIteracao(COMO_FICA, 0), true);
});

test("orcamento: campo nao-finito no proprio orcamento FALHA FECHADO", () => {
  assert.equal(cabeMaisUmaIteracao({ ...COMO_FICA, tetoMs: NaN }, 0), false);
  assert.equal(cabeMaisUmaIteracao({ ...COMO_FICA, custoIteracaoMs: NaN }, 0), false);
  assert.equal(cabeMaisUmaIteracao({ ...COMO_FICA, reservaFinalMs: NaN }, 0), false);
  assert.equal(iteracoesQueCabem({ ...COMO_FICA, tetoMs: NaN }), 0);
});

// --------------------------------------------------------- iteracoesQueCabem
test("orcamento: custo zero devolve 0, nunca Infinity", () => {
  assert.equal(iteracoesQueCabem({ ...COMO_FICA, custoIteracaoMs: 0 }), 0);
  assert.equal(iteracoesQueCabem({ ...COMO_FICA, custoIteracaoMs: -1 }), 0);
});

test("orcamento: teto menor que a reserva devolve 0 — nao envia nada", () => {
  assert.equal(iteracoesQueCabem({ tetoMs: 2000, custoIteracaoMs: 5000, reservaFinalMs: 3000 }), 0);
  // CONTROLE: subir o teto acima da reserva + um custo ja' devolve 1.
  assert.equal(iteracoesQueCabem({ tetoMs: 8000, custoIteracaoMs: 5000, reservaFinalMs: 3000 }), 1);
});

test("orcamento: iteracoesQueCabem concorda com cabeMaisUmaIteracao no limite", () => {
  const o: Orcamento = { tetoMs: 60_000, custoIteracaoMs: 5000, reservaFinalMs: 3000 };
  const n = iteracoesQueCabem(o); // 11
  // Depois de n-1 iteracoes no custo cheio, a n-esima ainda cabe.
  assert.equal(cabeMaisUmaIteracao(o, (n - 1) * o.custoIteracaoMs), true);
  // CONTROLE: depois de n, a seguinte nao cabe.
  assert.equal(cabeMaisUmaIteracao(o, n * o.custoIteracaoMs), false);
});
