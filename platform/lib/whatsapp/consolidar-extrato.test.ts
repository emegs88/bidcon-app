// ============================================================================
// Testes da consolidação de extratos (EXTRATO-ANALISE-01, Entrega 1).
// ----------------------------------------------------------------------------
// OS FIXTURES SÃO DADOS REAIS, não inventados: são as linhas de `extratos_cotas`
// medidas em 10/08/2026, com os horários exatos de `wa_mensagens`. O caso que
// dá nome ao módulo — a conversa 0d9d74d9 com DUAS cotas separadas por 153,1 s —
// é o que a ordem original teria fundido numa quimera.
//
// O QUE ESTES TESTES PROTEGEM. Nada aqui lança quando erra. O modo de falha é
// um número plausível para uma cota inexistente, que segue calado até virar
// preço. Por isso os casos caros: a fusão entre rajadas, o conflito de
// identificador, o zero fabricado no lugar de "não lido", e a divergência
// numérica engolida em silêncio.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agruparEmRajadas,
  consolidarRajada,
  consolidarExtratos,
  conflitoDeIdentidade,
  coerenciaDe,
  normalizarIdentificador,
  perguntaPendencia,
  resumoDeterministico,
  JANELA_RAJADA_S,
  type FragmentoExtrato,
} from "./consolidar-extrato";

// Base neutra; cada teste sobrescreve só o que mede.
function frag(over: Partial<FragmentoExtrato> = {}): FragmentoExtrato {
  return {
    mensagem_id: 1,
    conversa_id: "conv-a",
    criado_em: "2026-08-06T16:43:09.355Z",
    administradora: null,
    grupo: null,
    cota: null,
    valor_credito: null,
    saldo_devedor: null,
    parcelas_pagas: null,
    parcelas_restantes: null,
    valor_parcela: null,
    contemplada: null,
    confianca: null,
    ...over,
  };
}

// ----- fixtures reais --------------------------------------------------------

// Conversa 0d9d74d9, rajada 1 — 16:43:09,36 a 16:43:10,00 (span 0,64 s).
const RAJADA_1: FragmentoExtrato[] = [
  frag({
    mensagem_id: 225,
    conversa_id: "0d9d74d9",
    criado_em: "2026-08-06T16:43:09.355984Z",
    administradora: "Santander",
    valor_parcela: 3234.6,
    parcelas_pagas: 17,
    parcelas_restantes: 82,
    confianca: 0.6,
  }),
  frag({
    mensagem_id: 226,
    conversa_id: "0d9d74d9",
    criado_em: "2026-08-06T16:43:09.808115Z",
    administradora: "Santander",
    contemplada: false,
    confianca: 0.4,
  }),
  frag({
    mensagem_id: 227,
    conversa_id: "0d9d74d9",
    criado_em: "2026-08-06T16:43:10.000485Z",
    administradora: "Santander",
    grupo: "000800",
    cota: "519-0",
    valor_credito: 260650,
    confianca: 0.7,
  }),
];

// Conversa 0d9d74d9, rajada 2 — 153,11 s depois. OUTRA cota.
const RAJADA_2: FragmentoExtrato[] = [
  frag({
    mensagem_id: 233,
    conversa_id: "0d9d74d9",
    criado_em: "2026-08-06T16:45:43.110030Z",
    administradora: "Santander",
    contemplada: false,
    confianca: 0.4,
  }),
  frag({
    mensagem_id: 234,
    conversa_id: "0d9d74d9",
    criado_em: "2026-08-06T16:45:43.876680Z",
    administradora: "Santander",
    valor_parcela: 2862.48,
    parcelas_pagas: 18,
    parcelas_restantes: 122,
    confianca: 0.6,
  }),
  frag({
    mensagem_id: 235,
    conversa_id: "0d9d74d9",
    criado_em: "2026-08-06T16:45:44.104467Z",
    administradora: "Santander",
    grupo: "003093",
    cota: "90-0",
    valor_credito: 297645.51,
    confianca: 0.6,
  }),
];

// Conversa b3372777 — UMA cota, mas com 4,59 s e 3,10 s entre as fotos.
// É o caso que mata qualquer limiar apertado (1 s, 2 s).
const RAJADA_LENTA: FragmentoExtrato[] = [
  frag({
    mensagem_id: 267,
    conversa_id: "b3372777",
    criado_em: "2026-08-06T22:22:07.485767Z",
    grupo: "46697",
    cota: "163",
    confianca: 0.5,
  }),
  frag({
    mensagem_id: 268,
    conversa_id: "b3372777",
    criado_em: "2026-08-06T22:22:12.070829Z",
    saldo_devedor: 18237.29,
    parcelas_restantes: 48,
    contemplada: false,
    confianca: 0.75,
  }),
  frag({
    mensagem_id: 269,
    conversa_id: "b3372777",
    criado_em: "2026-08-06T22:22:15.166465Z",
    valor_credito: 30053.26,
    confianca: 0.4,
  }),
];

// Conversa 9eb5f278, msg 27 — a ÚNICA leitura completa de toda a base.
const MSG_27 = frag({
  mensagem_id: 27,
  conversa_id: "9eb5f278",
  criado_em: "2026-07-20T02:39:12.000Z",
  administradora: "CNP CONSORCIO S.A. ADMINISTRADORA DE CONSORCIOS",
  grupo: "001035",
  cota: "8593 00",
  valor_credito: 130584.16,
  saldo_devedor: 93147,
  parcelas_pagas: 82,
  parcelas_restantes: 109,
  valor_parcela: 854.67,
  contemplada: true,
  confianca: 0.95,
});

// ----- agruparEmRajadas ------------------------------------------------------

test("as duas rajadas da conversa 0d9d74d9 NÃO se fundem", () => {
  const rajadas = agruparEmRajadas([...RAJADA_1, ...RAJADA_2]);
  assert.equal(rajadas.length, 2, "153,1 s tem que cortar");
  assert.deepEqual(rajadas[0].map((f) => f.mensagem_id), [225, 226, 227]);
  assert.deepEqual(rajadas[1].map((f) => f.mensagem_id), [233, 234, 235]);
});

test("a rajada lenta (4,59 s e 3,10 s) continua sendo UMA só", () => {
  const rajadas = agruparEmRajadas(RAJADA_LENTA);
  assert.equal(rajadas.length, 1, "intervalo interno de 4,59 s não é separador");
  assert.deepEqual(rajadas[0].map((f) => f.mensagem_id), [267, 268, 269]);
});

test("a janela de 30 s fica entre o maior interno (4,59 s) e o menor separador (153,11 s)", () => {
  assert.ok(JANELA_RAJADA_S > 4.59, "tem que caber o maior intervalo interno medido");
  assert.ok(JANELA_RAJADA_S < 153.11, "não pode alcançar o menor separador medido");
});

test("conversas diferentes nunca caem na mesma rajada, mesmo no mesmo instante", () => {
  const a = frag({ mensagem_id: 1, conversa_id: "conv-a", criado_em: "2026-08-06T10:00:00.000Z" });
  const b = frag({ mensagem_id: 2, conversa_id: "conv-b", criado_em: "2026-08-06T10:00:00.000Z" });
  assert.equal(agruparEmRajadas([a, b]).length, 2);
});

test("data ilegível corta em vez de fundir", () => {
  const a = frag({ mensagem_id: 1, criado_em: "2026-08-06T10:00:00.000Z" });
  const b = frag({ mensagem_id: 2, criado_em: "isto não é data" });
  assert.equal(agruparEmRajadas([a, b]).length, 2);
});

test("rajada vazia devolve lista vazia, não uma rajada fantasma", () => {
  assert.deepEqual(agruparEmRajadas([]), []);
});

// ----- consolidação: o caso que justifica o módulo ---------------------------

test("a rajada 1 fundida produz UMA cota com os campos das três fotos", () => {
  const a = consolidarRajada(RAJADA_1);
  assert.equal(a.status, "completa");
  assert.equal(a.campos.grupo.valor, "000800");
  assert.equal(a.campos.cota.valor, "519-0");
  assert.equal(a.campos.valor_credito.valor, 260650);
  assert.equal(a.campos.valor_parcela.valor, 3234.6);
  assert.equal(a.campos.parcelas_restantes.valor, 82);
  assert.equal(a.campos.contemplada.valor, false);
  assert.equal(a.campos.administradora.valor, "Santander");
});

test("cada campo carrega de qual mensagem veio — sem procedência não há correção", () => {
  const a = consolidarRajada(RAJADA_1);
  assert.equal(a.campos.valor_parcela.origem, 225);
  assert.equal(a.campos.contemplada.origem, 226);
  assert.equal(a.campos.valor_credito.origem, 227);
});

test("a confiança da rajada é a MENOR das leituras, não a média nem a maior", () => {
  const a = consolidarRajada(RAJADA_1);
  assert.equal(a.confianca_minima, 0.4, "0,4 da msg 226 é o elo fraco");
});

test("campo ausente fica null, NUNCA zero", () => {
  const a = consolidarRajada([RAJADA_1[0]]); // só a msg 225
  assert.equal(a.campos.valor_credito.valor, null);
  assert.notEqual(a.campos.valor_credito.valor, 0);
  assert.equal(a.status, "incompleta");
  assert.deepEqual(a.faltantes, ["valor_credito"]);
});

// ----- conflito: a quimera que a ordem original teria criado -----------------

test("fundir a conversa 0d9d74d9 inteira é detectado como conflito", () => {
  const motivo = conflitoDeIdentidade([...RAJADA_1, ...RAJADA_2]);
  assert.ok(motivo, "grupo 000800 contra 003093 tem que acusar");
  assert.match(motivo!, /grupo/);
  assert.match(motivo!, /800/);
  assert.match(motivo!, /3093/);
});

test("em conflito NADA é fundido — os campos voltam vazios", () => {
  const a = consolidarRajada([...RAJADA_1, ...RAJADA_2]);
  assert.equal(a.status, "conflito");
  assert.equal(a.campos.valor_credito.valor, null, "a quimera não pode existir nem marcada");
  assert.equal(a.campos.valor_parcela.valor, null);
  assert.equal(a.campos.grupo.valor, null);
  assert.ok(a.motivo_conflito);
});

test("dentro de cada rajada real NÃO há conflito — é por isso que o tempo agrupa", () => {
  assert.equal(conflitoDeIdentidade(RAJADA_1), null);
  assert.equal(conflitoDeIdentidade(RAJADA_2), null);
  assert.equal(conflitoDeIdentidade(RAJADA_LENTA), null);
});

test("zero à esquerda não inventa conflito: 000800 e 800 são o mesmo grupo", () => {
  const fs = [
    frag({ mensagem_id: 1, grupo: "000800", criado_em: "2026-08-06T16:43:09.000Z" }),
    frag({ mensagem_id: 2, grupo: "800", criado_em: "2026-08-06T16:43:10.000Z" }),
  ];
  assert.equal(conflitoDeIdentidade(fs), null);
});

test("normalizarIdentificador só existe para comparar, e preserva o zero puro", () => {
  assert.equal(normalizarIdentificador("000800"), "800");
  assert.equal(normalizarIdentificador("519-0"), "5190");
  assert.equal(normalizarIdentificador("8593 00"), "859300");
  assert.equal(normalizarIdentificador("0"), "0");
  assert.equal(normalizarIdentificador(""), null);
  assert.equal(normalizarIdentificador(null), null);
});

// ----- divergência numérica --------------------------------------------------

test("dois créditos diferentes na mesma rajada marcam divergente, não passam calados", () => {
  const fs = [
    frag({ mensagem_id: 1, grupo: "800", valor_credito: 260650, valor_parcela: 3234.6, parcelas_restantes: 82, confianca: 0.7, criado_em: "2026-08-06T16:43:09.000Z" }),
    frag({ mensagem_id: 2, grupo: "800", valor_credito: 260000, confianca: 0.5, criado_em: "2026-08-06T16:43:10.000Z" }),
  ];
  const a = consolidarRajada(fs);
  assert.equal(a.status, "divergente");
  assert.equal(a.campos.valor_credito.valor, 260650, "vence a maior confiança");
  assert.equal(a.campos.valor_credito.divergencias.length, 1);
  assert.equal(a.campos.valor_credito.divergencias[0].valor, 260000);
});

test("divergência só de administradora não bloqueia preço", () => {
  const fs = [
    frag({ mensagem_id: 1, administradora: "Santander", valor_credito: 100, valor_parcela: 2, parcelas_restantes: 60, confianca: 0.8, criado_em: "2026-08-06T16:43:09.000Z" }),
    frag({ mensagem_id: 2, administradora: "Banco Santander", confianca: 0.5, criado_em: "2026-08-06T16:43:10.000Z" }),
  ];
  const a = consolidarRajada(fs);
  assert.equal(a.status, "completa");
  assert.equal(a.campos.administradora.divergencias.length, 1);
});

// ----- coerência -------------------------------------------------------------

test("a msg 27 passa na conferência de coerência (93.147 / 854,67 = 108,99 vs 109)", () => {
  const a = consolidarRajada([MSG_27]);
  assert.ok(a.coerencia);
  assert.equal(a.coerencia!.ok, true);
  assert.ok(a.coerencia!.desvio < 0.001, `desvio medido ${a.coerencia!.desvio}`);
});

test("saldo incompatível com parcela x prazo reprova na coerência", () => {
  const campos = consolidarRajada([
    frag({ saldo_devedor: 50000, valor_parcela: 854.67, parcelas_restantes: 109 }),
  ]).campos;
  const c = coerenciaDe(campos);
  assert.ok(c);
  assert.equal(c!.ok, false);
});

test("coerência devolve null quando falta dado, em vez de fingir que passou", () => {
  const campos = consolidarRajada([frag({ valor_parcela: 100 })]).campos;
  assert.equal(coerenciaDe(campos), null);
});

// ----- pendência e resumo ----------------------------------------------------

test("a pergunta pronta nomeia o que falta e não promete nada", () => {
  const p = perguntaPendencia(["valor_credito", "valor_parcela"]);
  assert.ok(p);
  assert.match(p!, /valor do crédito/);
  assert.match(p!, /valor da parcela/);
  // Léxico vedado da casa e promessas.
  assert.doesNotMatch(p!, /investimento|investidor|rendimento|retorno|lucro|CDI/i);
  assert.doesNotMatch(p!, /contempla(ção|do|da)/i);
  assert.doesNotMatch(p!, /prazo de venda|garant/i);
});

test("sem faltantes não há pergunta a fazer", () => {
  assert.equal(perguntaPendencia([]), null);
});

test("o resumo determinístico só usa campo que existe — não inventa nem zera", () => {
  const a = consolidarRajada([MSG_27]);
  const r = resumoDeterministico(a.campos);
  assert.match(r, /Cota contemplada/);
  assert.match(r, /130\.584,16/);
  assert.match(r, /109 parcelas restantes/);
  assert.doesNotMatch(r, /null|undefined|NaN/);
});

test("resumo de rajada pobre não cita campo ausente", () => {
  const a = consolidarRajada([RAJADA_1[1]]); // só contemplada + administradora
  const r = resumoDeterministico(a.campos);
  assert.match(r, /não contemplada/);
  assert.doesNotMatch(r, /crédito/);
  assert.doesNotMatch(r, /parcelas/);
});

// ----- ponta a ponta ---------------------------------------------------------

test("os 9 fragmentos reais viram 3 análises, não 2 conversas nem 9 arquivos", () => {
  const analises = consolidarExtratos([...RAJADA_1, ...RAJADA_2, ...RAJADA_LENTA]);
  assert.equal(analises.length, 3);
  const creditos = analises.map((a) => a.campos.valor_credito.valor).sort((x, y) => (x ?? 0) - (y ?? 0));
  assert.deepEqual(creditos, [30053.26, 260650, 297645.51]);
  assert.ok(analises.every((a) => a.status !== "conflito"));
});
