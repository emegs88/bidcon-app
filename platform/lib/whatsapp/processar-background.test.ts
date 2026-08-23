// ============================================================================
// HANDOFF-01, item (a) — o kill-switch HANDOFF_ATIVO.
// ----------------------------------------------------------------------------
// POR QUE ESTE ARQUIVO EXISTE, EM UMA FRASE: `handoffAtivoLigado` INVERTE a
// doutrina de kill-switch desta casa (nascer desarmado, como
// `process.env.FAROL_SABER === "on"` em lib/farol/saber.ts:74), e inversão
// declarada sem teste é só inversão. Aqui fica a prova de que ele inverte
// exatamente onde eu disse — e NÃO MAIS QUE ISSO.
//
// O que está em jogo nos dois lados:
//   · se a comparação afrouxar (ex.: virar `!== "off"` sobre valor minúsculo,
//     ou passar a aceitar "0"/"false"), o botão de desligar deixa de existir
//     para quem o configurou com uma dessas grafias, e o agente novo abre a
//     boca numa conversa onde alguém já mandou calar;
//   · se apertar demais (ex.: exigir "on" para ligar), a correção sobe
//     desarmada e não corrige nada — que é precisamente o destino medido de
//     PROSPERITO_SEM_ENTRADA, até hoje na fila esperando alguém armá-lo.
//
// Só a peça PURA é testada; `abrirComAgenteNovo` depende de Supabase, Anthropic
// e Graph API e fica coberta pelo smoke test manual pós-deploy — mesma doutrina
// já escrita no cabeçalho de cerebro.test.ts.
// ============================================================================

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { handoffAtivoLigado } from "./processar-background";

const ORIGINAL = process.env.HANDOFF_ATIVO;

/** Devolve o processo ao estado em que ele chegou. Um teste que vaza env
 *  contamina os 1000+ que rodam depois no mesmo processo. */
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.HANDOFF_ATIVO;
  else process.env.HANDOFF_ATIVO = ORIGINAL;
});

test("KILL-SWITCH — env AUSENTE liga (é o desvio declarado: nasce armado)", () => {
  delete process.env.HANDOFF_ATIVO;
  assert.equal(handoffAtivoLigado(), true);
});

test("KILL-SWITCH — a string literal 'off' DESLIGA (o botão precisa existir)", () => {
  process.env.HANDOFF_ATIVO = "off";
  assert.equal(handoffAtivoLigado(), false);
});

test("KILL-SWITCH — 'off' é a ÚNICA grafia que desliga", () => {
  // Estas quatro parecem desligar e não desligam. Estão aqui em vez de num
  // comentário porque a diferença é operacional: quem digitar uma delas achando
  // que calou o agente precisa que o teste diga, em texto, que não calou.
  for (const valor of ["OFF", "Off", "0", "false"]) {
    process.env.HANDOFF_ATIVO = valor;
    assert.equal(
      handoffAtivoLigado(),
      true,
      `"${valor}" desligou — a comparação afrouxou e o operador vai ser enganado por ela`
    );
  }
});

test("KILL-SWITCH — vazio NÃO desliga (env exportada sem valor é acidente comum)", () => {
  process.env.HANDOFF_ATIVO = "";
  assert.equal(handoffAtivoLigado(), true);
});

test("KILL-SWITCH — 'off' com espaço em volta NÃO desliga (não há aparo escondido)", () => {
  // Sem trim de propósito, e o teste fixa isso: um `.trim()` silencioso aqui
  // faria a mesma env valer coisas diferentes conforme quem a colou.
  process.env.HANDOFF_ATIVO = " off ";
  assert.equal(handoffAtivoLigado(), true);
});

test("KILL-SWITCH — CONTROLE: o teste consegue mesmo mexer no valor lido", () => {
  // Regra 9. Sem esta linha, um `handoffAtivoLigado` que devolvesse `true` fixo
  // — ignorando a env por completo — passaria em todos os testes acima, e a
  // suíte inteira viraria enfeite.
  process.env.HANDOFF_ATIVO = "off";
  const desligado = handoffAtivoLigado();
  delete process.env.HANDOFF_ATIVO;
  const ligado = handoffAtivoLigado();
  assert.notEqual(desligado, ligado, "a função não está lendo a env de verdade");
});
