// ============================================================================
// Webhook do Instagram (Messaging API) — INSTA-01.
// ----------------------------------------------------------------------------
// Espelho deliberado de app/api/whatsapp/route.ts (F1 + F4a). Mesma sequência,
// mesmas garantias, mesmas mensagens de erro. O que muda é SÓ o transporte:
//
//   WhatsApp                          Instagram
//   --------                          ---------
//   entry[].changes[].value.messages  entry[].messaging[]
//   m.id                              m.message.mid
//   m.from (telefone E.164)           m.sender.id (IGSID)
//   WHATSAPP_VERIFY_TOKEN             IG_VERIFY_TOKEN
//   WHATSAPP_APP_SECRET               IG_APP_SECRET
//   graph.facebook.com                graph.instagram.com (lib/instagram/graph.ts)
//
// O que NÃO muda, de propósito, porque canal não muda regra de negócio:
//   - opt-out (SAIR/PARAR/...) — importado de lib/opt-out.ts, MESMA lista;
//   - gate humano/opt_out/status e o kill-switch WHATSAPP_AGENT_ATIVO;
//   - dedup por id de mensagem (wa_mensagens.wa_message_id é UNIQUE);
//   - debounce, lock e cérebro — reaproveitados inteiros via
//     processarJobsWhatsapp(), que agora roteia o ENVIO por job.canal.
//
// Por que o job vai pro mesmo processarJobsWhatsapp: o cérebro
// (lib/whatsapp/cerebro.ts) não sabe nem precisa saber de canal — ele lê
// wa_mensagens e devolve texto. Duplicar aquele fluxo pra IG criaria duas
// verdades sobre debounce/lock/guardrail. Ver o adaptador enviarPorCanal()
// em lib/whatsapp/processar-background.ts.
//
// ASSINATURA (X-Hub-Signature-256): a Meta assina com o App Secret do APP,
// e um app tem UM secret que assina todos os produtos pendurados nele. Não
// dá pra afirmar por leitura de doc qual app está assinando este webhook —
// então o motivo da recusa é LOGADO com nome próprio
// ("assinatura_nao_confere") e o 401 é devolvido. O primeiro POST real do
// Instagram é que decide: se der assinatura_nao_confere com IG_APP_SECRET
// preenchido, o secret configurado é do app errado. Medir, não assumir.
//
// wa_conversas no canal 'instagram': a coluna `telefone` guarda o IGSID da
// pessoa (numérico, 16-17 dígitos) — ver migration 0067_insta_canal.sql,
// que também cria o UNIQUE(telefone, canal) usado como alvo do upsert aqui.
//
// SEMPRE 200 fora de assinatura inválida — webhook que devolve 5xx faz a
// Meta reenviar e, na pior hipótese, derrubar a inscrição. Env ausente
// devolve erro nomeado, nunca 500 cru.
// ============================================================================
import { NextResponse } from "next/server";
import crypto from "crypto";
import { waitUntil } from "@vercel/functions";
import { createXtvClient } from "@/lib/supabase-xtv";
import { registrarMensagemSistema } from "@/lib/whatsapp/sistema";
import { processarJobsWhatsapp, type WaJob } from "@/lib/whatsapp/processar-background";
import { ehTextoOptOut } from "@/lib/opt-out";
import {
  enviarPrivateReplyInstagram,
  responderComentarioPublico,
} from "@/lib/instagram/graph";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Mesmo raciocínio do webhook do WhatsApp: o ack é rápido, mas o
// processamento em background (debounce 8s + Anthropic + envio) é medido
// pela Vercel como parte da mesma invocação.
export const maxDuration = 180;

// --- GET: handshake da Meta -------------------------------------------------
export async function GET(req: Request) {
  const url = new URL(req.url);
  const modo = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const desafio = url.searchParams.get("hub.challenge");

  if (
    modo === "subscribe" &&
    !!process.env.IG_VERIFY_TOKEN &&
    token === process.env.IG_VERIFY_TOKEN &&
    desafio
  ) {
    // A Meta espera o challenge cru no corpo, sem JSON em volta.
    return new Response(desafio, { status: 200 });
  }

  // Distingue "não configurei a env" de "token errado" no LOG (não na
  // resposta — a resposta pra Meta é sempre a mesma, sem dar pista).
  console.error(
    "[instagram/webhook] handshake recusado:",
    JSON.stringify({
      modo,
      envPresente: !!process.env.IG_VERIFY_TOKEN,
      tokenConfere: !!process.env.IG_VERIFY_TOKEN && token === process.env.IG_VERIFY_TOKEN,
      temDesafio: !!desafio,
    })
  );
  return NextResponse.json({ erro: "handshake_invalido" }, { status: 403 });
}

// --- Assinatura -------------------------------------------------------------
// Mesma construção do webhook do WhatsApp: HMAC-SHA256 sobre os BYTES CRUS
// do corpo (não sobre o objeto reserializado — JSON.stringify reordena e
// reformata, e aí a assinatura nunca fecharia), comparação timing-safe.
function assinaturaValida(
  corpoBruto: string,
  assinaturaHeader: string | null
): { valida: boolean; motivo?: string } {
  const segredo = process.env.IG_APP_SECRET;
  if (!segredo) return { valida: false, motivo: "segredo_ausente_env(IG_APP_SECRET)" };
  if (!assinaturaHeader) return { valida: false, motivo: "header_ausente" };

  const prefixo = "sha256=";
  if (!assinaturaHeader.startsWith(prefixo)) {
    return { valida: false, motivo: "header_sem_prefixo_sha256" };
  }
  const recebidoHex = assinaturaHeader.slice(prefixo.length);
  const esperadoHex = crypto
    .createHmac("sha256", segredo)
    .update(corpoBruto, "utf8")
    .digest("hex");

  const a = Buffer.from(recebidoHex, "utf8");
  const b = Buffer.from(esperadoHex, "utf8");
  // timingSafeEqual lança se os tamanhos diferem — checar antes.
  if (a.length !== b.length) return { valida: false, motivo: "tamanho_hex_diferente" };
  if (!crypto.timingSafeEqual(a, b)) return { valida: false, motivo: "assinatura_nao_confere" };
  return { valida: true };
}

// --- Extração dos eventos ---------------------------------------------------
// Shape medido (06/08/2026, docs da Instagram Platform + payloads públicos):
//   { object: "instagram", entry: [ { id, time, messaging: [ {
//       sender: { id }, recipient: { id }, timestamp,
//       message: { mid, text, is_echo? } } ] } ] }
// Reactions/seen/postbacks chegam com outras chaves no lugar de `message`.
type EventoIg = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: unknown[] };
  // presentes em outros tipos de evento — só usados pra nomear o skip
  reaction?: unknown;
  read?: unknown;
  postback?: unknown;
  referral?: unknown;
};

function extrairEventos(corpo: unknown): EventoIg[] {
  const entry = (corpo as { entry?: unknown })?.entry;
  if (!Array.isArray(entry)) return [];
  const saida: EventoIg[] = [];
  for (const e of entry) {
    const messaging = (e as { messaging?: unknown })?.messaging;
    if (!Array.isArray(messaging)) continue;
    for (const m of messaging) saida.push(m as EventoIg);
  }
  return saida;
}

/** Nome do tipo do evento, só pra log de skip. Nunca joga fora silenciosamente. */
function tipoEvento(ev: EventoIg): string {
  if (ev.message?.is_echo) return "echo";
  if (ev.message && typeof ev.message.text === "string") return "text";
  if (ev.message?.attachments) return "attachment";
  if (ev.reaction) return "reaction";
  if (ev.read) return "read";
  if (ev.postback) return "postback";
  if (ev.referral) return "referral";
  return "desconhecido";
}

// ============================================================================
// FAROL-COMENTA (INSTA-03) — comentário vira direct.
// AUTORIZADO: Emerson Gomes dos Santos — 06/08/2026 ~22h15.
// ----------------------------------------------------------------------------
// CORREÇÃO DE UM "CONTEXTO MEDIDO" DA OS, declarada aqui porque muda o código:
// a OS afirma que o webhook "já recebe eventos de `comments` e os descarta em
// [ig-skip]". Medido no código acima: extrairEventos() varre APENAS
// entry[].messaging[]. Comentário chega em entry[].changes[] com
// field:"comments" (referência oficial de webhooks do IG, medida em
// 06/08/2026: value = { id, from{id,username,self_ig_scoped_id},
// media{id,media_product_type}, text, parent_id, ad_id? }).
// Logo, num payload de comentário extrairEventos devolve [] e o fluxo morre
// no `if (eventos.length === 0)` SEM logar [ig-skip] — tipoEvento nem roda.
// Confirmado nos logs de produção: todo [ig-skip] existente (echo/read/
// desconhecido) vem de DM. Consequência: um ramo colocado dentro do laço de
// mensagens NUNCA dispararia. Por isso o extrator abaixo é próprio, e a
// chamada fica ANTES do early-return — o que também deixa o ramo de messages
// literalmente intocado (diff = zero linhas alteradas lá dentro).
//
// POR QUE PRIVATE REPLY EXISTE: quem comentou nunca mandou DM, então não há
// janela aberta e enviarInstagram() por IGSID seria recusado. O private reply
// é o único jeito de abrir a conversa — e, aberta ela, a resposta da pessoa
// cai no ramo de `messages` e o Prosperito assume sozinho. Zero código extra:
// é esse o desenho.
//
// DEDUPE PELO ÍNDICE, NÃO POR SELECT: a Meta reenvia webhook que demora e
// permite UM private reply por comentário, para sempre. Um `select` antes do
// envio tem janela de corrida (dois reenvios simultâneos passam os dois).
// Então a trava é o UNIQUE wa_mensagens.wa_message_id (medido:
// wa_mensagens_wa_message_id_key): grava-se `igc:<comment_id>` ANTES de
// enviar. Quem perder a corrida leva violação de unicidade e desiste. O preço
// é que uma falha de envio não é retentada automaticamente — e isso é o lado
// certo do trade: a Meta recusaria a segunda tentativa de qualquer forma.
//
// KILL-SWITCH: FAROL_COMENTA. Ausente/qualquer coisa != "on" => o ramo inteiro
// vira log e nada mais. NASCE DESARMADO: armar é gesto do Emerson na Vercel.
// FAROL_COMENTA_PUBLICO governa só a resposta pública, separadamente.
// ============================================================================

/** Texto fixo do direct. Sem número, sem promessa, termina em pergunta. */
const TEXTO_PRIVATE_REPLY =
  "Oi! Vi seu comentário 👋 Vou te responder por aqui no direct — me conta: você procura carta de imóvel ou de veículo?";

/** Texto fixo da resposta pública. NUNCA valores/números aqui. */
const TEXTO_RESPOSTA_PUBLICA = "Te respondemos no direct 💬";

/** Prefixo do dedupe. Namespaced pra nunca colidir com um mid real da Meta. */
const PREFIXO_DEDUPE_COMENTARIO = "igc:";

type ComentarioIg = {
  /** id do comentário — é ele que endereça o private reply e o /replies. */
  id?: string;
  text?: string;
  parent_id?: string;
  from?: { id?: string; username?: string };
  media?: { id?: string; media_product_type?: string };
  /** presente em edições/eventos que não são criação de comentário. */
  verb?: string;
  /** id da conta que recebeu o evento (entry[].id), carregado junto. */
  _contaId?: string;
};

/** Varre entry[].changes[] pegando só field === "comments". */
function extrairComentarios(corpo: unknown): ComentarioIg[] {
  const entry = (corpo as { entry?: unknown })?.entry;
  if (!Array.isArray(entry)) return [];
  const saida: ComentarioIg[] = [];
  for (const e of entry) {
    const changes = (e as { changes?: unknown })?.changes;
    const contaId = (e as { id?: string })?.id;
    if (!Array.isArray(changes)) continue;
    for (const c of changes) {
      const campo = (c as { field?: string })?.field;
      if (campo !== "comments") continue;
      const value = (c as { value?: unknown })?.value;
      if (!value || typeof value !== "object") continue;
      saida.push({ ...(value as ComentarioIg), _contaId: contaId });
    }
  }
  return saida;
}

/** True se o comentário é NOSSO (post/resposta da própria conta). Sem isto,
 *  a resposta pública que nós mesmos publicamos volta como evento e o ramo
 *  se auto-alimenta em laço infinito. Compara contra as DUAS fontes do id da
 *  conta que existem no runtime: a env e o entry[].id do próprio payload. */
function comentarioProprio(c: ComentarioIg): boolean {
  const autor = c.from?.id;
  if (!autor) return false;
  const envId = process.env.IG_USER_ID;
  return autor === envId || autor === c._contaId;
}

/**
 * Trata os comentários de um payload. Nunca lança: cada comentário tem seu
 * try/catch, porque um evento ruim não pode derrubar os outros nem o ack.
 * Roda de forma síncrona antes do ack de propósito — são no máximo duas
 * chamadas à Graph e, se a Meta reenviar por demora, o dedupe segura.
 */
async function tratarComentarios(comentarios: ComentarioIg[]): Promise<void> {
  if (process.env.FAROL_COMENTA !== "on") {
    console.log("[ig-skip] comments (desarmado):", comentarios.length);
    return;
  }

  const db = createXtvClient();
  const respondePublico = process.env.FAROL_COMENTA_PUBLICO === "on";

  for (const c of comentarios) {
    try {
      const commentId = typeof c.id === "string" ? c.id : "";
      const autor = typeof c.from?.id === "string" ? c.from.id : "";

      if (!commentId) {
        console.log("[farol-comenta] ignorado: comentario_sem_id");
        continue;
      }
      // Edição/remoção não é comentário novo — nada a responder.
      if (c.verb && c.verb !== "add") {
        console.log("[farol-comenta] ignorado: verb =", c.verb);
        continue;
      }
      if (comentarioProprio(c)) {
        console.log("[farol-comenta] ignorado: comentario_proprio");
        continue;
      }
      if (!autor) {
        console.log("[farol-comenta] ignorado: comentario_sem_autor");
        continue;
      }

      // --- conversa (mesmo par telefone/canal do ramo de mensagens) --------
      const { data: conversa, error: errConversa } = await db
        .from("wa_conversas")
        .upsert(
          { telefone: autor, canal: "instagram" },
          { onConflict: "telefone,canal", ignoreDuplicates: false }
        )
        .select("id, opt_out")
        .single();

      if (errConversa || !conversa) {
        console.error(
          "[farol-comenta] falha na conversa:",
          errConversa?.message ?? "sem_retorno"
        );
        continue;
      }

      // LGPD: quem pediu SAIR não recebe nem private reply. Canal não muda regra.
      if (conversa.opt_out === true) {
        console.log("[farol-comenta] ignorado: opt_out");
        continue;
      }

      // --- trava atômica: quem gravar primeiro é quem responde -------------
      const chaveDedupe = `${PREFIXO_DEDUPE_COMENTARIO}${commentId}`;
      const { data: linha, error: errInsert } = await db
        .from("wa_mensagens")
        .insert({
          conversa_id: conversa.id,
          papel: "prosperito",
          agente: "farol-comenta",
          conteudo: TEXTO_PRIVATE_REPLY,
          wa_message_id: chaveDedupe,
          status_envio: "enviando",
        })
        .select("id")
        .single();

      if (errInsert) {
        // 23505 = unique_violation => este comentário já foi tratado.
        console.log(
          "[farol-comenta] ignorado: ja_respondido ou insert recusado:",
          errInsert.code ?? errInsert.message
        );
        continue;
      }

      // --- private reply (o coração da fatia) ------------------------------
      const envio = await enviarPrivateReplyInstagram({
        commentId,
        texto: TEXTO_PRIVATE_REPLY,
      });

      await db
        .from("wa_mensagens")
        .update({
          status_envio: envio.ok ? "enviado" : "falha",
          erro: envio.ok ? null : (envio.erro ?? null),
        })
        .eq("id", linha.id);

      if (!envio.ok) {
        console.error("[farol-comenta] private reply recusado:", {
          comment_id: commentId,
          erro: envio.erro,
        });
        continue; // sem direct, resposta pública prometeria o que não houve
      }

      console.log("[farol-comenta] direct enviado:", {
        comment_id: commentId,
        conversa_id: conversa.id,
        message_id: envio.messageId ?? null,
      });

      // --- resposta pública (opcional, governada por env própria) ----------
      if (!respondePublico) continue;
      const publica = await responderComentarioPublico(
        commentId,
        TEXTO_RESPOSTA_PUBLICA
      );
      if (!publica.ok) {
        // Falhar aqui NÃO desfaz o direct, que é o que importa.
        console.error("[farol-comenta] resposta pública recusada:", {
          comment_id: commentId,
          erro: publica.erro,
        });
      } else {
        console.log("[farol-comenta] resposta pública:", publica.id ?? null);
      }
    } catch (e) {
      console.error(
        "[farol-comenta] erro tratando comentário:",
        e instanceof Error ? e.message.slice(0, 500) : "erro_desconhecido"
      );
    }
  }
}

// --- POST -------------------------------------------------------------------
export async function POST(req: Request) {
  const corpoBruto = await req.text();
  const assinatura = req.headers.get("x-hub-signature-256");

  const check = assinaturaValida(corpoBruto, assinatura);
  if (!check.valida) {
    // Motivo no log (nunca no corpo da resposta, e nunca o segredo nem o
    // payload). É este log que responde "o secret é do app pai ou do app
    // do Instagram?" no primeiro POST real.
    console.error("[instagram/webhook] assinatura inválida:", check.motivo);
    return NextResponse.json({ erro: "assinatura_invalida" }, { status: 401 });
  }

  let evento: unknown;
  try {
    evento = JSON.parse(corpoBruto);
  } catch {
    console.error("[instagram/webhook] corpo não é JSON válido");
    return NextResponse.json({ status: "ignorado" });
  }

  const objeto = (evento as { object?: string })?.object;
  if (objeto !== "instagram") {
    console.log("[ig-skip] object inesperado:", JSON.stringify(objeto ?? null));
    return NextResponse.json({ status: "ignorado" });
  }

  // FAROL-COMENTA: comentário chega em entry[].changes[], NÃO em
  // entry[].messaging[] — então tem que ser tratado aqui, antes do
  // early-return abaixo, que devolveria "ignorado" sem nem logar. Colocado
  // fora do laço de mensagens de propósito: aquele bloco segue intocado.
  // (Se o payload só tiver comentário, a resposta ainda sai como "ignorado";
  //  o corpo é cosmético — a Meta só olha o 200.)
  const comentarios = extrairComentarios(evento);
  if (comentarios.length > 0) {
    await tratarComentarios(comentarios);
  }

  const eventos = extrairEventos(evento);
  if (eventos.length === 0) {
    return NextResponse.json({ status: "ignorado" });
  }

  const db = createXtvClient();
  const jobs: WaJob[] = [];

  for (const ev of eventos) {
    const tipo = tipoEvento(ev);

    // Echo (mensagem que NÓS mandamos, devolvida pelo webhook), leitura,
    // reação, postback, anexo: fora do escopo desta fatia. Silencioso pro
    // cliente, visível no log.
    if (tipo !== "text") {
      console.log("[ig-skip]", tipo);
      continue;
    }

    const mid = ev.message?.mid;
    if (!mid) {
      console.log("[ig-skip] text_sem_mid");
      continue;
    }

    // Dedup — a Meta reenvia o mesmo evento quando não recebe 200 a tempo.
    // wa_mensagens.wa_message_id é UNIQUE; esta checagem evita depender do
    // erro do banco pra saber que já vimos isto.
    const { data: existente } = await db
      .from("wa_mensagens")
      .select("id")
      .eq("wa_message_id", mid)
      .maybeSingle();
    if (existente) continue;

    const igsid = ev.sender?.id;
    if (!igsid) {
      console.log("[ig-skip] text_sem_sender");
      continue;
    }

    const conteudo = ev.message?.text ?? "";

    // Upsert por (telefone, canal) — alvo criado na migration 0067. NÃO usa
    // onConflict "telefone" (chave do WhatsApp) de propósito: se um IGSID
    // colidir com um telefone existente, isto FALHA alto (violação do
    // UNIQUE(telefone) que continua lá) em vez de fundir silenciosamente a
    // conversa de duas pessoas diferentes. Falhar é recuperável; misturar não.
    const { data: conversa, error: errConversa } = await db
      .from("wa_conversas")
      .upsert(
        { telefone: igsid, canal: "instagram" },
        { onConflict: "telefone,canal", ignoreDuplicates: false }
      )
      .select("id, status, agente_ativo, opt_out")
      .single();

    if (errConversa || !conversa) {
      console.error(
        "[instagram/webhook] falha no upsert da conversa:",
        errConversa?.message ?? "sem_dado"
      );
      continue;
    }

    const { data: msgInserida, error: errMsg } = await db
      .from("wa_mensagens")
      .insert({
        conversa_id: conversa.id,
        papel: "cliente",
        conteudo,
        wa_message_id: mid,
      })
      .select("id")
      .single();

    if (errMsg || !msgInserida) {
      console.error(
        "[instagram/webhook] falha ao inserir mensagem:",
        errMsg?.message ?? "sem_dado"
      );
      continue;
    }

    // Reabertura: cliente que volta a falar numa conversa encerrada põe ela
    // de volta em 'ativo' e deixa rastro na thread — mesmo comportamento do
    // WhatsApp, pelo mesmo motivo (o painel precisa contar a história).
    if (conversa.status === "encerrado") {
      await db.from("wa_conversas").update({ status: "ativo" }).eq("id", conversa.id);
      await registrarMensagemSistema({
        conversaId: conversa.id,
        conteudo: "Conversa reaberta: o cliente respondeu no Instagram.",
        agente: "sistema",
      });
    }

    // Opt-out: MESMA lista do WhatsApp (lib/opt-out.ts). No Instagram só
    // existe a forma "texto digitado" — não há quick reply de template
    // aqui, porque esta fatia não dispara template no IG.
    const acabaDeOptarSair = ehTextoOptOut(conteudo);
    if (acabaDeOptarSair) {
      await db.from("wa_conversas").update({ opt_out: true }).eq("id", conversa.id);
    }

    const podeResponder =
      process.env.WHATSAPP_AGENT_ATIVO === "true" &&
      !acabaDeOptarSair &&
      conversa.opt_out !== true &&
      (conversa.status ?? null) !== "humano";

    console.log(
      "[instagram][diag] msg persistida",
      JSON.stringify({
        msgId: msgInserida.id,
        igsidMascarado: igsid.slice(0, 4) + "***" + igsid.slice(-2),
        kill_switch_raw: process.env.WHATSAPP_AGENT_ATIVO ?? "(unset)",
        acabaDeOptarSair,
        conversaOptOut: conversa.opt_out,
        conversaStatus: conversa.status,
        agenteAtivo: conversa.agente_ativo,
        podeResponder,
      })
    );

    if (podeResponder) {
      jobs.push({
        conversaId: conversa.id,
        telefone: igsid, // mesma coluna; no canal instagram é o IGSID
        msgInseridaId: msgInserida.id,
        anexoId: null, // anexo de IG não é tratado nesta fatia (ver [ig-skip])
        conversaOptOut: conversa.opt_out === true,
        conversaStatus: conversa.status ?? null,
        agenteAtivo: conversa.agente_ativo ?? null,
        podeResponder,
        canal: "instagram",
      });
    }
  }

  if (jobs.length > 0) {
    if (contextoVercelSuportaWaitUntil()) {
      waitUntil(processarJobsWhatsapp(db, jobs));
    } else {
      console.error(
        "[instagram/webhook] contexto @vercel/request-context ausente — processando em fallback síncrono antes do ack."
      );
      await processarJobsWhatsapp(db, jobs);
    }
  }

  return NextResponse.json({ ok: true });
}

// Mesma checagem do webhook do WhatsApp (ver comentário longo lá): waitUntil
// só segura a invocação viva se a Vercel tiver publicado o contexto; sem ele
// a chamada não lança nada e a promise morre em silêncio quando o container
// congela. Detecta e cai pro await síncrono. Duplicado aqui em vez de
// importado porque a função vive dentro do route.ts do WhatsApp, que é um
// Route Handler — o Next não permite export arbitrário de lá.
function contextoVercelSuportaWaitUntil(): boolean {
  const SYMBOL_REQUEST_CONTEXT = Symbol.for("@vercel/request-context");
  const contexto = (
    globalThis as unknown as Record<
      symbol,
      { get?: () => { waitUntil?: unknown } } | undefined
    >
  )[SYMBOL_REQUEST_CONTEXT];
  return typeof contexto?.get?.()?.waitUntil === "function";
}
