// ============================================================================
// TIKTOK-01 · rota 2 — GET /api/tiktok/oauth/callback
// AUTORIZADO: Emerson Gomes dos Santos — OS "TIKTOK-01", 07/08/2026:
// "troca code→tokens e EXIBE refresh_token/open_id UMA VEZ na tela (padrão
//  YOUTUBE-01: copiar pra env TT_REFRESH_TOKEN, nada em banco/log)".
// ----------------------------------------------------------------------------
// ESTA ROTA IMPRIME UMA CREDENCIAL NA TELA. Tudo aqui é desenhado em volta
// desse fato — as mesmas cinco decisões do callback do YOUTUBE-01, pelas mesmas
// razões:
//
//  · NÃO GRAVA. Nenhum insert, nenhum update, nenhum arquivo. O refresh_token
//    existe nesta resposta e em lugar nenhum mais.
//  · NÃO LOGA. Nem em erro, nem em debug, nem "só os 8 primeiros caracteres".
//    Log da Vercel é lido por quem tem acesso ao projeto e fica retido por
//    dias: logar meio segredo é vazar um segredo em duas rodadas.
//  · TEXTO PURO, não HTML. Sem template de HTML não existe vetor de XSS.
//  · `no-store` + `noindex`. Segredo em cache de proxy é segredo com prazo
//    indeterminado; segredo indexado é segredo público.
//  · O `code` NUNCA é ecoado. É de uso único, mas enquanto não é usado vale
//    tanto quanto o token — e chega pela query string, o lugar mais copiável
//    do mundo.
//
// O `open_id` TAMBÉM APARECE, e a OS pediu isso de propósito: ele identifica em
// QUAL conta o consentimento caiu. É a única forma de o Emerson conferir, antes
// de armar qualquer coisa, que autorizou no @bidcon e não na conta pessoal.
// Ele não é segredo (é um identificador opaco por app), mas sai na mesma tela
// porque é aqui que ele é útil.
//
// O GUARD AQUI NÃO PODE SER BEARER: quem bate nesta URL é o navegador
// redirecionado pelo TikTok, sem cabeçalho. O que a protege é o `state`
// assinado que o /start emitiu — HMAC com o DISPARO_SECRET, validade de 15 min
// e domínio "tiktok:", para que um state do YouTube não sirva aqui.
//
// `state` INVÁLIDO É 403 SECO. Não digo se expirou, se a assinatura não bate ou
// se veio vazio: quem está adivinhando não merece a dica, e o Emerson, se cair
// aqui, só precisa refazer o /start.
// ============================================================================
import { NextResponse } from "next/server";
import { trocarCodigo, verificarState } from "@/lib/tiktok/upload";

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
      "Pedido inválido ou expirado.\n\nRefaça o fluxo a partir de /api/tiktok/oauth/start.\n",
      403
    );
  }

  // ---- O TikTok devolve `error` quando o consentimento é negado -------------
  const negado = url.searchParams.get("error");
  if (negado) {
    // Códigos curtos do próprio TikTok (ex.: access_denied). Não são segredo e
    // ajudam o Emerson a saber que foi ele quem cancelou.
    const desc = url.searchParams.get("error_description") ?? "";
    return texto(`Consentimento não concedido pelo TikTok: ${negado} ${desc}\n`.trimEnd() + "\n", 400);
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return texto("Resposta do TikTok sem `code`.\n", 400);
  }

  // `searchParams.get` já devolve o valor decodificado, que é o que a doc do
  // TikTok exige ("the code should be decoded"). Ver comentário em trocarCodigo.
  const r = await trocarCodigo(code);
  if (!r.ok) {
    // `r.erro` é a mensagem do próprio TikTok (achatada em uma linha). Não
    // contém o code nem token nenhum.
    return texto(`Falha ao trocar o código pelos tokens:\n${r.erro}\n`, 502);
  }

  if (!r.refreshToken) {
    return texto(
      [
        "O TikTok concedeu o acesso, mas NÃO devolveu refresh_token.",
        "",
        "Sem ele não há publicação autônoma. Confira no painel de desenvolvedor",
        "se o app tem o escopo `video.publish` aprovado e refaça o fluxo pelo",
        "/api/tiktok/oauth/start.",
        "",
        `Escopos concedidos nesta autorização: ${r.escopos ?? "(não informados)"}`,
        "",
      ].join("\n"),
      409
    );
  }

  // ---- A única impressão da vida deste segredo -----------------------------
  return texto(
    [
      "TT_REFRESH_TOKEN",
      "",
      r.refreshToken,
      "",
      "-----------------------------------------------------------------",
      `open_id ......... ${r.openId ?? "(não informado)"}`,
      `escopos ......... ${r.escopos ?? "(não informados)"}`,
      "-----------------------------------------------------------------",
      "",
      "CONFIRA O open_id ACIMA: ele identifica a conta que acabou de autorizar.",
      "Se você não estava logado no @bidcon, refaça o fluxo na conta certa —",
      "este token publicaria no perfil errado sem reclamar de nada.",
      "",
      "Copie o TT_REFRESH_TOKEN para a env da Vercel e feche esta aba. Ele NÃO",
      "foi gravado em banco nem em log — esta tela é a única vez que ele",
      "aparece. Se perder, refaça o fluxo pelo /api/tiktok/oauth/start.",
      "",
      "Depois de salvar a env, faça um redeploy para ela valer.",
      "",
      "Validade: o refresh_token vale 365 dias. O TikTok pode trocá-lo sozinho",
      "num refresh — se isso acontecer, o log grita [tiktok] refresh_token",
      "ROTACIONADO e você refaz este fluxo.",
      "-----------------------------------------------------------------",
      "",
    ].join("\n"),
    200
  );
}
