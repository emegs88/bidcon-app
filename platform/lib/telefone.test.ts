// ============================================================================
// telefone.test.ts — a chave de comparação, e o espelho com o lado SQL
// ----------------------------------------------------------------------------
// PARA QUE ESTE TESTE EXISTE. A FUNIL-01 F3 liga uma conversa de WhatsApp a
// uma captação já existente comparando telefone. Comparar telefone nesta casa
// é comparar DUAS RÉGUAS QUE DISCORDAM:
//   `normalizarTelefoneBR` (lib/telefone.ts:7)          ACRESCENTA o 55
//   `sentinela_telefone_norm` (0083:107, no banco)      CORTA o 55
// A chave existe para que as duas cheguem na MESMA string. Se um dia elas
// divergirem, é este arquivo que avisa — e não o cedente que recebeu duas
// vezes a mesma mensagem, nem a captação duplicada que ninguém viu nascer.
//
// O CASO REAL QUE MOTIVOU A CHAVE, medido em xtv em 02/09/2026:
//   captação do Leandro   82981131987   (com o nono dígito)
//   conversa do Leandro  558281131987   (sem o nono dígito)
// O que separa as duas linhas NÃO é o DDI — é o nono dígito. Nenhuma das duas
// réguas acima faz uma virar a outra.
//
// O QUE ELE **NÃO** PROVA. Não prova o lado SQL: `telefone_chave(text)` mora
// em `ident01/FUNIL-01_F3_telefone_chave_NAO_APLICAR.sql` e ainda espera gate.
// A prova daquele lado é a leitura pela porta com estas MESMAS entradas,
// conferida contra a tabela ESPELHO abaixo, que existe justamente para ser
// copiada para dentro de um `select`. Se você mudar um valor aqui sem rodar o
// espelho no banco, quebrou o par sem que ninguém perceba.
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizarTelefoneBR,
  chaveTelefone,
  TELEFONES_DA_CASA,
  ehTelefoneDaCasa,
} from "./telefone";

// ----------------------------------------------------------------------------
// A TABELA ESPELHO. Entrada bruta → chave esperada. Estas linhas são as mesmas
// que devem ser lidas pela porta contra `telefone_chave` (ou, enquanto a
// função não estiver aplicada, contra a expressão inlinada
// `left(sentinela_telefone_norm(x),2) || right(sentinela_telefone_norm(x),8)`
// com a guarda de comprimento).
// ----------------------------------------------------------------------------
const ESPELHO: ReadonlyArray<readonly [string, string | null]> = [
  // O par do Leandro — as duas pontas do mesmo cedente, uma em cada tabela.
  ["82981131987", "8281131987"], // captacoes.telefone, com o nono dígito
  ["558281131987", "8281131987"], // wa_conversas.telefone, sem o nono dígito

  // DDD 55 (Santa Maria / Uruguaiana). É um DDD legítimo e NÃO pode ser
  // confundido com o DDI. As três formas do mesmo assinante caem na mesma
  // chave, e a chave começa com 55 porque o DDD é 55.
  ["5599123456", "5599123456"], // 10 dígitos, DDD 55, antes do nono dígito
  ["55999123456", "5599123456"], // 11 dígitos, DDD 55, depois do nono dígito
  ["5555999123456", "5599123456"], // 13 dígitos: DDI 55 + DDD 55 + celular

  // Fora de 10/11 dígitos úteis, NULL. Nunca uma chave plausível.
  ["351912345678", null], // Portugal: há conversa assim em wa_conversas
  ["12345", null], // lixo curto: left(2)+right(8) se sobreporiam
  ["", null],
];

test("a chave junta as duas pontas do mesmo cedente e separa o resto", () => {
  for (const [bruto, esperada] of ESPELHO) {
    assert.equal(
      chaveTelefone(bruto),
      esperada,
      `chaveTelefone(${JSON.stringify(bruto)})`
    );
  }
});

test("o par do Leandro colapsa — que é a razão de a chave existir", () => {
  const daCaptacao = chaveTelefone("82981131987");
  const daConversa = chaveTelefone("558281131987");
  assert.equal(daCaptacao, daConversa);
  assert.equal(daCaptacao, "8281131987");

  // CONTROLE NEGATIVO da própria afirmação: as réguas cruas NÃO colapsam.
  // Se esta linha cair, alguém "consertou" a normalização e a chave virou
  // enfeite — o que seria uma notícia boa, mas precisa ser vista.
  assert.notEqual(
    normalizarTelefoneBR("82981131987"),
    normalizarTelefoneBR("558281131987")
  );
});

test("a isca: dois números que diferem NO MEIO têm chaves diferentes", () => {
  // Mesmo DDD, mesmo comprimento, mesmo começo e mesmo fim de bloco — só o
  // miolo muda. Se a chave devolvesse a mesma string aqui, ela estaria
  // colando gente diferente, que é o único erro caro desta função.
  const a = chaveTelefone("11987654321");
  const b = chaveTelefone("11981654321");
  assert.equal(a, "1187654321");
  assert.equal(b, "1181654321");
  assert.notEqual(a, b);
});

test("a chave NÃO é um formato de guardar telefone", () => {
  // Ela é derivada e nunca persistida. Se algum dia alguém gravar o retorno
  // desta função numa coluna, esta linha é o lembrete de que ela não tem DDI
  // e não é E.164.
  const bruto = "5511987654321";
  assert.equal(normalizarTelefoneBR(bruto), "5511987654321");
  assert.equal(chaveTelefone(bruto), "1187654321");
  assert.notEqual(chaveTelefone(bruto), normalizarTelefoneBR(bruto));
});

test("entrada ausente ou inútil não produz chave", () => {
  for (const cru of [null, undefined, "", "   ", "abc", 0, {}, []]) {
    assert.equal(
      chaveTelefone(cru),
      null,
      `deveria ser null: ${JSON.stringify(cru)}`
    );
  }
});

// ----------------------------------------------------------------------------
// OS TELEFONES DA CASA. Lista provisória, conteúdo dado pelo Emerson em
// 02/09/2026. Sem ela, a conversa do próprio Emerson com a Sentinela vira uma
// captação de cedente.
// ----------------------------------------------------------------------------
test("a lista da casa é exatamente a dita, sem sobra e sem falta", () => {
  assert.deepEqual([...TELEFONES_DA_CASA].sort(), [
    "5511973202967",
    "5519997561909",
  ]);
});

test("os dois números da casa são reconhecidos em qualquer formatação", () => {
  for (const cru of [
    "5519997561909", // como está em wa_conversas
    "19997561909", // sem DDI
    "(19) 99756-1909", // como um humano digita
    "5511973202967", // o canônico, o mesmo dos três NUMERO_EXCLUIDO
    "11973202967",
  ]) {
    assert.equal(ehTelefoneDaCasa(cru), true, `deveria ser da casa: ${cru}`);
  }
});

test("cedente NÃO é confundido com a casa", () => {
  for (const cru of [
    "82981131987", // Leandro
    "558281131987", // Leandro, a outra ponta
    "5519997561900", // vizinho do número da casa: muda o último dígito
    "5511973202967".slice(0, -1) + "8", // idem, no canônico
    null,
    undefined,
    "",
    "351912345678",
  ]) {
    assert.equal(
      ehTelefoneDaCasa(cru),
      false,
      `NÃO deveria ser da casa: ${JSON.stringify(cru)}`
    );
  }
});
