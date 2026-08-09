// ============================================================================
// rupload.test.ts — as três assimetrias do resumable, sob teste (FASE2-A)
// ----------------------------------------------------------------------------
// O QUE ESTE ARQUIVO PROTEGE. O caminho resumable difere da Graph em host,
// esquema de autorização e formato de corpo. Nenhuma das três diferenças
// aparece na leitura casual do código — todas as três aparecem como "erro de
// autorização" ou "erro de rede" em produção, que é o pior lugar para
// descobri-las e a pista mais enganosa possível.
//
// O teste do `OAuth` é o mais importante do arquivo. Se alguém uniformizar os
// headers da casa para `Bearer` numa refatoração bem-intencionada, a suíte
// quebra AQUI, com o nome do problema escrito — em vez de o reel parar de
// publicar e alguém passar uma tarde renovando um token que estava bom.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import {
  RUPLOAD_HOST,
  RUPLOAD_VERSION,
  enviarBytesResumable,
  headersRupload,
  lerRespostaRupload,
  urlRupload,
} from "./rupload";

// ---------------------------------------------------------------------------
// URL
// ---------------------------------------------------------------------------
test("urlRupload: host de upload, não a Graph", () => {
  const u = urlRupload("17999");
  assert.ok(u.startsWith(RUPLOAD_HOST), `esperava começar com ${RUPLOAD_HOST}, veio ${u}`);
  assert.ok(!u.includes("graph.instagram.com"), "não pode apontar para a Graph");
  assert.equal(u, `${RUPLOAD_HOST}/ig-api-upload/${RUPLOAD_VERSION}/17999`);
});

test("urlRupload: o container vai no CAMINHO, nunca em query", () => {
  const u = urlRupload("17999");
  assert.ok(!u.includes("?"), "não deve haver query string");
  assert.ok(u.endsWith("/17999"));
});

test("urlRupload: id é escapado — id torto não vira outra rota", () => {
  const u = urlRupload("a/b?c=d");
  assert.ok(!u.includes("a/b"), "a barra do id não pode virar separador de caminho");
  assert.ok(u.includes("a%2Fb"));
});

// ---------------------------------------------------------------------------
// HEADERS — o coração do arquivo
// ---------------------------------------------------------------------------
test("headersRupload: OAuth, NÃO Bearer (a assimetria cara)", () => {
  const h = headersRupload("TOKEN123", 2_600_000);
  assert.equal(h.Authorization, "OAuth TOKEN123");
  assert.ok(
    !h.Authorization.includes("Bearer"),
    "o resto da casa usa Bearer; este endpoint exige OAuth — ver header do rupload.ts"
  );
});

test("headersRupload: file_size e offset são strings de header, não campos de corpo", () => {
  const h = headersRupload("T", 2_600_000);
  assert.equal(h.file_size, "2600000");
  assert.equal(h.offset, "0");
  assert.equal(typeof h.file_size, "string");
});

test("headersRupload: offset entra por parâmetro, para o dia em que a retomada existir", () => {
  assert.equal(headersRupload("T", 100, 42).offset, "42");
});

test("headersRupload: corpo é binário, não JSON", () => {
  assert.equal(headersRupload("T", 1)["content-type"], "application/octet-stream");
});

// ---------------------------------------------------------------------------
// LEITURA DA RESPOSTA
// ---------------------------------------------------------------------------
test("lerRespostaRupload: sucesso exige o success literal", () => {
  assert.deepEqual(lerRespostaRupload(true, 200, { success: true }), { ok: true });
});

test("lerRespostaRupload: 200 sem success NÃO é sucesso", () => {
  // Este é o modo silencioso de falhar que a fatia existe para eliminar:
  // aceitar isto publicaria um container sem bytes.
  const r = lerRespostaRupload(true, 200, { mensagem: "oi" });
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.erro.includes("resposta_sem_success"));
});

test("lerRespostaRupload: success:'true' string não conta", () => {
  const r = lerRespostaRupload(true, 200, { success: "true" });
  assert.equal(r.ok, false);
});

test("lerRespostaRupload: erro repassa retriable — a única pista sobre insistir", () => {
  const r = lerRespostaRupload(false, 400, {
    debug_info: { type: "UploadError", message: "bad offset", retriable: true },
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.erro.includes("http_400"));
    assert.ok(r.erro.includes("type=UploadError"));
    assert.ok(r.erro.includes("retriable=true"));
    assert.ok(r.erro.includes("bad offset"));
  }
});

test("lerRespostaRupload: retriable=false aparece — não é omitido por ser falso", () => {
  const r = lerRespostaRupload(false, 400, { debug_info: { retriable: false } });
  assert.ok(!r.ok && r.erro.includes("retriable=false"));
});

test("lerRespostaRupload: corpo ilegível ainda produz erro nomeado", () => {
  const r = lerRespostaRupload(false, 500, null);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.erro.includes("http_500"));
});

test("lerRespostaRupload: erro é limitado a 800 chars — log não vira despejo", () => {
  const r = lerRespostaRupload(false, 400, { debug_info: { message: "x".repeat(5000) } });
  assert.ok(!r.ok && r.erro.length <= 800);
});

// ---------------------------------------------------------------------------
// GUARDAS DE ENTRADA — sem rede
// ---------------------------------------------------------------------------
test("enviarBytesResumable: sem token, erro nomeado e nenhuma chamada", async () => {
  const r = await enviarBytesResumable({
    containerId: "1",
    bytes: new Uint8Array([1, 2, 3]),
    token: "",
  });
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.erro.includes("env_ausente"));
});

test("enviarBytesResumable: zero byte é recusado antes da rede", async () => {
  // Mesma doutrina do `download_vazio` da rota: 200 com corpo vazio é o modo
  // silencioso de falhar de URL expirada. Subir isso publica um reel quebrado.
  const r = await enviarBytesResumable({
    containerId: "1",
    bytes: new Uint8Array(0),
    token: "T",
  });
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.erro === "bytes_vazios");
});

test("enviarBytesResumable: devolve ms e bytes TAMBÉM no erro", () => {
  // O custo pedido pela coordenação só serve se aparecer quando dá errado:
  // um push que morre aos 59s conta história diferente de um que morre aos 200ms.
  return enviarBytesResumable({ containerId: "1", bytes: new Uint8Array(0), token: "T" }).then(
    (r) => {
      assert.equal(typeof r.ms, "number");
      assert.equal(typeof r.bytes, "number");
    }
  );
});
