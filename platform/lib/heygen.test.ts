// ============================================================================
// heygen.test.ts — a escolha da voz, sob teste (10/08/2026)
// ----------------------------------------------------------------------------
// O QUE ESTE ARQUIVO PROTEGE. Em 10/08/2026, 11h31, o reel do dia se perdeu com
// `http_400 code=invalid_parameter Invalid voice_id: '05601cd1...'. Voice not
// found.` A voz existia no estúdio do HeyGen e mesmo assim a API de vídeo a
// recusou. O fallback de persona que já existia não salvou nada: ele
// re-renderiza com a MESMA voz da env.
//
// AS DUAS FUNÇÕES AQUI FAZEM COISAS DIFERENTES, e a diferença é o ponto:
//   `escolherVoz`  — a conferência ANTES do render, pedida na ordem. É barata e
//                    pode não pegar nada (a voz recusada aparece no estúdio, e
//                    provavelmente aparece na listagem também).
//   `recusaDeVoz`  — a queda DEPOIS do erro. É a que teria salvado 10/08,
//                    porque age sobre o veredito da própria HeyGen.
//
// O QUE ESTES TESTES CUIDAM MAIS DE PERTO NÃO É O CAMINHO FELIZ — é a recusa
// falsa. `listarVozes` tem teto de itens; uma voz boa pode simplesmente não
// caber na página. Se `escolherVoz` tratar "não vi" como "não existe", ela
// troca a voz da marca por artefato de paginação, e a proteção contra perder o
// vídeo vira um jeito novo de estragá-lo. Daí a regra da CREDENCIAL: a lista só
// reprova a configurada se trouxer o socorro junto, provando que é uma lista
// que enxerga vozes sabidamente boas.
//
// E cuidam do dinheiro. `recusaDeVoz` só aceita 4xx, pela mesma razão que
// governa `recusaDeCadastro` em reel-render: só o 4xx prova que nada foi
// enfileirado nem cobrado. Um 500 ou um timeout podem ter COMEÇADO um render —
// repetir ali paga dois vídeos para publicar um. E exige a voz na mensagem,
// senão todo 4xx (avatar, roteiro, cota) viraria motivo para re-renderizar
// trocando a voz, que não conserta nenhum deles.
//
// Nada aqui toca a rede. As duas funções são puras: recebem a lista já lida e
// a string de erro já formada.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import {
  escolherVoz,
  recusaDeVoz,
  vozesEmPrazo,
  VOZ_SOCORRO,
  PRAZO_LISTAGEM_MS,
  type OpcaoVoz,
} from "./heygen";

/** Uma voz de mentira com o mínimo que `escolherVoz` olha. */
function voz(id: string, idioma: string | null = "Portuguese"): OpcaoVoz {
  return { id, nome: `voz ${id}`, genero: null, idioma, origem: "v3" };
}

const CONFIGURADA = "voz-configurada";
const SOCORRO = "voz-socorro";

// ---------------------------------------------------------------------------
// escolherVoz — o caminho normal
// ---------------------------------------------------------------------------

test("voz: a configurada está na conta — passa direto, sem motivo", () => {
  const r = escolherVoz(CONFIGURADA, [voz(CONFIGURADA), voz(SOCORRO)], SOCORRO);
  assert.equal(r.voz, CONFIGURADA);
  assert.equal(r.motivo, null);
});

test("voz: depois da reversão da env, configurada == socorro e nada muda", () => {
  // Cenário real pós-instrução de env: HEYGEN_VOICE_ID volta a ser o Pedro
  // Lima, que é o próprio VOZ_SOCORRO. A conferência tem que virar inócua.
  const r = escolherVoz(VOZ_SOCORRO, [voz(VOZ_SOCORRO)]);
  assert.equal(r.voz, VOZ_SOCORRO);
  assert.equal(r.motivo, null);
});

// ---------------------------------------------------------------------------
// escolherVoz — a regra que impede a proteção de virar defeito
// ---------------------------------------------------------------------------

test("voz: lista vazia NÃO desvia — ausência de prova não é prova", () => {
  // Se a listagem falhou ou veio vazia, desviar seria deixar uma consulta
  // auxiliar mandar no render. O render segue com a configurada.
  const r = escolherVoz(CONFIGURADA, [], SOCORRO);
  assert.equal(r.voz, CONFIGURADA);
  assert.equal(r.motivo, "lista_indisponivel");
});

test("voz: configurada ausente E socorro presente — aí sim desvia", () => {
  // O socorro na lista é a credencial: prova que esta lista enxerga vozes
  // boas, logo a ausência da configurada é informação, não ruído.
  const r = escolherVoz(CONFIGURADA, [voz(SOCORRO), voz("outra")], SOCORRO);
  assert.equal(r.voz, SOCORRO);
  assert.equal(r.motivo, "configurada_ausente_da_conta");
});

test("voz: os DOIS ausentes — a lista não tem credencial, não reprova ninguém", () => {
  // Este é o teste da recusa falsa. Uma lista truncada em que nem o socorro
  // aparece é uma lista incompleta, não uma conta sem vozes.
  const r = escolherVoz(CONFIGURADA, [voz("estranha-1"), voz("estranha-2")], SOCORRO);
  assert.equal(r.voz, CONFIGURADA);
  assert.equal(r.motivo, "lista_sem_referencia");
});

test("voz: NUNCA escolhe uma terceira voz — só configurada ou socorro", () => {
  // Invariante do desenho. Se alguém reintroduzir o degrau "pega qualquer voz
  // em português", este teste cai. Trocar a voz da marca por conta própria é
  // pior do que deixar a HeyGen dar o veredito.
  const listas: OpcaoVoz[][] = [
    [],
    [voz(CONFIGURADA)],
    [voz(SOCORRO)],
    [voz(CONFIGURADA), voz(SOCORRO)],
    [voz("terceira", "Portuguese")],
    [voz("terceira", "English"), voz("quarta", "Portuguese (Brazil)")],
  ];
  for (const lista of listas) {
    const r = escolherVoz(CONFIGURADA, lista, SOCORRO);
    assert.ok(
      r.voz === CONFIGURADA || r.voz === SOCORRO,
      `escolheu voz de fora do par: ${r.voz}`
    );
  }
});

test("voz: o socorro padrão é o Pedro Lima, o id da instrução de env", () => {
  // Cravado de propósito e testado de propósito: se alguém trocar este valor
  // sem trocar a instrução de env, os dois passam a discordar em silêncio.
  assert.equal(VOZ_SOCORRO, "6872a840c4194f42a7f8ce0aee47660c");
});

// ---------------------------------------------------------------------------
// recusaDeVoz — a queda depois do erro, que é a que salva o vídeo
// ---------------------------------------------------------------------------

test("recusaDeVoz: o erro literal de 10/08 é reconhecido", () => {
  assert.equal(
    recusaDeVoz(
      "http_400 code=invalid_parameter Invalid voice_id: " +
        "'05601cd1a3f34777b78dce4e1ff9c66c'. Voice not found."
    ),
    true
  );
});

test("recusaDeVoz: 5xx e timeout NÃO repetem — podem já ter cobrado", () => {
  assert.equal(recusaDeVoz("http_500 Invalid voice_id"), false);
  assert.equal(recusaDeVoz("http_502 voice not found"), false);
  assert.equal(recusaDeVoz("timeout"), false);
  assert.equal(recusaDeVoz("resposta_sem_video_id"), false);
  assert.equal(recusaDeVoz(undefined), false);
  assert.equal(recusaDeVoz(""), false);
});

test("recusaDeVoz: 4xx que NÃO fala de voz não vira re-render", () => {
  // Trocar a voz não conserta avatar, roteiro nem cota. Repetir aqui seria
  // segunda cobrança certa e inútil.
  assert.equal(recusaDeVoz("http_400 code=invalid_parameter Invalid avatar_id"), false);
  assert.equal(recusaDeVoz("http_401 unauthorized"), false);
  assert.equal(recusaDeVoz("http_429 quota exceeded"), false);
});

test("recusaDeVoz: aceita as variações de escrita da mensagem", () => {
  assert.equal(recusaDeVoz("http_400 Invalid voice"), true);
  assert.equal(recusaDeVoz("http_404 voice not found"), true);
  assert.equal(recusaDeVoz("http_422 VOICE_ID is invalid"), true);
  assert.equal(recusaDeVoz("http_400 voice id não cadastrado"), true);
});

// ---------------------------------------------------------------------------
// vozesEmPrazo — a conferência tem permissão para não acontecer
// ---------------------------------------------------------------------------

test("prazo: listagem boa devolve as vozes", async () => {
  const r = await vozesEmPrazo(async () => ({ ok: true, data: [voz("a"), voz("b")] }));
  assert.deepEqual(r.map((v) => v.id), ["a", "b"]);
});

test("prazo: listagem que estoura o prazo vira lista VAZIA, não exceção", async () => {
  // O orçamento de 60s da rota não comporta 20s de listagem + dois renders.
  // Uma promessa que nunca resolve é o pior caso da rede; a rota tem que
  // seguir mesmo assim.
  const nunca = () => new Promise<{ ok: true; data: OpcaoVoz[] }>(() => {});
  const r = await vozesEmPrazo(nunca, 5);
  assert.deepEqual(r, []);
});

test("prazo: erro da API vira lista vazia — nunca derruba o render", async () => {
  assert.deepEqual(await vozesEmPrazo(async () => ({ ok: false, erro: "http_401" })), []);
  assert.deepEqual(
    await vozesEmPrazo(async () => ({ ok: false, erro: "env_ausente(HEYGEN_API_KEY)" })),
    []
  );
});

test("prazo: exceção crua também vira lista vazia", async () => {
  const explode = async (): Promise<{ ok: true; data: OpcaoVoz[] }> => {
    throw new Error("rede caiu");
  };
  assert.deepEqual(await vozesEmPrazo(explode, 50), []);
});

test("prazo: lista vazia leva escolherVoz a NÃO desviar — as duas peças casam", async () => {
  // O ponto de integração entre as duas funções: o modo de falha de uma é
  // exatamente a entrada segura da outra. Se alguém trocar o retorno de
  // `vozesEmPrazo` de [] para outra coisa, este teste cai.
  const vazia = await vozesEmPrazo(async () => ({ ok: false, erro: "timeout_heygen" }));
  const escolha = escolherVoz(CONFIGURADA, vazia, SOCORRO);
  assert.equal(escolha.voz, CONFIGURADA);
  assert.equal(escolha.motivo, "lista_indisponivel");
});

test("prazo: o padrão é curto o bastante para caber com dois renders em 60s", () => {
  // 20s de render + 20s de re-render + prazo <= 60s, com folga para o resto da
  // rota. Se alguém subir este número, a conferência passa a poder matar a rota
  // por estouro de tempo — o oposto do que ela existe para fazer.
  assert.ok(
    PRAZO_LISTAGEM_MS + 20_000 + 20_000 < 60_000,
    `prazo grande demais para o maxDuration da rota: ${PRAZO_LISTAGEM_MS}ms`
  );
});
