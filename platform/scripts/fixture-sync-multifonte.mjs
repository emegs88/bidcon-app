// ============================================================================
// Fixture — sync multi-fonte (bidcon plataforma logada). Reproduzível, sem rede
// e sem Postgres. Prova as 3 invariantes exigidas antes de mexer no estoque:
//
//   (1) LANCE INTOCADO   — o parser lê o id nativo em `n` (não `id`) e mantém
//       entradaParceiro = null para TODA carta LANCE, mesmo que o corpo traga
//       entrada_parceiro (Opção B: o cru só existe nas fontes externas).
//
//   (2) COLISÃO DE ID     — cada endpoint numera id 1..N por conta própria.
//       cotas-extra agrega CBC+PIFFER+CARTAS no mesmo corpo: a leitura de uma
//       marca filtra por `fonte` e não puxa as outras. E a rota chama a RPC
//       UMA VEZ POR FONTE, com p_origem distinto — então CBC #1 e SERVOPA #1
//       (mesmo numero nativo) nunca se sobrescrevem (chave real na 0015:
//       índice único (administradora_origem, numero_externo)).
//
//   (3) FALHA PARCIAL     — uma fonte que aborta (HTTP!=200 / parse-vazio) NÃO
//       dispara sync_aplicar_cotas e NÃO toca o estoque das outras: a rota
//       segue o loop, audita o abort em eventos_sync e só as fontes sãs
//       fazem upsert (decisão B — isolamento total entre fontes).
//
// COMO RODA COM CÓDIGO REAL:
//   Transpila lib/cotas-source.ts e app/api/sync-cotas/route.ts (os arquivos
//   REAIS) para um tmp dir via o tsc local, reescreve só os 3 specifiers de
//   módulo do route (next/server, @/lib/supabase-admin, @/lib/cotas-source)
//   para stubs locais + o parser real, e exercita GET()/lerCotasFonte() com
//   global.fetch e um db stub. Nenhuma lógica é reimplementada aqui.
//
// USO:  node scripts/fixture-sync-multifonte.mjs   (a partir de platform/)
// Sai 0 se todas as asserções passarem; !=0 caso contrário.
// ============================================================================
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const platform = join(here, "..");
const tsc = join(platform, "node_modules", ".bin", "tsc");
const out = mkdtempSync(join(tmpdir(), "bidcon-fx-"));

// ---- transpila os fontes REAIS -------------------------------------------
// tsc sai com status 2 no route por causa dos aliases "@/..." (não resolvem
// fora do next build), mas com emit-on-error o .js É gerado mesmo assim — é o
// que precisamos. Então toleramos o exit != 0 e só exigimos que o arquivo saia.
function transpile(rel) {
  const alvo = join(out, basename(rel).replace(/\.ts$/, ".js"));
  try {
    execFileSync(tsc, [
      join(platform, rel),
      "--target", "es2020", "--module", "es2020",
      "--moduleResolution", "node", "--skipLibCheck",
      "--outDir", out,
    ], { stdio: "ignore" });
  } catch {
    // ignora o status: só falha de verdade se o .js não foi emitido (abaixo).
  }
  if (!existsSync(alvo)) {
    throw new Error("transpile n\u00e3o emitiu " + alvo + " (fonte: " + rel + ")");
  }
}
transpile("lib/cotas-source.ts");
transpile("app/api/sync-cotas/route.ts");

// stubs para os imports do route que não queremos de verdade no teste
writeFileSync(join(out, "stub-next-server.js"),
  "export const NextResponse = { json: (b) => ({ _json: b, status: 200 }) };\n");
writeFileSync(join(out, "stub-supabase-admin.js"),
  "export function createAdminClient() { return globalThis.__DB_STUB__.current; }\n");

// reescreve só os 3 specifiers do route real -> stubs + parser real
const routeSrc = readFileSync(join(out, "route.js"), "utf8")
  .replace('"next/server"', '"./stub-next-server.js"')
  .replace('"@/lib/supabase-admin"', '"./stub-supabase-admin.js"')
  .replace('"@/lib/cotas-source"', '"./cotas-source.js"');
writeFileSync(join(out, "route.stub.js"), routeSrc);

const src = await import(pathToFileURL(join(out, "cotas-source.js")).href);
const { lerCotasFonte, FONTES } = src;

// ---- shapes exatos do prospere-360 ---------------------------------------
const envLance = (cs) => JSON.stringify({
  cotas: cs.map((c) => ({ n: c.n, t: c.t, c: c.c, e: c.e, p: c.p, x: c.x })),
});
const envExtra = (cs) => JSON.stringify({
  cotas: cs.map((c) => ({
    id: c.id, fonte: c.fonte, t: c.t, c: c.c, e: c.e, p: c.p, x: c.x,
    entrada_parceiro: c.entrada_parceiro,
  })),
});
const envServopa = (cs) => JSON.stringify({
  cotas: cs.map((c) => ({
    id: c.id, fonte: "SERVOPA", t: c.t, c: c.c, e: c.e, p: c.p, x: c.x,
    entrada_parceiro: c.entrada_parceiro,
  })),
});

const BASE = "https://360prospere.vercel.app";
const U = {
  LANCE: BASE + "/api/cotas?admin=1",
  EXTRA: BASE + "/api/cotas-extra?admin=1",
  SERVOPA: BASE + "/api/cotas-servopa?admin=1",
};

let passed = 0;
const ok = (m) => { passed++; console.log("  \u2713 " + m); };
const rota = (mapa) => {
  global.fetch = async (url) => {
    const e = mapa[url];
    if (!e) throw new Error("fetch stub sem rota p/ " + url);
    return { status: e.status ?? 200, async text() { return e.body ?? ""; } };
  };
};

// ==========================================================================
// PARTE A — parser real
// ==========================================================================
console.log("PARTE A \u2014 parser real (lib/cotas-source.ts)");

// (1) LANCE: lê `n`, entradaParceiro null em todas.
rota({ [U.LANCE]: { body: envLance([
  { n: 1, t: "imovel", c: 100000, e: 30000, p: 900, x: 180 },
  { n: 2, t: "veiculo", c: 60000, e: 18000, p: 700, x: 100 },
  { n: 3, t: "imovel", c: 200000, e: 60000, p: 1500, x: 200 },
  { n: 4, t: "veiculo", c: 50000, e: 15000, p: 600, x: 90 },
  { n: 5, t: "imovel", c: 120000, e: 36000, p: 1000, x: 150 },
]) } });
let r = await lerCotasFonte("LANCE", 0);
assert.equal(r.ok, true);
assert.equal(r.cotas.length, 5);
assert.deepEqual(r.cotas.map((c) => c.numero).sort((a, b) => a - b), [1, 2, 3, 4, 5]);
assert.ok(r.cotas.every((c) => c.entradaParceiro === null));
ok("LANCE l\u00ea `n` como numero e mant\u00e9m entradaParceiro=null");

// (1b) LANCE descarta entrada_parceiro do corpo (blindagem).
rota({ [U.LANCE]: { body: JSON.stringify({ cotas: [
  { n: 10, t: "imovel", c: 100000, e: 30000, p: 900, x: 180, entrada_parceiro: 27000 },
  { n: 11, t: "imovel", c: 110000, e: 33000, p: 950, x: 180, entrada_parceiro: 29000 },
  { n: 12, t: "imovel", c: 120000, e: 36000, p: 990, x: 180, entrada_parceiro: 31000 },
  { n: 13, t: "imovel", c: 130000, e: 39000, p: 999, x: 180, entrada_parceiro: 33000 },
  { n: 14, t: "imovel", c: 140000, e: 42000, p: 1099, x: 180, entrada_parceiro: 35000 },
] }) } });
r = await lerCotasFonte("LANCE", 0);
assert.ok(r.ok && r.cotas.every((c) => c.entradaParceiro === null));
ok("LANCE descarta entrada_parceiro mesmo se presente no corpo (Op\u00e7\u00e3o B)");

// (2) cotas-extra agrega marcas: leitura de CBC filtra por fonte; traz cru.
rota({ [U.EXTRA]: { body: envExtra([
  { id: 1, fonte: "CBC", t: "imovel", c: 100000, e: 27000, p: 900, x: 180, entrada_parceiro: 20000 },
  { id: 2, fonte: "CBC", t: "veiculo", c: 60000, e: 21200, p: 700, x: 100, entrada_parceiro: 14200 },
  { id: 1, fonte: "PIFFER", t: "imovel", c: 150000, e: 40500, p: 1200, x: 180, entrada_parceiro: 30000 },
  { id: 1, fonte: "CARTAS", t: "imovel", c: 200000, e: 54000, p: 1500, x: 200, entrada_parceiro: 40000 },
  { id: 3, fonte: "CBC", t: "imovel", c: 110000, e: 28700, p: 950, x: 180, entrada_parceiro: 21000 },
  { id: 4, fonte: "CBC", t: "imovel", c: 115000, e: 30050, p: 970, x: 180, entrada_parceiro: 22000 },
  { id: 5, fonte: "CBC", t: "imovel", c: 118000, e: 30860, p: 980, x: 180, entrada_parceiro: 22500 },
]) } });
const rCbc = await lerCotasFonte("CBC", 0);
assert.equal(rCbc.ok, true);
assert.equal(rCbc.cotas.length, 5); // só CBC — PIFFER/CARTAS filtradas fora
const cbc1 = rCbc.cotas.find((c) => c.numero === 1);
assert.equal(cbc1.valorEntrada, 27000);   // e com 7%
assert.equal(cbc1.entradaParceiro, 20000); // cru
ok("cotas-extra: CBC pega s\u00f3 fonte==CBC (PIFFER/CARTAS n\u00e3o vazam) e traz o cru");

// (2b) colisão de id: SERVOPA #1 distinto do CBC #1.
rota({ [U.SERVOPA]: { body: envServopa([
  { id: 1, t: "veiculo", c: 80000, e: 25600, p: 800, x: 120, entrada_parceiro: 20000 },
  { id: 2, t: "imovel", c: 300000, e: 96000, p: 2000, x: 220, entrada_parceiro: 75000 },
  { id: 3, t: "imovel", c: 320000, e: 99000, p: 2100, x: 220, entrada_parceiro: 78000 },
  { id: 4, t: "veiculo", c: 70000, e: 22400, p: 750, x: 110, entrada_parceiro: 17500 },
  { id: 5, t: "imovel", c: 280000, e: 90000, p: 1900, x: 220, entrada_parceiro: 70000 },
]) } });
const rServ = await lerCotasFonte("SERVOPA", 0);
const serv1 = rServ.cotas.find((c) => c.numero === 1);
assert.equal(serv1.tipo, "veiculo");
assert.notEqual(serv1.valorCredito, cbc1.valorCredito);
ok("CBC #1 e SERVOPA #1 coexistem distintos (mesmo id nativo, fontes diferentes)");

// guardas por fonte
rota({ [U.EXTRA]: { status: 502, body: "" } });
r = await lerCotasFonte("PIFFER", 0);
assert.equal(r.ok, false); assert.match(r.motivo, /http_502/); assert.equal(r.origem, "PIFFER");
rota({ [U.EXTRA]: { body: JSON.stringify({ cotas: [] }) } });
r = await lerCotasFonte("CARTAS", 0);
assert.equal(r.ok, false); assert.match(r.motivo, /parse_vazio_ou_formato_novo/);
ok("guardas por fonte: HTTP!=200 e envelope vazio abortam s\u00f3 a fonte, com origem");

assert.deepEqual(FONTES, ["LANCE", "CBC", "PIFFER", "CARTAS", "SERVOPA"]);
ok("FONTES = [LANCE, CBC, PIFFER, CARTAS, SERVOPA]");

// ==========================================================================
// PARTE B — rota real (sync-cotas) com db stub
// ==========================================================================
console.log("PARTE B \u2014 rota real (app/api/sync-cotas) com db stub");

function criarDbStub(contagens) {
  const rpcs = [], eventos = [];
  const db = {
    _rpcs: rpcs, _eventos: eventos,
    from(tabela) {
      if (tabela === "cartas") {
        let origem = null;
        const chain = {
          select() { return chain; },
          eq(col, val) { if (col === "administradora_origem") origem = val; return chain; },
          then(res) { res({ count: contagens[origem] ?? 0, error: null }); },
        };
        return chain;
      }
      if (tabela === "eventos_sync") {
        return { insert(row) { eventos.push(row); return Promise.resolve({ error: null }); } };
      }
      throw new Error("db stub: tabela inesperada " + tabela);
    },
    rpc(nome, args) {
      assert.equal(nome, "sync_aplicar_cotas");
      rpcs.push({ p_origem: args.p_origem, qtd: args.p_cotas.length });
      return Promise.resolve({
        data: [{ novas: args.p_cotas.length, atualizadas: 0, indisponibilizadas: 0 }],
        error: null,
      });
    },
  };
  return db;
}

const dbRef = { current: criarDbStub({ LANCE: 10, CBC: 8, PIFFER: 12, CARTAS: 6, SERVOPA: 9 }) };
globalThis.__DB_STUB__ = dbRef;
process.env.CRON_SECRET = "segredo-teste";

const { GET } = await import(pathToFileURL(join(out, "route.stub.js")).href);

// cotas-extra é chamado 3x na MESMA URL (CBC, PIFFER, CARTAS): fila por chamada.
const filaExtra = [
  { status: 200, body: envExtra([
    { id: 1, fonte: "CBC", t: "imovel", c: 100000, e: 27000, p: 900, x: 180, entrada_parceiro: 20000 },
    { id: 2, fonte: "CBC", t: "imovel", c: 110000, e: 28000, p: 950, x: 180, entrada_parceiro: 21000 },
    { id: 3, fonte: "CBC", t: "imovel", c: 120000, e: 29000, p: 990, x: 180, entrada_parceiro: 22000 },
    { id: 4, fonte: "CBC", t: "imovel", c: 130000, e: 30000, p: 999, x: 180, entrada_parceiro: 23000 },
    { id: 5, fonte: "CBC", t: "imovel", c: 140000, e: 31000, p: 1099, x: 180, entrada_parceiro: 24000 },
  ]) },                                        // CBC são
  { status: 502, body: "" },                   // PIFFER 502
  { status: 200, body: JSON.stringify({ cotas: [] }) }, // CARTAS vazio
];
global.fetch = async (url) => {
  if (url === U.LANCE) return { status: 200, async text() { return envLance([
    { n: 1, t: "imovel", c: 100000, e: 30000, p: 900, x: 180 },
    { n: 2, t: "imovel", c: 110000, e: 33000, p: 950, x: 180 },
    { n: 3, t: "imovel", c: 120000, e: 36000, p: 990, x: 180 },
    { n: 4, t: "imovel", c: 130000, e: 39000, p: 999, x: 180 },
    { n: 5, t: "imovel", c: 140000, e: 42000, p: 1099, x: 180 },
    { n: 6, t: "imovel", c: 150000, e: 45000, p: 1199, x: 180 },
  ]); } };
  if (url === U.SERVOPA) return { status: 200, async text() { return envServopa([
    { id: 1, t: "veiculo", c: 80000, e: 25600, p: 800, x: 120, entrada_parceiro: 20000 },
    { id: 2, t: "imovel", c: 300000, e: 96000, p: 2000, x: 220, entrada_parceiro: 75000 },
    { id: 3, t: "imovel", c: 310000, e: 97000, p: 2050, x: 220, entrada_parceiro: 76000 },
    { id: 4, t: "imovel", c: 320000, e: 98000, p: 2075, x: 220, entrada_parceiro: 77000 },
    { id: 5, t: "imovel", c: 330000, e: 99000, p: 2099, x: 220, entrada_parceiro: 78000 },
  ]); } };
  if (url === U.EXTRA) { const n = filaExtra.shift(); return { status: n.status, async text() { return n.body; } }; }
  throw new Error("fetch stub sem rota p/ " + url);
};

const req = { headers: { get: (h) => (h === "authorization" ? "Bearer segredo-teste" : null) } };
const out2 = (await GET(req))._json;
const db = dbRef.current;

const origensRpc = db._rpcs.map((x) => x.p_origem).sort();
assert.deepEqual(origensRpc, ["CBC", "LANCE", "SERVOPA"]);
assert.ok(!origensRpc.includes("PIFFER") && !origensRpc.includes("CARTAS"));
ok("falha parcial: s\u00f3 fontes s\u00e3s upsertam; fonte que aborta n\u00e3o emite RPC");

const abort = db._eventos.filter((e) => e.tipo === "sync_abortado").map((e) => e.detalhe);
assert.ok(abort.some((d) => /^PIFFER/.test(d)) && abort.some((d) => /^CARTAS/.test(d)));
ok("aborts de PIFFER e CARTAS auditados em eventos_sync, sem afetar as demais");

assert.equal(out2.ok, true);
assert.deepEqual(out2.fontes.filter((f) => f.ok).map((f) => f.origem).sort(), ["CBC", "LANCE", "SERVOPA"]);
assert.deepEqual(out2.fontes.filter((f) => !f.ok).map((f) => f.origem).sort(), ["CARTAS", "PIFFER"]);
ok("resultado por-fonte reportado individualmente (3 ok, 2 abortadas)");

const rpcCbc = db._rpcs.find((x) => x.p_origem === "CBC");
const rpcServ = db._rpcs.find((x) => x.p_origem === "SERVOPA");
assert.equal(rpcCbc.qtd, 5);
assert.equal(rpcServ.qtd, 5);
ok("RPC por-fonte com p_origem distinto: CBC #1 e SERVOPA #1 nunca colidem no upsert");

console.log(`\nOK \u2014 ${passed} asser\u00e7\u00f5es passaram.`);
