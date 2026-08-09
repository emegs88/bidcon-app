// ============================================================================
// Testes de lib/farol/dashboard.ts (PAINEL-DASHBOARD-01).
//
//   npm test        (glob — este arquivo entra sozinho, ver package.json)
//
// O QUE ESTE ARQUIVO PROTEGE. As tabelas do FAROL estão quase vazias hoje
// (medido em 09/08: farol_posts 6, farol_reels 2, farol_metricas 0). Um
// dashboard construído sobre elas passa em qualquer revisão visual, porque não
// há dado suficiente para o gráfico ficar visivelmente errado. As fixtures
// abaixo são o único lugar onde essas agregações são de fato exercitadas — e
// serão, por um bom tempo, o único lugar onde um erro de contagem aparece.
//
// A ÊNFASE ESTÁ NA HONESTIDADE, não na aritmética. Somar números é fácil e
// quase nunca quebra; o que quebra em silêncio é a fronteira entre "medimos e
// deu zero" e "não há de onde medir". Vários testes aqui existem só para travar
// que uma medida SEM FONTE nunca vira o número 0 — porque zero desenha uma
// barra, e uma barra é uma afirmação.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  espinhaDeDias,
  serieProducao,
  placarProducao,
  diasConsecutivosSemFalha,
  mediana,
  porPlataforma,
  ehPublicacao,
  ehFalha,
  ehSemInsumo,
  funil,
  serieCanais,
  rankingFormulas,
  alertaRotacao,
  colunasPersona,
  custoDeTokens,
  serieCusto,
  placarCusto,
  precisaMostrarN,
  LIMITE_N_VISIVEL,
  N_MINIMO_ROTACAO,
  USD_POR_MTOK_IN,
  USD_POR_MTOK_OUT,
  type LinhaWaConversa,
  type LinhaWaMensagem,
  type LinhaMetrica,
} from "./dashboard";
import type { LinhaPost, LinhaReel } from "./painel";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Âncora fixa para todo teste de janela. 08/08/2026 às 11h de São Paulo é
 * 14:00Z — é a MESMA prova que o Emerson mediu na tela na OS do fuso, reusada
 * aqui de propósito: se alguém trocar a régua de data por `slice(0,10)`, estes
 * testes caem junto com os de lib/data-br.
 */
const AGORA = Date.parse("2026-08-08T14:00:00Z");
const DIA = 24 * 60 * 60 * 1000;

function post(acao: string, criado_em: string): LinhaPost {
  return { id: acao + criado_em, acao, carta_id: null, post_id: null, detalhe: null, criado_em };
}

function reel(p: Partial<LinhaReel> & { criado_em: string }): LinhaReel {
  return {
    id: p.criado_em + (p.status ?? ""),
    carta_id: null,
    video_id: "v",
    container_id: null,
    post_id: null,
    status: p.status ?? "publicado",
    roteiro: null,
    legenda: null,
    erro: null,
    detalhe: p.detalhe ?? null,
    criado_em: p.criado_em,
    atualizado_em: p.atualizado_em ?? null,
  };
}

// ---------------------------------------------------------------------------
// Espinha de dias
// ---------------------------------------------------------------------------

test("espinhaDeDias: devolve TODOS os dias, do mais antigo ao mais novo", () => {
  const e = espinhaDeDias(5, AGORA);
  assert.equal(e.length, 5);
  assert.deepEqual(e, ["2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08"]);
});

test("espinhaDeDias: a espinha é a data civil de SP, nao a de UTC", () => {
  // 01:00Z de 09/08 é 22h de 08/08 em São Paulo. O último dia da janela tem
  // que ser 08, não 09 — é o defeito do `slice(0,10)` que derrubou a coluna
  // Dia do painel e a janela de lerPautas().
  const e = espinhaDeDias(2, Date.parse("2026-08-09T01:00:00Z"));
  assert.deepEqual(e, ["2026-08-07", "2026-08-08"]);
});

// ---------------------------------------------------------------------------
// Vocabulário de acao
// ---------------------------------------------------------------------------

test("classificacao de acao: por SUFIXO, para plataforma nova entrar sozinha", () => {
  assert.equal(ehPublicacao("post_publicado"), true);
  assert.equal(ehPublicacao("reel_youtube_publicado"), true);
  assert.equal(ehPublicacao("reel_kwai_publicado"), true, "plataforma que ainda não existe");
  assert.equal(ehPublicacao("reel_falhou"), false);

  assert.equal(ehFalha("reel_tiktok_falhou"), true);
  assert.equal(ehFalha("post_publicado"), false);
});

test("sem_carta NAO e falha: estoque vazio nao e defeito da maquina", () => {
  assert.equal(ehSemInsumo("sem_carta"), true);
  assert.equal(ehSemInsumo("reel_sem_carta"), true);
  assert.equal(ehFalha("sem_carta"), false, "senão a taxa de sucesso desaba por motivo comercial");
});

// ---------------------------------------------------------------------------
// Seção 1 — Produção
// ---------------------------------------------------------------------------

test("serieProducao: dia sem linha nenhuma APARECE, com zero", () => {
  const s = serieProducao([post("post_publicado", "2026-08-08T13:00:00Z")], [], 3, AGORA);
  assert.equal(s.length, 3, "os dias vazios são o dado mais importante da esteira");
  assert.deepEqual(
    s.map((d) => d.dia),
    ["2026-08-06", "2026-08-07", "2026-08-08"]
  );
  assert.equal(s[0].postsPublicados, 0);
  assert.equal(s[2].postsPublicados, 1);
});

test("serieProducao: reel publicado conta UMA vez, pela tabela de reels", () => {
  // O dia normal tem as DUAS linhas: farol_posts registra o evento e
  // farol_reels é dona do estado. Contar pelos dois duplicaria a peça.
  const posts = [post("reel_publicado", "2026-08-08T13:00:00Z")];
  const reels = [reel({ criado_em: "2026-08-08T13:00:00Z", status: "publicado" })];
  const s = serieProducao(posts, reels, 1, AGORA);
  assert.equal(s[0].reelsPublicados, 1);
  assert.equal(s[0].postsPublicados, 0, "reel_publicado não pode entrar como post de feed");
});

test("serieProducao: separa falha de sem-insumo na mesma barra", () => {
  const posts = [
    post("post_falhou", "2026-08-08T13:00:00Z"),
    post("sem_carta", "2026-08-08T13:30:00Z"),
  ];
  const s = serieProducao(posts, [], 1, AGORA);
  assert.equal(s[0].falhas, 1);
  assert.equal(s[0].semInsumo, 1);
});

test("serieProducao: linha fora da janela e ignorada, nao empilhada na borda", () => {
  const s = serieProducao([post("post_publicado", "2026-07-01T13:00:00Z")], [], 3, AGORA);
  assert.equal(
    s.reduce((a, d) => a + d.postsPublicados, 0),
    0
  );
});

test("mediana: com n par, media dos dois do meio; vazio devolve null", () => {
  assert.equal(mediana([]), null);
  assert.equal(mediana([5]), 5);
  assert.equal(mediana([1, 2, 3, 4]), 2.5);
  assert.equal(mediana([10, 1, 5]), 5, "ordena antes");
});

test("mediana resiste ao outlier que a media nao resiste", () => {
  // A flag aberta de latência mediu uma render de 6h40. Com n de um dígito, ela
  // sozinha define a média — e a tela passaria a anunciar um tempo que nunca
  // aconteceu como se fosse o típico.
  const v = [5, 6, 7, 400];
  assert.equal(mediana(v), 6.5);
  const media = v.reduce((a, b) => a + b, 0) / v.length;
  assert.ok(media > 100, `media contaminada: ${media}`);
});

test("diasConsecutivosSemFalha: dia vazio nao premia a maquina desligada", () => {
  const serie = [
    { dia: "d1", postsPublicados: 1, reelsPublicados: 0, falhas: 0, semInsumo: 0 },
    { dia: "d2", postsPublicados: 0, reelsPublicados: 0, falhas: 0, semInsumo: 0 },
    { dia: "d3", postsPublicados: 1, reelsPublicados: 0, falhas: 0, semInsumo: 0 },
  ];
  assert.equal(diasConsecutivosSemFalha(serie), 2, "d2 não conta, mas também não quebra");
});

test("diasConsecutivosSemFalha: a falha mais recente zera a contagem", () => {
  const serie = [
    { dia: "d1", postsPublicados: 1, reelsPublicados: 0, falhas: 0, semInsumo: 0 },
    { dia: "d2", postsPublicados: 1, reelsPublicados: 0, falhas: 1, semInsumo: 0 },
  ];
  assert.equal(diasConsecutivosSemFalha(serie), 0);
});

test("placarProducao: sem tentativa nenhuma, taxa e SEM_FONTE — nunca 0%", () => {
  const s = serieProducao([], [], 5, AGORA);
  const p = placarProducao(s, [], AGORA);
  assert.equal(p.taxaSucesso.estado, "sem_fonte", "0% desenharia uma barra e afirmaria um fracasso");
  assert.equal(p.medianaRenderMs.estado, "sem_fonte");
  if (p.taxaSucesso.estado === "sem_fonte") {
    assert.ok(p.taxaSucesso.porque.length > 0);
    assert.ok(p.taxaSucesso.destrava.length > 0, "a OS exige dizer o que destrava");
  }
});

test("placarProducao: taxa de sucesso ignora sem-insumo no denominador", () => {
  const posts = [
    post("post_publicado", "2026-08-08T13:00:00Z"),
    post("post_falhou", "2026-08-07T13:00:00Z"),
    post("sem_carta", "2026-08-06T13:00:00Z"),
  ];
  const s = serieProducao(posts, [], 5, AGORA);
  const p = placarProducao(s, [], AGORA);
  assert.equal(p.taxaSucesso.estado, "medido");
  if (p.taxaSucesso.estado === "medido") {
    assert.equal(p.taxaSucesso.valor, 0.5, "1 publicada / 2 tentadas — sem_carta fora");
    assert.equal(p.taxaSucesso.n, 2);
  }
});

test("placarProducao: mediana render->publicacao sai de criado_em -> atualizado_em", () => {
  const reels = [
    reel({
      criado_em: "2026-08-08T12:00:00Z",
      atualizado_em: "2026-08-08T12:10:00Z",
      status: "publicado",
    }),
    reel({
      criado_em: "2026-08-07T12:00:00Z",
      atualizado_em: "2026-08-07T12:30:00Z",
      status: "publicado",
    }),
  ];
  const s = serieProducao([], reels, 5, AGORA);
  const p = placarProducao(s, reels, AGORA);
  assert.equal(p.medianaRenderMs.estado, "medido");
  if (p.medianaRenderMs.estado === "medido") {
    assert.equal(p.medianaRenderMs.valor, 20 * 60 * 1000, "media dos dois do meio: 10min e 30min");
  }
});

test("placarProducao: reel ainda renderizando nao entra na mediana", () => {
  const reels = [reel({ criado_em: "2026-08-08T12:00:00Z", status: "renderizando" })];
  const p = placarProducao(serieProducao([], reels, 5, AGORA), reels, AGORA);
  assert.equal(p.medianaRenderMs.estado, "sem_fonte", "sem publicação não há tempo até a publicação");
});

test("porPlataforma: mostra o multiplicador — mesmo mp4 em tres lugares", () => {
  const posts = [
    post("post_publicado", "2026-08-08T13:00:00Z"),
    post("reel_publicado", "2026-08-08T13:01:00Z"),
    post("reel_youtube_publicado", "2026-08-08T13:02:00Z"),
    post("reel_tiktok_publicado", "2026-08-08T13:03:00Z"),
    post("reel_falhou", "2026-08-08T13:04:00Z"),
  ];
  const m = porPlataforma(posts, 3, AGORA);
  assert.equal(m.estado, "medido");
  if (m.estado === "medido") {
    assert.equal(m.n, 4, "a falha não é plataforma");
    const rotulos = m.valor.map((x) => x.plataforma).sort();
    assert.deepEqual(rotulos, ["Instagram · feed", "Instagram · reels", "TikTok", "YouTube Short"]);
  }
});

test("porPlataforma: sem publicacao, SEM_FONTE que aponta as flags", () => {
  const m = porPlataforma([], 3, AGORA);
  assert.equal(m.estado, "sem_fonte");
  if (m.estado === "sem_fonte") {
    assert.match(m.destrava, /FAROL_YOUTUBE|TikTok/);
  }
});

// ---------------------------------------------------------------------------
// Seção 2 — Funil
// ---------------------------------------------------------------------------

/**
 * `tags` OMITIDO por padrão de propósito: é exatamente o formato que
 * `lerConversas` devolve quando a migração 0075 ainda não foi aplicada e a
 * leitura caiu no plano B. Passar `[]` é outra coisa — é a coluna existindo e
 * vindo vazia — e os dois casos têm respostas diferentes no funil.
 */
function conversa(
  id: string,
  canal: string | null,
  criado_em: string,
  tags?: string[]
): LinhaWaConversa {
  return tags === undefined ? { id, canal, criado_em } : { id, canal, criado_em, tags };
}

function msg(p: Partial<LinhaWaMensagem> & { criado_em: string }): LinhaWaMensagem {
  return {
    conversa_id: p.conversa_id ?? null,
    papel: p.papel ?? "prosperito",
    agente: p.agente ?? null,
    status_envio: p.status_envio ?? null,
    criado_em: p.criado_em,
    tokens_in: p.tokens_in ?? null,
    tokens_out: p.tokens_out ?? null,
  };
}

test("funil: as quatro etapas medidas, com conversao encadeada", () => {
  const conversas = [
    conversa("c1", "instagram", "2026-08-08T13:00:00Z"),
    conversa("c2", "whatsapp", "2026-08-08T13:00:00Z"),
  ];
  const mensagens = [
    msg({ agente: "farol-comenta", status_envio: "enviado", criado_em: "2026-08-08T12:00:00Z" }),
    msg({ agente: "farol-comenta", status_envio: "falha", criado_em: "2026-08-08T12:01:00Z" }),
    msg({ conversa_id: "c1", papel: "cliente", criado_em: "2026-08-08T13:05:00Z" }),
  ];
  const f = funil(conversas, mensagens);

  assert.equal(f[0].rotulo, "comentários tratados");
  assert.equal(f[0].medida.estado === "medido" && f[0].medida.valor, 2);
  assert.equal(f[0].conversao, null, "a primeira etapa não tem anterior");

  assert.equal(f[1].medida.estado === "medido" && f[1].medida.valor, 1, "falha não é entrega");
  assert.equal(f[1].conversao, 0.5);

  assert.equal(f[2].medida.estado === "medido" && f[2].medida.valor, 2);
  assert.equal(f[3].medida.estado === "medido" && f[3].medida.valor, 1, "só c1 teve resposta");
  assert.equal(f[3].conversao, 0.5);
});

test("funil: `status_envio` 'enviando' NAO conta como entregue", () => {
  // 'enviando' é a linha gravada ANTES da chamada à Meta — é a trava de dedupe
  // do webhook, não uma entrega. Contá-la infla a etapa mais importante do funil.
  const mensagens = [
    msg({ agente: "farol-comenta", status_envio: "enviando", criado_em: "2026-08-08T12:00:00Z" }),
  ];
  const f = funil([], mensagens);
  assert.equal(f[1].medida.estado === "medido" && f[1].medida.valor, 0);
});

// --- A quinta etapa: 'marcadas cedente' e seus três estados ----------------
// Ela existe na tela em TODOS eles. Omitir a etapa quando não há dado faria a
// pergunta sumir junto com a resposta, e ninguém sente falta do que não vê.

const cedenteDe = (f: ReturnType<typeof funil>) => f[f.length - 1];

test("cedente: sem a coluna `tags` no banco, e SEM_FONTE apontando a migracao", () => {
  // `conversa()` sem o 4º argumento = exatamente o que `lerConversas` devolve
  // quando o plano B roda porque wa_conversas.tags não existe.
  const f = funil([conversa("c1", "whatsapp", "2026-08-09T13:00:00Z")], []);
  const u = cedenteDe(f);
  assert.equal(u.rotulo, "marcadas cedente");
  assert.equal(u.medida.estado, "sem_fonte");
  assert.equal(u.conversao, null, "sem número não há conversão a calcular");
  if (u.medida.estado === "sem_fonte") {
    assert.match(u.medida.destrava, /0075/, "o texto tem que dizer O QUE destrava");
  }
});

test("cedente: coluna existe mas a janela e toda anterior ao detector — SEM_FONTE, nunca 0", () => {
  // Este é o estado que dá vontade de mostrar "0" e é o mais perigoso de todos:
  // `tags = {}` numa conversa de julho não quer dizer "não é cedente", quer
  // dizer "nunca foi examinada". Um 0 aqui seria uma afirmação sobre pessoas
  // que o detector nunca leu.
  const f = funil(
    [
      conversa("c1", "whatsapp", "2026-08-07T13:00:00Z", []),
      conversa("c2", "whatsapp", "2026-08-08T13:00:00Z", []),
    ],
    []
  );
  const u = cedenteDe(f);
  assert.equal(u.medida.estado, "sem_fonte");
  if (u.medida.estado === "sem_fonte") {
    assert.match(u.medida.porque, /detector não implantado/);
  }
});

test("cedente: com conversa pos-detector vira MEDIDO, e o `n` conta so as examinaveis", () => {
  const f = funil(
    [
      // Pré-detector: nunca examinadas. Não entram nem no numerador nem no
      // denominador. Se entrassem no denominador, o painel diria "1 de 4"
      // quando a verdade medida é "1 de 2".
      conversa("c1", "whatsapp", "2026-08-07T13:00:00Z", []),
      conversa("c2", "whatsapp", "2026-08-08T13:00:00Z", []),
      // Pós-detector: examinadas.
      conversa("c3", "whatsapp", "2026-08-09T13:00:00Z", ["cedente"]),
      conversa("c4", "whatsapp", "2026-08-09T14:00:00Z", []),
    ],
    []
  );
  const u = cedenteDe(f);
  assert.equal(u.medida.estado, "medido");
  if (u.medida.estado === "medido") {
    assert.equal(u.medida.valor, 1);
    assert.equal(u.medida.n, 2, "o denominador é só quem nasceu com o detector de pé");
  }
});

test("cedente: NUNCA mostra taxa de conversao, mesmo virando numero", () => {
  // A etapa anterior conta a janela inteira e esta conta só o pedaço pós-
  // detector. A razão entre as duas despencaria no primeiro mês e subiria
  // sozinha depois, sem nada ter mudado no atendimento.
  const f = funil(
    [
      conversa("c1", "whatsapp", "2026-08-09T13:00:00Z", ["cedente"]),
      conversa("c2", "whatsapp", "2026-08-09T14:00:00Z", ["cedente"]),
    ],
    [msg({ conversa_id: "c1", papel: "cliente", criado_em: "2026-08-09T13:05:00Z" })]
  );
  const u = cedenteDe(f);
  assert.equal(u.medida.estado === "medido" && u.medida.valor, 2);
  assert.equal(u.conversao, null, "número absoluto é honesto; a razão não seria");
});

test("cedente: outra etiqueta na mesma conversa nao a torna cedente", () => {
  // `tags` é um array justamente para caber a próxima etiqueta sem migração
  // nova. No dia em que existir 'contemplado', esta etapa não pode passar a
  // contar todo mundo.
  const f = funil([conversa("c1", "whatsapp", "2026-08-09T13:00:00Z", ["contemplado"])], []);
  const u = cedenteDe(f);
  assert.equal(u.medida.estado === "medido" && u.medida.valor, 0);
  assert.equal(u.medida.estado === "medido" && u.medida.n, 1, "examinada e não bateu é 0 de 1");
});

test("funil: conversa com DUAS mensagens do cliente conta UMA vez", () => {
  const conversas = [conversa("c1", "whatsapp", "2026-08-08T13:00:00Z")];
  const mensagens = [
    msg({ conversa_id: "c1", papel: "cliente", criado_em: "2026-08-08T13:05:00Z" }),
    msg({ conversa_id: "c1", papel: "cliente", criado_em: "2026-08-08T13:06:00Z" }),
  ];
  const f = funil(conversas, mensagens);
  assert.equal(f[3].medida.estado === "medido" && f[3].medida.valor, 1);
});

test("serieCanais: separa instagram de whatsapp e preenche dia vazio", () => {
  const conversas = [
    conversa("c1", "instagram", "2026-08-08T13:00:00Z"),
    conversa("c2", "whatsapp", "2026-08-08T13:00:00Z"),
    conversa("c3", "whatsapp", "2026-08-06T13:00:00Z"),
    conversa("c4", null, "2026-08-06T13:00:00Z"),
  ];
  const s = serieCanais(conversas, 3, AGORA);
  assert.deepEqual(s.map((d) => d.dia), ["2026-08-06", "2026-08-07", "2026-08-08"]);
  assert.deepEqual(s[0], { dia: "2026-08-06", instagram: 0, whatsapp: 1, outro: 1 });
  assert.deepEqual(s[1], { dia: "2026-08-07", instagram: 0, whatsapp: 0, outro: 0 });
  assert.deepEqual(s[2], { dia: "2026-08-08", instagram: 1, whatsapp: 1, outro: 0 });
});

// ---------------------------------------------------------------------------
// Seção 3 — Fôrmas e personas
// ---------------------------------------------------------------------------

function metrica(p: Partial<LinhaMetrica>): LinhaMetrica {
  return {
    peca_id: p.peca_id ?? null,
    formula: p.formula ?? null,
    persona: p.persona ?? null,
    retencao: p.retencao ?? null,
    pct_nao_seguidores: p.pct_nao_seguidores ?? null,
    indice: p.indice ?? null,
  };
}

test("rankingFormulas: conta uso mesmo com farol_metricas vazia", () => {
  // É literalmente o que a OS pede: "enquanto farol_metricas estiver vazia,
  // mostrar só a contagem de uso e o aviso".
  const reels = [
    reel({ criado_em: "2026-08-08T12:00:00Z", detalhe: { formula: "P1" } as never }),
    reel({ criado_em: "2026-08-07T12:00:00Z", detalhe: { formula: "P1" } as never }),
    reel({ criado_em: "2026-08-06T12:00:00Z", detalhe: { formula: "P3" } as never }),
  ];
  const r = rankingFormulas(reels, []);
  assert.equal(r.length, 2);
  const p1 = r.find((x) => x.formula === "P1");
  assert.equal(p1?.pecas, 2);
  assert.equal(p1?.indice.estado, "sem_fonte", "sem métrica o índice não pode virar 0");
  if (p1?.indice.estado === "sem_fonte") {
    assert.match(p1.indice.destrava, /METRICAS-01/);
  }
});

test("rankingFormulas: reel SEM a chave formula nao inventa forma", () => {
  // Os 2 reels que existem hoje não têm `detalhe.formula` — nasceram antes da
  // FAROL-FORMULAS-02. Agrupá-los sob "desconhecida" criaria uma nona fôrma.
  const reels = [reel({ criado_em: "2026-08-08T12:00:00Z", detalhe: { tipo: "imovel" } as never })];
  assert.deepEqual(rankingFormulas(reels, []), []);
});

test("rankingFormulas: com indice medido, ordena do maior para o menor", () => {
  const reels = [
    reel({ criado_em: "2026-08-08T12:00:00Z", detalhe: { formula: "P1" } as never }),
    reel({ criado_em: "2026-08-07T12:00:00Z", detalhe: { formula: "P2" } as never }),
  ];
  const metricas = [
    metrica({ formula: "P1", indice: 0.2, retencao: 0.3 }),
    metrica({ formula: "P2", indice: 0.9, retencao: 0.7 }),
  ];
  const r = rankingFormulas(reels, metricas);
  assert.equal(r[0].formula, "P2", "ordenado por índice");
  assert.equal(r[0].retencao.estado === "medido" && r[0].retencao.valor, 0.7);
});

test("alertaRotacao: sem indice medido NAO acusa ninguem", () => {
  const reels = Array.from({ length: 5 }, (_, i) =>
    reel({ criado_em: `2026-08-0${i + 1}T12:00:00Z`, detalhe: { formula: "P1" } as never })
  );
  const a = alertaRotacao(rankingFormulas(reels, []));
  assert.equal(a.estado, "sem_fonte", "condenar uma fôrma sem métrica é decidir no escuro");
});

test("alertaRotacao: respeita o piso de n para nao condenar por uma peca azarada", () => {
  const reels = [
    reel({ criado_em: "2026-08-08T12:00:00Z", detalhe: { formula: "P1" } as never }),
    reel({ criado_em: "2026-08-07T12:00:00Z", detalhe: { formula: "P1" } as never }),
    reel({ criado_em: "2026-08-06T12:00:00Z", detalhe: { formula: "P1" } as never }),
    reel({ criado_em: "2026-08-05T12:00:00Z", detalhe: { formula: "P2" } as never }),
  ];
  const metricas = [
    metrica({ formula: "P1", indice: 0.5 }),
    metrica({ formula: "P2", indice: 0.01 }),
  ];
  const a = alertaRotacao(rankingFormulas(reels, metricas));
  assert.equal(a.estado, "medido");
  if (a.estado === "medido") {
    assert.equal(a.valor.length, 1, "P2 tem o pior índice mas só 1 peça");
    assert.equal(a.valor[0].formula, "P1");
  }
  assert.equal(N_MINIMO_ROTACAO, 3);
});

test("colunasPersona: avatar_tipo NAO e persona", () => {
  // Falso amigo medido: o único valor de detalhe.avatar_tipo é "photo_avatar",
  // que é tipo de avatar da HeyGen. Usá-lo como eixo criaria uma persona
  // chamada "photo_avatar" na tela.
  const reels = [
    reel({ criado_em: "2026-08-08T12:00:00Z", detalhe: { avatar_tipo: "photo_avatar" } as never }),
  ];
  const c = colunasPersona(reels, []);
  assert.equal(c.estado, "sem_fonte");
  if (c.estado === "sem_fonte") assert.match(c.destrava, /FAROL_DUPLA/);
});

test("colunasPersona: com persona gravada, separa as duas colunas", () => {
  const reels = [
    reel({ criado_em: "2026-08-08T12:00:00Z", detalhe: { persona: "porta-voz" } as never }),
    reel({ criado_em: "2026-08-07T12:00:00Z", detalhe: { persona: "valentina" } as never }),
    reel({ criado_em: "2026-08-06T12:00:00Z", detalhe: { persona: "valentina" } as never }),
  ];
  const c = colunasPersona(reels, [metrica({ persona: "valentina", indice: 0.8 })]);
  assert.equal(c.estado, "medido");
  if (c.estado === "medido") {
    const val = c.valor.find((x) => x.persona === "valentina");
    assert.equal(val?.pecas, 2);
    assert.equal(val?.indice.estado === "medido" && val.indice.valor, 0.8);
    const pv = c.valor.find((x) => x.persona === "porta-voz");
    assert.equal(pv?.indice.estado, "sem_fonte");
  }
});

// ---------------------------------------------------------------------------
// Seção 4 — Custo
// ---------------------------------------------------------------------------

test("custoDeTokens: a tabela declarada, conferida na mao", () => {
  assert.equal(USD_POR_MTOK_IN, 0.15);
  assert.equal(USD_POR_MTOK_OUT, 0.6);
  // 1M in + 1M out = 0,15 + 0,60
  assert.equal(custoDeTokens(1_000_000, 1_000_000).toFixed(4), "0.7500");
  assert.equal(custoDeTokens(0, 0), 0);
});

test("custoDeTokens: os numeros REAIS medidos no xtv em 09/08", () => {
  // 1.015.810 in / 35.300 out — 102 mensagens, 16/07 a 08/08.
  const usd = custoDeTokens(1_015_810, 35_300);
  assert.equal(usd.toFixed(4), "0.1736", "menos de vinte centavos de dólar no período");
});

test("serieCusto: mensagem sem token nao entra e nao vira zero mentiroso", () => {
  const mensagens = [
    msg({ criado_em: "2026-08-08T13:00:00Z", tokens_in: 1_000_000, tokens_out: 0 }),
    msg({ criado_em: "2026-08-08T13:05:00Z" }),
  ];
  const s = serieCusto(mensagens, 2, AGORA);
  assert.equal(s.length, 2);
  assert.equal(s[1].tokensIn, 1_000_000);
  assert.equal(s[1].usd.toFixed(4), "0.1500");
  assert.equal(s[0].usd, 0, "dia sem mensagem é zero medido, e a barra some sozinha");
});

test("placarCusto: sem duracao gravada, render e SEM_FONTE — nunca US$ 0,00", () => {
  // Peça anterior a 09/08 não tem `duracao_s` e nunca terá: a duração era
  // descartada na leitura. Multiplicar por zero segundos daria US$ 0,00, que
  // é um número falso com cara de render de graça.
  const s = serieCusto([msg({ criado_em: "2026-08-08T13:00:00Z", tokens_in: 1000, tokens_out: 100 })], 3, AGORA);
  const p = placarCusto(s, 2, 5, [reel({ criado_em: "2026-08-08T13:00:00Z" })]);
  assert.equal(p.custoRender.estado, "sem_fonte");
  if (p.custoRender.estado === "sem_fonte") {
    assert.match(p.custoRender.destrava, /duracao_s|duration/);
  }
});

test("placarCusto: com duracao gravada, render vira US$ medido (segundos x 0,05)", () => {
  const s = serieCusto([msg({ criado_em: "2026-08-08T13:00:00Z", tokens_in: 1000, tokens_out: 100 })], 3, AGORA);
  const p = placarCusto(s, 2, 5, [
    reel({ criado_em: "2026-08-08T13:00:00Z", detalhe: { duracao_s: 30 } }),
    reel({ criado_em: "2026-08-07T13:00:00Z", detalhe: { duracao_s: 42 } }),
    // Peça velha, sem duração: NÃO entra como zero. Se entrasse, o n diria "3"
    // e o custo médio por peça cairia um terço sem nada ter barateado.
    reel({ criado_em: "2026-08-06T13:00:00Z" }),
  ]);
  assert.equal(p.custoRender.estado, "medido");
  if (p.custoRender.estado === "medido") {
    assert.equal(p.custoRender.valor.toFixed(2), "3.60", "(30+42)s × US$0,05");
    assert.equal(p.custoRender.n, 2, "o n conta só as peças COM duração medida");
  }
});

test("placarCusto: duracao zero ou negativa nao e medicao", () => {
  const s = serieCusto([msg({ criado_em: "2026-08-08T13:00:00Z", tokens_in: 1000, tokens_out: 100 })], 3, AGORA);
  const p = placarCusto(s, 2, 5, [
    reel({ criado_em: "2026-08-08T13:00:00Z", detalhe: { duracao_s: 0 } }),
    reel({ criado_em: "2026-08-07T13:00:00Z", detalhe: { duracao_s: -5 } }),
  ]);
  assert.equal(p.custoRender.estado, "sem_fonte", "zero segundo é campo em branco com roupa de número");
});

test("placarCusto: custo por lead so existe com as DUAS pontas", () => {
  const s = serieCusto([msg({ criado_em: "2026-08-08T13:00:00Z", tokens_in: 1_000_000, tokens_out: 0 })], 3, AGORA);

  const semLead = placarCusto(s, 2, 0);
  assert.equal(semLead.porLead.estado, "sem_fonte", "dividir por zero conversa não é 'custo infinito', é ausência");

  const comLead = placarCusto(s, 2, 4);
  assert.equal(comLead.porLead.estado, "medido");
  if (comLead.porLead.estado === "medido") {
    assert.equal(comLead.porLead.valor.toFixed(4), "0.0375", "0,15 / 4");
    assert.equal(comLead.porLead.n, 4);
  }
});

test("placarCusto: sem token nenhum, total e SEM_FONTE — nao US$ 0,00", () => {
  const s = serieCusto([], 3, AGORA);
  const p = placarCusto(s, 0, 0);
  assert.equal(p.totalUsd.estado, "sem_fonte");
  assert.equal(p.porPeca.estado, "sem_fonte");
});

// ---------------------------------------------------------------------------
// A regra do n
// ---------------------------------------------------------------------------

test("precisaMostrarN: a regra da OS, na fronteira exata", () => {
  assert.equal(LIMITE_N_VISIVEL, 10);
  assert.equal(precisaMostrarN(0), true);
  assert.equal(precisaMostrarN(9), true);
  assert.equal(precisaMostrarN(10), false, "n < 10, não <=");
  assert.equal(precisaMostrarN(11), false);
});

test("com os numeros de hoje, quase TUDO cai na regra do n", () => {
  // farol_posts 6, farol_reels 2, wa_conversas 25. Este teste existe para que
  // a régua não seja afrouxada sem alguém perceber que ela é o que impede a
  // tela de anunciar "100% de sucesso" a partir de três linhas.
  assert.equal(precisaMostrarN(6), true);
  assert.equal(precisaMostrarN(2), true);
  assert.equal(precisaMostrarN(25), false);
});
