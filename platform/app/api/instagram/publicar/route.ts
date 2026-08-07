// ============================================================================
// INSTA-POST-01 — POST /api/instagram/publicar
// Publica UMA carta no feed do @bidcon.br usando o card já em produção.
// AUTORIZADO: Emerson Gomes dos Santos — "vamos fazer tudo agora", 06/08/2026.
// ----------------------------------------------------------------------------
// 06/08/2026 ~23h — FAROL-POST item 6: o MIOLO desta rota mudou de endereço.
// A validação na vitrine viva, o container, o media_publish com um retry, os
// logs `[ig-publicar]` e a função `chamarGraph` agora moram em
// lib/instagram/publicar.ts, porque o cron do FAROL precisa da MESMA lógica e
// duas cópias divergiriam no primeiro ajuste. A OS exige que o comportamento
// DESTA rota fique idêntico: mesmos status HTTP, mesmos corpos de resposta,
// mesmos logs. É o que está abaixo — a rota virou o adaptador HTTP da lib.
// O header original, com o porquê de cada decisão (fluxo de dois passos, v25.0,
// host fixo, validação na view em vez de cartas.status), foi junto com o código
// e está no topo de lib/instagram/publicar.ts.
//
// O QUE CONTINUA SENDO RESPONSABILIDADE DESTA ROTA, e não da lib:
//
// GUARD: mesmo Bearer DISPARO_SECRET do disparo, copiado literal. Esta rota
// escreve no perfil PÚBLICO da empresa; sem secret configurado ela não roda.
//
// LEGENDA OBRIGATÓRIA: compliance humana por post nesta rota. Não há default,
// não há geração automática — post sem legenda revisada não sai daqui. (O FAROL
// tem a própria rota e a própria regra de legenda; não passa por este guard.)
// ============================================================================
import { NextResponse } from "next/server";
import { publicarCartaNoFeed } from "@/lib/instagram/publicar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Guard idêntico ao de app/api/whatsapp/disparo/route.ts. */
function autorizado(req: Request): boolean {
  const secret = process.env.DISPARO_SECRET;
  if (!secret) return false; // sem secret configurado => não roda
  return req.headers.get("authorization") === `Bearer ${secret}`;
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

  const r = await publicarCartaNoFeed({ cartaId, legenda });

  if (!r.ok) {
    // `publicacao_recusada` devolve TAMBÉM o container_id — era assim antes da
    // extração e continua sendo: é o que permite investigar o container órfão
    // no Business Suite sem ter que caçar nos logs.
    if (r.motivo === "publicacao_recusada") {
      return NextResponse.json(
        { ok: false, erro: r.erro, container_id: r.containerId },
        { status: r.status }
      );
    }
    return NextResponse.json({ ok: false, erro: r.erro }, { status: r.status });
  }

  return NextResponse.json({ ok: true, post_id: r.postId, carta_id: cartaId });
}
