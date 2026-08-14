// ============================================================================
// BIDCON-ASSINATURA-01 — testes da lógica PURA da fatia.
// ----------------------------------------------------------------------------
// Cobre o que decide sozinho, sem rede e sem banco:
//   1. segredoConfere  — o único portão do webhook público;
//   2. mapa de status  — o que vira 'parcial', 'assinado', 'recusado';
//   3. interpretarEventoZapSign — tem que aguentar corpo hostil sem jogar;
//   4. partirTelefone / pathDocumento — formato que vai ao provedor e ao bucket.
//
// O que NÃO está aqui, de propósito: criarEnvelope e baixarAssinado falam HTTP
// com a ZapSign. Um teste com fetch mockado só provaria que o mock combina com
// o que EU escrevi — e o formato de fio da ZapSign não foi medido contra conta
// real (ver o aviso no topo de zapsign.ts). Seria confiança comprada, não
// medida. Essa parte se prova no primeiro envio real.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";

import { segredoConfere } from "./seguranca";
import {
  interpretarEventoZapSign,
  mapearStatusEnvelope,
  mapearStatusSignatario,
  partirTelefone,
} from "./zapsign";
import { pathDocumento } from "./index";

// --- 1. segredo do webhook ---------------------------------------------------

test("segredoConfere aceita o segredo exato", () => {
  assert.equal(segredoConfere("s3gr3d0-longo", "s3gr3d0-longo"), true);
});

test("segredoConfere recusa segredo errado do mesmo tamanho", () => {
  assert.equal(segredoConfere("s3gr3d0-longo", "s3gr3d0-longX"), false);
});

test("segredoConfere recusa tamanhos diferentes SEM jogar", () => {
  // timingSafeEqual joga RangeError com buffers de tamanhos distintos; o
  // sha256 antes da comparação é justamente o que impede isso.
  assert.doesNotThrow(() => segredoConfere("curto", "um-segredo-bem-mais-comprido"));
  assert.equal(segredoConfere("curto", "um-segredo-bem-mais-comprido"), false);
});

test("segredoConfere falha FECHADO quando a env não está configurada", () => {
  // Deploy sem ZAPSIGN_WEBHOOK_SECRET não pode virar webhook aberto.
  assert.equal(segredoConfere("", ""), false);
  assert.equal(segredoConfere("qualquer", ""), false);
  assert.equal(segredoConfere("", "esperado"), false);
  assert.equal(segredoConfere(null, "esperado"), false);
  assert.equal(segredoConfere("recebido", undefined), false);
});

// --- 2. mapa de status -------------------------------------------------------

test("mapearStatusSignatario traduz os estados conhecidos", () => {
  assert.equal(mapearStatusSignatario("signed"), "assinado");
  assert.equal(mapearStatusSignatario("SIGNED"), "assinado");
  assert.equal(mapearStatusSignatario("refused"), "recusado");
  assert.equal(mapearStatusSignatario("link-opened"), "visualizou");
  assert.equal(mapearStatusSignatario("new"), "pendente");
  assert.equal(mapearStatusSignatario(""), "pendente");
});

test("envelope pendente sem ninguém assinado é 'enviado'", () => {
  assert.equal(mapearStatusEnvelope("pending", ["pendente", "pendente"]), "enviado");
});

test("envelope pendente com alguém assinado é 'parcial'", () => {
  // 'parcial' não existe na ZapSign — é derivado aqui. Sem isso o admin não
  // saberia de quem está esperando.
  assert.equal(mapearStatusEnvelope("pending", ["assinado", "pendente"]), "parcial");
});

test("mapearStatusEnvelope traduz os estados terminais", () => {
  assert.equal(mapearStatusEnvelope("signed", ["assinado"]), "assinado");
  assert.equal(mapearStatusEnvelope("refused", ["recusado"]), "recusado");
  assert.equal(mapearStatusEnvelope("deleted", []), "cancelado");
  assert.equal(mapearStatusEnvelope("expired", []), "expirado");
});

test("status desconhecido NÃO mexe no envelope", () => {
  // Evento de e-mail entregue, por exemplo: loga e não escreve status.
  assert.equal(mapearStatusEnvelope("email_delivered", ["assinado"]), null);
  assert.equal(mapearStatusEnvelope("", []), null);
});

// --- 3. interpretação do corpo do webhook ------------------------------------

test("interpretarEventoZapSign extrai envelope, signatários e PDF assinado", () => {
  const evento = interpretarEventoZapSign({
    event_type: "doc_signed",
    token: "env-abc",
    status: "signed",
    signed_file: "https://zapsign.example/assinado.pdf",
    signers: [
      { token: "sig-1", status: "signed" },
      { token: "sig-2", status: "signed" },
    ],
  });

  assert.equal(evento.tipoCru, "doc_signed");
  assert.equal(evento.provedorEnvelopeId, "env-abc");
  assert.equal(evento.statusEnvelope, "assinado");
  assert.equal(evento.urlArquivoAssinado, "https://zapsign.example/assinado.pdf");
  assert.deepEqual(evento.signatarios, [
    { provedorSignerId: "sig-1", status: "assinado" },
    { provedorSignerId: "sig-2", status: "assinado" },
  ]);
});

test("sem event_type, o log ainda guarda o status cru", () => {
  const evento = interpretarEventoZapSign({ token: "env-abc", status: "pending", signers: [] });
  assert.equal(evento.tipoCru, "status:pending");
});

test("interpretarEventoZapSign não joga com corpo hostil", () => {
  // O webhook é endpoint público: o corpo pode ser QUALQUER coisa. Jogar aqui
  // viraria 500 e o provedor ficaria reenviando.
  for (const lixo of [null, undefined, "texto", 42, [], { signers: "não é lista" }]) {
    assert.doesNotThrow(() => interpretarEventoZapSign(lixo), `corpo: ${JSON.stringify(lixo)}`);
    const evento = interpretarEventoZapSign(lixo);
    assert.equal(evento.provedorEnvelopeId, null);
    assert.equal(evento.statusEnvelope, null);
    assert.deepEqual(evento.signatarios, []);
  }
});

test("signatário sem token do provedor é descartado", () => {
  // Sem token não há como casar a linha no banco; guardar viraria lixo órfão.
  const evento = interpretarEventoZapSign({
    token: "env-abc",
    status: "pending",
    signers: [{ status: "signed" }, { token: "sig-2", status: "new" }],
  });
  assert.deepEqual(evento.signatarios, [{ provedorSignerId: "sig-2", status: "pendente" }]);
  // O descartado NÃO conta para derivar 'parcial'.
  assert.equal(evento.statusEnvelope, "enviado");
});

// --- 4. formato de telefone e de path ----------------------------------------

test("partirTelefone separa DDI 55 do número", () => {
  assert.deepEqual(partirTelefone("5519988303000"), { pais: "55", numero: "19988303000" });
  assert.deepEqual(partirTelefone("+55 (19) 98830-3000"), {
    pais: "55",
    numero: "19988303000",
  });
});

test("partirTelefone devolve null em vez de número truncado", () => {
  assert.equal(partirTelefone("1988303000"), null); // sem DDI
  assert.equal(partirTelefone("351912345678"), null); // DDI estrangeiro
  assert.equal(partirTelefone(""), null);
  assert.equal(partirTelefone(null), null);
});

test("pathDocumento usa o prefixo do processo e separa assinado", () => {
  const proc = "11111111-2222-3333-4444-555555555555";
  assert.equal(pathDocumento(proc, "cessao", false, 1700000000000), `${proc}/cessao-1700000000000.pdf`);
  assert.equal(
    pathDocumento(proc, "requerimento-conta", true, 1700000000000),
    `${proc}/requerimento-conta-assinado-1700000000000.pdf`
  );
});
