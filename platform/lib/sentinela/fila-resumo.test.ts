// ============================================================================
// Teste do resumo da fila do Sentinela — SENTINELA-RADAR-01, item 1.4
// ----------------------------------------------------------------------------
// A fixture NÃO é inventada: são as 30 linhas que existem em `sentinela_fila`
// hoje, medidas em 16/08/2026 — 21 `aguardando_template` de 04/08 com
// `criado_em` IDÊNTICO, 5 `pendente` espalhadas entre 06/08 e 14/08, e 4
// `excluido`. E `sum(tentativas) = 0` na tabela inteira: ninguém foi tocado
// nunca. O resumo tem de conseguir dizer isso.
//
// O teste que mais importa é o do status desconhecido. Uma partição por
// `!encerrado` classificaria um status novo como "esperando" e inflaria a
// fila; a partição inversa o esconderia. As duas mentem. Aqui ele aparece com
// o nome dele.
//
// ----------------------------------------------------------------------------
// A SEGUNDA FIXTURE, DE 29/08/2026 — E POR QUE ELA EXISTE
//
// A fila de 16/08 continua aqui porque um número medido não se joga fora. Mas
// em 29/08 a fila tinha OUTRA cara: 52 linhas, e 26 delas (metade) caíam em
// `desconhecidas` porque cinco status haviam nascido no enum sem que este
// código soubesse. `FILA_29_08` trava esse dia. Se alguém encolher as listas
// de novo, é ela que quebra — com o número exato na mensagem.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  diasDesde,
  estaEncerrada,
  estaEsperando,
  resumirFila,
  STATUS_ENCERRADOS,
  STATUS_ESPERANDO,
  type LinhaFila,
} from "@/lib/sentinela/fila-resumo";

const AGORA = new Date("2026-08-16T12:00:00.000Z");
/** As 21, todas com o MESMO instante — foi um lote só. */
const EM_04_08 = "2026-08-04T22:27:20.820481+00:00";

function linha(p: Partial<LinhaFila>): LinhaFila {
  return {
    status: "pendente",
    motivo: "silencio_pos_pergunta",
    tentativas: 0,
    criado_em: EM_04_08,
    ...p,
  };
}

/** A fila real de 16/08/2026: 21 + 5 + 4. */
const FILA_REAL: LinhaFila[] = [
  ...Array.from({ length: 21 }, () =>
    linha({ status: "aguardando_template", criado_em: EM_04_08 })
  ),
  linha({ status: "pendente", criado_em: "2026-08-06T12:01:07.112009+00:00" }),
  linha({ status: "pendente", criado_em: "2026-08-08T12:01:00.000000+00:00" }),
  linha({ status: "pendente", criado_em: "2026-08-10T12:01:00.000000+00:00" }),
  linha({ status: "pendente", criado_em: "2026-08-12T12:01:00.000000+00:00" }),
  linha({ status: "pendente", criado_em: "2026-08-14T12:01:06.581761+00:00" }),
  ...Array.from({ length: 4 }, () => linha({ status: "excluido", criado_em: EM_04_08 })),
];

/**
 * A fila real de 29/08/2026, contada no banco: 25 `encerrado_por_silencio`,
 * 16 `enviado`, 7 `excluido`, 3 `respondeu`, 1 `duplicado_telefone`.
 */
const FILA_29_08: LinhaFila[] = [
  ...Array.from({ length: 25 }, () => linha({ status: "encerrado_por_silencio" })),
  ...Array.from({ length: 16 }, () =>
    linha({ status: "enviado", criado_em: "2026-08-25T12:00:43.000000+00:00", tentativas: 1 })
  ),
  ...Array.from({ length: 7 }, () => linha({ status: "excluido" })),
  ...Array.from({ length: 3 }, () => linha({ status: "respondeu" })),
  linha({ status: "duplicado_telefone" }),
];

// ---------------------------------------------------------------------------
// A PARTIÇÃO
// ---------------------------------------------------------------------------

test("as duas listas cobrem os doze status do enum, sem sobra e sem repetir", () => {
  // Os doze valores de `sentinela_status`, lidos do banco em 29/08/2026. Eram
  // sete quando este teste nasceu. Esta lista é escrita à MÃO e não tem como
  // se atualizar sozinha: teste offline não alcança um enum de Postgres. Então
  // ela envelhece igual ao cabeçalho do módulo — e envelheceu, treze dias.
  // Quem crescer o enum: cresça aqui junto. E entenda que este teste NÃO é a
  // defesa contra o esquecimento; a defesa é o contador `desconhecidas`, que
  // acende sozinho quando uma linha chega com nome que ninguém previu.
  const enumMedido = [
    "pendente",
    "aguardando_template",
    "enviado",
    "respondeu",
    "esgotado",
    "excluido",
    "erro",
    "encerrado_por_silencio",
    "encerrada_cordialmente",
    "handoff_humano",
    "duplicado_telefone",
    "erro_permanente",
  ];
  // `string[]` de propósito: as duas constantes são de literais, e um
  // `includes` sobre elas recusaria `string` no tsc — o teste passaria no tsx,
  // que não checa tipo, e quebraria o portão. É o enum medido que manda aqui.
  const cobertos: string[] = [...STATUS_ESPERANDO, ...STATUS_ENCERRADOS];
  assert.equal(new Set(cobertos).size, cobertos.length, "nenhum status em duas listas");
  for (const s of enumMedido) {
    assert.ok(cobertos.includes(s), `${s} nao esta em lista nenhuma`);
  }
  assert.equal(cobertos.length, enumMedido.length, "lista fechada: nem sobra nem falta");
});

test("'respondeu' e o rotulo do banco — 'respondido' nao existe", () => {
  assert.equal(estaEncerrada("respondeu"), true);
  assert.equal(estaEncerrada("respondido"), false, "erro de digitacao viraria desconhecido");
  assert.equal(estaEsperando("respondido"), false, "e NAO pode virar espera por descuido");
});

test("status novo nao vira espera nem some — aparece como desconhecido", () => {
  // O exemplo aqui era `encerrado_por_silencio` até 29/08/2026, quando medi o
  // enum e descobri que ele tinha VIRADO STATUS REAL — com 25 linhas vivas. Ao
  // colocá-lo em STATUS_ENCERRADOS este teste continuaria VERDE testando nada:
  // `desconhecidas` daria 0 e o assert de 1 quebraria... e se eu tivesse
  // escrito `>= 0` por descuido, passaria mudo para sempre. Por isso o exemplo
  // agora é um nome que NÃO PODE virar real: não é candidato a status nenhum.
  const NUNCA_SERA_STATUS = "status_que_nao_existe_no_enum_zzz";
  const r = resumirFila([linha({ status: NUNCA_SERA_STATUS })], AGORA);
  assert.equal(r.total, 1);
  assert.equal(r.esperando, 0, "status novo nao infla a fila");
  assert.equal(r.encerradas, 0);
  assert.equal(r.desconhecidas, 1);
  const g = r.porStatus.find((x) => x.status === NUNCA_SERA_STATUS);
  assert.ok(g);
  assert.equal(g.conhecido, false, "o painel precisa poder gritar sobre ele");
});

test("os cinco status que faltavam nao caem mais em desconhecidas", () => {
  // A regressão que esta fatia existe para impedir. Em 29/08 estes cinco
  // estavam no enum e fora do código: 26 das 52 linhas da fila — METADE —
  // eram classificadas como "não sei".
  const r = resumirFila(
    [
      linha({ status: "encerrado_por_silencio" }),
      linha({ status: "encerrada_cordialmente" }),
      linha({ status: "duplicado_telefone" }),
      linha({ status: "erro_permanente" }),
      linha({ status: "handoff_humano" }),
    ],
    AGORA
  );
  assert.equal(r.desconhecidas, 0, "os cinco sao conhecidos agora");
  assert.equal(r.encerradas, 4, "quatro sairam da fila");
  assert.equal(r.esperando, 1, "handoff_humano ainda espera — de gente, mas espera");
});

test("handoff_humano e ESPERA: o robo parou, o atendimento nao", () => {
  // Julgamento, não leitura — e por isso está travado aqui em vez de morar só
  // num comentário. Se a casa decidir o contrário, é este assert que cai
  // primeiro, e a decisão fica visível no diff em vez de silenciosa.
  assert.equal(estaEsperando("handoff_humano"), true);
  assert.equal(estaEncerrada("handoff_humano"), false);
});

// ---------------------------------------------------------------------------
// A FILA REAL
// ---------------------------------------------------------------------------

test("a fila real de 16/08: 30 linhas, 26 esperando, 4 encerradas", () => {
  const r = resumirFila(FILA_REAL, AGORA);
  assert.equal(r.total, 30);
  assert.equal(r.esperando, 26, "21 aguardando_template + 5 pendente");
  assert.equal(r.encerradas, 4);
  assert.equal(r.desconhecidas, 0);
});

test("a fila de 29/08: 52 linhas, e NENHUMA desconhecida", () => {
  const r = resumirFila(FILA_29_08, new Date("2026-08-29T12:00:00.000Z"));
  assert.equal(r.total, 52);
  assert.equal(
    r.desconhecidas,
    0,
    "antes desta fatia eram 26 — metade da fila classificada como 'nao sei'"
  );
  assert.equal(r.esperando, 16, "so os 16 enviado ainda esperam");
  assert.equal(r.encerradas, 36, "25 silencio + 7 excluido + 3 respondeu + 1 duplicado");
  assert.equal(r.total, r.esperando + r.encerradas + r.desconhecidas, "a conta fecha");
});

test("a mais antiga que ESPERA e a de 04/08 — onze dias", () => {
  const r = resumirFila(FILA_REAL, AGORA);
  assert.equal(r.maisAntigaEsperandoEm, EM_04_08);
  assert.equal(r.diasMaisAntigaEsperando, 11);
});

test("zero toques na tabela inteira — o fato que o painel precisa dizer", () => {
  const r = resumirFila(FILA_REAL, AGORA);
  assert.equal(r.toquesDados, 0, "ninguem foi tocado nunca");
});

test("quem espera vem antes, e o maior grupo primeiro", () => {
  const r = resumirFila(FILA_REAL, AGORA);
  assert.equal(r.porStatus[0].status, "aguardando_template");
  assert.equal(r.porStatus[0].n, 21);
  assert.equal(r.porStatus[1].status, "pendente");
  assert.equal(r.porStatus[2].status, "excluido", "encerrado por ultimo, e historico");
  assert.equal(r.porStatus[2].esperando, false);
});

test("a idade de cada grupo sai do MAIS ANTIGO dele, nao do mais novo", () => {
  const r = resumirFila(FILA_REAL, AGORA);
  const pendentes = r.porStatus.find((g) => g.status === "pendente");
  assert.ok(pendentes);
  // A mais nova das pendentes é de 14/08 (2 dias). Se o resumo usasse ela, a
  // fila pareceria recente. A mais antiga é 06/08 12:01:07, e AGORA é 16/08
  // 12:00:00 — faltam 67 segundos para dez dias, então a idade é 9. Escrevi 10
  // aqui na primeira versão e o teste me corrigiu: `diasDesde` trunca, não
  // arredonda, e é isso que a tela deve dizer. Dia inteiro só quando é inteiro.
  assert.equal(pendentes.diasMaisAntiga, 9);
});

// ---------------------------------------------------------------------------
// MOTIVO
// ---------------------------------------------------------------------------

test("o motivo contado e o de QUEM ESPERA — encerrado nao entra", () => {
  const r = resumirFila(
    [
      linha({ status: "pendente", motivo: "silencio_pos_pergunta" }),
      linha({ status: "excluido", motivo: "silencio_pos_pergunta" }),
    ],
    AGORA
  );
  assert.deepEqual(r.porMotivo, [{ motivo: "silencio_pos_pergunta", n: 1 }]);
});

test("motivo vazio nao vira string vazia na tela", () => {
  const r = resumirFila(
    [linha({ status: "pendente", motivo: "  " }), linha({ status: "pendente", motivo: null })],
    AGORA
  );
  assert.deepEqual(r.porMotivo, [{ motivo: "sem motivo registrado", n: 2 }]);
});

// ---------------------------------------------------------------------------
// BORDAS
// ---------------------------------------------------------------------------

test("fila vazia e um resumo honesto, nao um estouro", () => {
  const r = resumirFila([], AGORA);
  assert.equal(r.total, 0);
  assert.equal(r.esperando, 0);
  assert.deepEqual(r.porStatus, []);
  assert.deepEqual(r.porMotivo, []);
  assert.equal(r.maisAntigaEsperandoEm, null);
  assert.equal(r.diasMaisAntigaEsperando, null);
});

test("data invalida devolve null, nao NaN", () => {
  assert.equal(diasDesde("nao e data", AGORA), null);
  const r = resumirFila([linha({ status: "pendente", criado_em: "nao e data" })], AGORA);
  assert.equal(r.diasMaisAntigaEsperando, null, "NaN na tela viraria 'ha NaN dias'");
});

test("linha criada no futuro tem idade 0, nao negativa", () => {
  assert.equal(diasDesde("2026-08-20T00:00:00.000Z", AGORA), 0);
});

test("tentativas nao-numerica nao contamina a soma", () => {
  const r = resumirFila(
    [
      linha({ status: "pendente", tentativas: 2 }),
      linha({ status: "pendente", tentativas: NaN as unknown as number }),
    ],
    AGORA
  );
  assert.equal(r.toquesDados, 2, "NaN somado daria NaN e o painel mostraria 'NaN toques'");
});
