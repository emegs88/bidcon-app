// ============================================================================
// Teste das regras de prompt do acervo (FAROL-ARTE-02)
// ----------------------------------------------------------------------------
// O arquivo nasceu em 09/08 sem teste, e o próprio cabeçalho dele explica por
// que isso é grave: as regras vieram de MEDIÇÃO — três artes geradas, duas
// reprovadas, e o texto que sobreviveu foi guardado justamente para não se
// perder. Sem teste, a próxima pessoa apaga por engano a cláusula que custou
// duas artes e ninguém fica sabendo até montar o card.
//
// Então este teste não afere gosto. Ele afere que as três lições medidas
// continuam DENTRO de todo prompt que sai daqui:
//   · a1 — composição fora do centro horizontal;
//   · a2 — luz pontual, não massa de meio-tom;
//   · a regra inegociável — nada de texto, número, marca ou pessoa.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ACABAMENTO,
  CATEGORIAS,
  CATEGORIAS_FIGURATIVAS,
  CENAS,
  CENA_ABSTRATA,
  COMPOSICAO,
  PROIBICOES,
  montarPrompt,
} from "./prompts-arte";

// ---------------------------------------------------------------------------
// A lista de categorias é contrato com o banco
// ---------------------------------------------------------------------------

test("CATEGORIAS bate exatamente com o CHECK da migração 0076", () => {
  // Grafia copiada à mão do CHECK. Se alguém acrescentar categoria no código
  // sem migrar, o insert morre em produção com violação de constraint — aqui
  // morre no teste.
  const NO_CHECK_DA_0076 = [
    "abstrata",
    "veiculo_popular",
    "veiculo_medio",
    "veiculo_alto",
    "imovel_compacto",
    "imovel_medio",
    "imovel_alto",
  ];
  assert.deepEqual([...CATEGORIAS].sort(), NO_CHECK_DA_0076.sort());
});

test("'abstrata' não está entre as figurativas", () => {
  // A distinção não é taxonômica: arte figurativa OBRIGA o card a exibir
  // "Imagem ilustrativa" (comentário da tabela na 0076). Confundir as duas
  // listas é publicar foto de bem sem o aviso.
  assert.equal((CATEGORIAS_FIGURATIVAS as readonly string[]).includes("abstrata"), false);
  assert.equal(CATEGORIAS.length, CATEGORIAS_FIGURATIVAS.length + 1);
});

test("toda categoria figurativa tem cena escrita", () => {
  for (const c of CATEGORIAS_FIGURATIVAS) {
    assert.ok(CENAS[c] && CENAS[c].trim().length > 40, `cena vaga ou ausente: ${c}`);
  }
});

test("a coringa 'abstrata' tem cena — era o buraco de 09/08", () => {
  // Ela é o DEFAULT da tabela e o primeiro degrau do fallback. Ficar sem texto
  // significava improvisar justamente a categoria mais usada.
  assert.ok(CENA_ABSTRATA.trim().length > 40);
});

// ---------------------------------------------------------------------------
// As três caudas entram SEMPRE — prompt de imagem não tem herança
// ---------------------------------------------------------------------------

test("todo prompt carrega proibições, acabamento e composição", () => {
  for (const c of CATEGORIAS) {
    const p = montarPrompt(c);
    assert.ok(p.includes(PROIBICOES), `${c}: sem proibições`);
    assert.ok(p.includes(ACABAMENTO), `${c}: sem acabamento`);
    assert.ok(p.includes(COMPOSICAO), `${c}: sem composição`);
  }
});

test("as proibições vão por último — é o que o modelo lê por fim", () => {
  for (const c of CATEGORIAS) {
    const p = montarPrompt(c);
    assert.ok(p.endsWith(PROIBICOES), `${c}: proibições não fecham o prompt`);
  }
});

test("a cena vai primeiro, antes das caudas", () => {
  for (const c of CATEGORIAS) {
    const p = montarPrompt(c);
    const cena = c === "abstrata" ? CENA_ABSTRATA : CENAS[c];
    assert.ok(p.startsWith(cena), `${c}: prompt não começa pela cena`);
  }
});

// ---------------------------------------------------------------------------
// As lições que custaram duas artes
// ---------------------------------------------------------------------------

test("lição a1 — a composição manda sair do centro horizontal", () => {
  const n = COMPOSICAO.toLowerCase();
  assert.ok(n.includes("away from the horizontal centre"), "não manda sair do centro");
  assert.ok(n.includes("22 percent") && n.includes("78 percent"), "perdeu a faixa 22–78%");
  assert.ok(
    n.includes("horizontal centre free of bright highlights"),
    "não protege o centro de brilho — é onde cai o número do crédito",
  );
});

test("lição a2 — o acabamento exige luz PONTUAL", () => {
  const n = ACABAMENTO.toLowerCase();
  assert.ok(n.includes("point-source"), "perdeu a cláusula de luz pontual");
  assert.ok(n.includes("avoid flat"), "perdeu o veto à massa de meio-tom");
});

test("cada cena figurativa empurra o objeto para um lado", () => {
  // A correção de a1 tem de estar TAMBÉM na cena, não só na cauda: o modelo
  // obedece mais a descrição concreta do objeto do que a regra geral.
  for (const c of CATEGORIAS_FIGURATIVAS) {
    assert.ok(
      /to one side of the frame|pushed to one side/i.test(CENAS[c]),
      `${c}: cena não empurra o objeto para o lado`,
    );
  }
});

// ---------------------------------------------------------------------------
// A regra inegociável
// ---------------------------------------------------------------------------

test("nenhum prompt pede texto, número, marca ou pessoa", () => {
  // Número pintado por modelo é número que ninguém conferiu contra a carta.
  const EXIGIDAS = [
    "no text",
    "no letters",
    "no numbers",
    "no digits",
    "no logos",
    "no brand marks",
    "no license plates",
    "no watermarks",
  ];
  for (const c of CATEGORIAS) {
    const p = montarPrompt(c).toLowerCase();
    for (const e of EXIGIDAS) {
      assert.ok(p.includes(e), `${c}: proibição perdida "${e}"`);
    }
  }
});

test("nenhuma cena pede marca ou emblema por conta própria", () => {
  // A cauda proíbe, mas uma cena que PEDE "a BMW" brigaria com ela — e prompt
  // de imagem resolve conflito por sorteio.
  const MARCAS = /\b(bmw|audi|toyota|honda|volkswagen|fiat|chevrolet|hyundai|nike|apple)\b/i;
  for (const c of CATEGORIAS) {
    const cena = c === "abstrata" ? CENA_ABSTRATA : CENAS[c];
    assert.equal(MARCAS.test(cena), false, `${c}: cena cita marca real`);
    assert.ok(/unbranded|no name plate|no.*branding|no objects/i.test(cena) || c === "abstrata");
  }
});

test("a cena abstrata não pede objeto nenhum", () => {
  // Se a coringa pintar um carro, ela deixa de ser coringa: passa a afirmar um
  // bem e volta a exigir o selo "Imagem ilustrativa".
  const n = CENA_ABSTRATA.toLowerCase();
  assert.ok(n.includes("no objects"));
  assert.ok(n.includes("no architecture"));
  assert.ok(n.includes("no vehicles"));
});

test("montarPrompt aceita a coringa sem quebrar o tipo", () => {
  const p = montarPrompt("abstrata");
  assert.ok(p.length > 200);
  assert.ok(p.startsWith(CENA_ABSTRATA));
});
