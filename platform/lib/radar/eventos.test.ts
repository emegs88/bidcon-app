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

import {
  amostraDe,
  divergenciasDe,
  fonteDe,
  lerDetalhe,
  numeroDe,
  quarentenaPorCarta,
  saudeSyncDe,
} from "@/lib/radar/eventos";

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

// ===========================================================================
// SAUDE DO SYNC — a metade da frase que acusa alguem.
// ---------------------------------------------------------------------------
// Sem estes dois campos, o vigia de movimento so consegue dizer "nada entrou".
// Com eles, ele diz "o sync se declarou SAUDAVEL e mesmo assim nada entrou",
// que e a condicao inteira: o sistema passando no proprio exame enquanto para
// de fazer o trabalho.
// ===========================================================================

/** Copiado de eventos_sync, tipo='sync_fim', 16/08/2026. */
const SYNC_FIM = "total_ms=22736 fontes_ok=5 fontes_falha=0";

test("saudeSyncDe: le a gramatica medida do sync_fim", () => {
  const s = saudeSyncDe(SYNC_FIM);
  assert.equal(s.fontesOk, 5);
  assert.equal(s.fontesFalha, 0);
});

test("saudeSyncDe: fonte falhando aparece, e e o que cala o vigia de movimento", () => {
  const s = saudeSyncDe("total_ms=31002 fontes_ok=4 fontes_falha=1");
  assert.equal(s.fontesOk, 4);
  assert.equal(s.fontesFalha, 1);
});

// A DISTINCAO QUE SUSTENTA O VIGIA, e ela e a razao de a funcao existir em vez
// de um `Number(...) || 0` na rota.
//
// `fontes_falha` AUSENTE significa "nao sei se alguma falhou".
// `fontes_falha=0` significa "nenhuma falhou".
//
// Quem tratar o primeiro como o segundo deixa o vigia afirmar que o sync estava
// saudavel num ciclo sobre o qual ele nao mediu nada — e alarmar sobre uma
// suposicao e como o RADAR comeca a mentir.
test("saudeSyncDe: campo ausente e null, nunca zero", () => {
  const s = saudeSyncDe("total_ms=22736");
  assert.equal(s.fontesOk, null, "ausente nao pode virar 'zero fontes ok'");
  assert.equal(s.fontesFalha, null, "ausente nao pode virar 'nenhuma falhou'");
});

test("saudeSyncDe: string vazia, nula ou sem pares nao inventa numero", () => {
  for (const lixo of [null, undefined, "", "   ", "sync terminou sem detalhe"]) {
    const s = saudeSyncDe(lixo as never);
    assert.equal(s.fontesOk, null, `fontesOk de ${JSON.stringify(lixo)}`);
    assert.equal(s.fontesFalha, null, `fontesFalha de ${JSON.stringify(lixo)}`);
  }
});

test("saudeSyncDe: valor nao numerico e null, nao NaN", () => {
  // NaN comparado a qualquer limiar e falso: o vigia calaria em silencio, que e
  // a falha pior — ninguem descobre que o alarme parou.
  const s = saudeSyncDe("fontes_ok=cinco fontes_falha=");
  assert.equal(s.fontesOk, null);
  assert.equal(s.fontesFalha, null);
});

// ===========================================================================
// QUARENTENA — 4 contra 95
// ---------------------------------------------------------------------------
// Estes testes existem para uma frase que ja foi dita em voz alta e estava
// errada: "95 cartas barradas em 24h contra 1 aprovada". Sao QUATRO cartas
// reinserindo uma vez por ciclo. O numero 95 e a contagem de LINHAS.
//
// Cada teste abaixo falha se alguem trocar o campo de identidade de volta.
// ===========================================================================

/**
 * A janela real, medida no xtv em 16/08/2026, reduzida na proporcao exata:
 * quatro cartas (21, 78, 345 da PLAYCONTEMPLADAS e 1182 da PIFFER), cada uma
 * reincidindo ciclo a ciclo. Os textos sao os que o gatilho `sync_aplicar_cotas`
 * monta — e o numero dentro deles e o CREDITO, nao a carta.
 */
function janelaReal(): { numero_externo: number | null; detalhe: string | null }[] {
  const linhas: { numero_externo: number | null; detalhe: string | null }[] = [];
  const cartas: [number, string, number][] = [
    [21, "PLAYCONTEMPLADAS", 18531],
    [78, "PLAYCONTEMPLADAS", 30242],
    [345, "PLAYCONTEMPLADAS", 82515],
    [1182, "PIFFER", 182340],
  ];
  for (const [numero, fonte, credito] of cartas) {
    const ciclos = numero === 1182 ? 23 : 24; // medido: a PIFFER entrou um ciclo depois
    for (let i = 0; i < ciclos; i++) {
      linhas.push({
        numero_externo: numero,
        detalhe: `${fonte} credito ${credito} nasceu indisponivel`,
      });
    }
  }
  return linhas;
}

test("quarentena: 95 linhas viram 4 cartas — nunca 95", () => {
  const eventos = janelaReal();
  assert.equal(eventos.length, 95, "a janela medida tem 95 EVENTOS");

  const porCarta = quarentenaPorCarta(eventos);
  assert.equal(porCarta.size, 4, "e QUATRO cartas — este numero e o que o vigia julga");

  // O par completo, porque e a distancia entre os dois que desfaz o relatorio.
  const somaCiclos = [...porCarta.values()].reduce((a, b) => a + b.ciclos, 0);
  assert.equal(somaCiclos, eventos.length, "nenhuma linha some na agregacao");
});

test("quarentena: os ciclos por carta batem com a medicao", () => {
  const porCarta = quarentenaPorCarta(janelaReal());
  assert.deepEqual(
    [...porCarta.entries()]
      .map(([n, b]) => [n, b.fonte, b.ciclos])
      .sort((a, b) => (a[0] as number) - (b[0] as number)),
    [
      [21, "PLAYCONTEMPLADAS", 24],
      [78, "PLAYCONTEMPLADAS", 24],
      [345, "PLAYCONTEMPLADAS", 24],
      [1182, "PIFFER", 23],
    ]
  );
});

// A ARMADILHA CENTRAL, e o unico teste que importa de verdade aqui.
//
// `carta_id` esta na mesma linha do banco, tem nome de identidade e muda a cada
// ciclo — o sync grava linha nova toda hora. Quem agrupasse por ele devolveria
// uma carta por evento. Este teste reproduz esse engano com numeros e prova que
// a funcao NAO faz isso: ela le `numero_externo`, que e a carta no mundo.
test("quarentena: agrupar por identidade-de-linha daria 95 — e nao e o que acontece", () => {
  const eventos = janelaReal();
  const idsDeLinha = new Set(eventos.map((_, i) => `linha-${i}`));
  assert.equal(idsDeLinha.size, 95, "e assim que se chega no 95: contando linhas");

  const porCarta = quarentenaPorCarta(eventos);
  assert.notEqual(porCarta.size, idsDeLinha.size);
  assert.equal(porCarta.size, 4);
});

// A SEGUNDA ARMADILHA: o numero dentro do texto.
//
// Hoje ele da 4 distintos por coincidencia — as quatro cartas tem creditos
// diferentes. Duas cartas de credito IGUAL colapsariam numa so, e o vigia de
// reincidencia perderia uma carta sem que nada acusasse. Aqui as duas cartas
// tem o mesmo credito de proposito.
test("quarentena: duas cartas de credito igual continuam duas", () => {
  const porCarta = quarentenaPorCarta([
    { numero_externo: 21, detalhe: "PLAYCONTEMPLADAS credito 50000 nasceu indisponivel" },
    { numero_externo: 21, detalhe: "PLAYCONTEMPLADAS credito 50000 nasceu indisponivel" },
    { numero_externo: 78, detalhe: "PLAYCONTEMPLADAS credito 50000 nasceu indisponivel" },
  ]);
  assert.equal(porCarta.size, 2, "o credito e igual; as cartas nao sao");
  assert.equal(porCarta.get(21)?.ciclos, 2);
  assert.equal(porCarta.get(78)?.ciclos, 1);
});

// AUSENCIA DE IDENTIDADE NAO VIRA CARTA ZERO.
//
// `Number(null)` da 0, e uma carta zero fantasma abriria um alerta com chave
// `reincidente:0` que nenhuma carta do mundo fecha. A linha sem identidade e
// DESCARTADA, e a diferenca entre o total e a soma dos ciclos e o que denuncia
// que havia linha assim.
test("quarentena: linha sem numero_externo e descartada, nao vira carta 0", () => {
  const eventos = [
    { numero_externo: 21, detalhe: "PLAYCONTEMPLADAS credito 18531 nasceu indisponivel" },
    { numero_externo: null, detalhe: "PLAYCONTEMPLADAS credito 99999 nasceu indisponivel" },
    { numero_externo: 21, detalhe: "PLAYCONTEMPLADAS credito 18531 nasceu indisponivel" },
  ];
  const porCarta = quarentenaPorCarta(eventos);
  assert.equal(porCarta.size, 1);
  assert.equal(porCarta.has(0), false, "carta 0 abriria alerta que ninguem fecha");
  const somaCiclos = [...porCarta.values()].reduce((a, b) => a + b.ciclos, 0);
  assert.equal(somaCiclos, 2, "3 linhas, 2 com identidade — a diferenca e visivel");
});

test("quarentena: NaN e Infinity tambem sao descartados", () => {
  const porCarta = quarentenaPorCarta([
    { numero_externo: Number.NaN, detalhe: "X credito 1 nasceu indisponivel" },
    { numero_externo: Number.POSITIVE_INFINITY, detalhe: "X credito 2 nasceu indisponivel" },
    { numero_externo: 21, detalhe: "X credito 3 nasceu indisponivel" },
  ]);
  assert.deepEqual([...porCarta.keys()], [21]);
});

// A FONTE E ROTULAGEM, NUNCA JULGAMENTO.
//
// Se o formato do detalhe mudar amanha, o titulo do alerta sai com a fonte
// errada e os NUMEROS continuam certos. E a ordem de importancia correta: o
// vigia decide por ciclos, nao por nome de fonte.
test("quarentena: detalhe ilegivel vira 'desconhecida' e os ciclos sobrevivem", () => {
  const porCarta = quarentenaPorCarta([
    { numero_externo: 345, detalhe: null },
    { numero_externo: 345, detalhe: "   " },
  ]);
  assert.equal(porCarta.get(345)?.fonte, "desconhecida");
  assert.equal(porCarta.get(345)?.ciclos, 2, "o numero que o vigia usa nao depende do rotulo");
});

test("quarentena: a fonte do primeiro evento vence e nao troca no meio", () => {
  const porCarta = quarentenaPorCarta([
    { numero_externo: 1182, detalhe: "PIFFER credito 182340 nasceu indisponivel" },
    { numero_externo: 1182, detalhe: "OUTRAFONTE credito 182340 nasceu indisponivel" },
  ]);
  assert.equal(porCarta.get(1182)?.fonte, "PIFFER");
  assert.equal(porCarta.get(1182)?.ciclos, 2);
});

test("quarentena: janela vazia devolve mapa vazio, nao explode", () => {
  assert.equal(quarentenaPorCarta([]).size, 0);
});
