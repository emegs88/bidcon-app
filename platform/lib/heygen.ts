// ============================================================================
// lib/heygen.ts — cliente da API do HeyGen (FAROL-REEL-01)
// AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-REEL-01", 06/08/2026.
// ============================================================================
// MEDIÇÃO (Regra nº 1 da OS: "MEDIR a API do HeyGen antes de escrever").
// Feita em 06/08/2026 sobre o índice oficial `https://docs.heygen.com/llms.txt`
// (39.046 bytes, baixado) e sobre as specs OpenAPI que ele aponta, não sobre
// memória nem sobre blog post.
//
// A HIPÓTESE DA OS ESTÁ DESATUALIZADA — e o desvio está declarado aqui:
//
//   OS dizia                             medido hoje
//   ----------------------------------   -------------------------------------
//   POST /v2/video/generate              POST /v3/videos
//   GET  /v1/video_status.get?video_id=  GET  /v3/videos/{video_id}
//   character.type = talking_photo       NÃO EXISTE mais na v3. "Talking photo"
//                                        virou `photo_avatar` e é usada como
//                                        qualquer avatar: um `avatar_id`.
//   header X-Api-Key                     CONFIRMADO (`x-api-key`, no
//                                        securitySchemes do OpenAPI)
//   listagem de talking photos           GET /v3/avatars/looks
//                                        ?avatar_type=photo_avatar
//                                        A doc é literal: "O id do look é o
//                                        avatar_id a passar na criação".
//
// O LEGADO NÃO MORREU: probei os sete endpoints sem chave e TODOS devolvem 401,
// nenhum 404 — /v2/video/generate, /v1/talking_photo.list e /v1/video_status.get
// continuam de pé. Por isso este arquivo fala as DUAS línguas: `HEYGEN_AVATAR_TIPO`
// aceita `photo_avatar`/`avatar` (v3, padrão) e `talking_photo` (v2 legado). O
// cardápio lista as duas superfícies, para que a escolha do ID pelo Emerson não
// fique presa a um caminho que eu escolhi por ele.
//
// O QUE NÃO CONSEGUI MEDIR, e digo em vez de fingir: `HEYGEN_API_KEY` está só na
// Vercel, não no .env.local daqui. Então NÃO vi a conta: não sei o id do
// Porta-voz Bidcon, não sei se a voz "Brazilian Consultant" filtra por
// `language=Portuguese` ou `Portuguese (Brazil)`, e o FORMATO exato da resposta
// das listagens LEGADAS (/v2/avatars, /v1/talking_photo.list) não está no
// OpenAPI atual. Por isso toda leitura de listagem aqui é DEFENSIVA: aceita
// mais de um nome de campo e devolve [] em vez de estourar. É o cardápio em
// produção que vai fechar essa medição.
//
// SEGREDO: a chave nunca entra em log. O que entra é status HTTP e a mensagem
// literal de erro da API — que é o diagnóstico.
// ============================================================================

const BASE = "https://api.heygen.com";

/** Render pode demorar; a CHAMADA que dispara, não. 20s cobre com folga. */
const TIMEOUT_MS = 20_000;

export type TipoAvatar = "photo_avatar" | "avatar" | "talking_photo";

/** `talking_photo` é o único que cai no legado; o resto vai pela v3. */
export function usaLegado(tipo: string | undefined): boolean {
  return (tipo ?? "").toLowerCase() === "talking_photo";
}

export type OpcaoVoz = {
  id: string;
  nome: string;
  genero: string | null;
  idioma: string | null;
  origem: "v3" | "v2";
};

export type OpcaoAvatar = {
  id: string;
  nome: string;
  tipo: string | null;
  origem: "v3" | "v2" | "v1_talking_photo";
  preview: string | null;
};

type Resposta<T> = { ok: true; data: T } | { ok: false; erro: string };

/**
 * GET cru na API do HeyGen. Nunca lança: env ausente, timeout e erro HTTP viram
 * `{ok:false, erro}` nomeado — mesmo contrato de lib/instagram/publicar.ts.
 */
async function get<T = unknown>(caminho: string): Promise<Resposta<T>> {
  const chave = process.env.HEYGEN_API_KEY;
  if (!chave) return { ok: false, erro: "env_ausente(HEYGEN_API_KEY)" };
  return requisitar<T>("GET", caminho, chave, undefined);
}

async function post<T = unknown>(
  caminho: string,
  corpo: Record<string, unknown>
): Promise<Resposta<T>> {
  const chave = process.env.HEYGEN_API_KEY;
  if (!chave) return { ok: false, erro: "env_ausente(HEYGEN_API_KEY)" };
  return requisitar<T>("POST", caminho, chave, corpo);
}

async function requisitar<T>(
  metodo: "GET" | "POST",
  caminho: string,
  chave: string,
  corpo: Record<string, unknown> | undefined
): Promise<Resposta<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${BASE}${caminho}`, {
      method: metodo,
      headers: {
        "content-type": "application/json",
        // Medido no securitySchemes do OpenAPI: apiKey, in: header, x-api-key.
        "x-api-key": chave,
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: controller.signal,
    });
    const data: unknown = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      // A v3 devolve { error: { code, message } }; o legado devolve
      // { code, message } na raiz. Os dois são lidos, e o status HTTP vai junto
      // porque é ele que distingue 401 (chave) de 400 (payload) de 429 (cota).
      const e = data as {
        error?: { code?: string; message?: string };
        message?: string;
      };
      const msg = e?.error?.message ?? e?.message ?? "sem_mensagem";
      const cod = e?.error?.code ? ` code=${e.error.code}` : "";
      return { ok: false, erro: `http_${resp.status}${cod} ${msg}`.slice(0, 500) };
    }
    return { ok: true, data: data as T };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, erro: `timeout_heygen(${TIMEOUT_MS}ms)` };
    }
    return {
      ok: false,
      erro: e instanceof Error ? e.message.slice(0, 500) : "erro_desconhecido",
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Cardápio — leitura defensiva (ver header)
// ---------------------------------------------------------------------------

/** Pega a primeira chave presente. Existe porque v3 e legado divergem nos nomes. */
function primeiro(obj: Record<string, unknown>, ...chaves: string[]): string | null {
  for (const k of chaves) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

function comoLista(bruto: unknown, ...caminhos: string[]): Record<string, unknown>[] {
  const raiz = bruto as Record<string, unknown>;
  if (Array.isArray(raiz?.data)) return raiz.data as Record<string, unknown>[];
  const dados = raiz?.data as Record<string, unknown> | undefined;
  for (const c of caminhos) {
    if (Array.isArray(dados?.[c])) return dados[c] as Record<string, unknown>[];
    if (Array.isArray(raiz?.[c])) return raiz[c] as Record<string, unknown>[];
  }
  return [];
}

/**
 * Vozes. v3: GET /v3/voices?language=&limit= (medido no OpenAPI).
 * O filtro de idioma é passado pelo chamador porque eu NÃO SEI se a conta
 * indexa a "Brazilian Consultant" como "Portuguese" ou "Portuguese (Brazil)" —
 * a rota do cardápio tenta os dois e ainda peneira por substring, em vez de eu
 * chutar um e devolver lista vazia sem explicar.
 */
export async function listarVozes(
  idioma: string,
  limite: number
): Promise<Resposta<OpcaoVoz[]>> {
  const q = new URLSearchParams({ limit: String(limite) });
  if (idioma) q.set("language", idioma);
  const r = await get(`/v3/voices?${q.toString()}`);
  if (!r.ok) return r;
  const vozes = comoLista(r.data, "voices").map((v) => ({
    id: primeiro(v, "id", "voice_id") ?? "",
    nome: primeiro(v, "name", "display_name", "voice_name") ?? "(sem nome)",
    genero: primeiro(v, "gender"),
    idioma: primeiro(v, "language", "language_name"),
    origem: "v3" as const,
  }));
  return { ok: true, data: vozes.filter((v) => v.id) };
}

/**
 * Looks de avatar da v3. `avatar_type=photo_avatar` + `ownership=private` é
 * ONDE o Porta-voz Bidcon mora hoje — a doc diz, literal, que o id do look é o
 * `avatar_id` a passar em POST /v3/videos.
 */
export async function listarLooks(
  tipo: string | null,
  limite: number
): Promise<Resposta<OpcaoAvatar[]>> {
  const q = new URLSearchParams({ limit: String(limite), ownership: "private" });
  if (tipo) q.set("avatar_type", tipo);
  const r = await get(`/v3/avatars/looks?${q.toString()}`);
  if (!r.ok) return r;
  const looks = comoLista(r.data, "looks", "avatars").map((a) => ({
    id: primeiro(a, "id", "avatar_id", "look_id") ?? "",
    nome: primeiro(a, "name", "avatar_name", "look_name") ?? "(sem nome)",
    tipo: primeiro(a, "avatar_type", "type"),
    origem: "v3" as const,
    preview: primeiro(a, "preview_image_url", "preview_url"),
  }));
  return { ok: true, data: looks.filter((a) => a.id) };
}

/**
 * Talking photos do LEGADO. Fora do OpenAPI atual (a v3 não tem esta família),
 * mas o endpoint responde 401 e não 404 — ou seja, existe. Fica no cardápio
 * porque se a conta do Emerson tiver o Porta-voz cadastrado pelo caminho antigo,
 * é AQUI que o ID dele aparece, e um cardápio que esconde o item certo não é
 * cardápio. Falha aqui NÃO derruba a rota: vira um aviso na resposta.
 */
export async function listarTalkingPhotos(): Promise<Resposta<OpcaoAvatar[]>> {
  const r = await get(`/v1/talking_photo.list`);
  if (!r.ok) return r;
  const fotos = comoLista(r.data, "talking_photos").map((t) => ({
    id: primeiro(t, "talking_photo_id", "id") ?? "",
    nome: primeiro(t, "talking_photo_name", "name") ?? "(sem nome)",
    tipo: "talking_photo",
    origem: "v1_talking_photo" as const,
    preview: primeiro(t, "preview_image_url", "image_url"),
  }));
  return { ok: true, data: fotos.filter((a) => a.id) };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export type RenderPedido = {
  roteiro: string;
  avatarId: string;
  voiceId: string;
  tipo: string;
  titulo: string;
};

/**
 * Dispara o render e devolve o video_id. NÃO espera o vídeo ficar pronto —
 * essa é a razão de existir a fase 2 (a OS: "nunca esperar minutos numa
 * invocação").
 *
 * v3 (padrão): POST /v3/videos, corpo discriminado por `type`. 9:16 é pedido
 * por `aspect_ratio`, não por `dimension` — a v3 ancora pelo lado curto, então
 * 1080p + 9:16 = 1080×1920. A OS pedia 720×1280; 1080p é o mesmo enquadramento
 * com mais resolução, e o Instagram recomenda 1080 de largura no reel.
 *
 * legado (`HEYGEN_AVATAR_TIPO=talking_photo`): POST /v2/video/generate, com o
 * `character.type: "talking_photo"` e `dimension` explícito, como a OS descreve.
 */
export async function dispararRender(
  p: RenderPedido
): Promise<Resposta<{ videoId: string }>> {
  if (usaLegado(p.tipo)) {
    const r = await post(`/v2/video/generate`, {
      video_inputs: [
        {
          character: { type: "talking_photo", talking_photo_id: p.avatarId },
          voice: { type: "text", input_text: p.roteiro, voice_id: p.voiceId },
        },
      ],
      dimension: { width: 720, height: 1280 },
      title: p.titulo,
    });
    if (!r.ok) return r;
    const d = (r.data as { data?: { video_id?: string } })?.data;
    if (!d?.video_id) return { ok: false, erro: "resposta_sem_video_id" };
    return { ok: true, data: { videoId: d.video_id } };
  }

  const r = await post(`/v3/videos`, {
    type: "avatar",
    avatar_id: p.avatarId,
    script: p.roteiro,
    voice_id: p.voiceId,
    aspect_ratio: "9:16",
    resolution: "1080p",
    title: p.titulo,
  });
  if (!r.ok) return r;
  const d = (r.data as { data?: { video_id?: string } })?.data;
  if (!d?.video_id) return { ok: false, erro: "resposta_sem_video_id" };
  return { ok: true, data: { videoId: d.video_id } };
}

export type StatusVideo = {
  /** Normalizado: as duas APIs usam vocabulários parecidos, mas não iguais. */
  estado: "processando" | "pronto" | "falhou";
  videoUrl: string | null;
  bruto: string;
  erro: string | null;
  /**
   * O id que a API REALMENTE reconhece para este vídeo. Igual ao pedido no
   * caminho normal; diferente quando o estado só foi obtido pelo resgate por
   * título. Existe para que a fase 2 possa DIZER que o id guardado divergiu,
   * em vez de o silêncio virar diagnóstico errado no dia seguinte.
   */
  idResolvido: string | null;
};

/**
 * Título do render. É a única chave HUMANA do vídeo — aparece no painel do
 * HeyGen — e, desde 07/08, também a chave de resgate quando o `video_id`
 * guardado não resolve (ver `statusVideo`). Mora aqui, exportado, porque duas
 * rotas precisam produzir a MESMA string byte a byte: quem grava (fase 1) e
 * quem procura (fase 2). Duas cópias do template seriam duas verdades.
 */
export function tituloRender(data: string, tipo: string): string {
  return `bidcon ${data} ${tipo}`;
}

function corpo(bruto: unknown): Record<string, unknown> {
  return ((bruto as { data?: Record<string, unknown> })?.data ?? {}) as Record<
    string,
    unknown
  >;
}

/**
 * Traduz um `VideoDetail` da v3 (ou o corpo equivalente do legado) para o
 * formato normalizado. Extraído para função porque agora há DOIS caminhos de
 * leitura (id e título) e eles têm de concordar — se um dia divergirem, a
 * fase 2 publica com regras diferentes dependendo de qual respondeu.
 */
function lerStatus(
  d: Record<string, unknown>,
  idResolvido: string | null
): StatusVideo {
  const bruto = String(d.status ?? "").toLowerCase();
  const videoUrl = primeiro(d, "video_url", "captioned_video_url");
  const erro =
    primeiro(d, "failure_message", "error") ??
    (d.error && typeof d.error === "object"
      ? primeiro(d.error as Record<string, unknown>, "message", "detail")
      : null);

  if (bruto === "completed" || bruto === "success") {
    // "completed" sem URL não é pronto — é resposta incompleta. Espera.
    return videoUrl
      ? { estado: "pronto", videoUrl, bruto, erro: null, idResolvido }
      : { estado: "processando", videoUrl: null, bruto, erro: null, idResolvido };
  }
  if (bruto === "failed" || bruto === "error") {
    return { estado: "falhou", videoUrl: null, bruto, erro, idResolvido };
  }
  return { estado: "processando", videoUrl: null, bruto, erro: null, idResolvido };
}

/**
 * Resgate por título: GET /v3/videos?title=<substring> (List Videos, medido no
 * OpenAPI — devolve `VideoDetail` completo, com `id`, `status` e `video_url`).
 *
 * A doc diz SUBSTRING; a comparação aqui é EXATA e o resultado tem de ser
 * único. Com zero não há o que ler; com dois ou mais eu não sei qual é o nosso,
 * e publicar o vídeo errado num perfil público é pior do que esperar mais um
 * ciclo. Ambíguo devolve erro, e erro de leitura nunca condena o render.
 */
async function acharPorTitulo(
  titulo: string
): Promise<Resposta<Record<string, unknown>>> {
  const q = new URLSearchParams({ title: titulo, limit: "100" });
  const r = await get(`/v3/videos?${q.toString()}`);
  if (!r.ok) return r;
  const exatos = comoLista(r.data, "videos").filter(
    (v) => String(v.title ?? "").trim() === titulo.trim()
  );
  if (exatos.length !== 1) return { ok: false, erro: `titulo_ambiguo(${exatos.length})` };
  return { ok: true, data: exatos[0] };
}

/**
 * RESGATE POR ESTAGNAÇÃO (08/08) — a segunda cara do mesmo defeito.
 *
 * MEDIDO em produção: o render de 08/08 disparado às 11h48 estava PRONTO no
 * painel do HeyGen e a fase 2 leu "renderizando" por três horas. O resgate por
 * título já existia, mas só armava em 404 — e aqui o id fantasma
 * (`82572f46a7714dcda209e9ecc33a7c3f`) NÃO dá 404: ele responde 200 com
 * `processing` para sempre. Ou seja: 404 nunca foi a doença, era um dos
 * sintomas. A doença é o id guardado não ser o id do recurso — e ele pode
 * mentir tanto sumindo quanto respondendo.
 *
 * Então o gatilho passa a ser o COMPORTAMENTO, não o código HTTP: status
 * não-pronto + linha velha demais para ainda estar renderizando = vale
 * perguntar pelo título, que é a chave humana e verdadeira.
 *
 * A DEFENSIVA CONTINUA INTEIRA, e é ela que separa isto de um chute:
 *  - sem `titulo` ou sem `estagnado`, nem chama — render novo tem que ter o
 *    direito de demorar, e uma requisição por linha por tique custa cota;
 *  - `acharPorTitulo` exige resultado ÚNICO e comparação EXATA: 0 ou 2+
 *    devolve erro e aqui mantém o status original, porque publicar o vídeo
 *    errado num perfil público é pior do que esperar outro ciclo;
 *  - só ADOTA o resgate se ele vier `pronto` (completed COM url). Resgate
 *    que também está processando não é notícia — o original já dizia isso.
 *
 * Nunca piora o veredito: no pior caso devolve exatamente o que entrou.
 */
async function resgatarSeEstagnado(
  porId: StatusVideo,
  videoId: string,
  titulo: string | null | undefined,
  estagnado: boolean | undefined
): Promise<StatusVideo> {
  if (porId.estado === "pronto" || !estagnado || !titulo) return porId;

  const achado = await acharPorTitulo(titulo);
  if (!achado.ok) return porId;

  const porTitulo = lerStatus(achado.data, primeiro(achado.data, "id", "video_id"));
  if (porTitulo.estado !== "pronto") return porId;

  console.warn("[farol-reel] resgate por estagnação", {
    id_guardado: videoId,
    id_heygen: porTitulo.idResolvido,
  });
  return porTitulo;
}

/**
 * Estado do render. v3: GET /v3/videos/{id} → data.status ∈
 * pending|processing|completed|failed (enum medido no OpenAPI), com
 * `video_url`, `duration` e `failure_code`/`failure_message`.
 * legado: GET /v1/video_status.get?video_id=.
 *
 * Qualquer estado DESCONHECIDO é tratado como "processando", nunca como
 * "pronto": no pior caso o reel espera mais um ciclo; o contrário publicaria
 * uma URL vazia no perfil público.
 *
 * `estagnado` é a resposta do CHAMADOR à pergunta "esta linha já é velha
 * demais para ainda estar renderizando?". Mora fora daqui porque idade é fato
 * da fila (`farol_reels`), não da API — esta lib não conhece banco. Ver o
 * bloco "Resgate por estagnação" no corpo.
 */
export async function statusVideo(
  videoId: string,
  tipo: string,
  titulo?: string | null,
  estagnado?: boolean
): Promise<Resposta<StatusVideo>> {
  if (usaLegado(tipo)) {
    const r = await get(`/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`);
    if (!r.ok) return r;
    return { ok: true, data: lerStatus(corpo(r.data), videoId) };
  }

  const r = await get(`/v3/videos/${encodeURIComponent(videoId)}`);
  if (r.ok) {
    const porId = lerStatus(corpo(r.data), videoId);
    return { ok: true, data: await resgatarSeEstagnado(porId, videoId, titulo, estagnado) };
  }

  // ---- Resgate por 404 (07/08) ----------------------------------------------
  // O OUTRO sintoma da mesma doença — o irmão deste é `resgatarSeEstagnado`,
  // logo acima, para quando o id fantasma responde 200 em vez de sumir.
  //
  // MEDIDO em produção: o render de 07/08 foi criado por POST /v3/videos, que
  // devolveu `df4b877…` (32 hex), e meia hora depois GET /v3/videos/df4b877…
  // respondeu `code=video_not_found`. A doc da v3 diz que o 404 dela é
  // `code=not_found` e que o id tem a forma `v_abc123def456`. Ou seja: o id que
  // guardamos não é o id que o recurso /v3/videos reconhece — não é a URL que
  // está errada, é a chave.
  //
  // A doc oferece exatamente uma saída para isso, e é a que uso: List Videos
  // filtra por título, e nosso título é único por dia e por tipo. Só vale para
  // 404. 401 é chave, 429 é cota, timeout é rede — nesses, insistir por outro
  // caminho gasta orçamento e atrasa a leitura verdadeira do ciclo seguinte.
  if (!r.erro.startsWith("http_404") || !titulo) return r;

  const achado = await acharPorTitulo(titulo);
  // Resgate frustrado devolve o 404 ORIGINAL, não o erro do resgate: o 404 é o
  // diagnóstico que precisa aparecer no log.
  if (!achado.ok) return r;
  return {
    ok: true,
    data: lerStatus(achado.data, primeiro(achado.data, "id", "video_id")),
  };
}
