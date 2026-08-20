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
//   3. O fim de semana de 15–16/08, que é o caso em que o vigia de movimento
//      precisa ficar CALADO. Eu tinha escrito aqui que "1008 cartas novas em
//      14/08 para 0 em 16/08" provava uma parada; a medição desmentiu — 15/08 é
//      sábado, 16/08 é domingo, e TODO domingo de seis semanas de histórico deu
//      zero. O caso real que sobrou é o oposto do que eu afirmei, e por isso ele
//      virou dois testes de silêncio: o fim de semana (62h corridas) e a noite
//      comum (15h corridas), ambos abaixo do limiar quando contados em hora útil.
//   4. FAROL sem publicar depois do horário do cron.
//   5. As 21 linhas de 04/08, onze dias em `aguardando_template`.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";

import { horasUteisEntre } from "@/lib/radar/limiar";
import {
  CICLOS_REINCIDENTE,
  DIAS_FILA_PARADA,
  HORAS_UTEIS_SEM_MOVIMENTO,
  HORA_COBRANCA_FAROL,
  QUARENTENA_DISTINTAS_DIA,
  QUEDA_AMOSTRA,
  QUEDA_ESTOQUE,
  TIPOS_RADAR,
  TIPO_QUARENTENA,
  vigiaQuarentenaReincidente,
  vigiaQuarentenaVolume,
  TIPO_AMOSTRA,
  TIPO_DIVERGENCIA,
  TIPO_ESTOQUE,
  TIPO_FAROL,
  TIPO_FILA_SENTINELA,
  TIPO_ENVIO_SENTINELA,
  FALHAS_NO_CICLO,
  vigiaEnvioSentinela,
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

test("estoque movimento: sync sem falha e nada entrando vira alerta", () => {
  const a = vigiaEstoqueSemMovimento({
    horasUteisSemCartaNova: 42,
    ciclosNoPeriodo: 5,
    fontesOk: 5,
    fontesFalha: 0,
  });
  assert.ok(a);
  assert.equal(a.tipo, TIPO_ESTOQUE);
  assert.equal(a.chave, "sem_movimento", "mesma familia do nivel, condicao diferente");
  assert.equal(a.severidade, "grave", "42h uteis e mais que o dobro de 20");
  assert.equal(a.detalhe.ciclos, 5);
  assert.equal(a.detalhe.fontes_falha, 0);
});

test("estoque movimento: sem ciclo rodado, o silencio e do cron — nao deste vigia", () => {
  // Alarmar aqui apontaria o dedo para o lugar errado. Quem cobra cron parado
  // e o heartbeat.
  assert.equal(
    vigiaEstoqueSemMovimento({ horasUteisSemCartaNova: 48, ciclosNoPeriodo: 0 }),
    null
  );
});

test("estoque movimento: SILENCIO logo abaixo do limite", () => {
  assert.equal(
    vigiaEstoqueSemMovimento({
      horasUteisSemCartaNova: HORAS_UTEIS_SEM_MOVIMENTO - 0.1,
      ciclosNoPeriodo: 3,
    }),
    null
  );
  assert.ok(
    vigiaEstoqueSemMovimento({
      horasUteisSemCartaNova: HORAS_UTEIS_SEM_MOVIMENTO,
      ciclosNoPeriodo: 3,
    })
  );
});

// O TESTE QUE PEGA O DEFEITO DE 16/08, e ele falharia na versao anterior.
//
// Sexta 19h -> segunda 08h sao 62 HORAS CORRIDAS, o maior vao da serie inteira,
// e nao ha nada de errado: o fornecedor nao publica em fim de semana (todo
// domingo de seis semanas deu zero). Em hora util o mesmo vao mede 13, que e
// noite comum. Com o limiar em hora corrida este caso alarmava; e como ele
// acontece TODA SEMANA, o vigia tocaria todo sabado ate ninguem mais abrir.
test("estoque movimento: o fim de semana inteiro NAO alarma", () => {
  const sextaFim = new Date("2026-08-07T22:00:00Z"); // sex 19h SP
  const segundaManha = new Date("2026-08-10T11:00:00Z"); // seg 08h SP
  const corridas = (segundaManha.getTime() - sextaFim.getTime()) / 3_600_000;
  const uteis = horasUteisEntre(sextaFim, segundaManha);

  assert.ok(corridas > 60, "o vao corrido e mesmo enorme");
  assert.ok(uteis < HORAS_UTEIS_SEM_MOVIMENTO, `em hora util sao ${uteis}, abaixo do limiar`);
  assert.equal(
    vigiaEstoqueSemMovimento({
      horasUteisSemCartaNova: uteis,
      ciclosNoPeriodo: 60,
      fontesOk: 5,
      fontesFalha: 0,
    }),
    null,
    "fim de semana e o mundo normal, nao defeito nosso"
  );
});

// A noite comum tambem nao alarma. Medido: 15h corridas e o maior vao NORMAL de
// dia util (qui 18h -> sex 08h), e em hora util isso e o mesmo 15.
test("estoque movimento: a noite comum de dia util NAO alarma", () => {
  const quintaFim = new Date("2026-08-13T21:00:00Z"); // qui 18h SP
  const sextaManha = new Date("2026-08-14T11:00:00Z"); // sex 08h SP
  const uteis = horasUteisEntre(quintaFim, sextaManha);
  assert.ok(uteis <= 15, `noite comum mede ${uteis} horas uteis`);
  assert.equal(
    vigiaEstoqueSemMovimento({ horasUteisSemCartaNova: uteis, ciclosNoPeriodo: 14 }),
    null
  );
});

test("estoque movimento: com fonte falhando, quem explica e o vigia de divergencia", () => {
  // Duas linhas para um problema so e como um painel deixa de ser lido.
  assert.equal(
    vigiaEstoqueSemMovimento({
      horasUteisSemCartaNova: 40,
      ciclosNoPeriodo: 5,
      fontesOk: 4,
      fontesFalha: 1,
    }),
    null
  );
  // Zero fontes ok e sync que nao rodou, nao estoque parado.
  assert.equal(
    vigiaEstoqueSemMovimento({
      horasUteisSemCartaNova: 40,
      ciclosNoPeriodo: 5,
      fontesOk: 0,
      fontesFalha: 0,
    }),
    null
  );
});

test("estoque movimento: quem nao mediu a saude do sync nao e obrigado a fingir", () => {
  // `undefined` passa. O vigia continua valendo pela parada em si — o que nao
  // pode e um ciclo com falha conhecida escapar da guarda por omissao.
  assert.ok(vigiaEstoqueSemMovimento({ horasUteisSemCartaNova: 40, ciclosNoPeriodo: 5 }));
});

test("estoque: as duas condicoes podem estar abertas ao mesmo tempo", () => {
  // Mesmo `tipo`, `chave` diferente. E o par (tipo, chave) que o indice unico
  // parcial usa — sem chaves distintas, uma condicao apagaria a outra.
  const nivel = vigiaEstoqueNivel({ disponiveisAgora: 500, disponiveisBaseline: 1000 });
  const parado = vigiaEstoqueSemMovimento({
    horasUteisSemCartaNova: 42,
    ciclosNoPeriodo: 5,
  });
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

/* O TERCEIRO ESTADO. Os dois testes acima ja provavam que o vigia grita e que
 * ele cala — o que faltava era a diferenca entre CALAR PORQUE MEDIU e CALAR
 * PORQUE NAO MEDIU. A rota passava `publicadosHoje ?? 0`, e foi assim que em
 * 17/08/2026 nasceu um alerta dizendo que o FAROL nao publicou num dia em que
 * ele publicou: a contagem voltou null, virou 0, e o vigia acreditou. */
test("farol: contagem null NAO julga — nao sei nao e zero", () => {
  assert.equal(
    vigiaFarolSemPublicar({ horaSP: 23, publicadosHoje: null }),
    null,
    "leitura que falhou nao pode virar veredito de ausencia"
  );
  // CONTROLE do teste acima: o mesmo horario, com contagem medida em zero,
  // TEM de gritar. Sem esta linha, o null passar seria indistinguivel de um
  // vigia quebrado que nunca alarma.
  assert.ok(
    vigiaFarolSemPublicar({ horaSP: 23, publicadosHoje: 0 }),
    "as 23h com zero MEDIDO o vigia tem de cobrar"
  );
});

test("farol: 17/08/2026 — o dia real que gerou o alerta falso", () => {
  // O que o banco tinha naquele dia: 4 publicados. As duas varreduras que
  // passam da hora de cobranca (18h e 21h SP) tinham de ficar caladas.
  assert.equal(vigiaFarolSemPublicar({ horaSP: 18, publicadosHoje: 4 }), null);
  assert.equal(vigiaFarolSemPublicar({ horaSP: 21, publicadosHoje: 4 }), null);
  // E o contrafactual, para provar que o silencio acima e do dado e nao do
  // vigia: o mesmo instante, com zero medido, alarma.
  assert.ok(vigiaFarolSemPublicar({ horaSP: 21, publicadosHoje: 0 }));
});

/* `radar_registrar` reescreve `titulo` a cada ocorrencia (`titulo = p_titulo`
 * no ramo do UPDATE), enquanto o painel imprime, na mesma linha, "aberta ha X"
 * vindo de `primeira_vez`. Titulo que embute o relogio da observacao produz a
 * contradicao que apareceu no painel: "ate as 21h", aberta desde as 18h. */
test("farol: titulo e estavel entre varreduras; a hora vive no detalhe", () => {
  const as18 = vigiaFarolSemPublicar({ horaSP: 18, publicadosHoje: 0 });
  const as21 = vigiaFarolSemPublicar({ horaSP: 21, publicadosHoje: 0 });
  assert.ok(as18 && as21);
  assert.equal(
    as18.titulo,
    as21.titulo,
    "o titulo e reescrito a cada ocorrencia: se variar, contradiz primeira_vez"
  );
  assert.ok(!as21.titulo.includes("21"), "a hora corrente nao entra no titulo");
  assert.ok(
    as21.titulo.includes(String(HORA_COBRANCA_FAROL)),
    "o limite, que e constante, pode e deve estar no titulo"
  );
  // CONTROLE: o que foi tirado do titulo tem de continuar existindo em algum
  // lugar. Se sumir dos dois, a mudanca apagou informacao em vez de move-la.
  assert.equal((as18.detalhe as { hora_sp: number }).hora_sp, 18);
  assert.equal((as21.detalhe as { hora_sp: number }).hora_sp, 21);
});

test("farol: 'desde' entra no detalhe quando informado, e some quando nao", () => {
  const com = vigiaFarolSemPublicar({
    horaSP: 21,
    publicadosHoje: 0,
    desde: "2026-08-17T03:00:00.000Z",
  });
  assert.ok(com);
  assert.equal((com.detalhe as { desde?: string }).desde, "2026-08-17T03:00:00.000Z");
  const sem = vigiaFarolSemPublicar({ horaSP: 21, publicadosHoje: 0 });
  assert.ok(sem);
  assert.ok(!("desde" in (sem.detalhe as object)), "sem janela medida, sem campo");
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

// Este numero e travado de proposito. Quando entrou o sexto tipo (quarentena),
// o teste falhou e me obrigou a declarar a mudanca em vez de deixar um vigia
// novo entrar de fininho no painel. Quem acrescentar o oitavo passa por aqui.
//
// SETIMO, DECLARADO: `sentinela_envio` (VIGIA 8), 19/08/2026. Este teste
// falhou 7 !== 6 quando o tipo entrou, que e exatamente o que ele existe para
// fazer — a trava funcionou e me obrigou a escrever esta linha em vez de
// deixar um vigia novo aparecer no painel sem ninguem ter decidido.
test("tipos: sete condicoes, sem repetidos — o painel agrupa por aqui", () => {
  assert.equal(TIPOS_RADAR.length, 7);
  assert.equal(new Set(TIPOS_RADAR).size, 7, "tipo repetido misturaria vigias na tela");
  for (const t of TIPOS_RADAR) {
    assert.ok(t.length > 0 && t === t.toLowerCase(), `tipo '${t}' fora do padrao snake_case`);
  }
});

test("alerta: todo alerta aberto tem titulo legivel e detalhe com numeros", () => {
  const abertos = [
    vigiaDivergenciaSync({ fonte: "PLAYCONTEMPLADAS", divergencias: 621, historico: PLAYCONTEMPLADAS }),
    vigiaProvaAmostra({ fonte: "CARTAS", lidas: 198, recebidas: 0, baselineTaxa: 1 }),
    vigiaEstoqueNivel({ disponiveisAgora: 500, disponiveisBaseline: 1000 }),
    vigiaEstoqueSemMovimento({ horasUteisSemCartaNova: 28, ciclosNoPeriodo: 5 }),
    vigiaFarolSemPublicar({ horaSP: 17, publicadosHoje: 0 }),
    vigiaFilaSentinela({
      maisAntigaEm: new Date("2026-08-04T22:27:20.820Z"),
      quantasEsperando: 21,
      agora: AGORA,
    }),
    // O ciclo real de 19/08/2026: 15 recusas, nenhuma entrega.
    vigiaEnvioSentinela({ falhas: 15, feitos: 0 }),
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

// ===========================================================================
// VIGIAS 6 e 7 — quarentena. O caso que me pegou errado em 16/08/2026.
// ---------------------------------------------------------------------------
// Relatei "95 cartas barradas contra 1 aprovada" e conclui que a fonte tinha
// desabado. Eram 4 cartas reinserindo 24 vezes. Estes testes existem para que
// o erro nao possa voltar por descuido de quem escrever o proximo vigia.
// ===========================================================================

/** As 4 reais de 16/08, com os ciclos medidos. */
const QUARENTENA_16_08 = [
  { numeroExterno: 21, fonte: "PLAYCONTEMPLADAS", ciclos: 24 },
  { numeroExterno: 78, fonte: "PLAYCONTEMPLADAS", ciclos: 24 },
  { numeroExterno: 345, fonte: "PLAYCONTEMPLADAS", ciclos: 24 },
  { numeroExterno: 1182, fonte: "PIFFER", ciclos: 23 },
];

test("o caso real: 95 eventos e 4 cartas distintas NAO abrem alerta de volume", () => {
  // O numero que eu relatei errado entra aqui como `eventos`, e o vigia tem de
  // ignora-lo. 4 distintas e o PISO da serie de 14 dias (p50 28, p90 47).
  const a = vigiaQuarentenaVolume({ cartasDistintas: 4, eventos: 95 });
  assert.equal(a, null, "95 eventos de 4 cartas nao e volume alto");
});

test("volume julga cartas distintas mesmo com contagem de eventos gigante", () => {
  const alto = vigiaQuarentenaVolume({ cartasDistintas: QUARENTENA_DISTINTAS_DIA, eventos: 60 });
  assert.ok(alto, "no limiar, alarma");
  assert.equal(alto.tipo, TIPO_QUARENTENA);
  assert.equal(alto.detalhe.cartas_distintas, QUARENTENA_DISTINTAS_DIA);
  // `eventos` MENOR que as distintas e impossivel no mundo real, e mesmo assim
  // o julgamento nao muda: quem manda e o campo certo.
  assert.equal(alto.detalhe.eventos, 60);
});

test("silencio na fronteira: uma carta abaixo do limiar nao alarma", () => {
  const a = vigiaQuarentenaVolume({ cartasDistintas: QUARENTENA_DISTINTAS_DIA - 1, eventos: 999 });
  assert.equal(a, null, "p90 - 1 ainda e dia normal, mesmo com 999 eventos");
});

test("reincidencia: as 4 de hoje sao QUATRO alertas, um por carta", () => {
  const alertas = QUARENTENA_16_08.map((c) => vigiaQuarentenaReincidente(c)).filter(Boolean);
  // A PIFFER 1182 tem 23 ciclos: abaixo do limiar de 24. Sao 3, nao 4 — e essa
  // diferenca de um ciclo e exatamente o que um limiar redondo esconderia.
  assert.equal(alertas.length, 3, "23 ciclos ainda nao e um dia inteiro");
  const chaves = new Set(alertas.map((a) => a!.chave));
  assert.equal(chaves.size, 3, "uma condicao POR CARTA, senao o indice unico agrupa");
  assert.ok(chaves.has("reincidente:21"));
  assert.ok(!chaves.has("reincidente:1182"), "a de 23 ciclos ficou de fora");
});

test("reincidencia usa numero_externo, nunca o id da linha", () => {
  const a = vigiaQuarentenaReincidente({ numeroExterno: 21, fonte: "PLAYCONTEMPLADAS", ciclos: 45 });
  assert.ok(a);
  // A armadilha medida: `count(distinct carta_id)` devolvia 95 porque cada
  // ciclo grava linha nova. A identidade da carta no mundo e `numero_externo`.
  assert.equal(a.detalhe.numero_externo, 21);
  assert.ok(a.chave.endsWith("21"), "a chave tem de ser estavel entre ciclos");
  assert.ok(a.titulo.includes("PLAYCONTEMPLADAS"), "a fonte no titulo: o conserto e do lado dela");
});

test("o lote anterior, de 161 ciclos, seria grave", () => {
  const a = vigiaQuarentenaReincidente({ numeroExterno: 98, fonte: "PLAYCONTEMPLADAS", ciclos: 161 });
  assert.ok(a);
  assert.equal(a.severidade, "grave", "6,8 dias barrada nao e aviso");
});

test("uma quarentena isolada — o caso de 53% das cartas — fica em silencio", () => {
  assert.equal(vigiaQuarentenaReincidente({ numeroExterno: 7, fonte: "CBC", ciclos: 1 }), null);
  assert.equal(
    vigiaQuarentenaReincidente({ numeroExterno: 7, fonte: "CBC", ciclos: CICLOS_REINCIDENTE - 1 }),
    null,
    "a fronteira: 23 ciclos calam"
  );
});

// ---------------------------------------------------------------------------
// VIGIA 8 — o Sentinela envia e a Meta recusa
// ---------------------------------------------------------------------------
//
// O CASO REAL, e ele é o mais constrangedor da lista: durante cinco ciclos,
// entre 17 e 19/08/2026, o Sentinela recusou 75 envios seguidos (#132001) e
// NENHUM vigia abriu a boca. O VIGIA 5 estava de pé e calado — corretamente,
// porque ele mede IDADE da fila, e a fila não envelhecia: a varredura passava
// por ela a cada seis horas. O sistema fazia barulho de trabalho sem entregar
// nada, e vigiar a fila não é vigiar o envio.

test("VIGIA 8 — os cinco ciclos de 15 recusas e 0 entregas: grave, e teria gritado no primeiro", () => {
  /* O número exato do ciclo de 2026-08-17 12:00. Com este vigia de pé, o
   * alerta sairia dois dias e meio antes de alguém perguntar. */
  const a = vigiaEnvioSentinela({ falhas: 15, feitos: 0 });
  assert.ok(a);
  assert.equal(a.tipo, TIPO_ENVIO_SENTINELA);
  assert.equal(a.severidade, "grave", "nada saiu do ciclo — isso e pane, nao aviso");
  assert.equal(a.detalhe.falhas, 15);
  assert.equal(a.detalhe.feitos, 0);
  assert.ok(TIPOS_RADAR.includes(TIPO_ENVIO_SENTINELA), "o painel precisa saber agrupar o tipo novo");
});

test("VIGIA 8 — a chave e estavel entre ciclos: uma condicao, nao uma por falha", () => {
  /* Doutrina da casa: um alerta por CONDIÇÃO. Se a chave carregasse o número
   * de falhas, cada ciclo abriria um alerta novo e o painel viraria um mural
   * de 75 linhas dizendo a mesma coisa. */
  const c1 = vigiaEnvioSentinela({ falhas: 15, feitos: 0 });
  const c2 = vigiaEnvioSentinela({ falhas: 12, feitos: 0 });
  assert.ok(c1 && c2);
  assert.equal(c1.chave, c2.chave);
});

test("VIGIA 8 — ciclo PEQUENO todo falho tambem alarma: 3 de 3", () => {
  /* Por que o limiar é baixo. A janela envia no máximo 15, e conforme a fila
   * drena os ciclos encolhem. Um limiar de 10 ficaria cego exatamente no ciclo
   * de 3 pessoas em que as 3 falham — que é tão sistêmico quanto 15 de 15 e
   * muito mais fácil de não notar. */
  const a = vigiaEnvioSentinela({ falhas: 3, feitos: 0 });
  assert.ok(a);
  assert.equal(a.severidade, "grave");
});

test("VIGIA 8 — falhou o bastante MAS algo saiu: aviso, nao grave", () => {
  /* O canal funciona; o defeito é por destinatário (número morto, bloqueio).
   * Merece olhar, não merece acordar ninguém — e tratar isso como pane faria
   * o alerta mentir, que é como se ensina a ignorar alerta. */
  const a = vigiaEnvioSentinela({ falhas: 4, feitos: 11 });
  assert.ok(a);
  assert.equal(a.severidade, "aviso");
  assert.ok(a.titulo.includes("15"), "o titulo tem de dizer de quantos tentados");
});

test("VIGIA 8 — SILENCIO na fronteira: 2 falhas nao sao pane", () => {
  /* O silêncio testado onde importa, colado no gatilho. Uma falha é rotina;
   * duas podem ser o mesmo segundo ruim da Graph. */
  assert.equal(vigiaEnvioSentinela({ falhas: FALHAS_NO_CICLO - 1, feitos: 0 }), null);
  assert.equal(vigiaEnvioSentinela({ falhas: 1, feitos: 14 }), null);
});

test("VIGIA 8 — SILENCIO no ciclo limpo e no ciclo vazio", () => {
  // CONTROLE do silêncio: casa saudável não gera linha.
  assert.equal(vigiaEnvioSentinela({ falhas: 0, feitos: 15 }), null);
  assert.equal(vigiaEnvioSentinela({ falhas: 0, feitos: 0 }), null);
});

test("VIGIA 8 — REGRA 19: falhas nao medidas NAO julgam", () => {
  /* `?? 0` aqui faria a leitura falha do sentinela_log virar "nenhuma falha",
   * e o vigia calaria justamente no dia em que o log não respondeu — que é um
   * dia suspeito, não um dia limpo. */
  assert.equal(vigiaEnvioSentinela({ falhas: null, feitos: 0 }), null);
  assert.equal(vigiaEnvioSentinela({ falhas: Number.NaN, feitos: 0 }), null);
});

test("VIGIA 8 — REGRA 19: feitos nao medidos ainda ALARMAM, com o null visivel", () => {
  /* A outra ponta da regra, e a mais fácil de errar para o lado errado: as
   * falhas FORAM medidas. Calar sobre 15 recusas porque o outro contador nao
   * veio seria trocar um alerta certo por um silencio comodo. O que cai e a
   * severidade — nao da para afirmar "nada saiu" sem ter medido. */
  const a = vigiaEnvioSentinela({ falhas: 15, feitos: null });
  assert.ok(a, "15 falhas medidas nao podem ficar caladas");
  assert.equal(a.severidade, "aviso", "sem medir entregas nao se afirma pane");
  assert.equal(a.detalhe.feitos, null, "o null tem de viajar visivel ate quem le");
  assert.ok(a.titulo.includes("não medidos"));
});
