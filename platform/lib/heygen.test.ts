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
  inventarioVozes,
  inventarioAvatares,
  TETO_PAGINAS,
  type OpcaoVoz,
  type Buscador,
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

// ===========================================================================
// inventarioVozes / inventarioAvatares — PAINEL-VOZES-01
// ---------------------------------------------------------------------------
// O QUE ESTES TESTES PROTEGEM. O inventário existe para responder uma pergunta
// que o cardápio não responde: "este id existe na conta?". O modo de essa
// resposta ficar ERRADA não é a rede cair — isso aparece na tela. É a lista
// voltar CURTA parecendo COMPLETA: uma página que não foi seguida, um orçamento
// que estourou calado, uma fonte que morreu e foi omitida. Aí o operador lê
// "não achei" e conclui "não existe" — que é exatamente o erro de 10/08, agora
// com cara de instrumento.
//
// Por isso o que está sob teste aqui é, em quase toda linha, a HONESTIDADE da
// resposta: `parcial`, `avisos`, `fontes[].ok` e o `controle`. O caminho feliz
// aparece uma vez; o resto são os jeitos de mentir.
//
// Nada toca a rede: o buscador é injetado. É por isso que ele é parâmetro.
// ===========================================================================

/** Um HeyGen de mentira: casa o começo do caminho e devolve o corpo cru. */
function servidor(rotas: Record<string, unknown>): Buscador {
  return async (caminho: string) => {
    for (const [chave, corpo] of Object.entries(rotas)) {
      if (caminho.startsWith(chave)) {
        if (corpo instanceof Error) return { ok: false as const, erro: corpo.message };
        return { ok: true as const, data: corpo };
      }
    }
    return { ok: false as const, erro: "http_404 rota não registrada no falso" };
  };
}

const pagina = (voices: unknown[], extra: Record<string, unknown> = {}) => ({
  data: { voices, ...extra },
});

// --- caminho feliz ---------------------------------------------------------

test("inventário: as duas fontes boas e o socorro presente ⇒ nada de parcial", async () => {
  const inv = await inventarioVozes({
    buscar: servidor({
      "/v3/voices": pagina([{ voice_id: VOZ_SOCORRO, name: "Pedro Lima" }]),
      "/v2/voices": pagina([{ voice_id: "outra", name: "Outra" }]),
    }),
  });
  assert.equal(inv.itens.length, 2);
  assert.equal(inv.controle?.socorro_presente, true);
  assert.equal(inv.parcial, false);
  assert.deepEqual(inv.avisos, []);
  assert.deepEqual(
    inv.fontes.map((f) => [f.nome, f.ok, f.n]),
    [
      ["v3/voices", true, 1],
      ["v2/voices", true, 1],
    ]
  );
});

// --- deduplicação ----------------------------------------------------------

test("inventário: id repetido nas duas fontes vira UM item, e fica o que tem amostra", async () => {
  // A mesma voz aparece nas duas superfícies com campos diferentes. Ficar com
  // a primeira por reflexo perderia a amostra — que é metade da razão de a tela
  // existir. O `origem: v2` prova que o vencedor foi o de baixo.
  const inv = await inventarioVozes({
    buscar: servidor({
      "/v3/voices": pagina([{ voice_id: "x", name: "Voz X" }]),
      "/v2/voices": pagina([{ voice_id: "x", name: "Voz X", preview_audio: "https://a/x.mp3" }]),
    }),
  });
  assert.equal(inv.itens.length, 1);
  assert.equal(inv.itens[0].amostra, "https://a/x.mp3");
  assert.equal(inv.itens[0].origem, "v2");
});

test("inventário: empate em amostra ⇒ desempata quem sabe dizer premium", async () => {
  const inv = await inventarioVozes({
    buscar: servidor({
      "/v3/voices": pagina([{ voice_id: "x", name: "X" }]),
      "/v2/voices": pagina([{ voice_id: "x", name: "X", premium: true }]),
    }),
  });
  assert.equal(inv.itens.length, 1);
  assert.equal(inv.itens[0].premium, true);
});

test("inventário: voz sem id é descartada, não vira linha com id vazio", async () => {
  const inv = await inventarioVozes({
    buscar: servidor({
      "/v3/voices": pagina([{ name: "sem id nenhum" }, { voice_id: "ok", name: "OK" }]),
      "/v2/voices": pagina([]),
    }),
  });
  assert.deepEqual(inv.itens.map((v) => v.id), ["ok"]);
});

// --- premium: o campo que `primeiro` não consegue ler ----------------------

test("inventário: premium aceita true, \"true\" e 1", async () => {
  const inv = await inventarioVozes({
    buscar: servidor({
      "/v3/voices": pagina([
        { voice_id: "a", premium: true },
        { voice_id: "b", is_premium: "true" },
        { voice_id: "c", premium: 1 },
      ]),
      "/v2/voices": pagina([]),
    }),
  });
  assert.deepEqual(inv.itens.map((v) => v.premium), [true, true, true]);
});

test("inventário: premium distingue FALSO de NÃO-DITO — 0 é false, ausente é null", async () => {
  // A distinção não é preciosismo: achatar `null` em `false` faria uma voz paga
  // parecer gratuita numa tela usada justamente para escolher voz.
  const inv = await inventarioVozes({
    buscar: servidor({
      "/v3/voices": pagina([
        { voice_id: "a", premium: false },
        { voice_id: "b", premium: 0 },
        { voice_id: "c", premium: "" },
        { voice_id: "d" },
      ]),
      "/v2/voices": pagina([]),
    }),
  });
  assert.deepEqual(inv.itens.map((v) => v.premium), [false, false, null, null]);
});

// --- falha parcial: uma fonte cair não pode apagar a outra -----------------

test("inventário: v2 morta NÃO zera a v3 — vira fonte ok:false ao lado", async () => {
  const inv = await inventarioVozes({
    buscar: servidor({
      "/v3/voices": pagina([{ voice_id: VOZ_SOCORRO, name: "Pedro" }]),
      "/v2/voices": new Error("http_500 boom"),
    }),
  });
  assert.equal(inv.itens.length, 1);
  assert.equal(inv.parcial, true);
  const v2 = inv.fontes.find((f) => f.nome === "v2/voices");
  assert.equal(v2?.ok, false);
  assert.equal(v2?.erro, "http_500 boom");
  // E a v3 continua de pé, com o número dela intacto.
  assert.equal(inv.fontes.find((f) => f.nome === "v3/voices")?.n, 1);
});

test("inventário: as DUAS fontes mortas ⇒ lista vazia legível, nunca exceção", async () => {
  const inv = await inventarioVozes({ buscar: servidor({}) });
  assert.deepEqual(inv.itens, []);
  assert.equal(inv.parcial, true);
  assert.ok(inv.fontes.every((f) => !f.ok));
});

test("inventário: buscador que EXPLODE vira erro na fonte, não exceção na rota", async () => {
  const explode: Buscador = async () => {
    throw new Error("rede caiu");
  };
  const inv = await inventarioVozes({ buscar: explode });
  assert.deepEqual(inv.itens, []);
  assert.equal(inv.parcial, true);
  assert.ok(inv.fontes.some((f) => f.erro === "rede caiu"));
});

// --- o controle, que é a defesa contra a conclusão errada ------------------

test("inventário: sem o socorro na lista, controle acusa E escreve o aviso", async () => {
  // Sem este campo o operador leria "não achei o id" e concluiria "o id não
  // existe" — a conclusão exata que este arquivo inteiro existe para impedir.
  const inv = await inventarioVozes({
    buscar: servidor({
      "/v3/voices": pagina([{ voice_id: "qualquer" }]),
      "/v2/voices": pagina([]),
    }),
  });
  assert.equal(inv.controle?.socorro_presente, false);
  assert.equal(inv.parcial, true);
  assert.ok(
    inv.avisos.some((a) => a.includes(VOZ_SOCORRO)),
    "o aviso do controle tem que citar o id do socorro"
  );
});

// --- paginação: o defeito que fazia 900 vozes parecerem 100 ---------------

test("inventário: segue o token até a página sem token", async () => {
  let n = 0;
  const buscar: Buscador = async (caminho) => {
    if (caminho.startsWith("/v2/")) return { ok: true, data: { data: { voices: [] } } };
    n++;
    return {
      ok: true,
      data: { data: { voices: [{ voice_id: `v${n}` }], ...(n < 3 ? { token: `t${n}` } : {}) } },
    };
  };
  const inv = await inventarioVozes({ buscar });
  assert.deepEqual(inv.itens.map((v) => v.id), ["v1", "v2", "v3"]);
  assert.equal(n, 3);
});

test("inventário: token que se REPETE para o laço — API travada não vira laço infinito", async () => {
  let n = 0;
  const buscar: Buscador = async (caminho) => {
    if (caminho.startsWith("/v2/")) return { ok: true, data: { data: { voices: [] } } };
    n++;
    return { ok: true, data: { data: { voices: [{ voice_id: `v${n}` }], token: "sempre-o-mesmo" } } };
  };
  const inv = await inventarioVozes({ buscar });
  assert.equal(n, 2, "devia parar assim que o token repetiu");
  assert.equal(inv.itens.length, 2);
});

test("inventário: teto de páginas corta E avisa — nunca trunca calado", async () => {
  let n = 0;
  const buscar: Buscador = async (caminho) => {
    if (caminho.startsWith("/v2/")) return { ok: true, data: { data: { voices: [] } } };
    n++;
    return { ok: true, data: { data: { voices: [{ voice_id: `v${n}` }], token: `t${n}` } } };
  };
  const inv = await inventarioVozes({ buscar });
  assert.equal(n, TETO_PAGINAS);
  assert.equal(inv.parcial, true);
  assert.ok(inv.avisos.some((a) => a.includes("teto")), "o corte por teto tem que aparecer");
});

test("inventário: erro na página 3 preserva as páginas 1 e 2", async () => {
  let n = 0;
  const buscar: Buscador = async (caminho) => {
    if (caminho.startsWith("/v2/")) return { ok: true, data: { data: { voices: [] } } };
    n++;
    if (n === 3) return { ok: false, erro: "http_429 quota" };
    return { ok: true, data: { data: { voices: [{ voice_id: `v${n}` }], token: `t${n}` } } };
  };
  const inv = await inventarioVozes({ buscar });
  assert.deepEqual(inv.itens.map((v) => v.id), ["v1", "v2"]);
  assert.equal(inv.fontes.find((f) => f.nome === "v3/voices")?.erro, "http_429 quota");
  assert.ok(inv.avisos.some((a) => a.includes("caiu depois de 2")));
});

// --- orçamento de relógio --------------------------------------------------

test("inventário: orçamento estourado ⇒ parcial:true E aviso, com relógio injetado", async () => {
  // Relógio de mentira: cada leitura avança 1s. Assim o teste do orçamento não
  // custa 120 segundos de suíte para provar uma linha de aritmética.
  let t = 0;
  const relogio = () => (t += 1000);
  const inv = await inventarioVozes({
    buscar: servidor({ "/v3/voices": pagina([{ voice_id: "x" }]), "/v2/voices": pagina([]) }),
    orcamentoMs: 500,
    agora: relogio,
  });
  assert.equal(inv.parcial, true);
  assert.ok(
    inv.avisos.some((a) => a.includes("orçamento")),
    `nenhum aviso de orçamento: ${JSON.stringify(inv.avisos)}`
  );
});

test("inventário: orçamento que acaba na v3 marca a v2 como NÃO CONSULTADA", async () => {
  // "Não consultada" e "consultada e vazia" são coisas diferentes, e confundir
  // as duas é o mesmo defeito de `lista_indisponivel` vs `lista_sem_referencia`.
  let t = 0;
  const relogio = () => (t += 1000);
  const inv = await inventarioVozes({
    buscar: servidor({ "/v3/voices": pagina([]), "/v2/voices": pagina([]) }),
    orcamentoMs: 500,
    agora: relogio,
  });
  const v2 = inv.fontes.find((f) => f.nome === "v2/voices");
  assert.equal(v2?.ok, false);
  assert.equal(v2?.erro, "orcamento_estourado");
});

// --- avatares: mesmo desenho, uma diferença declarada ---------------------

test("avatares: junta as três famílias e NÃO inventa controle", async () => {
  const inv = await inventarioAvatares({
    buscar: servidor({
      "/v3/avatars/looks": { data: { looks: [{ id: "look-1", name: "Porta-voz" }] } },
      "/v1/talking_photo.list": {
        data: { talking_photos: [{ talking_photo_id: "tp-1", talking_photo_name: "Valentina" }] },
      },
    }),
  });
  assert.deepEqual(inv.itens.map((a) => a.id), ["look-1", "tp-1"]);
  // `null`, e não `{socorro_presente:false}`: não existe avatar de socorro
  // cravado, e reprovar uma família que não tem controle seria inventar prova.
  assert.equal(inv.controle, null);
  assert.equal(inv.parcial, false);
});

test("avatares: o legado morto não apaga os looks da v3", async () => {
  const inv = await inventarioAvatares({
    buscar: servidor({
      "/v3/avatars/looks": { data: { looks: [{ id: "look-1" }] } },
      "/v1/talking_photo.list": new Error("http_401 unauthorized"),
    }),
  });
  assert.deepEqual(inv.itens.map((a) => a.id), ["look-1"]);
  assert.equal(inv.parcial, true);
  assert.equal(inv.fontes.find((f) => f.nome === "v1/talking_photo.list")?.ok, false);
});

test("avatares: o mesmo id nas duas famílias v3 aparece UMA vez", async () => {
  // `/v3/avatars/looks` sem filtro e com `avatar_type=photo_avatar` devolvem a
  // MESMA entidade quando o id bate. Duas linhas iguais na tela seriam ruído.
  const inv = await inventarioAvatares({
    buscar: servidor({
      "/v3/avatars/looks": { data: { looks: [{ id: "look-1", avatar_type: "photo_avatar" }] } },
      "/v1/talking_photo.list": { data: { talking_photos: [] } },
    }),
  });
  assert.equal(inv.itens.length, 1);
  assert.equal(inv.itens[0].tipo, "photo_avatar");
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
