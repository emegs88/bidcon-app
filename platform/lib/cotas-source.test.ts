// ============================================================================
// Teste dos TRÊS ESTADOS do valor cru (SYNC-RAW-01)
// ----------------------------------------------------------------------------
// O que este arquivo defende, em ordem de quanto dói errar.
//
// 1. O NULO NÃO PODE VOLTAR A SER MUDO. Até 15/08/2026 `entradaParceiro` era
//    `number | null` e o null significava duas coisas incompatíveis: "a Lance
//    não manda por desenho" e "o CBC deveria mandar e parou". A segunda passou
//    despercebida por meses — medido: `entrada_parceiro` sumiu de 1.332 de
//    1.332 cotas do /api/cotas-extra sem que ninguém notasse. Os testes abaixo
//    fixam a separação.
//
// 2. A REGRA MORA EM UM LUGAR SÓ. ESPERA_ENTRADA_PARCEIRO é Record (não
//    Partial) de propósito: FonteMarca nova não compila até alguém decidir. O
//    teste de cobertura repete a exigência em tempo de execução, porque um
//    `as any` em qualquer canto derrubaria a garantia do compilador.
//
// 3. A URL VAI JUNTO, COM O ?admin=1 VISÍVEL. Sem o literal ninguém consegue
//    dizer se o contrato mudou no prospere-360 ou se fomos nós que paramos de
//    pedir — que é exatamente a pergunta que a casa não conseguiu responder em
//    agosto.
//
// 4. AUSÊNCIA DE CRU NÃO DERRUBA A LEITURA. Carta sem prova de comissão ainda é
//    carta boa: o estoque continua entrando e é o diagnóstico que fica visível.
//    Um teste amarra isso, porque a tentação de endurecer a guarda é real.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  diagnosticarRaw,
  esperaEntradaParceiro,
  estadoDoRaw,
  lerCotasFonte,
  ESPERA_ENTRADA_PARCEIRO,
  FONTES,
  type CotaFonte,
  type FonteMarca,
} from "@/lib/cotas-source";

// ---------------------------------------------------------------------------
// 1. A regra: quem deveria mandar o cru
// ---------------------------------------------------------------------------

test("LANCE não espera cru; as demais esperam", () => {
  assert.equal(esperaEntradaParceiro("LANCE"), false);
  assert.equal(esperaEntradaParceiro("CBC"), true);
  assert.equal(esperaEntradaParceiro("PIFFER"), true);
  assert.equal(esperaEntradaParceiro("CARTAS"), true);
  assert.equal(esperaEntradaParceiro("SERVOPA"), true);
  assert.equal(esperaEntradaParceiro("PLAYCONTEMPLADAS"), true);
});

test("toda fonte da rotação tem decisão explícita na regra", () => {
  // Se alguém acrescentar uma FonteMarca e escapar do compilador (um `as any`
  // basta), este teste ainda pega: a chave tem de existir e ser booleana.
  for (const f of FONTES) {
    assert.equal(
      typeof ESPERA_ENTRADA_PARCEIRO[f],
      "boolean",
      `fonte ${f} sem decisão em ESPERA_ENTRADA_PARCEIRO`
    );
  }
});

// ---------------------------------------------------------------------------
// 2. Os três estados
// ---------------------------------------------------------------------------

test("null de quem não espera é nulo_por_desenho, não falta", () => {
  assert.equal(estadoDoRaw("LANCE", null), "nulo_por_desenho");
});

test("LANCE com valor continua nulo_por_desenho (a regra manda, não o dado)", () => {
  // Blindagem: se o corpo da Lance um dia trouxer entrada_parceiro, isso não
  // reclassifica a fonte. A Opção B diz que lá não existe cru separado.
  assert.equal(estadoDoRaw("LANCE", 27000), "nulo_por_desenho");
});

test("quem espera e recebeu é recebido; quem espera e não recebeu é ausente", () => {
  assert.equal(estadoDoRaw("CBC", 20000), "recebido");
  assert.equal(estadoDoRaw("CBC", null), "ausente");
});

test("zero é valor recebido, não ausência", () => {
  // 0 é falsy em JS e seria engolido por um `if (valor)`. Cru zero é um
  // número que o parceiro mandou, e mandar zero é diferente de não mandar.
  assert.equal(estadoDoRaw("CBC", 0), "recebido");
});

// ---------------------------------------------------------------------------
// 3. O diagnóstico do ciclo
// ---------------------------------------------------------------------------

function cota(numero: number, estadoRaw: CotaFonte["estadoRaw"]): CotaFonte {
  return {
    numero,
    tipo: "imovel",
    valorCredito: 100000,
    valorEntrada: 27000,
    valorParcela: 900,
    qtdParcelas: 180,
    entradaParceiro: estadoRaw === "recebido" ? 20000 : null,
    estadoRaw,
    administradora: "PORTO",
  };
}

test("diagnóstico conta os três estados separadamente", () => {
  const d = diagnosticarRaw("CBC", "https://x/api/cotas-extra?admin=1", [
    cota(1, "recebido"),
    cota(2, "recebido"),
    cota(3, "ausente"),
  ]);
  assert.equal(d.lidas, 3);
  assert.equal(d.recebidas, 2);
  assert.equal(d.faltando, 1);
  assert.equal(d.espera, true);
});

test("nulo_por_desenho não conta como falta em lugar nenhum", () => {
  const d = diagnosticarRaw("LANCE", "https://x/api/cotas?admin=1", [
    cota(1, "nulo_por_desenho"),
    cota(2, "nulo_por_desenho"),
  ]);
  assert.equal(d.lidas, 2);
  assert.equal(d.recebidas, 0);
  assert.equal(d.faltando, 0);
  assert.equal(d.espera, false);
});

test("o literal da URL viaja no diagnóstico, e o admin sai dele", () => {
  const url = "https://360prospere.vercel.app/api/cotas-extra?admin=1";
  const d = diagnosticarRaw("CBC", url, []);
  assert.equal(d.url, url); // literal, não reconstruído
  assert.equal(d.admin, true);
  // e a mesma fonte SEM o parâmetro é um fato diferente, não o mesmo fato.
  assert.equal(
    diagnosticarRaw("CBC", "https://360prospere.vercel.app/api/cotas-extra", []).admin,
    false
  );
});

// ---------------------------------------------------------------------------
// 4. Ponta a ponta, com a rede fingida: a carta entra mesmo sem prova
// ---------------------------------------------------------------------------

/** Troca o global.fetch por um que devolve sempre o mesmo corpo. */
function fingirRede(corpo: string, status = 200) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    status,
    async text() {
      return corpo;
    },
  })) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function corpoExtra(fonte: FonteMarca, n: number, comCru: boolean): string {
  const cotas = [];
  for (let i = 1; i <= n; i++) {
    const linha: Record<string, unknown> = {
      id: i, fonte, t: "imovel", c: 100000, e: 27000, p: 900, x: 180, adm: "PORTO",
    };
    if (comCru) linha.entrada_parceiro = 20000;
    cotas.push(linha);
  }
  return JSON.stringify({ cotas });
}

test("CBC sem entrada_parceiro: leitura OK, cartas entram, falta contada", async () => {
  // Este é literalmente o estado medido da fonte viva em 15/08/2026.
  const restaurar = fingirRede(corpoExtra("CBC", 6, false));
  try {
    const r = await lerCotasFonte("CBC", 0);
    assert.equal(r.ok, true, "ausência de cru NÃO pode abortar a fonte");
    if (!r.ok) return;
    assert.equal(r.cotas.length, 6, "as 6 cartas entram do mesmo jeito");
    assert.ok(r.cotas.every((c) => c.estadoRaw === "ausente"));
    assert.equal(r.raw.faltando, 6);
    assert.equal(r.raw.recebidas, 0);
    assert.equal(r.raw.admin, true, "o sync continua PEDINDO o cru");
  } finally {
    restaurar();
  }
});

test("CBC com entrada_parceiro: nada falta e o cru chega inteiro", async () => {
  const restaurar = fingirRede(corpoExtra("CBC", 6, true));
  try {
    const r = await lerCotasFonte("CBC", 0);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.ok(r.cotas.every((c) => c.estadoRaw === "recebido"));
    assert.ok(r.cotas.every((c) => c.entradaParceiro === 20000));
    assert.equal(r.raw.faltando, 0);
    assert.equal(r.raw.recebidas, 6);
  } finally {
    restaurar();
  }
});

test("LANCE nunca acusa falta, mesmo com o cru no corpo", async () => {
  const cotas = [];
  for (let i = 1; i <= 6; i++) {
    cotas.push({ n: i, t: "imovel", c: 100000, e: 30000, p: 900, x: 180, entrada_parceiro: 27000 });
  }
  const restaurar = fingirRede(JSON.stringify({ cotas }));
  try {
    const r = await lerCotasFonte("LANCE", 0);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    // Opção B: a Lance descarta o cru E não o conta como falta.
    assert.ok(r.cotas.every((c) => c.entradaParceiro === null));
    assert.ok(r.cotas.every((c) => c.estadoRaw === "nulo_por_desenho"));
    assert.equal(r.raw.faltando, 0);
    assert.equal(r.raw.espera, false);
  } finally {
    restaurar();
  }
});

test("leitura que falha não traz diagnóstico (não há o que diagnosticar)", async () => {
  const restaurar = fingirRede("", 502);
  try {
    const r = await lerCotasFonte("CBC", 0);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.motivo, /http_502/);
  } finally {
    restaurar();
  }
});
