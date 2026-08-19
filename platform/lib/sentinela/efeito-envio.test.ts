// ============================================================================
// Teste de lib/sentinela/efeito-envio.ts — "falha não gasta toque".
// ----------------------------------------------------------------------------
// A PERGUNTA DO EMERSON, 19/08/2026:
//
//   "As 30 falhas QUEIMARAM toque? max_toques=1 está ativo nos antigos — se o
//    contador incrementa no envio_falha em vez de só no sucesso, as 27 pessoas
//    nunca mais seriam tocadas."
//
// A medição respondeu NÃO (0 de 15 com toque gasto). Este arquivo é o que
// impede a resposta de mudar sem ninguém notar.
//
// O DEFEITO QUE ELE PRENDE é assimétrico, e por isso perigoso: escrever
// `tentativas` no caminho de falha não produz erro, não produz alerta, não
// produz linha vermelha em lugar nenhum. Produz uma fila que encolhe. Com
// `max_toques = 1` — que é o valor real das 20 linhas em `aguardando_template`
// — basta UM incremento indevido para `tentativas < max_toques` virar falso
// para sempre e a pessoa sumir da `sentinela_a_tocar`. Ninguém percebe uma
// pessoa que não recebeu.
//
// TESTE DE MUTAÇÃO, declarado: se alguém trocar `patch: null` do caminho de
// falha por qualquer patch que contenha `tentativas`, o bloco FALHA abaixo
// quebra. Conferido rodando com a mutação antes de escrever isto.
//
// CONTROLE em todo bloco: o caminho de sucesso GRAVA o toque. Uma
// implementação que devolvesse `patch: null` sempre passaria em "falha não
// gasta toque" e deixaria o Sentinela reenviando a mesma mensagem para sempre.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";

import { efeitoDoEnvio } from "@/lib/sentinela/efeito-envio";

const AGORA = new Date("2026-08-19T15:00:00.000Z");
const ESPACAMENTO = 72 * 60 * 60 * 1000;

const efeito = (envio: Parameters<typeof efeitoDoEnvio>[0]["envio"], toque = 1) =>
  efeitoDoEnvio({ envio, toque, agora: AGORA, espacamentoMs: ESPACAMENTO });

// ---------------------------------------------------------------------------
// FALHA — a guarda
// ---------------------------------------------------------------------------

test("FALHA: #132001 NÃO escreve nada na linha — patch é null, não patch vazio", () => {
  /* Este é o erro literal que a Meta devolveu 75 vezes. `patch: null` é a
   * ausência de escrita; um `{}` faria a rota disparar um update inútil e,
   * pior, abriria a porta para alguém "só acrescentar um campinho" depois. */
  const e = efeito({ ok: false, erro: "Template name does not exist in the translation" });
  assert.equal(e.patch, null);
  assert.equal(e.contador, "falhas");
  assert.equal(e.log.acao, "envio_falha");
});

test("FALHA: o toque NÃO aparece em lugar nenhum do efeito de falha", () => {
  /* A asserção que morre sob a mutação. Não basta olhar `patch`: se um dia o
   * efeito ganhar outro caminho de escrita, é aqui que a rede pega. */
  const e = efeito({ ok: false, erro: "timeout_graph_api(15000ms)" }, 1);
  assert.equal(e.patch, null);
  assert.equal(JSON.stringify(e).includes("tentativas"), false);
  assert.equal(JSON.stringify(e).includes("ultimo_envio_em"), false);
});

test("FALHA: transitória e permanente têm o MESMO efeito sobre a linha", () => {
  /* Deliberado. Distinguir exigiria interpretar a mensagem de erro da Meta, e
   * errar para o lado "permanente" mataria a linha. A repetição no
   * sentinela_log é o sinal — é o que o vigia do Radar lê. */
  const permanente = efeito({ ok: false, erro: "#132001" });
  const transitoria = efeito({ ok: false, erro: "timeout" });
  assert.equal(permanente.patch, null);
  assert.equal(transitoria.patch, null);
  assert.equal(permanente.contador, transitoria.contador);
});

test("FALHA: erro ausente vira motivo nomeado, não undefined no log", () => {
  // Log com `erro: undefined` some no jsonb e o vigia perde a contagem.
  const e = efeito({ ok: false });
  assert.equal(e.log.detalhe.erro, "erro_desconhecido");
});

// ---------------------------------------------------------------------------
// SUCESSO — o CONTROLE (sem ele, uma guarda que recusa tudo passa)
// ---------------------------------------------------------------------------

test("SUCESSO: grava o toque, o status e o próximo toque — os três juntos", () => {
  /* Gravar `tentativas` sem gravar `proximo_toque_em` faria a pessoa ser
   * reencontrada no ciclo seguinte já com o toque gasto — que é o mesmo
   * estrago da falha que incrementa, por outro caminho. */
  const e = efeito({ ok: true, waMessageId: "wamid.ABC" }, 1);
  assert.equal(e.contador, "feitos");
  assert.deepEqual(e.patch, {
    status: "enviado",
    tentativas: 1,
    ultimo_envio_em: "2026-08-19T15:00:00.000Z",
    proximo_toque_em: "2026-08-22T15:00:00.000Z", // +72h, conferido na mão
  });
  assert.equal(e.log.acao, "envio_ok");
  assert.equal(e.log.detalhe.waMessageId, "wamid.ABC");
  assert.equal(e.log.detalhe.toque, 1);
});

test("SUCESSO: o toque gravado é o RECEBIDO, não um incremento local", () => {
  // A varredura calcula `tentativas + 1` e passa pronto. Se este módulo
  // resolvesse incrementar por conta, o segundo toque viraria o terceiro.
  const e = efeito({ ok: true, waMessageId: "wamid.X" }, 2);
  assert.equal(e.patch?.tentativas, 2);
});

test("SUCESSO: sem waMessageId o log grava null, não undefined", () => {
  const e = efeito({ ok: true }, 1);
  assert.equal(e.log.detalhe.waMessageId, null);
});

// ---------------------------------------------------------------------------
// OPT-OUT — terminal, e não é falha nossa
// ---------------------------------------------------------------------------

test("OPT-OUT: exclui a linha e NÃO conta como falha", () => {
  /* Contar opt-out como falha inflaria o contador que o vigia do Radar lê, e
   * o alerta de "envio quebrado" passaria a disparar por gente que só pediu
   * para sair — alerta que mente é alerta que ninguém lê. */
  const e = efeito({ ok: false, erro: "opt_out" });
  assert.equal(e.contador, "pulados");
  assert.deepEqual(e.patch, { status: "excluido" });
  assert.equal(e.log.acao, "parada_opt_out");
});

test("OPT-OUT: não gasta toque tampouco — a pessoa saiu, não foi tocada", () => {
  const e = efeito({ ok: false, erro: "opt_out" }, 1);
  assert.equal("tentativas" in (e.patch ?? {}), false);
});
