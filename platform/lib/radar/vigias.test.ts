// ============================================================================
// Teste dos cinco vigias (SENTINELA-RADAR-01, Parte 2)
// ----------------------------------------------------------------------------
// A pergunta que este arquivo responde é uma só, feita dez vezes: o RADAR
// ALARMA quando deve, e CALA quando não deve?
//
// A segunda metade é a que costuma faltar. Um vigia que alarma sempre é
// desligado na primeira semana, e aí a casa fica sem vigia nenhum e ainda
// acha que tem. Por isso todo vigia aqui tem pelo menos um teste de SILÊNCIO,
// e o silêncio é testado no caso mais próximo do gatilho — a fronteira, não o
// caso confortável.
//
// Nenhum teste levanta banco, rede ou relógio: as cinco funções recebem
// números medidos e a hora chega por parâmetro. É o que permite provar "o
// FAROL cobra às 16h" sem esperar dar 16h, e "a fila envelheceu onze dias"
// sem esperar onze dias.
//
// ----------------------------------------------------------------------------
// OS CASOS REAIS ESTÃO PRESOS AQUI
//
// Cada vigia carrega um teste com o número que o fez existir:
//   1. PLAYCONTEMPLADAS com divergencias = 621, sem ninguém ser avisado.
//   2. CARTAS com lidas = 198 e recebidas = 0 — e LANCE com espera = 0, que é
//      o caso em que o RADAR precisa ficar CALADO apesar do zero.
//   3. Estoque de 1008 cartas novas em 14/08 para 0 em 16/08, com o nível
//      saudável em 2423 disponíveis — o vigia de nível calado, o de movimento
//      falando.
//   4. FAROL sem publicar depois do horário do cron.
//   5. As 21 linhas de 04/08, onze dias em `aguardando_template`.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DIAS_FILA_PARADA,
  HORAS_SEM_MOVIMENTO,
  HORA_COBRANCA_FAROL,
  QUEDA_AMOSTRA,
  QUEDA_ESTOQUE,
  TIPOS_RADAR,
  TIPO_AMOSTRA,
  TIPO_DIVERGENCIA,
  TIPO_ESTOQUE,
  TIPO_FAROL,
  TIPO_FILA_SENTINELA,
  vigiaDivergenciaSync,
  vigiaEstoqueNivel,
  vigiaEstoqueSemMovimento,
  vigiaFarolSemPublicar,
  vigiaFilaSentinela,
  vigiaProvaAmostra,
} from "@/lib/radar/vigias";

/** A forma medida de PLAYCONTEMPLADAS: p95 = 153, maior = 621. */
const PLAYCONTEMPLADAS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 116, 153, 621,
];

// ---------------------------------------------------------------------------
// VIGIA 1 — divergência de sync
// ---------------------------------------------------------------------------

test("divergencia: o caso que criou o RADAR — 621 e ninguem avisado", () => {
  const a = vigiaDivergenciaSync({
    fonte: "PLAYCONTEMPLADAS",
    divergencias: 621,
    historico: PLAYCONTEMPLADAS,
  });
  assert.ok(a, "621 contra limiar 153 tem de abrir alerta");
  assert.equal(a.tipo, TIPO_DIVERGENCIA);
  assert.equal(a.chave, "PLAYCONTEMPLADAS", "a chave e a fonte: uma linha por fonte");
  assert.equal(a.severidade, "grave", "621 e mais que o dobro de 153");
  assert.equal(a.detalhe.limiar, 153);
  assert.equal(a.detalhe.base, "historico");
  assert.ok(a.titulo.includes("PLAYCONTEMPLADAS"));
});

test("divergencia: acima do limiar mas dentro do dobro e aviso, nao grave", () => {
  const a = vigiaDivergenciaSync({
    fonte: "PLAYCONTEMPLADAS",
    divergencias: 200,
    historico: PLAYCONTEMPLADAS,
  });
  assert.ok(a);
  assert.equal(a.severidade, "aviso");
});

test("divergencia: SILENCIO na mediana e no empate com o limiar", () => {
  // 274 eventos medidos desde 02/08; 131 deles com <= 5 divergencias. Alarmar
  // em "qualquer divergencia" teria aberto 274 alertas.
  assert.equal(
    vigiaDivergenciaSync({ fonte: "PLAYCONTEMPLADAS", divergencias: 17, historico: PLAYCONTEMPLADAS }),
    null
  );
  assert.equal(
    vigiaDivergenciaSync({ fonte: "PLAYCONTEMPLADAS", divergencias: 153, historico: PLAYCONTEMPLADAS }),
    null,
    "153 e o proprio p95 — ja aconteceu, nao e noticia"
  );
});

test("divergencia: fonte calma protegida pelo piso", () => {
  const cartas = [1, 2, 3, 4, 4, 5, 8, 14, 22, 26];
  assert.equal(vigiaDivergenciaSync({ fonte: "CARTAS", divergencias: 26, historico: cartas }), null);
  const a = vigiaDivergenciaSync({ fonte: "CARTAS", divergencias: 51, historico: cartas });
  assert.ok(a, "acima do piso, ai sim");
  assert.equal(a.detalhe.base, "piso_maior");
});

test("divergencia: fonte sem historico nao alarma na estreia", () => {
  assert.equal(vigiaDivergenciaSync({ fonte: "NOVA", divergencias: 40, historico: [] }), null);
});

// ---------------------------------------------------------------------------
// VIGIA 2 — prova de amostra
// ---------------------------------------------------------------------------

test("amostra: CARTAS lendo 198 e recebendo 0 — o canal parou", () => {
  const a = vigiaProvaAmostra({ fonte: "CARTAS", lidas: 198, recebidas: 0, baselineTaxa: 1 });
  assert.ok(a);
  assert.equal(a.tipo, TIPO_AMOSTRA);
  assert.equal(a.chave, "CARTAS");
  assert.equal(a.severidade, "grave", "zero DEPOIS de regressao e parada, nao queda");
  assert.equal(a.detalhe.taxa, 0);
  assert.ok(a.titulo.includes("100%") && a.titulo.includes("0%"));
});

test("amostra: LANCE com espera=0 fica CALADO apesar do zero", () => {
  // A ordem foi literal: alarmar na REGRESSAO, nao no zero absoluto. LANCE
  // devolve recebidas=0 por desenho (`sync_raw_desenho`), e nunca sustentou
  // taxa nenhuma. Um vigia que olhasse so o zero abriria alerta eterno numa
  // fonte que esta funcionando como foi construida.
  assert.equal(
    vigiaProvaAmostra({ fonte: "LANCE", lidas: 140, recebidas: 0, baselineTaxa: 0 }),
    null
  );
});

test("amostra: ciclo que nao leu nada diz 'nao sei', nao 'tudo bem'", () => {
  // Dividir por zero daria NaN, e NaN comparado a qualquer coisa e falso —
  // alarme mudo, que e o pior defeito possivel num vigia.
  assert.equal(vigiaProvaAmostra({ fonte: "CBC", lidas: 0, recebidas: 0, baselineTaxa: 1 }), null);
  assert.equal(vigiaProvaAmostra({ fonte: "CBC", lidas: -5, recebidas: 0, baselineTaxa: 1 }), null);
});

test("amostra: SILENCIO na oscilacao pequena, alerta na queda de verdade", () => {
  assert.equal(
    vigiaProvaAmostra({ fonte: "PIFFER", lidas: 100, recebidas: 80, baselineTaxa: 1 }),
    null,
    "20 pontos nao chegam na queda minima de 30"
  );
  const a = vigiaProvaAmostra({ fonte: "PIFFER", lidas: 100, recebidas: 60, baselineTaxa: 1 });
  assert.ok(a);
  assert.equal(a.severidade, "aviso", "caiu, mas nao parou");
  assert.equal(a.detalhe.queda_minima, QUEDA_AMOSTRA);
});

// ---------------------------------------------------------------------------
// VIGIA 3 — estoque
// ---------------------------------------------------------------------------

test("estoque nivel: SILENCIO com 2423 disponiveis — o numero medido em 16/08", () => {
  // O ponto do par de vigias: o nivel estava saudavel enquanto o fluxo tinha
  // parado. Este teste prova que o vigia de nivel calou com razao.
  assert.equal(vigiaEstoqueNivel({ disponiveisAgora: 2423, disponiveisBaseline: 2450 }), null);
});

test("estoque nivel: queda de 20% abre, de 50% agrava", () => {
  const aviso = vigiaEstoqueNivel({ disponiveisAgora: 800, disponiveisBaseline: 1000 });
  assert.ok(aviso);
  assert.equal(aviso.tipo, TIPO_ESTOQUE);
  assert.equal(aviso.chave, "nivel");
  assert.equal(aviso.severidade, "aviso");
  assert.equal(aviso.detalhe.queda, QUEDA_ESTOQUE);

  const grave = vigiaEstoqueNivel({ disponiveisAgora: 500, disponiveisBaseline: 1000 });
  assert.ok(grave);
  assert.equal(grave.severidade, "grave");
});

test("estoque nivel: baseline zero nao vira alerta eterno", () => {
  assert.equal(vigiaEstoqueNivel({ disponiveisAgora: 0, disponiveisBaseline: 0 }), null);
});

test("estoque movimento: o caso vivo — 0 cartas novas com 5 ciclos rodados", () => {
  // 1008 novas em 14/08, 1 em 15/08, 0 em 16/08. O nivel nao caiu; a vitrine
  // envelheceu em silencio.
  const a = vigiaEstoqueSemMovimento({ horasSemCartaNova: 28, ciclosNoPeriodo: 5 });
  assert.ok(a);
  assert.equal(a.tipo, TIPO_ESTOQUE);
  assert.equal(a.chave, "sem_movimento", "mesma familia do nivel, condicao diferente");
  assert.equal(a.severidade, "grave", "28h e mais que o dobro de 12h");
  assert.equal(a.detalhe.ciclos, 5);
});

test("estoque movimento: sem ciclo rodado, o silencio e do cron — nao deste vigia", () => {
  // Alarmar aqui apontaria o dedo para o lugar errado. Quem cobra cron parado
  // e o heartbeat.
  assert.equal(vigiaEstoqueSemMovimento({ horasSemCartaNova: 48, ciclosNoPeriodo: 0 }), null);
});

test("estoque movimento: SILENCIO logo abaixo do limite", () => {
  assert.equal(
    vigiaEstoqueSemMovimento({ horasSemCartaNova: HORAS_SEM_MOVIMENTO - 0.1, ciclosNoPeriodo: 3 }),
    null
  );
  assert.ok(vigiaEstoqueSemMovimento({ horasSemCartaNova: HORAS_SEM_MOVIMENTO, ciclosNoPeriodo: 3 }));
});

test("estoque: as duas condicoes podem estar abertas ao mesmo tempo", () => {
  // Mesmo `tipo`, `chave` diferente. E o par (tipo, chave) que o indice unico
  // parcial usa — sem chaves distintas, uma condicao apagaria a outra.
  const nivel = vigiaEstoqueNivel({ disponiveisAgora: 500, disponiveisBaseline: 1000 });
  const parado = vigiaEstoqueSemMovimento({ horasSemCartaNova: 28, ciclosNoPeriodo: 5 });
  assert.ok(nivel && parado);
  assert.equal(nivel.tipo, parado.tipo);
  assert.notEqual(nivel.chave, parado.chave);
});

// ---------------------------------------------------------------------------
// VIGIA 4 — FAROL sem publicar
// ---------------------------------------------------------------------------

test("farol: cobra depois do horario, cala antes", () => {
  assert.equal(
    vigiaFarolSemPublicar({ horaSP: HORA_COBRANCA_FAROL - 1, publicadosHoje: 0 }),
    null,
    "o cron roda 11h SP; ate 16h a retentativa ainda tem chance"
  );
  const a = vigiaFarolSemPublicar({ horaSP: HORA_COBRANCA_FAROL, publicadosHoje: 0 });
  assert.ok(a);
  assert.equal(a.tipo, TIPO_FAROL);
  assert.equal(a.chave, "sem_publicar");
  assert.equal(a.severidade, "aviso", "post que nao saiu nao para a casa");
});

test("farol: publicou uma vez, nao cobra — nem as 23h", () => {
  assert.equal(vigiaFarolSemPublicar({ horaSP: 23, publicadosHoje: 1 }), null);
});

// ---------------------------------------------------------------------------
// VIGIA 5 — fila do Sentinela
// ---------------------------------------------------------------------------

const AGORA = new Date("2026-08-16T04:00:00.000Z");

test("fila: as 21 de 04/08, onze dias esperando — o silencio que custou caro", () => {
  const a = vigiaFilaSentinela({
    maisAntigaEm: new Date("2026-08-04T22:27:20.820Z"),
    quantasEsperando: 21,
    agora: AGORA,
  });
  assert.ok(a, "onze dias em aguardando_template tinham de ter alarmado");
  assert.equal(a.tipo, TIPO_FILA_SENTINELA);
  assert.equal(a.chave, "envelhecendo");
  assert.equal(a.severidade, "grave", "mais que o dobro de 3 dias");
  assert.equal(a.detalhe.esperando, 21);
  assert.equal(a.detalhe.dias, 11);
});

test("fila: SILENCIO dentro do ritmo de 72h", () => {
  // O espacamento entre toques e 72h. Uma linha esperando 2 dias esta no
  // ritmo, nao parada.
  assert.equal(
    vigiaFilaSentinela({
      maisAntigaEm: new Date("2026-08-14T04:00:00.000Z"),
      quantasEsperando: 5,
      agora: AGORA,
    }),
    null
  );
});

test("fila: exatamente no limite abre, como aviso", () => {
  const a = vigiaFilaSentinela({
    maisAntigaEm: new Date("2026-08-13T04:00:00.000Z"), // 3 dias exatos
    quantasEsperando: 5,
    agora: AGORA,
  });
  assert.ok(a);
  assert.equal(a.severidade, "aviso");
  assert.equal(a.detalhe.dias, DIAS_FILA_PARADA);
});

test("fila: vazia nao alarma, e 'sem data' tambem nao", () => {
  assert.equal(
    vigiaFilaSentinela({ maisAntigaEm: null, quantasEsperando: 0, agora: AGORA }),
    null
  );
  assert.equal(
    vigiaFilaSentinela({
      maisAntigaEm: new Date("2026-08-04T22:27:20.820Z"),
      quantasEsperando: 0,
      agora: AGORA,
    }),
    null,
    "data antiga sem ninguem esperando e fila vazia, nao fila parada"
  );
});

// ---------------------------------------------------------------------------
// O CONJUNTO
// ---------------------------------------------------------------------------

test("tipos: cinco condicoes, sem repetidos — o painel agrupa por aqui", () => {
  assert.equal(TIPOS_RADAR.length, 5);
  assert.equal(new Set(TIPOS_RADAR).size, 5, "tipo repetido misturaria vigias na tela");
  for (const t of TIPOS_RADAR) {
    assert.ok(t.length > 0 && t === t.toLowerCase(), `tipo '${t}' fora do padrao snake_case`);
  }
});

test("alerta: todo alerta aberto tem titulo legivel e detalhe com numeros", () => {
  const abertos = [
    vigiaDivergenciaSync({ fonte: "PLAYCONTEMPLADAS", divergencias: 621, historico: PLAYCONTEMPLADAS }),
    vigiaProvaAmostra({ fonte: "CARTAS", lidas: 198, recebidas: 0, baselineTaxa: 1 }),
    vigiaEstoqueNivel({ disponiveisAgora: 500, disponiveisBaseline: 1000 }),
    vigiaEstoqueSemMovimento({ horasSemCartaNova: 28, ciclosNoPeriodo: 5 }),
    vigiaFarolSemPublicar({ horaSP: 17, publicadosHoje: 0 }),
    vigiaFilaSentinela({
      maisAntigaEm: new Date("2026-08-04T22:27:20.820Z"),
      quantasEsperando: 21,
      agora: AGORA,
    }),
  ];
  for (const a of abertos) {
    assert.ok(a, "fixture montada para abrir alerta");
    assert.ok(TIPOS_RADAR.includes(a.tipo as (typeof TIPOS_RADAR)[number]));
    assert.ok(a.chave.length > 0, "chave vazia quebraria o indice unico parcial");
    assert.ok(a.titulo.length > 10, "titulo tem de ser lido por quem nao escreveu o codigo");
    assert.ok(!a.titulo.includes("undefined") && !a.titulo.includes("NaN"));
    assert.ok(Object.keys(a.detalhe).length > 0, "alerta sem numeros nao se sustenta");
  }
});
