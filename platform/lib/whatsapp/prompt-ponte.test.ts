// ============================================================================
// HANDOFF-01, item (b) — a passagem de bastão é PONTE, não despedida.
// ----------------------------------------------------------------------------
// ACHADO QUE ESTE ARQUIVO REGISTRA: até hoje NENHUM teste tocava _prompt.ts.
// O arquivo que comanda as oito personas — o texto que efetivamente decide o
// que o cliente lê — não tinha uma linha de prova. Este é o primeiro, e cobre
// só o item (b); o resto do prompt segue descoberto e isso está reportado.
//
// O QUE ESTES TESTES DEFENDEM: que a regra da ponte alcance TODAS as personas
// nos DOIS canais, e que a redação de despedida que prendia o cedente não
// volte por descuido.
//
// POR QUE ISSO É TESTÁVEL, sendo "só prompt": porque `montarSystem` é uma
// função pura de string. O que ela devolve é exatamente o que vai ao modelo —
// e é justamente por ser prosa, sem tipo que o `tsc` confira, que a regressão
// aqui passaria despercebida pelos outros dois portões. Comentário de bloco do
// arquivo NÃO entra em `montarSystem`, então estes testes olham só o texto que
// o agente de fato recebe.
//
// COMPORTAMENTO, NÃO REDAÇÃO: a prosa pode ser reescrita à vontade. O que não
// pode é sumir a ordem de falar no presente, a proibição de fechar com
// pergunta, ou a de prometer contato fora da conversa.
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import { montarSystem, AGENTES, type AgenteId, type Canal } from "@/app/api/atende/_prompt";

const TODAS = Object.keys(AGENTES) as AgenteId[];
const CANAIS: Canal[] = ["whatsapp", "site"];

test("PONTE — a regra alcança TODAS as personas, nos DOIS canais", () => {
  // A seção mora no PROMPT_BASE_COMUM justamente para não precisar ser repetida
  // (e esquecida) em cada persona. Este teste é o que prova que a aposta valeu:
  // se alguém mover a seção para dentro de uma persona, sete caem aqui.
  assert.ok(TODAS.length === 8, `esperava 8 personas, achei ${TODAS.length}`);
  for (const agente of TODAS) {
    for (const canal of CANAIS) {
      const s = montarSystem(agente, canal);
      assert.ok(
        s.includes("A PASSAGEM É UMA PONTE, NÃO UMA DESPEDIDA"),
        `${agente}/${canal} não recebeu a seção da ponte`
      );
    }
  }
});

test("PONTE — as três travas chegam inteiras a todas as personas", () => {
  // Cada uma conserta um sintoma diferente e medido:
  //  · futuro   -> "vou te apresentar" virava fila de espera e o cliente sumia;
  //  · pergunta -> o agente novo fala em seguida, e a pergunta do que saiu
  //                ficaria pendente na tela, sem ninguém para lê-la;
  //  · promessa -> "entramos em contato" tira a conversa do canal onde ela vive.
  const travas = [
    "PRESENTE, NÃO FUTURO",
    "NÃO TERMINE COM PERGUNTA",
    "NÃO PROMETA CONTATO FORA DAQUI",
  ];
  for (const agente of TODAS) {
    const s = montarSystem(agente, "whatsapp");
    for (const trava of travas) {
      assert.ok(s.includes(trava), `${agente} perdeu a trava "${trava}"`);
    }
  }
});

test("PONTE — a instrução-mãe de despedida NÃO voltou", () => {
  // "faça a passagem soar natural (\"vou já te apresentar quem cuida disso com
  // você\")" era a origem: uma ordem explícita, na base comum, mandando a
  // persona prometer uma apresentação futura. Todas as despedidas das personas
  // eram eco dela. É a string que não pode reaparecer.
  for (const agente of TODAS) {
    for (const canal of CANAIS) {
      const s = montarSystem(agente, canal);
      assert.ok(!s.includes("soar natural"), `${agente}/${canal} trouxe de volta a instrução antiga`);
      assert.ok(!s.includes("Já vou te apresentar"), `${agente}/${canal} trouxe de volta a despedida antiga`);
    }
  }
});

test("PONTE — Caetano→Tobias: a passagem que prendia dinheiro vivo nomeia o colega no presente", () => {
  // Esta é a passagem que a coordenação nomeou: o cedente que acabou de dizer
  // SIM ao repasse. A frase precisa nomear quem chega (senão ele aparece do
  // nada) e dizer que é agora, aqui.
  const s = montarSystem("caetano", "whatsapp");
  assert.ok(
    s.includes("O Dr. Tobias já vem falar contigo aqui"),
    "a ponte nomeada do Caetano sumiu ou foi reescrita para futuro"
  );
});

test("PONTE — as passagens com frase escrita usam 'já vem falar contigo aqui'", () => {
  // Só as personas que TÊM uma frase de passagem redigida. As demais passam o
  // bastão só com o marcador e são governadas pela regra da base comum — exigir
  // a frase delas seria exigir o que elas não têm.
  const comFrase: AgenteId[] = ["prosperito", "valentina", "caetano", "vendanova"];
  for (const agente of comFrase) {
    const s = AGENTES[agente].prompt;
    assert.ok(
      s.includes("já vem falar contigo aqui"),
      `${agente} tem frase de passagem, mas não está no presente`
    );
  }
});

test("PONTE — CONTROLE: os testes acima conseguem mesmo reprovar", () => {
  // Regra 9. Sem isto, um `montarSystem` que devolvesse "" passaria em todo
  // `!s.includes(...)` do teste da instrução-mãe, e a suíte diria verde para um
  // prompt vazio — o pior resultado possível, silencioso.
  const s = montarSystem("caetano", "whatsapp");
  assert.ok(s.length > 500, "prompt suspeito de vazio: os testes de ausência viram enfeite");
  assert.ok(
    !s.includes("esta frase não existe no prompt em lugar nenhum"),
    "controle negativo falhou"
  );
  assert.ok(s.includes("PERSONA: CAETANO"), "a persona pedida nem foi injetada");
});
