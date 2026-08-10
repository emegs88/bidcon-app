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
