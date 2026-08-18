#!/usr/bin/env node
/**
 * scripts/google-oauth-consent.mjs
 *
 * Gera o refresh token do Google Calendar para a Bidcon.
 *
 * Dois modos:
 *
 *   node scripts/google-oauth-consent.mjs
 *       Modo loopback (padrão e recomendado). Sobe um servidor em
 *       http://localhost:53682/callback, captura o code e imprime o refresh
 *       token no seu terminal. O token nunca passa por produção.
 *       Cadastre http://localhost:53682/callback como URI de redirecionamento
 *       autorizado — o Google aceita http para localhost.
 *
 *   node scripts/google-oauth-consent.mjs --prod
 *       Usa https://app.bidcon.com.br/api/google/oauth/callback. Exige que a
 *       rota esteja publicada e que GOOGLE_OAUTH_SETUP_SECRET esteja setada
 *       na Vercel e aqui (é o `state`).
 *
 * Pré-requisitos (em .env.local na raiz, ou exportados no shell):
 *   GOOGLE_CLIENT_ID=...
 *   GOOGLE_CLIENT_SECRET=...
 *
 * Escopos pedidos: calendar.events + calendar.freebusy.
 *
 * As duas armadilhas que este script já resolve:
 *   access_type=offline  -> sem isso não vem refresh token
 *   prompt=consent       -> sem isso o Google pula a tela se já houve
 *                           consentimento e devolve só access token
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

// Dois escopos, ambos mínimos para o que a integração faz:
//   calendar.events   -> criar, remarcar e cancelar eventos
//   calendar.freebusy -> ler SÓ blocos ocupados (sem título, convidado ou
//                        descrição), para não marcar por cima de compromisso
// Acrescentar escopo depois obriga a refazer o consentimento — por isso os
// dois vão juntos desde o início.
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
];
const SCOPE = SCOPES.join(' ');
const PORTA_LOOPBACK = 53682;
const REDIRECT_LOOPBACK = `http://localhost:${PORTA_LOOPBACK}/callback`;
const REDIRECT_PROD = 'https://app.bidcon.com.br/api/google/oauth/callback';

const cor = {
  reset: '\x1b[0m',
  azul: '\x1b[38;5;111m',
  ciano: '\x1b[38;5;45m',
  cinza: '\x1b[38;5;245m',
  verde: '\x1b[38;5;79m',
  vermelho: '\x1b[38;5;203m',
  negrito: '\x1b[1m',
};

/** Lê .env.local sem depender de dotenv. */
function carregarEnvLocal() {
  for (const arquivo of ['.env.local', '.env']) {
    const caminho = path.resolve(process.cwd(), arquivo);
    if (!fs.existsSync(caminho)) continue;
    for (const linha of fs.readFileSync(caminho, 'utf8').split('\n')) {
      const limpa = linha.trim();
      if (!limpa || limpa.startsWith('#')) continue;
      const igual = limpa.indexOf('=');
      if (igual < 1) continue;
      const chave = limpa.slice(0, igual).trim();
      let valor = limpa.slice(igual + 1).trim();
      if (
        (valor.startsWith('"') && valor.endsWith('"')) ||
        (valor.startsWith("'") && valor.endsWith("'"))
      ) {
        valor = valor.slice(1, -1);
      }
      if (!(chave in process.env)) process.env[chave] = valor;
    }
  }
}

/** Lê a resposta como JSON, mas sobrevive a HTML/texto de proxy e gateway. */
async function lerJson(resposta) {
  const texto = await resposta.text();
  try {
    return texto ? JSON.parse(texto) : {};
  } catch {
    return { error: 'resposta_nao_json', error_description: texto.slice(0, 200).trim() };
  }
}

function exigir(nome) {
  const valor = process.env[nome];
  if (!valor) {
    console.error(
      `${cor.vermelho}Falta ${nome}.${cor.reset} Coloque em .env.local ou exporte no shell.`,
    );
    process.exit(1);
  }
  return valor;
}

function montarUrlConsentimento({ clientId, redirectUri, state }) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('access_type', 'offline'); // <- sem isso, nada de refresh token
  url.searchParams.set('prompt', 'consent'); // <- força a tela mesmo com consentimento prévio
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);
  return url.toString();
}

async function trocarCodePorToken({ code, clientId, clientSecret, redirectUri }) {
  const resposta = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  const dados = await lerJson(resposta);
  if (!resposta.ok) {
    const detalhe = dados.error_description ?? dados.error ?? `HTTP ${resposta.status}`;
    if (dados.error === 'redirect_uri_mismatch') {
      throw new Error(
        `${detalhe}\n\nO redirect_uri enviado foi:\n  ${redirectUri}\n` +
          `Ele precisa estar cadastrado exatamente assim no cliente OAuth ` +
          `(Credenciais > seu ID do cliente > URIs de redirecionamento autorizados).`,
      );
    }
    throw new Error(detalhe);
  }
  return dados;
}

function imprimirResultado(dados) {
  console.log('');
  if (!dados.refresh_token) {
    console.log(`${cor.vermelho}${cor.negrito}Veio access token, mas não refresh token.${cor.reset}`);
    console.log(
      `${cor.cinza}O Google reaproveitou um consentimento anterior. Revogue o acesso do app em\n` +
        `https://myaccount.google.com/permissions e rode de novo.${cor.reset}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`${cor.verde}${cor.negrito}✓ Refresh token gerado${cor.reset}`);
  console.log(`${cor.cinza}Aparece uma única vez. Copie agora.${cor.reset}\n`);
  console.log(`${cor.ciano}${dados.refresh_token}${cor.reset}\n`);
  console.log(`${cor.cinza}Escopos: ${dados.scope ?? '—'}${cor.reset}`);
  console.log('');
  console.log(`${cor.azul}Próximos passos${cor.reset}`);
  console.log(`  1. Vercel > bidcon-plataforma > Settings > Environment Variables`);
  console.log(`  2. GOOGLE_REFRESH_TOKEN = (o valor acima), Production, Sensitive LIGADO`);
  console.log(`  3. Redeploy`);
  console.log(`  4. node scripts/test-meet-event.mjs`);
  console.log('');
}

async function modoLoopback({ clientId, clientSecret }) {
  const state = randomBytes(16).toString('hex');
  const url = montarUrlConsentimento({ clientId, redirectUri: REDIRECT_LOOPBACK, state });

  console.log('');
  console.log(`${cor.azul}${cor.negrito}Consentimento Google Calendar — Bidcon${cor.reset}`);
  console.log(`${cor.cinza}Modo loopback. O token não sai desta máquina.${cor.reset}\n`);
  console.log(`${cor.cinza}Confirme que ${REDIRECT_LOOPBACK}${cor.reset}`);
  console.log(`${cor.cinza}está nos URIs de redirecionamento autorizados do cliente OAuth.${cor.reset}\n`);
  console.log(`${cor.negrito}Abra esta URL logado em contato@bidcon.com.br:${cor.reset}\n`);
  console.log(`${cor.ciano}${url}${cor.reset}\n`);
  console.log(`${cor.cinza}Confira o avatar na tela do Google antes de clicar em Permitir.${cor.reset}`);
  console.log(`${cor.cinza}Aguardando o retorno em ${REDIRECT_LOOPBACK} ...${cor.reset}`);

  await new Promise((resolver, rejeitar) => {
    const servidor = http.createServer(async (req, res) => {
      const recebida = new URL(req.url, `http://localhost:${PORTA_LOOPBACK}`);
      if (recebida.pathname !== '/callback') {
        res.writeHead(404).end('not found');
        return;
      }

      const responderHtml = (titulo, texto) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          `<!doctype html><meta charset="utf-8"><title>${titulo}</title>` +
            `<body style="margin:0;padding:64px 24px;background:#0A0E1A;color:#E8EEF9;` +
            `font-family:system-ui,sans-serif;text-align:center">` +
            `<h1 style="font-size:20px">${titulo}</h1>` +
            `<p style="color:#9FB0CC;font-size:14px">${texto}</p></body>`,
        );
      };

      try {
        if (recebida.searchParams.get('state') !== state) {
          responderHtml('State não confere', 'Feche e rode o script de novo.');
          throw new Error('state divergente — possível callback de outra sessão');
        }
        const erro = recebida.searchParams.get('error');
        if (erro) {
          responderHtml('Consentimento recusado', erro);
          throw new Error(`Google devolveu: ${erro}`);
        }
        const code = recebida.searchParams.get('code');
        if (!code) {
          responderHtml('Faltou o code', 'A URL de retorno veio sem code.');
          throw new Error('callback sem code');
        }

        const dados = await trocarCodePorToken({
          code,
          clientId,
          clientSecret,
          redirectUri: REDIRECT_LOOPBACK,
        });
        responderHtml('Pronto', 'Volte para o terminal — o refresh token está lá.');
        imprimirResultado(dados);
        servidor.close(() => resolver());
      } catch (e) {
        servidor.close(() => rejeitar(e));
      }
    });

    servidor.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        rejeitar(new Error(`A porta ${PORTA_LOOPBACK} já está em uso. Feche o processo e tente de novo.`));
      } else {
        rejeitar(e);
      }
    });

    servidor.listen(PORTA_LOOPBACK, '127.0.0.1');

    setTimeout(() => {
      servidor.close(() => rejeitar(new Error('Tempo esgotado (5 min) sem retorno do Google.')));
    }, 5 * 60_000).unref();
  });
}

function modoProducao({ clientId }) {
  const state = exigir('GOOGLE_OAUTH_SETUP_SECRET');
  const url = montarUrlConsentimento({ clientId, redirectUri: REDIRECT_PROD, state });

  console.log('');
  console.log(`${cor.azul}${cor.negrito}Consentimento Google Calendar — Bidcon (modo produção)${cor.reset}\n`);
  console.log(`${cor.cinza}URI de redirecionamento que precisa estar cadastrada:${cor.reset}`);
  console.log(`  ${REDIRECT_PROD}\n`);
  console.log(`${cor.negrito}Abra esta URL logado em contato@bidcon.com.br:${cor.reset}\n`);
  console.log(`${cor.ciano}${url}${cor.reset}\n`);
  console.log(`${cor.cinza}Confira o avatar antes de Permitir. O refresh token aparece na própria`);
  console.log(`página de retorno, uma única vez.${cor.reset}\n`);
}

async function main() {
  carregarEnvLocal();
  const clientId = exigir('GOOGLE_CLIENT_ID');
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  const producao = process.argv.includes('--prod');
  if (producao) {
    modoProducao({ clientId });
    return;
  }
  if (!clientSecret) exigir('GOOGLE_CLIENT_SECRET');
  await modoLoopback({ clientId, clientSecret });
}

main().catch((erro) => {
  console.error(`\n${cor.vermelho}Falhou:${cor.reset} ${erro.message}\n`);
  process.exit(1);
});
