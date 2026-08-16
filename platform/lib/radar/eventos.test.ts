// ============================================================================
// Teste do leitor de `eventos_sync.detalhe` (SENTINELA-RADAR-01, Parte 2)
// ----------------------------------------------------------------------------
// As strings usadas aqui foram COPIADAS DO BANCO em 16/08/2026, caractere por
// caractere. Não são exemplos plausíveis: são as linhas que o RADAR vai ler em
// produção. Se o formato mudar lá, este arquivo cai aqui — que é o único aviso
// possível para uma coluna `text` sem esquema.
//
// O teste que mais importa é o da armadilha do `ciclo=`: o valor tem espaço, e
// um leitor descuidado transformaria o horário em nome de fonte, abrindo uma
// chave nova de alerta a cada ciclo. Seria "um alerta por ocorrência" pela
// porta dos fundos, exatamente o que a ordem proibiu.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";

import { amostraDe, divergenciasDe, fonteDe, lerDetalhe, numeroDe } from "@/lib/radar/eventos";

/** Copiado de eventos_sync, tipo='ciclo_integridade_falhou', 14/08 22:01. */
const CICLO_PLAY =
  "PLAYCONTEMPLADAS divergencias=621 ciclo=2026-08-14 21:00:45.329151+00";
/** Copiado de eventos_sync, tipo='sync_raw_ausente', 16/08 04:00. */
const RAW_CARTAS =
  "fonte=CARTAS espera=1 lidas=198 recebidas=0 faltando=198 admin=1 url=https://360prospere.vercel.app/api/cotas-extra?admin=1";
/** Copiado de eventos_sync, tipo='sync_raw_ok', 16/08 04:00. */
const RAW_PLAY =
  "fonte=PLAYCONTEMPLADAS espera=1 lidas=955 recebidas=955 faltando=0 admin=0 url=https://playcontempladas.com.br/";

// ---------------------------------------------------------------------------
// A ARMADILHA
// ---------------------------------------------------------------------------

test("ciclo: o rotulo e o PRIMEIRO token nu — nunca o horario do ciclo", () => {
  const lido = lerDetalhe(CICLO_PLAY);
  assert.equal(lido.rotulo, "PLAYCONTEMPLADAS");
  assert.equal(fonteDe(lido), "PLAYCONTEMPLADAS");
  // O horário sobra como segundo token nu e tem de ser DESCARTADO. Se virasse
  // rótulo, a chave do alerta mudaria a cada ciclo.
  assert.notEqual(fonteDe(lido), "21:00:45.329151+00");
});

test("ciclo: le a divergencia que criou o RADAR", () => {
  const d = divergenciasDe(CICLO_PLAY);
  assert.equal(d.fonte, "PLAYCONTEMPLADAS");
  assert.equal(d.divergencias, 621);
});

test("ciclo: a chave de alerta e estavel entre dois ciclos da mesma fonte", () => {
  const a = divergenciasDe("CBC divergencias=1 ciclo=2026-08-15 13:01:23.269956+00");
  const b = divergenciasDe("CBC divergencias=1 ciclo=2026-08-14 21:00:34.040916+00");
  assert.equal(a.fonte, "CBC");
  assert.equal(a.fonte, b.fonte, "duas ocorrencias, UMA condicao");
});

// ---------------------------------------------------------------------------
// A GRAMÁTICA DE PARES
// ---------------------------------------------------------------------------

test("raw: fonte= vence, e os numeros saem inteiros", () => {
  const a = amostraDe(RAW_CARTAS);
  assert.equal(a.fonte, "CARTAS");
  assert.equal(a.espera, 1);
  assert.equal(a.lidas, 198);
  assert.equal(a.recebidas, 0);
});

test("raw: o caso saudavel nao vira alerta por acidente", () => {
  const a = amostraDe(RAW_PLAY);
  assert.equal(a.fonte, "PLAYCONTEMPLADAS");
  assert.equal(a.lidas, 955);
  assert.equal(a.recebidas, 955);
});

test("raw: url com '=' dentro nao quebra o par", () => {
  const lido = lerDetalhe(RAW_CARTAS);
  assert.equal(
    lido.campos.url,
    "https://360prospere.vercel.app/api/cotas-extra?admin=1",
    "o corte e no PRIMEIRO '=' — o resto e valor"
  );
  assert.equal(lido.campos.admin, "1", "e o admin=1 anterior continua inteiro");
});

test("raw: LANCE com espera=0 e legivel — e o vigia decide, nao o parser", () => {
  const a = amostraDe(
    "fonte=LANCE espera=0 lidas=140 recebidas=0 faltando=0 admin=1 url=https://360prospere.vercel.app/api/cotas-extra?admin=1"
  );
  assert.equal(a.fonte, "LANCE");
  assert.equal(a.espera, 0, "zero medido e zero, nao ausencia");
  assert.equal(a.recebidas, 0);
});

// ---------------------------------------------------------------------------
// AUSÊNCIA NÃO É ZERO
// ---------------------------------------------------------------------------

test("campo ausente e null — jamais zero", () => {
  const lido = lerDetalhe("fonte=CBC lidas=510");
  assert.equal(numeroDe(lido, "recebidas"), null, "zero seria uma afirmacao que ninguem fez");
  assert.equal(numeroDe(lido, "lidas"), 510);
});

test("campo vazio ou nao-numerico e null, nao 0 nem NaN", () => {
  const lido = lerDetalhe("fonte=CBC lidas= recebidas=abc espera=1");
  assert.equal(numeroDe(lido, "lidas"), null, "Number('') daria 0");
  assert.equal(numeroDe(lido, "recebidas"), null, "Number('abc') daria NaN — alarme mudo");
  assert.equal(numeroDe(lido, "espera"), 1);
});

test("detalhe vazio, nulo ou indefinido nao explode", () => {
  for (const entrada of [null, undefined, "", "   "]) {
    const lido = lerDetalhe(entrada);
    assert.equal(lido.rotulo, null);
    assert.deepEqual(lido.campos, {});
    assert.equal(fonteDe(lido), null);
  }
  assert.equal(divergenciasDe(null).fonte, null);
  assert.equal(divergenciasDe(null).divergencias, null);
});

test("negativo e decimal atravessam sem arredondar", () => {
  const lido = lerDetalhe("fonte=X divergencias=-3 taxa=0.07");
  assert.equal(numeroDe(lido, "divergencias"), -3);
  assert.equal(numeroDe(lido, "taxa"), 0.07);
});

test("chave repetida: a primeira vence", () => {
  const lido = lerDetalhe("fonte=A fonte=B lidas=1 lidas=99");
  assert.equal(fonteDe(lido), "A");
  assert.equal(numeroDe(lido, "lidas"), 1);
});

test("token que comeca com '=' nao vira chave vazia", () => {
  const lido = lerDetalhe("=lixo fonte=CBC");
  assert.equal(fonteDe(lido), "CBC");
  assert.equal("" in lido.campos, false, "chave vazia furaria a trava do banco");
});
