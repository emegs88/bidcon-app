// ============================================================================
// Teste da aritmética do RADAR (SENTINELA-RADAR-01, Parte 2)
// ----------------------------------------------------------------------------
// Quatro grupos, na ordem em que erram feio.
//
// 1. NOME E ESTADO INICIAL. O kill-switch tem de nascer desarmado e continuar
//    se chamando o que a ordem disse. Um vigia que liga sozinho é pior do que
//    vigia nenhum: ninguém pediu por ele e ninguém sabe desligá-lo.
//
// 2. PERCENTIL. Posto mais próximo, sem interpolar. A consequência é que o
//    limiar é SEMPRE um número que aconteceu de verdade — e este grupo prende
//    isso com o `p50` de 1..10, que dá 5 e não 5,5.
//
// 3. LIMIAR. As três bases (`historico`, `piso_maior`, `piso_sem_historico`) e
//    a fronteira: ultrapassar é ESTRITAMENTE maior. Empatar com o limiar é o
//    caso mais comum de todos — o percentil saiu de um número que aconteceu, e
//    ele vai acontecer de novo. Se empate alarmasse, o RADAR alarmaria por
//    rotina.
//
// 4. ZERO. `houveRegressao` e `quedaRelativa` recusando `baseline <= 0`. É a
//    regra que a ordem escreveu em letra: alarmar na REGRESSÃO, não no zero
//    absoluto. Quem nunca amostrou não regrediu.
//
// ----------------------------------------------------------------------------
// A FIXTURE NÃO É INVENTADA
//
// O histórico de 20 valores usado abaixo reproduz a forma medida da fonte
// PLAYCONTEMPLADAS em 16/08/2026 (65 eventos `ciclo_integridade_falhou` desde
// 02/08): p90 = 116, p95 = 153, maior = 621. Se alguém trocar o percentil
// nearest-rank por interpolado, estes dois números mudam e o teste cai — que é
// exatamente o aviso que se quer.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ENV_KILL_SWITCH,
  LIMIAR_PADRAO,
  houveRegressao,
  idadeEmDias,
  limiarDeDivergencia,
  percentil,
  quedaRelativa,
  radarLigado,
  ultrapassou,
} from "@/lib/radar/limiar";

/** A forma medida de PLAYCONTEMPLADAS, 20 ciclos. Ver cabeçalho. */
const PLAYCONTEMPLADAS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 116, 153, 621,
];

// ---------------------------------------------------------------------------
// 1. NOME E ESTADO INICIAL
// ---------------------------------------------------------------------------

test("kill-switch: nasce desarmado e so a palavra 'on' arma", () => {
  assert.equal(ENV_KILL_SWITCH, "RADAR");

  const antes = process.env[ENV_KILL_SWITCH];
  try {
    delete process.env[ENV_KILL_SWITCH];
    assert.equal(radarLigado(), false, "ausente = desarmado");

    process.env[ENV_KILL_SWITCH] = "";
    assert.equal(radarLigado(), false);

    process.env[ENV_KILL_SWITCH] = "true";
    assert.equal(radarLigado(), false, "so a palavra 'on' arma");

    process.env[ENV_KILL_SWITCH] = "ON";
    assert.equal(radarLigado(), false, "maiuscula nao arma — literal 'on'");

    process.env[ENV_KILL_SWITCH] = "on";
    assert.equal(radarLigado(), true);
  } finally {
    if (antes === undefined) delete process.env[ENV_KILL_SWITCH];
    else process.env[ENV_KILL_SWITCH] = antes;
  }
});

// ---------------------------------------------------------------------------
// 2. PERCENTIL
// ---------------------------------------------------------------------------

test("percentil: posto mais proximo — o limiar e um numero que aconteceu", () => {
  const dez = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  // 5, não 5,5. Se este virar 5,5, alguém trocou por interpolação.
  assert.equal(percentil(dez, 50), 5);
  assert.equal(percentil(dez, 90), 9);
  assert.equal(percentil(dez, 95), 10);
  assert.equal(percentil(dez, 100), 10);
  assert.equal(percentil(dez, 0), 1);
});

test("percentil: a forma medida de PLAYCONTEMPLADAS bate com o banco", () => {
  assert.equal(percentil(PLAYCONTEMPLADAS, 90), 116);
  assert.equal(percentil(PLAYCONTEMPLADAS, 95), 153);
  assert.equal(percentil(PLAYCONTEMPLADAS, 100), 621);
});

test("percentil: nao depende da ordem de entrada", () => {
  const embaralhado = [10, 3, 7, 1, 9, 5, 2, 8, 4, 6];
  assert.equal(percentil(embaralhado, 50), 5);
});

test("percentil: lista vazia devolve null — 'nao sei', nao 'zero'", () => {
  assert.equal(percentil([], 95), null);
  assert.equal(percentil([Number.NaN, Number.POSITIVE_INFINITY], 95), null);
  assert.equal(percentil([1, 2, 3], Number.NaN), null);
});

test("percentil: descarta o que nao e numero, mantendo o resto", () => {
  assert.equal(percentil([1, Number.NaN, 2, Number.POSITIVE_INFINITY, 3], 100), 3);
});

// ---------------------------------------------------------------------------
// 3. LIMIAR
// ---------------------------------------------------------------------------

test("limiar: com historico suficiente, sai do proprio historico da fonte", () => {
  const l = limiarDeDivergencia(PLAYCONTEMPLADAS);
  assert.equal(l.valor, 153);
  assert.equal(l.base, "historico");
  assert.equal(l.n, 20);
});

test("limiar: fonte calma nao ganha limiar ridiculo — o piso segura", () => {
  // CARTAS mediu p95 = 22. Sem o piso, 23 divergencias abririam alerta numa
  // fonte que so oscila.
  const cartas = [1, 2, 3, 4, 4, 5, 8, 14, 22, 26];
  const l = limiarDeDivergencia(cartas);
  assert.equal(l.valor, LIMIAR_PADRAO.piso);
  assert.equal(l.base, "piso_maior");
  assert.equal(l.n, 10);
});

test("limiar: amostra curta cai no piso e DIZ que caiu", () => {
  const l = limiarDeDivergencia([600, 700, 800]);
  assert.equal(l.valor, LIMIAR_PADRAO.piso);
  assert.equal(l.base, "piso_sem_historico");
  assert.equal(l.n, 3, "n reporta a amostra real, nao o minimo exigido");
});

test("limiar: fonte nova (historico vazio) nao alarma na primeira divergencia", () => {
  const l = limiarDeDivergencia([]);
  assert.equal(l.base, "piso_sem_historico");
  assert.equal(l.n, 0);
  assert.equal(ultrapassou(1, l), false);
  assert.equal(ultrapassou(49, l), false);
});

test("limiar: opcoes sobrescrevem uma a uma, sem zerar as outras", () => {
  const l = limiarDeDivergencia([600, 700, 800], { amostraMinima: 3 });
  assert.equal(l.base, "historico");
  assert.equal(l.valor, 800);
  assert.equal(l.n, 3);
});

test("ultrapassou: empatar com o limiar NAO alarma", () => {
  const l = limiarDeDivergencia(PLAYCONTEMPLADAS); // 153
  assert.equal(ultrapassou(153, l), false, "153 aconteceu; nao e novidade");
  assert.equal(ultrapassou(154, l), true);
  assert.equal(ultrapassou(621, l), true);
  assert.equal(ultrapassou(17, l), false, "a mediana nao pode alarmar");
});

test("ultrapassou: valor nao-numerico e silencio, nao alarme", () => {
  const l = limiarDeDivergencia(PLAYCONTEMPLADAS);
  assert.equal(ultrapassou(Number.NaN, l), false);
});

// ---------------------------------------------------------------------------
// 4. ZERO
// ---------------------------------------------------------------------------

test("houveRegressao: quem nunca amostrou nao regrediu (LANCE, espera=0)", () => {
  // Medido em 16/08: LANCE devolve `sync_raw_desenho` com espera=0, lidas=140,
  // recebidas=0. Nao ha prova de amostra a perder — nao ha alerta a abrir.
  assert.equal(houveRegressao(0, 0, 0.3), false);
  assert.equal(houveRegressao(0, -1, 0.3), false);
});

test("houveRegressao: so cai quem estava em cima", () => {
  // CARTAS: baseline 100%, ciclo com recebidas=0 de 198 lidas.
  assert.equal(houveRegressao(0, 1, 0.3), true);
  // Oscilacao de 10 pontos nao e regressao sob queda minima de 30.
  assert.equal(houveRegressao(0.9, 1, 0.3), false);
  // Subir nunca e regressao.
  assert.equal(houveRegressao(1, 0.5, 0.3), false);
});

test("houveRegressao: a queda minima e inclusiva na fronteira", () => {
  assert.equal(houveRegressao(0.7, 1, 0.3), true, "exatamente 0,3 conta");
  assert.equal(houveRegressao(0.71, 1, 0.3), false);
});

test("houveRegressao: numero invalido cala em vez de mentir", () => {
  assert.equal(houveRegressao(Number.NaN, 1, 0.3), false);
  assert.equal(houveRegressao(0, Number.NaN, 0.3), false);
});

test("quedaRelativa: baseline zero devolve null, nao Infinity", () => {
  // Infinity viraria alerta permanente e insolucionavel.
  assert.equal(quedaRelativa(0, 0), null);
  assert.equal(quedaRelativa(10, 0), null);
  assert.equal(quedaRelativa(Number.NaN, 100), null);
});

test("quedaRelativa: fracao da linha de base, com sinal negativo quando sobe", () => {
  assert.equal(quedaRelativa(80, 100), 0.2);
  assert.equal(quedaRelativa(50, 100), 0.5);
  assert.equal(quedaRelativa(0, 100), 1);
  assert.equal(quedaRelativa(120, 100), -0.2, "subida vira queda negativa");
});

test("idadeEmDias: fracionaria, e a hora chega por parametro", () => {
  const desde = new Date("2026-08-04T22:27:20.820Z");
  assert.equal(idadeEmDias(desde, new Date("2026-08-05T22:27:20.820Z")), 1);
  assert.equal(idadeEmDias(desde, new Date("2026-08-05T10:27:20.820Z")), 0.5);
  // As 21 linhas de 04/08, medidas em 16/08: onze dias e meio parados.
  assert.ok(idadeEmDias(desde, new Date("2026-08-16T04:00:00.000Z")) > 11);
});
