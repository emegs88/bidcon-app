// ============================================================================
// opt-out.test.ts — a saída do cliente, travada por literal
// ----------------------------------------------------------------------------
// PARA QUE ESTE TESTE EXISTE. Este é o único ponto do sistema onde o defeito
// não aparece em tela nenhuma, não gera erro, não entra em log de falha — e
// custa uma DENÚNCIA na Meta. O cliente toca em "sair", a mensagem some da
// tela dele, e ele continua na fila. Do lado de cá está tudo verde.
//
// O DEFEITO QUE ELE FECHA É REAL E FOI MEU. Em 15/08/2026 eu propus para o
// template de reativação um botão intitulado "Não quero mais". A regra casa
// botão por IGUALDADE EXATA com "não quero receber" — o botão não gravaria
// nada. O caso `botão "Não quero mais" NÃO é opt-out` abaixo não é hipótese
// didática: é a proposta reprovada, congelada aqui para que a próxima pessoa
// que inventar um título novo descubra pela suíte, e não pelo cliente.
//
// AS FIXTURES DE PRODUÇÃO são as duas pontas medidas em xtv:
//   - 06/08/2026 15:58 — quick reply "Não quero receber" após o template
//     bidcon_vitrine_cartas_v2 → wa_conversas.opt_out virou true. FUNCIONA.
//   - 16/07/2026 15:19 e 20:04 — o mesmo texto, opt_out ficou false, porque
//     naquele momento a regra ainda não olhava botão (corrigido em e8c9ac3).
//
// O QUE ELE **NÃO** PROVA: não prova que o webhook GRAVA no banco, nem que a
// Meta manda o campo com esse nome. Isso é integração, e a prova dela é a
// linha de produção de 06/08 citada acima.
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TEXTO_BOTAO_OPT_OUT,
  PALAVRAS_OPT_OUT,
  normalizarTexto,
  ehTextoOptOut,
  ehBotaoOptOut,
  ehOptOut,
} from "./opt-out";

// ----------------------------------------------------------------------------
// O LITERAL. Se esta linha quebrar, alguém renomeou o botão — e TODO template
// já cadastrado na Meta com o título antigo parou de desligar o canal.
// ----------------------------------------------------------------------------
test("o literal do botão é exatamente o cadastrado na Meta", () => {
  assert.equal(TEXTO_BOTAO_OPT_OUT, "não quero receber");
  // Já vem normalizado: comparar o literal consigo mesmo não pode mudá-lo.
  assert.equal(normalizarTexto(TEXTO_BOTAO_OPT_OUT), TEXTO_BOTAO_OPT_OUT);
});

test("a lista de palavras livres é a acordada, sem sobra e sem falta", () => {
  assert.deepEqual(
    [...PALAVRAS_OPT_OUT].sort(),
    [
      "descadastrar",
      "nao quero receber",
      "não quero receber",
      "parar",
      "pare",
      "sair",
      "stop",
    ].sort()
  );
  // "cancelar" fica FORA de propósito: colide com cancelamento de reserva no
  // meio do fluxo. Se alguém incluir, esta linha cai.
  assert.equal(PALAVRAS_OPT_OUT.has("cancelar"), false);
});

// ----------------------------------------------------------------------------
// NORMALIZAÇÃO — o que ela conserta e o que ela deliberadamente NÃO conserta.
// ----------------------------------------------------------------------------
test("normalizarTexto tira caixa, espaço e pontuação das pontas", () => {
  for (const cru of [
    "Não quero receber",
    "  não quero receber  ",
    "NÃO QUERO RECEBER",
    "Não quero receber.",
    "não quero receber!!!",
    "\u201cNão quero receber\u201d", // aspas curvas do teclado de celular
    "'não quero receber',",
  ]) {
    assert.equal(normalizarTexto(cru), TEXTO_BOTAO_OPT_OUT, `falhou em ${JSON.stringify(cru)}`);
  }
});

test("normalizarTexto NÃO remove acento — por isso a variante sem acento é explícita", () => {
  assert.equal(normalizarTexto("Nao quero receber"), "nao quero receber");
  assert.notEqual(normalizarTexto("Nao quero receber"), TEXTO_BOTAO_OPT_OUT);
  // E é justamente por isso que ela precisa estar na lista à mão:
  assert.equal(ehTextoOptOut("Nao quero receber"), true);
});

test("normalizarTexto não mexe no meio da frase", () => {
  assert.equal(normalizarTexto("quero sair do consórcio"), "quero sair do consórcio");
});

// ----------------------------------------------------------------------------
// TEXTO LIVRE — a lista larga vale aqui, e só aqui.
// ----------------------------------------------------------------------------
test("texto livre: as palavras universais de descadastro contam", () => {
  for (const t of ["sair", "SAIR", " Parar. ", "pare", "stop", "descadastrar"]) {
    assert.equal(ehTextoOptOut(t), true, `deveria sair: ${JSON.stringify(t)}`);
  }
});

test("texto livre: só vale a mensagem INTEIRA — frase longa não é opt-out", () => {
  // O falso positivo que a regra da mensagem inteira zera: quem pergunta como
  // sair do consórcio está pedindo informação, não descadastro.
  assert.equal(ehTextoOptOut("quero sair do consórcio"), false);
  assert.equal(ehTextoOptOut("como faço para parar de pagar?"), false);
  assert.equal(ehTextoOptOut("não quero receber cartas de imóvel, só de veículo"), false);
});

test("texto livre: vazio, nulo e indefinido não são opt-out", () => {
  assert.equal(ehTextoOptOut(""), false);
  assert.equal(ehTextoOptOut(null), false);
  assert.equal(ehTextoOptOut(undefined), false);
});

// ----------------------------------------------------------------------------
// BOTÃO — igualdade exata, e é de propósito.
// ----------------------------------------------------------------------------
test("botão: o literal certo sai (fixture de produção, 06/08/2026)", () => {
  assert.equal(ehBotaoOptOut("Não quero receber"), true);
});

test('botão "Não quero mais" NÃO é opt-out — a proposta reprovada de 15/08', () => {
  // Se um dia isto passar a devolver true, foi porque alguém alargou a regra
  // de botão. Aí o comentário do lib/opt-out.ts precisa mudar junto.
  assert.equal(ehBotaoOptOut("Não quero mais"), false);
  assert.equal(ehOptOut({ botoes: ["Não quero mais"] }), false);
});

test("botão: a lista larga NÃO vale para botão", () => {
  // Título de botão é escolhido por nós; aceitar "sair"/"parar" aqui deixaria
  // um botão de outro template desligar o canal sem querer.
  for (const t of ["sair", "parar", "stop", "descadastrar"]) {
    assert.equal(ehBotaoOptOut(t), false, `botão não deveria sair: ${JSON.stringify(t)}`);
  }
});

test("botão: título nulo/vazio não é opt-out", () => {
  assert.equal(ehBotaoOptOut(null), false);
  assert.equal(ehBotaoOptOut(undefined), false);
  assert.equal(ehBotaoOptOut(""), false);
});

// ----------------------------------------------------------------------------
// AS TRÊS FORMAS DE CHEGADA — o de-para que o Route Handler faz.
// ----------------------------------------------------------------------------
test("forma 1: quick reply de TEMPLATE (button.text)", () => {
  assert.equal(ehOptOut({ botoes: ["Não quero receber", undefined] }), true);
});

test("forma 2: quick reply de INTERATIVA (interactive.button_reply.title)", () => {
  assert.equal(ehOptOut({ botoes: [undefined, "Não quero receber"] }), true);
});

test("forma 3: texto digitado (text.body)", () => {
  assert.equal(ehOptOut({ botoes: [undefined, undefined], texto: "sair" }), true);
});

test("mensagem que não é nada disso não é opt-out", () => {
  assert.equal(
    ehOptOut({ botoes: ["Quero retomar", undefined], texto: undefined }),
    false
  );
  assert.equal(ehOptOut({}), false);
});

test("botão vence texto: quem toca o botão sai, mesmo com legenda qualquer", () => {
  assert.equal(
    ehOptOut({ botoes: ["Não quero receber"], texto: "oi, tudo bem?" }),
    true
  );
});

// ----------------------------------------------------------------------------
// O TEMPLATE DA SENTINELA — os dois botões propostos, congelados.
// ----------------------------------------------------------------------------
test("sentinela_retomada_01: o botão de saída sai e o de retomada não", () => {
  assert.equal(ehOptOut({ botoes: ["Não quero receber"] }), true);
  assert.equal(ehOptOut({ botoes: ["Quero retomar"] }), false);
});
