/**
 * app/api/google/oauth/callback/route.ts
 *
 * Callback do consentimento OAuth do Google. Existe para uma coisa só:
 * trocar o `code` pelo refresh token e mostrá-lo UMA vez, para você colar
 * na Vercel. Não é rota de produto.
 *
 * Proteções:
 *  - exige `state` idêntico a GOOGLE_OAUTH_SETUP_SECRET (comparação de tempo
 *    constante). Sem o secret configurado, a rota responde 404;
 *  - `noindex`, `no-store`, sem log do token;
 *  - depois de capturar o token, remova/desabilite: apague a env
 *    GOOGLE_OAUTH_SETUP_SECRET e a rota volta a responder 404 sozinha.
 *
 * URI a cadastrar no Google Cloud (caractere por caractere):
 *   https://app.bidcon.com.br/api/google/oauth/callback
 */

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ?? 'https://app.bidcon.com.br/api/google/oauth/callback';

/** Lê a resposta como JSON, mas sobrevive a HTML/texto de proxy e gateway. */
async function lerJson(resposta: Response): Promise<any> {
  const texto = await resposta.text();
  try {
    return texto ? JSON.parse(texto) : {};
  } catch {
    return { error: 'resposta_nao_json', error_description: texto.slice(0, 200).trim() };
  }
}

function comparaSegredo(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function pagina(titulo: string, corpo: string, status = 200) {
  const html = `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:48px 24px; background:#0A0E1A; color:#E8EEF9;
         font-family:'Space Grotesk',system-ui,sans-serif; }
  main { max-width:720px; margin:0 auto; }
  h1 { font-size:22px; margin:0 0 8px;
       background:linear-gradient(90deg,#8FB7FF,#36C5F0,#1E6FE6);
       -webkit-background-clip:text; background-clip:text; color:transparent; }
  p { color:#9FB0CC; line-height:1.6; font-size:14px; }
  code, pre { font-family:'IBM Plex Mono',ui-monospace,monospace; }
  pre { background:#111827; border:1px solid #1F2A3D; border-radius:10px;
        padding:16px; overflow-x:auto; font-size:13px; color:#8FB7FF;
        user-select:all; white-space:pre-wrap; word-break:break-all; }
  ol { color:#9FB0CC; font-size:14px; line-height:1.8; }
</style></head>
<body><main><h1>${titulo}</h1>${corpo}</main></body></html>`;
  return new NextResponse(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

export async function GET(req: NextRequest) {
  const setupSecret = process.env.GOOGLE_OAUTH_SETUP_SECRET;
  // Sem secret configurado a rota simplesmente não existe.
  if (!setupSecret) return new NextResponse('Not found', { status: 404 });

  const params = req.nextUrl.searchParams;
  const state = params.get('state') ?? '';
  if (!comparaSegredo(state, setupSecret)) {
    return new NextResponse('Not found', { status: 404 });
  }

  const erroGoogle = params.get('error');
  if (erroGoogle) {
    return pagina(
      'Consentimento recusado',
      `<p>O Google devolveu <code>${erroGoogle}</code>. Rode o script de novo e clique em “Permitir”.</p>`,
      400,
    );
  }

  const code = params.get('code');
  if (!code) {
    return pagina('Faltou o code', '<p>A URL de retorno veio sem <code>code</code>.</p>', 400);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return pagina(
      'Envs faltando',
      '<p>Configure <code>GOOGLE_CLIENT_ID</code> e <code>GOOGLE_CLIENT_SECRET</code> na Vercel (Production) e refaça o deploy.</p>',
      500,
    );
  }

  const resposta = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString(),
    cache: 'no-store',
  });

  const dados = (await lerJson(resposta)) as {
    refresh_token?: string;
    access_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!resposta.ok) {
    const detalhe = dados.error_description ?? dados.error ?? `HTTP ${resposta.status}`;
    const dica =
      dados.error === 'redirect_uri_mismatch'
        ? `<p>O <code>redirect_uri</code> enviado foi <code>${REDIRECT_URI}</code>. Ele precisa estar cadastrado <em>exatamente assim</em> no cliente OAuth — sem barra a mais, sem http.</p>`
        : '';
    return pagina('Troca de código falhou', `<p>${detalhe}</p>${dica}`, 400);
  }

  if (!dados.refresh_token) {
    return pagina(
      'Veio access token, não refresh token',
      `<p>O Google já tinha consentimento anterior para esta conta e devolveu só um token de 1 hora.
       Rode o script novamente — ele já força <code>access_type=offline</code> e <code>prompt=consent</code>.
       Se persistir, revogue o acesso do app em
       <code>myaccount.google.com/permissions</code> e repita.</p>`,
      400,
    );
  }

  return pagina(
    'Refresh token gerado',
    `<p>Aparece uma única vez. Copie agora.</p>
     <pre>${dados.refresh_token}</pre>
     <p>Escopos concedidos: <code>${dados.scope ?? '—'}</code></p>
     <ol>
       <li>Cole em <code>GOOGLE_REFRESH_TOKEN</code> na Vercel (Production, <strong>Sensitive</strong> ligado).</li>
       <li>Redeploy.</li>
       <li>Apague a env <code>GOOGLE_OAUTH_SETUP_SECRET</code> — esta rota volta a responder 404.</li>
       <li>Rode o teste de aceite: <code>node scripts/test-meet-event.mjs</code>.</li>
     </ol>`,
  );
}
