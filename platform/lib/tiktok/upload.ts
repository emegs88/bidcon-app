// ============================================================================
// lib/tiktok/upload.ts — cliente da Content Posting API do TikTok
// AUTORIZADO: Emerson Gomes dos Santos — OS "TIKTOK-01", 07/08/2026 (~19h30):
// "quero fazer pela api". Conta @bidcon. O mp4 vertical que o FAROL já hospeda
// no bucket público `farol-videos` é o MESMO arquivo que vai pro TikTok.
// ----------------------------------------------------------------------------
// NASCE INERTE. Sem TT_CLIENT_KEY / TT_CLIENT_SECRET / TT_REFRESH_TOKEN nenhuma
// função aqui fala com o TikTok — devolvem `env_ausente(...)`. O kill-switch de
// comportamento (`FAROL_TIKTOK`) vive na rota do FAROL, não aqui.
//
// ---------------------------------------------------------------------------
// A DOC, MEDIDA HOJE (07/08/2026) — cada número tem procedência:
//
//  · Consentimento: GET https://www.tiktok.com/v2/auth/authorize/ com
//    client_key, response_type=code, scope (SEPARADO POR VÍRGULA, não espaço —
//    é onde o OAuth do TikTok difere do Google), redirect_uri (URL-encoded,
//    https, e batendo LETRA POR LETRA com o registrado) e state.
//  · Token e refresh: POST https://open.tiktokapis.com/v2/oauth/token/, corpo
//    application/x-www-form-urlencoded. access_token vale 86400s (24h);
//    refresh_token vale 31536000s (365 dias) "after the initial issuance".
//  · Post: POST /v2/post/publish/video/init/ devolve `publish_id` (≤64 chars)
//    e `upload_url` (≤256 chars) — a upload_url VALE UMA HORA.
//  · Bytes: PUT na upload_url com Content-Type, Content-Length (bytes DO
//    CHUNK) e Content-Range: bytes {primeiro}-{ultimo}/{total}.
//    206 = chunk intermediário aceito; 201 = último chunk, publicação começou.
//  · Chunk: mínimo 5MB, máximo 64MB; o ÚLTIMO pode passar do chunk_size (até
//    128MB). total_chunk_count = floor(video_size / chunk_size), de 1 a 1000.
//    Vídeo abaixo de 5MB sobe INTEIRO, com chunk_size = tamanho do arquivo.
//  · Status: POST /v2/post/publish/status/fetch/ com {publish_id}. A hipótese
//    da OS estava certa. Estados: PROCESSING_UPLOAD, PROCESSING_DOWNLOAD,
//    SEND_TO_USER_INBOX, PUBLISH_COMPLETE, FAILED. Limite 30 req/min.
//  · `is_aigc` (bool) EXISTE em post_info. A OS mandou medir se o TikTok expõe
//    rótulo de conteúdo gerado por IA: expõe. Ver DECLARAÇÃO DE IA abaixo.
//  · Cliente NÃO AUDITADO: "all content posted by unaudited clients will be
//    restricted to private viewing mode". A premissa regulatória da OS foi
//    medida e é VERDADEIRA — não é bug nosso, é a plataforma.
//
// ---------------------------------------------------------------------------
// UM CHUNK SÓ, E ISSO É UMA CONSEQUÊNCIA DA MEDIÇÃO, NÃO UM ATALHO.
// O teto de arquivo da casa é 45MB (TETO_UPLOAD_BYTES) e o chunk máximo do
// TikTok é 64MB. Ou seja: TODO arquivo que a casa produz cabe num único chunk,
// por construção. Escrever laço de fatiamento aqui seria escrever código que
// nunca executa — e código que nunca executa é código que nunca é testado e
// que mente sobre a complexidade real do sistema. O caso `< 5MB` também cai
// no mesmo caminho: a doc manda subir inteiro com chunk_size = tamanho, que é
// exatamente o que fazemos sempre. Um único caminho, sempre exercitado.
// A guarda `> CHUNK_MAX_BYTES` existe mesmo assim: se algum dia alguém subir o
// teto da casa acima de 64MB, isto falha com mensagem clara em vez de mandar
// um Content-Range inválido e receber um erro do TikTok que não diz nada.
//
// ---------------------------------------------------------------------------
// DECLARAÇÃO DE IA — `is_aigc: true`, FIXO. Mesma decisão do YOUTUBE-01 com
// `containsSyntheticMedia`: não é parâmetro. O vídeo é um avatar HeyGen com voz
// sintetizada. A casa já declara IA na legenda do feed, no private reply e na
// resposta pública (RÓTULO-IA, 07/08); parar essa declaração na fronteira do
// TikTok seria transparência de fachada.
//
// ---------------------------------------------------------------------------
// PRIVACIDADE — `TT_PRIVACY`, default `SELF_ONLY`, e o default é o seguro.
// Enquanto o app não passar pela auditoria do TikTok, QUALQUER valor que a
// gente mande vira privado do lado deles. O env existe para o dia da aprovação:
// vira `PUBLIC_TO_EVERYONE` e arma. Valor desconhecido no env NÃO vira erro e
// NÃO vira público — cai em SELF_ONLY. Um typo no painel da Vercel não pode ser
// o caminho mais curto para uma publicação pública indevida.
//
// ---------------------------------------------------------------------------
// ROTAÇÃO DO REFRESH_TOKEN — RISCO DECLARADO, não resolvido aqui.
// A doc do TikTok diz, com estas palavras: "The returned refresh_token may be
// different than the one passed in the payload. You must use the newly-returned
// token if the value is different than the previous one."
//
// O Google NÃO faz isso — por isso o padrão do YOUTUBE-01 (guardar o refresh
// numa env da Vercel, de dedo do dono) funciona lá sem ressalva. Aqui não
// funciona igual: código não reescreve env. Se o TikTok rotacionar e invalidar
// o anterior, a env fica defasada e o próximo refresh falha.
//
// A OS mandou seguir o padrão YOUTUBE-01 e é o que faço — mas com detecção
// explícita: quando o valor devolvido difere do que mandamos, `accessToken()`
// grita no log `[tiktok] refresh_token ROTACIONADO`, SEM imprimir valor nenhum
// (nem prefixo, nem tamanho — meio segredo em log é segredo vazado em duas
// rodadas). Quem lê o log sabe exatamente o que fazer: refazer o /start.
// Guardar em banco resolveria de vez e é uma decisão do Emerson, não minha:
// a OS diz "nada em banco/log" com todas as letras.
// ============================================================================
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Endpoints e constantes do TikTok — todos medidos hoje, ver header.
// ---------------------------------------------------------------------------
const URL_AUTORIZACAO = "https://www.tiktok.com/v2/auth/authorize/";
const URL_TOKEN = "https://open.tiktokapis.com/v2/oauth/token/";
const URL_INIT = "https://open.tiktokapis.com/v2/post/publish/video/init/";
const URL_STATUS = "https://open.tiktokapis.com/v2/post/publish/status/fetch/";
const URL_CRIADOR = "https://open.tiktokapis.com/v2/post/publish/creator_info/query/";

/**
 * `video.publish` é o escopo do Direct Post (o post vai pro perfil).
 * `user.info.basic` vem junto porque é o que o creator_info/query exige e é o
 * mínimo que a doc pede para o fluxo. Vírgula, não espaço — ver header.
 */
export const ESCOPOS = "user.info.basic,video.publish";

/**
 * Precisa bater LETRA POR LETRA com o registrado no painel do TikTok — eles
 * comparam string, e URIs registradas não aceitam parâmetro nem fragmento.
 * Fixo aqui, e não derivado de VERCEL_URL, porque domínio de preview muda a
 * cada deploy e o consent quebraria sozinho.
 */
export const REDIRECT_URI = "https://app.bidcon.com.br/api/tiktok/oauth/callback";

/** Teto do título no post_info, medido: 2200 runas UTF-16. */
const MAX_TITULO = 2200;

/** Espelha o teto do YOUTUBE-01 de propósito: é o mesmo arquivo saindo. */
const TETO_UPLOAD_BYTES = 45 * 1024 * 1024;

/** Máximo de um chunk não-final, medido. Ver "UM CHUNK SÓ" no header. */
const CHUNK_MAX_BYTES = 64 * 1024 * 1024;

const TIMEOUT_TOKEN_MS = 15_000;
const TIMEOUT_DOWNLOAD_MS = 45_000;
const TIMEOUT_UPLOAD_MS = 120_000;

/** Janela de validade do `state`. Consentimento é coisa de minutos. */
const VALIDADE_STATE_MS = 15 * 60 * 1000;

/**
 * Os quatro valores que a API aceita. `SELF_ONLY` é o primeiro da lista de
 * propósito: é o default e é o fallback.
 */
const PRIVACIDADES = [
  "SELF_ONLY",
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
] as const;
type Privacidade = (typeof PRIVACIDADES)[number];

// ---------------------------------------------------------------------------
// Erro sempre literal e sempre curto. Nenhuma função aqui lança.
// ---------------------------------------------------------------------------
export type Resultado<T> = ({ ok: true } & T) | { ok: false; erro: string };

function envs(): { key: string; secret: string } | null {
  const key = process.env.TT_CLIENT_KEY;
  const secret = process.env.TT_CLIENT_SECRET;
  if (!key || !secret) return null;
  return { key, secret };
}

function curto(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === "AbortError") return "timeout";
    return e.message.slice(0, 400);
  }
  return "erro_desconhecido";
}

async function comPrazo(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Privacidade efetiva. Env ausente ou desconhecida => SELF_ONLY. Ver
 * "PRIVACIDADE" no header: o caminho do erro aponta para o privado.
 */
function privacidade(): Privacidade {
  const bruto = (process.env.TT_PRIVACY ?? "").trim().toUpperCase();
  const achado = PRIVACIDADES.find((p) => p === bruto);
  if (bruto && !achado) {
    console.warn("[tiktok] TT_PRIVACY desconhecido, caindo em SELF_ONLY:", bruto);
  }
  return achado ?? "SELF_ONLY";
}

/**
 * O envelope do TikTok. Diferente do Google: a API v2 responde HTTP 200 com
 * `error.code` != "ok" em vários casos. Checar só `resp.ok` deixaria passar
 * falha silenciosa — que aqui significaria gravar um publish_id de um post que
 * nunca existiu.
 */
type Envelope<T> = { data?: T; error?: { code?: string; message?: string; log_id?: string } };

async function lerEnvelope<T>(resp: Response, etapa: string): Promise<Resultado<{ data: T }>> {
  const bruto = await resp.text().catch(() => "");
  let j: Envelope<T>;
  try {
    j = JSON.parse(bruto) as Envelope<T>;
  } catch {
    return { ok: false, erro: `${etapa}: http_${resp.status} ${bruto}`.slice(0, 400) };
  }

  const code = j.error?.code;
  if (code && code !== "ok") {
    const msg = j.error?.message ?? "";
    return { ok: false, erro: `${etapa}: [${code}] ${msg}`.trim().slice(0, 400) };
  }
  if (!resp.ok) {
    return { ok: false, erro: `${etapa}: http_${resp.status} ${bruto}`.slice(0, 400) };
  }
  if (!j.data) return { ok: false, erro: `${etapa}: resposta sem data` };
  return { ok: true, data: j.data };
}

// ===========================================================================
// OAuth — o fluxo de dedo do dono, que roda UMA vez por conta
// ===========================================================================

/**
 * `state` ASSINADO — mesmo motivo do YOUTUBE-01: o callback do OAuth NÃO PODE
 * exigir Bearer, porque quem chega nele é um navegador redirecionado pelo
 * TikTok, sem cabeçalho nenhum. É a única rota da fatia que nasce aberta e é
 * justamente a que imprime credenciais na tela.
 *
 * O PREFIXO "tiktok:" NÃO É ENFEITE. Sem ele, este HMAC seria byte-a-byte
 * idêntico ao do YOUTUBE-01 (mesmo segredo, mesma mensagem), e um `state`
 * emitido pelo /start do YouTube passaria no callback do TikTok e vice-versa.
 * Separar o domínio do assinante custa sete caracteres e fecha isso.
 * É também por isso que estas funções são cópias e não import de
 * lib/youtube/upload.ts: elas produzem valores que NÃO devem ser intercambiáveis.
 */
function mensagem(ts: string): string {
  return `tiktok:${ts}`;
}

export function assinarState(): string | null {
  const secret = process.env.DISPARO_SECRET;
  if (!secret) return null;
  const ts = Date.now().toString();
  const mac = crypto.createHmac("sha256", secret).update(mensagem(ts)).digest("hex");
  return `${ts}.${mac}`;
}

export function verificarState(state: string | null): boolean {
  const secret = process.env.DISPARO_SECRET;
  if (!secret || !state) return false;
  const [ts, mac] = state.split(".");
  if (!ts || !mac) return false;

  const idade = Date.now() - Number(ts);
  if (!Number.isFinite(idade) || idade < 0 || idade > VALIDADE_STATE_MS) return false;

  const esperado = crypto.createHmac("sha256", secret).update(mensagem(ts)).digest("hex");
  // timingSafeEqual exige mesmo tamanho — comparar antes evita o throw.
  if (esperado.length !== mac.length) return false;
  return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(mac));
}

/** URL do consentimento do TikTok. Só monta a string; não fala com ninguém. */
export function urlConsentimento(state: string): Resultado<{ url: string }> {
  const cfg = envs();
  if (!cfg) return { ok: false, erro: "env_ausente(TT_CLIENT_KEY/TT_CLIENT_SECRET)" };

  // URLSearchParams já faz o percent-encoding do redirect_uri que a doc exige.
  const q = new URLSearchParams({
    client_key: cfg.key,
    response_type: "code",
    scope: ESCOPOS,
    redirect_uri: REDIRECT_URI,
    state,
  });
  return { ok: true, url: `${URL_AUTORIZACAO}?${q.toString()}` };
}

/**
 * O endpoint de token NÃO usa o envelope `{data, error}` das demais APIs —
 * responde no formato OAuth clássico, com `error`/`error_description` na raiz.
 * Por isso ele tem leitura própria e não passa por `lerEnvelope`.
 */
type RespostaToken = {
  access_token?: string;
  refresh_token?: string;
  open_id?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function postToken(
  corpo: Record<string, string>,
  etapa: string
): Promise<Resultado<{ data: RespostaToken }>> {
  const resp = await comPrazo(
    URL_TOKEN,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(corpo).toString(),
    },
    TIMEOUT_TOKEN_MS
  );

  const bruto = await resp.text().catch(() => "");
  let j: RespostaToken;
  try {
    j = JSON.parse(bruto) as RespostaToken;
  } catch {
    return { ok: false, erro: `${etapa}: http_${resp.status} ${bruto}`.slice(0, 400) };
  }
  if (j.error) {
    return {
      ok: false,
      erro: `${etapa}: [${j.error}] ${j.error_description ?? ""}`.trim().slice(0, 400),
    };
  }
  if (!resp.ok) return { ok: false, erro: `${etapa}: http_${resp.status} ${bruto}`.slice(0, 400) };
  return { ok: true, data: j };
}

/**
 * Troca o `code` do consentimento pelos tokens. Devolve refresh_token e open_id
 * para quem chamou EXIBIR uma vez — nunca grava e nunca loga (ver a rota do
 * callback). Chamada uma vez na vida da conta.
 */
export async function trocarCodigo(
  code: string
): Promise<Resultado<{ refreshToken: string | null; openId: string | null; escopos: string | null }>> {
  const cfg = envs();
  if (!cfg) return { ok: false, erro: "env_ausente(TT_CLIENT_KEY/TT_CLIENT_SECRET)" };

  try {
    const r = await postToken(
      {
        client_key: cfg.key,
        client_secret: cfg.secret,
        // A doc é explícita: o `code` precisa ir DECODIFICADO. Ele chega
        // percent-encoded na query string e o `searchParams.get` já devolve
        // decodificado — então aqui ele só não pode ser re-encodado. O
        // URLSearchParams do corpo cuida do encoding do transporte.
        code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
      },
      "troca"
    );
    if (!r.ok) return r;

    return {
      ok: true,
      refreshToken: r.data.refresh_token ?? null,
      openId: r.data.open_id ?? null,
      escopos: r.data.scope ?? null,
    };
  } catch (e) {
    return { ok: false, erro: `troca: ${curto(e)}` };
  }
}

/**
 * access_token novo a partir do refresh_token. Vale 24h; não vale a pena
 * cachear numa lambda que morre antes disso.
 *
 * Aqui mora a detecção de rotação descrita no header.
 */
async function accessToken(): Promise<Resultado<{ token: string }>> {
  const cfg = envs();
  if (!cfg) return { ok: false, erro: "env_ausente(TT_CLIENT_KEY/TT_CLIENT_SECRET)" };
  const refresh = process.env.TT_REFRESH_TOKEN;
  if (!refresh) return { ok: false, erro: "env_ausente(TT_REFRESH_TOKEN)" };

  try {
    const r = await postToken(
      {
        client_key: cfg.key,
        client_secret: cfg.secret,
        grant_type: "refresh_token",
        refresh_token: refresh,
      },
      "refresh"
    );
    if (!r.ok) {
      // O caso que a OS mandou tratar e logar claramente. `invalid_grant` é o
      // que o TikTok devolve quando o refresh morreu (365 dias) ou foi
      // revogado; não há conserto automático, só dedo do dono de novo.
      if (r.erro.includes("invalid_grant") || r.erro.includes("invalid_request")) {
        console.error(
          "[tiktok] REFRESH RECUSADO — exige RE-AUTORIZAÇÃO. Rode /api/tiktok/oauth/start " +
            "logado na conta @bidcon e atualize a env TT_REFRESH_TOKEN na Vercel."
        );
      }
      return r;
    }

    if (!r.data.access_token) return { ok: false, erro: "refresh: sem access_token na resposta" };

    // Rotação: comparamos, avisamos, e NÃO imprimimos nenhum dos dois valores.
    if (r.data.refresh_token && r.data.refresh_token !== refresh) {
      console.warn(
        "[tiktok] refresh_token ROTACIONADO pelo TikTok. A env TT_REFRESH_TOKEN está " +
          "DEFASADA e o próximo refresh pode falhar. Refaça /api/tiktok/oauth/start e " +
          "atualize a env. (valor omitido de propósito)"
      );
    }

    return { ok: true, token: r.data.access_token };
  } catch (e) {
    return { ok: false, erro: `refresh: ${curto(e)}` };
  }
}

// ===========================================================================
// Diagnóstico
// ===========================================================================

export type Criador = {
  creator_username?: string;
  creator_nickname?: string;
  privacy_level_options?: string[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
};

/**
 * creator_info/query. A doc diz que este endpoint é obrigatório para "render
 * your export screen" — nós não temos tela de export, somos autônomos, então
 * ele NÃO entra no caminho quente do upload (seria uma chamada a mais para
 * falhar, sem ninguém para ler o resultado).
 *
 * Fica exposto porque serve para duas coisas reais: conferir em qual conta o
 * TT_REFRESH_TOKEN caiu (o erro mais caro deste fluxo é autorizar na conta
 * errada) e ver `privacy_level_options`, que é a resposta da própria plataforma
 * sobre o que esta conta pode publicar hoje.
 */
export async function consultarCriador(): Promise<Resultado<{ criador: Criador }>> {
  const cred = await accessToken();
  if (!cred.ok) return cred;

  try {
    const resp = await comPrazo(
      URL_CRIADOR,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cred.token}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
      },
      TIMEOUT_TOKEN_MS
    );
    const r = await lerEnvelope<Criador>(resp, "criador");
    if (!r.ok) return r;
    return { ok: true, criador: r.data };
  } catch (e) {
    return { ok: false, erro: `criador: ${curto(e)}` };
  }
}

export type StatusPost = {
  status?: string;
  fail_reason?: string;
  publicaly_available_post_id?: string[];
  uploaded_bytes?: number;
};

/** status/fetch. Uma foto do momento — não fica em laço esperando publicar. */
export async function consultarStatus(publishId: string): Promise<Resultado<{ status: StatusPost }>> {
  const cred = await accessToken();
  if (!cred.ok) return cred;

  try {
    const resp = await comPrazo(
      URL_STATUS,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cred.token}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({ publish_id: publishId }),
      },
      TIMEOUT_TOKEN_MS
    );
    const r = await lerEnvelope<StatusPost>(resp, "status");
    if (!r.ok) return r;
    return { ok: true, status: r.data };
  } catch (e) {
    return { ok: false, erro: `status: ${curto(e)}` };
  }
}

// ===========================================================================
// Publicação
// ===========================================================================

export type ParamsPost = {
  /** URL pública do mp4 (o objeto do bucket `farol-videos`). */
  url: string;
  /** Legenda do post. Cortada em MAX_TITULO. */
  titulo: string;
};

/**
 * Sobe o mp4 e manda publicar no perfil (Direct Post).
 *
 * Devolve o `publish_id` assim que o TikTok aceita os bytes. NÃO espera o
 * PUBLISH_COMPLETE: a publicação é assíncrona do lado deles e ficar em laço
 * dentro da fase 2 do FAROL seguraria o fluxo do IG por tempo indeterminado —
 * exatamente o que a OS proíbe ("falha do TikTok NUNCA derruba IG/YouTube").
 * Quem quiser saber o desfecho chama `consultarStatus(publishId)`.
 *
 * NUNCA LANÇA. Devolve `{ok:false, erro}` para o chamador registrar e seguir.
 */
export async function publicarVideo(p: ParamsPost): Promise<Resultado<{ publishId: string }>> {
  const cred = await accessToken();
  if (!cred.ok) return cred;

  // ---- 1. Baixa o mp4 do bucket -------------------------------------------
  let bytes: ArrayBuffer;
  try {
    const resp = await comPrazo(p.url, { method: "GET" }, TIMEOUT_DOWNLOAD_MS);
    if (!resp.ok) return { ok: false, erro: `download: http_${resp.status}` };

    const declarado = Number(resp.headers.get("content-length") ?? "0");
    if (declarado > TETO_UPLOAD_BYTES) {
      return { ok: false, erro: `download: ${declarado}B acima do teto ${TETO_UPLOAD_BYTES}B` };
    }
    bytes = await resp.arrayBuffer();
    if (bytes.byteLength === 0) return { ok: false, erro: "download: arquivo vazio" };
    if (bytes.byteLength > TETO_UPLOAD_BYTES) {
      return {
        ok: false,
        erro: `download: ${bytes.byteLength}B acima do teto ${TETO_UPLOAD_BYTES}B`,
      };
    }
  } catch (e) {
    return { ok: false, erro: `download: ${curto(e)}` };
  }

  const tamanho = bytes.byteLength;

  // Ver "UM CHUNK SÓ" no header: inalcançável com o teto atual, e é justamente
  // por isso que precisa falar quando for alcançado.
  if (tamanho > CHUNK_MAX_BYTES) {
    return {
      ok: false,
      erro: `chunk: ${tamanho}B acima do chunk único de ${CHUNK_MAX_BYTES}B — exige fatiamento`,
    };
  }

  // ---- 2. Inicia o post ----------------------------------------------------
  const corpo = {
    post_info: {
      title: p.titulo.slice(0, MAX_TITULO),
      privacy_level: privacidade(),
      disable_duet: false,
      disable_stitch: false,
      disable_comment: false,
      // Fixo e deliberado — ver DECLARAÇÃO DE IA no header.
      is_aigc: true,
    },
    source_info: {
      source: "FILE_UPLOAD",
      video_size: tamanho,
      chunk_size: tamanho,
      total_chunk_count: 1,
    },
  };

  let uploadUrl: string;
  let publishId: string;
  try {
    const resp = await comPrazo(
      URL_INIT,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cred.token}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify(corpo),
      },
      TIMEOUT_TOKEN_MS
    );
    const r = await lerEnvelope<{ publish_id?: string; upload_url?: string }>(resp, "init");
    if (!r.ok) return r;
    if (!r.data.publish_id || !r.data.upload_url) {
      return { ok: false, erro: "init: resposta sem publish_id/upload_url" };
    }
    publishId = r.data.publish_id;
    uploadUrl = r.data.upload_url;
  } catch (e) {
    return { ok: false, erro: `init: ${curto(e)}` };
  }

  // ---- 3. Manda os bytes ---------------------------------------------------
  try {
    const envio = await comPrazo(
      uploadUrl,
      {
        method: "PUT",
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(tamanho),
          // Chunk único => primeiro byte 0, último tamanho-1, total tamanho.
          "Content-Range": `bytes 0-${tamanho - 1}/${tamanho}`,
        },
        body: bytes,
      },
      TIMEOUT_UPLOAD_MS
    );

    // Medido: 201 é o código do ÚLTIMO chunk (que aqui é o único) e significa
    // "recebi tudo, comecei a publicar". 206 seria chunk intermediário — com um
    // chunk só, receber 206 significa que o TikTok NÃO considerou o upload
    // completo, e tratar isso como sucesso gravaria um publish_id que nunca vai
    // virar post. Por isso 206 aqui é falha, e falha com nome.
    if (envio.status === 206) {
      return { ok: false, erro: "envio: TikTok respondeu 206 (upload incompleto) com chunk único" };
    }
    if (!envio.ok) {
      const bruto = await envio.text().catch(() => "");
      return { ok: false, erro: `envio: http_${envio.status} ${bruto}`.slice(0, 400) };
    }

    return { ok: true, publishId };
  } catch (e) {
    return { ok: false, erro: `envio: ${curto(e)}` };
  }
}
