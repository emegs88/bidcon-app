/**
 * lib/google/calendar.ts
 *
 * Integração Google Calendar + Google Meet para a Bidcon.
 *
 * Regras que este módulo garante:
 *  - o access token é renovado a partir do GOOGLE_REFRESH_TOKEN e fica em cache
 *    em memória até 60s antes de expirar (evita um round-trip por chamada);
 *  - todo evento nasce com `conferenceDataVersion=1`, senão o Google cria o
 *    evento SEM link do Meet e não avisa — falha silenciosa clássica;
 *  - o `createRequest` do Meet é assíncrono: a resposta do POST pode voltar com
 *    status `pending`. Fazemos poll do evento até o entryPoint de vídeo existir;
 *  - fuso fixo em America/Sao_Paulo, salvo override explícito;
 *  - remarcação usa PATCH com `conferenceDataVersion=1` também, senão a sala
 *    do Meet pode ser descartada na atualização;
 *  - disponibilidade via freeBusy — devolve só blocos ocupados, sem título,
 *    convidado ou descrição de nada.
 */

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

export const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';

export type CriarEventoInput = {
  /** Título do evento na agenda. */
  titulo: string;
  /** Início do evento. Date ou ISO 8601 com offset (ex.: 2026-08-20T14:00:00-03:00). */
  inicio: Date | string;
  /** Fim do evento. Se ausente, usa `duracaoMinutos`. */
  fim?: Date | string;
  /** Duração em minutos quando `fim` não é informado. Padrão: 30. */
  duracaoMinutos?: number;
  /** Descrição do evento. Atenção ao vocabulário de compliance da Bidcon. */
  descricao?: string;
  /** E-mails dos participantes. */
  convidados?: string[];
  /** Fuso IANA. Padrão: America/Sao_Paulo. */
  timeZone?: string;
  /**
   * Chave estável do agendamento (ex.: id da linha no Supabase). Usada como
   * requestId do Meet para que um retry não gere uma segunda sala.
   */
  chaveIdempotencia?: string;
  /** Envio de convite por e-mail pelo próprio Google. Padrão: 'all'. */
  notificar?: 'all' | 'externalOnly' | 'none';
};

export type EventoCriado = {
  eventId: string;
  htmlLink: string;
  meetUrl: string;
  inicio: string;
  fim: string;
  timeZone: string;
};

type CacheToken = { accessToken: string; expiraEm: number };

let cacheToken: CacheToken | null = null;

/** Lê a resposta como JSON, mas sobrevive a HTML/texto de proxy e gateway. */
async function lerJson(resposta: Response): Promise<any> {
  const texto = await resposta.text();
  try {
    return texto ? JSON.parse(texto) : {};
  } catch {
    return { error: 'resposta_nao_json', error_description: texto.slice(0, 200).trim() };
  }
}


function env(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    throw new Error(
      `[google/calendar] variável de ambiente ausente: ${nome}. ` +
        `Confira as envs do projeto bidcon-plataforma na Vercel (Production).`,
    );
  }
  return valor;
}

/** Troca o refresh token por um access token, com cache em memória. */
export async function obterAccessToken(forcar = false): Promise<string> {
  const agora = Date.now();
  if (!forcar && cacheToken && cacheToken.expiraEm > agora + 60_000) {
    return cacheToken.accessToken;
  }

  const corpo = new URLSearchParams({
    client_id: env('GOOGLE_CLIENT_ID'),
    client_secret: env('GOOGLE_CLIENT_SECRET'),
    refresh_token: env('GOOGLE_REFRESH_TOKEN'),
    grant_type: 'refresh_token',
  });

  const resposta = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corpo.toString(),
    cache: 'no-store',
  });

  const dados = (await lerJson(resposta)) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!resposta.ok || !dados.access_token) {
    const detalhe = dados.error_description ?? dados.error ?? `HTTP ${resposta.status}`;
    if (dados.error === 'invalid_grant') {
      throw new Error(
        `[google/calendar] refresh token inválido ou revogado (${detalhe}). ` +
          `Causas usuais: app OAuth ainda em "Testing" (token expira em 7 dias), ` +
          `senha da conta trocada, ou consentimento dado por outra conta Google. ` +
          `Rode scripts/google-oauth-consent.mjs de novo com a conta dona do calendário.`,
      );
    }
    throw new Error(`[google/calendar] falha ao renovar access token: ${detalhe}`);
  }

  cacheToken = {
    accessToken: dados.access_token,
    expiraEm: agora + (dados.expires_in ?? 3600) * 1000,
  };
  return cacheToken.accessToken;
}

async function chamarCalendar<T>(
  caminho: string,
  init: RequestInit & { query?: Record<string, string> } = {},
): Promise<T> {
  const { query, ...resto } = init;
  const url = new URL(`${CALENDAR_API}${caminho}`);
  for (const [chave, valor] of Object.entries(query ?? {})) {
    url.searchParams.set(chave, valor);
  }

  const executar = async (token: string) =>
    fetch(url, {
      ...resto,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(resto.headers ?? {}),
      },
      cache: 'no-store',
    });

  let resposta = await executar(await obterAccessToken());

  // 401 = access token morreu antes da hora prevista. Renova uma vez e repete.
  if (resposta.status === 401) {
    resposta = await executar(await obterAccessToken(true));
  }

  const dados = await lerJson(resposta);

  if (!resposta.ok) {
    const msg = dados?.error?.message ?? `HTTP ${resposta.status}`;
    throw new Error(`[google/calendar] ${resto.method ?? 'GET'} ${caminho} falhou: ${msg}`);
  }

  return dados as T;
}

function paraIso(valor: Date | string): string {
  return valor instanceof Date ? valor.toISOString() : valor;
}

function extrairMeetUrl(evento: any): string | null {
  const porEntryPoint = evento?.conferenceData?.entryPoints?.find(
    (p: any) => p.entryPointType === 'video' && p.uri,
  )?.uri;
  return porEntryPoint ?? evento?.hangoutLink ?? null;
}

function requestIdEstavel(chave: string | undefined): string {
  if (chave) return `bidcon-${chave}`.slice(0, 64);
  return `bidcon-${crypto.randomUUID()}`;
}

/**
 * Cria um evento na agenda configurada, já com sala do Meet.
 * Retorna somente quando o link do Meet existe de fato.
 */
export async function criarEventoComMeet(input: CriarEventoInput): Promise<EventoCriado> {
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;

  const inicioIso = paraIso(input.inicio);
  const fimIso = input.fim
    ? paraIso(input.fim)
    : new Date(
        new Date(inicioIso).getTime() + (input.duracaoMinutos ?? 30) * 60_000,
      ).toISOString();

  if (Number.isNaN(new Date(inicioIso).getTime())) {
    throw new Error(`[google/calendar] início inválido: ${String(input.inicio)}`);
  }
  if (new Date(fimIso) <= new Date(inicioIso)) {
    throw new Error('[google/calendar] fim do evento precisa ser depois do início.');
  }

  const corpo = {
    summary: input.titulo,
    description: input.descricao,
    start: { dateTime: inicioIso, timeZone },
    end: { dateTime: fimIso, timeZone },
    attendees: (input.convidados ?? []).map((email) => ({ email })),
    conferenceData: {
      createRequest: {
        requestId: requestIdEstavel(input.chaveIdempotencia),
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 },
        { method: 'popup', minutes: 15 },
      ],
    },
  };

  let evento = await chamarCalendar<any>(
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      body: JSON.stringify(corpo),
      // SEM isto o evento nasce sem Meet e a API não reclama.
      query: {
        conferenceDataVersion: '1',
        sendUpdates: input.notificar ?? 'all',
      },
    },
  );

  // O Meet é provisionado de forma assíncrona; espera o link materializar.
  let meetUrl = extrairMeetUrl(evento);
  for (let tentativa = 0; tentativa < 5 && !meetUrl; tentativa += 1) {
    await new Promise((r) => setTimeout(r, 600 * (tentativa + 1)));
    evento = await chamarCalendar<any>(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(evento.id)}`,
      { query: { conferenceDataVersion: '1' } },
    );
    meetUrl = extrairMeetUrl(evento);
  }

  if (!meetUrl) {
    const status = evento?.conferenceData?.createRequest?.status?.statusCode ?? 'desconhecido';
    throw new Error(
      `[google/calendar] evento ${evento.id} criado mas sem link do Meet (status: ${status}). ` +
        `Verifique se a conta ${calendarId} tem o Google Meet habilitado.`,
    );
  }

  return {
    eventId: evento.id,
    htmlLink: evento.htmlLink,
    meetUrl,
    inicio: evento.start?.dateTime ?? inicioIso,
    fim: evento.end?.dateTime ?? fimIso,
    timeZone: evento.start?.timeZone ?? timeZone,
  };
}


// ── Disponibilidade ────────────────────────────────────────────────────────

export type Janela = { inicio: string; fim: string };

/**
 * Consulta os blocos ocupados da agenda no intervalo.
 *
 * Requer o escopo `calendar.freebusy` (ou `calendar.events.freebusy`) além do
 * `calendar.events`. A resposta traz apenas pares início/fim — nunca título,
 * convidado ou descrição. É o que impede o Prosperito de marcar por cima de
 * compromisso que a tabela do Supabase não conhece.
 */
export async function consultarOcupado(
  inicio: Date | string,
  fim: Date | string,
  calendarIds?: string[],
): Promise<Janela[]> {
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
  const ids = calendarIds?.length ? calendarIds : [calendarId];

  const dados = await chamarCalendar<any>('/freeBusy', {
    method: 'POST',
    body: JSON.stringify({
      timeMin: paraIso(inicio),
      timeMax: paraIso(fim),
      timeZone: DEFAULT_TIME_ZONE,
      items: ids.map((id) => ({ id })),
    }),
  });

  const janelas: Janela[] = [];
  for (const id of ids) {
    const entrada = dados?.calendars?.[id];
    const erros = entrada?.errors;
    if (erros?.length) {
      const motivo = erros.map((e: any) => e.reason).join(', ');
      throw new Error(
        `[google/calendar] freeBusy negou ${id}: ${motivo}. ` +
          `Se for "notFound" ou erro de escopo, o consentimento não incluiu ` +
          `calendar.freebusy — refaça o consentimento com os dois escopos.`,
      );
    }
    for (const bloco of entrada?.busy ?? []) {
      janelas.push({ inicio: bloco.start, fim: bloco.end });
    }
  }

  return janelas.sort((a, b) => a.inicio.localeCompare(b.inicio));
}

/** true se o intervalo não colide com nenhum bloco ocupado da agenda. */
export async function horarioLivre(
  inicio: Date | string,
  fim: Date | string,
): Promise<boolean> {
  const i = new Date(paraIso(inicio)).getTime();
  const f = new Date(paraIso(fim)).getTime();
  const ocupado = await consultarOcupado(inicio, fim);
  return !ocupado.some(
    (b) => new Date(b.inicio).getTime() < f && new Date(b.fim).getTime() > i,
  );
}

// ── Remarcação ─────────────────────────────────────────────────────────────

/**
 * Move um evento existente, preservando a mesma sala do Meet.
 * O `conferenceDataVersion=1` aqui não é decorativo: sem ele a atualização
 * pode devolver o evento sem conferenceData e o link some para quem já recebeu.
 */
export async function remarcarEvento(
  eventId: string,
  inicio: Date | string,
  opcoes: { fim?: Date | string; duracaoMinutos?: number; timeZone?: string; notificar?: 'all' | 'externalOnly' | 'none' } = {},
): Promise<EventoCriado> {
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
  const timeZone = opcoes.timeZone ?? DEFAULT_TIME_ZONE;
  const inicioIso = paraIso(inicio);
  const fimIso = opcoes.fim
    ? paraIso(opcoes.fim)
    : new Date(new Date(inicioIso).getTime() + (opcoes.duracaoMinutos ?? 30) * 60_000).toISOString();

  const evento = await chamarCalendar<any>(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        start: { dateTime: inicioIso, timeZone },
        end: { dateTime: fimIso, timeZone },
      }),
      query: {
        conferenceDataVersion: '1',
        sendUpdates: opcoes.notificar ?? 'all',
      },
    },
  );

  const meetUrl = extrairMeetUrl(evento);
  if (!meetUrl) {
    throw new Error(
      `[google/calendar] evento ${eventId} remarcado mas ficou sem link do Meet. ` +
        `Confira o conferenceDataVersion na chamada de PATCH.`,
    );
  }

  return {
    eventId: evento.id,
    htmlLink: evento.htmlLink,
    meetUrl,
    inicio: evento.start?.dateTime ?? inicioIso,
    fim: evento.end?.dateTime ?? fimIso,
    timeZone: evento.start?.timeZone ?? timeZone,
  };
}

/** Cancela um evento. Usado no fluxo de desmarcação. */
export async function cancelarEvento(eventId: string, notificar: 'all' | 'none' = 'all') {
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
  await chamarCalendar(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE', query: { sendUpdates: notificar } },
  );
}

/** Ping barato de saúde da credencial — usar em health check, não em request quente. */
export async function verificarCredencial(): Promise<{ ok: boolean; calendario?: string; erro?: string }> {
  try {
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    const cal = await chamarCalendar<any>(`/calendars/${encodeURIComponent(calendarId)}`);
    return { ok: true, calendario: cal.summary ?? calendarId };
  } catch (erro) {
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }
}
