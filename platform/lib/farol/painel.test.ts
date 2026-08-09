// ============================================================================
// Testes de lib/farol/painel.ts (PAINEL-FAROL-01).
//
// Runner nativo do Node, mesmo padrão dos outros *.test.ts:
//   npx tsx --test lib/farol/painel.test.ts
//
// O QUE ESTE ARQUIVO PROTEGE, e por que vale um teste: a promessa central do
// item 2 da OS é "com a env off, comportamento atual intacto". Essa promessa
// mora em duas funções de UMA LINHA cada — exatamente o tipo de código que
// ninguém relê e que uma refatoração distraída inverte. Se `statusInicialDaPauta`
// passar a devolver 'aguardando_aprovacao' por default, o cron das 10h grava um
// estado que o CHECK do banco recusa E que o reel-render não consome: o FAROL
// para de usar pauta, em silêncio, e cai no template todo dia. `tsc` não vê
// nada disso — os dois valores são `string`.
//
// A tela em si não é testada aqui (é Server Component com I/O no xtv); o que é
// testável sem banco são as regras puras, e são elas que decidem o que aparece.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  aprovacaoDePautaLigada,
  statusInicialDaPauta,
  statusConsumivelDaPauta,
  reelTravado,
  postDoDia,
  reelDoDia,
  pautaDoDia,
  IDADE_TRAVADA_MS,
  type LinhaPost,
  type LinhaReel,
  type LinhaPauta,
} from "./painel";

/** Roda `fn` com FAROL_PAUTA_APROVA num valor dado e restaura depois. */
function comEnv<T>(valor: string | undefined, fn: () => T): T {
  const antes = process.env.FAROL_PAUTA_APROVA;
  if (valor === undefined) delete process.env.FAROL_PAUTA_APROVA;
  else process.env.FAROL_PAUTA_APROVA = valor;
  try {
    return fn();
  } finally {
    if (antes === undefined) delete process.env.FAROL_PAUTA_APROVA;
    else process.env.FAROL_PAUTA_APROVA = antes;
  }
}

// ---------------------------------------------------------------------------
// A invariante do item 2: env desarmada = fluxo de hoje, bit a bit
// ---------------------------------------------------------------------------

test("env AUSENTE: a pauta nasce 'nova' e é consumida como 'nova' (comportamento atual)", () => {
  comEnv(undefined, () => {
    assert.equal(aprovacaoDePautaLigada(), false);
    assert.equal(statusInicialDaPauta(), "nova");
    assert.equal(statusConsumivelDaPauta(), "nova");
  });
});

test("env com qualquer valor que NÃO seja 'on' também mantém o fluxo atual", () => {
  // 'true', '1' e 'ON' são as três formas com que alguém liga uma env por
  // engano. Nenhuma delas pode armar a aprovação: armar sem a migration
  // aplicada quebra o insert das 10h no CHECK.
  for (const v of ["", "off", "true", "1", "ON", "on "]) {
    comEnv(v, () => {
      assert.equal(aprovacaoDePautaLigada(), false, `valor ${JSON.stringify(v)}`);
      assert.equal(statusInicialDaPauta(), "nova");
      assert.equal(statusConsumivelDaPauta(), "nova");
    });
  }
});

test("env='on': a pauta espera humano e o render só consome 'aprovada'", () => {
  comEnv("on", () => {
    assert.equal(aprovacaoDePautaLigada(), true);
    assert.equal(statusInicialDaPauta(), "aguardando_aprovacao");
    assert.equal(statusConsumivelDaPauta(), "aprovada");
  });
});

test("os dois estados nunca coincidem quando a aprovação está ligada", () => {
  // Se coincidissem, a pauta nasceria já consumível e a aprovação seria
  // decorativa — o modo de falha silencioso desta fatia.
  comEnv("on", () => {
    assert.notEqual(statusInicialDaPauta(), statusConsumivelDaPauta());
  });
});

// ---------------------------------------------------------------------------
// reelTravado — o que habilita o botão que abandona um container
// ---------------------------------------------------------------------------

const AGORA = new Date("2026-08-08T18:00:00.000Z").getTime();

function reel(p: Partial<LinhaReel>): LinhaReel {
  return {
    id: "r1",
    carta_id: null,
    video_id: "v1",
    container_id: null,
    post_id: null,
    status: "publicando",
    roteiro: null,
    legenda: null,
    erro: null,
    detalhe: null,
    criado_em: new Date(AGORA).toISOString(),
    atualizado_em: null,
    ...p,
  };
}

test("linha recém-tocada NÃO está travada", () => {
  const l = reel({ atualizado_em: new Date(AGORA - 60_000).toISOString() });
  assert.equal(reelTravado(l, AGORA), false);
});

test("linha parada além do limiar ESTÁ travada", () => {
  const l = reel({ atualizado_em: new Date(AGORA - IDADE_TRAVADA_MS - 1).toISOString() });
  assert.equal(reelTravado(l, AGORA), true);
});

test("estado final nunca é 'travado', por mais velho que seja", () => {
  // Destravar um reel publicado não tem significado; destravar um que falhou
  // mascararia o motivo sem consertar nada.
  const velho = new Date(AGORA - 30 * 24 * 60 * 60 * 1000).toISOString();
  for (const status of ["publicado", "falhou"]) {
    assert.equal(reelTravado(reel({ status, atualizado_em: velho }), AGORA), false, status);
  }
});

test("sem `atualizado_em`, o relógio cai em `criado_em`", () => {
  const l = reel({
    atualizado_em: null,
    criado_em: new Date(AGORA - IDADE_TRAVADA_MS - 1).toISOString(),
  });
  assert.equal(reelTravado(l, AGORA), true);
});

test("data ilegível não vira 'travado' — não saber nunca é sentença", () => {
  const l = reel({ atualizado_em: "não é uma data" });
  assert.equal(reelTravado(l, AGORA), false);
});

// ---------------------------------------------------------------------------
// Recortes do dia — publicado ganha da tentativa
// ---------------------------------------------------------------------------

const HOJE = "2026-08-08";

test("postDoDia prefere o publicado, mesmo quando a falha é mais recente", () => {
  const linhas: LinhaPost[] = [
    {
      id: "p2",
      acao: "post_falhou",
      carta_id: null,
      post_id: null,
      detalhe: { data: HOJE, erro: "container recusado" },
      criado_em: "2026-08-08T14:00:00.000Z",
    },
    {
      id: "p1",
      acao: "post_publicado",
      carta_id: null,
      post_id: "ABC",
      detalhe: { data: HOJE },
      criado_em: "2026-08-08T11:00:00.000Z",
    },
  ];
  assert.equal(postDoDia(linhas, HOJE)?.id, "p1");
});

test("postDoDia ignora eventos que não são de post (disparo manual, pauta)", () => {
  // farol_posts é o diário de TUDO: sem este filtro, o card do post do dia
  // exibiria um clique de botão como se fosse a publicação.
  const linhas: LinhaPost[] = [
    {
      id: "d1",
      acao: "disparo_manual",
      carta_id: null,
      post_id: null,
      detalhe: { data: HOJE },
      criado_em: "2026-08-08T15:00:00.000Z",
    },
  ];
  assert.equal(postDoDia(linhas, HOJE), null);
});

test("postDoDia não pega o post de ontem", () => {
  const linhas: LinhaPost[] = [
    {
      id: "p0",
      acao: "post_publicado",
      carta_id: null,
      post_id: "X",
      detalhe: { data: "2026-08-07" },
      criado_em: "2026-08-07T11:00:00.000Z",
    },
  ];
  assert.equal(postDoDia(linhas, HOJE), null);
});

test("reelDoDia prefere o publicado à tentativa que falhou", () => {
  const linhas: LinhaReel[] = [
    reel({ id: "r2", status: "falhou", detalhe: { data: HOJE } }),
    reel({ id: "r1", status: "publicado", detalhe: { data: HOJE } }),
  ];
  assert.equal(reelDoDia(linhas, HOJE)?.id, "r1");
});

test("reelDoDia devolve a tentativa quando não há publicado", () => {
  const linhas: LinhaReel[] = [reel({ id: "r9", status: "renderizando", detalhe: { data: HOJE } })];
  assert.equal(reelDoDia(linhas, HOJE)?.id, "r9");
});

test("pautaDoDia casa por `dia`, não por `criado_em`", () => {
  // A pauta das 10h BRT de 08/08 é gravada com criado_em em UTC do mesmo dia,
  // mas o que identifica o dia civil do FAROL é a coluna `dia`.
  const linhas: LinhaPauta[] = [
    {
      id: "pa1",
      dia: HOJE,
      formula: "prova-social",
      gancho: null,
      roteiro: null,
      legenda: null,
      hashtags: null,
      fontes: null,
      status: "aguardando_aprovacao",
      motivo_linter: null,
      carta_id: null,
      criado_em: "2026-08-08T13:00:00.000Z",
    },
  ];
  assert.equal(pautaDoDia(linhas, HOJE)?.id, "pa1");
  assert.equal(pautaDoDia(linhas, "2026-08-07"), null);
});
