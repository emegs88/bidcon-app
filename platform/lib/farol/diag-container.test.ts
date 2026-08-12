// ============================================================================
// Testes da DIAG-CONTAINER-01.
//
// Dois grupos, e o segundo é o que importa de verdade:
//   1. a árvore de leitura — para que uma conclusão não possa ser afrouxada sem
//      alguém mexer num teste que diz em voz alta o que está afrouxando;
//   2. A TRAVA DE PUBLICAÇÃO — um teste que LÊ O FONTE DA ROTA e falha se a
//      palavra `media_publish` aparecer. É o único teste desta fatia que
//      protege a conta de verdade: todo o resto protege um raciocínio.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BITRATE_A_KBPS,
  BITRATE_B_KBPS,
  BUCKET_DIAG,
  BYTES_A,
  BYTES_B,
  bytesConferem,
  caminhoCopiaA,
  carimbo,
  corpoContainerDiag,
  dedupeDetectada,
  estadoLado,
  HEYGEN_SEM_BITRATE,
  lerAB,
  NOTA_RESUMABLE,
  PREFIXO_DIAG,
  TRAVADO_MS,
  VIDEO_A_ORIGEM,
  VIDEO_B,
} from "./diag-container";

// ---------------------------------------------------------------------------
// A TRAVA. Primeiro teste do arquivo, de propósito.
// ---------------------------------------------------------------------------

const FONTE_ROTA = new URL(
  "../../app/api/admin/farol/diag-container/route.ts",
  import.meta.url
);

test("A ROTA NÃO PUBLICA: `media_publish` não existe no fonte", () => {
  // A OS diz "SEM media_publish em nenhum caminho". Um comentário não garante
  // isso; um teste garante. Se alguém um dia acrescentar a publicação — por
  // conveniência, para "aproveitar o container" —, a suíte cai antes do deploy.
  //
  // Lê o fonte por caminho relativo a ESTE arquivo (`import.meta.url`) e não ao
  // cwd: a suíte é chamada de scripts/testes.mjs, e amarrar ao cwd é como um
  // teste passa a mentir quando alguém muda o comando.
  const fonte = readFileSync(FONTE_ROTA, "utf8");
  assert.ok(
    !fonte.includes("media_publish"),
    "a rota de diagnóstico não pode conter media_publish em caminho nenhum"
  );
});

test("A ROTA NÃO PUBLICA: nem a lib pura nomeia media_publish", () => {
  const fonte = readFileSync(new URL("./diag-container.ts", import.meta.url), "utf8");
  assert.ok(!fonte.includes("media_publish"));
});

// ---------------------------------------------------------------------------
// Caminho da cópia — o coração do isolamento
// ---------------------------------------------------------------------------

test("a cópia de A nasce em caminho NOVO, com carimbo, sob diag/", () => {
  const c = carimbo(Date.UTC(2026, 7, 11, 18, 30, 0, 0));
  const caminho = caminhoCopiaA(c);
  assert.ok(caminho.startsWith(`${PREFIXO_DIAG}/`), "precisa ficar sob diag/");
  assert.ok(caminho.endsWith("-A.mp4"));
  // E, sobretudo: NÃO pode ser a URL original de A. É esse o confundidor.
  assert.notEqual(caminho, VIDEO_A_ORIGEM);
  assert.ok(!caminho.includes(VIDEO_A_ORIGEM));
});

test("o carimbo não leva `:` nem `.` — Storage trata mal em nome de objeto", () => {
  const c = carimbo(Date.UTC(2026, 7, 11, 18, 30, 45, 123));
  assert.ok(!c.includes(":"), c);
  // O `.mp4` do caminho é acrescentado depois; o carimbo em si é limpo.
  assert.ok(!c.includes("."), c);
});

test("duas rodadas em instantes diferentes geram URLs diferentes", () => {
  // Se duas rodadas colidissem no nome, a segunda leria o container da primeira
  // e o teste voltaria a medir dedupe achando que mede transcode.
  const a = caminhoCopiaA(carimbo(Date.UTC(2026, 7, 11, 18, 30, 0)));
  const b = caminhoCopiaA(carimbo(Date.UTC(2026, 7, 11, 18, 31, 0)));
  assert.notEqual(a, b);
});

test("os tamanhos medidos estão no código, e A é o pesado", () => {
  // 13.848.270 é o número que a própria OS cita. Deixá-lo só na conversa é
  // como uma perícia vira lembrança.
  assert.equal(BYTES_A, 13_848_270);
  assert.equal(BYTES_B, 3_423_840);
  assert.ok(BYTES_A > BYTES_B);
});

test("bytesConferem marca divergência sem opinar sobre abortar", () => {
  assert.equal(bytesConferem(BYTES_A, BYTES_A), true);
  assert.equal(bytesConferem(BYTES_A - 1, BYTES_A), false);
});

test("A e B são vídeos diferentes, e o bucket é o de produção", () => {
  assert.notEqual(VIDEO_A_ORIGEM, VIDEO_B);
  // Bucket igual ao de produção é deliberado: cabeçalho e host idênticos aos
  // de um reel de verdade. Trocar o bucket introduziria a variável que o item 2
  // acabou de exonerar.
  assert.equal(BUCKET_DIAG, "farol-videos");
});

// ---------------------------------------------------------------------------
// Corpo do container
// ---------------------------------------------------------------------------

test("o corpo do container é REELS, não vai ao feed e leva a URL pedida", () => {
  const c = corpoContainerDiag("https://exemplo/x.mp4");
  assert.equal(c.media_type, "REELS");
  assert.equal(c.video_url, "https://exemplo/x.mp4");
  assert.equal(c.share_to_feed, false);
  assert.match(c.caption, /NAO PUBLICAR/);
});

test("o corpo não carrega nenhuma chave de publicação", () => {
  const c = corpoContainerDiag("https://exemplo/x.mp4") as Record<string, unknown>;
  for (const chave of Object.keys(c)) {
    assert.ok(!/publish/i.test(chave), `chave suspeita: ${chave}`);
  }
});

// ---------------------------------------------------------------------------
// Estado de um lado
// ---------------------------------------------------------------------------

test("FINISHED e PUBLISHED são `pronto`, em qualquer idade", () => {
  assert.equal(estadoLado("FINISHED", 0), "pronto");
  assert.equal(estadoLado("PUBLISHED", 99 * TRAVADO_MS), "pronto");
  // Caixa e espaço vindos da Graph não podem mudar o veredito.
  assert.equal(estadoLado(" finished ", 0), "pronto");
});

test("ERROR e EXPIRED são `recusado` — resposta, não espera", () => {
  assert.equal(estadoLado("ERROR", 0), "recusado");
  assert.equal(estadoLado("EXPIRED", 0), "recusado");
});

test("IN_PROGRESS vira `travado` só depois dos 15 min", () => {
  assert.equal(estadoLado("IN_PROGRESS", TRAVADO_MS - 1), "aguardando");
  assert.equal(estadoLado("IN_PROGRESS", TRAVADO_MS), "travado");
});

test("code ausente é espera, nunca recusa", () => {
  // A Meta às vezes devolve 200 sem status_code. Ler isso como recusa
  // condenaria um container que não disse nada — o defeito oposto do que este
  // diagnóstico procura.
  assert.equal(estadoLado(null, 0), "aguardando");
  assert.equal(estadoLado(null, 99 * TRAVADO_MS), "travado");
  assert.equal(estadoLado("DESCONHECIDO", 0), "aguardando");
});

test("idade ilegível nunca vira travado", () => {
  assert.equal(estadoLado("IN_PROGRESS", Number.NaN), "aguardando");
});

// ---------------------------------------------------------------------------
// Dedupe — o modo de falha conhecido do próprio experimento
// ---------------------------------------------------------------------------

test("dedupe: mesmo id nos dois lados é detectado", () => {
  assert.equal(dedupeDetectada("178", "178"), true);
  assert.equal(dedupeDetectada("178", "179"), false);
});

test("dedupe: id ausente NÃO conta como dedupe", () => {
  // Dois nulos são iguais, e ler isso como dedupe trocaria "não consegui criar
  // container" por "a Meta deduplicou" — dois problemas bem diferentes.
  assert.equal(dedupeDetectada(null, null), false);
  assert.equal(dedupeDetectada(null, "179"), false);
});

test("dedupe cala TODA conclusão, mesmo com os dois FINISHED", () => {
  const r = lerAB({
    idA: "178",
    idB: "178",
    codeA: "FINISHED",
    codeB: "FINISHED",
    idadeMs: 99 * TRAVADO_MS,
  });
  assert.equal(r.veredito, "dedupe");
  assert.equal(r.conclusivo, false);
  // Sem esta precedência, a leitura seria "arquivo exonerado" — uma conclusão
  // forte tirada de UM container lido duas vezes.
  assert.notEqual(r.veredito, "arquivo_exonerado");
});

// ---------------------------------------------------------------------------
// A árvore
// ---------------------------------------------------------------------------

const base = { idA: "178", idB: "179" };

test("antes dos 15 min a leitura é `aguardando`, e não conclui", () => {
  const r = lerAB({ ...base, codeA: "FINISHED", codeB: "IN_PROGRESS", idadeMs: 60_000 });
  assert.equal(r.veredito, "aguardando");
  assert.equal(r.conclusivo, false);
  assert.match(r.proximo, /15 min/);
});

test("A termina e B trava ⟹ o arquivo é o discriminador", () => {
  const r = lerAB({
    ...base,
    codeA: "FINISHED",
    codeB: "IN_PROGRESS",
    idadeMs: TRAVADO_MS,
  });
  assert.equal(r.veredito, "arquivo_discriminador");
  assert.equal(r.conclusivo, true);
  // O próximo passo NÃO pode ser "aplicar bitrate hoje": foi medido que o
  // parâmetro não existe. Se alguém reescrever a árvore sem ler a medição,
  // este assert cai.
  assert.match(r.proximo, /ticket na HeyGen/);
  assert.match(r.proximo, /NÃO tem parâmetro/);
});

test("A termina e B é RECUSADO também conta como discriminador", () => {
  // Recusa explícita de B é ainda mais forte que travamento: a Meta olhou e
  // disse não.
  const r = lerAB({ ...base, codeA: "FINISHED", codeB: "ERROR", idadeMs: TRAVADO_MS });
  assert.equal(r.veredito, "arquivo_discriminador");
});

test("os dois terminam ⟹ arquivo exonerado, volta o upload_type", () => {
  const r = lerAB({ ...base, codeA: "FINISHED", codeB: "FINISHED", idadeMs: TRAVADO_MS });
  assert.equal(r.veredito, "arquivo_exonerado");
  assert.equal(r.conclusivo, true);
  assert.match(r.proximo, /upload_type/);
});

test("os dois travam ⟹ o ticket muda de endereço, vai para a Meta", () => {
  const r = lerAB({
    ...base,
    codeA: "IN_PROGRESS",
    codeB: "IN_PROGRESS",
    idadeMs: TRAVADO_MS,
  });
  assert.equal(r.veredito, "meta");
  assert.equal(r.conclusivo, true);
  assert.match(r.proximo, /META/);
});

test("INVERTIDO é veredito nomeado, e NÃO é conclusivo", () => {
  // O resultado que contraria a hipótese é o mais valioso da mesa. Cair no
  // `else` de "os dois travam" seria apagá-lo.
  const r = lerAB({
    ...base,
    codeA: "IN_PROGRESS",
    codeB: "FINISHED",
    idadeMs: TRAVADO_MS,
  });
  assert.equal(r.veredito, "invertido");
  assert.equal(r.conclusivo, false);
  assert.match(r.proximo, /Repetir a rodada/);
});

test("a frase do discriminador nomeia os dois bitrates medidos", () => {
  // O ticket da HeyGen vai ser escrito a partir desta frase; número de cabeça
  // é como uma tabela de perícia vira ficção.
  const r = lerAB({
    ...base,
    codeA: "FINISHED",
    codeB: "IN_PROGRESS",
    idadeMs: TRAVADO_MS,
  });
  assert.match(r.frase, new RegExp(String(BITRATE_A_KBPS)));
  assert.match(r.frase, new RegExp(String(BITRATE_B_KBPS)));
  assert.ok(BITRATE_A_KBPS > BITRATE_B_KBPS);
});

// ---------------------------------------------------------------------------
// As duas medições registradas
// ---------------------------------------------------------------------------

test("a nota do resumable está escrita e diz que ele NÃO salva", () => {
  assert.match(NOTA_RESUMABLE, /NÃO salva/);
  assert.match(NOTA_RESUMABLE, /mesmos bytes/);
});

test("a medição da HeyGen registra que não há parâmetro de bitrate", () => {
  assert.match(HEYGEN_SEM_BITRATE, /Não existe/);
  assert.match(HEYGEN_SEM_BITRATE, /1080p/);
  assert.match(HEYGEN_SEM_BITRATE, /4k/);
});
