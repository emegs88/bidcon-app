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
// 2. DINHEIRO. O total de um lote tem de ser a soma exata do que cada vendedor
//    recebe. Centavo que não fecha é centavo que alguém vai ter de explicar.
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
  ENV_KILL_SWITCH,
  JANELA_OFERTA_HORAS,
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
    "'desconto' e proibida; a ordem manda usar 'desagio'"
  );
  assert.ok(
    !lista.includes("desagio") && !lista.includes("deságio"),
    "'desagio' precisa continuar permitida — e a palavra do produto"
  );
});

test("lexico: os motivos de descarte podem ir para a tela", () => {
  const lote = montarLote(
    [
      { id: "a", valorBase: null },
      { id: "b", valorBase: Number.NaN },
    ],
    10
  );
  assert.equal(lote.descartadas.length, 2);
  for (const d of lote.descartadas) {
    const r = garantirLexico(d.motivo);
    assert.equal(r.ok, true, `motivo reprovado no lexico: ${d.motivo}`);
  }
});

// ---------------------------------------------------------------------------
// 2. DINHEIRO
// ---------------------------------------------------------------------------

test("valorOfertado: desagio simples, arredondado a centavos", () => {
  assert.equal(valorOfertado(100_000, 10), 90_000);
  assert.equal(valorOfertado(125_303.66, 12.5), 109_640.7);
});

test("valorOfertado: recusa entrada que nao permite resposta honesta", () => {
  assert.equal(valorOfertado(100, 0), null, "desagio 0 nao e oferta");
  assert.equal(valorOfertado(100, 100), null, "desagio 100% zeraria a carta");
  assert.equal(valorOfertado(100, -5), null);
  assert.equal(valorOfertado(-1, 10), null);
  assert.equal(valorOfertado(Number.NaN, 10), null);
  assert.equal(valorOfertado(100, Number.POSITIVE_INFINITY), null);
});

test("montarLote: o total e a soma dos itens JA arredondados", () => {
  // NAO afirmo que estes numeros fazem as duas ordens de arredondamento
  // divergirem — nao medi isso, e forjar uma divergencia em ponto flutuante e
  // mais facil de errar do que de acertar. O que este teste fixa e a INVARIANTE
  // que importa em qualquer entrada: o total e exatamente a soma do que os
  // vendedores recebem.
  const cartas = [
    { id: "a", valorBase: 33.33 },
    { id: "b", valorBase: 33.33 },
    { id: "c", valorBase: 33.33 },
  ];
  const lote = montarLote(cartas, 15);

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

test("montarLote: carta sem base sai da lista nomeada, nao vira oferta de zero", () => {
  const lote = montarLote(
    [
      { id: "boa", valorBase: 200_000 },
      { id: "sem-base", valorBase: null },
    ],
    20
  );
  assert.equal(lote.itens.length, 1);
  assert.equal(lote.itens[0].cartaId, "boa");
  assert.equal(lote.itens[0].valorOfertado, 160_000);
  assert.deepEqual(lote.descartadas, [
    { cartaId: "sem-base", motivo: "sem valor de base" },
  ]);
  assert.ok(
    !lote.itens.some((i) => i.valorOfertado === 0),
    "nenhuma carta pode virar oferta de R$ 0 por falta de dado"
  );
});

test("montarLote: desagio invalido descarta tudo, e o total e zero com lista vazia", () => {
  const lote = montarLote([{ id: "a", valorBase: 100 }], 0);
  assert.equal(lote.itens.length, 0);
  assert.equal(lote.total, 0);
  assert.equal(lote.descartadas.length, 1);
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
