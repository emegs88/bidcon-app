import test from "node:test";
import assert from "node:assert/strict";
import {
  etiquetasSemEntrada,
  gatilhoSemEntrada,
  pareceSemEntrada,
  TAG_CONSORCIO_NOVO,
} from "./sem-entrada";

// ---------------------------------------------------------------------------
// LADO A — o que TEM de disparar
// ---------------------------------------------------------------------------
// A primeira frase da lista é a real: foi ela que matou a conversa do print e
// deu origem à fatia. Se algum dia só um caso puder sobreviver aqui, é esse.
// ---------------------------------------------------------------------------

test("dispara nas cinco formas que a ordem nomeou", () => {
  const frases = [
    "não tenho entrada",
    "sem entrada",
    "dá pra parcelar a entrada?",
    "não tenho esse valor",
    "só consigo a parcela",
  ];
  for (const f of frases) {
    assert.equal(pareceSemEntrada(f), true, `deveria disparar: ${f}`);
  }
});

test("dispara com artigo no meio, que e como metade das pessoas escreve", () => {
  const frases = [
    "não tenho a entrada",
    "eu não tenho a entrada agora",
    "infelizmente não tenho essa entrada",
    "não tenho uma entrada pra dar",
  ];
  for (const f of frases) {
    assert.equal(pareceSemEntrada(f), true, `deveria disparar: ${f}`);
  }
});

test("dispara nas variantes de 'nao consigo dar entrada'", () => {
  const frases = [
    "não tenho como dar entrada",
    "não posso dar entrada agora",
    "não consigo pagar a entrada",
    "não dá pra dar essa entrada",
    "estou sem condições de dar entrada",
  ];
  for (const f of frases) {
    assert.equal(pareceSemEntrada(f), true, `deveria disparar: ${f}`);
  }
});

test("dispara em quem so tem folego pra parcela", () => {
  const frases = [
    "só consigo pagar a parcela",
    "somente consigo a parcela",
    "apenas posso pagar as parcelas",
    "só tenho como pagar a parcela mensal",
  ];
  for (const f of frases) {
    assert.equal(pareceSemEntrada(f), true, `deveria disparar: ${f}`);
  }
});

test("dispara sem acento, em caixa alta e com espaco repetido", () => {
  // Três grafias da mesma frase não podem ser três regras — é o que a
  // normalização promete, e é aqui que a promessa é cobrada.
  assert.equal(pareceSemEntrada("NAO TENHO ENTRADA"), true);
  assert.equal(pareceSemEntrada("Não  tenho   a  entrada"), true);
  assert.equal(pareceSemEntrada("  sem entrada  "), true);
});

test("dispara mesmo quando a frase vem no meio de um texto longo", () => {
  const longa =
    "Boa noite! Gostei muito da carta de 80 mil que vocês mandaram, " +
    "conversei com minha esposa e a gente quer muito, mas não tenho a entrada " +
    "no momento. Tem alguma coisa que dê pra fazer?";
  assert.equal(pareceSemEntrada(longa), true);
});

// ---------------------------------------------------------------------------
// LADO B — o que NÃO pode disparar
// ---------------------------------------------------------------------------
// Este bloco é a razão de o detector usar regex em vez de `includes`. As duas
// primeiras frases estão a duas letras de distância dos gatilhos do lado A, e
// significam o CONTRÁRIO. Sem elas, este arquivo não prova nada.
// ---------------------------------------------------------------------------

test("NAO dispara em quem TEM a entrada", () => {
  const frases = [
    "tenho a entrada",
    "tenho entrada sim",
    "já tenho a entrada separada",
    "eu tenho a entrada de 30 mil",
    "tenho a entrada e quero fechar hoje",
  ];
  for (const f of frases) {
    assert.equal(pareceSemEntrada(f), false, `NAO deveria disparar: ${f}`);
  }
});

test("NAO dispara em quem so esta PERGUNTANDO o valor da entrada", () => {
  const frases = [
    "quanto é a entrada?",
    "qual a entrada dessa carta?",
    "qual o valor da entrada?",
    "me explica como funciona a entrada",
    "a entrada pode ser no cartão?",
  ];
  for (const f of frases) {
    assert.equal(pareceSemEntrada(f), false, `NAO deveria disparar: ${f}`);
  }
});

test("NAO dispara quando falta OUTRA coisa que nao a entrada", () => {
  // "tenho a entrada mas não tenho o resto" é o caso adversarial: contém
  // "não tenho o", e mesmo assim a pessoa TEM a entrada. Se algum dia o
  // padrão do valor for afrouxado, é este teste que fica vermelho.
  const frases = [
    "tenho a entrada mas não tenho o resto",
    "não tenho o documento em mãos",
    "não tenho o CPF do meu marido aqui",
    "não tenho o comprovante ainda",
  ];
  for (const f of frases) {
    assert.equal(pareceSemEntrada(f), false, `NAO deveria disparar: ${f}`);
  }
});

test("NAO dispara em ruido curto nem em vazio", () => {
  for (const f of ["", " ", "ok", "sim", "oi", "?", null, undefined]) {
    assert.equal(pareceSemEntrada(f), false, `NAO deveria disparar: ${JSON.stringify(f)}`);
  }
});

// ---------------------------------------------------------------------------
// Qual gatilho pegou — o que a aferição vai ler
// ---------------------------------------------------------------------------

test("nomeia a familia que disparou, para a afericao saber onde mexer", () => {
  assert.equal(gatilhoSemEntrada("não tenho entrada"), "nao-tenho-entrada");
  assert.equal(gatilhoSemEntrada("tem consórcio sem entrada?"), "sem-entrada");
  assert.equal(gatilhoSemEntrada("não tenho esse valor"), "nao-tenho-o-valor");
  assert.equal(gatilhoSemEntrada("só consigo a parcela"), "so-a-parcela");
  assert.equal(gatilhoSemEntrada("dá pra parcelar a entrada?"), "parcelar-entrada");
  assert.equal(gatilhoSemEntrada("não tenho como dar entrada"), "nao-consigo-dar-entrada");
  assert.equal(gatilhoSemEntrada("tenho a entrada"), null);
});

// ---------------------------------------------------------------------------
// A etiqueta
// ---------------------------------------------------------------------------

test("etiqueta so aparece quando o gatilho pegou", () => {
  assert.deepEqual(etiquetasSemEntrada("não tenho entrada"), [TAG_CONSORCIO_NOVO]);
  assert.deepEqual(etiquetasSemEntrada("tenho a entrada"), []);
  assert.deepEqual(etiquetasSemEntrada(null), []);
});

test("a etiqueta canonica e 'consorcio_novo' — sem acento e com underscore", () => {
  // Vai para wa_conversas.tags e para a busca do painel. Se a grafia mudar
  // sem este teste, a etiqueta some da tela sem ninguém perceber.
  assert.equal(TAG_CONSORCIO_NOVO, "consorcio_novo");
});
