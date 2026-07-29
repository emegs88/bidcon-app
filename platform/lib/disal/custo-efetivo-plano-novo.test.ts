// ============================================================================
// Colisão prompt/tool × guardrail de compliance — requisito novo do Emerson
// (correção 2/4, ver plano noble-herding-melody.md).
// ----------------------------------------------------------------------------
// Runner NATIVO do Node: `node:test` + `node:assert` (mesmo padrão de
// lib/reserve/*.test.ts). Rodar:
//   npx tsx --test lib/disal/custo-efetivo-plano-novo.test.ts
//
// POR QUÊ este arquivo existe: a barreira de compliance (`sanitizarCompliance`
// em lib/ia.ts, aplicada à resposta INTEIRA do modelo em
// app/api/atende/route.ts:764) engole qualquer frase com a âncora "contempl"
// seguida de um token temporal ("mês N") dentro de uma janela de 40
// caracteres — e devolve um fallback genérico, silenciosamente. Isso vale
// tanto pra prosa livre do modelo quanto pra STRING MONTADA EM CÓDIGO
// (`custoEfetivoTexto`/`fasesTexto`) que o modelo cita verbatim — código
// determinístico não é imune à barreira. O bug original (formato
// "contemplação no mês {C}") foi pego só porque o Emerson testou contra a
// barreira de produção; este arquivo garante que não volta a acontecer sem
// que um teste quebre primeiro.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";

import { sanitizarCompliance } from "../ia";
import {
  custoEfetivoPlanoNovo,
  formatarCustoEfetivoTexto,
  formatarFasesTexto,
  type FaseFluxo,
  type ResultadoCustoEfetivo,
} from "./custo-efetivo-plano-novo";

const FALLBACK_TESTE = "[FALLBACK] engolido pelo guardrail";

// Mesma âncora de rastreio: se o guardrail engolir a frase, ela some e vira
// o fallback — comparar o output do formatador contra si mesmo depois de
// passar pelo sanitizador é o teste de colisão real (não uma reimplementação
// paralela da lógica da barreira).
function passaIncolume(frase: string): boolean {
  return sanitizarCompliance(frase, FALLBACK_TESTE) === frase.trim();
}

// ---- fixtures a partir do boletim real (imóvel 300k Disal, base 100%) -----
// Caso de referência já validado pelo Emerson: sem correção 0,593% a.m.;
// com INCC 5% a.a. projetado, 1,050% a.m. (crédito e parcela corrigidos).
const FASES_IMOVEL_300K: FaseFluxo[] = [
  { meses: 12, valor: 2247.81 },
  { meses: 207, valor: 1947.81 },
  { meses: 1, valor: 1959.81 },
];

// Auto Faixa II, crédito 90k (boletim 2026-07).
const FASES_AUTO_90K: FaseFluxo[] = [{ meses: 84, valor: 1328.13 }];

// ============================================================================
// 1) custo_efetivo_texto — cenários reais interpolados devem passar incólumes
// ============================================================================
test("custo_efetivo_texto (imóvel, sem lance, C=36, INCC 5% a.a.) passa incólume pelo guardrail", () => {
  const resultado = custoEfetivoPlanoNovo({
    fases: FASES_IMOVEL_300K,
    credito: 300_000,
    C: 36,
    indiceAnualPct: 5,
  });
  assert.notEqual(resultado.semCorrecao, null, "TIR sem correção deve fechar neste cenário");
  const texto = formatarCustoEfetivoTexto({
    resultado,
    C: 36,
    indiceNome: "INCC",
    indiceAnualPct: 5,
  });
  assert.ok(!texto.includes("contempl"), "não pode conter a âncora 'contempl' (dispara Barrier B)");
  assert.ok(passaIncolume(texto), `guardrail engoliu a frase: ${texto}`);
});

test("custo_efetivo_texto (imóvel, COM lance 20%, C=36, INCC 5% a.a.) passa incólume pelo guardrail", () => {
  const resultado = custoEfetivoPlanoNovo({
    fases: FASES_IMOVEL_300K,
    credito: 300_000,
    lancePct: 20,
    C: 36,
    indiceAnualPct: 5,
  });
  const texto = formatarCustoEfetivoTexto({
    resultado,
    C: 36,
    indiceNome: "INCC",
    indiceAnualPct: 5,
  });
  assert.ok(!texto.includes("contempl"));
  assert.ok(passaIncolume(texto), `guardrail engoliu a frase: ${texto}`);
});

test("custo_efetivo_texto (veículo, sem lance, C=24, IPCA 4,5% a.a.) passa incólume pelo guardrail", () => {
  const resultado = custoEfetivoPlanoNovo({
    fases: FASES_AUTO_90K,
    credito: 90_000,
    C: 24,
    indiceAnualPct: 4.5,
  });
  const texto = formatarCustoEfetivoTexto({
    resultado,
    C: 24,
    indiceNome: "IPCA",
    indiceAnualPct: 4.5,
  });
  assert.ok(!texto.includes("contempl"));
  assert.ok(passaIncolume(texto), `guardrail engoliu a frase: ${texto}`);
});

// ============================================================================
// 2) Fallbacks (não fecha / projeção indisponível) — também citados verbatim
//    em chat, também precisam passar. Construídos diretamente (sem depender
//    de achar um fluxo real que não converge) pra testar só o formatador.
// ============================================================================
test("fallback 'não fecha numa taxa única' passa incólume pelo guardrail", () => {
  const resultado: ResultadoCustoEfetivo = { semCorrecao: null, comIndice: null };
  const texto = formatarCustoEfetivoTexto({ resultado, C: 36, indiceNome: "INCC", indiceAnualPct: 5 });
  assert.ok(!texto.includes("contempl"));
  assert.ok(passaIncolume(texto), `guardrail engoliu a frase: ${texto}`);
});

test("fallback 'projeção indisponível' (índice ausente) passa incólume pelo guardrail", () => {
  const resultado: ResultadoCustoEfetivo = { semCorrecao: { mensal: 0.00593, anual: 0.0733 }, comIndice: null };
  const texto = formatarCustoEfetivoTexto({ resultado, C: 36 });
  assert.ok(!texto.includes("contempl"));
  assert.ok(passaIncolume(texto), `guardrail engoliu a frase: ${texto}`);
});

// ============================================================================
// 3) fases_texto — formato já era seguro (confirmado pelo Emerson), mantém
//    cobertura de regressão com valores reais interpolados.
// ============================================================================
test("fases_texto (imóvel, 3 fases) passa incólume pelo guardrail", () => {
  const texto = formatarFasesTexto(FASES_IMOVEL_300K);
  // Compara normalizando espaço (toLocaleString com "style: currency" usa
  // NBSP \u00a0 entre "R$" e o valor, não espaço comum) — o conteúdo é o que
  // importa aqui, não o byte exato do separador.
  assert.equal(
    texto.replace(/\u00a0/g, " "),
    "12x de R$ 2.247,81 + 207x de R$ 1.947,81 + 1x de R$ 1.959,81 (220 parcelas)"
  );
  assert.ok(passaIncolume(texto), `guardrail engoliu a frase: ${texto}`);
});

test("fases_texto (auto, 1 fase) passa incólume pelo guardrail", () => {
  const texto = formatarFasesTexto(FASES_AUTO_90K);
  assert.equal(texto.replace(/\u00a0/g, " "), "84x de R$ 1.328,13");
  assert.ok(passaIncolume(texto), `guardrail engoliu a frase: ${texto}`);
});

// ============================================================================
// 4) Regressão documental — prova que o formato ANTIGO ("contemplação no mês
//    N") de fato colidia, pra deixar registrado POR QUÊ a mudança pra "carta
//    de crédito no mês N" foi necessária (se alguém reverter a palavra, este
//    teste falha).
// ============================================================================
test("[regressão] formato antigo 'contemplação no mês N' É engolido pelo guardrail (documenta o bug corrigido)", () => {
  const fraseAntiga =
    "custo efetivo (cenário: contemplação no mês 36): 0,59% a.m. · 1,05% a.m. com INCC projetado a 5,0% a.a. (acumulado 12m) — estimativa";
  assert.equal(
    sanitizarCompliance(fraseAntiga, FALLBACK_TESTE),
    FALLBACK_TESTE,
    "se isto falhar, o guardrail mudou de comportamento — revisar antes de reintroduzir 'contemplação no mês N' em qualquer texto de chat"
  );
});

// ============================================================================
// 5) Regressão 2026-07-29 — o teste acima ficou VERMELHO na main e ninguém
//    viu. O matcher F3.1 (commit 617d2a0) trocou a janela genérica por
//    padrões com verbo explícito e, ao fazer isso, deixou de pegar a forma
//    "apontar um mês/data" — que é promessa igual, só que sem verbo.
//    Aqui a cobertura é ampliada para as variações, dos dois lados: o que
//    TEM de bloquear e o que NÃO pode voltar a bloquear.
// ============================================================================
const PROMESSAS_DE_DATA = [
  "contemplação no mês 36",
  "contemplacao no mes 12",
  "você é contemplado no mês 24",
  "contemplação prevista para o mês 36",
  "contemplação no 36º mês",
  "contemplado em até 3 meses",
  "contempla em 6 meses",
  "contemplação em março",
  "contemplado até dezembro",
  "contemplação em 03/2026",
  "sua carta será contemplada no mês 18 do grupo",
];

for (const frase of PROMESSAS_DE_DATA) {
  test(`[guardrail] promessa de data BLOQUEIA: "${frase}"`, () => {
    assert.equal(
      sanitizarCompliance(`Boa tarde! ${frase}, pode contar com isso.`, FALLBACK_TESTE),
      FALLBACK_TESTE,
      "apontar mês/data de contemplação nunca pode chegar ao cliente",
    );
  });
}

// O falso-positivo de 2026-07-23 bloqueava "carta já contemplada" — o nome do
// próprio produto. A correção de hoje NÃO pode reabrir isso.
const ESTADO_DO_PRODUTO = [
  "Essa carta já está contemplada e disponível",
  "Temos cotas contempladas da Embracon",
  "Foi contemplada por sorteio na 1ª assembleia",
  "Foi contemplada por sorteio na primeira assembleia",
  "carta de crédito contemplada, pronta para transferência",
  "a cota foi contemplada por lance no grupo anterior",
];

for (const frase of ESTADO_DO_PRODUTO) {
  test(`[guardrail] estado do produto PASSA: "${frase}"`, () => {
    assert.equal(
      sanitizarCompliance(frase, FALLBACK_TESTE),
      frase,
      "descrever uma carta já contemplada é fato do produto, não promessa — bloquear aqui foi o bug de 2026-07-23",
    );
  });
}

// A frase que o próprio simulador manda para o chat continua passando: foi
// justamente por isso que "contemplação no mês N" virou "carta de crédito no
// mês N" nos textos de produção.
test("[guardrail] o formato ATUAL do custo efetivo continua passando", () => {
  const atual = formatarCustoEfetivoTexto({
    resultado: { semCorrecao: { mensal: 0.0059, anual: 0.073 }, comIndice: { mensal: 0.0105, anual: 0.1336 } },
    C: 36,
    indiceNome: "INCC",
    indiceAnualPct: 5,
  });
  assert.ok(atual.includes("carta de crédito no mês 36"));
  assert.equal(sanitizarCompliance(atual, FALLBACK_TESTE), atual, "o texto de produção não pode cair no fallback");
});
