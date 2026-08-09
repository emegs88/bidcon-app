import test from "node:test";
import assert from "node:assert/strict";
import { etiquetasDaMensagem, pareceCedente, TAG_CEDENTE } from "./cedente";

// ---------------------------------------------------------------------------
// O caso que justifica o detector inteiro
// ---------------------------------------------------------------------------

test("marca quem diz, com todas as letras, que quer vender a propria cota", () => {
  const frases = [
    "Quero vender minha cota de consórcio",
    "gostaria de vender meu consórcio, como faço?",
    "Oi, preciso transferir minha carta de crédito",
    "quero me desfazer do consórcio",
    "boa tarde, vocês compram cota contemplada?",
    "não consigo mais pagar minhas parcelas, quero sair",
  ];
  for (const f of frases) {
    assert.equal(pareceCedente(f), true, `deveria marcar: ${f}`);
  }
});

// ---------------------------------------------------------------------------
// O erro que o detector existe para NÃO cometer
// ---------------------------------------------------------------------------

test("COMPRADOR nao e cedente — o verbo sozinho nao marca ninguem", () => {
  // Esta é a pergunta mais comum que chega no WhatsApp. Se "vender" bastasse,
  // todo comprador viraria vendedor e o funil mostraria um número alto e
  // invertido — que é pior do que um número vazio, porque parece sucesso.
  const compradores = [
    "vocês vendem carta de crédito?",
    "Vende consórcio de imóvel?",
    "queria comprar uma cota contemplada",
    "vcs tem carta de 300 mil à venda?",
    "qual o valor da entrada pra venda de cota?",
    "estou querendo adquirir um consórcio",
  ];
  for (const f of compradores) {
    assert.equal(pareceCedente(f), false, `NÃO deveria marcar: ${f}`);
  }
});

test("negacao desarma o detector mesmo com verbo E posse na frase", () => {
  assert.equal(pareceCedente("não quero vender minha cota, só quero simular"), false);
  assert.equal(pareceCedente("nao pretendo vender meu consórcio"), false);
  assert.equal(pareceCedente("Não é para vender minha carta, é para consultar"), false);
});

// ---------------------------------------------------------------------------
// Grafia
// ---------------------------------------------------------------------------

test("acento e caixa nao mudam o veredito", () => {
  assert.equal(pareceCedente("QUERO VENDER MINHA COTA"), true);
  assert.equal(pareceCedente("quero vender minha cota"), true);
  assert.equal(pareceCedente("Quero Vender Minha Cóta".replace("ó", "o")), true);
  assert.equal(pareceCedente("quero ceder meu consorcio"), true);
  assert.equal(pareceCedente("quero ceder meu consórcio"), true);
});

// ---------------------------------------------------------------------------
// Entradas degeneradas — o webhook recebe de tudo
// ---------------------------------------------------------------------------

test("vazio, nulo e ruido curto nunca marcam", () => {
  assert.equal(pareceCedente(null), false);
  assert.equal(pareceCedente(undefined), false);
  assert.equal(pareceCedente(""), false);
  assert.equal(pareceCedente("   "), false);
  assert.equal(pareceCedente("ok"), false);
  assert.equal(pareceCedente("[anexo sem nome/legenda]"), false);
});

// ---------------------------------------------------------------------------
// O contrato com o resto do sistema
// ---------------------------------------------------------------------------

test("etiquetasDaMensagem devolve lista, nao booleano", () => {
  assert.deepEqual(etiquetasDaMensagem("quero vender minha cota"), [TAG_CEDENTE]);
  assert.deepEqual(etiquetasDaMensagem("vocês vendem carta?"), []);
});

test("a etiqueta canonica e exatamente 'cedente'", () => {
  // O painel consulta por esta string e a migração 0075 a cita no comment.
  // Se alguém a renomear, este teste avisa antes de o funil zerar em silêncio.
  assert.equal(TAG_CEDENTE, "cedente");
});
