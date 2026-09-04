// ============================================================================
// FUNIL-01 — o teste do GATILHO
// ----------------------------------------------------------------------------
// `ponte.test.ts` cobre a DECISÃO (37 testes, função pura). Este arquivo cobre
// só o que é do gatilho e de mais ninguém:
//   1. o interruptor — desarmado, o banco não é TOCADO;
//   2. a doutrina da falha — log, nunca exceção;
//   3. a condição de escrita da corrida (`wa_conversa_id is null`);
//   4. a fronteira: o que vai para o banco é EXATAMENTE o que a ponte decidiu.
//
// Não repete braço de `decidir()`. Braço repetido em dois arquivos é a segunda
// cópia da régua, que é o defeito que esta fatia inteira passou a semana
// desfazendo.
//
// ---- ESTE É O PRIMEIRO DUBLÊ DE SUPABASE DA CASA (medido em 04/09/2026) -----
//
// Procurei precedente antes de inventar: `lib/farol-arte.test.ts` é o único
// teste que fala de `createXtvClient`, e ele NÃO finge um cliente — ele testa o
// contrato fazendo o construtor LANÇAR por falta de env. Não havia forma
// estabelecida, então esta é a primeira. Fica registrado para que a próxima
// pessoa reuse ESTA em vez de escrever uma terceira.
//
// O dublê é fiel num ponto que importa: os construtores do supabase-js são
// THENABLE — `await db.from(x).update(y).eq(...)` resolve sem chamar `.single()`.
// Por isso `elo.then` existe aqui. Um dublê que só respondesse a `.single()`
// passaria verde e mentiria sobre o caminho do `update`, que é justamente onde
// mora a trava de corrida.
// ============================================================================

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { aplicarDecisao, rodarPonteNaConversa } from "./gatilho";
import {
  TAG_CEDENTE,
  decidir,
  type ConversaMedida,
  type ExtratoEscolhido,
} from "./ponte";

// ----------------------------------------------------------------------------
// Os dois bancos de mentira
// ----------------------------------------------------------------------------

/** Um banco que grita ao menor toque. Existe para provar AUSÊNCIA de acesso —
 *  a única forma de testar "não foi ao banco" sem depender de contar chamadas
 *  que alguém pode esquecer de contar. */
const bancoQueExplode = new Proxy(
  {},
  {
    get(_alvo, prop) {
      throw new Error(`o gatilho tocou o banco: .${String(prop)}`);
    },
  }
) as never;

type Chamada = { metodo: string; args: unknown[] };
type Resposta = { data: unknown; error: { message: string } | null };

/** Dublê encadeável e thenable. Anota tudo que foi chamado, na ordem. */
function bancoDeMentira(resposta: Resposta) {
  const chamadas: Chamada[] = [];
  const elo: Record<string, unknown> = {};

  for (const m of [
    "select",
    "eq",
    "is",
    "in",
    "gte",
    "order",
    "limit",
    "insert",
    "update",
  ]) {
    elo[m] = (...args: unknown[]) => {
      chamadas.push({ metodo: m, args });
      return elo;
    };
  }
  elo.single = async () => resposta;
  elo.maybeSingle = async () => resposta;
  elo.then = (ok: (r: Resposta) => unknown, falha?: (e: unknown) => unknown) =>
    Promise.resolve(resposta).then(ok, falha);

  const db = {
    from: (tabela: string) => {
      chamadas.push({ metodo: "from", args: [tabela] });
      return elo;
    },
  };
  return { db: db as never, chamadas };
}

function chamada(chamadas: Chamada[], metodo: string): Chamada | undefined {
  return chamadas.find((c) => c.metodo === metodo);
}

// ----------------------------------------------------------------------------
// O interruptor, isolado e devolvido — um teste que vaza `FUNIL` contamina
// todos os que rodarem depois no mesmo processo.
// ----------------------------------------------------------------------------

async function comFunil<T>(valor: string | undefined, f: () => Promise<T>): Promise<T> {
  const antes = process.env.FUNIL;
  if (valor === undefined) delete process.env.FUNIL;
  else process.env.FUNIL = valor;
  try {
    return await f();
  } finally {
    if (antes === undefined) delete process.env.FUNIL;
    else process.env.FUNIL = antes;
  }
}

/** Cala e COLETA o que o gatilho gritaria. O log é a única memória das quatro
 *  classes que não escrevem; um teste que só silenciasse jogaria fora a prova. */
async function coletandoLogs<T>(f: () => Promise<T>): Promise<{ r: T; ditos: string[] }> {
  const ditos: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const captura =
    () =>
    (...a: unknown[]) => {
      ditos.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    };
  console.log = captura();
  console.warn = captura();
  console.error = captura();
  try {
    return { r: await f(), ditos };
  } finally {
    console.log = orig.log;
    console.warn = orig.warn;
    console.error = orig.error;
  }
}

// ----------------------------------------------------------------------------
// Decisões de verdade, saídas da ponte de verdade
// ----------------------------------------------------------------------------

const ID_CONVERSA = "7cfa67f6-0000-4000-8000-000000000001";
const TEL_11 = "5511998887766";
const ID_CAPTACAO = "fa8f1ffd-0000-4000-8000-00000000000a";

function extrato(over: Partial<ExtratoEscolhido> = {}): ExtratoEscolhido {
  return {
    confianca: 0.9,
    contemplada: null,
    administradora: "Unifisa",
    valor_credito: 131163.29,
    saldo_devedor: 80000,
    parcelas_pagas: 42,
    ...over,
  } as ExtratoEscolhido;
}

function conversa(over: Partial<ConversaMedida> = {}): ConversaMedida {
  return {
    id: ID_CONVERSA,
    nome: "Leandro Bittencourt Miranda",
    telefone: TEL_11,
    tags: [TAG_CEDENTE],
    agente_ativo: null,
    opt_out: false,
    n_intencao: 0,
    extrato: extrato(),
    captacao: null,
    posto_na_chave: 1,
    nominal: null,
    ...over,
  };
}

// ============================================================================

describe("FUNIL-01 gatilho — o interruptor", () => {
  test("DESARMADO: não decide, não lê e NÃO TOCA O BANCO", async () => {
    for (const valor of [undefined, "", "off", "true", "1", "ON"]) {
      const r = await comFunil(valor, () =>
        rodarPonteNaConversa(bancoQueExplode, ID_CONVERSA)
      );
      assert.deepEqual(r, { feito: "desligado" }, `FUNIL=${String(valor)} deveria desarmar`);
    }
  });

  test("ISCA: o banco explosivo REALMENTE explode — senão o teste acima é vazio", async () => {
    // Sem este controle negativo, `bancoQueExplode` poderia ser um objeto inerte
    // e o teste de cima passaria mesmo que o gatilho fosse ao banco desarmado.
    // Com FUNIL=on o MESMO objeto tem de derrubar a medição.
    const { r } = await coletandoLogs(() =>
      comFunil("on", () => rodarPonteNaConversa(bancoQueExplode, ID_CONVERSA))
    );
    assert.deepEqual(r, { feito: "falhou", onde: "inesperado" });
  });
});

describe("FUNIL-01 gatilho — a doutrina da falha: log, nunca exceção", () => {
  test("ARMADO e com o banco em chamas: devolve falha, REGISTRA, e não lança", async () => {
    const { r, ditos } = await coletandoLogs(() =>
      comFunil("on", () => rodarPonteNaConversa(bancoQueExplode, ID_CONVERSA))
    );
    assert.deepEqual(r, { feito: "falhou", onde: "inesperado" });
    assert.ok(
      ditos.some((d) => d.includes("[funil/gatilho]")),
      "falhar em silêncio é pior que falhar: o log é a única memória"
    );
    assert.ok(
      ditos.some((d) => d.includes("o webhook segue")),
      "o motivo de não lançar tem de estar escrito onde quem lê o log está"
    );
  });

  test("as quatro classes que não escrevem devolvem escreveu:false SEM tocar o banco", async () => {
    // `(mesma chave)`: não é candidata (sem tag, sem extrato, sem agente).
    // `excluir`: opt_out.
    // `revisar`: candidata, mas o telefone não dá chave.
    // `nada`: posto 2 na chave.
    const casos: ReadonlyArray<readonly [string, ConversaMedida]> = [
      ["(mesma chave)", conversa({ tags: [], extrato: null })],
      ["excluir", conversa({ opt_out: true })],
      ["revisar", conversa({ telefone: "123" })],
      ["nada", conversa({ posto_na_chave: 2 })],
    ];
    for (const [esperada, c] of casos) {
      const d = decidir(c);
      assert.equal(d.classe, esperada, `o caso mudou de braço: ${d.motivo}`);
      const { r } = await coletandoLogs(() => aplicarDecisao(bancoQueExplode, c, d));
      assert.deepEqual(
        r,
        { feito: "decidido", decisao: d, escreveu: false },
        `${esperada} não pode escrever`
      );
    }
  });
});

describe("FUNIL-01 gatilho — a fronteira com o banco", () => {
  test("INSERIR manda para `captacoes` EXATAMENTE a linha que a ponte montou", async () => {
    const c = conversa();
    const d = decidir(c);
    assert.equal(d.classe, "inserir", d.motivo);
    assert.ok("linha" in d);

    const { db, chamadas } = bancoDeMentira({ data: { id: ID_CAPTACAO }, error: null });
    const { r } = await coletandoLogs(() => aplicarDecisao(db, c, d));

    assert.deepEqual(r, { feito: "decidido", decisao: d, escreveu: true });
    assert.deepEqual(chamada(chamadas, "from")?.args, ["captacoes"]);
    // O gatilho é CANO, não filtro: nada é acrescentado nem removido entre a
    // decisão e o INSERT. Se um dia alguém "enriquecer" a linha aqui, a régua
    // de colunas de `ponte.ts` deixa de valer sem ninguém notar.
    assert.deepEqual(chamada(chamadas, "insert")?.args, [d.linha]);
  });

  test("INSERIR que o banco recusa vira falha declarada, não exceção", async () => {
    const c = conversa();
    const d = decidir(c);
    const { db } = bancoDeMentira({ data: null, error: { message: "duplicate key" } });
    const { r, ditos } = await coletandoLogs(() => aplicarDecisao(db, c, d));
    assert.deepEqual(r, { feito: "falhou", onde: "insert" });
    assert.ok(ditos.some((x) => x.includes("duplicate key")), "o erro do banco entra no log");
  });

  test("LIGAR trava a corrida com `wa_conversa_id is null` na CONDIÇÃO da escrita", async () => {
    const c = conversa({
      captacao: {
        id: ID_CAPTACAO,
        status: "novo",
        atualizado_em: null,
        wa_conversa_id: null,
        nome: null,
        administradora: null,
        credito: null,
        saldo_devedor: null,
        parcelas_pagas: null,
      },
    });
    const d = decidir(c);
    assert.equal(d.classe, "ligar", d.motivo);
    assert.ok("escrever" in d);

    const { db, chamadas } = bancoDeMentira({ data: [{ id: ID_CAPTACAO }], error: null });
    const { r } = await coletandoLogs(() => aplicarDecisao(db, c, d));

    assert.deepEqual(r, { feito: "decidido", decisao: d, escreveu: true });
    assert.deepEqual(chamada(chamadas, "update")?.args, [d.escrever]);
    assert.deepEqual(chamada(chamadas, "eq")?.args, ["id", ID_CAPTACAO]);
    // ESTA é a linha que o teste existe para defender. Entre a medição e o
    // update cabem milissegundos; sem esta condição, duas conversas da mesma
    // chave chegando juntas sobrescrevem uma à outra em silêncio.
    assert.deepEqual(
      chamada(chamadas, "is")?.args,
      ["wa_conversa_id", null],
      "a trava de corrida sumiu do update"
    );
  });

  test("LIGAR que não pegou nenhuma linha é resultado LEGÍTIMO: alguém ligou primeiro", async () => {
    const c = conversa({
      captacao: {
        id: ID_CAPTACAO,
        status: "novo",
        atualizado_em: null,
        wa_conversa_id: null,
        nome: null,
        administradora: null,
        credito: null,
        saldo_devedor: null,
        parcelas_pagas: null,
      },
    });
    const d = decidir(c);
    const { db } = bancoDeMentira({ data: [], error: null });
    const { r, ditos } = await coletandoLogs(() => aplicarDecisao(db, c, d));

    // Zero linhas NÃO é `falhou`: o banco fez o que foi pedido, e o que foi
    // pedido era condicional. Chamar isso de erro encheria o log de vermelho
    // num caso previsto — e log vermelho que é normal ninguém lê mais.
    assert.deepEqual(r, { feito: "decidido", decisao: d, escreveu: false });
    assert.ok(ditos.some((x) => x.includes("alguém ligou primeiro")));
  });
});
