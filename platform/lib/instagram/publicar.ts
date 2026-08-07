// ============================================================================
// FAROL-POST item 6 — lib compartilhada de publicação no feed do @bidcon.br
// AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-POST", 06/08/2026 ~22h15:
// "reaproveitar a lógica existente: extrair a função de publicação de
//  /publicar para uma lib compartilhada SEM mudar o comportamento daquela
//  rota (diff funcional dela = zero); a rota do FAROL chama a lib."
// ----------------------------------------------------------------------------
// ESTE ARQUIVO É MUDANÇA DE ENDEREÇO, NÃO DE COMPORTAMENTO. Todo o corpo abaixo
// veio de app/api/instagram/publicar/route.ts (commit 44c19c3), que está em
// produção e com post inaugural comprovado (18132427570616550). O que mudou:
//   - `chamarGraph` e as constantes saíram da rota e vieram pra cá, IDÊNTICAS;
//   - a sequência "valida na view → container → publish com 1 retry" virou a
//     função `publicarCartaNoFeed`, que devolve um resultado DISCRIMINADO em
//     vez de montar NextResponse. Quem monta HTTP continua sendo a rota.
// Os `console.*` continuam com o prefixo literal `[ig-publicar]` de propósito:
// se eu trocasse o prefixo, o diff da rota deixaria de ser funcionalmente zero
// (log É comportamento observável — é por ele que se depura em produção). O
// FAROL acrescenta o `[farol]` dele por cima, não substitui este.
//
// POR QUE O RESULTADO É DISCRIMINADO E NÃO UM `{ok,erro}` SIMPLES: a rota
// devolve status HTTP diferente pra cada falha (500 consulta, 409 carta fora
// da vitrine, 502 Graph) e, no caso da publicação recusada, devolve TAMBÉM o
// `container_id` no corpo. Um `{ok:false, erro}` genérico apagaria essa
// distinção e mudaria a resposta da rota — exatamente o que a OS proíbe.
//
// AS DECISÕES ORIGINAIS SEGUEM VALENDO (repetidas aqui porque agora moram aqui):
//   - fluxo de DOIS passos: POST /<IG_USER_ID>/media → POST .../media_publish;
//   - v25.0, a mesma de lib/instagram/graph.ts, pra manter o produto numa
//     versão só (a doc usa placeholder <LATEST_API_VERSION>, sem número);
//   - a imagem é buscada PELO SERVIDOR DA META: a URL precisa ser absoluta e
//     pública, por isso host fixo de produção e não o host da request (num
//     preview seria uma URL atrás de SSO que a Meta não consegue ler);
//   - validação em `vw_vitrine_viva` e NÃO em `cartas.status` — é a MESMA fonte
//     que /api/card-image/[id] lê, então "carta_indisponivel" fica honesto em
//     vez de virar um 404 na image_url disfarçado de erro da Graph. A view
//     também não expõe `fornecedor_id`: a regra é cumprida por construção;
//   - o token NUNCA entra em log; o que entra é post_id, carta e o erro
//     literal da Graph (code/subcode/message), que é o diagnóstico.
// ============================================================================
import { createXtvClient } from "@/lib/supabase-xtv";

const IG_GRAPH_VERSION = "v25.0";

/** Host público de produção. Fixo de propósito — ver header. */
export const HOST_PUBLICO = "https://app.bidcon.com.br";

/** A Meta baixa a imagem dentro desta chamada; 20s dá folga pro fetch dela. */
const TIMEOUT_IG_MS = 20_000;

/** Colunas lidas na view. Explícitas (nunca `*`) e sem fornecedor_id. */
export const CAMPOS_CARTA = "id,tipo,credito,administradora";

export type RespostaGraph = { ok: boolean; id?: string; erro?: string };

/**
 * POST na Graph do Instagram. Nunca lança: env ausente e falha de rede viram
 * erro nomeado, no mesmo contrato de lib/instagram/graph.ts.
 * O erro da Graph é repassado LITERAL (code + message) — é o diagnóstico.
 */
export async function chamarGraph(
  caminho: string,
  corpo: Record<string, unknown>
): Promise<RespostaGraph> {
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) return { ok: false, erro: "env_ausente(IG_ACCESS_TOKEN)" };
  const igUserId = process.env.IG_USER_ID;
  if (!igUserId) return { ok: false, erro: "env_ausente(IG_USER_ID)" };

  const url = `https://graph.instagram.com/${IG_GRAPH_VERSION}/${igUserId}/${caminho}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_IG_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(corpo),
      signal: controller.signal,
    });
    const data: unknown = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      const err = (data as { error?: { message?: string; code?: number; error_subcode?: number } })
        ?.error;
      const partes = [
        err?.code !== undefined ? `code=${err.code}` : null,
        err?.error_subcode !== undefined ? `subcode=${err.error_subcode}` : null,
        err?.message ?? `http_${resp.status}`,
      ].filter(Boolean);
      return { ok: false, erro: partes.join(" ").slice(0, 800) };
    }

    const id = (data as { id?: string })?.id;
    if (!id) return { ok: false, erro: "resposta_sem_id" };
    return { ok: true, id };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, erro: `timeout_instagram_api(${TIMEOUT_IG_MS}ms)` };
    }
    return {
      ok: false,
      erro: e instanceof Error ? e.message.slice(0, 800) : "erro_desconhecido",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** O que a view devolve pro log de sucesso. */
type CartaPublicada = {
  tipo?: string | null;
  credito?: number | null;
  administradora?: string | null;
};

export type ResultadoPublicacao =
  | { ok: true; postId: string; carta: CartaPublicada }
  | { ok: false; motivo: "falha_consulta"; erro: string; status: 500 }
  | { ok: false; motivo: "carta_indisponivel"; erro: "carta_indisponivel"; status: 409 }
  | { ok: false; motivo: "container_recusado"; erro: string; status: 502 }
  | {
      ok: false;
      motivo: "publicacao_recusada";
      erro: string;
      containerId?: string;
      status: 502;
    };

/**
 * Valida a carta na vitrine viva, monta o container e publica.
 * Não valida entrada (carta_id/legenda vazios) — isso é contrato de quem chama.
 * Nunca lança; toda falha vira um ramo de `ResultadoPublicacao`.
 */
export async function publicarCartaNoFeed(params: {
  cartaId: string;
  legenda: string;
}): Promise<ResultadoPublicacao> {
  const { cartaId, legenda } = params;

  // ---- 1. A carta está viva? (mesma fonte que a arte — ver header) ---------
  const db = createXtvClient();
  const { data: carta, error: errCarta } = await db
    .from("vw_vitrine_viva")
    .select(CAMPOS_CARTA)
    .eq("id", cartaId)
    .maybeSingle();

  if (errCarta) {
    console.error("[ig-publicar] falha lendo a carta:", errCarta.message);
    return {
      ok: false,
      motivo: "falha_consulta",
      erro: `falha_consulta: ${errCarta.message}`,
      status: 500,
    };
  }
  if (!carta) {
    // Não existe, não está disponível, não é contemplada, crédito zerado ou
    // está reservada. Qualquer um destes faria a image_url devolver 404.
    return {
      ok: false,
      motivo: "carta_indisponivel",
      erro: "carta_indisponivel",
      status: 409,
    };
  }

  // VISUAL-KIT-APLICADO-01 (06/08/2026 ~23h30): `?formato=feed` = 1080×1080.
  // Sem ele, sai o card do WhatsApp (1200×630). O Instagram ACEITA 1.91:1 no
  // feed — o post inaugural provou —, mas o GRID do perfil é quadrado e corta
  // as laterais: o crédito, que é a única coisa que faz alguém parar de rolar,
  // some. E o kit v3 nunca aparece. O quadrado resolve os dois.
  //
  // ISTO MUDA TAMBÉM A ARTE DA ROTA MANUAL /api/instagram/publicar, que chama
  // esta mesma função. É intencional, e é o certo: as duas publicam no MESMO
  // feed, e um grid com duas proporções diferentes seria pior do que qualquer
  // uma das duas sozinha. Declarado porque a OS anterior exigia diff funcional
  // zero naquela rota — este é o único ponto em que ela muda, e por decisão.
  const imageUrl = `${HOST_PUBLICO}/api/card-image/${cartaId}?formato=feed`;

  // ---- 2. Container ------------------------------------------------------
  const container = await chamarGraph("media", {
    image_url: imageUrl,
    caption: legenda,
  });
  if (!container.ok) {
    console.error("[ig-publicar] container recusado:", {
      carta_id: cartaId,
      image_url: imageUrl,
      erro: container.erro,
    });
    return {
      ok: false,
      motivo: "container_recusado",
      erro: container.erro ?? "erro_desconhecido",
      status: 502,
    };
  }

  // ---- 3. Publicar -------------------------------------------------------
  // Container de IMAGEM costuma nascer pronto, mas a Meta não garante: quando
  // ela ainda está baixando a imagem, o media_publish responde erro transitório.
  // Uma segunda tentativa depois de 3s cobre esse caso sem virar loop. Falhou
  // duas vezes, devolve o erro literal — o container fica lá, não vira post.
  let publicado = await chamarGraph("media_publish", { creation_id: container.id });
  if (!publicado.ok) {
    await new Promise((r) => setTimeout(r, 3000));
    publicado = await chamarGraph("media_publish", { creation_id: container.id });
  }

  if (!publicado.ok) {
    console.error("[ig-publicar] publicação recusada:", {
      carta_id: cartaId,
      container_id: container.id,
      erro: publicado.erro,
    });
    return {
      ok: false,
      motivo: "publicacao_recusada",
      erro: publicado.erro ?? "erro_desconhecido",
      containerId: container.id,
      status: 502,
    };
  }

  console.log("[ig-publicar] publicado:", {
    post_id: publicado.id,
    carta_id: cartaId,
    tipo: (carta as CartaPublicada).tipo ?? null,
    administradora: (carta as CartaPublicada).administradora ?? null,
    credito: (carta as CartaPublicada).credito ?? null,
  });

  return { ok: true, postId: publicado.id as string, carta: carta as CartaPublicada };
}
