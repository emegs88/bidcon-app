// ============================================================================
// YOUTUBE-01 · rota 1 — GET /api/youtube/oauth/start
// AUTORIZADO: Emerson Gomes dos Santos — OS "YOUTUBE-01", 07/08/2026:
// "GET /api/youtube/oauth/start (Bearer DISPARO_SECRET): redireciona pro
//  consent do Google com scope youtube.upload, access_type=offline,
//  prompt=consent, redirect_uri .../api/youtube/oauth/callback".
// ----------------------------------------------------------------------------
// A PORTA DE ENTRADA DO FLUXO DE DEDO DO DONO. Roda uma vez por canal, com o
// Emerson logado no navegador NA CONTA DO @Bidconoficial — o consentimento é
// concedido por QUEM ESTÁ LOGADO, e é por isso que a validação da OS diz "teste
// com o Emerson autorizando NO CANAL BIDCON". Autorizar na conta pessoal geraria
// um refresh_token perfeitamente válido que sobe Short no canal errado.
//
// ESTA ROTA NÃO FALA COM O GOOGLE. Ela monta uma URL e manda o navegador para
// lá. Não há token, não há segredo no corpo, não há efeito colateral: se o
// Emerson fechar a aba no meio, nada aconteceu.
//
// POR QUE 302 E NÃO JSON COM A URL. A OS disse "redireciona". Um JSON exigiria
// copiar e colar uma URL de ~400 caracteres com `state` assinado dentro — e URL
// longa colada à mão é onde nasce o `redirect_uri_mismatch`.
//
// O `state` VAI ASSINADO (desvio declarado, ver lib/youtube/upload.ts). Ele é o
// único fio que amarra o callback — que nasce aberto porque o Google redireciona
// um navegador pelado até lá — a um /start que passou pelo Bearer.
// ============================================================================
import { NextResponse } from "next/server";
import { assinarState, urlConsentimento } from "@/lib/youtube/upload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Guard idêntico ao de /api/farol/reel-opcoes, /api/instagram/diag e /api/whatsapp/disparo. */
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
    // Só acontece se DISPARO_SECRET sumir entre o guard e aqui — impossível na
    // prática, mas `assinarState` pode devolver null e o tipo cobra a checagem.
    return NextResponse.json({ ok: false, erro: "env_ausente(DISPARO_SECRET)" }, { status: 500 });
  }

  const consent = urlConsentimento(state);
  if (!consent.ok) {
    return NextResponse.json({ ok: false, erro: consent.erro }, { status: 500 });
  }

  // 307 preserva o método; aqui é GET dos dois lados, então tanto faz — mas é o
  // padrão do NextResponse.redirect e não custa nada estar certo.
  return NextResponse.redirect(consent.url, {
    status: 307,
    headers: { "Cache-Control": "no-store" },
  });
}
