// ============================================================================
// FAROL-REEL-01 · rota 3 — GET /api/farol/reel-publicar · FASE 2 (publica)
// AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-REEL-01", 06/08/2026:
// "cron 15:00 UTC, mesmo guard; renders pendentes <=24h -> status no HeyGen ->
//  completed: container media_type=REELS com video_url + legenda curta (números
//  + hashtags) passando pelo revisarLegenda() existente -> polling CURTO do
//  container (máx 40s, passo 5s) -> FINISHED: media_publish -> grava post_id.
//  Ainda processando -> próximo ciclo. IDEMPOTENTE: nunca duplicar (checar por
//  video_id antes de criar container; guardar container_id pra retomar)."
// NASCE DESARMADA: sem FAROL_REEL=on, esta rota não fala com ninguém.
// ----------------------------------------------------------------------------
// A IDEMPOTÊNCIA AQUI NÃO É "LEMBRAR DE CHECAR" — É ESTRUTURAL, em três camadas,
// porque a falha que essa rota tem que impedir é a pior de todas: DOIS reels
// iguais no perfil público, que ninguém consegue desfazer sem apagar post.
//
//   (1) `farol_reels.video_id` é UNIQUE no banco. Dois renders não podem virar
//       duas linhas para o mesmo vídeo, nem que a fase 1 rode duas vezes.
//   (2) A LINHA É RECLAMADA COM UPDATE CONDICIONAL antes de qualquer chamada à
//       Meta: `update ... where id=? and status=<o que eu li>`. No Postgres isso
//       é atômico. Duas invocações que leem a mesma linha ao mesmo tempo: uma
//       reclama, a outra recebe zero linhas e PULA. Sem isso, o "checar antes"
//       seria só uma janela de corrida mais estreita, não uma trava.
//   (3) `container_id` é gravado ANTES do media_publish. Se a invocação morrer
//       entre criar o container e publicar, a próxima RETOMA aquele container
//       em vez de criar um segundo — o `if (linha.container_id)` lá embaixo é
//       literalmente esse caminho.
//
// ---------------------------------------------------------------------------
// GET NO CONTAINER: POR QUE UM HELPER LOCAL E NÃO `chamarGraph`. Medi a lib:
// `chamarGraph` de lib/instagram/publicar.ts é POST e monta SEMPRE a URL como
// `<IG_USER_ID>/<caminho>`. O status do container é um GET em `<container_id>`
// — outro verbo e outro sujeito. Mudar a assinatura dela mexeria numa função
// que está em produção publicando no feed, e a OS manda REUSAR, não alterar.
// Então o GET mora aqui, no único lugar que precisa dele, com as MESMAS envs,
// a mesma versão da Graph e o mesmo formato de erro literal. Os dois POSTs
// (media e media_publish) continuam saindo pela lib compartilhada, sem cópia.
//
// POLLING CURTO E COM ORÇAMENTO. A OS pede máx 40s, passo 5s. Além disso, a
// rota só ENTRA no caminho de container se ainda houver tempo de invocação
// sobrando (`ORCAMENTO_MS`): começar um polling de 40s aos 50s de execução é
// como garantir o timeout. Estourou o orçamento, a linha fica 'publicando' e o
// ciclo seguinte retoma — que é exatamente o desenho de (3).
//
// UMA PUBLICAÇÃO POR INVOCAÇÃO. Checar status de vídeo é barato e roda para
// várias linhas; publicar é caro e para na primeira. Dois reels publicados no
// mesmo minuto seria pior do que um reel publicado meia hora depois.
//
// A JANELA DE 24h NÃO É ESTÉTICA: o container de mídia da Meta expira em 24h, e
// um reel de ontem publicado hoje anuncia número que pode não existir mais.
// Passou de 24h sem publicar, a linha é encerrada como 'falhou' com o motivo
// literal, em vez de ficar sendo varrida para sempre.
//
// O REEL PUBLICADO TAMBÉM VAI PARA `farol_posts` com acao='reel_publicado' —
// é o que mantém "o que o FAROL fez ontem?" numa consulta só, e é o que faz a
// memória antirrepetição da fase 1 enxergar os reels.
// ============================================================================
import { NextResponse } from "next/server";
import { createXtvClient } from "@/lib/supabase-xtv";
import { autorizadoFarol, revisarLegenda, registrar } from "@/lib/farol/selecao";
import { chamarGraph } from "@/lib/instagram/publicar";
import { statusVideo, tituloRender } from "@/lib/heygen";
import { subirShort } from "@/lib/youtube/upload";
import { publicarVideo } from "@/lib/tiktok/upload";
import { reais, pctAoMes } from "@/lib/carrossel-formato";
import { LABEL_TIPO_BEM } from "@/lib/status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/**
 * 180s, e não os 60 de antes: o caminho caro agora é orçamento (45s) + download
 * do mp4 (45s) + upload pro bucket (~20s) + polling do container (40s) = 150s de
 * pior caso. 60s garantiria timeout no meio do upload — e um upload cortado ao
 * meio é a única forma de esta rota gravar uma URL que não toca.
 */
export const maxDuration = 180;

/** Mesma versão da Graph que lib/instagram/publicar.ts — um produto, uma versão. */
const IG_GRAPH_VERSION = "v25.0";
const TIMEOUT_IG_MS = 15_000;

/** Regra da OS: polling curto do container. */
const POLL_MAX_MS = 40_000;
const POLL_PASSO_MS = 5_000;

/**
 * Só entra no caminho caro se ainda couber o trabalho inteiro com folga. Subiu
 * de 12s para 45s junto com o maxDuration: o caminho caro deixou de ser "um
 * POST + polling" e passou a incluir baixar e subir dezenas de MB.
 */
const ORCAMENTO_MS = 45_000;

/** Bucket público do xtv onde o mp4 do reel passa a morar. */
const BUCKET_VIDEOS = "farol-videos";

/**
 * Teto defensivo: reel de ~31s em 1080p dá 10–25MB. Acima disto é bug, não vídeo.
 *
 * ERA 80MB e isso QUEBROU o primeiro tique (20:10:08 de 07/08): o valor ia
 * também como `fileSizeLimit` do bucket, e o projeto tem um limite GLOBAL de
 * upload menor que isso — o `createBucket` inteiro voltou
 * "The object exceeded the maximum allowed size" e o bucket nunca nasceu.
 * 45MB fica sob qualquer teto global de projeto e ainda dá ~2x de folga sobre o
 * maior reel plausível. O limite agora vive SÓ aqui, no código (ver garantirBucket).
 */
const TETO_VIDEO_BYTES = 45 * 1024 * 1024;

/** Timeout do download do mp4 no HeyGen. Ver a conta no maxDuration. */
const TIMEOUT_VIDEO_MS = 45_000;

/** Container da Meta expira em 24h — ver header. */
const JANELA_HORAS = 24;

/** Quantas linhas pendentes olhar por invocação (checagem de status é barata). */
const LIMITE_LINHAS = 5;

/**
 * Idade a partir da qual um container 'publicando' vira suspeito de zumbi.
 * 20 min é folgado de propósito: o polling normal é de 40s e o ciclo agora é de
 * 10 min, então um container saudável tem ~30 leituras antes de ser tocado.
 */
const IDADE_ZUMBI_MS = 20 * 60 * 1000;

/**
 * Limiar MAIOR para container criado com a NOSSA URL hospedada.
 *
 * Medido em 07/08: com a URL própria o dedupe da Meta continua valendo — resetar
 * e pedir de novo devolveu o MESMO id. Então, para estes, o reset por idade não
 * é resgate: é roleta. E a conta tem contexto — a conta do Instagram estreou
 * ontem e este é o primeiro REEL dela; demora legítima é a hipótese mais barata
 * antes de acusar travamento. 60 min dá seis leituras de ciclo antes de tocar.
 */
const IDADE_ZUMBI_HOSPEDADO_MS = 60 * 60 * 1000;

/**
 * Campos pedidos ao container. `status` é o verboso — é ali que a Meta escreve a
 * RECLAMAÇÃO por extenso quando há uma; `status_code` é só a palavra seca.
 * Pedimos os dois porque um código sem frase não diagnostica nada.
 */
const CAMPOS_CONTAINER = "id,status,status_code";

type LinhaReel = {
  id: string;
  carta_id: string | null;
  video_id: string;
  container_id: string | null;
  status: string;
  legenda: string | null;
  detalhe: Record<string, unknown> | null;
  criado_em: string;
  atualizado_em: string | null;
};

/**
 * GET no container da Meta. Existe aqui, e não na lib, pelo motivo do header.
 * Nunca lança; erro da Graph repassado literal (code/subcode/message).
 */
type LeituraContainer =
  | { ok: true; code: string; bruto: unknown }
  | { ok: false; erro: string; bruto: unknown };

async function statusContainer(
  containerId: string,
  campos: string = CAMPOS_CONTAINER
): Promise<LeituraContainer> {
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) return { ok: false, erro: "env_ausente(IG_ACCESS_TOKEN)", bruto: null };

  const url =
    `https://graph.instagram.com/${IG_GRAPH_VERSION}/${containerId}` +
    `?fields=${encodeURIComponent(campos)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_IG_MS);
  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    const data: unknown = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = (data as {
        error?: { message?: string; code?: number; error_subcode?: number };
      })?.error;

      // REDE DE SEGURANÇA do campo verboso: se a Graph recusar por causa de um
      // campo (code 100 é "campo inválido/inexistente"), relê pedindo SÓ o
      // `status_code`, que é o conjunto que esta rota já usava e que está
      // medido em produção. Instrumentar não pode custar a leitura de estado —
      // ficar cego ao container é pior do que ficar sem a frase da Meta.
      if (campos !== "status_code" && err?.code === 100) {
        console.warn("[farol-reel] campos do container recusados, relendo seco:", {
          campos,
          erro: err?.message,
        });
        return statusContainer(containerId, "status_code");
      }

      const partes = [
        err?.code !== undefined ? `code=${err.code}` : null,
        err?.error_subcode !== undefined ? `subcode=${err.error_subcode}` : null,
        err?.message ?? `http_${resp.status}`,
      ].filter(Boolean);
      return { ok: false, erro: partes.join(" ").slice(0, 500), bruto: data };
    }
    const code = (data as { status_code?: string })?.status_code;
    return { ok: true, code: String(code ?? "DESCONHECIDO"), bruto: data };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, erro: `timeout_instagram_api(${TIMEOUT_IG_MS}ms)`, bruto: null };
    }
    return {
      ok: false,
      erro: e instanceof Error ? e.message.slice(0, 500) : "erro_desconhecido",
      bruto: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

const db_ = () => createXtvClient();
type Db = ReturnType<typeof db_>;

/** Toda escrita na fila passa por aqui, para `atualizado_em` nunca ser esquecido. */
async function atualizar(
  db: Db,
  id: string,
  campos: Record<string, unknown>
): Promise<void> {
  const { error } = await db
    .from("farol_reels")
    .update({ ...campos, atualizado_em: new Date().toISOString() })
    .eq("id", id);
  if (error) console.error("[farol-reel] falha atualizando farol_reels:", error.message);
}

/**
 * Cria o bucket se ainda não existir. Idempotente de propósito: "já existe" é
 * SUCESSO, não erro — a rota roda a cada 10 min e não pode depender de alguém
 * ter clicado no painel do Supabase antes.
 */
async function garantirBucket(db: Db): Promise<void> {
  // SÓ `public: true`, de propósito — mesmo formato do único bucket que a casa
  // já tem (`wa-extratos`, medido: file_size_limit e allowed_mime_types nulos).
  // Passar `fileSizeLimit` maior que o teto global do projeto faz o createBucket
  // falhar por inteiro, que foi exatamente o que derrubou o tique das 20:10.
  // O teto de tamanho e o tipo do arquivo já são garantidos aqui no código
  // (TETO_VIDEO_BYTES antes do upload, contentType fixo em video/mp4) — repetir
  // isso na config do bucket não comprava segurança nova e custou uma rodada.
  const { error } = await db.storage.createBucket(BUCKET_VIDEOS, { public: true });
  if (error && !/exist/i.test(error.message)) {
    throw new Error(`bucket_falhou: ${error.message}`);
  }
}

/**
 * Baixa o mp4 do HeyGen e o guarda em casa, devolvendo a URL pública.
 *
 * POR QUE ISTO EXISTE — medido em produção hoje, não suposto: a URL do HeyGen é
 * presignada e expira, e a Meta DEDUPLICA a criação do container pelo objeto —
 * a mesma video_url devolveu sempre o MESMO container_id (17878184478684841),
 * estacionado em IN_PROGRESS por mais de uma hora. Com a URL de terceiro, o
 * container zumbi era imortal: a autocura resetava, pedia outro, e a Meta
 * devolvia o mesmo. Hospedar mata os três problemas de uma vez — a URL fica
 * estável, é rápida (mesma região do banco) e é NOVA a cada objeto, então o
 * dedupe da Meta não tem em que se agarrar.
 *
 * BENEFÍCIO LATERAL, registrado a pedido da coordenação: este mp4 é o asset
 * oficial para repost manual no TikTok enquanto a auditoria deles não sai. Ele
 * não é subproduto do Instagram — é o arquivo, e mora num endereço estável.
 *
 * Nunca lança para o laço: devolve erro literal, e o chamador decide.
 */
async function hospedarVideo(
  db: Db,
  videoId: string,
  videoUrl: string
): Promise<{ ok: true; url: string } | { ok: false; erro: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_VIDEO_MS);
  try {
    await garantirBucket(db);

    const resp = await fetch(videoUrl, { signal: ctrl.signal });
    if (!resp.ok) return { ok: false, erro: `download_http_${resp.status}` };

    const bytes = new Uint8Array(await resp.arrayBuffer());
    // Zero byte é o modo silencioso de falhar de URL expirada: 200 com corpo
    // vazio. Subir isso publicaria um reel quebrado no perfil público.
    if (bytes.byteLength === 0) return { ok: false, erro: "download_vazio" };
    if (bytes.byteLength > TETO_VIDEO_BYTES) {
      return { ok: false, erro: `download_grande(${bytes.byteLength}b)` };
    }

    // `upsert` + nome derivado do video_id = idempotência do objeto: rodar duas
    // vezes reescreve o mesmo arquivo, nunca cria um segundo.
    const path = `${videoId}.mp4`;
    const up = await db.storage.from(BUCKET_VIDEOS).upload(path, bytes, {
      contentType: "video/mp4",
      upsert: true,
    });
    if (up.error) return { ok: false, erro: `upload_falhou: ${up.error.message}` };

    const { data } = db.storage.from(BUCKET_VIDEOS).getPublicUrl(path);
    if (!data?.publicUrl) return { ok: false, erro: "sem_url_publica" };

    console.log("[farol-reel] vídeo hospedado:", {
      video_id: videoId,
      bytes: bytes.byteLength,
      url: data.publicUrl,
    });
    return { ok: true, url: data.publicUrl };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, erro: `timeout_download(${TIMEOUT_VIDEO_MS}ms)` };
    }
    return {
      ok: false,
      erro: e instanceof Error ? e.message.slice(0, 300) : "erro_desconhecido",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reclama a linha com UPDATE CONDICIONAL — a trava (2) do header.
 * Devolve false quando outra invocação chegou primeiro.
 */
async function reclamar(db: Db, linha: LinhaReel): Promise<boolean> {
  const { data, error } = await db
    .from("farol_reels")
    .update({ status: "publicando", atualizado_em: new Date().toISOString() })
    .eq("id", linha.id)
    .eq("status", linha.status)
    .select("id");
  if (error) {
    console.error("[farol-reel] falha reclamando linha:", error.message);
    return false;
  }
  return (data ?? []).length > 0;
}

/**
 * Espera o container ficar FINISHED. Devolve o veredito ou 'demorou' — que NÃO
 * é falha: é "tenta no próximo ciclo", e é o caso comum de vídeo grande.
 */
async function esperarContainer(
  containerId: string
): Promise<
  | { fim: "pronto" }
  | { fim: "falhou"; erro: string }
  | { fim: "demorou"; ultimo: string }
> {
  const limite = Date.now() + POLL_MAX_MS;
  let ultimo = "SEM_LEITURA";
  let primeira = true;
  while (Date.now() < limite) {
    const s = await statusContainer(containerId);

    // A RESPOSTA INTEIRA, uma vez por tique — não um campo escolhido por mim.
    // Motivo: até agora esta rota só sabia dizer "IN_PROGRESS" porque só
    // perguntava `status_code`. Se a Meta está reclamando de alguma coisa (o
    // fetch do vídeo, o codec, a duração), a frase vem no campo `status`, e
    // nenhum relatório meu vale mais do que ela. Uma vez por tique e não por
    // leitura: são até 8 polls por invocação e 8 cópias do mesmo objeto seriam
    // ruído, não instrumentação.
    if (primeira) {
      primeira = false;
      console.log("[farol-reel] container_status_bruto:", {
        container_id: containerId,
        ok: s.ok,
        resposta: s.bruto,
        ...(s.ok ? {} : { erro: s.erro }),
      });
    }

    if (!s.ok) return { fim: "falhou", erro: `status_container: ${s.erro}` };
    ultimo = s.code;
    // Valores medidos na doc de Content Publishing da Meta:
    // EXPIRED | ERROR | FINISHED | IN_PROGRESS | PUBLISHED.
    if (s.code === "FINISHED" || s.code === "PUBLISHED") return { fim: "pronto" };
    if (s.code === "ERROR" || s.code === "EXPIRED") {
      return { fim: "falhou", erro: `container_${s.code.toLowerCase()}` };
    }
    await new Promise((r) => setTimeout(r, POLL_PASSO_MS));
  }
  return { fim: "demorou", ultimo };
}

export async function GET(req: Request) {
  if (!autorizadoFarol(req)) {
    return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  }

  if (process.env.FAROL_REEL !== "on") {
    console.log("[farol-reel] represado (desarmado)");
    return NextResponse.json({ ok: true, publicou: false, motivo: "desarmado" });
  }

  const inicio = Date.now();
  const db = createXtvClient();
  const desde = new Date(Date.now() - JANELA_HORAS * 60 * 60 * 1000).toISOString();

  try {
    const { data, error } = await db
      .from("farol_reels")
      .select(
        "id,carta_id,video_id,container_id,status,legenda,detalhe,criado_em,atualizado_em"
      )
      .in("status", ["renderizando", "pronto", "publicando"])
      .gte("criado_em", desde)
      .order("criado_em", { ascending: true })
      .limit(LIMITE_LINHAS);
    if (error) throw new Error(`farol_reels_ilegivel: ${error.message}`);

    const pendentes = (data ?? []) as LinhaReel[];

    // Encerra o que passou da janela — antes de olhar os vivos, para que a fila
    // não cresça sem fim com renders que nunca vão publicar.
    await encerrarVencidos(db, desde);

    if (pendentes.length === 0) {
      console.log("[farol-reel] nada pendente");
      return NextResponse.json({ ok: true, publicou: false, motivo: "nada_pendente" });
    }

    const olhados: Record<string, string>[] = [];

    for (const linha of pendentes) {
      // ---- (3) Retomada: container já existe, não cria outro ---------------
      if (linha.container_id) {
        if (Date.now() - inicio > ORCAMENTO_MS) {
          olhados.push({ video_id: linha.video_id, resultado: "sem_orcamento" });
          break;
        }

        // Container LEGADO = criado com a URL expirável do HeyGen, antes desta
        // fatia. Reconhecido pela ausência de `url_hospedada` no detalhe, e não
        // por um id chumbado no código: o 17878184478684841 é o caso de hoje,
        // a condição é a regra. Esses containers não melhoram com o tempo —
        // são exatamente os que a Meta devolve iguais para sempre — então a
        // espera de 20 min não compra informação nenhuma e é dispensada.
        const detAtual = (linha.detalhe ?? {}) as { url_hospedada?: string };
        const legado = !detAtual.url_hospedada;

        // Container hospedado espera 60 min, não 20. Ver IDADE_ZUMBI_HOSPEDADO_MS:
        // para ele o reset não é resgate, porque a Meta devolve o mesmo id.
        const limiteMs = legado ? IDADE_ZUMBI_MS : IDADE_ZUMBI_HOSPEDADO_MS;

        const z = await checarZumbi(linha, linha.container_id, legado, limiteMs);
        if (z.zumbi) {
          // Autocura: zera o container e NÃO dá `continue` — cai no caminho
          // normal logo abaixo, que relê o HeyGen, HOSPEDA o mp4 e só então
          // pede um container novo.
          // CORRIGINDO A PREMISSA ORIGINAL desta autocura, que a medição de
          // 07/08 refutou: não bastava "recriar com video_url fresca". Com a
          // URL do HeyGen, a Meta devolvia o MESMO container — o reset girava
          // em falso a cada 10 min. O que realmente quebra o ciclo é a URL ser
          // NOSSA e nova; o reset sozinho nunca resolveu nada.
          console.warn("[farol-reel] container zumbi resetado", {
            container_id: linha.container_id,
            idade_min: z.idadeMin,
            limite_min: Math.round(limiteMs / 60_000),
            motivo: legado ? "sem_url_hospedada" : "idade",
          });
          // Guarda o id ABANDONADO para poder reconhecer o dedupe lá embaixo:
          // se a Meta devolver este mesmo id no lugar de um novo, o reset foi
          // roleta e queremos que isso fique escrito, não deduzido.
          const detReset = {
            ...(linha.detalhe ?? {}),
            container_anterior: linha.container_id,
          };
          await atualizar(db, linha.id, { container_id: null, detalhe: detReset });
          linha.detalhe = detReset;
          linha.container_id = null;
        } else {
          const r = await publicarContainer(db, linha, linha.container_id);
          olhados.push({ video_id: linha.video_id, resultado: r });
          if (r === "publicado" || r === "falhou") break;
          continue;
        }
      }

      // ---- Estado do render no HeyGen -------------------------------------
      const det = (linha.detalhe ?? {}) as {
        avatar_tipo?: string;
        data?: string;
        tipo?: string;
      };
      const tipoAvatar = String(det.avatar_tipo ?? "avatar");
      // Título = chave de resgate quando o id guardado não resolve (404 do
      // HeyGen). Reconstruído do `detalhe` que a PRÓPRIA fase 1 gravou, pela
      // mesma função que a fase 1 usa para montá-lo. Se o detalhe não tiver os
      // campos, vai `null` e o comportamento é o de antes: 404 vira pendente.
      const titulo = det.data && det.tipo ? tituloRender(det.data, det.tipo) : null;
      const s = await statusVideo(linha.video_id, tipoAvatar, titulo);
      if (!s.ok) {
        // Falha de LEITURA não condena o render: pode ser 429 ou rede. Espera.
        console.error("[farol-reel] status do vídeo ilegível:", {
          video_id: linha.video_id,
          erro: s.erro,
        });
        olhados.push({ video_id: linha.video_id, resultado: `status_ilegivel` });
        continue;
      }

      if (s.data.idResolvido && s.data.idResolvido !== linha.video_id) {
        // O estado veio pelo resgate por título: o HeyGen conhece este vídeo
        // por OUTRO id. Registro e sigo publicando — o id guardado continua
        // sendo a chave de idempotência desta linha (UNIQUE), e reescrevê-lo
        // no meio do laço mexeria nessa chave sem necessidade. Trocar de chave
        // é decisão do Emerson, não efeito colateral de uma leitura.
        console.warn("[farol-reel] id divergente (resgatado por título):", {
          guardado: linha.video_id,
          heygen: s.data.idResolvido,
        });
      }

      if (s.data.estado === "falhou") {
        console.error("[farol-reel] render falhou no HeyGen:", {
          video_id: linha.video_id,
          bruto: s.data.bruto,
          erro: s.data.erro,
        });
        await atualizar(db, linha.id, {
          status: "falhou",
          erro: `heygen_${s.data.bruto}: ${s.data.erro ?? "sem_mensagem"}`.slice(0, 500),
        });
        await registrar(db, "reel_falhou", linha.carta_id, null, {
          video_id: linha.video_id,
          erro: s.data.erro,
        });
        olhados.push({ video_id: linha.video_id, resultado: "falhou_no_heygen" });
        continue;
      }

      if (s.data.estado === "processando") {
        olhados.push({ video_id: linha.video_id, resultado: "renderizando" });
        continue;
      }

      // `pronto` sem URL não sai de `lerStatus`, mas o tipo permite — e daqui
      // pra frente a URL é obrigatória. Estreita aqui, uma vez, em vez de `!`
      // espalhado adiante.
      if (!s.data.videoUrl) {
        console.error("[farol-reel] pronto sem video_url:", { video_id: linha.video_id });
        olhados.push({ video_id: linha.video_id, resultado: "sem_video_url" });
        continue;
      }

      // ---- Pronto: caminho caro. Orçamento e reclamação antes da Meta ------
      if (Date.now() - inicio > ORCAMENTO_MS) {
        olhados.push({ video_id: linha.video_id, resultado: "sem_orcamento" });
        break;
      }
      if (!(await reclamar(db, linha))) {
        olhados.push({ video_id: linha.video_id, resultado: "reclamada_por_outra" });
        continue;
      }

      const legenda = linha.legenda ?? "";
      // Última medição de compliance antes do perfil público. A fase 1 já mediu;
      // esta é a que vale, porque é a que fica publicada.
      const reprovada = revisarLegenda(legenda);
      if (!legenda || reprovada) {
        const motivo = reprovada ?? "legenda_vazia";
        console.error("[farol-reel] legenda reprovada na publicação:", motivo);
        await atualizar(db, linha.id, { status: "falhou", erro: `legenda:${motivo}` });
        olhados.push({ video_id: linha.video_id, resultado: `legenda_${motivo}` });
        break;
      }

      // ---- Hospedagem: o mp4 passa a morar em casa -------------------------
      // Reaproveita o que já estiver hospedado (o objeto é idempotente por
      // video_id), para que uma republicação não pague o download de novo.
      const detPre = (linha.detalhe ?? {}) as { url_hospedada?: string };
      let urlPublica = detPre.url_hospedada ?? null;
      if (!urlPublica) {
        const h = await hospedarVideo(db, linha.video_id, s.data.videoUrl);
        if (!h.ok) {
          // Falha de hospedagem NÃO condena o render: a linha fica 'publicando'
          // com container_id nulo e o próximo ciclo tenta de novo do zero.
          // `break` e não `continue` porque esta invocação já gastou o
          // orçamento pesado — insistir noutra linha convida o timeout.
          console.error("[farol-reel] hospedagem falhou:", {
            video_id: linha.video_id,
            erro: h.erro,
          });
          olhados.push({ video_id: linha.video_id, resultado: "hospedagem_falhou" });
          break;
        }
        urlPublica = h.url;
        // Grava ANTES de criar o container, pelo mesmo motivo da trava (3): se
        // a invocação morrer no meio, a próxima reaproveita o upload em vez de
        // refazê-lo — e é este campo que distingue container novo de legado.
        const detalheNovo = { ...(linha.detalhe ?? {}), url_hospedada: urlPublica };
        await atualizar(db, linha.id, { detalhe: detalheNovo });
        linha.detalhe = detalheNovo;
      }

      // A Meta recebe a NOSSA URL: estável, sem expiração e distinta por objeto
      // — que é o que quebra o dedupe de container medido hoje.
      const container = await chamarGraph("media", {
        media_type: "REELS",
        video_url: urlPublica,
        caption: legenda,
        share_to_feed: true,
      });
      if (!container.ok) {
        console.error("[farol-reel] container recusado:", {
          video_id: linha.video_id,
          erro: container.erro,
        });
        await atualizar(db, linha.id, {
          status: "falhou",
          erro: `container: ${container.erro}`.slice(0, 500),
        });
        await registrar(db, "reel_falhou", linha.carta_id, null, {
          video_id: linha.video_id,
          erro: container.erro,
        });
        olhados.push({ video_id: linha.video_id, resultado: "container_recusado" });
        break;
      }

      // ---- Anti-roleta: a Meta devolveu o MESMO container? -----------------
      // Se devolveu, o reset não resgatou nada — só girou. Fica registrado no
      // log E no detalhe, para o próximo ciclo saber sem precisar deduzir.
      const detPos = (linha.detalhe ?? {}) as { container_anterior?: string };
      const idNovo = String(container.id ?? "");
      const dedupou = !!detPos.container_anterior && detPos.container_anterior === idNovo;

      const detalheFinal: Record<string, unknown> = { ...(linha.detalhe ?? {}) };
      delete detalheFinal.container_anterior;
      if (dedupou) {
        console.warn("[farol-reel] dedupe_confirmado", { container_id: idNovo });
        // Carimbo NOVO a cada confirmação, e não o primeiro preservado. Se
        // guardasse o primeiro, a idade já nasceria vencida no tique seguinte e
        // a roleta voltaria a girar de 10 em 10 min — exatamente o que esta
        // regra existe para impedir. Renovando, o próximo reset só é possível
        // depois do limiar CHEIO contado daqui.
        detalheFinal.dedupe_confirmado_em = new Date().toISOString();
      } else {
        // Id diferente: o dedupe se soltou. O relógio volta ao normal.
        delete detalheFinal.dedupe_confirmado_em;
      }

      // GRAVA O CONTAINER ANTES DE PUBLICAR — trava (3) do header.
      await atualizar(db, linha.id, {
        status: "publicando",
        container_id: container.id,
        detalhe: detalheFinal,
      });
      linha.detalhe = detalheFinal;

      const r = await publicarContainer(db, linha, container.id as string);
      olhados.push({ video_id: linha.video_id, resultado: r });
      break;
    }

    const publicou = olhados.some((o) => o.resultado === "publicado");
    console.log("[farol-reel] fase 2:", { pendentes: pendentes.length, olhados });
    return NextResponse.json({ ok: true, publicou, olhados });
  } catch (e) {
    const erro = e instanceof Error ? e.message.slice(0, 500) : "erro_desconhecido";
    console.error("[farol-reel] erro na fase 2:", erro);
    return NextResponse.json({ ok: false, erro }, { status: 500 });
  }
}

/**
 * Espera o container e publica. Compartilhado pelo caminho novo e pela retomada
 * — que é o que garante que retomar seja o MESMO código, e não um primo dele.
 */
async function publicarContainer(
  db: Db,
  linha: LinhaReel,
  containerId: string
): Promise<string> {
  const espera = await esperarContainer(containerId);

  if (espera.fim === "demorou") {
    // Não é falha. A linha fica 'publicando' com container_id, e o próximo
    // ciclo entra direto pela retomada.
    console.log("[farol-reel] container ainda processando:", {
      video_id: linha.video_id,
      container_id: containerId,
      ultimo: espera.ultimo,
    });
    return "container_processando";
  }

  if (espera.fim === "falhou") {
    console.error("[farol-reel] container falhou:", {
      video_id: linha.video_id,
      container_id: containerId,
      erro: espera.erro,
    });
    await atualizar(db, linha.id, { status: "falhou", erro: espera.erro.slice(0, 500) });
    await registrar(db, "reel_falhou", linha.carta_id, null, {
      video_id: linha.video_id,
      container_id: containerId,
      erro: espera.erro,
    });
    return "falhou";
  }

  const publicado = await chamarGraph("media_publish", { creation_id: containerId });
  if (!publicado.ok) {
    // SEM RETRY IMEDIATO AQUI, ao contrário do post de feed: lá o container é
    // uma imagem e o erro transitório passa em 3s. Aqui o container é vídeo e
    // já foi confirmado FINISHED — um erro neste ponto é recusa, não pressa.
    // A linha continua 'publicando' com container_id, e o ciclo seguinte
    // retoma o MESMO container. É a segunda tentativa, sem risco de duplicar.
    console.error("[farol-reel] publicação recusada:", {
      video_id: linha.video_id,
      container_id: containerId,
      erro: publicado.erro,
    });
    await atualizar(db, linha.id, { erro: `publish: ${publicado.erro}`.slice(0, 500) });
    return "publicacao_recusada";
  }

  await atualizar(db, linha.id, {
    status: "publicado",
    post_id: publicado.id,
    erro: null,
  });
  await registrar(db, "reel_publicado", linha.carta_id, publicado.id ?? null, {
    video_id: linha.video_id,
    container_id: containerId,
  });

  console.log("[farol-reel] reel publicado:", {
    post_id: publicado.id,
    video_id: linha.video_id,
    carta_id: linha.carta_id,
  });

  // YOUTUBE-01: o MESMO mp4 vira Short. Depois do IG e fora do caminho crítico
  // — ver `subirParaYoutube`, que nunca lança e nunca muda o veredito abaixo.
  await subirParaYoutube(db, linha);

  // TIKTOK-01: o MESMO mp4, terceira casa. Roda DEPOIS do YouTube e é
  // igualmente inofensiva ao veredito. A ordem importa por um motivo só: o
  // `subirParaYoutube` acima sincroniza `linha.detalhe` em memória depois de
  // gravar, então o spread aqui embaixo preserva o `yt_video_id` em vez de
  // sobrescrevê-lo com uma cópia velha do objeto.
  await subirParaTiktok(db, linha);

  return "publicado";
}

// ===========================================================================
// YOUTUBE-01 — o mesmo mp4 como Short do @Bidconoficial
// AUTORIZADO: Emerson Gomes dos Santos — OS "YOUTUBE-01", 07/08/2026:
// "após media_publish do IG com sucesso, se env FAROL_YOUTUBE=on: subir o MESMO
//  mp4 como Short (...). Falha do YouTube NUNCA derruba o fluxo do IG — try/catch
//  isolado, log [farol-youtube]."
// ---------------------------------------------------------------------------
// NASCE DESARMADO. Sem `FAROL_YOUTUBE=on` esta função sai na primeira linha, e
// o FAROL segue publicando no Instagram como publicava ontem.
//
// O IG É O DONO DO VEREDITO. Esta função é `void` de propósito: não devolve
// nada que possa mudar o `return "publicado"` de cima. O reel JÁ ESTÁ NO AR no
// Instagram quando ela roda — deixar o YouTube reprovar isso seria contar uma
// mentira sobre um fato que já aconteceu. Ela captura tudo, registra e cala.
//
// IDEMPOTÊNCIA POR `detalhe.yt_video_id`. A fase 2 pode passar de novo pela
// mesma linha (retomada, disparo manual da validação da OS). Sem esta trava, o
// mesmo Short subiria duas vezes — e o YouTube, ao contrário da Meta, NÃO
// deduplica: aceita o upload repetido e cria um segundo vídeo.
//
// O MP4 VEM DO NOSSO BUCKET, não do HeyGen. `detalhe.url_hospedada` é estável e
// sem expiração; a URL do HeyGen vence. Linha legada sem esse campo é pulada com
// motivo literal, e não com um erro de download meia hora depois.
// ===========================================================================

/** Tags fixas — mesma família das hashtags do reel, sem o `#`. */
const TAGS_YOUTUBE = [
  "consorcio",
  "carta contemplada",
  "planejamento",
  "patrimonio",
  "bidcon",
];

const CANAL_YOUTUBE = "https://youtube.com/@Bidconoficial";

/**
 * Título curto, no formato da OS: "{tipo} de {crédito} · custo {custo} | Bidcon".
 *
 * O custo sai de `pctAoMes()`, que já entrega "0,65% a.m." — a OS escreveu
 * "custo {custo} a.m." com o sufixo à mão, mas repetir o sufixo aqui daria
 * "0,65% a.m. a.m.". Uso o formatador canônico da casa e o texto renderizado é
 * exatamente o que a OS pediu. Mesma regra do CLAUDE.md: custo SEMPRE em % a.m.
 */
function tituloShort(det: {
  tipo?: string;
  credito?: number;
  custo_am?: number | null;
}): string {
  const label = LABEL_TIPO_BEM[det.tipo ?? ""] ?? "Carta contemplada";
  const credito = typeof det.credito === "number" ? reais(det.credito) : null;
  const custo = pctAoMes(det.custo_am ?? null);

  const partes = [credito ? `${label} de ${credito}` : label, `custo ${custo}`];
  return `${partes.join(" · ")} | Bidcon`;
}

async function subirParaYoutube(db: Db, linha: LinhaReel): Promise<void> {
  if (process.env.FAROL_YOUTUBE !== "on") return;

  try {
    const det = (linha.detalhe ?? {}) as {
      url_hospedada?: string;
      yt_video_id?: string;
      tipo?: string;
      credito?: number;
      custo_am?: number | null;
    };

    if (det.yt_video_id) {
      console.log("[farol-youtube] já subiu, pulando:", {
        video_id: linha.video_id,
        yt_video_id: det.yt_video_id,
      });
      return;
    }

    if (!det.url_hospedada) {
      console.log("[farol-youtube] sem url_hospedada (linha legada), pulando:", {
        video_id: linha.video_id,
      });
      return;
    }

    const descricao = [linha.legenda ?? "", "", CANAL_YOUTUBE, ""].join("\n");

    const r = await subirShort({
      url: det.url_hospedada,
      titulo: tituloShort(det),
      descricao,
      tags: TAGS_YOUTUBE,
    });

    if (!r.ok) {
      // Erro do YouTube é EVENTO, não sentença: a linha continua 'publicado'
      // e o `erro` dela não é tocado, porque ele descreve o IG.
      console.error("[farol-youtube] upload falhou:", {
        video_id: linha.video_id,
        erro: r.erro,
      });
      await registrar(db, "reel_youtube_falhou", linha.carta_id, null, {
        video_id: linha.video_id,
        erro: r.erro,
      });
      return;
    }

    const detalheNovo = { ...(linha.detalhe ?? {}), yt_video_id: r.videoId };
    await atualizar(db, linha.id, { detalhe: detalheNovo });
    linha.detalhe = detalheNovo;

    console.log("[farol-youtube] short publicado:", {
      video_id: linha.video_id,
      yt_video_id: r.videoId,
      carta_id: linha.carta_id,
    });
    // `post_id` fica NULL de propósito: em `farol_posts` essa coluna significa
    // "post do Instagram" em todos os outros eventos. O id do YouTube vai no
    // detalhe, onde não se confunde com o do IG.
    await registrar(db, "reel_youtube_publicado", linha.carta_id, null, {
      video_id: linha.video_id,
      yt_video_id: r.videoId,
    });
  } catch (e) {
    // A rede de segurança final. Se a gravação do `detalhe` falhar, o Short já
    // está no ar e o id vai para o log — que é a única forma de alguém amarrar
    // um ao outro à mão. Nada disso volta para o chamador.
    const erro = e instanceof Error ? e.message.slice(0, 500) : "erro_desconhecido";
    console.error("[farol-youtube] erro isolado (IG não afetado):", {
      video_id: linha.video_id,
      erro,
    });
  }
}

// ===========================================================================
// TIKTOK-01 — o mesmo mp4 no perfil @bidcon
// AUTORIZADO: Emerson Gomes dos Santos — OS "TIKTOK-01", 07/08/2026:
// "após publicar no IG, se FAROL_TIKTOK=on: subir o MESMO mp4 → gravar
//  tt_publish_id no detalhe. Idempotente (pular se já existe). Falha do TikTok
//  NUNCA derruba IG/YouTube — try/catch isolado, log [farol-tiktok]."
// ---------------------------------------------------------------------------
// NASCE DESARMADO. Sem `FAROL_TIKTOK=on` esta função sai na primeira linha.
//
// TRÊS PLATAFORMAS, TRÊS SILÊNCIOS INDEPENDENTES. Esta função é irmã gêmea da
// `subirParaYoutube` e a semelhança é deliberada: `void`, try/catch total,
// idempotência por campo do `detalhe`, erro vira evento em `farol_posts` e
// nunca sentença. O IG continua sendo o dono do veredito; o YouTube, que já
// rodou acima, também não é afetado por nada daqui — são três caminhos que só
// compartilham o arquivo mp4.
//
// IDEMPOTÊNCIA POR `detalhe.tt_publish_id`. Vale a mesma advertência do
// YouTube: o TikTok não deduplica, aceita o mesmo arquivo de novo e cria um
// segundo post.
//
// O QUE É GRAVADO É O `publish_id`, NÃO O ID DO POST. Medido: o Direct Post é
// assíncrono do lado do TikTok — o `init` devolve `publish_id` e a publicação
// termina depois, em outro tempo. O id público (`publicaly_available_post_id`)
// só existe quando a moderação libera, e esperar por ele aqui seguraria a fase
// 2 por tempo indeterminado. O `publish_id` é a chave que consulta o desfecho
// via `consultarStatus()`; é o que existe para gravar no momento em que estamos.
//
// A LEGENDA É A MESMA DO IG. Ela já passou pelo `revisarLegenda()` antes do
// render e de novo antes do Instagram: mesma fala, mesma alfândega. O teto de
// 2200 runas do TikTok é aplicado dentro da lib.
// ===========================================================================
async function subirParaTiktok(db: Db, linha: LinhaReel): Promise<void> {
  if (process.env.FAROL_TIKTOK !== "on") return;

  try {
    const det = (linha.detalhe ?? {}) as {
      url_hospedada?: string;
      tt_publish_id?: string;
      tipo?: string;
      credito?: number;
      custo_am?: number | null;
    };

    if (det.tt_publish_id) {
      console.log("[farol-tiktok] já subiu, pulando:", {
        video_id: linha.video_id,
        tt_publish_id: det.tt_publish_id,
      });
      return;
    }

    if (!det.url_hospedada) {
      console.log("[farol-tiktok] sem url_hospedada (linha legada), pulando:", {
        video_id: linha.video_id,
      });
      return;
    }

    // Legenda do IG; se ela não existir (linha antiga), o título curto do Short
    // é melhor do que um post sem texto nenhum.
    const titulo = linha.legenda?.trim() || tituloShort(det);

    const r = await publicarVideo({ url: det.url_hospedada, titulo });

    if (!r.ok) {
      console.error("[farol-tiktok] publicação falhou:", {
        video_id: linha.video_id,
        erro: r.erro,
      });
      await registrar(db, "reel_tiktok_falhou", linha.carta_id, null, {
        video_id: linha.video_id,
        erro: r.erro,
      });
      return;
    }

    const detalheNovo = { ...(linha.detalhe ?? {}), tt_publish_id: r.publishId };
    await atualizar(db, linha.id, { detalhe: detalheNovo });
    linha.detalhe = detalheNovo;

    console.log("[farol-tiktok] post enviado:", {
      video_id: linha.video_id,
      tt_publish_id: r.publishId,
      carta_id: linha.carta_id,
      privacidade: process.env.TT_PRIVACY ?? "SELF_ONLY",
    });
    // `post_id` NULL pelo mesmo motivo do YouTube: em `farol_posts` essa coluna
    // significa "post do Instagram" em todos os outros eventos.
    await registrar(db, "reel_tiktok_publicado", linha.carta_id, null, {
      video_id: linha.video_id,
      tt_publish_id: r.publishId,
    });
  } catch (e) {
    const erro = e instanceof Error ? e.message.slice(0, 500) : "erro_desconhecido";
    console.error("[farol-tiktok] erro isolado (IG/YouTube não afetados):", {
      video_id: linha.video_id,
      erro,
    });
  }
}

/**
 * Container zumbi: a linha ficou em 'publicando' com container_id, o tempo
 * passou e o container da Meta CONTINUA IN_PROGRESS. Foi o que o operador
 * destravou à mão hoje; aqui vira regra.
 *
 * Três recusas deliberadas, porque um reset errado custa um upload e pode
 * jogar fora um vídeo que ia publicar:
 *  - idade abaixo do limite: nem chama a Meta (o ciclo de 10 min não pode pagar
 *    uma requisição por linha a cada passada);
 *  - leitura ilegível (429, rede, token): NÃO é zumbi — não sei o estado, e não
 *    saber nunca vira sentença;
 *  - qualquer code que não seja IN_PROGRESS: devolve o code e o caminho normal
 *    decide. FINISHED publica; ERROR/EXPIRED viram falha por `esperarContainer`,
 *    que já registra o code literal. Duas rotas para o mesmo veredito seriam
 *    duas verdades.
 *
 * Abandonar um container NÃO publica nada por acidente: container só vai ao ar
 * por chamada explícita de `media_publish`, e o abandonado nunca mais recebe uma.
 */
async function checarZumbi(
  linha: LinhaReel,
  containerId: string,
  ignorarIdade: boolean,
  limiteMs: number
): Promise<{ zumbi: boolean; code: string; idadeMin: number }> {
  // ÂNCORA DO RELÓGIO. `atualizado_em` é empurrado por QUALQUER escrita na
  // linha — inclusive pelo próprio reset, que recria o container e re-carimba.
  // Então "idade" nunca foi idade do container: era tempo desde a última
  // mexida. Quando o dedupe já foi confirmado, o relógio passa a contar do
  // instante dessa confirmação, que é um fato do container e não da fila.
  const det = (linha.detalhe ?? {}) as { dedupe_confirmado_em?: string };
  const base = det.dedupe_confirmado_em ?? linha.atualizado_em ?? linha.criado_em;
  const idadeMs = Date.now() - new Date(base).getTime();
  const idadeMin = Math.round(idadeMs / 60_000);

  // `ignorarIdade` dispensa a ESPERA, nunca a checagem de estado logo abaixo:
  // um container legado que já esteja FINISHED tem que publicar, não morrer.
  const idadeOk = Number.isFinite(idadeMs) && idadeMs >= limiteMs;
  if (linha.status !== "publicando" || (!ignorarIdade && !idadeOk)) {
    return { zumbi: false, code: "NAO_CHECADO", idadeMin };
  }

  const s = await statusContainer(containerId);
  if (!s.ok) {
    console.error("[farol-reel] status do container ilegível:", {
      container_id: containerId,
      erro: s.erro,
    });
    return { zumbi: false, code: "ILEGIVEL", idadeMin };
  }
  return { zumbi: s.code === "IN_PROGRESS", code: s.code, idadeMin };
}

/** Encerra o que passou da janela de 24h — ver header. */
async function encerrarVencidos(db: Db, desde: string): Promise<void> {
  const { error } = await db
    .from("farol_reels")
    .update({
      status: "falhou",
      erro: `expirado: sem publicar em ${JANELA_HORAS}h`,
      atualizado_em: new Date().toISOString(),
    })
    .in("status", ["renderizando", "pronto", "publicando"])
    .lt("criado_em", desde);
  if (error) console.error("[farol-reel] falha encerrando vencidos:", error.message);
}
