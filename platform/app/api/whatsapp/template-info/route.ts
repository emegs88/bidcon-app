// CARROSSEL-OPS-01 Peça 1 — leitor da especificação de templates via Graph API.
// Só leitura. Protegida pelo mesmo Bearer do disparo (DISPARO_SECRET).
// WABA hardcoded com proveniência: 1569741627872302 — provado por comportamento
// em 05/08/2026 (LEIAME SENTINELA-01: outbound entregue + único registro
// Conectado do número + phone_number_id conferido na tela da Meta).
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WABA_ID = "1569741627872302";
// Mesmo literal usado internamente por lib/whatsapp/graph.ts (GRAPH_VERSION,
// não exportado de lá) — conferido, não inventado.
const GRAPH_VERSION = "v21.0";

export async function GET(req: Request) {
  const secret = process.env.DISPARO_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  }
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) {
    return NextResponse.json(
      { erro: "env_ausente(WHATSAPP_TOKEN)" },
      { status: 500 }
    );
  }

  const name = new URL(req.url).searchParams.get("name");
  const url =
    `https://graph.facebook.com/${GRAPH_VERSION}/${WABA_ID}/message_templates` +
    // `language` É O CAMPO QUE O #132001 ACUSA. Sem ele nos fields, este
    // instrumento respondia "o template existe" sem dizer em QUAL tradução —
    // que é a única pergunta que decide a causa. Medido em 19/08/2026: 75
    // envios recusados com "Template name does not exist in the translation",
    // e a rota que existe para diagnosticar isso não pedia a tradução.
    `?fields=name,language,status,category,components&limit=50` +
    (name ? `&name=${encodeURIComponent(name)}` : "");

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const json = (await resp.json().catch(() => null)) as {
    data?: unknown[];
    error?: { message?: string };
  } | null;

  if (!resp.ok || !json) {
    return NextResponse.json(
      {
        ok: false,
        status: resp.status,
        erro: json?.error?.message ?? "graph_falhou",
      },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true, data: json.data ?? [] });
}
