// ============================================================================
// lib/whatsapp/transcricao.test.ts — OUVIDO-01 v2, item (e).
// ----------------------------------------------------------------------------
// A ordem pede controle dos DOIS lados: curto→transcreve · longo→fallback ·
// Whisper fora→fallback. Um teste que só mostra o caminho feliz não prova rede
// nenhuma: prova que existe um caminho, que é o que já se sabia.
//
// SEM REDE. O `fetch` é injetado, então "o Whisper caiu" aqui é um Whisper
// caindo de verdade dentro do teste, e não um mock de que ele caiu.
//
// A CHAVE. Estes testes põem um valor FALSO em OPENAI_API_KEY e o restauram no
// fim. Nenhum segredo real entra aqui — e o teste `sem_chave` existe justamente
// para provar que o código não trata env ausente como exceção.
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  transcreverAudio,
  extDoAudio,
  TETO_BYTES,
  type Buscador,
} from "./transcricao";

// ---- ferramentas do teste ---------------------------------------------------

/** Roda `fn` com uma chave falsa no ambiente e devolve o ambiente ao que era.
 *  Sem o restore, um teste vazaria estado para o seguinte e o portão passaria
 *  a depender da ORDEM dos testes — que é um jeito caro de descobrir bug. */
async function comChaveFalsa<T>(fn: () => Promise<T>): Promise<T> {
  const antes = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-teste-nao-e-segredo";
  try {
    return await fn();
  } finally {
    if (antes === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = antes;
  }
}

/** Whisper de mentira que responde o que o teste mandar. Guarda a última
 *  requisição para que o teste possa CONFERIR o que saiu — sem isso, não dá
 *  para saber se o multipart foi montado ou se só não explodiu. */
function whisperFalso(resposta: {
  status?: number;
  corpo?: unknown;
  lancar?: boolean;
}): { buscar: Buscador; ultima: () => { url: string; init: RequestInit } | null } {
  let ultima: { url: string; init: RequestInit } | null = null;
  const buscar = (async (url: unknown, init?: RequestInit) => {
    ultima = { url: String(url), init: init ?? {} };
    if (resposta.lancar) throw new Error("socket caiu");
    return new Response(JSON.stringify(resposta.corpo ?? {}), {
      status: resposta.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as Buscador;
  return { buscar, ultima: () => ultima };
}

const CURTO = new Uint8Array(1024).fill(7);

// ============================================================================
// CASO 1 — curto: transcreve e devolve a fala
// ============================================================================

test("áudio curto transcreve e devolve o texto do cliente", async () => {
  await comChaveFalsa(async () => {
    const { buscar } = whisperFalso({ corpo: { text: "  quero vender minha cota  " } });
    const r = await transcreverAudio(CURTO, "audio/ogg; codecs=opus", { buscar });
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.texto, "quero vender minha cota");
  });
});

test("o multipart sai montado, com modelo, idioma e a chave no header", async () => {
  await comChaveFalsa(async () => {
    const { buscar, ultima } = whisperFalso({ corpo: { text: "oi" } });
    await transcreverAudio(CURTO, "audio/ogg", { buscar });

    const req = ultima();
    assert.ok(req, "o Whisper foi chamado");
    assert.ok(req.url.endsWith("/audio/transcriptions"), `url errada: ${req.url}`);
    assert.equal(req.init.method, "POST");

    const form = req.init.body as FormData;
    assert.ok(form instanceof FormData, "o corpo precisa ser FormData (multipart)");
    assert.equal(form.get("model"), "whisper-1");
    assert.equal(form.get("language"), "pt");
    assert.ok(form.get("file"), "o arquivo precisa ir no form");

    // CONTROLE do boundary: escrever Content-Type à mão quebra o multipart de
    // um jeito que só aparece em produção. Aqui dói no portão.
    const headers = (req.init.headers ?? {}) as Record<string, string>;
    assert.equal(headers["Content-Type"], undefined, "não fixar Content-Type");
    assert.ok(String(headers.Authorization).startsWith("Bearer "), "chave vai no header");
  });
});

// ============================================================================
// CASO 2 — longo: a rede pega, e pega ANTES de gastar crédito
// ============================================================================

test("áudio longo demais cai na rede — e não chega a chamar o Whisper", async () => {
  await comChaveFalsa(async () => {
    const { buscar, ultima } = whisperFalso({ corpo: { text: "nunca deveria sair" } });
    const grande = new Uint8Array(TETO_BYTES + 1);
    const r = await transcreverAudio(grande, "audio/ogg", { buscar });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.motivo, "longo_demais");
    // O ponto: recusar depois de pagar não seria economia nenhuma.
    assert.equal(ultima(), null, "não pode gastar crédito com o que já se recusou");
  });
});

test("CONTROLE do teto: exatamente no limite ainda passa", async () => {
  // Sem este lado, `longo_demais` poderia estar recusando TUDO e o teste acima
  // passaria igual — um teto que recusa tudo não é teto, é parede.
  await comChaveFalsa(async () => {
    const { buscar } = whisperFalso({ corpo: { text: "cabe" } });
    const noLimite = new Uint8Array(TETO_BYTES);
    const r = await transcreverAudio(noLimite, "audio/ogg", { buscar });
    assert.equal(r.ok, true);
  });
});

// ============================================================================
// CASO 3 — Whisper fora, nas três formas que ele sai do ar
// ============================================================================

test("Whisper com erro HTTP cai na rede", async () => {
  await comChaveFalsa(async () => {
    const { buscar } = whisperFalso({ status: 500, corpo: { error: "detalhe da conta" } });
    const r = await transcreverAudio(CURTO, "audio/ogg", { buscar });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.motivo, "whisper_fora");
  });
});

test("Whisper que nem responde (socket) cai na rede", async () => {
  await comChaveFalsa(async () => {
    const { buscar } = whisperFalso({ lancar: true });
    const r = await transcreverAudio(CURTO, "audio/ogg", { buscar });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.motivo, "whisper_fora");
  });
});

test("Whisper que demora mais que o orçamento cai na rede", async () => {
  await comChaveFalsa(async () => {
    // Respeita o abort: é assim que o AbortController se comporta de verdade.
    const buscar = (async (_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener("abort", () => rej(new Error("abortado")));
      })) as unknown as Buscador;

    const t0 = Date.now();
    const r = await transcreverAudio(CURTO, "audio/ogg", { buscar, timeoutMs: 50 });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.motivo, "whisper_fora");
    assert.ok(Date.now() - t0 < 2_000, "o relógio tem de cortar, não esperar");
  });
});

// ============================================================================
// CASO 4 — os fatos que NÃO podem virar o mesmo registro (Regra 19)
// ============================================================================

test("silêncio NÃO vira turno vazio no cérebro", async () => {
  // O defeito da fatia, visto de dentro: `ok:true` com texto vazio poria uma
  // linha muda no cérebro com a nossa assinatura.
  await comChaveFalsa(async () => {
    for (const corpo of [{ text: "" }, { text: "   " }, {}]) {
      const { buscar } = whisperFalso({ corpo });
      const r = await transcreverAudio(CURTO, "audio/ogg", { buscar });
      assert.equal(r.ok, false, `corpo ${JSON.stringify(corpo)} não pode dar ok`);
      assert.equal(!r.ok && r.motivo, "silencio");
    }
  });
});

test("zero byte é 'vazio', e não 'silencio' — são fatos diferentes", async () => {
  await comChaveFalsa(async () => {
    const { buscar, ultima } = whisperFalso({ corpo: { text: "x" } });
    const r = await transcreverAudio(new Uint8Array(0), "audio/ogg", { buscar });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.motivo, "vazio");
    assert.equal(ultima(), null, "não manda 0 byte para a OpenAI");
  });
});

test("env ausente é 'sem_chave' e NÃO exceção", async () => {
  // Ambiente mal configurado tem de virar fallback honesto. Se lançasse, quem
  // chama precisaria lembrar do try/catch — e um dia esqueceria.
  const antes = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const { buscar, ultima } = whisperFalso({ corpo: { text: "x" } });
    const r = await transcreverAudio(CURTO, "audio/ogg", { buscar });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.motivo, "sem_chave");
    assert.equal(ultima(), null);
  } finally {
    if (antes !== undefined) process.env.OPENAI_API_KEY = antes;
  }
});

test("CONTROLE: nenhuma falha lança — a função é caminho, o fallback é rede", async () => {
  // Se qualquer uma destas lançasse, o `catch` esquecido lá em cima devolveria
  // o cliente ao silêncio.
  const antes = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await assert.doesNotReject(() =>
      transcreverAudio(CURTO, null, { buscar: whisperFalso({ lancar: true }).buscar })
    );
  } finally {
    if (antes !== undefined) process.env.OPENAI_API_KEY = antes;
  }
  await comChaveFalsa(async () => {
    await assert.doesNotReject(() =>
      transcreverAudio(CURTO, "audio/ogg", { buscar: whisperFalso({ status: 401 }).buscar })
    );
  });
});

// ============================================================================
// CASO 5 — extensão do arquivo mandado ao Whisper
// ============================================================================

test("extDoAudio ignora o `; codecs=opus` que o WhatsApp manda", () => {
  // Sem cortar o parâmetro, NENHUMA chave bateria e todo áudio viraria .ogg
  // por acidente. Passaria despercebido justamente porque o acidente acerta.
  assert.equal(extDoAudio("audio/ogg; codecs=opus"), "ogg");
  assert.equal(extDoAudio("AUDIO/MPEG"), "mp3");
  assert.equal(extDoAudio("audio/mp4"), "m4a");
});

test("extDoAudio cai em ogg quando não sabe — a nota de voz do WhatsApp", () => {
  assert.equal(extDoAudio(null), "ogg");
  assert.equal(extDoAudio(undefined), "ogg");
  assert.equal(extDoAudio("application/octet-stream"), "ogg");
});
