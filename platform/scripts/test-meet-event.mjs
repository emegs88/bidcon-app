#!/usr/bin/env node
/**
 * scripts/test-meet-event.mjs
 *
 * Teste de aceite da credencial. Roda ANTES de qualquer cliente ver isso.
 *
 * Verifica, nesta ordem:
 *   1. o refresh token troca por access token;
 *   2. o calendário configurado é acessível;
 *   3. um evento nasce COM link do Meet (é aqui que o conferenceDataVersion
 *      aparece — se o link vier vazio, o problema é o parâmetro, não a credencial);
 *   4. o horário volta no fuso America/Sao_Paulo;
 *   5. o escopo calendar.freebusy foi concedido (consulta de disponibilidade).
 *
 * Uso:
 *   node scripts/test-meet-event.mjs            cria e mantém o evento
 *   node scripts/test-meet-event.mjs --limpar   cria, valida e apaga em seguida
 *
 * Envs (de .env.local ou do shell):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_CALENDAR_ID
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const TZ = 'America/Sao_Paulo';

const cor = {
  reset: '\x1b[0m',
  azul: '\x1b[38;5;111m',
  ciano: '\x1b[38;5;45m',
  cinza: '\x1b[38;5;245m',
  verde: '\x1b[38;5;79m',
  vermelho: '\x1b[38;5;203m',
  negrito: '\x1b[1m',
};

const ok = (m) => console.log(`  ${cor.verde}✓${cor.reset} ${m}`);
const falha = (m) => console.log(`  ${cor.vermelho}✗${cor.reset} ${m}`);

function carregarEnvLocal() {
  for (const arquivo of ['.env.local', '.env']) {
    const caminho = path.resolve(process.cwd(), arquivo);
    if (!fs.existsSync(caminho)) continue;
    for (const linha of fs.readFileSync(caminho, 'utf8').split('\n')) {
      const limpa = linha.trim();
      if (!limpa || limpa.startsWith('#')) continue;
      const i = limpa.indexOf('=');
      if (i < 1) continue;
      const chave = limpa.slice(0, i).trim();
      let valor = limpa.slice(i + 1).trim();
      if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
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
  const v = process.env[nome];
  if (!v) {
    falha(`variável ${nome} ausente`);
    process.exit(1);
  }
  return v;
}

async function obterAccessToken() {
  const resposta = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: exigir('GOOGLE_CLIENT_ID'),
      client_secret: exigir('GOOGLE_CLIENT_SECRET'),
      refresh_token: exigir('GOOGLE_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }).toString(),
  });
  const dados = await lerJson(resposta);
  if (!resposta.ok) {
    const detalhe = dados.error_description ?? dados.error ?? `HTTP ${resposta.status}`;
    if (dados.error === 'invalid_grant') {
      throw new Error(
        `${detalhe}\n\n    Traduzindo: o refresh token não vale mais.\n` +
          `    Causa mais provável: o app OAuth ficou em "Testing" (token morre em 7 dias).\n` +
          `    Publique o app e gere o token de novo.`,
      );
    }
    throw new Error(detalhe);
  }
  return dados.access_token;
}

async function api(token, caminho, { method = 'GET', body, query } = {}) {
  const url = new URL(`${CALENDAR_API}${caminho}`);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  const resposta = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const dados = await lerJson(resposta);
  if (!resposta.ok) throw new Error(dados?.error?.message ?? `HTTP ${resposta.status}`);
  return dados;
}

/** Amanhã às 10:00 em São Paulo (UTC-3, sem horário de verão desde 2019). */
function amanhaAsDez() {
  const agora = new Date();
  const spNow = new Date(agora.getTime() - 3 * 3600_000);
  const y = spNow.getUTCFullYear();
  const m = spNow.getUTCMonth();
  const d = spNow.getUTCDate() + 1;
  const dia = new Date(Date.UTC(y, m, d));
  const iso = (h) =>
    `${dia.getUTCFullYear()}-${String(dia.getUTCMonth() + 1).padStart(2, '0')}-${String(
      dia.getUTCDate(),
    ).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00-03:00`;
  return { inicio: iso(10), fim: iso(11) };
}

function extrairMeet(evento) {
  return (
    evento?.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video' && p.uri)?.uri ??
    evento?.hangoutLink ??
    null
  );
}

async function main() {
  carregarEnvLocal();
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
  const limpar = process.argv.includes('--limpar');

  console.log(`\n${cor.azul}${cor.negrito}Teste de aceite — Google Meet / Bidcon${cor.reset}\n`);

  console.log(`${cor.cinza}1. credencial${cor.reset}`);
  const token = await obterAccessToken();
  ok('refresh token trocado por access token');

  console.log(`\n${cor.cinza}2. calendário${cor.reset}`);
  const cal = await api(token, `/calendars/${encodeURIComponent(calendarId)}`);
  ok(`acessível: ${cal.summary ?? calendarId}${cal.timeZone ? ` (fuso ${cal.timeZone})` : ''}`);
  if (cal.timeZone && cal.timeZone !== TZ) {
    console.log(
      `  ${cor.cinza}nota: o fuso padrão do calendário é ${cal.timeZone}; os eventos são criados com ${TZ} explícito.${cor.reset}`,
    );
  }

  console.log(`\n${cor.cinza}3. evento com Meet${cor.reset}`);
  const { inicio, fim } = amanhaAsDez();
  let evento = await api(token, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    query: { conferenceDataVersion: '1', sendUpdates: 'none' },
    body: {
      summary: '[TESTE] Conversa de planejamento — Bidcon',
      description:
        'Evento de teste da integração de agendamento. Pode apagar.\n' +
        'Conversa sobre planejamento e compra programada de carta de crédito.',
      start: { dateTime: inicio, timeZone: TZ },
      end: { dateTime: fim, timeZone: TZ },
      conferenceData: {
        createRequest: {
          requestId: `bidcon-teste-${randomUUID()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    },
  });
  ok(`criado: ${evento.id}`);

  let meet = extrairMeet(evento);
  for (let i = 0; i < 5 && !meet; i += 1) {
    await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    evento = await api(
      token,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(evento.id)}`,
      { query: { conferenceDataVersion: '1' } },
    );
    meet = extrairMeet(evento);
  }

  let saudavel = true;

  if (meet) {
    ok(`link do Meet: ${cor.ciano}${meet}${cor.reset}`);
  } else {
    saudavel = false;
    falha('evento nasceu SEM link do Meet');
    console.log(
      `    ${cor.cinza}Isso é o sintoma do conferenceDataVersion ausente na chamada de criação,\n` +
        `    ou do Meet desabilitado para ${calendarId}. A credencial em si está boa.${cor.reset}`,
    );
  }

  console.log(`\n${cor.cinza}4. fuso e horário${cor.reset}`);
  const tzVolta = evento.start?.timeZone;
  if (tzVolta === TZ) ok(`fuso confirmado: ${tzVolta}`);
  else {
    saudavel = false;
    falha(`fuso voltou como ${tzVolta ?? '—'}, esperado ${TZ}`);
  }
  ok(`início: ${evento.start?.dateTime} · fim: ${evento.end?.dateTime}`);
  console.log(`  ${cor.cinza}na agenda: ${evento.htmlLink}${cor.reset}`);

  console.log(`\n${cor.cinza}5. disponibilidade (freeBusy)${cor.reset}`);
  try {
    const fb = await api(token, '/freeBusy', {
      method: 'POST',
      body: {
        timeMin: inicio,
        timeMax: fim,
        timeZone: TZ,
        items: [{ id: calendarId }],
      },
    });
    const entrada = fb?.calendars?.[calendarId];
    if (entrada?.errors?.length) {
      throw new Error(entrada.errors.map((e) => e.reason).join(', '));
    }
    ok(`escopo calendar.freebusy ativo (${entrada?.busy?.length ?? 0} bloco(s) ocupado(s) na janela do teste)`);
  } catch (e) {
    saudavel = false;
    falha(`freeBusy indisponível: ${e.message}`);
    console.log(
      `    ${cor.cinza}O consentimento provavelmente saiu só com calendar.events.\n` +
        `    Sem freeBusy o agendamento marca por cima de compromisso que o Supabase não conhece.\n` +
        `    Refaça: node scripts/google-oauth-consent.mjs (já pede os dois escopos).${cor.reset}`,
    );
  }

  if (limpar) {
    await api(
      token,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(evento.id)}`,
      { method: 'DELETE', query: { sendUpdates: 'none' } },
    );
    console.log(`\n${cor.cinza}evento de teste removido.${cor.reset}`);
  } else {
    console.log(
      `\n${cor.cinza}o evento ficou na agenda — abra o link do Meet para confirmar, depois apague.` +
        `\n(ou rode de novo com --limpar)${cor.reset}`,
    );
  }

  console.log(
    saudavel
      ? `\n${cor.verde}${cor.negrito}Aceite passou.${cor.reset}\n`
      : `\n${cor.vermelho}${cor.negrito}Aceite reprovou — veja os ✗ acima.${cor.reset}\n`,
  );
  process.exit(saudavel ? 0 : 1);
}

main().catch((erro) => {
  console.error(`\n${cor.vermelho}Falhou:${cor.reset} ${erro.message}\n`);
  process.exit(1);
});
