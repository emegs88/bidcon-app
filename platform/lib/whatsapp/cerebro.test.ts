// ============================================================================
// FATIA 2 (SEGURANCA-01 · F3.1 — Guardrail Prosperito v2) — ITEM 2 (nível 3)
// e ITEM 3 (anti-loop). Runner nativo: `node:test` + `node:assert/strict`
// (mesmo padrão de lib/reserve/reserve.test.ts). Rodar:
//   npx tsx --test lib/whatsapp/cerebro.test.ts
//
// Testa só as peças PURAS (sem I/O) extraídas de gerarRespostaWhatsApp —
// escolherFallbackWa (rotação do Nível 3) e deveEscalarAntiLoop (limiar do
// ITEM 3) — exportadas de cerebro.ts especificamente pra permitir este
// teste sem precisar mockar Supabase/Anthropic/Graph API. A orquestração
// completa (logGuardrail, contarFallbacksRecentes, alertarAdminAntiLoop,
// tentarRegenerarCompliance) depende de rede/banco reais e fica coberta
// pelo smoke test manual pós-deploy (ver checkpoint), não aqui.
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FALLBACK_VARIANTES_WA,
  escolherFallbackWa,
  deveEscalarAntiLoop,
  comAberturaDeHandoff,
  NOTA_ABERTURA_HANDOFF,
  terminaEmUser,
  type MensagemApi,
} from "./cerebro";

// ----------------------------------------------------------------------------
// ITEM 2, Nível 3 — rotação de fallback (nunca repete a mesma frase em rajada,
// que era o próprio sintoma do bug de produção 2026-07-23).
// ----------------------------------------------------------------------------
test("Nível 3 · escolherFallbackWa — rotaciona pelas 3 variantes, sem repetir em sequência", () => {
  assert.equal(escolherFallbackWa(0), FALLBACK_VARIANTES_WA[0]);
  assert.equal(escolherFallbackWa(1), FALLBACK_VARIANTES_WA[1]);
  assert.equal(escolherFallbackWa(2), FALLBACK_VARIANTES_WA[2]);
  // dá a volta (4ª ocorrência na mesma janela) sem quebrar — nunca undefined.
  assert.equal(escolherFallbackWa(3), FALLBACK_VARIANTES_WA[0]);
  assert.equal(escolherFallbackWa(4), FALLBACK_VARIANTES_WA[1]);
});

test("Nível 3 · escolherFallbackWa — nunca devolve string vazia/undefined pra nenhum índice razoável", () => {
  for (let i = 0; i < 20; i++) {
    const r = escolherFallbackWa(i);
    assert.ok(typeof r === "string" && r.length > 0, `índice ${i} devolveu valor inválido`);
  }
});

test("FALLBACK_VARIANTES_WA — tem pelo menos 2 variantes distintas (senão não seria rotação)", () => {
  const unicos = new Set(FALLBACK_VARIANTES_WA);
  assert.ok(unicos.size >= 2, "precisa de pelo menos 2 frases distintas pra não repetir literalmente");
});

// ----------------------------------------------------------------------------
// ITEM 3 — anti-loop: 2 fallbacks (Nível 3) em ANTI_LOOP_JANELA_MIN minutos
// na MESMA conversa → escala pra humano.
// ----------------------------------------------------------------------------
test("ITEM 3 · deveEscalarAntiLoop — 1º fallback da janela (0 recentes antes) NÃO escala", () => {
  assert.equal(deveEscalarAntiLoop(0), false);
});

test("ITEM 3 · deveEscalarAntiLoop — 2º fallback da janela (1 recente antes) ESCALA", () => {
  assert.equal(deveEscalarAntiLoop(1), true);
});

test("ITEM 3 · deveEscalarAntiLoop — 3º fallback em diante continua escalando (não desarma)", () => {
  assert.equal(deveEscalarAntiLoop(2), true);
  assert.equal(deveEscalarAntiLoop(5), true);
});

// ----------------------------------------------------------------------------
// Simulação do fluxo completo de 3 mensagens em sequência na mesma conversa,
// todas violando compliance (nível 2) — reproduz o cenário exato do bug de
// produção original e confirma que, com a correção, a 2ª rodada de fallback
// já escala pra humano (silenciando o loop) em vez de repetir indefinidamente.
// ----------------------------------------------------------------------------
test("Simulação · anti-loop fecha o loop na 2ª mensagem consecutiva problemática", () => {
  let qtdRecentesNaJanela = 0; // estado que, em produção, vem de contarFallbacksRecentes()
  const textosEnviados: string[] = [];
  const escaladas: boolean[] = [];

  for (let mensagem = 1; mensagem <= 3; mensagem++) {
    const texto = escolherFallbackWa(qtdRecentesNaJanela);
    const escalar = deveEscalarAntiLoop(qtdRecentesNaJanela);
    textosEnviados.push(texto);
    escaladas.push(escalar);
    qtdRecentesNaJanela += 1; // este fallback acabou de ser logado como fallback_n3
  }

  assert.deepEqual(escaladas, [false, true, true]);
  // 1ª e 2ª mensagens usam variantes diferentes (não repete literalmente).
  assert.notEqual(textosEnviados[0], textosEnviados[1]);
});

// ============================================================================
// HANDOFF-01, item (a) — comAberturaDeHandoff.
// ----------------------------------------------------------------------------
// O QUE ESTES TESTES DEFENDEM, EM UMA FRASE: que o agente novo consiga falar
// primeiro sem que a chamada morra no 400 da Anthropic ("conversation must end
// with a user message"), que é a trava documentada na causa raiz de 2026-07-21
// e a razão de o handoff ativo não existir até hoje.
// ============================================================================

test("HANDOFF (a) — despedida do agente antigo (assistant) ganha um turno user com a nota", () => {
  const antes: MensagemApi[] = [
    { role: "user", content: "quero vender minha carta" },
    { role: "assistant", content: "vou te passar pro Dr. Tobias" },
  ];
  const depois = comAberturaDeHandoff(antes);

  assert.equal(depois.length, 3, "deve ACRESCENTAR um turno, não colapsar");
  assert.equal(depois[2].role, "user");
  assert.equal(depois[2].content, NOTA_ABERTURA_HANDOFF);
});

test("HANDOFF (a) — A TRAVA DA ANTHROPIC: o resultado SEMPRE termina em 'user'", () => {
  // Este é o teste que justifica a fatia inteira. Se ele cair, o handoff ativo
  // volta a devolver null com 400 e o cliente volta a ficar sem resposta.
  const casos: MensagemApi[][] = [
    [{ role: "user", content: "oi" }],
    [{ role: "user", content: "oi" }, { role: "assistant", content: "olá" }],
    [
      { role: "user", content: "oi" },
      { role: "assistant", content: "olá" },
      { role: "user", content: "e aí?" },
    ],
  ];
  for (const caso of casos) {
    const r = comAberturaDeHandoff(caso);
    assert.equal(r[r.length - 1].role, "user", `terminou em assistant: ${JSON.stringify(caso)}`);
  }
});

test("HANDOFF (a) — COLAPSO: último turno já 'user' anexa com \\n, não cria user consecutivo", () => {
  const antes: MensagemApi[] = [
    { role: "assistant", content: "olá" },
    { role: "user", content: "me chama o especialista" },
  ];
  const depois = comAberturaDeHandoff(antes);

  assert.equal(depois.length, 2, "não pode empurrar um segundo user seguido");
  assert.equal(depois[1].role, "user");
  assert.equal(depois[1].content, "me chama o especialista\n" + NOTA_ABERTURA_HANDOFF);
});

test("HANDOFF (a) — nunca produz dois 'user' consecutivos (o formato que a API recusa)", () => {
  const casos: MensagemApi[][] = [
    [{ role: "user", content: "a" }],
    [{ role: "user", content: "a" }, { role: "assistant", content: "b" }],
    [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ],
  ];
  for (const caso of casos) {
    const r = comAberturaDeHandoff(caso);
    for (let i = 1; i < r.length; i++) {
      assert.notEqual(
        r[i].role,
        r[i - 1].role,
        `papéis repetidos em ${i} para ${JSON.stringify(caso)}`
      );
    }
  }
});

test("HANDOFF (a) — PUREZA: o array de entrada não é tocado", () => {
  const antes: MensagemApi[] = [
    { role: "user", content: "quero vender" },
    { role: "assistant", content: "tchau" },
  ];
  const copia = JSON.parse(JSON.stringify(antes));
  comAberturaDeHandoff(antes);
  assert.deepEqual(antes, copia, "a nota vazou para o array original");
});

test("HANDOFF (a) — PUREZA no caminho do colapso: a entrada continua sem a nota", () => {
  // O caminho do colapso é o que mutava `ultimo.content` na primeira versão
  // desta fatia; sem a cópia rasa, a nota grudaria no array de quem chamou.
  const antes: MensagemApi[] = [{ role: "user", content: "me chama alguém" }];
  comAberturaDeHandoff(antes);
  assert.equal(antes[0].content, "me chama alguém");
});

test("HANDOFF (a) — LISTA VAZIA CONTINUA VAZIA: não inventa conversa do nada", () => {
  // A nota afirma ao agente que ele "já leu o que foi conversado até aqui".
  // Sem nada conversado isso é mentira, e o chamador precisa cair no `return
  // null` do histórico vazio em vez de abrir a boca sozinho.
  assert.deepEqual(comAberturaDeHandoff([]), []);
});

test("HANDOFF (a) — a nota se ANUNCIA como nota e se manda calar sobre si mesma", () => {
  // Comportamento, não redação: a nota pode ser reescrita à vontade, mas não
  // pode deixar de avisar que não é o cliente falando (senão o agente responde
  // a uma pergunta que ninguém fez) nem deixar de proibir citá-la (senão o
  // cliente lê o andaime).
  const n = NOTA_ABERTURA_HANDOFF.toLowerCase();
  assert.ok(n.includes("não é uma mensagem do cliente"), "não se anuncia como nota");
  assert.ok(n.includes("não mencione esta nota"), "não se manda calar sobre si mesma");
  assert.ok(n.includes("primeira mensagem"), "não pede a abertura");
});

// ----------------------------------------------------------------------------
// PREFILL — o histórico entregue à Anthropic tem que TERMINAR em `user`.
//
// Contexto medido: montarMensagensWa garante que a PRIMEIRA mensagem é `user`
// (`while (msgs.length && msgs[0].role !== "user") msgs.shift()`), mas nada
// nunca garantiu a ÚLTIMA. O modelo em uso (claude-fable-5) não aceita
// prefill: um array terminando em `assistant` volta 400 "conversation must end
// with a user message" — turno perdido, cliente sem resposta.
//
// A correção de 2026-07-21 (DESC + limit(30) + reverse) atacou a CAUSA mais
// comum (truncamento), não a FORMA. Caminhos vivos que ainda terminam em
// `assistant`: conversa onde a casa falou por último e ninguém respondeu (ex.:
// 7109b701, `ultimo_papel='prosperito'`, 76h parada), toque do Sentinela
// reprocessado, e retry de background depois da resposta já gravada.
//
// terminaEmUser é PURA de propósito: não corta, não loga, não decide. Só
// responde. Cortar a última fala do agente faria o modelo RESPONDER DE NOVO
// uma mensagem que ele já respondeu — o cliente receberia a mesma coisa duas
// vezes. Recusar e logar é o comportamento correto.
// ----------------------------------------------------------------------------
test("PREFILL — histórico que termina em user é aceito", () => {
  assert.equal(
    terminaEmUser([
      { role: "user", content: "oi" },
      { role: "assistant", content: "olá" },
      { role: "user", content: "quero uma carta" },
    ]),
    true
  );
});

test("PREFILL — histórico que termina em assistant é RECUSADO (é o 400 da Anthropic)", () => {
  assert.equal(
    terminaEmUser([
      { role: "user", content: "oi" },
      { role: "assistant", content: "olá, posso ajudar?" },
    ]),
    false
  );
});

test("PREFILL — lista vazia é falsa: nada a responder não é 'pode chamar'", () => {
  // Regra 19: vazio e válido não podem colapsar no mesmo valor. Um array vazio
  // não termina em `user`, então a resposta honesta é false.
  assert.equal(terminaEmUser([]), false);
});

test("PREFILL — um único user basta (primeira mensagem da conversa)", () => {
  assert.equal(terminaEmUser([{ role: "user", content: "oi" }]), true);
});

test("PREFILL — um único assistant é recusado (a casa abriu e ninguém respondeu)", () => {
  assert.equal(terminaEmUser([{ role: "assistant", content: "oi, tudo bem?" }]), false);
});

test("PREFILL — só a ÚLTIMA posição decide, não quantas de cada papel existem", () => {
  const muitosUsers: MensagemApi[] = [
    { role: "user", content: "a" },
    { role: "user", content: "b" },
    { role: "user", content: "c" },
    { role: "assistant", content: "resposta" },
  ];
  assert.equal(terminaEmUser(muitosUsers), false);
});

test("PREFILL — a nota de handoff FECHA o array em user (por isso a guarda vem depois dela)", () => {
  // comAberturaDeHandoff acrescenta uma mensagem `user` ao fim. Se a guarda
  // rodasse ANTES dela, este caso legítimo seria recusado e o handoff nunca
  // abriria a boca.
  const antesDoHandoff: MensagemApi[] = [
    { role: "user", content: "oi" },
    { role: "assistant", content: "olá" },
  ];
  assert.equal(terminaEmUser(antesDoHandoff), false);
  assert.equal(terminaEmUser(comAberturaDeHandoff(antesDoHandoff)), true);
});

test("PREFILL — terminaEmUser NÃO altera o array que recebe", () => {
  const original: MensagemApi[] = [
    { role: "user", content: "oi" },
    { role: "assistant", content: "olá" },
  ];
  const copia = JSON.stringify(original);
  terminaEmUser(original);
  assert.equal(JSON.stringify(original), copia);
  assert.equal(original.length, 2);
});
