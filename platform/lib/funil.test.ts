// ============================================================================
// Teste do interruptor da mesa (FUNIL-01, F2)
// ----------------------------------------------------------------------------
// Um grupo só, porque a lib tem uma responsabilidade só — e ela é a que erra
// mais caro de todas: um interruptor que arma sozinho é pior do que não ter
// interruptor, porque a casa acredita que está desligada.
//
// 1. NOME. O switch tem de continuar se chamando `FUNIL`, que é o nome escrito
//    no `.env.example` e o que alguém vai digitar às duas da manhã para
//    desarmar. Renomear a constante sem renomear a variável de ambiente é uma
//    mudança que compila, passa no build e deixa o botão de emergência ligado
//    a fio nenhum. Por isso o nome é preso por igualdade literal aqui, e não
//    derivado da própria constante — um teste que compara a constante consigo
//    mesma passa sempre e não prova nada.
//
// 2. ESTADO INICIAL E VIZINHANÇA DO `on`. Seis estados desarmam, um arma. Os
//    seis não são decoração: cada um é um erro que já se comete de verdade —
//    a variável nunca criada, criada e vazia, preenchida com a palavra
//    verdadeiro em inglês por hábito de outra linguagem, com o algarismo 1
//    pelo mesmo hábito, em caixa alta por autocorreção, e com `off` escrito à
//    mão, que é literalmente o que o `.env.example` mostra. Se qualquer um
//    deles armasse, a fatia entraria no ar sem ninguém pedir.
//
// A env é estado GLOBAL do processo, e o runner roda os arquivos de teste no
// mesmo processo. Por isso o valor anterior é guardado antes e devolvido num
// `finally` — inclusive no caso de a variável não existir, em que devolver
// significa apagar de novo, e não escrever string vazia. Teste que suja a env
// e vai embora quebra o teste do vizinho, e o vizinho leva a culpa.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";

import { ENV_KILL_SWITCH, funilLigado } from "./funil";

test("FUNIL-01: o interruptor se chama FUNIL, nasce desarmado e só `on` arma", () => {
  assert.equal(ENV_KILL_SWITCH, "FUNIL");

  const antes = process.env[ENV_KILL_SWITCH];
  try {
    delete process.env[ENV_KILL_SWITCH];
    assert.equal(funilLigado(), false, "ausente tem de desarmar");

    process.env[ENV_KILL_SWITCH] = "";
    assert.equal(funilLigado(), false, "vazia tem de desarmar");

    process.env[ENV_KILL_SWITCH] = "true";
    assert.equal(funilLigado(), false, "a palavra verdadeiro em ingles nao arma");

    process.env[ENV_KILL_SWITCH] = "1";
    assert.equal(funilLigado(), false, "o algarismo 1 nao arma");

    process.env[ENV_KILL_SWITCH] = "ON";
    assert.equal(funilLigado(), false, "caixa alta nao arma");

    process.env[ENV_KILL_SWITCH] = "off";
    assert.equal(funilLigado(), false, "o valor do .env.example desarma");

    process.env[ENV_KILL_SWITCH] = "on";
    assert.equal(funilLigado(), true, "so a palavra exata arma");
  } finally {
    if (antes === undefined) delete process.env[ENV_KILL_SWITCH];
    else process.env[ENV_KILL_SWITCH] = antes;
  }
});
