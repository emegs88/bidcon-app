// ============================================================================
// GET /api/radar/varredura — FATIA SENTINELA-RADAR-01, Parte 2
// A varredura que mede as cinco condições e escreve em radar_alertas.
// AUTORIZADO: Emerson, 15/08/2026.
// ----------------------------------------------------------------------------
// TRÊS FASES, e a separação entre elas é o ponto da fatia:
//   1) MEDIR   — só leitura. Toda a conversa com o banco acontece aqui.
//   2) JULGAR  — funções puras de lib/radar/vigias.ts. Nenhuma toca banco.
//   3) GRAVAR  — abre o que alarmou, FECHA o que foi medido e não alarmou.
//
// A fase 2 estar separada é o que permite provar "o RADAR alarma quando deve e
// cala quando não deve" com 44 testes que rodam em 20ms, sem levantar Postgres.
//
// ----------------------------------------------------------------------------
// KILL-SWITCH DESARMADO NÃO SIGNIFICA ROTA MORTA
//
// A ordem foi explícita: `RADAR` nasce desarmado. Aqui isso quer dizer que a
// rota MEDE e RELATA, mas não escreve nada — o Emerson pode chamá-la e ver
// exatamente quais alertas ela abriria antes de deixar que ela abra. Uma rota
// que só devolve 503 enquanto desarmada não deixa ninguém conferir o
// julgamento, e aí ligar o RADAR vira um salto no escuro.
//
// Nenhuma mensagem sai desta rota. Nada de WhatsApp, nada de e-mail. Escrever
// numa tabela e aparecer num painel é todo o alcance desta fatia.
//
// ----------------------------------------------------------------------------
// O BASELINE DA PROVA DE AMOSTRA É A DECLARAÇÃO DA FONTE, NÃO A MÉDIA DELA
//
// Este é um desvio que declaro. O caminho óbvio seria comparar a taxa de agora
// com a mediana das taxas passadas. Duas medições de 16/08/2026 mostram por que
// isso seria pior:
//
//   - `sync_raw_*` só existe desde 15/08 21:00. Fonte sem passado teria baseline
//     nenhum, e o vigia ficaria calado justamente na estreia.
//   - CARTAS acumulou 39 eventos `sync_raw_ausente` em 24h, TODOS com
//     recebidas=0. A mediana histórica dela já é ZERO. Um baseline por média
//     faria o RADAR se ACOSTUMAR com o defeito — quanto mais tempo quebrado,
//     menos motivo para alarmar. É o pior defeito possível num vigia.
//
// O evento já traz a resposta melhor: `espera=1` é a fonte declarando que
// sustenta o cru; `espera=0` é LANCE dizendo que não manda cru por desenho.
// Comparar `recebidas/lidas` contra `espera` distingue os dois casos sem
// histórico nenhum e sem nunca se acostumar.
//
// ----------------------------------------------------------------------------
// O HORÁRIO DO CRON FAZ PARTE DA LÓGICA — `20 */3 * * *` em vercel.json
//
// Duas escolhas, e nenhuma é arbitrária:
//
//   - De 3 em 3 horas, porque é exatamente JANELA_CICLO_MS. Cada varredura
//     enxerga a janela desde a anterior, sem buraco e sem sobreposição longa.
//     Isso não vira spam: um alerta é por CONDIÇÃO, então repetir a varredura
//     numa condição que já está aberta só incrementa `ocorrencias`.
//   - No minuto 20, não no 0. O sync roda `0 * * * *` e leva ~24s; medir em
//     cima dele leria um ciclo pela metade. Vinte minutos é folga larga.
//
// A ARMADILHA: o vigia do FAROL só pode alarmar a partir de HORA_COBRANCA_FAROL
// (16h SP). Se alguém encolher este cron para rodar só de manhã, aquele vigia
// vira código morto SEM ERRO NENHUM — nunca mais alarma, e ninguém descobre
// porque a ausência de alerta parece boa notícia. Com `*/3` há sempre uma
// passagem às 18h20 SP. Quem mexer no horário precisa manter uma depois das 16h.
// ============================================================================
import { NextResponse } from "next/server";
import { createXtvClient } from "@/lib/supabase-xtv";
import { amostraDe, divergenciasDe, saudeSyncDe } from "@/lib/radar/eventos";
import { horasUteisEntre, percentil, radarLigado, ENV_KILL_SWITCH } from "@/lib/radar/limiar";
import {
  CHAVE_ESTOQUE_NIVEL,
  CHAVE_ESTOQUE_SEM_MOVIMENTO,
  CHAVE_FAROL_SEM_PUBLICAR,
  CHAVE_FILA_ENVELHECENDO,
  TIPO_AMOSTRA,
  TIPO_DIVERGENCIA,
  TIPO_ESTOQUE,
  TIPO_FAROL,
  TIPO_FILA_SENTINELA,
  vigiaDivergenciaSync,
  vigiaEstoqueNivel,
  vigiaEstoqueSemMovimento,
  vigiaFarolSemPublicar,
  vigiaFilaSentinela,
  vigiaProvaAmostra,
  type Alerta,
} from "@/lib/radar/vigias";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Quanto tempo para trás conta como "o ciclo mais recente". O sync roda de
 * hora em hora; 3h dá folga para dois ciclos pulados sem o RADAR declarar
 * resolvido o que ninguém resolveu.
 */
const JANELA_CICLO_MS = 3 * 60 * 60 * 1000;
/** Teto de eventos lidos por tipo. `ciclo_integridade_falhou` tem 274 no total. */
const TETO_EVENTOS = 500;
const MS_POR_HORA = 3_600_000;

function autorizado(req: Request): boolean {
  const secret = process.env.RADAR_SECRET || process.env.CRON_SECRET;
  if (!secret) return false; // sem secret configurado => não roda
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/** A hora em São Paulo. `new Date().getHours()` daria a hora do servidor (UTC). */
function horaSP(agora: Date): number {
  const h = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hour12: false,
  }).format(agora);
  return Number(h);
}

/**
 * O instante em que começou o dia de hoje em São Paulo. O Brasil não tem
 * horário de verão desde 2019, então -03:00 é fixo — se voltar, este ponto é
 * o que quebra, e por isso está isolado numa função.
 */
function inicioDoDiaSP(agora: Date): Date {
  const data = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
  return new Date(`${data}T00:00:00-03:00`);
}

type EventoCru = { tipo: string; detalhe: string | null; em: string };

export async function GET(req: Request) {
  if (!autorizado(req)) {
    return NextResponse.json({ ok: false, erro: "nao_autorizado" }, { status: 401 });
  }

  const url = new URL(req.url);
  const armado = radarLigado();
  // Desarmado é dry-run forçado. Ver o cabeçalho.
  const dryRun = url.searchParams.get("dry_run") === "1" || !armado;

  const db = createXtvClient();
  const agora = new Date();
  const desdeJanela = new Date(agora.getTime() - JANELA_CICLO_MS);
  const desde24h = new Date(agora.getTime() - 24 * MS_POR_HORA);

  const alertas: Alerta[] = [];
  /** Toda condição (tipo, chave) que esta varredura CONSEGUIU julgar. Só o que
   *  está aqui pode ser resolvido automaticamente — o que não foi medido fica
   *  como está, porque "não medi" não é "está bom". */
  const julgadas = new Set<string>();
  const avisos: string[] = [];
  const marcar = (tipo: string, chave: string) => julgadas.add(`${tipo}\u0000${chave}`);

  // =========================================================================
  // FASE 1 — MEDIR
  // =========================================================================

  // --- 1a. divergências de sync, por fonte -------------------------------
  const { data: ciclos, error: errCiclos } = await db
    .from("eventos_sync")
    .select("tipo, detalhe, em")
    .eq("tipo", "ciclo_integridade_falhou")
    .order("em", { ascending: false })
    .limit(TETO_EVENTOS);
  if (errCiclos) avisos.push(`ciclo_integridade_falhou: ${errCiclos.message}`);

  const porFonteDiv = new Map<string, { atual: number; historico: number[] }>();
  for (const ev of (ciclos ?? []) as EventoCru[]) {
    const { fonte, divergencias } = divergenciasDe(ev.detalhe);
    if (!fonte || divergencias === null) continue;
    const balde = porFonteDiv.get(fonte) ?? { atual: 0, historico: [] };
    if (new Date(ev.em) >= desdeJanela) {
      // Dentro da janela pode haver mais de um ciclo. O pior manda: se um
      // ciclo deu 621, a média com um ciclo de 1 esconderia o 621.
      balde.atual = Math.max(balde.atual, divergencias);
    } else {
      balde.historico.push(divergencias);
    }
    porFonteDiv.set(fonte, balde);
  }

  // --- 1b. prova de amostra, por fonte -----------------------------------
  const { data: raws, error: errRaw } = await db
    .from("eventos_sync")
    .select("tipo, detalhe, em")
    .in("tipo", ["sync_raw_ok", "sync_raw_ausente", "sync_raw_desenho"])
    .gte("em", desdeJanela.toISOString())
    .order("em", { ascending: false })
    .limit(TETO_EVENTOS);
  if (errRaw) avisos.push(`sync_raw_*: ${errRaw.message}`);

  // Só o evento MAIS RECENTE de cada fonte. A lista vem em ordem decrescente,
  // então o primeiro que aparecer é o dele.
  const ultimoRaw = new Map<
    string,
    { espera: number; lidas: number; recebidas: number }
  >();
  for (const ev of (raws ?? []) as EventoCru[]) {
    const a = amostraDe(ev.detalhe);
    if (!a.fonte || ultimoRaw.has(a.fonte)) continue;
    if (a.lidas === null || a.recebidas === null) continue;
    ultimoRaw.set(a.fonte, { espera: a.espera ?? 0, lidas: a.lidas, recebidas: a.recebidas });
  }

  // --- 1c. estoque -------------------------------------------------------
  const [disp, novas24h, saidas24h, ciclos24h, ultimaNova, ultimoFim] = await Promise.all([
    db.from("cartas").select("id", { count: "exact", head: true }).eq("status", "disponivel"),
    db
      .from("eventos_sync")
      .select("id", { count: "exact", head: true })
      .eq("tipo", "carta_nova")
      .gte("em", desde24h.toISOString()),
    db
      .from("eventos_sync")
      .select("id", { count: "exact", head: true })
      .eq("tipo", "carta_indisponivel")
      .gte("em", desde24h.toISOString()),
    db
      .from("eventos_sync")
      .select("id", { count: "exact", head: true })
      .eq("tipo", "sync_fim")
      .gte("em", desde24h.toISOString()),
    db
      .from("eventos_sync")
      .select("em")
      .eq("tipo", "carta_nova")
      .order("em", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // O último `sync_fim` carrega `fontes_ok` e `fontes_falha`. É o que autoriza
    // o vigia de movimento a dizer "o sync está SAUDÁVEL e mesmo assim nada
    // entrou" — sem isso ele diria só "nada entrou", que é metade da frase e a
    // metade que não acusa ninguém.
    db
      .from("eventos_sync")
      .select("detalhe")
      .eq("tipo", "sync_fim")
      .order("em", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  for (const [nome, r] of [
    ["cartas_disponiveis", disp],
    ["carta_nova_24h", novas24h],
    ["carta_indisponivel_24h", saidas24h],
    ["sync_fim_24h", ciclos24h],
    ["ultima_carta_nova", ultimaNova],
    ["ultimo_sync_fim", ultimoFim],
  ] as const) {
    if (r.error) avisos.push(`${nome}: ${r.error.message}`);
  }

  // --- 1d. FAROL ---------------------------------------------------------
  const inicioDia = inicioDoDiaSP(agora);
  const { count: publicadosHoje, error: errFarol } = await db
    .from("farol_posts")
    .select("id", { count: "exact", head: true })
    .like("acao", "%publicado")
    .gte("criado_em", inicioDia.toISOString());
  if (errFarol) avisos.push(`farol_posts: ${errFarol.message}`);

  // --- 1e. fila do Sentinela ---------------------------------------------
  const ESPERANDO = ["pendente", "aguardando_template", "enviado"];
  const [fila, maisAntiga] = await Promise.all([
    db.from("sentinela_fila").select("id", { count: "exact", head: true }).in("status", ESPERANDO),
    db
      .from("sentinela_fila")
      .select("criado_em")
      .in("status", ESPERANDO)
      .order("criado_em", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  if (fila.error) avisos.push(`sentinela_fila: ${fila.error.message}`);
  if (maisAntiga.error) avisos.push(`sentinela_fila_antiga: ${maisAntiga.error.message}`);

  // =========================================================================
  // FASE 2 — JULGAR. Daqui para baixo, nenhuma linha toca o banco.
  // =========================================================================

  // 1. divergência
  for (const [fonte, balde] of porFonteDiv) {
    marcar(TIPO_DIVERGENCIA, fonte);
    const a = vigiaDivergenciaSync({
      fonte,
      divergencias: balde.atual,
      historico: balde.historico,
    });
    if (a) alertas.push(a);
  }

  // 2. prova de amostra — baseline = o que a fonte DECLARA esperar.
  for (const [fonte, m] of ultimoRaw) {
    marcar(TIPO_AMOSTRA, fonte);
    const a = vigiaProvaAmostra({
      fonte,
      lidas: m.lidas,
      recebidas: m.recebidas,
      baselineTaxa: m.espera,
    });
    if (a) alertas.push(a);
  }

  // 3. estoque — nível e movimento, duas condições da mesma família.
  const disponiveis = disp.count ?? null;
  const novas = novas24h.count ?? null;
  const saidas = saidas24h.count ?? null;
  if (disponiveis !== null && novas !== null && saidas !== null) {
    marcar(TIPO_ESTOQUE, CHAVE_ESTOQUE_NIVEL);
    // O nível de 24h atrás, exato: o de agora, menos o que entrou, mais o que
    // saiu. Não é estimativa — os dois fluxos são contados evento a evento.
    const baseline = disponiveis - novas + saidas;
    const a = vigiaEstoqueNivel({
      disponiveisAgora: disponiveis,
      disponiveisBaseline: baseline,
    });
    if (a) alertas.push(a);
  } else {
    avisos.push("estoque_nivel: nao julgado (contagem faltando)");
  }

  const ultimaNovaEm = (ultimaNova.data as { em: string } | null)?.em ?? null;
  const ciclosNoPeriodo = ciclos24h.count ?? 0;
  if (ultimaNovaEm) {
    marcar(TIPO_ESTOQUE, CHAVE_ESTOQUE_SEM_MOVIMENTO);
    const saude = saudeSyncDe((ultimoFim.data as { detalhe: string } | null)?.detalhe);
    const a = vigiaEstoqueSemMovimento({
      // HORA ÚTIL, não hora corrida — e a conta é `horasUteisEntre`, não uma
      // subtração aqui. A subtração é o defeito que esta linha corrigiu: as
      // noites normais medem 13 a 15 horas corridas e todo fim de semana mede
      // 62, então em hora corrida não existe limiar que sirva.
      horasUteisSemCartaNova: horasUteisEntre(new Date(ultimaNovaEm), agora),
      ciclosNoPeriodo,
      fontesOk: saude.fontesOk ?? undefined,
      fontesFalha: saude.fontesFalha ?? undefined,
    });
    if (a) alertas.push(a);
  } else {
    avisos.push("estoque_movimento: nao julgado (nenhum carta_nova registrado)");
  }

  // 4. FAROL
  if (!errFarol) {
    marcar(TIPO_FAROL, CHAVE_FAROL_SEM_PUBLICAR);
    const a = vigiaFarolSemPublicar({
      horaSP: horaSP(agora),
      publicadosHoje: publicadosHoje ?? 0,
    });
    if (a) alertas.push(a);
  }

  // 5. fila do Sentinela
  if (!fila.error && !maisAntiga.error) {
    marcar(TIPO_FILA_SENTINELA, CHAVE_FILA_ENVELHECENDO);
    const antiga = (maisAntiga.data as { criado_em: string } | null)?.criado_em ?? null;
    const a = vigiaFilaSentinela({
      maisAntigaEm: antiga ? new Date(antiga) : null,
      quantasEsperando: fila.count ?? 0,
      agora,
    });
    if (a) alertas.push(a);
  }

  // =========================================================================
  // FASE 3 — GRAVAR
  // =========================================================================
  const abertos = new Set(alertas.map((a) => `${a.tipo}\u0000${a.chave}`));
  /** Julgado, e não alarmou: a condição passou. Fecha. O que NÃO foi julgado
   *  nesta rodada não entra aqui — silêncio de medição não é boa notícia. */
  const aResolver = [...julgadas].filter((k) => !abertos.has(k));

  const gravados: { tipo: string; chave: string; novo: boolean; ocorrencias: number }[] = [];
  const resolvidos: { tipo: string; chave: string }[] = [];

  if (!dryRun) {
    for (const a of alertas) {
      const { data, error } = await db.rpc("radar_registrar", {
        p_tipo: a.tipo,
        p_chave: a.chave,
        p_severidade: a.severidade,
        p_titulo: a.titulo,
        p_detalhe: a.detalhe,
      });
      if (error) {
        avisos.push(`registrar ${a.tipo}/${a.chave}: ${error.message}`);
        continue;
      }
      const linha = (data as { novo: boolean; ocorrencias: number }[] | null)?.[0];
      gravados.push({
        tipo: a.tipo,
        chave: a.chave,
        novo: linha?.novo ?? false,
        ocorrencias: linha?.ocorrencias ?? 1,
      });
    }
    for (const k of aResolver) {
      const [tipo, chave] = k.split("\u0000");
      const { data, error } = await db.rpc("radar_resolver", {
        p_tipo: tipo,
        p_chave: chave,
        p_por: "radar",
      });
      if (error) {
        avisos.push(`resolver ${tipo}/${chave}: ${error.message}`);
        continue;
      }
      // 0 é o caso normal: não havia nada aberto. Só reporta o que fechou de
      // verdade, para o relatório não ficar cheio de não-eventos.
      //
      // Os parênteses não são estilo. `>` liga mais forte que `??`, então
      // `data ?? 0 > 0` seria lido como `data ?? (0 > 0)` — que por acidente
      // acerta o resultado hoje e erraria no dia em que a RPC devolvesse outra
      // coisa. Um defeito que passa no teste é o pior tipo de defeito.
      const fechadas = (data as number | null) ?? 0;
      if (fechadas > 0) resolvidos.push({ tipo, chave });
    }
  }

  return NextResponse.json({
    ok: true,
    kill_switch: { env: ENV_KILL_SWITCH, armado },
    dry_run: dryRun,
    // O que a varredura conseguiu julgar. Uma condição que sumir daqui é uma
    // medição que parou de funcionar — e isso é tão grave quanto um alerta.
    condicoes_julgadas: julgadas.size,
    medido: {
      fontes_com_divergencia: porFonteDiv.size,
      fontes_com_prova_de_amostra: ultimoRaw.size,
      cartas_disponiveis: disponiveis,
      cartas_novas_24h: novas,
      cartas_saidas_24h: saidas,
      ciclos_24h: ciclosNoPeriodo,
      ultima_carta_nova_em: ultimaNovaEm,
      farol_publicados_hoje: publicadosHoje ?? null,
      hora_sp: horaSP(agora),
      fila_sentinela_esperando: fila.count ?? null,
    },
    alertas: alertas.map((a) => ({
      tipo: a.tipo,
      chave: a.chave,
      severidade: a.severidade,
      titulo: a.titulo,
      detalhe: a.detalhe,
    })),
    gravados,
    resolvidos,
    a_resolver: dryRun ? aResolver.map((k) => k.replace("\u0000", "/")) : undefined,
    avisos,
  });
}
