// ============================================================================
// YOUTUBE-01 · rota 2 — GET /api/youtube/oauth/callback
// AUTORIZADO: Emerson Gomes dos Santos — OS "YOUTUBE-01", 07/08/2026:
// "troca `code` por tokens e EXIBE o refresh_token UMA VEZ em texto na resposta
//  (com instrução 'copie para a env YT_REFRESH_TOKEN na Vercel e feche') — NÃO
//  gravar em banco, NÃO logar. É segredo de dedo do dono, padrão da casa."
// ----------------------------------------------------------------------------
// ESTA ROTA IMPRIME UMA CREDENCIAL NA TELA. Tudo aqui é desenhado em volta desse
// fato:
//
//  · NÃO GRAVA. Nenhum insert, nenhum update, nenhum arquivo. O refresh_token
//    existe nesta resposta e em lugar nenhum mais. Quem guarda é o Emerson, na
//    env da Vercel, com o dedo dele.
//  · NÃO LOGA. Nem em erro, nem em debug, nem "só os 8 primeiros caracteres".
//    Log da Vercel é lido por quem tem acesso ao projeto e fica retido por dias:
//    logar meio segredo é vazar um segredo em duas rodadas.
//  · TEXTO PURO, não HTML. Sem template de HTML não há como um valor virar
//    marcação — o vetor de XSS simplesmente não existe. Bônus: `curl` mostra
//    igualzinho ao navegador.
//  · `no-store` + `noindex`. Um segredo em cache de proxy é um segredo com
//    prazo indeterminado; um segredo indexado é um segredo público.
//  · O `code` NUNCA é ecoado. Ele é de uso único, mas enquanto não é usado é
//    tão bom quanto o token — e ele chega pela query string, que é o lugar mais
//    copiável do mundo.
//
// O GUARD AQUI NÃO PODE SER BEARER. Quem bate nesta URL é o navegador
// redirecionado pelo Google, sem cabeçalho nenhum — exigir Authorization
// quebraria o fluxo por construção. O que a protege é o `state` assinado que o
// /start emitiu: HMAC com o DISPARO_SECRET e validade de 15 min. Sem `state`
// válido, esta rota não fala com o Google e não imprime nada.
//
// `state` INVÁLIDO É 403 SECO. Não digo se expirou, se a assinatura não bate ou
// se veio vazio: quem está tentando adivinhar não merece a dica, e o Emerson,
// se cair aqui, só precisa refazer o /start.
// ============================================================================
import { NextResponse } from "next/server";
import { trocarCodigo, verificarState } from "@/lib/youtube/upload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Cabeçalhos de tudo que sai daqui — inclusive dos erros. */
const CABECALHOS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

function texto(corpo: string, status: number) {
  return new NextResponse(corpo, { status, headers: CABECALHOS });
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  // ---- state: o único guard possível aqui (ver header) ---------------------
  if (!verificarState(url.searchParams.get("state"))) {
    return texto(
      "Pedido inválido ou expirado.\n\nRefaça o fluxo a partir de /api/youtube/oauth/start.\n",
      403
    );
  }

  // ---- O Google devolve `error` quando o consentimento é negado ------------
  const negado = url.searchParams.get("error");
  if (negado) {
    // `negado` é um código curto do próprio Google (ex.: access_denied). Não é
    // segredo e ajuda o Emerson a saber que foi ele que clicou em "cancelar".
    return texto(`Consentimento não concedido pelo Google: ${negado}\n`, 400);
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return texto("Resposta do Google sem `code`.\n", 400);
  }

  const r = await trocarCodigo(code);
  if (!r.ok) {
    // `r.erro` é a mensagem da própria Google (achatada em uma linha). Não
    // contém o code nem token nenhum — `trocarCodigo` só repassa o corpo de
    // erro do endpoint de token.
    return texto(`Falha ao trocar o código pelos tokens:\n${r.erro}\n`, 502);
  }

  if (!r.refreshToken) {
    // Acontece quando a conta já autorizou este client antes e o Google decide
    // não reemitir. O caminho de volta é remover o acesso do app em
    // myaccount.google.com/permissions e refazer o /start.
    return texto(
      [
        "O Google concedeu o acesso, mas NÃO devolveu refresh_token.",
        "",
        "Isso acontece quando esta conta já autorizou este mesmo app antes.",
        "Para forçar a emissão de um novo:",
        "  1. abra https://myaccount.google.com/permissions",
        "  2. remova o acesso do app da Bidcon",
        "  3. chame /api/youtube/oauth/start de novo",
        "",
        "Confirme que está logado na conta do canal @Bidconoficial.",
        "",
      ].join("\n"),
      409
    );
  }

  // ---- A única impressão da vida deste segredo -----------------------------
  return texto(
    [
      "YT_REFRESH_TOKEN",
      "",
      r.refreshToken,
      "",
      "-----------------------------------------------------------------",
      "Copie o valor acima para a env YT_REFRESH_TOKEN na Vercel e feche",
      "esta aba. Ele NÃO foi gravado em banco nem em log — esta tela é a",
      "única vez que ele aparece. Se perder, refaça o fluxo pelo",
      "/api/youtube/oauth/start.",
      "",
      "Depois de salvar a env, faça um redeploy para ela valer.",
      "-----------------------------------------------------------------",
      "",
    ].join("\n"),
    200
  );
}
