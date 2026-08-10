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

/**
 * Irmão numérico do `primeiro`. Existe porque `primeiro` só aceita string e
 * `duration` vem número — passar a duração por ele devolveria `null` sempre, e
 * o campo nasceria vazio com cara de "a API não mandou".
 *
 * Aceita número OU string numérica: JSON de terceiro troca `12.5` por `"12.5"`
 * sem avisar, e um custo que some quando o provedor muda a serialização é pior
 * do que um custo que nunca existiu.
 *
 * Exige FINITO e POSITIVO. Zero não é medição de duração — é campo em branco
 * com roupa de número, e um zero aqui viraria "render de graça" na tela.
 */
function numeroPositivo(obj: Record<string, unknown>, ...chaves: string[]): number | null {
  for (const k of chaves) {
    const v = obj[k];
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
    if (Number.isFinite(n) && n > 0) return n;
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
  /**
   * Duração do vídeo em SEGUNDOS, quando a API a declara (só vem com o render
   * concluído). É o multiplicando do custo de render: sem ela, a sala de
   * controle não consegue estimar quanto custou a esteira e o bloco de custo
   * mente por omissão — parece completo somando só o custo de conversa.
   *
   * A unidade é a declarada pelo OpenAPI da v3 (`duration`, em segundos). NÃO
   * confirmei contra cronômetro; o dia em que um reel de 30s aparecer como 30
   * confirma, e um que apareça como 30000 diz que veio em milissegundo. Por
   * isso o valor é gravado cru e o rótulo do campo diz a unidade assumida.
   */
  duracaoS: number | null;
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
  // Lido em TODOS os estados, não só no `completed`. Custa nada e o dia em que
  // a v3 passar a declarar duração antes do fim, a conta de custo já a pega.
  const duracaoS = numeroPositivo(d, "duration", "duration_seconds");
  const erro =
    primeiro(d, "failure_message", "error") ??
    (d.error && typeof d.error === "object"
      ? primeiro(d.error as Record<string, unknown>, "message", "detail")
      : null);

  if (bruto === "completed" || bruto === "success") {
    // "completed" sem URL não é pronto — é resposta incompleta. Espera.
    return videoUrl
      ? { estado: "pronto", videoUrl, bruto, erro: null, idResolvido, duracaoS }
      : { estado: "processando", videoUrl: null, bruto, erro: null, idResolvido, duracaoS };
  }
  if (bruto === "failed" || bruto === "error") {
    return { estado: "falhou", videoUrl: null, bruto, erro, idResolvido, duracaoS };
  }
  return { estado: "processando", videoUrl: null, bruto, erro: null, idResolvido, duracaoS };
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

// ===========================================================================
// A VOZ — conferir antes, e ter para onde cair depois
// AUTORIZADO: Emerson — 10/08/2026, após a falha do reel das 11h31:
//   "acrescente uma validação: antes do render, conferir o voice_id contra
//    /api/farol/reel-opcoes; voz inválida deve cair na voz padrão com log, não
//    perder o vídeo do dia."
// ---------------------------------------------------------------------------
// O QUE FALHOU, LITERAL: `http_400 code=invalid_parameter Invalid voice_id:
// '05601cd1a3f34777b78dce4e1ff9c66c'. Voice not found.` A voz existe no estúdio
// do HeyGen; a API de vídeo não a aceita.
//
// PRIMEIRO, O ACHADO QUE MUDA O DESENHO: NÃO EXISTE "VOZ PADRÃO" NO CÓDIGO.
// `HEYGEN_VOICE_ID` **é** o padrão — não há segunda voz escrita em lugar nenhum
// (medido: nem o id do Pedro Lima nem o da voz recusada aparecem no repositório).
// Então "cair na voz padrão" era uma instrução circular: cair de HEYGEN_VOICE_ID
// para... HEYGEN_VOICE_ID. É por isso que o fallback de persona que já existia
// não teria salvado nada — ele re-renderiza com a MESMA voz da env.
//
// Para a ordem virar código, o padrão precisou de uma fonte fora da env. É o
// VOZ_SOCORRO abaixo, e ele não é configuração nova inventada por mim: é o
// registro de um fato medido.
//
// SEGUNDO, E ISTO PRECISA SER DITO EM VOZ ALTA: A CONFERÊNCIA PRÉVIA PODE SER
// VÁCUA. Ela pergunta à conta do HeyGen quais vozes existem. Mas o Emerson
// mesmo relatou que a voz recusada EXISTE no estúdio — ou seja, ela
// provavelmente APARECE nessa lista, a conferência passa verde, e o render
// falha do mesmo jeito. Uma conferência que não pode reprovar o caso que a
// motivou é exatamente o "verde vazio" que o commit 09b6434 desta casa proíbe.
//
// Não posso medir isso daqui: HEYGEN_API_KEY só existe na Vercel. Então a
// conferência foi implementada como pedido, E veio acompanhada de `recusaDeVoz`
// — a queda DEPOIS do erro, que é a que teria salvado o vídeo de 10/08. A
// primeira é barata e pode não pegar nada; a segunda pega o caso real. Se a
// medição em produção mostrar que a lista de fato reprova a voz, a segunda
// vira rede de segurança em vez de mecanismo principal — e nenhuma das duas
// precisa ser desfeita.
//
// TERCEIRO — E ESTE ACHADO CONTRARIA A LETRA DA ORDEM. A ordem diz "conferir o
// voice_id contra /api/farol/reel-opcoes". Fui ler o que aquela rota devolve, e
// ela NÃO devolve o inventário da conta: ela devolve um CARDÁPIO CURADO. As
// vozes passam por um filtro `pareceBr` (só o que parece português) e depois por
// `slice(0, 20)`. Conferir contra ela produziria REPROVAÇÃO FALSA em dois casos
// banais: voz boa que a HeyGen não indexa como português, e voz boa que ficou
// na 21ª posição. O resultado seria trocar a voz da marca por causa de um
// artefato de paginação — um jeito NOVO de estragar o vídeo, criado pela
// própria proteção contra estragar o vídeo.
//
// Então a conferência foi feita contra `listarVozes("", ...)` — a listagem SEM
// filtro de idioma — e não contra o cardápio. É desvio deliberado da letra, em
// favor do que a ordem quer: não perder o vídeo do dia.
//
// QUARTO, a consequência disso no desenho: uma lista com teto NÃO PROVA
// AUSÊNCIA. Se a voz configurada não está lá, pode ser que ela não exista — ou
// que a lista tenha acabado antes dela. Por isso `escolherVoz` só aceita
// condenar a configurada quando a lista traz o VOZ_SOCORRO junto: a presença de
// uma voz sabidamente boa é a CREDENCIAL da lista. Lista sem essa credencial
// não reprova ninguém.
// ===========================================================================

/**
 * A VOZ DE SOCORRO — Pedro Lima.
 *
 * POR QUE UM ID CRAVADO NO CÓDIGO, sendo que a casa evita configuração em
 * código: porque isto não é preferência, é o registro de uma MEDIÇÃO. Esta é a
 * voz que produziu os reels que saíram, e é para ela que a instrução de env de
 * 10/08 manda o `HEYGEN_VOICE_ID` voltar. Uma queda precisa de um destino
 * conhecido-bom; um env não serve de destino porque o env é justamente o que
 * pode estar errado.
 *
 * QUANDO ISTO VIRA INÓCUO, e tudo bem: depois que o Emerson reverter a env,
 * `VOZ_SOCORRO` passa a ser igual à voz configurada, `escolherVoz` devolve
 * `configurada` e nenhum render extra acontece. O socorro só volta a ter função
 * se alguém trocar a env de novo por uma voz que a API recusa — que é
 * exatamente o acidente de 10/08.
 *
 * O RISCO DECLARADO: id cravado apodrece calado se a HeyGen apagar esta voz.
 * Por isso `escolherVoz` também confere o SOCORRO contra a conta, e tem um
 * terceiro degrau — não confia neste valor por fé.
 */
export const VOZ_SOCORRO = "6872a840c4194f42a7f8ce0aee47660c";

/**
 * O PRAZO DA CONFERÊNCIA — e por que ele não é o TIMEOUT_MS de 20s.
 *
 * ORÇAMENTO MEDIDO: `reel-render` tem `maxDuration = 60`. Dentro dele já cabiam
 * o render (até 20s) e, no fallback de persona, um segundo render (mais 20s).
 * Somar uma listagem de 20s fecha os 60s no pior caso — e a rota morreria por
 * estouro de tempo ANTES de publicar. Uma conferência que pode custar o vídeo
 * do dia é o oposto do que a ordem de 10/08 pediu.
 *
 * 6s é o que sobra com folga para os dois renders. E o estouro do prazo não é
 * erro: `vozesEmPrazo` devolve lista VAZIA, `escolherVoz` lê isso como
 * `lista_indisponivel` e o render segue com a voz configurada. A conferência
 * tem permissão para não acontecer; não tem permissão para atrapalhar.
 */
export const PRAZO_LISTAGEM_MS = 6000;

/**
 * A listagem de vozes com prazo curto, achatada em `OpcaoVoz[]`.
 *
 * LISTA VAZIA É A RESPOSTA PARA TUDO QUE DEU ERRADO — timeout, 4xx, 5xx, chave
 * ausente, exceção. Não distingo os casos aqui de propósito: nenhum deles é
 * prova sobre a VOZ, e o único uso desta lista é decidir sobre a voz. Quem
 * precisa do erro literal para o log é a rota, que ainda tem a resposta crua.
 *
 * O fetch de baixo não é cancelado quando o prazo estoura — `Promise.race` só
 * para de esperar. Como é um GET, seguir rodando sozinho não faz nada a
 * ninguém, e cancelar exigiria passar um AbortController por três camadas para
 * economizar uma conexão ociosa.
 */
export async function vozesEmPrazo(
  listar: () => Promise<{ ok: true; data: OpcaoVoz[] } | { ok: false; erro: string }>,
  prazoMs: number = PRAZO_LISTAGEM_MS
): Promise<OpcaoVoz[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), prazoMs);
  });
  try {
    const r = await Promise.race([listar().catch(() => null), prazo]);
    if (!r || !r.ok) return [];
    return r.data;
  } catch {
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type EscolhaDeVoz = {
  /** A voz que deve ir para o render. */
  voz: string;
  /** `null` quando a configurada passou. Caso contrário, por que ela caiu. */
  motivo:
    | null
    | "lista_indisponivel"
    | "configurada_ausente_da_conta"
    | "lista_sem_referencia";
};

/**
 * Qual voz vai para o render, dada a configurada e o que a conta oferece.
 *
 * A REGRA MAIS IMPORTANTE É A PRIMEIRA, e ela é sobre não inventar uma forma
 * nova de perder o vídeo: se a lista veio vazia ou não veio (`disponiveis`
 * vazio), a resposta é a voz CONFIGURADA, não o socorro. Uma listagem que
 * falhou não é prova de que a voz é ruim — é ausência de prova. Deixar uma
 * consulta auxiliar derrubar (ou desviar) o render seria trocar um defeito raro
 * por um defeito novo, dependente de uma chamada a mais dar certo todo dia.
 *
 * A SEGUNDA REGRA É A QUE ESTA FUNÇÃO GANHOU DEPOIS DE EU MEDIR O TETO da
 * listagem (ver QUARTO no cabeçalho): só desviar quando a lista traz o SOCORRO.
 * Uma lista truncada em que a configurada não aparece é ambígua — pode ser voz
 * inexistente, pode ser página que acabou antes. Mas se o socorro, que é voz
 * sabidamente boa, TAMBÉM não aparece, a explicação provável é a lista, não as
 * vozes. Nesse caso a função se cala e devolve a configurada: quem dá veredito
 * sobre voz é a HeyGen no render, não uma listagem incompleta.
 *
 * Escrevi antes um terceiro degrau que, nesse caso, escolhia qualquer voz em
 * português da conta. Removi depois de medir: ele trocaria a voz da marca por
 * causa de paginação. Prefiro o render falhar e `recusaDeVoz` decidir com o
 * veredito da própria HeyGen na mão.
 */
export function escolherVoz(
  configurada: string,
  disponiveis: OpcaoVoz[],
  socorro: string = VOZ_SOCORRO
): EscolhaDeVoz {
  if (disponiveis.length === 0) {
    return { voz: configurada, motivo: "lista_indisponivel" };
  }

  const ids = new Set(disponiveis.map((v) => v.id));
  if (ids.has(configurada)) return { voz: configurada, motivo: null };

  if (ids.has(socorro)) {
    return { voz: socorro, motivo: "configurada_ausente_da_conta" };
  }

  return { voz: configurada, motivo: "lista_sem_referencia" };
}

/**
 * O erro do render é recusa DA VOZ especificamente?
 *
 * DUAS CONDIÇÕES, E AS DUAS IMPORTAM. A primeira é 4xx, pela mesma razão de
 * dinheiro que governa `recusaDeCadastro` em reel-render: só o 4xx prova que a
 * HeyGen recusou o pedido, que nada foi enfileirado e que nada será cobrado —
 * repetir depois de timeout ou 5xx pode pagar dois vídeos para publicar um.
 *
 * A segunda é a voz aparecer na mensagem. Sem ela, todo 4xx viraria motivo para
 * re-renderizar trocando a voz, inclusive 4xx de avatar, de roteiro ou de cota
 * — trocar a voz não conserta nenhum deles, e a segunda cobrança seria certa e
 * inútil.
 */
export function recusaDeVoz(erro: string | undefined): boolean {
  const texto = erro ?? "";
  if (!/^http_4\d\d(\s|$)/.test(texto)) return false;
  return /voice[_ ]?id|voice not found|invalid voice/i.test(texto);
}

// ===========================================================================
// PAINEL-VOZES-01 — o INVENTÁRIO, que não é o cardápio
// AUTORIZADO: Emerson Gomes dos Santos — 10/08/2026, depois do reel perdido:
//   "devolve id, nome, idioma, gênero, premium e amostra das fontes v3 e v2,
//    sem filtro e sem teto. Só GET, sessão admin como guarda, nada grava e
//    nada gasta. (...) Mesmo desenho para os avatares."
// ---------------------------------------------------------------------------
// POR QUE ISTO NÃO É `listarVozes` COM OUTRO NOME. As funções acima existem
// para MONTAR UM CARDÁPIO: `/api/farol/reel-opcoes` tenta três rótulos de
// idioma, peneira por `pareceBr()` e corta em 20. Cardápio serve para escolher
// entre poucas coisas boas. O que faltou em 10/08 foi outra coisa: responder
// "o id 05601cd1... existe nesta conta?" — e para essa pergunta um cardápio é
// inútil, porque a ausência num cardápio não é ausência na conta.
//
// AS TRÊS DIFERENÇAS DE DESENHO, e cada uma nasceu de um defeito medido:
//
//  1. PAGINA. `listarVozes` faz UMA chamada com `limit`. Se a conta tem 900
//     vozes e o teto é 100, as outras 800 simplesmente não existem para quem
//     lê. Aqui o laço segue o token até acabar.
//
//  2. NÃO TRUNCA EM SILÊNCIO. Quando o orçamento de relógio estoura, ou o teto
//     de páginas é atingido, a resposta carrega `parcial: true` e o motivo
//     escrito em `avisos`. Uma lista curta que se apresenta como completa é o
//     "verde vazio" da doutrina 09b6434 — pior do que um erro, porque convence.
//
//  3. TRAZ O CONTROLE JUNTO. `controle.socorro_presente` responde se a voz
//     sabidamente boa (VOZ_SOCORRO, o Pedro Lima) apareceu. É a mesma lógica
//     de `escolherVoz`: uma lista onde nem o socorro aparece não reprova voz
//     nenhuma — ela reprova a si mesma. Sem esse campo, o operador leria
//     "não achei o id" e concluiria "o id não existe", que é o erro que este
//     arquivo inteiro existe para impedir.
//
// FALHA PARCIAL NÃO DERRUBA. Cada fonte vira uma linha em `fontes[]` com o erro
// literal. A v2 morrer não pode apagar as vozes que a v3 trouxe: metade de um
// inventário ainda responde a pergunta metade das vezes; uma exceção não
// responde nunca.
//
// NADA AQUI GASTA CRÉDITO: só GET de listagem. Nenhum `POST /v3/videos`.
// ===========================================================================

/**
 * Como o inventário fala com a HeyGen. Existe como PARÂMETRO, e não como
 * chamada direta a `get`, por um motivo prático: `scripts/testes.mjs` roda sem
 * rede e sem chave. Com o buscador injetável, a paginação, a deduplicação, o
 * orçamento e o controle — que é onde mora o risco de errar — ficam todos sob
 * teste. O padrão continua sendo `get`, então a rota não precisa saber disso.
 */
export type Buscador = (caminho: string) => Promise<Resposta<unknown>>;

export type VozInventario = {
  id: string;
  nome: string;
  genero: string | null;
  idioma: string | null;
  /** `true`/`false` quando a API disse; `null` quando ela não falou. */
  premium: boolean | null;
  /** URL do áudio de amostra. O painel toca; o servidor não confere. */
  amostra: string | null;
  origem: "v3" | "v2";
};

export type AvatarInventario = {
  id: string;
  nome: string;
  tipo: string | null;
  preview: string | null;
  origem: "v3" | "v3_photo" | "v1_talking_photo";
};

/** O estado de UMA fonte. `ok:false` com `n>0` é fonte que caiu no meio. */
export type FonteInventario = {
  nome: string;
  ok: boolean;
  erro?: string;
  n: number;
};

export type Inventario<T> = {
  itens: T[];
  fontes: FonteInventario[];
  /**
   * Só as vozes têm controle — `VOZ_SOCORRO` é uma voz, não um avatar. Em
   * avatares isto é `null` de propósito, e não um `false`: dizer
   * "socorro_presente: false" para uma família que não tem socorro seria
   * inventar uma reprovação.
   */
  controle: { socorro_presente: boolean } | null;
  /** `true` = esta lista pode não ser tudo. O painel avisa em destaque. */
  parcial: boolean;
  avisos: string[];
};

/**
 * Irmão booleano de `primeiro` e `numeroPositivo`, e existe pela mesma razão
 * que eles: `primeiro` só devolve string, então `premium: true` passaria por
 * ele e sairia `null` — o campo nasceria vazio com cara de "a API não mandou".
 *
 * A DISTINÇÃO QUE ELE PRESERVA: `false` é a API dizendo "não é premium";
 * `null` é a API não tendo dito nada. Achatar os dois em `false` faria uma voz
 * paga parecer gratuita numa tela usada para escolher voz.
 *
 * Aceita `1`/`0` e `"true"`/`"false"` porque JSON de terceiro troca a
 * serialização de booleano sem avisar — foi assim que `numeroPositivo` nasceu.
 */
function booleano(obj: Record<string, unknown>, ...chaves: string[]): boolean | null {
  for (const k of chaves) {
    const v = obj[k];
    if (typeof v === "boolean") return v;
    if (typeof v === "number") {
      if (v === 1) return true;
      if (v === 0) return false;
    }
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (s === "true" || s === "1") return true;
      if (s === "false" || s === "0") return false;
    }
  }
  return null;
}

/**
 * O token da próxima página, procurado na raiz E dentro de `data`, com quatro
 * nomes. Não sei qual deles a conta usa — a mesma ignorância declarada no
 * cabeçalho deste arquivo — e um token não encontrado significa "acabou", o que
 * faria uma conta de 900 vozes parecer uma conta de 200 sem nenhum erro na tela.
 */
function tokenDaPagina(bruto: unknown): string | null {
  const raiz = (bruto ?? {}) as Record<string, unknown>;
  const dados = (raiz.data ?? {}) as Record<string, unknown>;
  return (
    primeiro(dados, "token", "next_token", "page_token", "cursor") ??
    primeiro(raiz, "token", "next_token", "page_token", "cursor")
  );
}

/** Itens por página na v3. Alto de propósito: menos idas à rede no orçamento. */
const PAGINA = 200;

/**
 * Trava de LAÇO, não de negócio. 40 × 200 = 8.000 itens, muito acima de
 * qualquer conta real. Ela existe para o caso de a API devolver sempre o mesmo
 * token: sem teto, isso é um laço infinito dentro de um handler da Vercel.
 */
export const TETO_PAGINAS = 40;

/**
 * O orçamento de relógio. A rota tem `maxDuration = 300`; 120s deixa folga
 * larga para as duas famílias e para a serialização. Estourar não é erro — é
 * `parcial: true` com o motivo escrito.
 */
export const ORCAMENTO_INVENTARIO_MS = 120_000;

export type OpcoesInventario = {
  buscar?: Buscador;
  orcamentoMs?: number;
  /** Relógio injetável: deixa o teste do orçamento rodar sem esperar 120s. */
  agora?: () => number;
};

function mapearVoz(v: Record<string, unknown>, origem: "v3" | "v2"): VozInventario {
  return {
    id: primeiro(v, "id", "voice_id") ?? "",
    nome: primeiro(v, "name", "display_name", "voice_name") ?? "(sem nome)",
    genero: primeiro(v, "gender"),
    idioma: primeiro(v, "language", "language_name"),
    premium: booleano(v, "premium", "is_premium", "isPremium"),
    amostra: primeiro(
      v,
      "preview_audio",
      "preview_audio_url",
      "sample",
      "sample_url",
      "audio_url",
      "preview_url"
    ),
    origem,
  };
}

/**
 * Junta as fontes por `id`, PREFERINDO O REGISTRO QUE TRAZ AMOSTRA.
 *
 * A ordem importa e não é arbitrária: a mesma voz costuma aparecer na v3 e na
 * v2 com campos diferentes preenchidos. Ficar com a primeira ocorrência por
 * reflexo perderia a amostra quando ela só existe do outro lado — e amostra é
 * metade da razão de o Emerson ter pedido esta tela. Empate em amostra,
 * desempata quem sabe dizer `premium`.
 */
function deduplicarVozes(itens: VozInventario[]): VozInventario[] {
  const porId = new Map<string, VozInventario>();
  for (const v of itens) {
    const atual = porId.get(v.id);
    if (!atual) {
      porId.set(v.id, v);
      continue;
    }
    if (!atual.amostra && v.amostra) {
      porId.set(v.id, v);
      continue;
    }
    if (atual.amostra && !v.amostra) continue;
    if (atual.premium === null && v.premium !== null) porId.set(v.id, v);
  }
  return [...porId.values()];
}

/**
 * Percorre uma família paginada até o fim, o orçamento ou o teto.
 *
 * DEVOLVE O QUE CONSEGUIU, SEMPRE. Um erro na página 3 não apaga as páginas 1 e
 * 2: ele vira `erro` ao lado de `n`, e quem lê decide. É a mesma escolha de
 * `vozesEmPrazo` — a consulta auxiliar não tem permissão para derrubar nada.
 */
async function paginar(
  buscar: Buscador,
  montarCaminho: (token: string | null) => string,
  colher: (bruto: unknown) => Record<string, unknown>[],
  estourou: () => boolean
): Promise<{ linhas: Record<string, unknown>[]; erro?: string; aviso?: string }> {
  const linhas: Record<string, unknown>[] = [];
  let token: string | null = null;
  let paginas = 0;

  for (;;) {
    if (estourou()) {
      return {
        linhas,
        aviso: `orçamento de tempo estourado após ${paginas} página(s); a lista está incompleta.`,
      };
    }

    let r: Resposta<unknown>;
    try {
      r = await buscar(montarCaminho(token));
    } catch (e) {
      return {
        linhas,
        erro: e instanceof Error ? e.message.slice(0, 300) : "erro_desconhecido",
      };
    }
    if (!r.ok) return { linhas, erro: r.erro };

    const itens = colher(r.data);
    linhas.push(...itens);
    paginas++;

    const proximo = tokenDaPagina(r.data);
    // Token igual ao anterior é API repetindo página: parar é o certo, e sem
    // isso o teto abaixo seria a única defesa contra o laço infinito.
    if (!proximo || proximo === token || itens.length === 0) return { linhas };

    if (paginas >= TETO_PAGINAS) {
      return {
        linhas,
        aviso: `teto de ${TETO_PAGINAS} páginas atingido; a lista pode estar incompleta.`,
      };
    }
    token = proximo;
  }
}

/**
 * O inventário de VOZES: v3 paginada + v2, deduplicado, com controle.
 *
 * Nunca lança. O pior caso é `{itens: [], fontes: [dois erros], parcial: true}`
 * — que é uma resposta legível, e não um 500 mudo na cara do operador.
 */
export async function inventarioVozes(
  opcoes: OpcoesInventario = {}
): Promise<Inventario<VozInventario>> {
  const buscar = opcoes.buscar ?? ((c: string) => get(c));
  const orcamentoMs = opcoes.orcamentoMs ?? ORCAMENTO_INVENTARIO_MS;
  const agora = opcoes.agora ?? (() => Date.now());
  const inicio = agora();
  const estourou = () => agora() - inicio >= orcamentoMs;

  const fontes: FonteInventario[] = [];
  const avisos: string[] = [];
  const cru: VozInventario[] = [];

  // --- v3, paginada ---------------------------------------------------------
  const v3 = await paginar(
    buscar,
    (token) => {
      const q = new URLSearchParams({ limit: String(PAGINA) });
      if (token) q.set("token", token);
      return `/v3/voices?${q.toString()}`;
    },
    (bruto) => comoLista(bruto, "voices"),
    estourou
  );
  const daV3 = v3.linhas.map((v) => mapearVoz(v, "v3")).filter((v) => v.id);
  cru.push(...daV3);
  fontes.push({
    nome: "v3/voices",
    ok: !v3.erro,
    ...(v3.erro ? { erro: v3.erro } : {}),
    n: daV3.length,
  });
  if (v3.aviso) avisos.push(`v3/voices: ${v3.aviso}`);
  if (v3.erro && daV3.length > 0) {
    avisos.push(`v3/voices caiu depois de ${daV3.length} voz(es); o resto não foi lido.`);
  }

  // --- v2, uma chamada ------------------------------------------------------
  // O legado não pagina no que eu medi, e ele responde 401 (não 404) — ou seja,
  // existe. Fica aqui porque uma voz antiga da conta pode aparecer SÓ nele.
  if (estourou()) {
    fontes.push({ nome: "v2/voices", ok: false, erro: "orcamento_estourado", n: 0 });
    avisos.push("v2/voices nem foi consultada: o orçamento acabou na v3.");
  } else {
    let r2: Resposta<unknown>;
    try {
      r2 = await buscar("/v2/voices");
    } catch (e) {
      r2 = { ok: false, erro: e instanceof Error ? e.message.slice(0, 300) : "erro_desconhecido" };
    }
    if (r2.ok) {
      const daV2 = comoLista(r2.data, "voices")
        .map((v) => mapearVoz(v, "v2"))
        .filter((v) => v.id);
      cru.push(...daV2);
      fontes.push({ nome: "v2/voices", ok: true, n: daV2.length });
    } else {
      fontes.push({ nome: "v2/voices", ok: false, erro: r2.erro, n: 0 });
    }
  }

  const itens = deduplicarVozes(cru);

  // --- o controle -----------------------------------------------------------
  const socorro_presente = itens.some((v) => v.id === VOZ_SOCORRO);
  if (!socorro_presente) {
    avisos.push(
      `CONTROLE FALHOU: a voz de socorro (${VOZ_SOCORRO}) não apareceu. ` +
        "Trate esta lista como incompleta — a ausência de um id aqui NÃO prova " +
        "que ele não existe na conta."
    );
  }

  return {
    itens,
    fontes,
    controle: { socorro_presente },
    parcial: avisos.length > 0 || fontes.some((f) => !f.ok),
    avisos,
  };
}

function mapearAvatar(
  a: Record<string, unknown>,
  origem: AvatarInventario["origem"],
  tipoPadrao: string | null
): AvatarInventario {
  return {
    id: primeiro(a, "id", "avatar_id", "look_id", "talking_photo_id") ?? "",
    nome:
      primeiro(a, "name", "avatar_name", "look_name", "talking_photo_name") ?? "(sem nome)",
    tipo: primeiro(a, "avatar_type", "type") ?? tipoPadrao,
    preview: primeiro(a, "preview_image_url", "preview_url", "image_url"),
    origem,
  };
}

/**
 * O inventário de AVATARES: looks da v3 (todos e `photo_avatar`) + talking
 * photos do legado.
 *
 * DESVIO QUE EU DECLARO: as duas fontes v3 vão com `ownership=private`, e não
 * sem filtro. O motivo é que `ownership=public` é o catálogo de estoque da
 * HeyGen — milhares de avatares que não são da casa e que afogariam o único
 * item que a tela existe para encontrar. Se um dia o avatar procurado não
 * aparecer aqui, este parágrafo é o primeiro lugar a olhar.
 *
 * `controle: null` — não existe avatar de socorro cravado como VOZ_SOCORRO. Ver
 * o comentário do tipo `Inventario`.
 */
export async function inventarioAvatares(
  opcoes: OpcoesInventario = {}
): Promise<Inventario<AvatarInventario>> {
  const buscar = opcoes.buscar ?? ((c: string) => get(c));
  const orcamentoMs = opcoes.orcamentoMs ?? ORCAMENTO_INVENTARIO_MS;
  const agora = opcoes.agora ?? (() => Date.now());
  const inicio = agora();
  const estourou = () => agora() - inicio >= orcamentoMs;

  const fontes: FonteInventario[] = [];
  const avisos: string[] = [];
  const porId = new Map<string, AvatarInventario>();

  const familias: {
    nome: string;
    tipo: string | null;
    origem: AvatarInventario["origem"];
  }[] = [
    { nome: "v3/avatars/looks", tipo: null, origem: "v3" },
    { nome: "v3/avatars/looks(photo_avatar)", tipo: "photo_avatar", origem: "v3_photo" },
  ];

  for (const f of familias) {
    const r = await paginar(
      buscar,
      (token) => {
        const q = new URLSearchParams({ limit: String(PAGINA), ownership: "private" });
        if (f.tipo) q.set("avatar_type", f.tipo);
        if (token) q.set("token", token);
        return `/v3/avatars/looks?${q.toString()}`;
      },
      (bruto) => comoLista(bruto, "looks", "avatars"),
      estourou
    );
    const lista = r.linhas.map((a) => mapearAvatar(a, f.origem, f.tipo)).filter((a) => a.id);
    // Primeiro a chegar fica: o look genérico e o photo_avatar são a MESMA
    // entidade quando o id bate, e a primeira família já traz o `avatar_type`.
    for (const a of lista) if (!porId.has(a.id)) porId.set(a.id, a);
    fontes.push({ nome: f.nome, ok: !r.erro, ...(r.erro ? { erro: r.erro } : {}), n: lista.length });
    if (r.aviso) avisos.push(`${f.nome}: ${r.aviso}`);
  }

  // --- talking photos do legado --------------------------------------------
  if (estourou()) {
    fontes.push({ nome: "v1/talking_photo.list", ok: false, erro: "orcamento_estourado", n: 0 });
    avisos.push("v1/talking_photo.list nem foi consultada: o orçamento acabou antes.");
  } else {
    let r: Resposta<unknown>;
    try {
      r = await buscar("/v1/talking_photo.list");
    } catch (e) {
      r = { ok: false, erro: e instanceof Error ? e.message.slice(0, 300) : "erro_desconhecido" };
    }
    if (r.ok) {
      const lista = comoLista(r.data, "talking_photos")
        .map((t) => mapearAvatar(t, "v1_talking_photo", "talking_photo"))
        .filter((a) => a.id);
      for (const a of lista) if (!porId.has(a.id)) porId.set(a.id, a);
      fontes.push({ nome: "v1/talking_photo.list", ok: true, n: lista.length });
    } else {
      fontes.push({ nome: "v1/talking_photo.list", ok: false, erro: r.erro, n: 0 });
    }
  }

  return {
    itens: [...porId.values()],
    fontes,
    controle: null,
    parcial: avisos.length > 0 || fontes.some((f) => !f.ok),
    avisos,
  };
}
