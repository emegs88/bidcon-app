// ============================================================================
// diag-container.ts — DIAG-CONTAINER-01 · o A/B que separa ARQUIVO de META
// AUTORIZADO: Emerson Gomes dos Santos — 11/08/2026:
//   "o A/B vai para o servidor (IG_ACCESS_TOKEN e IG_USER_ID são Sensitive sem
//    Reveal; ninguém cola segredo em arquivo). Rota POST
//    /api/admin/farol/diag-container, mesmo guard do inventário de vozes:
//    1. PREPARO server-side: copiar o mp4 de 07/08 (13.848.270 bytes) para
//       caminho NOVO no bucket (diag/<ts>-A.mp4). Motivo: teu próprio
//       comentário prova que a Meta deduplica container por URL — URL nova,
//       bytes idênticos, senão A voltando FINISHED é reconhecimento, não
//       transcode.
//    2. Criar DOIS containers REELS via chamarGraph, SEM [o endpoint de
//       publicação — nome elidido, com colchete à vista, porque o teste varre
//       este fonte cru e a citação derrubaria o próprio portão que ela cita]
//       em nenhum caminho. 3. GET ?conferir devolve status_code +
//       copyright_check_status literais dos dois. 4. Container órfão expira
//       sozinho em 24h — nada a limpar."
// ----------------------------------------------------------------------------
// O QUE MORA AQUI: vocabulário e DECISÃO. Nada de rede, nada de banco, nada de
// relógio próprio (`agora` e idade sempre entram por parâmetro). A rota é casco
// — `scripts/testes.mjs` varre `lib/`, e é por isso que a árvore de leitura do
// Emerson está escrita aqui e não num comentário da rota: uma árvore de decisão
// que ninguém consegue exercitar é uma opinião com indentação.
//
// ----------------------------------------------------------------------------
// A PERGUNTA QUE ESTE ARQUIVO EXISTE PARA RESPONDER
// ----------------------------------------------------------------------------
// Quatro reels renderizados pelo mesmo código, com o mesmo pedido. UM publicou.
// A perícia dos quatro mp4 fechou TODAS as portas estruturais:
//
//   |       | bytes      | faststart | dur    | resolução | fps | perfil/nível | GOP   | áudio            | BITRATE VÍDEO | resultado |
//   | 07/08 | 13.848.270 | sim       | 31,49s | 1080x1920 | 25  | High 4.0     | 10,0s | 48kHz 2ch 189kbps| 3325 kbps     | PUBLICOU  |
//   | 08/08 |  3.346.453 | sim       | 32,81s | 1080x1920 | 25  | High 4.0     | 10,0s | 48kHz 2ch 189kbps|  622 kbps     | travou    |
//   | 09/08 |  2.749.052 | sim       | 23,85s | 1080x1920 | 25  | High 4.0     | 10,0s | 48kHz 2ch 189kbps|  728 kbps     | travou    |
//   | 11/08 |  3.423.840 | sim       | 28,01s | 1080x1920 | 25  | High 4.0     | 10,0s | 48kHz 2ch 189kbps|  784 kbps     | travou    |
//
// Sobrou UMA variável separando o sucesso dos fracassos: o bitrate de vídeo.
// E a queda não veio do nosso lado — `resolution: "1080p"` está no código desde
// 4e04f90 (07/08 12:38 UTC, ANTES do render que publicou), `avatar_tipo` é
// `photo_avatar` nos quatro, e `formula`/`persona` são null tanto no 07/08
// (sucesso) quanto no 08/08 (primeiro fracasso). Pedido idêntico, saída 4x
// diferente ⟹ o encoder da HeyGen mudou entre 07/08 14:30 e 08/08 14:48 UTC.
//
// O QUE ESTE A/B AINDA NÃO SABE, e é honesto dizer: n=1 de sucesso, e não há
// mecanismo conhecido ligando bitrate baixo a IN_PROGRESS eterno — 3,4 MB em
// 1080x1920 está folgadamente dentro dos limites da Meta. O bitrate pode ser
// MARCADOR e não CAUSA. É exatamente por isso que se mede em vez de supor.
// ============================================================================

/**
 * Prefixo dos objetos de diagnóstico. Pasta própria dentro do mesmo bucket
 * (`farol-videos`) por dois motivos que não são estética:
 *
 *  1. Os vídeos de produção nascem com nome `<video_id>.mp4` na raiz. Um objeto
 *     de teste na raiz seria indistinguível de um reel de verdade em qualquer
 *     inspeção futura do bucket.
 *  2. Medido antes de escrever: `grep -rn 'farol-videos|BUCKET_VIDEOS' app/ lib/
 *     scripts/` não encontra NENHUM `.list()` — nada no produto enumera o
 *     bucket, só `createBucket`, `upload` e `getPublicUrl` por caminho
 *     explícito. Logo o artefato é inerte: não entra em fila, não vira reel,
 *     não aparece em tela. Se um dia alguém escrever um `.list()`, o prefixo
 *     `diag/` é o que torna esses objetos filtráveis numa linha.
 */
export const PREFIXO_DIAG = "diag";

/** O bucket é o MESMO da produção — de propósito: cabeçalho igual, host igual. */
export const BUCKET_DIAG = "farol-videos";

/**
 * A = o mp4 de 07/08, o ÚNICO que publicou. 13.848.270 bytes, 3325 kbps.
 * É a origem dos bytes; a cópia nasce com URL nova (ver `caminhoCopiaA`).
 */
export const VIDEO_A_ORIGEM = "df4b87775c8943f5b06293831dc06e4f.mp4";

/**
 * B = o mp4 de 11/08, o último a travar. 3.423.840 bytes, 784 kbps.
 * Entra pela URL ORIGINAL, e isso é deliberado: B já foi recusado nessa URL,
 * então se a Meta deduplicar, é em B que a dedupe aparece — e o detector
 * (`dedupeDetectada`) grita. Copiar B também apagaria o único caso em que a
 * dedupe seria visível.
 */
export const VIDEO_B = "57449582ab5d44aaa199300af86749df.mp4";

/** Bitrates medidos, para a tabela do ticket não ser redigitada de cabeça. */
export const BITRATE_A_KBPS = 3325;
export const BITRATE_B_KBPS = 784;

/**
 * Tamanhos medidos, em bytes. A OS nomeia o de A ("o mp4 de 07/08 —
 * 13.848.270 bytes") e é bom que o número esteja no código: se um dia o objeto
 * no bucket for outro, o teste não vira mentira em silêncio — a resposta traz o
 * tamanho lido e `bytesConferem` diz na cara que divergiu.
 */
export const BYTES_A = 13_848_270;
export const BYTES_B = 3_423_840;

/**
 * Conferência de integridade da origem. NÃO derruba a rodada — só marca. Um
 * A/B com o arquivo errado é pior do que um A/B que não rodou, mas quem decide
 * abortar é quem lê, não o código: pode ser que o objeto tenha sido
 * legitimamente re-hospedado e o operador saiba disso.
 */
export function bytesConferem(lidos: number, esperados: number): boolean {
  return lidos === esperados;
}

/**
 * Caminho da CÓPIA de A. Carimbo de tempo no nome ⟹ URL nova a cada rodada.
 *
 * ISTO É O CORAÇÃO DO TESTE, não um detalhe de nomenclatura. O nosso próprio
 * código registra, em `reel-publicar/route.ts`, que a Meta devolvia o MESMO
 * container para a mesma URL ("o reset girava em falso a cada 10 min"). Se o
 * A/B usasse a URL original de A, um FINISHED rápido seria RECONHECIMENTO de
 * um container antigo — não transcode novo. O teste responderia com convicção
 * uma pergunta que não foi feita.
 *
 * Bytes idênticos, URL nova: é a única combinação que isola o arquivo.
 */
export function caminhoCopiaA(carimbo: string): string {
  return `${PREFIXO_DIAG}/${carimbo}-A.mp4`;
}

/**
 * Carimbo ISO sem os caracteres que o Storage trata mal em nome de objeto
 * (`:` e `.`). Determinístico a partir do instante que entra — sem `Date.now()`
 * aqui dentro, para o teste poder fixar o relógio.
 */
export function carimbo(agora: number): string {
  return new Date(agora).toISOString().replace(/[:.]/g, "-");
}

/**
 * Legenda dos containers de diagnóstico.
 *
 * ELA NUNCA SERÁ VISTA POR NINGUÉM — este teste não publica. Existe assim
 * mesmo, escrita em português claro, para o caso de alguém encontrar um
 * container órfão no Business Suite e precisar saber, sem perguntar a ninguém,
 * o que é aquilo e por que não deve ser publicado à mão.
 */
export const LEGENDA_DIAG =
  "DIAGNOSTICO TECNICO - NAO PUBLICAR. Container criado por " +
  "/api/admin/farol/diag-container para medir transcode. Expira sozinho em 24h.";

/**
 * O corpo do container REELS. Uma função só, usada pelos DOIS lados do A/B —
 * se A e B fossem montados em dois lugares, a primeira divergência silenciosa
 * entre eles arruinaria o experimento sem avisar.
 *
 * `share_to_feed: false` porque nem o feed deve ser tocado. E o que NÃO está
 * aqui é tão importante quanto o que está: nenhuma chave deste objeto leva a
 * publicação.
 *
 * O ENDPOINT QUE PUBLICA NÃO É NOMEADO NESTE ARQUIVO, e a omissão é
 * deliberada. O teste em diag-container.test.ts varre o FONTE CRU — comentário
 * incluído — e falha se o nome aparecer. Varrer o cru é a versão forte do
 * portão: não há parser a enganar e não há falso negativo possível. O preço é
 * este, e eu prefiro pagá-lo: a prosa não pronuncia a palavra. Ela mora num
 * lugar só, o arquivo que a proíbe.
 */
export function corpoContainerDiag(videoUrl: string): {
  media_type: "REELS";
  video_url: string;
  caption: string;
  share_to_feed: false;
} {
  return {
    media_type: "REELS",
    video_url: videoUrl,
    caption: LEGENDA_DIAG,
    share_to_feed: false,
  };
}

// ---------------------------------------------------------------------------
// A ÁRVORE DE LEITURA
// ---------------------------------------------------------------------------

/**
 * Códigos que significam "a Meta terminou de transcodificar".
 *
 * `PUBLISHED` entra por completude do vocabulário da Graph; este teste nunca
 * publica, então na prática só `FINISHED` aparece. Deixá-lo de fora criaria um
 * buraco calado se a Meta um dia responder assim.
 */
export const CODES_PRONTOS: readonly string[] = ["FINISHED", "PUBLISHED"];

/** Códigos em que a Meta RECUSOU — resposta, não espera. */
export const CODES_RECUSA: readonly string[] = ["ERROR", "EXPIRED"];

/**
 * Limiar para chamar um container de "travado". É o MESMO `DERROTA_MS` de
 * lib/farol/container.ts (15 min), e a igualdade é o ponto: 15 min é
 * exatamente o instante em que o pipeline de verdade declara derrota. Um B
 * ainda IN_PROGRESS aos 15 min neste teste é, literalmente, a falha que se
 * está investigando — não uma aproximação dela.
 *
 * Repetido como constante própria em vez de importado porque um dia alguém vai
 * querer afrouxar a derrota da produção; afrouxar junto o limiar do diagnóstico
 * mudaria em silêncio o significado da medição. São o mesmo número por acordo,
 * não por acoplamento.
 */
export const TRAVADO_MS = 15 * 60 * 1000;

export type EstadoLado = "pronto" | "recusado" | "travado" | "aguardando";

/**
 * Estado de UM lado. `code` ausente/desconhecido não é recusa nem pronto: é
 * espera, e espera com relógio.
 */
export function estadoLado(code: string | null, idadeMs: number): EstadoLado {
  const c = (code ?? "").trim().toUpperCase();
  if (CODES_PRONTOS.includes(c)) return "pronto";
  if (CODES_RECUSA.includes(c)) return "recusado";
  if (Number.isFinite(idadeMs) && idadeMs >= TRAVADO_MS) return "travado";
  return "aguardando";
}

/**
 * DETECTOR DE DEDUPE. Se a Meta devolver o mesmo container para as duas URLs,
 * não existe A/B nenhum — existe uma leitura repetida, e qualquer conclusão
 * tirada dela seria inventada.
 *
 * Isto não é paranoia: é o defeito que já aconteceu nesta casa e está escrito
 * no código de produção. Um experimento que não sabe detectar o próprio modo de
 * falha conhecido é um gerador de convicção.
 */
export function dedupeDetectada(idA: string | null, idB: string | null): boolean {
  return !!idA && !!idB && idA === idB;
}

export type Veredito =
  | "dedupe"
  | "aguardando"
  | "arquivo_discriminador"
  | "arquivo_exonerado"
  | "meta"
  | "invertido";

export type Leitura = {
  veredito: Veredito;
  /** Frase curta, para o painel. */
  frase: string;
  /** O que fazer a seguir — a árvore do Emerson, por extenso. */
  proximo: string;
  /** `false` enquanto a medição não decide nada. */
  conclusivo: boolean;
};

/**
 * A ÁRVORE, exatamente como o Emerson a escreveu, com dois acréscimos meus que
 * são sobre não concluir demais:
 *
 *  · DEDUPE VEM PRIMEIRO e cala todo o resto. Sem isso, dois FINISHED
 *    idênticos leriam como "arquivo exonerado" quando na verdade só houve um
 *    container.
 *  · "INVERTIDO" (A trava e B termina) existe como veredito NOMEADO. É o
 *    resultado que contraria a hipótese inteira, e resultado que contraria a
 *    hipótese é o mais valioso da mesa — cair no `else` de "os dois travam"
 *    seria apagá-lo.
 */
export function lerAB(p: {
  idA: string | null;
  idB: string | null;
  codeA: string | null;
  codeB: string | null;
  idadeMs: number;
}): Leitura {
  if (dedupeDetectada(p.idA, p.idB)) {
    return {
      veredito: "dedupe",
      conclusivo: false,
      frase:
        "A Meta devolveu O MESMO container para as duas URLs — não houve A/B.",
      proximo:
        "Descartar esta rodada e repetir com carimbo novo (URL nova dos dois lados). " +
        "Nenhuma conclusão pode ser tirada destes números.",
    };
  }

  const a = estadoLado(p.codeA, p.idadeMs);
  const b = estadoLado(p.codeB, p.idadeMs);

  if (a === "aguardando" || b === "aguardando") {
    return {
      veredito: "aguardando",
      conclusivo: false,
      frase: `Ainda em curso (A=${a}, B=${b}). O relógio de 15 min não fechou.`,
      proximo:
        "Reler mais tarde. Ler antes dos 15 min não decide nada: as derrotas " +
        "históricas foram declaradas aos 20 e aos 40 min.",
    };
  }

  const aOk = a === "pronto";
  const bOk = b === "pronto";

  if (aOk && !bOk) {
    return {
      veredito: "arquivo_discriminador",
      conclusivo: true,
      frase:
        `A (${BITRATE_A_KBPS} kbps) terminou e B (${BITRATE_B_KBPS} kbps) não. ` +
        "O discriminador é o ARQUIVO.",
      proximo:
        "A API da HeyGen JÁ FOI MEDIDA e NÃO tem parâmetro de qualidade/bitrate " +
        "(ver HEYGEN_SEM_BITRATE). Logo não há o que aplicar hoje: o caminho é " +
        "ticket na HeyGen com a tabela das quatro medições.",
    };
  }

  if (aOk && bOk) {
    return {
      veredito: "arquivo_exonerado",
      conclusivo: true,
      frase: "Os dois terminaram. O arquivo está exonerado.",
      proximo:
        "Volta o curl do `upload_type` na query string — a hipótese passa a ser " +
        "o caminho de upload, não o conteúdo.",
    };
  }

  if (!aOk && !bOk) {
    return {
      veredito: "meta",
      conclusivo: true,
      frase: `Os dois travaram (A=${a}, B=${b}). Nem o arquivo bom passa.`,
      proximo:
        "O endereço do ticket muda para a META (conta/permissão). O arquivo " +
        "deixa de ser suspeito: o que publicou em 07/08 não publica mais.",
    };
  }

  return {
    veredito: "invertido",
    conclusivo: false,
    frase:
      `INVERTIDO: B (${BITRATE_B_KBPS} kbps) terminou e A (${BITRATE_A_KBPS} kbps) não. ` +
      "É o contrário da hipótese.",
    proximo:
      "Não concluir. Repetir a rodada antes de qualquer ticket — um resultado " +
      "invertido derruba a leitura do bitrate e pode indicar ruído de fila da Meta.",
  };
}

// ---------------------------------------------------------------------------
// DUAS COISAS MEDIDAS QUE MORAM AQUI PARA NINGUÉM REMEDIR
// ---------------------------------------------------------------------------

/**
 * MEDIDO em 11/08/2026 em developers.heygen.com/reference/create-video:
 * `POST /v3/videos` aceita `resolution` (4k | 1080p | 720p), `aspect_ratio`,
 * `output_format` (mp4 | webm) e `fit` (cover | contain). E MAIS NADA sobre
 * codificação — NÃO existe parâmetro de bitrate, de qualidade nem de perfil.
 *
 * POR QUE ISTO ESTÁ ESCRITO NO CÓDIGO: a OS previa o ramo "existindo, aplicar
 * HOJE (o render de amanhã 11h30 já sai alto e quebra a seca)". Esse ramo não
 * tem onde pousar. Já mandamos `1080p`; a única alavanca para cima é `4k`, que
 * muda RESOLUÇÃO (acima do que o próprio Instagram recomenda para reels) e
 * custa mais crédito — não é botão de bitrate, é outro produto. Sem esta nota,
 * a próxima pessoa a ler a árvore gasta uma tarde remedindo a mesma doc.
 */
export const HEYGEN_SEM_BITRATE =
  "MEDIDO 11/08/2026: POST /v3/videos aceita resolution (4k|1080p|720p), " +
  "aspect_ratio, output_format (mp4|webm) e fit (cover|contain). Não existe " +
  "parâmetro de bitrate/qualidade. Já enviamos 1080p; a única alavanca para " +
  "cima é 4k, que muda resolução e custo, não a taxa de bits.";

/**
 * A NOTA DO EMERSON, que ele pediu para valer no código:
 * "se o arquivo for o problema, o resumable NÃO salva — empurra os mesmos bytes."
 *
 * E o argumento que fecha a nota: o resumable só ajudaria se o FETCH da Meta
 * fosse o problema, e o item 2 já exonerou o fetch — a URL hospedada responde
 * `HTTP/2 200`, `content-type: video/mp4`, `accept-ranges: bytes`,
 * `cache-control: public, max-age=3600` e `206` correto em Range. Trocar para
 * resumable troca quem carrega o balde, não o que tem dentro dele.
 */
export const NOTA_RESUMABLE =
  "Se o arquivo for o problema, o resumable NÃO salva — empurra os mesmos " +
  "bytes. Ele só ajudaria se o fetch da Meta fosse o problema, e o fetch já " +
  "foi exonerado pelos cabeçalhos (200, video/mp4, accept-ranges, 206 em Range).";
