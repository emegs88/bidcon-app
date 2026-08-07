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

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Mesma versão da Graph que lib/instagram/publicar.ts — um produto, uma versão. */
const IG_GRAPH_VERSION = "v25.0";
const TIMEOUT_IG_MS = 15_000;

/** Regra da OS: polling curto do container. */
const POLL_MAX_MS = 40_000;
const POLL_PASSO_MS = 5_000;

/** Só entra no caminho caro se ainda couber o polling inteiro com folga. */
const ORCAMENTO_MS = 12_000;

/** Container da Meta expira em 24h — ver header. */
const JANELA_HORAS = 24;

/** Quantas linhas pendentes olhar por invocação (checagem de status é barata). */
const LIMITE_LINHAS = 5;

type LinhaReel = {
  id: string;
  carta_id: string | null;
  video_id: string;
  container_id: string | null;
  status: string;
  legenda: string | null;
  detalhe: Record<string, unknown> | null;
  criado_em: string;
};

/**
 * GET no container da Meta. Existe aqui, e não na lib, pelo motivo do header.
 * Nunca lança; erro da Graph repassado literal (code/subcode/message).
 */
async function statusContainer(
  containerId: string
): Promise<{ ok: true; code: string } | { ok: false; erro: string }> {
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) return { ok: false, erro: "env_ausente(IG_ACCESS_TOKEN)" };

  const url =
    `https://graph.instagram.com/${IG_GRAPH_VERSION}/${containerId}` +
    `?fields=status_code`;
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
      const partes = [
        err?.code !== undefined ? `code=${err.code}` : null,
        err?.error_subcode !== undefined ? `subcode=${err.error_subcode}` : null,
        err?.message ?? `http_${resp.status}`,
      ].filter(Boolean);
      return { ok: false, erro: partes.join(" ").slice(0, 500) };
    }
    const code = (data as { status_code?: string })?.status_code;
    return { ok: true, code: String(code ?? "DESCONHECIDO") };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, erro: `timeout_instagram_api(${TIMEOUT_IG_MS}ms)` };
    }
    return {
      ok: false,
      erro: e instanceof Error ? e.message.slice(0, 500) : "erro_desconhecido",
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
  while (Date.now() < limite) {
    const s = await statusContainer(containerId);
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
      .select("id,carta_id,video_id,container_id,status,legenda,detalhe,criado_em")
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
        const r = await publicarContainer(db, linha, linha.container_id);
        olhados.push({ video_id: linha.video_id, resultado: r });
        if (r === "publicado" || r === "falhou") break;
        continue;
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

      // A URL do HeyGen é presignada e EXPIRA — por isso ela é usada aqui, na
      // mesma invocação em que foi lida, e nunca guardada para depois.
      const container = await chamarGraph("media", {
        media_type: "REELS",
        video_url: s.data.videoUrl,
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

      // GRAVA O CONTAINER ANTES DE PUBLICAR — trava (3) do header.
      await atualizar(db, linha.id, {
        status: "publicando",
        container_id: container.id,
      });

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
  return "publicado";
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
