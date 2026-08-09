// ============================================================================
// rupload.ts — upload RESUMABLE do mp4 direto para a Meta (FASE2-A)
// AUTORIZADO: Emerson Gomes dos Santos — 09/08/2026:
//   "FASE2-A · RESUMABLE UPLOAD — autorizada, com o alvo definido por
//    eliminação. O container_status_bruto chegou (log 16h30): id + status
//    IN_PROGRESS + status_code IN_PROGRESS, e o copyright_check_status voltou
//    AUSENTE. Não é checagem de direitos. Somado ao que você já mediu (mp4
//    irretocável, moov na frente, 9:16, H.264+AAC, URL 200 com accept-ranges),
//    sobra um único trecho opaco: o fetch da Meta na nossa URL. Implemente o
//    upload_type=resumable via rupload.facebook.com, mantendo o caminho atual
//    como fallback atrás de env."
// ----------------------------------------------------------------------------
// O QUE ESTA FATIA ATACA, E O QUE ELA NÃO PROVA.
//
// O caminho de hoje é `video_url`: nós hospedamos o mp4 e a Meta vem BUSCAR.
// Esse fetch dela acontece dentro da infraestrutura dela, sem log nosso — é o
// único trecho da corrente que nunca conseguimos observar. Tudo o que ficava
// antes e depois já foi medido e está limpo. Por eliminação, é ali que o
// container fica IN_PROGRESS para sempre.
//
// O resumable REMOVE esse trecho: em vez de dar uma URL para a Meta buscar,
// nós empurramos os bytes. Se o container continuar travando com os bytes
// entregues na mão, a hipótese do fetch morre e sobra a Meta — e isso é
// informação, não conserto. Se destravar, achamos a causa.
//
// DITO ISSO, ISTO É UMA HIPÓTESE SOB TESTE, NÃO UM CONSERTO ANUNCIADO. Por
// isso nasce atrás de env e desarmado: o caminho atual continua sendo o
// padrão, e trocar de caminho é uma decisão que se toma com o log na mão.
//
// ----------------------------------------------------------------------------
// AS TRÊS ASSIMETRIAS QUE ESTE ARQUIVO EXISTE PARA NÃO DEIXAR PASSAR
//
// O caminho resumable NÃO é "a mesma chamada com outro parâmetro". Ele difere
// da Graph em três pontos, e cada um deles falharia em silêncio se copiado do
// que já temos:
//
//  1. OUTRO HOST. `rupload.facebook.com`, não `graph.instagram.com`. É um
//     endpoint de upload, não da Graph.
//
//  2. OUTRO ESQUEMA DE AUTORIZAÇÃO. A doc pede `Authorization: OAuth <token>`.
//     Todo o resto da casa usa `Bearer`. Copiar o header do `chamarGraph`
//     mandaria `Bearer` para um endpoint que quer `OAuth` — e a resposta seria
//     um erro de autorização que se parece com token vencido, mandando quem
//     depura para o lado errado. É o defeito mais caro possível aqui, porque
//     mente sobre a causa.
//
//  3. OUTRO CORPO. Bytes crus, não JSON. E o tamanho vai no header `file_size`,
//     não no corpo.
//
// ----------------------------------------------------------------------------
// POR QUE NÃO IMPLEMENTEI RETOMADA POR OFFSET (e por que isso não é preguiça)
//
// O protocolo chama-se "resumable" porque aceita continuar de um offset após
// uma queda. Nós mandamos SEMPRE `offset: 0`, ou seja, o arquivo inteiro de
// uma vez. A razão é medida, não estética:
//
//   · o teto de bytes desta rota é 45 MiB (TETO_VIDEO_BYTES) e o reel real de
//     hoje tem 2,6 MB — três ordens de grandeza abaixo de qualquer cenário em
//     que fatiar compense;
//   · retomar exigiria PERSISTIR o offset entre invocações da lambda, o que é
//     mais uma coluna, mais um estado para ficar velho e mais um caminho de
//     idempotência para errar. Estado que não se usa é estado que mente;
//   · a lambda tem `maxDuration = 180`, e o download do HeyGen já cabe nela
//     hoje. Um push de 45 MiB não muda essa conta de categoria.
//
// Se um dia o teto subir a ponto de o push sozinho ameaçar o orçamento, esta
// função é o lugar certo para o offset entrar — e a decisão terá um número
// atrás dela. Hoje não tem.
// ============================================================================

/** A mesma versão da Graph usada no resto do produto. Um produto, uma versão. */
export const RUPLOAD_VERSION = "v25.0";

/**
 * O host de upload da Meta. Note o `facebook.com` mesmo publicando no
 * Instagram: o endpoint é compartilhado e a doc é literal quanto a isso.
 * Não é engano de cópia — está aqui escrito para ninguém "consertar" depois.
 */
export const RUPLOAD_HOST = "https://rupload.facebook.com";

/** Teto de tempo do push. Ver a conta de orçamento no header da rota. */
export const TIMEOUT_RUPLOAD_MS = 60_000;

/**
 * Monta a URL do push. O container_id vai no CAMINHO (não em query), e é por
 * isso que ele precisa existir ANTES: o container resumable nasce vazio,
 * reservando o endereço para onde os bytes vão.
 */
export function urlRupload(containerId: string, versao: string = RUPLOAD_VERSION): string {
  return `${RUPLOAD_HOST}/ig-api-upload/${versao}/${encodeURIComponent(containerId)}`;
}

/**
 * Os headers do push, isolados numa função PARA PODEREM SER TESTADOS SEM REDE.
 * As três assimetrias do header vivem aqui; um teste as lê literalmente, de
 * modo que trocar `OAuth` por `Bearer` numa refatoração futura quebre a suíte
 * em vez de quebrar a publicação.
 *
 * O token NUNCA é logado por quem chama — mas ele passa por aqui, então esta
 * função também não loga nada. Ela não tem `console` nenhum, de propósito.
 */
export function headersRupload(token: string, bytes: number, offset: number = 0): Record<string, string> {
  return {
    Authorization: `OAuth ${token}`,
    offset: String(offset),
    file_size: String(bytes),
    "content-type": "application/octet-stream",
  };
}

export type ResultadoRupload =
  | { ok: true; bytes: number; ms: number }
  | { ok: false; erro: string; bytes: number; ms: number };

/**
 * Interpreta a resposta do rupload. Separada do `fetch` pelo mesmo motivo dos
 * headers: é a parte que tem regra, e regra se testa.
 *
 * A doc diz que o sucesso é `{"success":true,"message":"Upload successful."}`.
 * NÃO basta olhar o status HTTP: exigimos o `success` literal. Um 200 com
 * corpo inesperado é justamente o modo silencioso de falhar que esta fatia
 * existe para eliminar — e tratá-lo como sucesso publicaria um container vazio.
 */
export function lerRespostaRupload(
  httpOk: boolean,
  status: number,
  corpo: unknown
): { ok: true } | { ok: false; erro: string } {
  const c = (corpo ?? {}) as {
    success?: unknown;
    debug_info?: { message?: string; type?: string; retriable?: boolean };
    error?: { message?: string; code?: number };
  };

  if (httpOk && c.success === true) return { ok: true };

  // Erro: repassar LITERAL o que a Meta disse. `retriable` entra no texto
  // porque é a única pista que ela dá sobre insistir ou desistir — e quem lê
  // o log precisa dela sem ter que abrir a doc.
  const d = c.debug_info;
  const partes = [
    `http_${status}`,
    d?.type ? `type=${d.type}` : null,
    d?.retriable !== undefined ? `retriable=${d.retriable}` : null,
    d?.message ?? c.error?.message ?? (httpOk ? "resposta_sem_success" : null),
  ].filter(Boolean);

  return { ok: false, erro: partes.join(" ").slice(0, 800) };
}

/**
 * Empurra os bytes para a Meta. Nunca lança — falha vira erro nomeado, no
 * mesmo contrato de `chamarGraph`.
 *
 * Devolve `ms` SEMPRE, inclusive no erro. É o número que a coordenação pediu
 * ("reporte o custo de tempo/memória do push dos bytes dentro da lambda"), e
 * ele só serve se aparecer também quando dá errado: um push que falha aos 59s
 * conta uma história diferente de um que falha aos 200ms.
 */
export async function enviarBytesResumable(params: {
  // `Uint8Array<ArrayBuffer>` e não `Uint8Array` solto: o tipo genérico solto é
  // `Uint8Array<ArrayBufferLike>`, que inclui `SharedArrayBuffer` e por isso o
  // TS recusa como corpo de `fetch`. Estreitar aqui é honesto — é exatamente o
  // que `new Uint8Array(await resp.arrayBuffer())` produz nos dois chamadores —
  // e evita o cast `as BodyInit`, que calaria o compilador sem provar nada.
  containerId: string;
  bytes: Uint8Array<ArrayBuffer>;
  token: string;
  versao?: string;
  timeoutMs?: number;
}): Promise<ResultadoRupload> {
  const { containerId, bytes, token } = params;
  const timeoutMs = params.timeoutMs ?? TIMEOUT_RUPLOAD_MS;
  const inicio = Date.now();
  const n = bytes.byteLength;

  if (!token) return { ok: false, erro: "env_ausente(IG_ACCESS_TOKEN)", bytes: n, ms: 0 };
  if (n === 0) return { ok: false, erro: "bytes_vazios", bytes: 0, ms: 0 };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(urlRupload(containerId, params.versao), {
      method: "POST",
      headers: headersRupload(token, n),
      body: bytes,
      signal: ctrl.signal,
    });
    const corpo: unknown = await resp.json().catch(() => ({}));
    const lido = lerRespostaRupload(resp.ok, resp.status, corpo);
    const ms = Date.now() - inicio;
    return lido.ok ? { ok: true, bytes: n, ms } : { ok: false, erro: lido.erro, bytes: n, ms };
  } catch (e) {
    const ms = Date.now() - inicio;
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, erro: `timeout_rupload(${timeoutMs}ms)`, bytes: n, ms };
    }
    return {
      ok: false,
      erro: e instanceof Error ? e.message.slice(0, 300) : "erro_desconhecido",
      bytes: n,
      ms,
    };
  } finally {
    clearTimeout(timer);
  }
}
