// ============================================================================
// TIKTOK-01 · rota 1 — GET /api/tiktok/oauth/start
// AUTORIZADO: Emerson Gomes dos Santos — OS "TIKTOK-01", 07/08/2026:
// "GET /api/tiktok/oauth/start (Bearer DISPARO_SECRET): redireciona pro consent
//  do TikTok (escopos acima, state anti-CSRF)".
// ----------------------------------------------------------------------------
// A PORTA DE ENTRADA DO FLUXO DE DEDO DO DONO. Roda uma vez por conta, com o
// Emerson logado no navegador NA CONTA @bidcon — o consentimento é concedido
// por QUEM ESTÁ LOGADO. Autorizar na conta pessoal geraria um refresh_token
// perfeitamente válido que publica no perfil errado, e o erro só apareceria no
// dia em que o primeiro post saísse.
//
// ESTA ROTA NÃO FALA COM O TIKTOK. Monta uma URL e manda o navegador para lá.
// Sem token, sem segredo no corpo, sem efeito colateral: fechar a aba no meio
// não deixa nada para trás.
//
// O `state` VAI ASSINADO (HMAC do DISPARO_SECRET, 15 min, com domínio "tiktok:"
// — ver lib/tiktok/upload.ts). É o único fio que amarra o callback, que nasce
// aberto por construção, a um /start que passou pelo Bearer.
// ============================================================================
import { NextResponse } from "next/server";
import { assinarState, urlConsentimento } from "@/lib/tiktok/upload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Guard idêntico ao de /api/youtube/oauth/start e /api/farol/reel-opcoes. */
function autorizado(req: Request): boolean {
  const secret = process.env.DISPARO_SECRET;
  if (!secret) return false; // sem secret configurado => não roda
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!autorizado(req)) {
    return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  }

  const state = assinarState();
  if (!state) {
    return NextResponse.json({ ok: false, erro: "env_ausente(DISPARO_SECRET)" }, { status: 500 });
  }

  const consent = urlConsentimento(state);
  if (!consent.ok) {
    return NextResponse.json({ ok: false, erro: consent.erro }, { status: 500 });
  }

  return NextResponse.redirect(consent.url, {
    status: 307,
    headers: { "Cache-Control": "no-store" },
  });
}
