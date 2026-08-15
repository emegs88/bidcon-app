// ============================================================================
// Testes da sala de atendimento (CONVERSAS-02).
// ----------------------------------------------------------------------------
// O QUE ESTES TESTES PROTEGEM. As três regras desta fatia erram em silêncio:
// a tela continua bonita mostrando a conversa errada em primeiro lugar. Então
// os casos abaixo não são "a função devolve string" — são os casos em que um
// erro custaria atendimento: o IGSID formatado como telefone, a espera que
// desempata contra a cronologia, e a mediana que uma conversa esquecida
// arruinaria se fosse média.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatarContato,
  iniciais,
  resumirFala,
  tempoRelativo,
  esperandoHumano,
  esperaMs,
  ordenarSala,
  mediana,
  duracaoCurta,
  resumirConversa,
  offsetTzMinutos,
  inicioDoDiaMs,
  chaveDia,
  lerPeriodo,
  janelaPeriodo,
  dentroDoPeriodo,
  rotuloDia,
  agruparPorDia,
  separarSala,
  identidadeCard,
  previaComContexto,
  PERIODO_PADRAO,
  TZ_CASA,
  type ConversaSala,
} from "./sala";

// Base neutra; cada teste sobrescreve só o que está medindo.
function conversa(over: Partial<ConversaSala> = {}): ConversaSala {
  return {
    id: "c1",
    canal: "whatsapp",
    nome: null,
    telefone: "5519997561909",
    status: "ativo",
    ultimaEm: "2026-08-09T12:00:00Z",
    ultimoPapel: "prosperito",
    ultimaFalaCliente: null,
    ultimaFalaClienteEm: null,
    ultimaPerguntaBot: null,
    totalMensagens: 3,
    temAnexo: false,
    msPrimeiraResposta: null,
    ...over,
  };
}

// --- redução por conversa --------------------------------------------------

test("resumirConversa — a prévia é a fala do CLIENTE, não a última mensagem", () => {
  // O defeito que este teste impede: em 142 das 328 mensagens quem falou por
  // último é o bot. Mostrar "a última mensagem" faria a sala inteira parecer o
  // Prosperito conversando sozinho.
  const r = resumirConversa([
    { papel: "cliente", conteudo: "quero vender minha cota", criado_em: "2026-08-09T12:00:00Z" },
    { papel: "prosperito", conteudo: "Claro! Me conta o valor.", criado_em: "2026-08-09T12:01:00Z" },
  ]);
  assert.equal(r.ultimaFalaCliente, "quero vender minha cota");
  assert.equal(r.ultimaFalaClienteEm, "2026-08-09T12:00:00Z");
  assert.equal(r.ultimoPapel, "prosperito");
  assert.equal(r.ultimaEm, "2026-08-09T12:01:00Z");
  assert.equal(r.totalMensagens, 2);
});

test("resumirConversa — ordena por data, não confia na ordem que veio", () => {
  const r = resumirConversa([
    { papel: "prosperito", conteudo: "b", criado_em: "2026-08-09T12:05:00Z" },
    { papel: "cliente", conteudo: "a", criado_em: "2026-08-09T12:00:00Z" },
  ]);
  assert.equal(r.ultimaEm, "2026-08-09T12:05:00Z");
  assert.equal(r.msPrimeiraResposta, 5 * 60_000);
});

test("resumirConversa — pergunta ainda SEM resposta não vira zero nem 'agora menos'", () => {
  // A decisão do arquivo: medição em curso não entra na mediana de medições
  // encerradas. Essa conversa é contada no número 'aguardando resposta'.
  const r = resumirConversa([
    { papel: "cliente", conteudo: "tem carta de 300 mil?", criado_em: "2026-08-09T12:00:00Z" },
  ]);
  assert.equal(r.msPrimeiraResposta, null);
  assert.equal(r.ultimoPapel, "cliente");
});

test("resumirConversa — 'sistema' (nota de handoff) NÃO conta como resposta", () => {
  // Contá-la faria "um humano assumiu" parecer "o cliente foi atendido".
  const r = resumirConversa([
    { papel: "cliente", conteudo: "oi", criado_em: "2026-08-09T12:00:00Z" },
    { papel: "sistema", conteudo: "Conversa assumida por um humano.", criado_em: "2026-08-09T12:02:00Z" },
  ]);
  assert.equal(r.msPrimeiraResposta, null);
});

test("resumirConversa — disparo ativo sem resposta do cliente não mede nada", () => {
  const r = resumirConversa([
    { papel: "prosperito", conteudo: "template", criado_em: "2026-08-09T12:00:00Z" },
    { papel: "prosperito", conteudo: "template 2", criado_em: "2026-08-09T12:30:00Z" },
  ]);
  assert.equal(r.msPrimeiraResposta, null);
  assert.equal(r.ultimaFalaCliente, null);
});

test("resumirConversa — conta a PRIMEIRA resposta, não a última", () => {
  const r = resumirConversa([
    { papel: "cliente", conteudo: "oi", criado_em: "2026-08-09T12:00:00Z" },
    { papel: "prosperito", conteudo: "olá", criado_em: "2026-08-09T12:01:00Z" },
    { papel: "cliente", conteudo: "e aí?", criado_em: "2026-08-09T14:00:00Z" },
    { papel: "humano", conteudo: "aqui!", criado_em: "2026-08-09T18:00:00Z" },
  ]);
  assert.equal(r.msPrimeiraResposta, 60_000);
  assert.equal(r.ultimaFalaCliente, "e aí?");
});

test("resumirConversa — anexo em qualquer mensagem marca a conversa", () => {
  const r = resumirConversa([
    { papel: "cliente", conteudo: null, criado_em: "2026-08-09T12:00:00Z", temAnexo: true },
    { papel: "prosperito", conteudo: "recebi", criado_em: "2026-08-09T12:01:00Z" },
  ]);
  assert.equal(r.temAnexo, true);
});

test("resumirConversa — conversa vazia não explode", () => {
  const r = resumirConversa([]);
  assert.equal(r.ultimaEm, null);
  assert.equal(r.ultimoPapel, null);
  assert.equal(r.totalMensagens, 0);
  assert.equal(r.msPrimeiraResposta, null);
});

// --- identidade ------------------------------------------------------------

test("formatarContato — celular BR vira +55 DD 9XXXX-XXXX", () => {
  const r = formatarContato("5519997561909", "whatsapp");
  assert.equal(r.texto, "+55 19 99756-1909");
  assert.equal(r.ehTelefone, true);
});

test("formatarContato — fixo de 8 dígitos também formata", () => {
  assert.equal(formatarContato("551933334444", "whatsapp").texto, "+55 19 3333-4444");
});

test("formatarContato — IGSID do Instagram NÃO é formatado como telefone", () => {
  // O defeito que este teste impede: "+13 10 81961-8770667", um número que não
  // existe exibido com a cara de um que existe. São 4 das 27 conversas.
  const r = formatarContato("1310819618770667", "instagram");
  assert.equal(r.ehTelefone, false);
  assert.equal(r.texto, "ID 1310819618770667");
  assert.ok(!r.texto.includes("+55"));
});

test("formatarContato — telefone do site sai nacional, SEM inventar o +55", () => {
  // Medido em `interesses`: as 41 linhas têm 11 dígitos e NENHUMA tem o 55.
  // O defeito que este teste impede é duplo. Com a regex antiga (`^55...`) as
  // 41 cairiam no cru, "11987654321". Com um `+55` costurado na frente, a tela
  // afirmaria um DDI que o banco nunca guardou.
  const r = formatarContato("19997561909", "site");
  assert.equal(r.texto, "(19) 99756-1909");
  assert.equal(r.ehTelefone, true);
  assert.ok(!r.texto.includes("+55"));
});

test("formatarContato — fixo de 8 dígitos no site também formata", () => {
  assert.equal(formatarContato("1933334444", "site").texto, "(19) 3333-4444");
});

test("formatarContato — site NÃO aceita número já com DDI", () => {
  // 13 dígitos não é o formato medido do site. Se um dia o formulário passar a
  // gravar com DDI, este teste vira vermelho — que é exatamente o aviso que se
  // quer: mudança de formato precisa ser vista, não absorvida em silêncio.
  const r = formatarContato("5519997561909", "site");
  assert.equal(r.ehTelefone, false);
  assert.equal(r.texto, "5519997561909");
});

test("formatarContato — número fora do padrão volta cru, sem inventar máscara", () => {
  const r = formatarContato("12345", "whatsapp");
  assert.equal(r.ehTelefone, false);
  assert.equal(r.texto, "12345");
});

test("formatarContato — DDI estrangeiro no WhatsApp não é disfarçado de BR", () => {
  // Medido: uma linha de `wa_conversas` tem 12 dígitos começando em 44 (Reino
  // Unido). Formatá-la como "+55 44 ..." lhe daria cara de número do Paraná.
  const r = formatarContato("447911123456", "whatsapp");
  assert.equal(r.ehTelefone, false);
  assert.equal(r.texto, "447911123456");
});

test("formatarContato — vazio não vira string vazia na tela", () => {
  assert.equal(formatarContato(null, "whatsapp").texto, "sem contato");
});

test("iniciais — primeiro e último nome", () => {
  assert.equal(iniciais("Emerson Gomes dos Santos"), "ES");
  assert.equal(iniciais("Ana"), "A");
});

test("iniciais — sem nome devolve null (não inventa letra do telefone)", () => {
  // Se derivasse do telefone, todo mundo seria "55" e o mural não
  // identificaria ninguém.
  assert.equal(iniciais(null), null);
  assert.equal(iniciais("   "), null);
});

// --- contexto --------------------------------------------------------------

test("resumirFala — texto curto passa inteiro e SEM reticência", () => {
  assert.equal(resumirFala("quero vender minha cota"), "quero vender minha cota");
});

test("resumirFala — em PROSA, corta na fronteira de palavra", () => {
  // O caso real: espaço a cada poucos caracteres, então o último espaço cai
  // colado no limite e a fronteira é respeitada sem custo.
  const frase =
    "quero vender minha cota do consórcio de imóvel que eu tenho na Porto Seguro desde 2019 obrigado";
  const r = resumirFala(frase, 90)!;
  assert.ok(r.endsWith("…"));
  // O corte caiu num espaço do original: o texto sem a reticência é um prefixo
  // exato da frase E o caractere seguinte na frase é espaço.
  const semReticencia = r.slice(0, -1);
  assert.ok(frase.startsWith(semReticencia));
  assert.equal(frase[semReticencia.length], " ");
});

test("resumirFala — sem prosa, a fronteira é ABANDONADA em vez de esvaziar a prévia", () => {
  // 40 chars, um espaço, e depois 80 sem espaço nenhum. Obedecer a fronteira
  // devolveria 40 de 90 caracteres — jogaria fora 55% da prévia para ficar
  // bonito. A guarda dos 60% escolhe o corte duro, e é isto que se está fixando.
  const r = resumirFala("a".repeat(40) + " " + "b".repeat(80), 90)!;
  assert.ok(r.endsWith("…"));
  assert.equal(r.length, 91);
  assert.equal(r, "a".repeat(40) + " " + "b".repeat(49) + "…");
});

test("resumirFala — palavra única gigante corta no limite, não vira só reticência", () => {
  const r = resumirFala("x".repeat(300), 90);
  assert.equal(r, "x".repeat(90) + "…");
});

test("resumirFala — quebras de linha viram espaço (não arrebentam o card)", () => {
  assert.equal(resumirFala("oi\n\n\nboa tarde"), "oi boa tarde");
});

test("resumirFala — vazio é null, não string vazia", () => {
  assert.equal(resumirFala(""), null);
  assert.equal(resumirFala(null), null);
});

test("tempoRelativo — a escada inteira", () => {
  const agora = Date.parse("2026-08-09T12:00:00Z");
  const antes = (ms: number) => new Date(agora - ms).toISOString();
  assert.equal(tempoRelativo(antes(30_000), agora), "agora");
  assert.equal(tempoRelativo(antes(12 * 60_000), agora), "há 12 min");
  assert.equal(tempoRelativo(antes(3 * 3_600_000), agora), "há 3h");
  assert.equal(tempoRelativo(antes(26 * 3_600_000), agora), "ontem");
  assert.equal(tempoRelativo(antes(3 * 86_400_000), agora), "3 dias");
});

test("tempoRelativo — futuro não vira 'em X' (relógio adiantado)", () => {
  const agora = Date.parse("2026-08-09T12:00:00Z");
  assert.equal(tempoRelativo(new Date(agora + 5_000).toISOString(), agora), "agora");
});

test("tempoRelativo — data inválida ou ausente vira travessão", () => {
  assert.equal(tempoRelativo(null, Date.now()), "—");
  assert.equal(tempoRelativo("não é data", Date.now()), "—");
});

// --- a fila ----------------------------------------------------------------

test("esperandoHumano — cliente falou por último E ninguém respondeu", () => {
  assert.equal(esperandoHumano(conversa({ ultimoPapel: "cliente" })), true);
});

test("esperandoHumano — bot respondeu depois: não espera", () => {
  assert.equal(esperandoHumano(conversa({ ultimoPapel: "prosperito" })), false);
});

test("esperandoHumano — conversa encerrada não entra na fila", () => {
  // Arquivada de propósito. Se o cliente escrever de novo o webhook reabre, e
  // aí ela volta à fila por mérito próprio.
  assert.equal(
    esperandoHumano(conversa({ ultimoPapel: "cliente", status: "encerrado" })),
    false
  );
});

test("esperaMs — quem não espera devolve null, NUNCA zero", () => {
  // Zero iria para o topo da fila — o valor mais urgente possível para quem
  // não é urgente.
  assert.equal(esperaMs(conversa({ ultimoPapel: "prosperito" }), Date.now()), null);
});

test("ordenarSala — quem espera vem antes, mesmo sendo mais ANTIGA", () => {
  const agora = Date.parse("2026-08-09T12:00:00Z");
  const recenteRespondida = conversa({
    id: "recente",
    ultimoPapel: "prosperito",
    ultimaEm: "2026-08-09T11:59:00Z",
  });
  const antigaEsperando = conversa({
    id: "esperando",
    ultimoPapel: "cliente",
    ultimaEm: "2026-08-06T09:00:00Z",
    ultimaFalaClienteEm: "2026-08-06T09:00:00Z",
  });

  const ordem = ordenarSala([recenteRespondida, antigaEsperando], agora).map((c) => c.id);
  // Cronologia pura devolveria ["recente", "esperando"] — que é exatamente o
  // defeito que a OS descreve.
  assert.deepEqual(ordem, ["esperando", "recente"]);
});

test("ordenarSala — entre quem espera, a espera MAIOR vem primeiro", () => {
  const agora = Date.parse("2026-08-09T12:00:00Z");
  const h2 = conversa({
    id: "h2",
    ultimoPapel: "cliente",
    ultimaFalaClienteEm: "2026-08-09T10:00:00Z",
  });
  const d3 = conversa({
    id: "d3",
    ultimoPapel: "cliente",
    ultimaFalaClienteEm: "2026-08-06T12:00:00Z",
  });
  assert.deepEqual(ordenarSala([h2, d3], agora).map((c) => c.id), ["d3", "h2"]);
});

test("ordenarSala — entre quem NÃO espera, vale a atividade mais recente", () => {
  const agora = Date.parse("2026-08-09T12:00:00Z");
  const velha = conversa({ id: "velha", ultimaEm: "2026-08-01T12:00:00Z" });
  const nova = conversa({ id: "nova", ultimaEm: "2026-08-09T11:00:00Z" });
  assert.deepEqual(ordenarSala([velha, nova], agora).map((c) => c.id), ["nova", "velha"]);
});

test("ordenarSala — não muta a lista recebida", () => {
  const agora = Date.now();
  const lista = [conversa({ id: "a" }), conversa({ id: "b", ultimoPapel: "cliente" })];
  const antes = lista.map((c) => c.id);
  ordenarSala(lista, agora);
  assert.deepEqual(lista.map((c) => c.id), antes);
});

// --- números do topo -------------------------------------------------------

test("mediana — ímpar e par", () => {
  assert.equal(mediana([3, 1, 2]), 2);
  assert.equal(mediana([1, 2, 3, 4]), 2.5);
});

test("mediana — uma conversa esquecida NÃO desloca o número (o ponto de não ser média)", () => {
  const minutos = [5, 6, 7, 8, 4320]; // 4320 min = 3 dias esquecidos
  assert.equal(mediana(minutos), 7);
  const media = minutos.reduce((a, b) => a + b, 0) / minutos.length;
  assert.ok(media > 800); // a média diria que o atendimento é péssimo
});

test("mediana — vazio é null, e a tela escreve 'sem dados'", () => {
  // Zero minuto seria a leitura mais elogiosa possível de "não sei".
  assert.equal(mediana([]), null);
  assert.equal(duracaoCurta(null), "sem dados");
});

test("duracaoCurta — a escada", () => {
  assert.equal(duracaoCurta(30_000), "<1 min");
  assert.equal(duracaoCurta(12 * 60_000), "12 min");
  assert.equal(duracaoCurta(130 * 60_000), "2h 10");
  assert.equal(duracaoCurta(3 * 86_400_000), "3 dias");
});

// ===========================================================================
// CONVERSAS-03 — período e legibilidade
// ===========================================================================

// --- o fuso, que é onde estava o defeito -----------------------------------

test("offsetTzMinutos — São Paulo está a -180 do UTC fora do horário de verão", () => {
  assert.equal(offsetTzMinutos(Date.parse("2026-08-11T15:00:00Z"), TZ_CASA), -180);
});

test("offsetTzMinutos — no horário de verão de 2018 o deslocamento era OUTRO", () => {
  // 15/01/2018: o Brasil estava em horário de verão (15/10/2017 a 18/02/2018) e
  // São Paulo em UTC-2. Este teste existe para provar que a tabela de fuso é
  // consultada, e não que alguém cravou -180 no código. Se o horário de verão
  // voltar, a casa não precisa lembrar de nada.
  assert.equal(offsetTzMinutos(Date.parse("2018-01-15T12:00:00Z"), TZ_CASA), -120);
});

test("inicioDoDiaMs — às 22h de Brasília o dia AINDA é hoje (o defeito medido)", () => {
  // O CASO QUE ESTE TESTE EXISTE PARA IMPEDIR, e que estava em produção:
  // a página fazia `new Date().setHours(0,0,0,0)`, que usa o fuso do processo.
  // A Vercel roda em UTC. Às 22h de Brasília o servidor já está no dia 12, e
  // "conversas hoje" zerava três horas antes da virada — todo santo dia, na
  // faixa da noite em que o WhatsApp mais fala.
  const vinteEDuasEmBrasilia = Date.parse("2026-08-12T01:00:00Z");

  assert.equal(chaveDia("2026-08-12T01:00:00Z", TZ_CASA), "2026-08-11");
  assert.equal(
    inicioDoDiaMs(vinteEDuasEmBrasilia, TZ_CASA),
    Date.parse("2026-08-11T03:00:00Z")
  );

  // E a prova de que o defeito era real: em UTC, o mesmo instante é dia 12.
  assert.equal(new Date(vinteEDuasEmBrasilia).toISOString().slice(0, 10), "2026-08-12");
});

test("inicioDoDiaMs — a meia-noite pertence ao dia que começa, não ao que acabou", () => {
  const meiaNoite = Date.parse("2026-08-11T03:00:00Z"); // 00:00 em Brasília
  assert.equal(inicioDoDiaMs(meiaNoite, TZ_CASA), meiaNoite);
  assert.equal(chaveDia("2026-08-11T03:00:00Z", TZ_CASA), "2026-08-11");
  // Um milissegundo antes ainda é o dia anterior.
  assert.equal(chaveDia("2026-08-11T02:59:59.999Z", TZ_CASA), "2026-08-10");
});

test("chaveDia — data ausente ou ilegível é null, não a chave de hoje", () => {
  // Devolver "hoje" empurraria a conversa para um dia em que ela não
  // aconteceu, sob um cabeçalho que mente com cara de certeza.
  assert.equal(chaveDia(null, TZ_CASA), null);
  assert.equal(chaveDia("não é data", TZ_CASA), null);
});

// --- item 1: o filtro de período -------------------------------------------

test("lerPeriodo — valor bom passa; lixo e vazio caem no padrão de 7 dias", () => {
  assert.equal(lerPeriodo("hoje"), "hoje");
  assert.equal(lerPeriodo("TUDO"), "tudo");
  assert.equal(lerPeriodo("ontem "), "ontem");
  // Link velho ou erro de digitação não pode virar tela de erro.
  assert.equal(lerPeriodo("semana-passada"), PERIODO_PADRAO);
  assert.equal(lerPeriodo(null), PERIODO_PADRAO);
  assert.equal(lerPeriodo(undefined), PERIODO_PADRAO);
  assert.equal(PERIODO_PADRAO, "7d");
});

test("janelaPeriodo — 'tudo' não tem fronteira nenhuma", () => {
  const j = janelaPeriodo("tudo", Date.parse("2026-08-11T15:00:00Z"), TZ_CASA);
  assert.equal(j.desdeMs, null);
  assert.equal(j.ateMs, null);
});

test("janelaPeriodo — 'ontem' é fechado dos dois lados e não invade hoje", () => {
  const agora = Date.parse("2026-08-11T15:00:00Z"); // 12h de Brasília
  const j = janelaPeriodo("ontem", agora, TZ_CASA);
  assert.equal(j.desdeMs, Date.parse("2026-08-10T03:00:00Z"));
  assert.equal(j.ateMs, Date.parse("2026-08-11T03:00:00Z"));

  // A fronteira superior é EXCLUSIVA: a meia-noite já é hoje.
  assert.equal(dentroDoPeriodo("2026-08-11T03:00:00Z", j), false);
  assert.equal(dentroDoPeriodo("2026-08-11T02:59:59.999Z", j), true);
});

test("janelaPeriodo — '7 dias' é hoje MAIS SEIS, em dias civis", () => {
  // Não são "as últimas 168 horas". Os chips vizinhos são dias civis; uma
  // janela deslizante no meio deles faria a conversa de terça de manhã sumir
  // de "7 dias" na terça à tarde, sem nada ter acontecido.
  const agora = Date.parse("2026-08-11T15:00:00Z");
  const j = janelaPeriodo("7d", agora, TZ_CASA);
  assert.equal(j.desdeMs, Date.parse("2026-08-05T03:00:00Z"));
  assert.equal(j.ateMs, null);

  assert.equal(dentroDoPeriodo("2026-08-05T03:00:00Z", j), true);  // o 7º dia entra
  assert.equal(dentroDoPeriodo("2026-08-04T23:00:00Z", j), false); // o 8º não
});

test("janelaPeriodo — o limite de cima fica ABERTO (relógio adiantado não some)", () => {
  const agora = Date.parse("2026-08-11T15:00:00Z");
  const j = janelaPeriodo("hoje", agora, TZ_CASA);
  // Aparelho com a hora adiantada carimba mensagem no futuro. Acontece, e a
  // conversa não pode cair num limbo entre a janela e o amanhã.
  assert.equal(dentroDoPeriodo("2026-08-11T18:00:00Z", j), true);
});

test("dentroDoPeriodo — conversa SEM data fica fora de janela datada, e dentro de 'tudo'", () => {
  const agora = Date.parse("2026-08-11T15:00:00Z");
  assert.equal(dentroDoPeriodo(null, janelaPeriodo("7d", agora, TZ_CASA)), false);
  assert.equal(dentroDoPeriodo(null, janelaPeriodo("tudo", agora, TZ_CASA)), true);
  assert.equal(dentroDoPeriodo("lixo", janelaPeriodo("7d", agora, TZ_CASA)), false);
});

// --- item 2: os separadores de dia -----------------------------------------

test("rotuloDia — hoje e ontem têm nome; o resto tem dia da semana", () => {
  const agora = Date.parse("2026-08-11T15:00:00Z"); // terça, 11/08/2026
  assert.equal(rotuloDia("2026-08-11", agora, TZ_CASA), "Hoje");
  assert.equal(rotuloDia("2026-08-10", agora, TZ_CASA), "Ontem");
  assert.equal(rotuloDia("2026-08-08", agora, TZ_CASA), "Sáb 08/08");
});

test("rotuloDia — ano diferente aparece, porque em 'Tudo' a lista atravessa anos", () => {
  const agora = Date.parse("2026-08-11T15:00:00Z");
  assert.equal(rotuloDia("2025-08-08", agora, TZ_CASA), "Sex 08/08/2025");
});

test("agruparPorDia — dia mais recente primeiro, ordem preservada dentro do dia", () => {
  const agora = Date.parse("2026-08-11T15:00:00Z");
  const itens = [
    { id: "a", em: "2026-08-11T13:00:00Z" },
    { id: "b", em: "2026-08-09T13:00:00Z" },
    { id: "c", em: "2026-08-11T10:00:00Z" },
  ];
  const { grupos, semData } = agruparPorDia(itens, (i) => i.em, agora, TZ_CASA);

  assert.deepEqual(grupos.map((g) => g.chave), ["2026-08-11", "2026-08-09"]);
  assert.equal(grupos[0].rotulo, "Hoje");
  // A lista já chega ordenada pela sala; reordenar aqui desfaria a fila.
  assert.deepEqual(grupos[0].itens.map((i) => i.id), ["a", "c"]);
  assert.equal(semData.length, 0);
});

test("agruparPorDia — quem não tem data é DEVOLVIDO, nunca engolido", () => {
  // O pior defeito de tela que existe: não há erro, não há lista vazia, há uma
  // lista plausível com uma linha a menos.
  const agora = Date.parse("2026-08-11T15:00:00Z");
  const itens = [
    { id: "a", em: "2026-08-11T13:00:00Z" },
    { id: "orfa", em: null as string | null },
  ];
  const { grupos, semData } = agruparPorDia(itens, (i) => i.em, agora, TZ_CASA);
  assert.equal(grupos.length, 1);
  assert.deepEqual(semData.map((i) => i.id), ["orfa"]);
});

test("separarSala — a fila sai da linha do tempo (o desvio declarado)", () => {
  // Agrupar por dia é ordenar por dia, e isso enterraria quem espera há três
  // dias no cabeçalho da sexta-feira — desfazendo a CONVERSAS-02 em silêncio.
  const agora = Date.parse("2026-08-11T15:00:00Z");
  const esperando = conversa({
    id: "esperando",
    ultimoPapel: "cliente",
    ultimaEm: "2026-08-08T09:00:00Z",
    ultimaFalaClienteEm: "2026-08-08T09:00:00Z",
  });
  const respondida = conversa({
    id: "respondida",
    ultimoPapel: "prosperito",
    ultimaEm: "2026-08-11T14:00:00Z",
  });

  const { fila, resto } = separarSala([respondida, esperando], agora);
  assert.deepEqual(fila.map((c) => c.id), ["esperando"]);
  assert.deepEqual(resto.map((c) => c.id), ["respondida"]);
});

test("separarSala — a fila continua ordenada por espera, não por data", () => {
  const agora = Date.parse("2026-08-11T15:00:00Z");
  const h2 = conversa({
    id: "h2",
    ultimoPapel: "cliente",
    ultimaFalaClienteEm: "2026-08-11T13:00:00Z",
  });
  const d3 = conversa({
    id: "d3",
    ultimoPapel: "cliente",
    ultimaFalaClienteEm: "2026-08-08T15:00:00Z",
  });
  const { fila } = separarSala([h2, d3], agora);
  assert.deepEqual(fila.map((c) => c.id), ["d3", "h2"]);
});

// --- item 3: a pastilha nunca repete o título ------------------------------

test("identidadeCard — com nome, o contato é a linha fraca", () => {
  const r = identidadeCard(conversa({ nome: "Emerson Gomes" }));
  assert.equal(r.titulo, "Emerson Gomes");
  assert.equal(r.subtitulo, "+55 19 99756-1909");
  assert.equal(r.semNome, false);
});

test("identidadeCard — SEM nome, o telefone sobe e vira o título (sem linha dupla)", () => {
  // A tela anterior escrevia "Sem nome" como título, o telefone embaixo e AINDA
  // uma pastilha "sem nome" ao lado: três elementos para dizer duas coisas.
  const r = identidadeCard(conversa({ nome: null }));
  assert.equal(r.titulo, "+55 19 99756-1909");
  assert.equal(r.subtitulo, null);
  assert.equal(r.semNome, true);
  assert.equal(r.tituloEhContato, true);
});

test("identidadeCard — sem nome E sem contato, o título diz o fato", () => {
  const r = identidadeCard(conversa({ nome: null, telefone: null }));
  assert.equal(r.titulo, "Sem contato");
  assert.equal(r.subtitulo, null);
  assert.equal(r.tituloEhContato, false);
});

test("identidadeCard — no Instagram o título é o ID, não um telefone inventado", () => {
  const r = identidadeCard(
    conversa({ nome: null, canal: "instagram", telefone: "1310819618770667" })
  );
  assert.equal(r.titulo, "ID 1310819618770667");
  assert.ok(!r.titulo.includes("+55"));
});

// --- item 4: a prévia curta demais -----------------------------------------

test("resumirConversa — guarda a pergunta que a fala do cliente responde", () => {
  const r = resumirConversa([
    { papel: "prosperito", conteudo: "Quantas parcelas restam?", criado_em: "2026-08-11T12:00:00Z" },
    { papel: "cliente", conteudo: "2", criado_em: "2026-08-11T12:01:00Z" },
  ]);
  assert.equal(r.ultimaPerguntaBot, "Quantas parcelas restam?");
  assert.equal(r.ultimaFalaCliente, "2");
});

test("resumirConversa — fala do bot DEPOIS da resposta não vira a pergunta", () => {
  // A pergunta é a que veio ANTES. Pegar a última fala do bot faria a prévia
  // ler "Vou verificar · 2", que inverte a conversa.
  const r = resumirConversa([
    { papel: "prosperito", conteudo: "Quantas parcelas restam?", criado_em: "2026-08-11T12:00:00Z" },
    { papel: "cliente", conteudo: "2", criado_em: "2026-08-11T12:01:00Z" },
    { papel: "prosperito", conteudo: "Vou verificar.", criado_em: "2026-08-11T12:02:00Z" },
  ]);
  assert.equal(r.ultimaPerguntaBot, "Quantas parcelas restam?");
});

test("resumirConversa — 'sistema' não é pergunta (é a nota de handoff)", () => {
  // Exibi-la faria a prévia ler "Emerson assumiu · 2", que não quer dizer nada.
  const r = resumirConversa([
    { papel: "sistema", conteudo: "Conversa assumida por Emerson.", criado_em: "2026-08-11T12:00:00Z" },
    { papel: "cliente", conteudo: "2", criado_em: "2026-08-11T12:01:00Z" },
  ]);
  assert.equal(r.ultimaPerguntaBot, null);
});

test("resumirConversa — cliente que ABRE a conversa não responde pergunta nenhuma", () => {
  const r = resumirConversa([
    { papel: "cliente", conteudo: "oi", criado_em: "2026-08-11T12:00:00Z" },
  ]);
  assert.equal(r.ultimaPerguntaBot, null);
});

test("previaComContexto — resposta curta ganha a pergunta ao lado", () => {
  const p = previaComContexto("2", "Quantas parcelas restam?")!;
  assert.equal(p.resposta, "2");
  assert.equal(p.pergunta, "Quantas parcelas restam?");
});

test("previaComContexto — resposta que se explica sozinha NÃO repete a pergunta", () => {
  // Pôr a pergunta em toda prévia dobraria a lista para repetir o que o bot já
  // disse 27 vezes.
  const p = previaComContexto(
    "quero vender minha cota da Porto",
    "Como posso ajudar?"
  )!;
  assert.equal(p.pergunta, null);
  assert.equal(p.resposta, "quero vender minha cota da Porto");
});

test("previaComContexto — resposta curta SEM pergunta anterior não inventa contexto", () => {
  const p = previaComContexto("2", null)!;
  assert.equal(p.pergunta, null);
  assert.equal(p.resposta, "2");
});

test("previaComContexto — cliente que nunca falou é null, não linha vazia", () => {
  // A tela escreve "aguardando o cliente", que é outra coisa.
  assert.equal(previaComContexto(null, "Olá!"), null);
  assert.equal(previaComContexto("   ", "Olá!"), null);
});

test("previaComContexto — a pergunta é contexto, então tem teto próprio", () => {
  const p = previaComContexto("sim", "a".repeat(200))!;
  assert.equal(p.pergunta, "a".repeat(60) + "…");
  assert.equal(p.resposta, "sim");
});
