// ============================================================================
// Teste da guarda do fundo (FIDC-OFERTAS-01 · Entrega 2)
// ----------------------------------------------------------------------------
// Uma guarda de acesso só vale o que valem as suas BORDAS, e as bordas desta
// são três estados que a 0078 permite existir e que ninguém encontra por acaso:
// fundo suspenso, lista de e-mails vazia, e o mesmo e-mail em dois fundos.
//
// Todos os casos abaixo exercitam `decidirAcesso`, que é pura de propósito: se a
// decisão morasse junto da consulta, testar "fundo suspenso" exigiria banco de
// pé com uma linha suspensa dentro — e ninguém escreve esse teste, então ele não
// existiria.
//
// Três grupos:
//
// 1. QUEM NÃO ENTRA. O grupo maior, e é assim que tem de ser. Toda linha aqui é
//    uma porta que alguém poderia atravessar por descuido de código.
//
// 2. QUEM ENTRA. Um caso só, e o cerco em volta dele: entra o fundo ATIVO cujo
//    e-mail confere ignorando caixa.
//
// 3. LÉXICO. Estes motivos podem chegar a uma tela. "fidc" é palavra proibida na
//    régua da casa (medido em lib/lexico.ts), e seria muito fácil escrever "seu
//    FIDC está suspenso" sem pensar. A régua passa por cima de todos eles.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";

import { garantirLexico } from "@/lib/lexico";
import {
  decidirAcesso,
  normalizarEmail,
  type FundoLinha,
} from "@/lib/fidc-fundos";

const EMAIL = "gestor@fundoexemplo.com.br";

function fundo(over: Partial<FundoLinha> = {}): FundoLinha {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    nome: "Fundo Exemplo",
    status: "ativo",
    emails_autorizados: [EMAIL],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. QUEM NÃO ENTRA
// ---------------------------------------------------------------------------

test("sem linha nenhuma: recusa, e não confunde com falha de leitura", () => {
  const r = decidirAcesso([], EMAIL);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.status, 403);
  assert.match(r.motivo, /nenhum fundo/);
});

test("sessão sem e-mail: recusa em vez de casar com lista vazia", () => {
  // A borda que morde: `[]` casaria com `[]` numa comparação ingênua, e um
  // usuário sem e-mail entraria como o primeiro fundo cadastrado.
  for (const vazio of [null, undefined, "", "   "]) {
    const r = decidirAcesso([fundo({ emails_autorizados: [] })], vazio);
    assert.equal(r.ok, false, `deveria recusar para ${JSON.stringify(vazio)}`);
    if (r.ok) return;
    assert.equal(r.status, 403);
  }
});

test("fundo suspenso: recusa DIZENDO que está suspenso", () => {
  // O motivo é o ponto do teste, não o booleano. Ver decisão (1) no cabeçalho
  // de lib/fidc-fundos.ts: filtrar status na consulta transformaria isto em
  // "e-mail não autorizado", que é falso.
  const r = decidirAcesso([fundo({ status: "suspenso" })], EMAIL);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.status, 403);
  assert.match(r.motivo, /suspenso/);
});

test("status desconhecido não vira 'ativo' por omissão", () => {
  // O banco só permite ativo|suspenso (CHECK da 0078). Se um dia permitir mais,
  // a guarda nega o que não sabe ler, em vez de deixar passar.
  for (const s of [null, "", "pendente", "ATIVO"]) {
    const r = decidirAcesso([fundo({ status: s })], EMAIL);
    assert.equal(r.ok, false, `status ${JSON.stringify(s)} não podia entrar`);
  }
});

test("lista de e-mails vazia: fundo cadastrado que ainda não pode entrar", () => {
  // Estado legítimo e proposital, nas palavras da própria 0078.
  const r = decidirAcesso([fundo({ emails_autorizados: [] })], EMAIL);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.motivo, /nenhum fundo/);
});

test("emails_autorizados nulo não explode — recusa", () => {
  const r = decidirAcesso([fundo({ emails_autorizados: null })], EMAIL);
  assert.equal(r.ok, false);
});

test("linha que não contém o e-mail é reconferida e descartada", () => {
  // A consulta trouxe; a decisão confere de novo. Protege o dia em que alguém
  // alimentar esta função com uma lista vinda de cache ou de um select largo.
  const r = decidirAcesso([fundo({ emails_autorizados: ["outro@x.com"] })], EMAIL);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.motivo, /nenhum fundo/);
});

test("mesmo e-mail em dois fundos: recusa em vez de escolher um", () => {
  // Nada no banco impede isto, e "pegar o primeiro" faria a oferta sair
  // assinada pelo fundo errado, em silêncio.
  const r = decidirAcesso(
    [
      fundo(),
      fundo({ id: "22222222-2222-2222-2222-222222222222", nome: "Outro Fundo" }),
    ],
    EMAIL
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.status, 403);
  assert.match(r.motivo, /mais de um fundo/);
});

test("dois fundos, só um com o e-mail: entra, sem ambiguidade", () => {
  const r = decidirAcesso(
    [
      fundo({ emails_autorizados: ["outro@x.com"] }),
      fundo({ id: "33333333-3333-3333-3333-333333333333", nome: "Certo" }),
    ],
    EMAIL
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.fundo.nome, "Certo");
});

// ---------------------------------------------------------------------------
// 2. QUEM ENTRA
// ---------------------------------------------------------------------------

test("fundo ativo com o e-mail na lista: entra, e traz id e nome", () => {
  const r = decidirAcesso([fundo()], EMAIL);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.fundo.id, "11111111-1111-1111-1111-111111111111");
  assert.equal(r.fundo.nome, "Fundo Exemplo");
});

test("caixa e espaço não decidem acesso, dos dois lados", () => {
  const r = decidirAcesso(
    [fundo({ emails_autorizados: ["  Gestor@FundoExemplo.COM.BR "] })],
    "  GESTOR@fundoexemplo.com.br  "
  );
  assert.equal(r.ok, true);
});

test("normalizarEmail: minúsculas, sem pontas, e nulo vira string vazia", () => {
  assert.equal(normalizarEmail("  A@B.COM "), "a@b.com");
  assert.equal(normalizarEmail(null), "");
  assert.equal(normalizarEmail(undefined), "");
  assert.equal(normalizarEmail(""), "");
});

// ---------------------------------------------------------------------------
// 3. LÉXICO
// ---------------------------------------------------------------------------

test("nenhum motivo de recusa verbaliza termo proibido", () => {
  const recusas = [
    decidirAcesso([], EMAIL),
    decidirAcesso([fundo()], null),
    decidirAcesso([fundo({ status: "suspenso" })], EMAIL),
    decidirAcesso([fundo({ emails_autorizados: [] })], EMAIL),
    decidirAcesso([fundo(), fundo({ id: "b" })], EMAIL),
  ];
  for (const r of recusas) {
    assert.equal(r.ok, false);
    if (r.ok) continue;
    const lex = garantirLexico(r.motivo);
    assert.equal(
      lex.ok,
      true,
      `motivo reprovado pelo léxico: ${JSON.stringify(r.motivo)}`
    );
  }
});
