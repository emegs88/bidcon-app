// ============================================================================
// lib/youtube/upload.ts — cliente YouTube Data API v3 da casa
// AUTORIZADO: Emerson Gomes dos Santos — OS "YOUTUBE-01", 07/08/2026 (~19h):
// "configura api para postagem youtube autonomo". Canal @Bidconoficial (brand
// account), criado no mesmo dia. O mp4 vertical que o FAROL já hospeda no
// bucket público `farol-videos` é o MESMO arquivo que vira Short.
// ----------------------------------------------------------------------------
// NASCE INERTE. Sem YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN nenhuma
// função aqui fala com o Google — devolvem `env_ausente(...)` e ninguém sobe
// nada. O kill-switch de comportamento (`FAROL_YOUTUBE`) vive na rota do FAROL,
// não aqui: uma lib não deve ter opinião sobre quando é hora de publicar.
//
// ---------------------------------------------------------------------------
// POR QUE UM ARQUIVO SÓ, se ele tem OAuth E upload. A OS nomeou
// `lib/youtube/upload.ts` e é o nome que ficou. O que mora aqui é a SUPERFÍCIE
// do YouTube: os quatro endpoints do Google, o escopo, o redirect_uri e as
// funções que os usam. Partir em dois arquivos criaria duas cópias das mesmas
// constantes (endpoint de token e redirect_uri são usados pelo consentimento E
// pelo refresh) — e constante duplicada é como URL de produção diverge.
//
// ---------------------------------------------------------------------------
// A DOC, MEDIDA HOJE (07/08/2026) — cada número aqui tem procedência:
//
//  · Consentimento: GET https://accounts.google.com/o/oauth2/v2/auth com
//    client_id, redirect_uri, response_type=code, scope, access_type=offline,
//    prompt=consent. `access_type=offline` é o que faz o refresh_token existir;
//    `prompt=consent` é o que faz ele vir DE NOVO numa reautorização — sem ele
//    o Google devolve só o access_token na segunda vez e a tela do callback
//    sairia vazia, que é o modo mais fácil de perder uma tarde.
//  · Troca e refresh: POST https://oauth2.googleapis.com/token, corpo
//    application/x-www-form-urlencoded. grant_type=authorization_code na troca,
//    grant_type=refresh_token no refresh.
//  · Upload resumível: POST
//    https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable
//    com X-Upload-Content-Length e X-Upload-Content-Type; a sessão volta no
//    cabeçalho `Location`; os bytes vão num PUT para essa URL.
//  · `snippet.categoryId` é OBRIGATÓRIO em videos.insert (junto de
//    snippet.title). Medido, não suposto — omiti-lo derruba a chamada inteira.
//  · `status.containsSyntheticMedia` EXISTE (YouTube Data API v3, desde
//    30/10/2024) e é gravável em videos.insert. A OS mandou medir se a API
//    expõe o campo: expõe. Ver DECLARAÇÃO DE CONTEÚDO SINTÉTICO abaixo.
//
// ---------------------------------------------------------------------------
// DECLARAÇÃO DE CONTEÚDO SINTÉTICO — `containsSyntheticMedia: true`, FIXO.
// Não é parâmetro e não tem default configurável. O vídeo é um avatar HeyGen
// com voz sintetizada: é literalmente a definição que o Google dá do campo —
// "faz uma pessoa real parecer dizer algo que ela não disse". A casa já
// declara IA na legenda do feed, no private reply e na resposta pública
// (RÓTULO-IA, 07/08); deixar essa declaração fora do YouTube seria transparência
// que para na fronteira da plataforma. Se algum dia o vídeo deixar de ser
// sintético, alguém muda esta linha de propósito — que é mais barato do que
// descobrir que um parâmetro veio `false` por engano.
//
// `madeForKids`: a OS pediu `madeForKids:false`. O campo GRAVÁVEL não tem esse
// nome — `status.madeForKids` é derivado e read-only; quem se declara é
// `status.selfDeclaredMadeForKids`. Usei o gravável. Mesma intenção, campo que
// a API aceita. Desvio de nome declarado.
//
// ---------------------------------------------------------------------------
// O ARQUIVO É BUFFERIZADO, NÃO STREAMADO — desvio declarado. A OS diz "stream
// pro YouTube". O que faço é baixar o mp4 inteiro para a memória e mandar num
// PUT único para a URL de sessão. Três razões medidas:
//   (1) o protocolo resumível EXIGE `X-Upload-Content-Length` na abertura, ou
//       seja: o tamanho exato precisa ser conhecido ANTES do primeiro byte
//       subir. Com stream puro, ou confio no Content-Length do bucket ou não
//       tenho o número — e confiar sem conferir é o que já custou uma rodada
//       hoje (o `fileSizeLimit` do createBucket);
//   (2) o teto medido do arquivo é 45MB e o reel real de hoje deu 13,2MB —
//       cabe folgado na memória de uma lambda, então o stream compraria
//       complexidade sem comprar segurança;
//   (3) buffer permite CONFERIR o tamanho antes de abrir a sessão. Abrir sessão
//       e descobrir no meio que o arquivo é maior que o declarado deixa upload
//       pela metade do lado do Google.
// A sessão resumível continua sendo usada como o Google manda — o que não uso é
// o fatiamento em chunks, que serve para conexão instável e arquivo grande, e
// não é o nosso caso.
// ============================================================================
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Endpoints e constantes do Google — todos medidos hoje, ver header.
// ---------------------------------------------------------------------------
const URL_CONSENTIMENTO = "https://accounts.google.com/o/oauth2/v2/auth";
const URL_TOKEN = "https://oauth2.googleapis.com/token";
const URL_UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos";

/** Escopo mínimo do upload: só subir. Não lê canal, não apaga, não edita. */
export const ESCOPO_UPLOAD = "https://www.googleapis.com/auth/youtube.upload";

/**
 * Escopo das respostas públicas (YT-COMENTA-01). MEDIDO na doc de
 * `comments.insert`: é o ÚNICO escopo aceito por aquele endpoint — não existe
 * um "youtube.comments" estreito. `force-ssl` é largo (lê e escreve o canal),
 * e é largo porque o Google decidiu assim, não porque nós pedimos demais.
 */
export const ESCOPO_COMENTARIO = "https://www.googleapis.com/auth/youtube.force-ssl";

/**
 * O QUE O /oauth/start PEDE. Os dois de uma vez, por decisão do Emerson
 * (07/08/2026): "ESCOPO vira lista com os dois ... usados no /oauth/start".
 *
 * POR QUE OS DOIS NUMA CONSENT SÓ. O canal JÁ FOI autorizado hoje com
 * `youtube.upload` — existe um refresh_token vivo em produção e o Short de
 * amanhã roda com ele. Esta reautorização SUBSTITUI aquele token, não estreia.
 * Pedir os dois juntos faz o Emerson passar pela tela do Google UMA vez em vez
 * de duas, e o token resultante serve às duas fatias.
 *
 * ATENÇÃO OPERACIONAL: enquanto o `YT_REFRESH_TOKEN` em produção for o antigo
 * (só upload), `comments.insert` devolve 403 `insufficientPermissions`. O
 * upload continua funcionando o tempo todo — os escopos não se atrapalham.
 */
export const ESCOPOS = [ESCOPO_UPLOAD, ESCOPO_COMENTARIO] as const;

/**
 * Precisa bater LETRA POR LETRA com o que estiver no Google Cloud Console —
 * o Google compara string, não intenção. Fixo aqui, e não derivado de
 * VERCEL_URL, porque o domínio de preview mudaria a cada deploy e o consent
 * quebraria sozinho.
 */
export const REDIRECT_URI = "https://app.bidcon.com.br/api/youtube/oauth/callback";

/**
 * 22 = "People & Blogs". Medido na doc de videoCategories: é `assignable`, que
 * é a condição para poder ser usada em videos.insert. Categoria genérica de
 * conteúdo com pessoa falando — que é exatamente o que o reel é.
 */
const CATEGORIA_PADRAO = "22";

/** Tetos do próprio YouTube. Cortar aqui é melhor do que tomar 400 por excesso. */
const MAX_TITULO = 100;
const MAX_DESCRICAO = 5000;

/**
 * Teto do arquivo. Espelha o TETO_VIDEO_BYTES da rota do FAROL de propósito, e
 * não importa dele: são duas fronteiras diferentes (lá é o que entra no nosso
 * bucket, aqui é o que sai para o Google). Se um dia divergirem, é porque
 * alguém decidiu que deviam divergir.
 */
const TETO_UPLOAD_BYTES = 45 * 1024 * 1024;

const TIMEOUT_TOKEN_MS = 15_000;
const TIMEOUT_DOWNLOAD_MS = 45_000;
const TIMEOUT_UPLOAD_MS = 120_000;

/** Janela de validade do `state` do OAuth. Consentimento é coisa de minutos. */
const VALIDADE_STATE_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Erro sempre literal e sempre curto. Nenhuma função aqui lança: quem chama
// decide o que fazer, e no caso do FAROL a decisão é "seguir a vida".
// ---------------------------------------------------------------------------
export type Resultado<T> = ({ ok: true } & T) | { ok: false; erro: string };

function envs(): { id: string; secret: string } | null {
  const id = process.env.YT_CLIENT_ID;
  const secret = process.env.YT_CLIENT_SECRET;
  if (!id || !secret) return null;
  return { id, secret };
}

function curto(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === "AbortError") return "timeout";
    return e.message.slice(0, 400);
  }
  return "erro_desconhecido";
}

/** fetch com timeout — o padrão que o resto da casa já usa. */
async function comPrazo(
  url: string,
  init: RequestInit,
  ms: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Mensagem de erro da Google API, achatada para uma linha legível. */
async function erroGoogle(resp: Response): Promise<string> {
  const bruto = await resp.text().catch(() => "");
  try {
    const j = JSON.parse(bruto) as {
      error?: { message?: string; errors?: { reason?: string }[] } | string;
      error_description?: string;
    };
    if (typeof j.error === "string") {
      return `http_${resp.status} ${j.error} ${j.error_description ?? ""}`.trim().slice(0, 400);
    }
    const razao = j.error?.errors?.[0]?.reason;
    const msg = j.error?.message ?? "";
    return `http_${resp.status} ${razao ? `[${razao}] ` : ""}${msg}`.trim().slice(0, 400);
  } catch {
    return `http_${resp.status} ${bruto}`.trim().slice(0, 400);
  }
}

// ===========================================================================
// OAuth — o fluxo de dedo do dono, que roda UMA vez por canal
// ===========================================================================

/**
 * `state` ASSINADO — não estava na OS, e explico por que entrou.
 *
 * O callback do OAuth NÃO PODE exigir Bearer: quem chega nele é o navegador
 * redirecionado pelo Google, sem cabeçalho nenhum. Ou seja, é a única rota
 * desta fatia que nasce aberta — e é justamente a que imprime uma credencial
 * na tela. O `state` é o que amarra o callback ao /start autorizado: sem ele,
 * qualquer pessoa que descubra a URL pode fazer o callback trabalhar.
 *
 * HMAC com o DISPARO_SECRET (que já é o guard do /start) + carimbo de tempo.
 * Sem estado no servidor, sem cookie, sem tabela: o próprio valor carrega a
 * prova de que saiu daqui e de que saiu há pouco.
 */
export function assinarState(): string | null {
  const secret = process.env.DISPARO_SECRET;
  if (!secret) return null;
  const ts = Date.now().toString();
  const mac = crypto.createHmac("sha256", secret).update(ts).digest("hex");
  return `${ts}.${mac}`;
}

export function verificarState(state: string | null): boolean {
  const secret = process.env.DISPARO_SECRET;
  if (!secret || !state) return false;
  const [ts, mac] = state.split(".");
  if (!ts || !mac) return false;

  const idade = Date.now() - Number(ts);
  if (!Number.isFinite(idade) || idade < 0 || idade > VALIDADE_STATE_MS) return false;

  const esperado = crypto.createHmac("sha256", secret).update(ts).digest("hex");
  // timingSafeEqual exige mesmo tamanho — comparar antes evita o throw.
  if (esperado.length !== mac.length) return false;
  return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(mac));
}

/** URL do consentimento do Google. Só monta a string; não fala com ninguém. */
export function urlConsentimento(state: string): Resultado<{ url: string }> {
  const cfg = envs();
  if (!cfg) return { ok: false, erro: "env_ausente(YT_CLIENT_ID/YT_CLIENT_SECRET)" };

  const q = new URLSearchParams({
    client_id: cfg.id,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    // Separador é ESPAÇO — medido na doc de OAuth do Google, e o
    // URLSearchParams cuida do encode. Vírgula é o separador do TikTok, não
    // deste; trocar um pelo outro dá `invalid_scope` sem dizer por quê.
    scope: ESCOPOS.join(" "),
    access_type: "offline", // sem isto não existe refresh_token
    prompt: "consent", // força o refresh_token a vir de novo numa reautorização
    include_granted_scopes: "true",
    state,
  });
  return { ok: true, url: `${URL_CONSENTIMENTO}?${q.toString()}` };
}

/**
 * Troca o `code` do consentimento pelos tokens. Devolve o refresh_token para
 * quem chamou EXIBIR uma vez — nunca grava e nunca loga (ver a rota do
 * callback). Chamada uma vez na vida de cada canal.
 */
export async function trocarCodigo(
  code: string
): Promise<Resultado<{ refreshToken: string | null }>> {
  const cfg = envs();
  if (!cfg) return { ok: false, erro: "env_ausente(YT_CLIENT_ID/YT_CLIENT_SECRET)" };

  try {
    const resp = await comPrazo(
      URL_TOKEN,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: cfg.id,
          client_secret: cfg.secret,
          redirect_uri: REDIRECT_URI,
          grant_type: "authorization_code",
        }).toString(),
      },
      TIMEOUT_TOKEN_MS
    );
    if (!resp.ok) return { ok: false, erro: await erroGoogle(resp) };

    const data = (await resp.json()) as { refresh_token?: string };
    // `null` e não erro: o Google legitimamente omite o refresh_token quando a
    // conta já autorizou antes e o prompt=consent não foi respeitado. Quem
    // chama precisa saber a diferença entre "falhou" e "veio sem".
    return { ok: true, refreshToken: data.refresh_token ?? null };
  } catch (e) {
    return { ok: false, erro: curto(e) };
  }
}

/**
 * access_token novo a partir do refresh_token. Vale ~1h; não vale a pena cachear.
 *
 * EXPORTADO em YT-COMENTA-01 (era privado): `lib/youtube/comentarios.ts` precisa
 * do MESMO token, do MESMO refresh, com a MESMA renovação. Duplicar esta função
 * criaria dois lugares para consertar quando o Google mudar o endpoint, e um
 * deles seria esquecido.
 */
export async function accessToken(): Promise<Resultado<{ token: string }>> {
  const cfg = envs();
  if (!cfg) return { ok: false, erro: "env_ausente(YT_CLIENT_ID/YT_CLIENT_SECRET)" };
  const refresh = process.env.YT_REFRESH_TOKEN;
  if (!refresh) return { ok: false, erro: "env_ausente(YT_REFRESH_TOKEN)" };

  try {
    const resp = await comPrazo(
      URL_TOKEN,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: cfg.id,
          client_secret: cfg.secret,
          refresh_token: refresh,
          grant_type: "refresh_token",
        }).toString(),
      },
      TIMEOUT_TOKEN_MS
    );
    if (!resp.ok) return { ok: false, erro: `refresh: ${await erroGoogle(resp)}` };

    const data = (await resp.json()) as { access_token?: string };
    if (!data.access_token) return { ok: false, erro: "refresh: sem access_token na resposta" };
    return { ok: true, token: data.access_token };
  } catch (e) {
    return { ok: false, erro: `refresh: ${curto(e)}` };
  }
}

// ===========================================================================
// Upload
// ===========================================================================

export type ParamsShort = {
  /** URL pública do mp4 (o objeto do bucket `farol-videos`). */
  url: string;
  titulo: string;
  descricao: string;
  tags: string[];
  /**
   * Default `public`, como a OS mandou: o roteiro do reel já passou pelo
   * `revisarLegenda()` antes do render e de novo antes do IG. Mesma fala, mesma
   * alfândega — não há terceira inspeção a fazer no YouTube.
   */
  privacidade?: "public" | "unlisted" | "private";
  categoriaId?: string;
};

/**
 * Sobe o mp4 como vídeo do canal. Vertical e com menos de 3 min, o YouTube
 * classifica como Short SOZINHO — não existe (e eu procurei) campo de API que
 * diga "isto é um Short". Quem decide é o formato do arquivo.
 *
 * NUNCA LANÇA. Devolve `{ok:false, erro}` para o chamador registrar e seguir.
 */
export async function subirShort(p: ParamsShort): Promise<Resultado<{ videoId: string }>> {
  const cred = await accessToken();
  if (!cred.ok) return cred;

  // ---- 1. Baixa o mp4 do bucket -------------------------------------------
  let bytes: ArrayBuffer;
  try {
    const resp = await comPrazo(p.url, { method: "GET" }, TIMEOUT_DOWNLOAD_MS);
    if (!resp.ok) return { ok: false, erro: `download: http_${resp.status}` };

    // Confere o tamanho ANTES de puxar o corpo quando o servidor declara —
    // recusar cedo é mais barato do que descobrir com o buffer na mão.
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

  // ---- 2. Abre a sessão resumível -----------------------------------------
  const corpo = {
    snippet: {
      title: p.titulo.slice(0, MAX_TITULO),
      description: p.descricao.slice(0, MAX_DESCRICAO),
      tags: p.tags,
      categoryId: p.categoriaId ?? CATEGORIA_PADRAO,
    },
    status: {
      privacyStatus: p.privacidade ?? "public",
      // Campo GRAVÁVEL (o `madeForKids` da OS é derivado e read-only).
      selfDeclaredMadeForKids: false,
      // Fixo e deliberado — ver DECLARAÇÃO DE CONTEÚDO SINTÉTICO no header.
      containsSyntheticMedia: true,
    },
  };

  let sessao: string;
  try {
    const init = await comPrazo(
      `${URL_UPLOAD}?uploadType=resumable&part=snippet,status`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cred.token}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": String(bytes.byteLength),
          "X-Upload-Content-Type": "video/mp4",
        },
        body: JSON.stringify(corpo),
      },
      TIMEOUT_TOKEN_MS
    );
    if (!init.ok) return { ok: false, erro: `sessao: ${await erroGoogle(init)}` };

    const loc = init.headers.get("location");
    if (!loc) return { ok: false, erro: "sessao: sem cabeçalho Location" };
    sessao = loc;
  } catch (e) {
    return { ok: false, erro: `sessao: ${curto(e)}` };
  }

  // ---- 3. Manda os bytes ---------------------------------------------------
  try {
    const envio = await comPrazo(
      sessao,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${cred.token}`,
          "Content-Type": "video/mp4",
        },
        body: bytes,
      },
      TIMEOUT_UPLOAD_MS
    );
    // 200 e 201 são os dois finais felizes do protocolo. 308 significa
    // "recebi parte" — com PUT único isso é um upload incompleto, e tratar
    // como sucesso gravaria um id de vídeo que não existe direito.
    if (!envio.ok) return { ok: false, erro: `envio: ${await erroGoogle(envio)}` };

    const data = (await envio.json()) as { id?: string };
    if (!data.id) return { ok: false, erro: "envio: resposta sem id de vídeo" };
    return { ok: true, videoId: data.id };
  } catch (e) {
    return { ok: false, erro: `envio: ${curto(e)}` };
  }
}
