// ============================================================================
// FATIA 2 (SEGURANCA-01 · F3.1 — Guardrail Prosperito v2) — suíte DoD.
// ----------------------------------------------------------------------------
// Runner NATIVO do Node: `node:test` + `node:assert` (mesmo padrão já usado
// em lib/reserve/reserve.test.ts — ZERO dependência nova).
// Rodar:  npx tsx --test lib/ia.guardrail.test.ts
//
// Cobre ITEM 1 (matcher em duas camadas: PROMESSA_PRAZO + LEXICO_PROIBIDO,
// com allowlist "contemplada" sem futuro/prazo) e ITEM 2 (avaliarCompliance-
// Gradual: níveis 0/1/2) usando as funções REAIS exportadas por lib/ia.ts —
// nenhuma reimplementação/mocking da lógica de detecção em si.
//
// As 11 frases abaixo são EXATAMENTE as do DoD ditado pelo Emerson (5
// PASSAM + 6 BLOQUEIAM) — não parafraseadas, pra garantir que o teste
// valida a especificação literal, não uma interpretação dela.
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import { violaCompliance, avaliarComplianceGradual, sanitizarCompliance } from "./ia";

// ----------------------------------------------------------------------------
// DoD — frases que DEVEM PASSAR (não violam compliance em nenhuma frente).
// ----------------------------------------------------------------------------
const FRASES_PASSAM = [
  "Essa carta já está contemplada e disponível",
  "Temos cotas contempladas da Embracon",
  "Foi contemplada por sorteio na 1ª assembleia",
  "Aguardo seu retorno",
  "O custo financeiro efetivo ao mês é 1,4%",
];

// ----------------------------------------------------------------------------
// DoD — frases que DEVEM BLOQUEAR (violam compliance em pelo menos 1 frente).
// ----------------------------------------------------------------------------
const FRASES_BLOQUEIAM = [
  "Você será contemplado em até 3 meses",
  "Contemplação garantida",
  "É um ótimo investimento",
  "Rende mais que o CDI",
  "A taxa interna de retorno é...",
  "Retorno garantido de 2%",
];

test("DoD · violaCompliance() — as 5 frases que PASSAM não violam nenhuma frente", () => {
  for (const frase of FRASES_PASSAM) {
    assert.equal(
      violaCompliance(frase),
      false,
      `deveria PASSAR, mas violaCompliance() acusou violação: "${frase}"`
    );
  }
});

test("DoD · violaCompliance() — as 6 frases que BLOQUEIAM violam alguma frente", () => {
  for (const frase of FRASES_BLOQUEIAM) {
    assert.equal(
      violaCompliance(frase),
      true,
      `deveria BLOQUEAR, mas violaCompliance() liberou: "${frase}"`
    );
  }
});

test("DoD · avaliarComplianceGradual() — frases que PASSAM saem em nível 0, texto intacto", () => {
  for (const frase of FRASES_PASSAM) {
    const r = avaliarComplianceGradual(frase);
    assert.equal(r.nivel, 0, `esperava nível 0 para "${frase}", veio nível ${r.nivel}`);
    assert.equal(r.texto, frase);
    assert.deepEqual(r.motivos, []);
  }
});

test("DoD · avaliarComplianceGradual() — frases que BLOQUEIAM saem em nível >= 1 (nunca 0)", () => {
  for (const frase of FRASES_BLOQUEIAM) {
    const r = avaliarComplianceGradual(frase);
    assert.notEqual(r.nivel, 0, `esperava nível 1 ou 2 para "${frase}", veio nível 0 (vazou!)`);
    assert.ok(r.motivos.length > 0, `motivos vazio para frase que deveria bloquear: "${frase}"`);
  }
});

// ----------------------------------------------------------------------------
// ITEM 1 — casos extras de fronteira citados no diagnóstico original (regex
// antiga bloqueava "carta já contemplada" — o nome do próprio produto).
// ----------------------------------------------------------------------------
test("ITEM 1 · allowlist explícita — variações de 'contemplada' sem futuro/prazo/garantia passam", () => {
  const casos = [
    "carta contemplada",
    "cota contemplada",
    "já contemplada",
    "carta de crédito contemplada",
    "foi contemplada por sorteio",
    "foi contemplada por lance",
  ];
  for (const frase of casos) {
    assert.equal(violaCompliance(frase), false, `allowlist deveria liberar: "${frase}"`);
  }
});

test("ITEM 1 · PROMESSA_PRAZO — variações de promessa de data/prazo/garantia bloqueiam", () => {
  const casos = [
    "Você será contemplada em breve",
    "Isso vai contemplar você rapidinho",
    "Contemplação rápida, pode confiar",
    "Contemplação certa em 2 meses",
    "Contemplação imediata!",
    "Contempla em até 6 meses",
    "Contemplado em 10 dias",
    "Garantimos que você será contemplado",
  ];
  for (const frase of casos) {
    assert.equal(violaCompliance(frase), true, `deveria bloquear promessa de prazo: "${frase}"`);
  }
});

// ATUALIZADO NA F3.1-b (ajuste Emerson): a limitação original (documentada
// no checkpoint) era que a janela de negação de PROMESSA_PRAZO (`antes`, 20
// chars antes do match, em prometeDataContemplacao) tinha duas lacunas
// estruturais — (1) o padrão 5 (/\bgarant\w*[\s\S]{0,20}contempl\w*/) começa
// o match exatamente em "garant", então a janela "antes" nunca podia conter
// "nao garant"; (2) "ninguem pode" ficava fora do alcance de 20 chars em
// frases mais longas. Isso fazia "Não garantimos data de contemplação" e
// "Ninguém pode garantir que você será contemplado em X meses" bloquearem
// incorretamente (negação institucional legítima). Corrigido com
// NEGACAO_SEGURA_RE (checada ANTES do loop de PROMESSA_PRAZO_PATTERNS): se a
// frase tem negação "colada" no verbo de garantir, pula só a checagem de
// promessa (léxico proibido continua valendo normalmente).
test("F3.1-b · NEGACAO_SEGURA_RE — negação colada no verbo de garantir libera a promessa (antes bloqueava, limitação corrigida)", () => {
  assert.equal(
    violaCompliance("Não garantimos data de contemplação"),
    false,
    "NEGACAO_SEGURA_RE deve liberar: 'nao garantimos' colado"
  );
  assert.equal(
    violaCompliance("Ninguém pode garantir que você será contemplado em X meses"),
    false,
    "NEGACAO_SEGURA_RE deve liberar: 'ninguem pode garantir' colado"
  );
  // Esta, mais curta, já cabia na janela antiga e continua funcionando:
  assert.equal(
    violaCompliance("Não há prazo previsto — depende de sorteio ou lance"),
    false
  );
});

// ATUALIZADO NA F3.1-b: RETORNO_FINANCEIRO_RE agora exige complemento
// FINANCEIRO explícito depois de "sobre" (investimento/capital/aplicação/
// patrimônio) — "retorno sobre a proposta"/"...esse produto" (uso
// institucional legítimo, sem complemento financeiro) passam a LIBERAR;
// "retorno sobre o investimento" continua bloqueado (dupla proteção, porque
// "investimento" já está em TERMOS_PROIBIDOS por conta própria).
test("F3.1-b · RETORNO_FINANCEIRO_RE — 'retorno sobre X' só bloqueia com complemento financeiro (antes bloqueava sempre, limitação corrigida)", () => {
  assert.equal(
    violaCompliance("Aguardo seu retorno sobre a proposta"),
    false,
    "RETORNO_FINANCEIRO_RE agora exige complemento financeiro após 'sobre'"
  );
  assert.equal(violaCompliance("Fico no aguardo do seu retorno"), false);
  assert.equal(violaCompliance("Retorno financeiro garantido"), true);
  assert.equal(
    violaCompliance("O retorno sobre esse produto é ótimo"),
    false,
    "'produto' não é complemento financeiro — libera"
  );
  assert.equal(violaCompliance("Retorno de 5% ao mês"), true);
  assert.equal(
    violaCompliance("retorno sobre o investimento"),
    true,
    "complemento financeiro explícito — continua bloqueado (+ rede dupla via léxico 'investimento')"
  );
});

// ----------------------------------------------------------------------------
// F3.1-b (ajuste Emerson, pós-checkpoint) — 6 frases exatas do pedido, mais o
// caso adversarial teórico documentado como ACEITO (não é bug a corrigir).
// ----------------------------------------------------------------------------
test("F3.1-b · PASSAM (1/3) — negação de garantia de data, colada no verbo", () => {
  assert.equal(
    violaCompliance("Não garantimos data de contemplação — ela ocorre por sorteio ou lance."),
    false
  );
});

test("F3.1-b · PASSAM (2/3) — 'ninguém pode garantir quando' colado, sem promessa de prazo", () => {
  assert.equal(
    violaCompliance("Ninguém pode garantir quando você será contemplado."),
    false
  );
});

test("F3.1-b · PASSAM (3/3) — 'retorno sobre' sem complemento financeiro é uso institucional", () => {
  assert.equal(violaCompliance("Aguardo seu retorno sobre a proposta."), false);
});

test("F3.1-b · BLOQUEIAM (1/3) — negação NÃO colada no verbo (há material entre 'não' e 'garantimos') continua bloqueando", () => {
  assert.equal(
    violaCompliance("Não se preocupe, garantimos contemplação em 3 meses."),
    true,
    "negação solta ('não se preocupe, ...') não casa NEGACAO_SEGURA_RE de propósito — a promessa real deve continuar bloqueada"
  );
  // ADVERSARIAL TEÓRICO ACEITO (documentação, não é bug — mesma família de
  // caso do teste acima): "ninguém garante, mas será contemplado em 3 meses"
  // tem a negação SEPARADA do verbo "garante" por vírgula + "mas" — não casa
  // NEGACAO_SEGURA_RE (que exige negação colada: "ninguem pode/consegue
  // garantir", não "ninguem garante"). A promessa real ("sera contemplado
  // em 3 meses") continua sendo pega e bloqueada normalmente. Aceito por
  // decisão do Emerson: o guardrail protege a SAÍDA do modelo, não tenta
  // blindar contra toda formulação adversarial de input — e, ainda que
  // viesse como frase separada de um input do cliente, a frase com a
  // promessa real seguiria bloqueando normal na avaliação por frase
  // (avaliarComplianceGradual).
  assert.equal(
    violaCompliance("ninguém garante, mas será contemplado em 3 meses"),
    true,
    "aceito: NEGACAO_SEGURA_RE não casa negação solta; a promessa real continua bloqueada — comportamento correto por design"
  );
});

test("F3.1-b · BLOQUEIAM (2/3) — retorno garantido com percentual continua bloqueando", () => {
  assert.equal(violaCompliance("Retorno garantido de 2% ao mês."), true);
});

test("F3.1-b · BLOQUEIAM (3/3) — retorno sobre complemento financeiro explícito continua bloqueando", () => {
  assert.equal(violaCompliance("O retorno sobre o capital é alto."), true);
});

// ----------------------------------------------------------------------------
// F3.1-c (ajuste Emerson) — isenção de negação por CLÁUSULA, não por frase
// inteira. Antes do F3.1-c, NEGACAO_SEGURA_RE avaliada contra a frase toda
// isentava indevidamente uma promessa real ligada por uma adversativa
// ("mas/porém/..."). Agora cada cláusula é avaliada de forma independente.
// ----------------------------------------------------------------------------
test("F3.1-c · BLOQUEIA (1/2) — negação isenta só a própria cláusula; a promessa real na cláusula adversativa seguinte continua bloqueando", () => {
  assert.equal(
    violaCompliance(
      "Não garantimos datas, mas pelo histórico você será contemplado em uns 3 meses."
    ),
    true,
    "'não garantimos' isenta só a 1ª cláusula; 'será contemplado em uns 3 meses' na cláusula após 'mas' é promessa real e deve bloquear"
  );
});

test("F3.1-c · BLOQUEIA (2/2) — mesma lógica com 'porém' e 'contemplação garantida'", () => {
  assert.equal(
    violaCompliance(
      "Ninguém pode garantir, porém normalmente a contemplação garantida sai rápido."
    ),
    true,
    "'ninguém pode garantir' isenta só a 1ª cláusula; 'contemplação garantida' na cláusula após 'porém' continua bloqueando"
  );
});

test("F3.1-c · PASSA — 'pulo do gato': adversativa aparente + negação + nome do produto, sem promessa, não pode virar over-block", () => {
  assert.equal(
    violaCompliance(
      "Não garantimos data de contemplação, e é justamente por isso que trabalhamos só com cartas já contempladas."
    ),
    false,
    "'só com cartas' não é 'só que' (não é adversativa) — a frase inteira é uma única cláusula, com negação colada e sem nenhuma promessa de prazo/garantia"
  );
});

// NOTA DE TRANSPARÊNCIA: a janela de negação de termoViolado (`antes`, só 8
// chars antes do termo casado) é curta demais para negação composta do tipo
// "não é X nem Y" quando X (ex.: "rendimento") ocupa boa parte da janela e
// empurra a negação "nao" pra fora do alcance de Y (ex.: "rentabilidade").
// Confirmado via execução real: "Consórcio não é investimento" (negação
// simples, cabe na janela de 8 chars) passa corretamente; já "Isso não é
// rendimento nem rentabilidade" bloqueia, porque ao chegar em
// "rentabilidade" a janela de 8 chars antes já não alcança mais o "nao"
// (ficou atrás de "rendimento nem"). Limitação pré-existente, direção segura.
test("ITEM 1 · LEXICO_PROIBIDO — negação simples funciona; negação composta 'X nem Y' bloqueia no 2º termo (limitação conhecida)", () => {
  assert.equal(violaCompliance("Consórcio não é investimento"), false);
  assert.equal(
    violaCompliance("Isso não é rendimento nem rentabilidade"),
    true,
    "limitação conhecida: janela de 8 chars não alcança a negação para o 2º termo da lista"
  );
});

test("ITEM 1 · LEXICO_PROIBIDO — não casa substring dentro de outra palavra (fronteira)", () => {
  // "lucrar" não deveria disparar por causa de outra palavra que o contenha,
  // e termos curtos (cdi) não devem casar dentro de palavras maiores.
  assert.equal(violaCompliance("Município vizinho tem boas cartas"), false);
});

// ----------------------------------------------------------------------------
// ITEM 2 — ação gradual: nível 1 (poda parcial, mantém o resto) vs nível 2
// (nada de útil sobra — resposta inteira era problemática, ou vazia).
// ----------------------------------------------------------------------------
test("ITEM 2 · nível 1 — remove só a frase ofensora e mantém o restante útil", () => {
  const texto =
    "Essa carta já está contemplada e disponível. É um ótimo investimento para você.";
  const r = avaliarComplianceGradual(texto);
  assert.equal(r.nivel, 1);
  assert.match(r.texto, /contemplada e dispon[ií]vel/i);
  assert.doesNotMatch(r.texto, /investimento/i);
  assert.ok(r.motivos.some((m) => m.startsWith("lexico:")));
});

test("ITEM 2 · nível 2 — resposta inteira problemática, nada de útil sobra", () => {
  const r = avaliarComplianceGradual("É um ótimo investimento. Contemplação garantida!");
  assert.equal(r.nivel, 2);
  assert.equal(r.texto, "");
  assert.ok(r.motivos.length >= 1);
});

test("ITEM 2 · nível 2 — texto vazio ou só espaços", () => {
  assert.equal(avaliarComplianceGradual("").nivel, 2);
  assert.equal(avaliarComplianceGradual("   ").nivel, 2);
});

test("ITEM 2 · nível 1 — poda de frase curta residual (< 6 chars úteis) também cai pra nível 2", () => {
  // Se sobrar só um resíduo minúsculo (ex.: "Ok."), não é útil o bastante
  // pra mandar sozinho — precisa virar nível 2 (regeneração/fallback).
  const r = avaliarComplianceGradual("Ok. É um ótimo investimento.");
  assert.equal(r.nivel, 2);
});

// ----------------------------------------------------------------------------
// Regressão — sanitizarCompliance (site, app/api/atende) continua com a
// MESMA assinatura/comportamento (engole a frase inteira, sem ação gradual)
// — esta fatia não pode mudar o contrato consumido pelo site.
// ----------------------------------------------------------------------------
test("Regressão · sanitizarCompliance (site) — ainda engole a frase inteira ao violar", () => {
  const fallback = "Esta carta se encaixa no perfil que você descreveu.";
  assert.equal(sanitizarCompliance("É um ótimo investimento!", fallback), fallback);
  assert.equal(
    sanitizarCompliance("Essa carta já está contemplada.", fallback),
    "Essa carta já está contemplada."
  );
});
