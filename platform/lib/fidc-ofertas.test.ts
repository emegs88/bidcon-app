// ============================================================================
// Teste do núcleo de ofertas (FIDC-OFERTAS-01)
// ----------------------------------------------------------------------------
// Quatro grupos, em ordem de quanto dói errar.
//
// 1. LÉXICO. Medi em 12/08/2026 que "fidc" é palavra PROIBIDA em
//    lib/lexico.ts — mecânica interna, nunca verbalizar. Este módulo produz
//    strings de motivo que podem chegar a uma tela, então elas passam pela
//    mesma guarda que os e-mails passam. E fixo a descoberta num teste: se
//    alguém tirar "fidc" da régua, quero saber, porque o cabeçalho deste
//    arquivo depende disso ser verdade.
//
// 2. DINHEIRO. A faixa 20–35% do crédito nas duas pontas (emenda de 12/08), e o
//    total de um lote tem de ser a soma exata do que cada vendedor recebe.
//    Centavo que não fecha é centavo que alguém vai ter de explicar.
//
// 3. RELÓGIO. A janela de 24h e a regra de expiração na leitura, incluindo o
//    instante empatado — que é onde toda regra de prazo se decide.
//
// 4. NOMES. O kill-switch precisa nascer desarmado e continuar se chamando o
//    que a ordem disse que ele se chama.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";

import { garantirLexico, TERMOS_PROIBIDOS } from "@/lib/lexico";
import {
  COMISSAO_FUNDO_INCIDENCIA_DECIDIDA,
  COMISSAO_FUNDO_PCT,
  ENV_KILL_SWITCH,
  JANELA_OFERTA_HORAS,
  OFERTA_PISO_PCT,
  OFERTA_TETO_PCT,
  checarPct,
  comissaoFundo,
  expiraEm,
  montarLote,
  ofertasLigado,
  restanteMs,
  statusEfetivo,
  valorOfertado,
} from "@/lib/fidc-ofertas";

// ---------------------------------------------------------------------------
// 1. LÉXICO
// ---------------------------------------------------------------------------

test("lexico: a premissa deste modulo — 'fidc' e termo proibido", () => {
  const lista = TERMOS_PROIBIDOS as readonly string[];
  assert.ok(
    lista.includes("fidc"),
    "se 'fidc' saiu da regua, o cabecalho de lib/fidc-ofertas.ts virou mentira"
  );
  assert.ok(
    lista.includes("desconto"),
    "'desconto' e proibida — e depois da emenda de 12/08 nem faz falta: a conta " +
      "deixou de ser de abatimento e virou 'o fundo paga X% do valor do credito'"
  );
});

test("lexico: os motivos de descarte podem ir para a tela", () => {
  const lote = montarLote(
    [
      { id: "a", valorCredito: null },
      { id: "b", valorCredito: Number.NaN },
      { id: "c", valorCredito: 0 },
    ],
    25
  );
  assert.equal(lote.descartadas.length, 3);
  for (const d of lote.descartadas) {
    const r = garantirLexico(d.motivo);
    assert.equal(r.ok, true, `motivo reprovado no lexico: ${d.motivo}`);
  }
});

test("lexico: o motivo de recusa da faixa tambem vai para a tela", () => {
  // Este texto e o que a pessoa do fundo le quando digita o percentual errado.
  // Se ele nao passar no lexico, a tela nao pode mostra-lo — e um erro que nao
  // se pode mostrar e um erro mudo.
  for (const pct of [0, 19.99, 35.01, 120, Number.NaN]) {
    const v = checarPct(pct);
    assert.equal(v.ok, false, `${pct} deveria ser recusado`);
    if (v.ok) continue;
    const r = garantirLexico(v.motivo);
    assert.equal(r.ok, true, `motivo reprovado no lexico: ${v.motivo}`);
  }
});

// ---------------------------------------------------------------------------
// 2. DINHEIRO
// ---------------------------------------------------------------------------

test("faixa: as constantes sao 20 e 35, e as duas pontas ENTRAM", () => {
  assert.equal(OFERTA_PISO_PCT, 20);
  assert.equal(OFERTA_TETO_PCT, 35);

  // As pontas valem — piso que recusa o proprio piso nao e piso. E o CHECK do
  // banco usa >= e <=; se aqui fosse > e <, a tela aceitaria o que o banco
  // recusa, e o erro so apareceria no insert.
  assert.equal(checarPct(20).ok, true, "20% e o piso, e piso vale");
  assert.equal(checarPct(35).ok, true, "35% e o teto, e teto vale");
  assert.equal(checarPct(27.5).ok, true);

  // E as vizinhancas imediatas nao valem.
  assert.equal(checarPct(19.99).ok, false);
  assert.equal(checarPct(35.01).ok, false);
});

test("faixa: o motivo diz QUAL ponta foi violada", () => {
  const baixo = checarPct(18);
  assert.equal(baixo.ok, false);
  if (!baixo.ok) {
    assert.ok(baixo.motivo.includes("piso"), baixo.motivo);
    assert.ok(baixo.motivo.includes("20"), baixo.motivo);
  }

  const alto = checarPct(40);
  assert.equal(alto.ok, false);
  if (!alto.ok) {
    assert.ok(alto.motivo.includes("teto"), alto.motivo);
    assert.ok(alto.motivo.includes("35"), alto.motivo);
  }
});

test("valorOfertado: percentual DO CREDITO, arredondado a centavos", () => {
  // A conta e credito x pct/100 — quanto o fundo PAGA —, e nao credito x
  // (1 - pct/100), que era a conta de desagio antes da emenda de 12/08.
  assert.equal(valorOfertado(100_000, 20), 20_000, "piso paga 20% do credito");
  assert.equal(valorOfertado(100_000, 35), 35_000, "teto paga 35% do credito");
  // Cota real do EXTRATO.pdf: credito de R$ 125.303,66.
  assert.equal(valorOfertado(125_303.66, 27.5), 34_458.51);
});

test("valorOfertado: recusa entrada que nao permite resposta honesta", () => {
  assert.equal(valorOfertado(100, 19.99), null, "abaixo do piso");
  assert.equal(valorOfertado(100, 35.01), null, "acima do teto");
  assert.equal(valorOfertado(100, 0), null);
  assert.equal(valorOfertado(100, 100), null);
  assert.equal(valorOfertado(100, -5), null);
  assert.equal(valorOfertado(100, Number.POSITIVE_INFINITY), null);
  assert.equal(valorOfertado(-1, 25), null);
  assert.equal(valorOfertado(Number.NaN, 25), null);
  assert.equal(
    valorOfertado(0, 25),
    null,
    "credito zero e recusado, nao aceito com resultado zero"
  );
});

test("montarLote: o total e a soma dos itens JA arredondados", () => {
  // NAO afirmo que estes numeros fazem as duas ordens de arredondamento
  // divergirem — nao medi isso, e forjar uma divergencia em ponto flutuante e
  // mais facil de errar do que de acertar. O que este teste fixa e a INVARIANTE
  // que importa em qualquer entrada: o total e exatamente a soma do que os
  // vendedores recebem.
  const cartas = [
    { id: "a", valorCredito: 33.33 },
    { id: "b", valorCredito: 33.33 },
    { id: "c", valorCredito: 33.33 },
  ];
  const lote = montarLote(cartas, 20);

  const somaDosItens = lote.itens.reduce((s, i) => s + i.valorOfertado, 0);
  assert.equal(
    lote.total,
    Math.round((somaDosItens + Number.EPSILON) * 100) / 100,
    "o total precisa fechar com o que os vendedores recebem"
  );
  for (const i of lote.itens) {
    assert.equal(
      i.valorOfertado,
      Math.round(i.valorOfertado * 100) / 100,
      "todo item ja sai em centavos"
    );
  }
});

test("montarLote: carta sem credito sai da lista nomeada, nao vira oferta de zero", () => {
  const lote = montarLote(
    [
      { id: "boa", valorCredito: 200_000 },
      { id: "sem-credito", valorCredito: null },
    ],
    30
  );
  assert.equal(lote.recusa, null, "a faixa esta boa; a recusa e por carta");
  assert.equal(lote.itens.length, 1);
  assert.equal(lote.itens[0].cartaId, "boa");
  assert.equal(lote.itens[0].valorCredito, 200_000);
  assert.equal(lote.itens[0].valorOfertado, 60_000);
  assert.deepEqual(lote.descartadas, [
    { cartaId: "sem-credito", motivo: "sem valor de crédito" },
  ]);
  assert.ok(
    !lote.itens.some((i) => i.valorOfertado === 0),
    "nenhuma carta pode virar oferta de R$ 0 por falta de dado"
  );
});

test("montarLote: percentual fora da faixa recusa o LOTE, nao acusa as cartas", () => {
  const cartas = [
    { id: "a", valorCredito: 100_000 },
    { id: "b", valorCredito: 200_000 },
  ];
  const lote = montarLote(cartas, 18);

  assert.equal(lote.itens.length, 0);
  assert.equal(lote.total, 0);
  assert.ok(typeof lote.recusa === "string" && lote.recusa.includes("piso"));
  assert.deepEqual(
    lote.descartadas,
    [],
    "as cartas estao boas — a culpa e do percentual, e a tela precisa dizer isso"
  );
});

test("montarLote: nas duas pontas da faixa o lote sai inteiro", () => {
  const cartas = [
    { id: "a", valorCredito: 100_000 },
    { id: "b", valorCredito: 50_000 },
  ];

  const piso = montarLote(cartas, OFERTA_PISO_PCT);
  assert.equal(piso.recusa, null);
  assert.equal(piso.itens.length, 2);
  assert.equal(piso.total, 30_000);

  const teto = montarLote(cartas, OFERTA_TETO_PCT);
  assert.equal(teto.recusa, null);
  assert.equal(teto.itens.length, 2);
  assert.equal(teto.total, 52_500);
});

// ---------------------------------------------------------------------------
// 3. RELÓGIO
// ---------------------------------------------------------------------------

test("janela: 24 horas exatas, e a constante e a fonte unica", () => {
  assert.equal(JANELA_OFERTA_HORAS, 24);
  const criado = new Date("2026-08-12T10:00:00.000Z");
  assert.equal(expiraEm(criado).toISOString(), "2026-08-13T10:00:00.000Z");
});

test("restanteMs: passado nao vira divida", () => {
  const expira = new Date("2026-08-13T10:00:00.000Z");
  assert.equal(restanteMs(expira, new Date("2026-08-13T09:00:00.000Z")), 3_600_000);
  assert.equal(restanteMs(expira, new Date("2026-08-14T10:00:00.000Z")), 0);
});

test("statusEfetivo: so 'ativa' envelhece; o instante empatado ja morreu", () => {
  const expira = new Date("2026-08-13T10:00:00.000Z");
  const antes = new Date("2026-08-13T09:59:59.999Z");
  const exato = new Date("2026-08-13T10:00:00.000Z");
  const depois = new Date("2026-08-13T10:00:00.001Z");

  assert.equal(statusEfetivo("ativa", expira, antes), "ativa");
  assert.equal(statusEfetivo("ativa", expira, exato), "expirada");
  assert.equal(statusEfetivo("ativa", expira, depois), "expirada");
});

test("statusEfetivo: o relogio nao desfaz ato de ninguem", () => {
  const expira = new Date("2026-08-13T10:00:00.000Z");
  const muitoDepois = new Date("2027-01-01T00:00:00.000Z");

  assert.equal(statusEfetivo("aceita", expira, muitoDepois), "aceita");
  assert.equal(statusEfetivo("aceita_parcial", expira, muitoDepois), "aceita_parcial");
  assert.equal(statusEfetivo("retirada", expira, muitoDepois), "retirada");
  assert.equal(statusEfetivo("expirada", expira, muitoDepois), "expirada");
});

// ---------------------------------------------------------------------------
// 4. NOMES
// ---------------------------------------------------------------------------

test("kill-switch: nome exato da ordem, e nasce desarmado", () => {
  assert.equal(ENV_KILL_SWITCH, "FIDC_OFERTAS");

  const antes = process.env[ENV_KILL_SWITCH];
  try {
    delete process.env[ENV_KILL_SWITCH];
    assert.equal(ofertasLigado(), false, "ausente = desarmado");

    process.env[ENV_KILL_SWITCH] = "";
    assert.equal(ofertasLigado(), false);

    process.env[ENV_KILL_SWITCH] = "true";
    assert.equal(ofertasLigado(), false, "so a palavra 'on' arma");

    process.env[ENV_KILL_SWITCH] = "on";
    assert.equal(ofertasLigado(), true);
  } finally {
    if (antes === undefined) delete process.env[ENV_KILL_SWITCH];
    else process.env[ENV_KILL_SWITCH] = antes;
  }
});

// ---------------------------------------------------------------------------
// 5. COMISSAO DA CASA (decisao de Emerson, 13/08/2026)
// ---------------------------------------------------------------------------

test("comissao: 3,5% do credito, e metade dos 7% do caminho da vitrine", () => {
  assert.equal(COMISSAO_FUNDO_PCT, 3.5);
  // A proporcao e o argumento da decisao, entao fica fixada: os 7% do
  // marketplace de contempladas vivem em analista-grupos/route.ts como
  // `credito * 0.07`. Se um dia alguem mexer no 3,5 sem mexer no 7, este
  // teste cai e a conversa acontece antes do commit, nao depois da fatura.
  assert.equal(COMISSAO_FUNDO_PCT * 2, 7);

  assert.equal(comissaoFundo(100_000), 3_500);
  assert.equal(comissaoFundo(428_036_434.53), 14_981_275.21);
});

test("comissao: sem base utilizavel devolve null, nunca zero", () => {
  assert.equal(comissaoFundo(0), null, "credito zero e ausencia, nao R$ 0,00");
  assert.equal(comissaoFundo(-1), null);
  assert.equal(comissaoFundo(Number.NaN), null);
  assert.equal(comissaoFundo(Number.POSITIVE_INFINITY), null);
});

test("comissao: nao varia com o percentual ofertado", () => {
  // A comissao e sobre o CREDITO, nao sobre a oferta. No piso e no teto ela e
  // o mesmo numero — e e por isso que `comissaoFundo` nao aceita `pct`.
  const credito = 250_000;
  assert.equal(comissaoFundo(credito), 8_750);
  assert.notEqual(valorOfertado(credito, OFERTA_PISO_PCT), valorOfertado(credito, OFERTA_TETO_PCT));
});

test("comissao: pesa 17,5% da oferta no piso e 10% no teto", () => {
  // A nota de proporcao do cabecalho, fixada. Como comissao e oferta dividem a
  // mesma base, a razao e 3,5/pct e independe do valor do credito: quanto mais
  // barato o fundo compra, mais pesada ela fica sobre o dinheiro que anda.
  // A tolerancia e 1e-6, e nao zero, porque as duas pontas sao arredondadas a
  // centavo ANTES da divisao. Em 517.333,31 a comissao vai de 18.106,66585 para
  // 18.106,67 e a razao sai de 0,175 por ~4,3e-8. Conferido na mao: a primeira
  // versao deste teste usava 1e-9 e reprovava a aritmetica correta.
  for (const credito of [100_000, 517_333.31, 2_000_000]) {
    const c = comissaoFundo(credito)!;
    const noPiso = valorOfertado(credito, OFERTA_PISO_PCT)!;
    const noTeto = valorOfertado(credito, OFERTA_TETO_PCT)!;
    assert.ok(Math.abs(c / noPiso - 0.175) < 1e-6, `piso, credito ${credito}`);
    assert.ok(Math.abs(c / noTeto - 0.10) < 1e-6, `teto, credito ${credito}`);
  }
});

test("lote: NAO soma nem subtrai comissao enquanto a incidencia nao for decidida", () => {
  // O total e o numero que o fundo aprova na tela. Ate Emerson dizer se a
  // comissao sai do meio ou entra por cima, somar ou subtrair aqui seria
  // exibir um valor que a ordem nao autoriza. Este teste existe para que a
  // mudanca, quando vier, seja deliberada — e nao apareca de carona.
  assert.equal(COMISSAO_FUNDO_INCIDENCIA_DECIDIDA, false);

  const lote = montarLote(
    [
      { id: "a", valorCredito: 100_000 },
      { id: "b", valorCredito: 200_000 },
    ],
    OFERTA_PISO_PCT,
  );
  assert.equal(lote.total, 60_000, "20% de 300.000, sem comissao embutida");
  assert.equal(lote.itens[0].valorOfertado, 20_000);
  assert.equal(lote.itens[1].valorOfertado, 40_000);
});
