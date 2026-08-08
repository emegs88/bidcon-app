// ============================================================================
// YT-COMENTA-01 · lib — listar threads do canal e responder comentário
// AUTORIZADO: Emerson Gomes dos Santos — OS "YT-COMENTA-01", 07/08/2026.
// ----------------------------------------------------------------------------
// TUDO AQUI FOI MEDIDO NA DOC (developers.google.com/youtube/v3), e a medição
// DERRUBOU QUATRO HIPÓTESES da OS. As quatro estão anotadas no ponto exato do
// código onde importam, porque cada uma delas, se seguida como escrita, produz
// um bug SILENCIOSO — nenhuma delas dá erro, todas dão comportamento errado.
//
//   (1) `textOriginal` NÃO VEM em comentário de terceiro. A doc diz que o campo
//       "is only returned if the authenticated user is the comment's author".
//       Filtrar link nele leria `undefined`, e TODO spam com link passaria.
//       → usamos `textDisplay`. Ver `temLink()`.
//
//   (2) `authorChannelId` é OBJETO `{value: string}`, não string. A comparação
//       `authorChannelId !== CANAL` seria objeto ≠ string, SEMPRE verdadeira, e
//       o bot responderia as próprias respostas em laço, em público.
//       → comparamos `.value`. Ver `ehNosso()`.
//
//   (3) `parentId` do `comments.insert` quer um ID DE COMENTÁRIO, não de thread.
//       A doc diz "Creates a reply to an existing comment" e nunca afirma que
//       o id do thread é igual ao do comentário de topo.
//       → usamos `snippet.topLevelComment.id`. Ver `responder()`.
//
//   (4) `snippet.canReply` existe no thread e custa ZERO. É a única forma de
//       saber ANTES de gastar 50 unidades que a resposta seria recusada.
//
// ----------------------------------------------------------------------------
// COTA — a razão de esta lib devolver custo junto com dado.
// Medido em determine_quota_cost: a Data API v3 dá 10.000 unidades/dia para o
// PROJETO INTEIRO, somando todos os endpoints. `commentThreads.list` custa 1.
// `comments.insert` custa 50. E o `videos.insert` do YOUTUBE-01 divide o mesmo
// balde. Por isso `comments.insert` nunca é chamado por esta lib sem que a rota
// tenha conferido os dois tetos antes — ver app/api/farol/yt-comenta/route.ts.
// ============================================================================
import { accessToken, type Resultado } from "@/lib/youtube/upload";

const URL_THREADS = "https://www.googleapis.com/youtube/v3/commentThreads";
const URL_COMMENTS = "https://www.googleapis.com/youtube/v3/comments";

/**
 * Canal Bidcon. Fixo, como o REDIRECT_URI do upload.ts e pela mesma razão: é
 * identidade, não configuração. Um canal errado aqui não dá erro — responde
 * comentário de outra pessoa com a voz da Bidcon.
 */
export const CANAL_ID = "UCEl1NDdx_ATrV-10xL6Zsvg";

/** Custos medidos hoje. Exportados porque a rota faz aritmética de orçamento. */
export const CUSTO_LIST = 1;
export const CUSTO_INSERT = 50;

const TIMEOUT_MS = 15_000;

/** Nunca vaza corpo de exceção com header dentro. */
function curto(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.length > 200 ? `${m.slice(0, 200)}…` : m;
}

/**
 * Extrai `error.message` do Google. NUNCA inclui o request nem o header — o
 * access_token viaja no Authorization e um log preguiçoso o publicaria.
 */
async function erroGoogle(resp: Response): Promise<string> {
  let detalhe = "";
  try {
    const j = (await resp.json()) as { error?: { message?: string } };
    detalhe = j?.error?.message ?? "";
  } catch {
    /* corpo não-JSON: o status já diz o suficiente */
  }
  return detalhe ? `${resp.status} ${detalhe}` : `${resp.status}`;
}

async function comPrazo(url: string, init: RequestInit): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// Formato que consumimos do `commentThreads.list`. Declarado à mão, e só com o
// que usamos: tipar o retorno inteiro do Google seria copiar uma doc que muda.
// Tudo opcional de propósito — campo ausente é o caso NORMAL aqui (ver (1)).
// ---------------------------------------------------------------------------
type ThreadApi = {
  id?: string;
  snippet?: {
    videoId?: string;
    canReply?: boolean;
    topLevelComment?: {
      id?: string;
      snippet?: {
        textDisplay?: string;
        textOriginal?: string;
        authorChannelId?: { value?: string };
        authorDisplayName?: string;
      };
    };
  };
};

/** O que a rota enxerga: já achatado, já com o id certo para o `parentId`. */
export type Comentario = {
  /** ID DO COMENTÁRIO de topo — é este que vira `parentId`. Ver (3). */
  commentId: string;
  videoId: string | null;
  /** channelId de quem comentou. Nome de exibição muda; id não. */
  autor: string | null;
  texto: string;
  canReply: boolean;
};

/**
 * Threads mais recentes do canal. Custa CUSTO_LIST (1) por chamada.
 *
 * `allThreadsRelatedToChannelId` traz comentários de TODOS os vídeos do canal
 * numa requisição só — a alternativa seria um `videoId` por vídeo, e cada vídeo
 * custaria 1. `order=time` é o default medido, mas vai explícito: default de
 * terceiro é decisão de terceiro.
 *
 * NUNCA LANÇA.
 */
export async function listarThreads(
  max = 50
): Promise<Resultado<{ comentarios: Comentario[] }>> {
  const cred = await accessToken();
  if (!cred.ok) return cred;

  const q = new URLSearchParams({
    part: "snippet",
    allThreadsRelatedToChannelId: CANAL_ID,
    order: "time",
    maxResults: String(Math.min(Math.max(max, 1), 100)),
    // `html` deixaria `&amp;` e `<a href=...>` no texto — e o filtro de link
    // procura "http", que a tag <a> carrega mesmo quando o humano só digitou
    // um domínio. `plainText` é o texto como o leitor o vê.
    textFormat: "plainText",
  });

  try {
    const resp = await comPrazo(`${URL_THREADS}?${q.toString()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${cred.token}` },
    });
    if (!resp.ok) return { ok: false, erro: `list: ${await erroGoogle(resp)}` };

    const data = (await resp.json()) as { items?: ThreadApi[] };
    const comentarios: Comentario[] = [];

    for (const t of data.items ?? []) {
      const topo = t.snippet?.topLevelComment;
      const commentId = topo?.id;
      // Sem id de comentário não há `parentId` possível — a linha é inútil.
      if (!commentId) continue;

      comentarios.push({
        commentId,
        videoId: t.snippet?.videoId ?? null,
        // (2) `.value`, não o objeto.
        autor: topo?.snippet?.authorChannelId?.value ?? null,
        // (1) `textDisplay`, não `textOriginal`.
        texto: topo?.snippet?.textDisplay ?? "",
        // (4) ausente ⇒ tratamos como false: na dúvida, não gastamos 50.
        canReply: t.snippet?.canReply === true,
      });
    }

    return { ok: true, comentarios };
  } catch (e) {
    return { ok: false, erro: `list: ${curto(e)}` };
  }
}

/** É comentário do próprio canal? Ver (2) — a comparação é em `.value`. */
export function ehNosso(c: Comentario): boolean {
  return c.autor === CANAL_ID;
}

/**
 * Tem link? A OS mandou não engajar com spam. Procuramos o esquema, não o
 * ponto: "bidcon.com.br" escrito por um humano no meio da frase é conversa
 * legítima; "http://..." é isca. `textFormat=plainText` garante que o "http"
 * encontrado aqui foi digitado, e não injetado por uma tag <a> do render.
 */
export function temLink(c: Comentario): boolean {
  return /https?:\/\//i.test(c.texto);
}

/**
 * Publica a resposta. Custa CUSTO_INSERT (50) — a rota já conferiu orçamento.
 *
 * (3) `parentId` recebe o ID DO COMENTÁRIO de topo (`Comentario.commentId`,
 * que veio de `snippet.topLevelComment.id`), nunca o id do thread.
 *
 * NUNCA LANÇA.
 */
export async function responder(
  commentId: string,
  texto: string
): Promise<Resultado<{ respostaId: string }>> {
  const cred = await accessToken();
  if (!cred.ok) return cred;

  try {
    const resp = await comPrazo(`${URL_COMMENTS}?part=snippet`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cred.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        snippet: { parentId: commentId, textOriginal: texto },
      }),
    });
    if (!resp.ok) return { ok: false, erro: `insert: ${await erroGoogle(resp)}` };

    const data = (await resp.json()) as { id?: string };
    if (!data.id) return { ok: false, erro: "insert: resposta sem id" };
    return { ok: true, respostaId: data.id };
  } catch (e) {
    return { ok: false, erro: `insert: ${curto(e)}` };
  }
}
