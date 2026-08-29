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

import { handoffAtivoLigado, mereceRede } from "./processar-background";
import {
  MARCA_AUDIO_RECEBIDO,
  PREFIXO_TRANSCRICAO,
  placeholderDoTipo,
} from "./tipos";

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

// ============================================================================
// OUVIDO-01 v2 (e) — A REDE: quem cai nela e, principalmente, quem NÃO cai.
// ----------------------------------------------------------------------------
// A ordem pede controle dos dois lados. Um teste que só mostra figurinha caindo
// na rede não prova rede nenhuma: prova que existe um galho. O que precisa
// doer aqui é o lado oposto — texto normal do cliente NÃO pode cair, ou o bot
// passa a responder "Consegues me escrever em texto?" a quem escreveu texto.
// Esse defeito seria muito pior que o que esta fatia conserta, porque atinge
// TODO cliente em vez dos poucos que mandam áudio.
// ============================================================================

test("REDE — figurinha cai (é o caso nomeado na ordem)", () => {
  // Uso `placeholderDoTipo` em vez da string literal de propósito: se alguém
  // trocar o texto da marca lá e esquecer daqui, o teste continua medindo a
  // marca DE VERDADE em vez de uma cópia que envelheceu em silêncio.
  const marca = placeholderDoTipo("sticker");
  assert.ok(marca, "a figurinha precisa ter marca, senão o teste não mede nada");
  assert.equal(mereceRede(marca, false), true);
});

test("REDE — vídeo, localização e áudio-que-não-transcreveu caem também", () => {
  for (const tipo of ["video", "location"] as const) {
    const marca = placeholderDoTipo(tipo);
    assert.ok(marca, `${tipo} precisa ter marca`);
    assert.equal(mereceRede(marca, false), true, `${tipo} tinha de cair na rede`);
  }
  // O áudio que chegou e não virou texto: a linha ficou com a marca do webhook
  // porque o Whisper não respondeu, ou estourou o teto, ou veio silêncio.
  assert.equal(mereceRede(MARCA_AUDIO_RECEBIDO, false), true);
});

test("REDE — conteúdo vazio e só-espaço caem (o turno mudo que abriu a fatia)", () => {
  for (const vazio of ["", "   ", "\n\t "]) {
    assert.equal(mereceRede(vazio, false), true, `"${vazio}" tinha de cair na rede`);
  }
});

test("CONTROLE — texto normal do cliente NÃO cai na rede", () => {
  // Este é o lado que dói. Sem ele, um `mereceRede` que devolvesse `true` fixo
  // passaria em todos os testes acima e mandaria o fallback para todo mundo.
  for (const texto of [
    "quero vender minha cota",
    "oi",
    "170500",
    "[anexo sem nome/legenda]", // marca NOSSA, mas legível — decisão da fatia
  ]) {
    assert.equal(mereceRede(texto, false), false, `"${texto}" NÃO podia cair na rede`);
  }
});

test("CONTROLE — áudio TRANSCRITO segue o fluxo normal, não a rede", () => {
  // O caso feliz inteiro da fatia: transcreveu, logo é fala do cliente, logo o
  // agente responde como responderia a texto. Se isto caísse na rede, a
  // transcrição teria sido paga e jogada fora no passo seguinte.
  const transcrito = `${PREFIXO_TRANSCRICAO} quero vender minha cota da Servopa`;
  assert.equal(mereceRede(transcrito, false), false);
});

test("REGRA 19 — `undefined` é 'não sei', e 'não sei' NÃO manda rede", () => {
  // O webhook do Instagram monta WaJob sem `conteudo`. Se "não sei" virasse
  // "veio vazio", TODA mensagem do Instagram — inclusive texto perfeito —
  // receberia "Consegues me escrever em texto?".
  assert.equal(mereceRede(undefined, false), false);
  // E o controle do outro lado: string vazia É fato medido, e essa cai.
  assert.notEqual(
    mereceRede(undefined, false),
    mereceRede("", false),
    "'não sei' e 'veio vazio' viraram o mesmo registro — é o achatamento que a Regra 19 proíbe"
  );
});

test("quem JÁ recebeu resposta neste job não recebe a rede em cima", () => {
  // O aviso do extrato já saiu. Somar o fallback seria o bot falando duas vezes
  // sobre a mesma mensagem, sendo que a primeira fala deu certo.
  assert.equal(mereceRede(MARCA_AUDIO_RECEBIDO, true), false);
  assert.equal(mereceRede("", true), false);
});

test("CONTROLE — `jaRespondeu` muda mesmo a resposta (a flag não é enfeite)", () => {
  // Regra 9: sem isto, um `mereceRede` que ignorasse o segundo argumento
  // passaria no teste acima por acidente, já que ambos esperam `false`.
  assert.notEqual(
    mereceRede(MARCA_AUDIO_RECEBIDO, false),
    mereceRede(MARCA_AUDIO_RECEBIDO, true),
    "o argumento `jaRespondeu` não está sendo lido"
  );
});
