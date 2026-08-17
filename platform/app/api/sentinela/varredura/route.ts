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
//   - teto de toques POR LINHA (sentinela_fila.max_toques, default 2),
//     espaçados de 72h; atingido o teto sem resposta →
//     'encerrado_por_silencio', nunca mais tocado
//   - cliente respondeu (site OU WhatsApp) → 'respondeu', nunca mais tocado
//   - opt_out em wa_conversas → 'excluido'. Dupla checagem: aqui (guard #1)
//     E dentro do sendTemplate (guard #2) — mesmo padrão do DISPARO-01
//   - NUMERO_EXCLUIDO hard-coded (número de produção da casa), sem exceção
//   - horário: só envia entre 9h e 20h America/Sao_Paulo (o cron 12,18 UTC
//     já cai dentro; o guard cobre execução manual fora de hora)
//   - domingo: não envia. Nunca.
//   - MAX_ENVIOS_POR_EXECUCAO com throttle de 1 msg / 2s (padrão DISPARO-01)
//
// ----------------------------------------------------------------------------
// SENTINELA-RADAR-01 (1.3) — O QUE MUDOU AQUI, E POR QUÊ
//
// 1. O TETO DE TOQUES DEIXOU DE SER CONSTANTE DESTE ARQUIVO. Era `MAX_TOQUES=2`
//    para todo mundo. Passou a ser `sentinela_fila.max_toques`, por linha, e as
//    21 linhas captadas em 04/08 levam 1. Elas ficaram ONZE DIAS sem um toque
//    porque o template nunca existiu — a falha foi nossa. Onze dias depois,
//    insistência é lida como cobrança: um segundo toque não soa como cuidado,
//    soa como sistema. A honestidade é a única coisa que ainda reabre a
//    conversa nesse ponto — e a frase que abre é a que assume o erro, não a que
//    oferece carta.
//
// 2. A SELEÇÃO DA FASE C VIROU RPC (`sentinela_a_tocar`). Não é gosto: com o
//    teto virando coluna, `tentativas < max_toques` compara duas colunas, o que
//    PostgREST não faz. Filtrar depois, em JS, deixaria linhas inelegíveis
//    ocupando as 15 vagas da janela — e como as 21 antigas têm criado_em
//    IDÊNTICO e vêm primeiro, elas ocupariam as 15 sempre, e as 5 novas nunca
//    seriam olhadas. O desempate por `id` mora dentro da RPC pelo mesmo motivo.
//
// 3. 'esgotado' VIROU 'encerrado_por_silencio'. 'esgotado' dizia "acabou" sem
//    dizer por quê, e por quê é a única parte que serve pra decidir o que fazer
//    com a linha depois.
//
// 4. DOMINGO NÃO ENVIA. A guarda de 9h–20h já existia e não cobre isso: 14h de
//    domingo passa nela. Mensagem de empresa em domingo não é urgência de quem
//    recebe, é conveniência de quem manda.
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
const ESPACAMENTO_MS = 72 * 60 * 60 * 1000; // 72h entre toques
const MAX_ENVIOS_POR_EXECUCAO = 15; // 15 × 2s = 30s, folga no maxDuration
const THROTTLE_MS = 2000;
const HORA_INICIO_SP = 9;
const HORA_FIM_SP = 20; // exclusivo: 20h em diante não envia
const DOMINGO = 0; // Date#getDay() em SP — ver diaSemanaSP()

// Rede de segurança para linha que chegue sem o teto preenchido. O default
// real é do banco (sentinela_fila.max_toques default 2); este número só entra
// se a coluna vier null, e existe para o código nunca cair em `0` implícito —
// `tentativas < 0` seria falso sempre e a linha nunca mais seria tocada, em
// silêncio. Falha visível é melhor que fila que para sozinha.
const TETO_TOQUES_FALLBACK = 2;

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

// Dia da semana em São Paulo, 0 = domingo. Vem do MESMO caminho da hora
// (Intl com timeZone explícito) e não de `new Date().getDay()`, que devolveria
// o dia do relógio do servidor — em UTC, sábado 21h em SP já é domingo.
function diaSemanaSP(): number {
  const nome = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
  }).format(new Date());
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(nome);
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
  /** Teto DESTA linha. Null só se a coluna vier vazia — ver TETO_TOQUES_FALLBACK. */
  max_toques: number | null;
  ultimo_envio_em: string | null;
  proximo_toque_em: string | null;
};

/** Teto efetivo da linha, com a rede de segurança aplicada num lugar só. */
function tetoDe(f: FilaRow): number {
  return f.max_toques ?? TETO_TOQUES_FALLBACK;
}

const COLUNAS_FILA =
  "id, conversa_site_id, wa_conversa_id, nome, telefone, status, tentativas, max_toques, ultimo_envio_em, proximo_toque_em";

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
    // `encerrado_por_silencio` substitui a chave `esgotado` das varreduras
    // anteriores. As linhas antigas de sentinela_log guardam o nome velho —
    // quem for ler o histórico tem de aceitar os dois.
    paradas: { respondeu: 0, opt_out: 0, encerrado_por_silencio: 0 },
    envios: { feitos: 0, falhas: 0, pulados: 0 },
    // DEDUP-SENTINELA-01 — a chave `aguardando_template` SAIU daqui, e o motivo
    // é um diagnóstico errado que ela causou. Ela gravava 15 no log enquanto a
    // fila tinha 21 vivas e 27 elegíveis: 15 era o LIMIT da página, escrito como
    // se fosse população. Quem leu o log concluiu "situação normal" — e estava
    // lendo o número certo com o nome errado.
    //
    // Os três campos abaixo não admitem essa leitura:
    //   elegiveis_total ......... quantas PESSOAS podem ser tocadas agora (já
    //                             deduplicadas por telefone, vem do SQL)
    //   tratados_nesta_pagina ... quantas esta execução de fato pegou
    //   limite_da_pagina ........ o teto da janela. Sem ele não dá para
    //                             distinguir "a página encheu, tem mais atrás"
    //                             de "a população é esse número mesmo".
    //
    // Mesmo tratamento que `esgotado` → `encerrado_por_silencio` recebeu acima:
    // as linhas antigas de sentinela_log guardam a chave velha, e quem for ler
    // o histórico tem de aceitar as duas.
    fila: {
      elegiveis_total: 0,
      tratados_nesta_pagina: 0,
      limite_da_pagina: MAX_ENVIOS_POR_EXECUCAO,
    },
    // Irmão de `fora_horario` e `domingo`: diz POR QUE a execução não enviou.
    // Substitui a contagem que existia aqui — o motivo é um estado (o template
    // não está configurado), não uma quantidade, e escrever estado como número
    // foi o que produziu o log ilegível.
    sem_template: false,
    fora_horario: false,
    domingo: false,
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
    .select(COLUNAS_FILA)
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
    // Teto DESTA linha atingido, espaçamento vencido, nenhuma resposta.
    // O espaçamento é parte da condição de propósito: sem ele, uma linha
    // encerraria no mesmo minuto do último toque, antes de a pessoa ter tido
    // chance de responder.
    if (
      f.tentativas >= tetoDe(f) &&
      f.ultimo_envio_em &&
      agora.getTime() - new Date(f.ultimo_envio_em).getTime() > ESPACAMENTO_MS
    ) {
      resumo.paradas.encerrado_por_silencio++;
      if (!dryRun) {
        await db
          .from("sentinela_fila")
          .update({ status: "encerrado_por_silencio" })
          .eq("id", f.id);
        await log(f.id, "parada_encerrado_por_silencio", {
          tentativas: f.tentativas,
          max_toques: tetoDe(f),
        });
      }
    }
  }

  // ------------------------------------------------------------------ FASE C
  const templateName = process.env.SENTINELA_TEMPLATE;

  // Teto por linha + ordem com desempate, tudo no SQL. Ver item 2 do cabeçalho:
  // afrouxar aqui e refinar em JS devolveria a janela de 15 para as antigas.
  const { data: aEnviar, error: errATocar } = await db.rpc("sentinela_a_tocar", {
    limite: MAX_ENVIOS_POR_EXECUCAO,
  });
  if (errATocar) {
    // Falhar alto. Uma seleção quebrada devolve lista vazia, e lista vazia é
    // indistinguível de "não há ninguém a tocar" — o Sentinela pararia sem
    // ninguém saber, que é exatamente o defeito que esta fatia veio corrigir.
    await log(null, "erro_selecao", { erro: errATocar.message });
    return NextResponse.json(
      { ok: false, erro: `rpc_a_tocar: ${errATocar.message}` },
      { status: 500 }
    );
  }

  // A POPULAÇÃO, medida separada da página. `aEnviar` já vem cortado em 15 pelo
  // limite, então contar o array responde "quantas couberam", nunca "quantas
  // existem" — foi exatamente essa confusão que pôs 15 no log.
  //
  // Falha aqui NÃO derruba a varredura: o total é instrumento de leitura, e
  // parar de tocar 26 pessoas porque um contador não respondeu seria trocar o
  // trabalho pela medição do trabalho. Fica -1 e o log diz que não foi medido —
  // nunca 0, que seria indistinguível de "fila vazia".
  const { data: totalElegiveis, error: errTotal } = await db.rpc(
    "sentinela_elegiveis_total"
  );
  if (errTotal) {
    resumo.fila.elegiveis_total = -1;
    await log(null, "erro_total_elegiveis", { erro: errTotal.message });
  } else {
    resumo.fila.elegiveis_total = Number(totalElegiveis ?? 0);
  }
  resumo.fila.tratados_nesta_pagina = (aEnviar ?? []).length;

  if (!templateName) {
    // GATE: sem template aprovado configurado, nada sai. Marca o motivo.
    resumo.sem_template = true;
    for (const f of (aEnviar ?? []) as FilaRow[]) {
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

  // Domingo antes da hora: a guarda de 9h–20h sozinha aprova domingo às 14h.
  // Nada aqui é urgente o bastante para justificar isso — a fila espera
  // segunda. Fica ANTES porque, sendo domingo, a hora nem importa.
  const dia = diaSemanaSP();
  if (dia === DOMINGO) {
    resumo.domingo = true;
    await log(null, "domingo", {});
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
