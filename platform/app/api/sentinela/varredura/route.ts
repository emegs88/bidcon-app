// ============================================================================
// GET /api/sentinela/varredura — FATIA SENTINELA-01
// Reativação de leads parados (canal site → toque via template WhatsApp).
// Rodada por cron (platform/vercel.json) e manualmente com Bearer secret.
// AUTORIZADO: fatia SENTINELA-01 por Emerson em 04/08/2026.
// ----------------------------------------------------------------------------
// TRÊS FASES, nesta ordem:
//   A) CAPTAÇÃO — rpc sentinela_candidatas_site() → insere em sentinela_fila.
//   B) PARADA   — marca respondeu / opt_out / esgotado ANTES de qualquer envio.
//   C) ENVIO    — template Meta aprovado, nome vem da env SENTINELA_TEMPLATE.
//                 Sem a env, NADA sai: itens viram 'aguardando_template'.
//                 Este gate é o que torna o deploy seguro antes da aprovação
//                 do template pela Meta.
//
// REGRAS DE PARADA (duras):
//   - máx. MAX_TOQUES por lead (2), espaçados de ESPACAMENTO_HORAS (72h);
//     depois do 2º toque sem resposta → 'esgotado', nunca mais tocado
//   - cliente respondeu (site OU WhatsApp) → 'respondeu', nunca mais tocado
//   - opt_out em wa_conversas → 'excluido'. Dupla checagem: aqui (guard #1)
//     E dentro do sendTemplate (guard #2) — mesmo padrão do DISPARO-01
//   - NUMERO_EXCLUIDO hard-coded (número de produção da casa), sem exceção
//   - horário: só envia entre 9h e 20h America/Sao_Paulo (o cron 12,18 UTC
//     já cai dentro; o guard cobre execução manual fora de hora)
//   - MAX_ENVIOS_POR_EXECUCAO com throttle de 1 msg / 2s (padrão DISPARO-01)
//
// dry_run=1 na query → zero efeito colateral (nenhum insert/update/envio),
// só relata o que aconteceria. Toda ação real vira linha em sentinela_log.
//
// Compliance: o conteúdo enviado é EXCLUSIVAMENTE o template aprovado pela
// Meta (léxico já validado na submissão). Esta rota não monta texto livre.
// ============================================================================
import { NextResponse } from "next/server";
import { createXtvClient } from "@/lib/supabase-xtv";
import { sendTemplate } from "@/lib/whatsapp/graph";
import { normalizarTelefoneBR } from "@/lib/telefone";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const NUMERO_EXCLUIDO = "5511973202967"; // mesmo hard-exclude do DISPARO-01
const MAX_TOQUES = 2;
const ESPACAMENTO_MS = 72 * 60 * 60 * 1000; // 72h entre toques
const MAX_ENVIOS_POR_EXECUCAO = 15; // 15 × 2s = 30s, folga no maxDuration
const THROTTLE_MS = 2000;
const HORA_INICIO_SP = 9;
const HORA_FIM_SP = 20; // exclusivo: 20h em diante não envia

function autorizado(req: Request): boolean {
  const secret = process.env.SENTINELA_SECRET || process.env.CRON_SECRET;
  if (!secret) return false; // sem secret configurado => não roda
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function horaLocalSP(): number {
  return Number(
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hour12: false,
    }).format(new Date())
  );
}

function primeiroNome(nome: string | null): string {
  const p = (nome ?? "").trim().split(/\s+/)[0] ?? "";
  if (!p) return "tudo bem"; // "Olá, tudo bem!" — fallback sem nome
  return p.charAt(0).toUpperCase() + p.slice(1);
}

type FilaRow = {
  id: string;
  conversa_site_id: string | null;
  wa_conversa_id: string | null;
  nome: string | null;
  telefone: string;
  status: string;
  tentativas: number;
  ultimo_envio_em: string | null;
  proximo_toque_em: string | null;
};

export async function GET(req: Request) {
  if (!autorizado(req)) {
    return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun =
    url.searchParams.get("dry_run") === "1" ||
    url.searchParams.get("dry_run") === "true";

  const db = createXtvClient();
  const agora = new Date();
  const resumo = {
    ok: true,
    dry_run: dryRun,
    captadas: 0,
    paradas: { respondeu: 0, opt_out: 0, esgotado: 0 },
    envios: { feitos: 0, falhas: 0, pulados: 0 },
    aguardando_template: 0,
    fora_horario: false,
    detalhes: [] as Array<Record<string, unknown>>,
  };

  const log = async (
    filaId: string | null,
    acao: string,
    detalhe: Record<string, unknown> = {}
  ) => {
    if (dryRun) return;
    await db.from("sentinela_log").insert({ fila_id: filaId, acao, detalhe });
  };

  // Heartbeat: toda varredura real fecha com UMA linha 'varredura_ok' no
  // log carregando o resumo. É o que permite ao agente Sentinela (console)
  // auditar se o cron está vivo — ausência de heartbeat > 26h = cron morto.
  const finalizar = async () => {
    const { detalhes: _d, ...resumoLog } = resumo;
    await log(null, "varredura_ok", resumoLog);
    return NextResponse.json(resumo);
  };

  // ------------------------------------------------------------------ FASE A
  const { data: candidatas, error: errCand } = await db.rpc(
    "sentinela_candidatas_site"
  );
  if (errCand) {
    return NextResponse.json(
      { ok: false, erro: `rpc_candidatas: ${errCand.message}` },
      { status: 500 }
    );
  }
  for (const c of (candidatas ?? []) as Array<{
    conversa_id: string;
    interesse_id: string;
    nome: string | null;
    telefone: string;
    ultima_msg_em: string;
  }>) {
    if (dryRun) {
      resumo.captadas++;
      resumo.detalhes.push({ fase: "captacao", nome: c.nome, telefone: c.telefone });
      continue;
    }
    const { data: ins, error: errIns } = await db
      .from("sentinela_fila")
      .upsert(
        {
          conversa_site_id: c.conversa_id,
          interesse_id: c.interesse_id,
          nome: c.nome,
          telefone: c.telefone,
          motivo: "silencio_pos_pergunta",
        },
        { onConflict: "conversa_site_id", ignoreDuplicates: true }
      )
      .select("id");
    if (!errIns && ins && ins.length > 0) {
      resumo.captadas++;
      await log(ins[0].id, "captado", { ultima_msg_em: c.ultima_msg_em });
    }
  }

  // ------------------------------------------------------------------ FASE B
  const { data: enviados } = await db
    .from("sentinela_fila")
    .select(
      "id, conversa_site_id, wa_conversa_id, nome, telefone, status, tentativas, ultimo_envio_em, proximo_toque_em"
    )
    .eq("status", "enviado");

  for (const f of (enviados ?? []) as FilaRow[]) {
    // opt_out chegou depois do envio?
    if (f.wa_conversa_id) {
      const { data: wc } = await db
        .from("wa_conversas")
        .select("opt_out")
        .eq("id", f.wa_conversa_id)
        .maybeSingle();
      if (wc?.opt_out === true) {
        resumo.paradas.opt_out++;
        if (!dryRun) {
          await db.from("sentinela_fila").update({ status: "excluido" }).eq("id", f.id);
          await log(f.id, "parada_opt_out", {});
        }
        continue;
      }
    }
    // respondeu no WhatsApp depois do último envio?
    let respondeu = false;
    if (f.wa_conversa_id && f.ultimo_envio_em) {
      const { count } = await db
        .from("wa_mensagens")
        .select("id", { count: "exact", head: true })
        .eq("conversa_id", f.wa_conversa_id)
        .eq("papel", "cliente")
        .gt("criado_em", f.ultimo_envio_em);
      respondeu = (count ?? 0) > 0;
    }
    // ...ou voltou pelo site?
    if (!respondeu && f.conversa_site_id && f.ultimo_envio_em) {
      const { count } = await db
        .from("mensagens")
        .select("id", { count: "exact", head: true })
        .eq("conversa_id", f.conversa_site_id)
        .eq("papel", "cliente")
        .gt("criado_em", f.ultimo_envio_em);
      respondeu = (count ?? 0) > 0;
    }
    if (respondeu) {
      resumo.paradas.respondeu++;
      if (!dryRun) {
        await db.from("sentinela_fila").update({ status: "respondeu" }).eq("id", f.id);
        await log(f.id, "parada_respondeu", {});
      }
      continue;
    }
    // esgotou: 2º toque feito, espaçamento vencido, nenhuma resposta
    if (
      f.tentativas >= MAX_TOQUES &&
      f.ultimo_envio_em &&
      agora.getTime() - new Date(f.ultimo_envio_em).getTime() > ESPACAMENTO_MS
    ) {
      resumo.paradas.esgotado++;
      if (!dryRun) {
        await db.from("sentinela_fila").update({ status: "esgotado" }).eq("id", f.id);
        await log(f.id, "parada_esgotado", { tentativas: f.tentativas });
      }
    }
  }

  // ------------------------------------------------------------------ FASE C
  const templateName = process.env.SENTINELA_TEMPLATE;

  const { data: aEnviar } = await db
    .from("sentinela_fila")
    .select(
      "id, conversa_site_id, wa_conversa_id, nome, telefone, status, tentativas, ultimo_envio_em, proximo_toque_em"
    )
    .in("status", ["pendente", "aguardando_template", "enviado"])
    .lt("tentativas", MAX_TOQUES)
    .or(`proximo_toque_em.is.null,proximo_toque_em.lte.${agora.toISOString()}`)
    .order("criado_em", { ascending: true })
    .limit(MAX_ENVIOS_POR_EXECUCAO);

  if (!templateName) {
    // GATE: sem template aprovado configurado, nada sai. Marca o motivo.
    for (const f of (aEnviar ?? []) as FilaRow[]) {
      resumo.aguardando_template++;
      if (!dryRun && f.status !== "aguardando_template") {
        await db
          .from("sentinela_fila")
          .update({ status: "aguardando_template" })
          .eq("id", f.id);
        await log(f.id, "aguardando_template", {});
      }
    }
    return finalizar();
  }

  const hora = horaLocalSP();
  if (hora < HORA_INICIO_SP || hora >= HORA_FIM_SP) {
    resumo.fora_horario = true;
    await log(null, "fora_horario", { hora });
    return finalizar();
  }

  for (const f of (aEnviar ?? []) as FilaRow[]) {
    const telefone = normalizarTelefoneBR(f.telefone);
    if (!telefone) {
      resumo.envios.pulados++;
      if (!dryRun) {
        await db.from("sentinela_fila").update({ status: "excluido" }).eq("id", f.id);
        await log(f.id, "parada_opt_out", { motivo: "telefone_invalido", bruto: f.telefone });
      }
      continue;
    }
    if (telefone === NUMERO_EXCLUIDO) {
      resumo.envios.pulados++;
      if (!dryRun) {
        await db.from("sentinela_fila").update({ status: "excluido" }).eq("id", f.id);
        await log(f.id, "parada_opt_out", { motivo: "numero_excluido" });
      }
      continue;
    }

    // Guard opt-out #1: antes de qualquer upsert/envio (padrão DISPARO-01)
    const { data: existente } = await db
      .from("wa_conversas")
      .select("id, opt_out")
      .eq("telefone", telefone)
      .maybeSingle();
    if (existente?.opt_out === true) {
      resumo.envios.pulados++;
      if (!dryRun) {
        await db.from("sentinela_fila").update({ status: "excluido" }).eq("id", f.id);
        await log(f.id, "parada_opt_out", {});
      }
      continue;
    }

    const toque = f.tentativas + 1;
    if (dryRun) {
      resumo.envios.feitos++;
      resumo.detalhes.push({
        fase: "envio",
        nome: f.nome,
        telefone,
        toque,
        template: templateName,
      });
      continue;
    }

    // Upsert do contato (mesmo padrão do webhook/DISPARO-01)
    const { data: conversa, error: errConversa } = await db
      .from("wa_conversas")
      .upsert({ telefone }, { onConflict: "telefone" })
      .select("id")
      .single();
    if (errConversa || !conversa) {
      resumo.envios.falhas++;
      await log(f.id, "envio_falha", { erro: "upsert_wa_conversas" });
      continue;
    }
    if (!f.wa_conversa_id) {
      await db
        .from("sentinela_fila")
        .update({ wa_conversa_id: conversa.id })
        .eq("id", f.id);
    }

    // Guard opt-out #2 mora dentro do sendTemplate (graph.ts) — cobre corrida.
    const envio = await sendTemplate({
      conversaId: conversa.id,
      telefone,
      agente: "sentinela",
      templateName,
      languageCode: "pt_BR",
      components: [
        {
          type: "body",
          parameters: [{ type: "text", text: primeiroNome(f.nome) }],
        },
      ],
      textoRegistro: `[sentinela] ${templateName} toque ${toque}`,
    });

    if (envio.ok) {
      resumo.envios.feitos++;
      await db
        .from("sentinela_fila")
        .update({
          status: "enviado",
          tentativas: toque,
          ultimo_envio_em: agora.toISOString(),
          proximo_toque_em: new Date(agora.getTime() + ESPACAMENTO_MS).toISOString(),
        })
        .eq("id", f.id);
      await log(f.id, "envio_ok", { waMessageId: envio.waMessageId, toque });
    } else if (envio.erro === "opt_out") {
      resumo.envios.pulados++;
      await db.from("sentinela_fila").update({ status: "excluido" }).eq("id", f.id);
      await log(f.id, "parada_opt_out", {});
    } else {
      // Falha transitória: status fica como está e a próxima varredura tenta
      // de novo. Falha permanente (ex. template rejeitado) aparece repetida
      // no sentinela_log — é o sinal pra intervir manualmente.
      resumo.envios.falhas++;
      await log(f.id, "envio_falha", { erro: envio.erro });
    }

    await new Promise((r) => setTimeout(r, THROTTLE_MS));
  }

  return finalizar();
}
