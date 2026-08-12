// ============================================================================
// container.test.ts — a regra de DESISTIR, sob teste (FASE2-B/C)
// ----------------------------------------------------------------------------
// Rodar:
//   npm test        (glob — este arquivo entra sozinho, ver package.json)
//
// O QUE ESTE ARQUIVO PROTEGE, dito sem rodeio: `decidirDerrota` é a única
// função da casa que JOGA UM VÍDEO FORA. Ela decide parar de esperar por um
// container da Meta e marcar a linha como falha. Errar para o lado frouxo custa
// um reel que ia publicar; errar para o lado duro devolve o que temos hoje —
// 24h segurando uma linha morta. Um limiar assim não pode ser afrouxado por
// alguém que só mexeu num número: tem que passar por um teste que diz em voz
// alta o que está sendo afrouxado.
//
// Os três "NUNCA" abaixo (terminal, ilegível, dentro do prazo) não são zelo
// decorativo: cada um é um caminho pelo qual a derrota poderia disparar contra
// um container saudável.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import {
  CAMPOS_CONTAINER,
  CODES_EM_CURSO,
  CODES_TERMINAIS,
  DERROTA_MS,
  ESCADA_CAMPOS,
  POLL_MAX_MS,
  POLL_PASSO_MS,
  TETO_RECRIACOES,
  ancoraContainer,
  caminhoRetry,
  contarRecriacoes,
  decidirDerrota,
  decidirRecriacao,
  degrauAbaixo,
  idadeContainerMs,
  motivoDerrota,
  resumoContainer,
} from "./container";

// ---------------------------------------------------------------------------
// B · o campo que estava fechado por escolha nossa
// ---------------------------------------------------------------------------

test("B: copyright_check_status entra no fields — e é o topo da escada", () => {
  // A OS é literal: "Pedir o campo no fields
  // (id,status,status_code,copyright_check_status)".
  assert.equal(CAMPOS_CONTAINER, "id,status,status_code,copyright_check_status");
  assert.equal(ESCADA_CAMPOS[0], CAMPOS_CONTAINER);
});

test("B: os quatro literais saem da resposta crua, na mesma ordem de importancia", () => {
  const r = resumoContainer({
    id: "17878490436684841",
    status: "In Progress",
    status_code: "IN_PROGRESS",
    copyright_check_status: { status: "in_progress", matches_found: false },
  });
  assert.equal(r.id, "17878490436684841");
  assert.equal(r.status, "In Progress");
  assert.equal(r.status_code, "IN_PROGRESS");
  // Objeto NÃO é descartado: o item B existe justamente para parar de escolher
  // por conta própria o que da resposta merece ser visto.
  assert.equal(r.copyright_check_status, '{"status":"in_progress","matches_found":false}');
});

test("B: campo AUSENTE vira null, e null e informacao — nao e vazio", () => {
  // "a Meta não devolveu o campo" é diagnóstico diferente de "devolveu vazio".
  // Confundir os dois é como o `copyright_check_status` ficou três dias
  // invisível sem ninguém notar que ele nunca tinha sido pedido.
  const r = resumoContainer({ status_code: "IN_PROGRESS" });
  assert.equal(r.copyright_check_status, null);
  assert.equal(r.status, null);
  assert.equal(r.id, null);
  assert.equal(r.status_code, "IN_PROGRESS");
});

test("B: resposta nula ou lixo nao explode — quatro nulls", () => {
  for (const bruto of [null, undefined, 0, "erro", []]) {
    const r = resumoContainer(bruto);
    assert.equal(r.id, null, `id de ${JSON.stringify(bruto)}`);
    assert.equal(r.status_code, null);
    assert.equal(r.copyright_check_status, null);
  }
});

// ---------------------------------------------------------------------------
// B · a escada de degradação — o defeito que ela conserta
// ---------------------------------------------------------------------------

test("escada desce UM degrau: pedir campo novo nao pode custar o campo verboso", () => {
  // O defeito anterior: a rede de segurança caía direto para "status_code".
  // Se a Meta recusasse o campo novo, perderíamos junto o `status` verboso — a
  // FRASE da reclamação —, que não tem culpa nenhuma e é o que diagnostica.
  assert.equal(degrauAbaixo("id,status,status_code,copyright_check_status"), "id,status,status_code");
  assert.equal(degrauAbaixo("id,status,status_code"), "status_code");
});

test("escada tem chao: no ultimo degrau a resposta e null, nao um laco", () => {
  assert.equal(degrauAbaixo("status_code"), null);
});

test("escada e total: conjunto desconhecido cai no piso, nunca em null direto", () => {
  // Ficar cego ao container é pior do que ficar sem a frase da Meta.
  assert.equal(degrauAbaixo("id"), "status_code");
});

// ---------------------------------------------------------------------------
// C · o envelope da Meta, em números
// ---------------------------------------------------------------------------

test("C: cadencia e de UMA consulta por minuto — nao de 5 em 5 segundos", () => {
  assert.equal(POLL_PASSO_MS, 60_000);
});

test("C: a conta do envelope fecha em CINCO consultas por container", () => {
  // A doc da Meta pede "once per minute, for no more than 5 minutes". Com
  // passo de 60s e teto de 90s por invocação dá 2 leituras; o cron é de 10 em
  // 10 min e a derrota é aos 15 → invocações em ~0min (2), ~10min (2) e ~20min
  // (1, já em derrota) = 5. Este teste existe para que mexer em qualquer um
  // dos três números obrigue a refazer a conta em voz alta.
  const leiturasPorInvocacao = Math.floor(POLL_MAX_MS / POLL_PASSO_MS) + 1;
  assert.equal(leiturasPorInvocacao, 2);
  const cicloCronMs = 10 * 60 * 1000;
  const invocacoesAteDerrota = Math.floor(DERROTA_MS / cicloCronMs) + 1;
  assert.equal(invocacoesAteDerrota, 2);
  // 2 invocações completas + a leitura única da invocação que declara derrota.
  assert.equal(leiturasPorInvocacao * invocacoesAteDerrota + 1, 5);
});

test("C: o teto por invocacao cabe no maxDuration da rota", () => {
  // ORCAMENTO_MS (45s) + POLL_MAX_MS + ~15s de media_publish tem que caber em
  // 180s, senão o Vercel corta a invocação NO MEIO do publish — e um publish
  // cortado é a única forma desta rota duplicar um post.
  assert.ok(45_000 + POLL_MAX_MS + 15_000 <= 180_000);
});

test("C: derrota aos 15 min — 3x a margem da doc, e nao 24h", () => {
  assert.equal(DERROTA_MS, 15 * 60 * 1000);
  assert.equal(DERROTA_MS, 3 * 5 * 60 * 1000);
  // O que ficou para trás: a janela de 24h que expirou o reel de 08/08.
  assert.ok(DERROTA_MS < 24 * 60 * 60 * 1000);
});

// ---------------------------------------------------------------------------
// C · a decisão de desistir — os três NUNCA
// ---------------------------------------------------------------------------

test("derrota dispara quando passou do limiar e o container nao andou", () => {
  const d = decidirDerrota({ idadeMs: DERROTA_MS + 1, ultimoCode: "IN_PROGRESS" });
  assert.equal(d.derrota, true);
  assert.equal(d.motivo, "sem_avanco");
});

test("NUNCA 1: code TERMINAL nao vira derrota, por mais velho que esteja", () => {
  // Derrota é veredito sobre ESPERA. Não se declara espera vencida contra quem
  // já respondeu — e um FINISHED velho é caminho de PUBLICAR, não de falhar.
  for (const code of CODES_TERMINAIS) {
    const d = decidirDerrota({ idadeMs: 48 * 60 * 60 * 1000, ultimoCode: code });
    assert.equal(d.derrota, false, `${code} nao pode virar derrota`);
    assert.equal(d.motivo, "code_terminal");
  }
});

test("NUNCA 2: idade ilegivel nao condena ninguem", () => {
  // Data podre em `detalhe.dedupe_confirmado_em` faria a subtração virar NaN.
  // NaN >= limiar é false em JS, mas depender disso é depender de sorte: a
  // regra está escrita, e este teste é quem garante que continue escrita.
  for (const idadeMs of [NaN, Infinity, -Infinity]) {
    const d = decidirDerrota({ idadeMs, ultimoCode: "IN_PROGRESS" });
    assert.equal(d.derrota, false, `idade ${idadeMs}`);
  }
  assert.equal(decidirDerrota({ idadeMs: NaN, ultimoCode: "IN_PROGRESS" }).motivo, "idade_ilegivel");
});

test("NUNCA 3: dentro do prazo e o caso comum e sadio", () => {
  for (const idadeMs of [0, 60_000, DERROTA_MS - 1]) {
    const d = decidirDerrota({ idadeMs, ultimoCode: "IN_PROGRESS" });
    assert.equal(d.derrota, false, `idade ${idadeMs}`);
    assert.equal(d.motivo, "dentro_do_prazo");
  }
});

test("a fronteira e fechada: exatamente no limiar JA e derrota", () => {
  assert.equal(decidirDerrota({ idadeMs: DERROTA_MS, ultimoCode: "IN_PROGRESS" }).derrota, true);
  assert.equal(decidirDerrota({ idadeMs: DERROTA_MS - 1, ultimoCode: "IN_PROGRESS" }).derrota, false);
});

test("code desconhecido tambem espera e tambem pode perder", () => {
  // "DESCONHECIDO" é o que o statusContainer devolve quando a Graph responde
  // 200 sem status_code. Não é terminal — logo, conta o relógio como qualquer
  // IN_PROGRESS. Ficar preso para sempre num code que ninguém reconhece seria
  // exatamente o defeito que esta fatia veio consertar.
  assert.equal(decidirDerrota({ idadeMs: 60_000, ultimoCode: "DESCONHECIDO" }).derrota, false);
  assert.equal(decidirDerrota({ idadeMs: DERROTA_MS, ultimoCode: "DESCONHECIDO" }).derrota, true);
});

// ---------------------------------------------------------------------------
// A âncora do relógio
// ---------------------------------------------------------------------------

const LINHA = {
  criado_em: "2026-08-09T14:31:09Z",
  atualizado_em: "2026-08-09T17:50:50Z",
  detalhe: { dedupe_confirmado_em: "2026-08-09T17:50:50.261Z" } as Record<string, unknown>,
};

test("ancora: dedupe_confirmado_em vem primeiro — e o carimbo DESTE container", () => {
  assert.equal(ancoraContainer(LINHA), "2026-08-09T17:50:50.261Z");
});

test("ancora: sem dedupe cai em atualizado_em; sem os dois, em criado_em", () => {
  assert.equal(ancoraContainer({ ...LINHA, detalhe: {} }), "2026-08-09T17:50:50Z");
  assert.equal(ancoraContainer({ ...LINHA, detalhe: null }), "2026-08-09T17:50:50Z");
  assert.equal(
    ancoraContainer({ ...LINHA, detalhe: null, atualizado_em: null }),
    "2026-08-09T14:31:09Z"
  );
});

test("idade: conta a partir da ancora, com o relogio vindo de fora", () => {
  const ancora = new Date("2026-08-09T17:50:50.261Z").getTime();
  assert.equal(idadeContainerMs(LINHA, ancora + DERROTA_MS), DERROTA_MS);
  assert.ok(Number.isNaN(idadeContainerMs({ ...LINHA, detalhe: { dedupe_confirmado_em: "ontem" } }, ancora)));
});

// ---------------------------------------------------------------------------
// O motivo literal — o que o painel vai mostrar
// ---------------------------------------------------------------------------

test("motivo literal carrega o copyright_check_status, como a OS pede", () => {
  const m = motivoDerrota(
    {
      id: "178",
      status: "In Progress",
      status_code: "IN_PROGRESS",
      copyright_check_status: "in_progress",
    },
    15
  );
  assert.match(m, /^derrota_15min_sem_avanco /);
  assert.match(m, /status_code=IN_PROGRESS/);
  assert.match(m, /copyright_check_status=in_progress/);
  assert.match(m, /status=In Progress/);
});

test("motivo diz 'ausente' em vez de calar quando a Meta nao devolveu o campo", () => {
  // Omitir o campo é um silêncio que se lê como "não olhei". Dizer "ausente" é
  // um fato sobre a resposta da Meta — e é o fato que a hipótese do avatar
  // sintético precisa para ser confirmada ou morta.
  const m = motivoDerrota(
    { id: null, status: null, status_code: "IN_PROGRESS", copyright_check_status: null },
    22
  );
  assert.match(m, /copyright_check_status=ausente/);
  // `status` verboso ausente sai da frase inteiro — e `status_code=` continua
  // lá, que é o que a borda `(^| )status=` distingue de `status_code=`.
  assert.doesNotMatch(m, /(^| )status=/);
});

test("motivo cabe na coluna: nunca passa de 500", () => {
  const m = motivoDerrota(
    {
      id: "1".repeat(400),
      status: "x".repeat(900),
      status_code: "IN_PROGRESS",
      copyright_check_status: "y".repeat(900),
    },
    99
  );
  assert.ok(m.length <= 500, `motivo tem ${m.length}`);
});

// ---------------------------------------------------------------------------
// CONTAINER-LOTERIA-01 · a régua de RECRIAR
// ---------------------------------------------------------------------------
// `decidirDerrota` é a função que joga um vídeo fora. `decidirRecriacao` é a
// que decide gastar download, upload e uma chamada de container para tentar de
// novo. As duas erram caro em direções opostas, e por isso as duas moram aqui
// em vez de virarem um `if` dentro do laço da fase 2.
//
// O teste que mais importa deste bloco é o do `DESCONHECIDO`. Ele é a lição da
// DIAG-CONTAINER-02 escrita em forma executável: `DESCONHECIDO` é o nome que a
// casa dá a NÃO TER LIDO o container, e autorizar uma ação por não ter lido é
// exatamente o defeito que aquela fatia consertou. Se alguém um dia "melhorar"
// `decidirRecriacao` aceitando qualquer code não-terminal, este teste cai.
// ---------------------------------------------------------------------------

test("teto de recriacoes e o numero da ordem: 3", () => {
  // Falar alto. Trocar 3 por 10 é uma decisão de gasto, não um ajuste fino.
  assert.equal(TETO_RECRIACOES, 3);
});

test("as duas listas de code nao se cruzam", () => {
  for (const c of CODES_EM_CURSO) {
    assert.ok(!CODES_TERMINAIS.includes(c), `${c} nao pode ser terminal e em curso`);
  }
});

test("contarRecriacoes: ausente e zero, corrompido e NaN", () => {
  assert.equal(contarRecriacoes(null), 0);
  assert.equal(contarRecriacoes({}), 0);
  assert.equal(contarRecriacoes({ recriacoes: [] }), 0);
  assert.equal(contarRecriacoes({ recriacoes: [{ em: "x" }, { em: "y" }] }), 2);
  // Campo presente e nao-lista: nao sabemos quantas foram. NaN, e nao 0 — um
  // zero aqui daria tres recriacoes novas a uma linha que ja pode ter gasto.
  assert.ok(Number.isNaN(contarRecriacoes({ recriacoes: 2 })));
  assert.ok(Number.isNaN(contarRecriacoes({ recriacoes: "duas" })));
  assert.ok(Number.isNaN(contarRecriacoes({ recriacoes: {} })));
});

test("caminhoRetry: prefixo fixo, carimbo dentro e mp4 no fim", () => {
  const c = caminhoRetry("abc123", 1_700_000_000_000);
  assert.ok(c.startsWith("retry/"), c);
  assert.ok(c.endsWith(".mp4"), c);
  assert.match(c, /abc123/);
  assert.match(c, /1700000000000/);
});

test("caminhoRetry: carimbo diferente, caminho diferente — e e isso que quebra o dedupe", () => {
  // O ponto inteiro da ordem. Se dois instantes distintos dessem o mesmo
  // caminho, a URL nao seria nova e a Meta devolveria o container travado.
  assert.notEqual(caminhoRetry("v1", 1_000), caminhoRetry("v1", 1_001));
});

test("caminhoRetry: id de fora nao escapa do prefixo", () => {
  const c = caminhoRetry("../../segredo", 7);
  assert.ok(c.startsWith("retry/"), c);
  assert.doesNotMatch(c, /\.\./);
  assert.equal(caminhoRetry("", 7), "retry/sem_id-7.mp4");
  assert.equal(caminhoRetry("///", 7), "retry/___-7.mp4");
});

test("recria quando a Meta AFIRMA que o container ainda anda", () => {
  const r = decidirRecriacao({ ultimoCode: "IN_PROGRESS", recriacoes: 0 });
  assert.equal(r.recriar, true);
  assert.equal(r.tentativa, 1);
  assert.equal(r.motivo, "container_travado");

  const r2 = decidirRecriacao({ ultimoCode: "PUBLISHING", recriacoes: 2 });
  assert.equal(r2.recriar, true);
  assert.equal(r2.tentativa, 3);
});

test("NAO recria por code DESCONHECIDO — nao ler nao autoriza gastar", () => {
  // A licao da DIAG-CONTAINER-02, em forma executavel.
  for (const c of ["DESCONHECIDO", "", "null", "sei_la"]) {
    const r = decidirRecriacao({ ultimoCode: c, recriacoes: 0 });
    assert.equal(r.recriar, false, c);
    assert.equal(r.tentativa, 0, c);
    assert.match(r.motivo, /code_nao_em_curso/);
  }
});

test("NAO recria em code terminal — a Meta ja respondeu", () => {
  for (const c of CODES_TERMINAIS) {
    assert.equal(decidirRecriacao({ ultimoCode: c, recriacoes: 0 }).recriar, false, c);
  }
});

test("NAO recria com contador ilegivel", () => {
  for (const n of [Number.NaN, Infinity, -1]) {
    const r = decidirRecriacao({ ultimoCode: "IN_PROGRESS", recriacoes: n });
    assert.equal(r.recriar, false, String(n));
    assert.equal(r.tentativa, 0);
  }
});

test("no teto a derrota volta a ser definitiva", () => {
  const r = decidirRecriacao({ ultimoCode: "IN_PROGRESS", recriacoes: TETO_RECRIACOES });
  assert.equal(r.recriar, false);
  assert.match(r.motivo, /teto_atingido/);
  // E nao afrouxa depois: contador acima do teto tambem recusa.
  assert.equal(
    decidirRecriacao({ ultimoCode: "IN_PROGRESS", recriacoes: TETO_RECRIACOES + 5 }).recriar,
    false
  );
});

test("a linha inteira: tres recriacoes autorizadas, a quarta nao", () => {
  const autorizadas: number[] = [];
  for (let n = 0; n < 6; n++) {
    const r = decidirRecriacao({ ultimoCode: "IN_PROGRESS", recriacoes: n });
    if (r.recriar) autorizadas.push(r.tentativa);
  }
  assert.deepEqual(autorizadas, [1, 2, 3]);
});
