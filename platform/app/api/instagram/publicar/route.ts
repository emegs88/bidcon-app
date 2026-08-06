// ============================================================================
// INSTA-POST-01 — POST /api/instagram/publicar
// Publica UMA carta no feed do @bidcon.br usando o card já em produção.
// AUTORIZADO: Emerson Gomes dos Santos — "vamos fazer tudo agora", 06/08/2026.
// ----------------------------------------------------------------------------
// FLUXO DE DOIS PASSOS (medido na doc oficial em 06/08/2026, não assumido):
//   1) POST https://graph.instagram.com/v25.0/<IG_USER_ID>/media
//      Authorization: Bearer <IG_ACCESS_TOKEN>
//      { "image_url": "...", "caption": "..." }              → { id: container }
//   2) POST https://graph.instagram.com/v25.0/<IG_USER_ID>/media_publish
//      { "creation_id": "<container>" }                      → { id: post }
//   Permissões: instagram_business_basic + instagram_business_content_publish.
//
// POR QUE AQUI TEM IG_USER_ID E O ENVIO DE DM NÃO TEM: lib/instagram/graph.ts
// posta em /me/messages justamente pra não guardar o id da conta numa env. A
// doc de publicação NÃO documenta variante /me — só /<IG_ID>/media. Então a
// env é necessária aqui e apenas aqui. Não é inconsistência: é a doc.
//
// VERSÃO v25.0: a MESMA de lib/instagram/graph.ts, de propósito. A doc usa o
// placeholder <LATEST_API_VERSION> e não mostra número; fixar na versão que já
// está medida e em uso no outro módulo do IG mantém o produto inteiro numa
// versão só. "A mais nova" moveria o endpoint sem deploy nosso.
//
// A IMAGEM É BUSCADA PELO SERVIDOR DA META, NÃO POR NÓS: passamos uma URL
// pública (/api/card-image/<id>) e a Meta vai lá buscar. Consequências que
// moldam o código abaixo:
//   - a URL PRECISA ser absoluta e pública — por isso é montada com host fixo
//     de produção, não com o host da request (que num preview seria uma URL
//     protegida por SSO que a Meta não consegue ler);
//   - o erro de imagem chega como erro da Graph no passo 1, não como exceção
//     nossa — daí o repasse literal de code/message.
//
// VALIDAÇÃO NA VIEW, NÃO EM cartas.status — DESVIO DECLARADO DA OS:
// a OS pede validar status='disponivel'. Medido em 06/08/2026, a arte que a
// Meta vai buscar NÃO sai de `cartas`: /api/card-image/[id] lê `vw_vitrine_viva`
// e devolve 404 pra qualquer uuid fora dela. Definição da view (medida):
//   status='disponivel' AND valor_credito > 0 AND categoria='contemplada'
//   AND NOT EXISTS (reserva ativa não expirada com o mesmo fingerprint)
// Uma carta 'disponivel' porém não contemplada passaria no teste da OS e a
// Meta receberia um 404 na image_url — post falhando com erro da Graph que não
// diz a verdade ("media não pôde ser buscada"). Validar na MESMA fonte da
// imagem faz o "carta_indisponivel" ser honesto. É um superset do que a OS
// pediu: tudo que a view aprova também é status='disponivel'.
// Bônus: a view não expõe `fornecedor_id` — a regra é cumprida por construção.
//
// GUARD: mesmo Bearer DISPARO_SECRET do disparo, copiado literal. Esta rota
// escreve no perfil PÚBLICO da empresa; sem secret configurado ela não roda.
//
// LEGENDA OBRIGATÓRIA: compliance humana por post nesta fase. Não há default,
// não há geração automática — post sem legenda revisada não sai daqui.
//
// TOKEN NUNCA VAI PRO LOG. O que vai: post_id, carta e erro literal da Graph.
// ============================================================================
import { NextResponse } from "next/server";
import { createXtvClient } from "@/lib/supabase-xtv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const IG_GRAPH_VERSION = "v25.0";

/** Host público de produção. Fixo de propósito — ver header. */
const HOST_PUBLICO = "https://app.bidcon.com.br";

/** A Meta baixa a imagem dentro desta chamada; 20s dá folga pro fetch dela. */
const TIMEOUT_IG_MS = 20_000;

/** Colunas lidas na view. Explícitas (nunca `*`) e sem fornecedor_id. */
const CAMPOS_CARTA = "id,tipo,credito,administradora";

/** Guard idêntico ao de app/api/whatsapp/disparo/route.ts. */
function autorizado(req: Request): boolean {
  const secret = process.env.DISPARO_SECRET;
  if (!secret) return false; // sem secret configurado => não roda
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

type RespostaGraph = { ok: boolean; id?: string; erro?: string };

/**
 * POST na Graph do Instagram. Nunca lança: env ausente e falha de rede viram
 * erro nomeado, no mesmo contrato de lib/instagram/graph.ts.
 * O erro da Graph é repassado LITERAL (code + message) — é o diagnóstico.
 */
async function chamarGraph(
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

export async function POST(req: Request) {
  if (!autorizado(req)) {
    return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    carta_id?: unknown;
    legenda?: unknown;
  } | null;

  const cartaId = typeof body?.carta_id === "string" ? body.carta_id.trim() : "";
  const legenda = typeof body?.legenda === "string" ? body.legenda.trim() : "";

  if (!cartaId) {
    return NextResponse.json({ ok: false, erro: "carta_id_ausente" }, { status: 400 });
  }
  // Legenda obrigatória: revisão humana por post é a regra desta fase.
  if (!legenda) {
    return NextResponse.json({ ok: false, erro: "legenda_ausente" }, { status: 400 });
  }

  // ---- 1. A carta está viva? (mesma fonte que a arte — ver header) ---------
  const db = createXtvClient();
  const { data: carta, error: errCarta } = await db
    .from("vw_vitrine_viva")
    .select(CAMPOS_CARTA)
    .eq("id", cartaId)
    .maybeSingle();

  if (errCarta) {
    console.error("[ig-publicar] falha lendo a carta:", errCarta.message);
    return NextResponse.json(
      { ok: false, erro: `falha_consulta: ${errCarta.message}` },
      { status: 500 }
    );
  }
  if (!carta) {
    // Não existe, não está disponível, não é contemplada, crédito zerado ou
    // está reservada. Qualquer um destes faria a image_url devolver 404.
    return NextResponse.json({ ok: false, erro: "carta_indisponivel" }, { status: 409 });
  }

  const imageUrl = `${HOST_PUBLICO}/api/card-image/${cartaId}`;

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
    return NextResponse.json({ ok: false, erro: container.erro }, { status: 502 });
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
    return NextResponse.json(
      { ok: false, erro: publicado.erro, container_id: container.id },
      { status: 502 }
    );
  }

  console.log("[ig-publicar] publicado:", {
    post_id: publicado.id,
    carta_id: cartaId,
    tipo: (carta as { tipo?: string | null }).tipo ?? null,
    administradora: (carta as { administradora?: string | null }).administradora ?? null,
    credito: (carta as { credito?: number | null }).credito ?? null,
  });

  return NextResponse.json({ ok: true, post_id: publicado.id, carta_id: cartaId });
}
