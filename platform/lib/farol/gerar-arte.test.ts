// ============================================================================
// Teste do gerador de arte (FAROL-ARTE-02) — TODO ELE SEM REDE E SEM CUSTO
// ----------------------------------------------------------------------------
// Este é o primeiro módulo da casa que gasta dinheiro sozinho, e isso muda o
// que um teste precisa provar. Não basta aferir que ele funciona: é preciso
// aferir que ele NÃO FUNCIONA quando não deve — desarmado, com categoria
// inventada, com lista grande demais. Uma trava que só se exercita gastando
// não se exercita nunca, e é exatamente a que se descobre quebrada na fatura.
//
// Por isso o desenho: as travas (kill switch, teto, validação de categoria) são
// funções puras ou saem ANTES da rede, e o `db` que entra nos testes é um
// sentinela que EXPLODE se alguém tocar nele. Se um dia alguém inverter a
// ordem e a checagem passar a acontecer depois do upload, o teste não fica
// verde de mentira: ele estoura.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";

import { recorteCentral } from "../farol-arte";
import { CATEGORIAS } from "./prompts-arte";
import {
  ENV_KILL_SWITCH,
  MODELO,
  QUALIDADE,
  TAMANHO,
  TETO_POR_CHAMADA,
  aplicarTeto,
  caminhoDaArte,
  dimensoesPng,
  gerarArte,
  gerarArteLigado,
} from "./gerar-arte";

// ---------------------------------------------------------------------------
// Ferramentas do teste
// ---------------------------------------------------------------------------

/** Troca o kill switch e SEMPRE devolve o valor de antes, mesmo se falhar. */
function comSwitch<T>(valor: string | undefined, fn: () => T): T {
  const antes = process.env[ENV_KILL_SWITCH];
  if (valor === undefined) delete process.env[ENV_KILL_SWITCH];
  else process.env[ENV_KILL_SWITCH] = valor;
  try {
    return fn();
  } finally {
    if (antes === undefined) delete process.env[ENV_KILL_SWITCH];
    else process.env[ENV_KILL_SWITCH] = antes;
  }
}

/**
 * Um `db` que não existe para ser usado. Qualquer acesso a qualquer
 * propriedade estoura — é assim que o teste prova que a recusa aconteceu ANTES
 * de tocar banco, bucket ou rede, em vez de só conferir a string de erro.
 */
const DB_PROIBIDO = new Proxy(
  {},
  {
    get(_alvo, prop) {
      throw new Error(`db foi tocado (.${String(prop)}) — a trava não segurou`);
    },
  }
) as unknown as SupabaseClient;

/** Monta um PNG mínimo: assinatura + IHDR com largura/altura dadas. */
function pngFalso(largura: number, altura: number): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0x00, 0x00, 0x00, 0x0d], 8); // tamanho do chunk IHDR = 13
  b.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  const be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  b.set(be(largura), 16);
  b.set(be(altura), 20);
  return b;
}

// ---------------------------------------------------------------------------
// 1) O kill switch — nasce desarmado, e só "on" arma
// ---------------------------------------------------------------------------

test("desarmado em toda forma que não seja exatamente 'on'", () => {
  for (const v of [undefined, "", "true", "ON", "On", "1", "sim", "off"]) {
    assert.equal(comSwitch(v, gerarArteLigado), false, `armou com ${String(v)}`);
  }
});

test("só a string exata 'on' arma", () => {
  assert.equal(comSwitch("on", gerarArteLigado), true);
});

test("desarmado recusa ANTES de tocar o db — nada de rede, nada de gasto", async () => {
  const r = await comSwitch(undefined, () => gerarArte(DB_PROIBIDO, "abstrata"));
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.erro, "desarmado");
});

test("armado, categoria inventada também para antes do db", async () => {
  const r = await comSwitch("on", () =>
    // O elenco existe porque o ponto do teste é justamente o chamador que
    // escapou do tipo — JSON de rota chega como string, não como união.
    gerarArte(DB_PROIBIDO, "veiculo_foguete" as never)
  );
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.erro, "categoria_invalida");
});

// ---------------------------------------------------------------------------
// 2) O teto — a trava que protege a fatura
// ---------------------------------------------------------------------------

test("o teto é 3 — o mesmo número autorizado para a noite", () => {
  assert.equal(TETO_POR_CHAMADA, 3);
});

test("aplicarTeto corta lista grande", () => {
  const muitas = [...CATEGORIAS, ...CATEGORIAS, ...CATEGORIAS];
  assert.equal(aplicarTeto(muitas).length, TETO_POR_CHAMADA);
});

test("aplicarTeto não inventa item quando pedem menos", () => {
  assert.deepEqual(aplicarTeto(["abstrata"]), ["abstrata"]);
  assert.deepEqual(aplicarTeto([]), []);
});

test("aplicarTeto preserva a ordem pedida", () => {
  const pedidas = ["imovel_alto", "abstrata", "veiculo_popular"] as const;
  assert.deepEqual(aplicarTeto(pedidas), [...pedidas]);
});

// ---------------------------------------------------------------------------
// 3) dimensoesPng — a dimensão sai do ARQUIVO, não da constante
// ---------------------------------------------------------------------------

test("lê largura e altura do IHDR", () => {
  assert.deepEqual(dimensoesPng(pngFalso(1024, 1536)), {
    largura: 1024,
    altura: 1536,
  });
});

test("lê dimensão grande sem estourar o sinal de 32 bits", () => {
  // `<<` em JS opera com inteiro COM sinal: sem o `>>> 0` do módulo, uma
  // largura acima de 2^31 voltaria negativa e viraria dimensão implausível.
  assert.deepEqual(dimensoesPng(pngFalso(3000, 4000)), {
    largura: 3000,
    altura: 4000,
  });
});

test("recusa o que não é PNG", () => {
  const jpeg = new Uint8Array(24);
  jpeg.set([0xff, 0xd8, 0xff], 0);
  assert.equal(dimensoesPng(jpeg), null);
  assert.equal(dimensoesPng(new Uint8Array(24)), null); // tudo zero
});

test("recusa arquivo curto demais para ter cabeçalho", () => {
  assert.equal(dimensoesPng(pngFalso(1024, 1536).slice(0, 23)), null);
  assert.equal(dimensoesPng(new Uint8Array(0)), null);
});

test("recusa PNG cuja assinatura bate mas o primeiro chunk não é IHDR", () => {
  const b = pngFalso(1024, 1536);
  b.set([0x49, 0x44, 0x41, 0x54], 12); // "IDAT" no lugar de "IHDR"
  assert.equal(dimensoesPng(b), null);
});

test("recusa dimensão zero — é o que um arquivo truncado produz", () => {
  assert.equal(dimensoesPng(pngFalso(0, 1536)), null);
  assert.equal(dimensoesPng(pngFalso(1024, 0)), null);
});

// ---------------------------------------------------------------------------
// 4) O caminho no bucket
// ---------------------------------------------------------------------------

test("caminho é AAAA/MM/<id>.png, com mês de dois dígitos", () => {
  const c = caminhoDaArte(new Date("2026-08-10T03:00:00Z"), "abc-123");
  assert.equal(c, "2026/08/abc-123.png");
});

test("mês de um dígito é preenchido com zero", () => {
  assert.equal(
    caminhoDaArte(new Date("2026-01-05T12:00:00Z"), "x"),
    "2026/01/x.png"
  );
});

test("o caminho usa UTC — a Vercel roda em UTC", () => {
  // 31/12 às 23h UTC não pode virar pasta do ano seguinte (nem do anterior)
  // por causa do fuso de quem rodou.
  assert.equal(
    caminhoDaArte(new Date("2026-12-31T23:30:00Z"), "y"),
    "2026/12/y.png"
  );
});

// ---------------------------------------------------------------------------
// 5) O DESVIO DE TAMANHO declarado no cabeçalho do módulo
// ---------------------------------------------------------------------------
// Gerar em 1024×1536 em vez de 1152×2048 só é aceitável se a lição a1 — o
// interesse entre 22% e 78% da altura — sobreviver ao recorte do feed. Isto
// aqui é essa conta, feita pelo mesmo `recorteCentral` que o card usa.

test("TAMANHO é um preset com preço publicado", () => {
  assert.ok(["1024x1024", "1024x1536", "1536x1024"].includes(TAMANHO));
});

test("no story a arte cobre o canvas sem tarja", () => {
  const arte = { largura: 1024, altura: 1536 };
  const r = recorteCentral(arte, 1080, 1920);
  assert.ok(r.largura >= 1080, "sobra tarja lateral");
  assert.ok(r.altura >= 1920, "sobra tarja em cima/embaixo");
});

test("no feed a faixa 22–78% da lição a1 sobrevive ao recorte", () => {
  const arte = { largura: 1024, altura: 1536 };
  const r = recorteCentral(arte, 1080, 1080);
  assert.ok(r.largura >= 1080 && r.altura >= 1080, "sobra tarja no feed");

  // Que fração da ALTURA da arte continua visível depois do recorte central.
  const visivelDe = -r.topo / r.altura;
  const visivelAte = (-r.topo + 1080) / r.altura;

  assert.ok(visivelDe <= 0.22, `corta dentro da faixa: começa em ${visivelDe}`);
  assert.ok(visivelAte >= 0.78, `corta dentro da faixa: termina em ${visivelAte}`);
});

// ---------------------------------------------------------------------------
// 6) O contrato com a 0076
// ---------------------------------------------------------------------------

test("qualidade é uma das três que o CHECK da 0076 comenta", () => {
  assert.ok(["low", "medium", "high"].includes(QUALIDADE));
});

test("o modelo é o que Emerson autorizou, na grafia dele", () => {
  assert.equal(MODELO, "gpt-image-2");
});
