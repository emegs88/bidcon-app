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
