// ============================================================================
// Teste da camada pura da vitrine unificada (CATALOGO-UNIFICA-01 · FASE 2)
// ----------------------------------------------------------------------------
// O defeito que estes testes existem para impedir NÃO estoura. Ele pinta um
// vazio bonito: a fonte cai, `data ?? []` transforma a falha em lista vazia, e
// a tela diz ao cliente "Nenhuma carta disponível agora". A Bidcon tem 2.295
// cartas medidas hoje. Erro que não grita é erro que precisa de teste.
//
// Por isso a suíte cobre os DOIS estados com CONTROLE, no espírito da Regra 9:
// não basta provar que a falha vira falha; é preciso provar, na mesma suíte,
// que o zero REAL continua chegando como zero. Um teste que só olha um lado
// passaria feliz numa implementação que devolvesse "falha" para tudo.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  interpretarLeitura,
  ordenarExclusivaPrimeiro,
  adaptarCarta,
  paraFluxo,
  refCarta,
  mensagemReservaPonte,
  linkReservaPonte,
  MSG_FALHA_VITRINE,
  MSG_VAZIO_VITRINE,
  WA_PROSPERITO,
  type LinhaVitrine,
} from "@/lib/vitrine";
import { cartasNovas } from "@/lib/cartas-fluxo";

// ---------------------------------------------------------------------------
// Fábrica de linha da view. Os nomes de campo são os da `vw_vitrine_viva`
// (credito/entrada/parcela/parcelas), NÃO os do app — se alguém renomear a
// view sem renomear aqui, é este arquivo que avisa.
// ---------------------------------------------------------------------------
function linha(over: Partial<LinhaVitrine> = {}): LinhaVitrine {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    ref: 1234,
    tipo: "imovel",
    credito: 300000,
    entrada: 90000,
    parcela: 2500,
    parcelas: 120,
    custo_am: 1.23,
    agio_120: null,
    agio_150: 12000,
    administradora: "Porto Seguro",
    criado_em: "2026-08-19T12:00:00.000Z",
    fonte: "leilao",
    exclusiva: false,
    ...over,
  };
}

// ===========================================================================
// REGRA 19 — os três estados
// ===========================================================================

test("Regra 19: erro do banco vira FALHA, com o motivo preservado para o log", () => {
  const r = interpretarLeitura(
    { data: null, error: { message: 'relation "vw_vitrine_viva" does not exist' } },
    "vitrine/cartas"
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.motivo, /vitrine\/cartas/);
  assert.match(r.motivo, /does not exist/);
});

test("Regra 19: erro SEM mensagem ainda é falha (não pode virar vazio)", () => {
  const r = interpretarLeitura({ data: null, error: {} }, "vitrine/cartas");
  assert.equal(r.ok, false);
});

test("Regra 19: erro presente ganha de dados presentes — nunca serve lista parcial", () => {
  // O PostgREST pode devolver as duas coisas. Servir a lista com erro em cima
  // seria mostrar meia vitrine como se fosse a vitrine inteira.
  const r = interpretarLeitura(
    { data: [linha()], error: { message: "statement timeout" } },
    "vitrine/cartas"
  );
  assert.equal(r.ok, false);
});

test("Regra 19: o BURACO SILENCIOSO — sem erro e sem dados também é falha", () => {
  // Este é o estado que `data ?? []` engole sem deixar rastro: não há erro para
  // logar e não há linha para mostrar. Ele TEM de ser nomeado, senão a única
  // testemunha da queda é o cliente lendo "nenhuma carta".
  const r = interpretarLeitura({ data: null, error: null }, "vitrine/inicio");
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.motivo, /sem erro e sem dados/);
});

test("CONTROLE da Regra 19: zero REAL continua chegando como zero, não como falha", () => {
  // Sem este caso, uma implementação que gritasse "falha" para tudo passaria
  // nos testes acima. É ele que dá sentido aos outros.
  const r = interpretarLeitura<LinhaVitrine>({ data: [], error: null }, "vitrine/cartas");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.dados.length, 0);
});

test("Regra 19: leitura boa devolve as linhas intactas", () => {
  const l = linha();
  const r = interpretarLeitura({ data: [l], error: null }, "vitrine/cartas");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.dados, [l]);
});

test("as duas mensagens de tela são DIFERENTES e nenhuma delas mente", () => {
  // O defeito original era literalmente uma mensagem só para os dois estados.
  assert.notEqual(MSG_FALHA_VITRINE, MSG_VAZIO_VITRINE);
  // A mensagem de FALHA não pode afirmar que não há carta.
  assert.doesNotMatch(MSG_FALHA_VITRINE, /nenhuma carta/i);
});

// ===========================================================================
// PARTIÇÃO — eixo `exclusiva`, nunca a string
// ===========================================================================

test("partição: as exclusivas vão para a frente", () => {
  const lista = [
    { id: "a", exclusiva: false },
    { id: "b", exclusiva: true },
    { id: "c", exclusiva: false },
    { id: "d", exclusiva: true },
    { id: "e", exclusiva: true },
  ];
  assert.deepEqual(
    ordenarExclusivaPrimeiro(lista).map((x) => x.id),
    ["b", "d", "e", "a", "c"]
  );
});

test("partição: as 3 exclusivas de hoje ficam na frente mesmo vindo por último", () => {
  // Medido em 20/08/2026: `vw_vitrine_viva` = 2.295 linhas, 3 com exclusiva.
  // Aqui o pior caso: as três chegam no fim da página.
  const resto = Array.from({ length: 20 }, (_, i) => ({
    id: `r${i}`,
    exclusiva: false,
  }));
  const lista = [...resto, { id: "x1", exclusiva: true }, { id: "x2", exclusiva: true }, { id: "x3", exclusiva: true }];
  const ord = ordenarExclusivaPrimeiro(lista);
  assert.deepEqual(ord.slice(0, 3).map((x) => x.id), ["x1", "x2", "x3"]);
  assert.equal(ord.length, 23);
});

test("partição é ESTÁVEL: dentro de cada bloco a ordem do banco é preservada", () => {
  // O banco já ordena por custo e depois crédito. A partição não pode embaralhar.
  const lista = [
    { id: "n1", exclusiva: false },
    { id: "n2", exclusiva: false },
    { id: "x1", exclusiva: true },
    { id: "n3", exclusiva: false },
    { id: "x2", exclusiva: true },
  ];
  assert.deepEqual(
    ordenarExclusivaPrimeiro(lista).map((x) => x.id),
    ["x1", "x2", "n1", "n2", "n3"]
  );
});

test("partição: null e undefined NÃO são promovidos a exclusiva", () => {
  const lista = [
    { id: "a", exclusiva: null },
    { id: "b", exclusiva: true },
    { id: "c" },
  ] as { id: string; exclusiva?: boolean | null }[];
  assert.deepEqual(
    ordenarExclusivaPrimeiro(lista).map((x) => x.id),
    ["b", "a", "c"]
  );
});

// ===========================================================================
// ADAPTADOR view → cartão
// ===========================================================================

test("adaptarCarta traduz os nomes da view para os nomes do app", () => {
  const c = adaptarCarta(linha());
  assert.equal(c.valor_credito, 300000);
  assert.equal(c.valor_entrada, 90000);
  assert.equal(c.valor_parcela, 2500);
  assert.equal(c.qtd_parcelas, 120);
  assert.equal(c.bidcon_agio_150, 12000);
  assert.equal(c.bidcon_agio_120, null);
  assert.equal(c.bidcon_custo_am, 1.23);
  assert.equal(c.tipo, "imovel");
});

test("adaptarCarta preserva os nulos em vez de trocá-los por zero", () => {
  // Um `?? 0` aqui viraria "entrada de R$ 0,00" na tela — número inventado.
  const c = adaptarCarta(linha({ entrada: null, parcela: null, parcelas: null }));
  assert.equal(c.valor_entrada, null);
  assert.equal(c.valor_parcela, null);
  assert.equal(c.qtd_parcelas, null);
});

test("aceita_assuncao: sem dicionário o valor é null (NÃO SEI), nunca false", () => {
  const c = adaptarCarta(linha());
  assert.equal(c.administradora?.nome, "Porto Seguro");
  assert.equal(c.administradora?.aceita_assuncao, null);
});

test("aceita_assuncao: nome que não bate no dicionário também é null", () => {
  const mapa = new Map([["Servopa", true]]);
  const c = adaptarCarta(linha({ administradora: "Porto Seguro" }), mapa);
  assert.equal(c.administradora?.aceita_assuncao, null);
});

test("aceita_assuncao: dicionário mandou true/false e o valor é respeitado", () => {
  const mapa = new Map([
    ["Porto Seguro", true],
    ["Groscon", false],
  ]);
  assert.equal(adaptarCarta(linha(), mapa).administradora?.aceita_assuncao, true);
  assert.equal(
    adaptarCarta(linha({ administradora: "Groscon" }), mapa).administradora
      ?.aceita_assuncao,
    false
  );
});

test("administradora vazia na view vira null (não vira string em branco na tela)", () => {
  // A view faz COALESCE(a.nome, c.administradora_raw, ''). Medido hoje: 0 em
  // branco entre 33 nomes — mas o '' é possível por construção.
  assert.equal(adaptarCarta(linha({ administradora: "" })).administradora, null);
  assert.equal(adaptarCarta(linha({ administradora: null })).administradora, null);
});

test("adaptarCarta carrega `exclusiva` para o selo, sem inventar true", () => {
  assert.equal(adaptarCarta(linha({ exclusiva: true })).exclusiva, true);
  assert.equal(adaptarCarta(linha({ exclusiva: false })).exclusiva, false);
  assert.equal(adaptarCarta(linha({ exclusiva: null })).exclusiva, false);
});

// ===========================================================================
// ADAPTADOR view → fluxo (feed do Início)
// ===========================================================================

test("paraFluxo reafirma o invariante da view: status 'disponivel'", () => {
  // A view é definida COM `where status = 'disponivel'`; toda linha que sai
  // dela já provou ser disponível. Não é campo inventado, é invariante copiado.
  assert.equal(paraFluxo(linha()).status, "disponivel");
});

test("paraFluxo alimenta cartasNovas de verdade (o feed do Início não fica mudo)", () => {
  const agora = new Date("2026-08-20T00:00:00.000Z");
  const linhas = [
    linha({ id: "a", criado_em: "2026-08-19T10:00:00.000Z" }),
    linha({ id: "b", criado_em: "2026-08-18T10:00:00.000Z" }),
    linha({ id: "c", criado_em: "2026-05-01T10:00:00.000Z" }), // fora da janela
  ];
  const novas = cartasNovas(linhas.map(paraFluxo), { dias: 7, limite: 6, agora });
  assert.equal(novas.quantidade, 2);
});

// ===========================================================================
// REFERÊNCIA E RESERVA-PONTE
// ===========================================================================

test("refCarta usa o número externo quando existe, senão o prefixo do UUID", () => {
  assert.equal(refCarta(1234, "abcdef01-2222-3333-4444-555555555555"), "nº 1234");
  assert.equal(
    refCarta(null, "abcdef01-2222-3333-4444-555555555555"),
    "ref. abcdef01"
  );
});

test("a mensagem da ponte carrega o marcador [carta <uuid>] com o id INTEIRO", () => {
  // O marcador é lido por PESSOA (nada em platform/ o interpreta — medido: 0
  // ocorrências de "[carta "). Ele existe para ninguém confirmar carta errada,
  // então o id tem de ir inteiro, não abreviado.
  const id = "abcdef01-2222-3333-4444-555555555555";
  const msg = mensagemReservaPonte({
    id,
    ref: 1234,
    tipo: "imovel",
    valor_credito: 300000,
    valor_entrada: 90000,
    valor_parcela: 2500,
    qtd_parcelas: 120,
  });
  assert.ok(msg.includes(`[carta ${id}]`));
  assert.ok(msg.includes("nº 1234"));
  assert.ok(msg.includes("×120"));
});

test("a mensagem da ponte omite entrada/parcela ausentes em vez de escrever zero", () => {
  const msg = mensagemReservaPonte({
    id: "abcdef01-2222-3333-4444-555555555555",
    ref: null,
    tipo: "veiculo",
    valor_credito: 80000,
    valor_entrada: null,
    valor_parcela: null,
    qtd_parcelas: null,
  });
  assert.doesNotMatch(msg, /entrada/i);
  assert.doesNotMatch(msg, /parcela/i);
  assert.ok(msg.includes("ref. abcdef01"));
});

test("LÉXICO LIMPO: a mensagem da ponte não promete contemplação nem fala de investimento", () => {
  const msg = mensagemReservaPonte({
    id: "abcdef01-2222-3333-4444-555555555555",
    ref: 7,
    tipo: "imovel",
    valor_credito: 300000,
    valor_entrada: 90000,
    valor_parcela: 2500,
    qtd_parcelas: 120,
  });
  for (const proibida of [
    "investimento",
    "investidor",
    "rendimento",
    "retorno",
    "lucro",
    "CDI",
    "garantido",
    "contemplação em",
  ]) {
    assert.doesNotMatch(
      msg,
      new RegExp(proibida, "i"),
      `léxico proibido na mensagem da ponte: ${proibida}`
    );
  }
});

test("o link da ponte é wa.me do número do app, com o texto codificado", () => {
  const link = linkReservaPonte({
    id: "abcdef01-2222-3333-4444-555555555555",
    ref: 7,
    tipo: "imovel",
    valor_credito: 300000,
    valor_entrada: 90000,
    valor_parcela: 2500,
    qtd_parcelas: 120,
  });
  assert.ok(link.startsWith(`https://wa.me/${WA_PROSPERITO}?text=`));
  // Codificado de verdade: nem espaço cru, nem colchete cru na query.
  assert.doesNotMatch(link.split("?text=")[1] ?? "", /[ \[\]]/);
  // E o id sobrevive à codificação.
  assert.ok(decodeURIComponent(link.split("?text=")[1] ?? "").includes("[carta abcdef01-2222-3333-4444-555555555555]"));
});
