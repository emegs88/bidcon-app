// ============================================================================
// Envio de mensagens via Instagram Messaging API — FATIA INSTA-01.
// ----------------------------------------------------------------------------
// Espelho deliberado de lib/whatsapp/graph.ts: mesmo guard de opt-out lido
// AQUI DENTRO (nunca confiando no chamador), mesmo AbortController com
// timeout, mesmo registro de toda tentativa (sucesso ou falha) em
// wa_mensagens, mesmo contrato de retorno. O que muda é só o transporte.
//
// ENDPOINT (medido na doc oficial em 06/08/2026, não assumido):
//   POST https://graph.instagram.com/v25.0/me/messages
//   Authorization: Bearer <IG_ACCESS_TOKEN>
//   { "recipient": { "id": "<IGSID>" }, "message": { "text": "..." } }
// Host é graph.instagram.com (Instagram API with Instagram Login), NÃO
// graph.facebook.com. O destinatário é o IGSID — o id que a Meta atribui à
// pessoa por conta comercial, o mesmo que chega em entry[].messaging[].sender.id
// no webhook.
//
// Sobre `me`: os exemplos da doc usam /<IG_ID>/messages, e /me/messages é
// documentado como equivalente — "/me traduz pro object ID da conta cujo
// access token está sendo usado". Preferido aqui porque evita guardar o
// IG_ID numa quarta env que teria que ser mantida em sincronia com o token;
// se o token mudar de conta, o destino acompanha sozinho.
//
// VERSÃO: a doc de 06/08/2026 mostra v25.0. Fica FIXA (não "a mais nova"):
// a Meta muda comportamento entre versões, e um endpoint que se move sozinho
// quebra sem deploy nosso. Difere do módulo do WhatsApp (v21.0) de propósito
// — são produtos e datas de integração diferentes, não um descuido.
//
// JANELA: no Instagram só se responde dentro da janela aberta pela mensagem
// que a pessoa mandou. NÃO existe equivalente a sendTemplate aqui, e é de
// propósito: não há template aprovado pra IG nesta fatia, então não há
// função capaz de iniciar conversa. O que não existe não é usado por engano.
//
// TETO DE 1000 BYTES: a doc da Meta limita o texto a 1000 bytes UTF-8. O
// cérebro é o mesmo do WhatsApp, que não tem esse teto — então uma resposta
// longa seria rejeitada pela API inteira, virando silêncio pro cliente. Aqui
// ela é FATIADA em mensagens sequenciais (ver fatiar1000Bytes) em vez de
// truncada: cortar a resposta no meio é pior que mandar em duas partes.
//
// service_role (createXtvClient): mesmo motivo do módulo do WhatsApp — sem
// sessão de usuário, chamado de dentro de rota/background server-only.
// ============================================================================
import { createXtvClient } from "@/lib/supabase-xtv";

const IG_GRAPH_VERSION = "v25.0";
const IG_BASE_URL = `https://graph.instagram.com/${IG_GRAPH_VERSION}/me/messages`;

// Mesmo valor do módulo do WhatsApp: fetch sem timeout fica pendurado
// indefinidamente se a Meta não responder, consumindo o maxDuration à toa.
const TIMEOUT_IG_MS = 15_000;

/** Teto de texto por mensagem, em BYTES UTF-8 (limite da Meta). */
const MAX_BYTES_IG = 1000;

export type EnvioResultado = { ok: boolean; waMessageId?: string; erro?: string };

type EnvioBase = {
  conversaId: string;
  /** IGSID da pessoa. Guardado em wa_conversas.telefone quando canal='instagram'. */
  igsid: string;
  agente?: string | null;
  papel?: "prosperito" | "humano";
  tokensIn?: number | null;
  tokensOut?: number | null;
};

/**
 * Quebra o texto em pedaços de no máximo MAX_BYTES_IG BYTES (não caracteres —
 * acento e emoji ocupam mais de um byte, e é byte que a Meta conta). Corta
 * preferencialmente em quebra de linha ou espaço pra não partir palavra no
 * meio; só corta no meio de uma "palavra" quando ela sozinha estoura o teto.
 * Nunca parte um caractere ao meio: a busca do ponto de corte é feita sobre a
 * string e medida em bytes, então o pedaço é sempre UTF-8 válido.
 */
export function fatiar1000Bytes(texto: string, maxBytes = MAX_BYTES_IG): string[] {
  const enc = new TextEncoder();
  if (enc.encode(texto).length <= maxBytes) return [texto];

  const partes: string[] = [];
  let resto = texto;

  while (enc.encode(resto).length > maxBytes) {
    // Maior prefixo que cabe no teto — busca binária sobre o índice de
    // caractere, medindo em bytes.
    let lo = 1;
    let hi = resto.length;
    let corte = 1;
    while (lo <= hi) {
      const meio = (lo + hi) >> 1;
      if (enc.encode(resto.slice(0, meio)).length <= maxBytes) {
        corte = meio;
        lo = meio + 1;
      } else {
        hi = meio - 1;
      }
    }
    // Recua até a última quebra de linha/espaço, se houver uma razoável.
    const trecho = resto.slice(0, corte);
    const ultimaQuebra = Math.max(trecho.lastIndexOf("\n"), trecho.lastIndexOf(" "));
    const corteFinal = ultimaQuebra > corte * 0.5 ? ultimaQuebra : corte;

    partes.push(resto.slice(0, corteFinal).trimEnd());
    resto = resto.slice(corteFinal).trimStart();
  }
  if (resto) partes.push(resto);
  return partes.filter(Boolean);
}

async function conversaOptOut(
  db: ReturnType<typeof createXtvClient>,
  conversaId: string
): Promise<boolean> {
  const { data } = await db
    .from("wa_conversas")
    .select("opt_out")
    .eq("id", conversaId)
    .maybeSingle();
  return data?.opt_out === true;
}

/** POST na Messaging API. Env ausente devolve erro nomeado — nunca lança,
 *  nunca vira 500 cru no webhook (mesmo contrato de chamarGraph). */
async function chamarInstagram(
  corpo: Record<string, unknown>
): Promise<{ ok: boolean; id?: string; erro?: string }> {
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) return { ok: false, erro: "env_ausente(IG_ACCESS_TOKEN)" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_IG_MS);
  try {
    const resp = await fetch(IG_BASE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(corpo),
      signal: controller.signal,
    });
    const data: unknown = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg =
        (data as { error?: { message?: string } })?.error?.message ??
        `http_${resp.status}`;
      return { ok: false, erro: String(msg).slice(0, 500) };
    }
    // A Messaging API devolve { recipient_id, message_id } (não o envelope
    // `messages[]` da Cloud API do WhatsApp).
    const id = (data as { message_id?: string })?.message_id;
    return { ok: true, id };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, erro: `timeout_instagram_api(${TIMEOUT_IG_MS}ms)` };
    }
    return {
      ok: false,
      erro: e instanceof Error ? e.message.slice(0, 500) : "erro_desconhecido",
    };
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// FAROL-COMENTA (INSTA-03) — comentário vira direct.
// ----------------------------------------------------------------------------
// Duas chamadas novas, ambas medidas na doc oficial em 06/08/2026:
//
//   private reply  POST /<IG_ID>/messages
//                  { "recipient": { "comment_id": "..." },
//                    "message":   { "text": "..." } }
//   resposta púb.  POST /<IG_COMMENT_ID>/replies   (parâmetro `message`)
//
// Limites LITERAIS da doc, que moldam o dedupe lá no webhook:
//   "Only one message can be sent to the commenter"
//   "The message must be sent within 7 days of the comment was made"
// Ou seja: uma segunda tentativa no MESMO comentário é recusada pela Meta de
// qualquer jeito. O dedupe daqui não é otimização, é evitar erro garantido.
//
// PERMISSÃO: as duas exigem `instagram_business_manage_comments`, que NÃO é
// nenhuma das duas que o resto do produto usa (basic + content_publish). Se
// ela não estiver no token, o erro chega literal no log [farol-comenta] —
// é por isso que o erro da Graph é repassado inteiro e não normalizado.
//
// POR QUE NÃO REUSA chamarInstagram(): aquela função é do caminho de DM e
// está em produção; a resposta pública tem OUTRA URL e devolve { id } em vez
// de { message_id }. Mexer na assinatura dela pra caber os dois casos poria
// o envio do Prosperito em risco por causa de uma feature nova. Então nasce
// uma função irmã, e chamarInstagram fica byte a byte como estava.
// ============================================================================

/** POST cru na Graph do IG. Nunca lança; devolve o JSON pra quem chamou
 *  interpretar (message_id na Messaging API, id em /replies). */
async function postGraphIg(
  url: string,
  corpo: Record<string, unknown>
): Promise<{ ok: boolean; data?: unknown; erro?: string }> {
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) return { ok: false, erro: "env_ausente(IG_ACCESS_TOKEN)" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_IG_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(corpo),
      signal: controller.signal,
    });
    const data: unknown = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      // code + subcode + message literais: é o que distingue "falta permissão"
      // de "janela de 7 dias fechada" de "já respondi este comentário".
      const err = (data as {
        error?: { message?: string; code?: number; error_subcode?: number };
      })?.error;
      const partes = [
        err?.code !== undefined ? `code=${err.code}` : null,
        err?.error_subcode !== undefined ? `subcode=${err.error_subcode}` : null,
        err?.message ?? `http_${resp.status}`,
      ].filter(Boolean);
      return { ok: false, erro: partes.join(" ").slice(0, 500) };
    }
    return { ok: true, data };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, erro: `timeout_instagram_api(${TIMEOUT_IG_MS}ms)` };
    }
    return {
      ok: false,
      erro: e instanceof Error ? e.message.slice(0, 500) : "erro_desconhecido",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Private reply: manda uma DM endereçada pelo COMENTÁRIO, não pelo IGSID.
 * É o único jeito de abrir conversa com quem só comentou — fora disso a
 * janela de 24h nunca abriria e o Prosperito não teria como falar.
 *
 * Usa /me/messages (mesma URL do envio normal): `me` traduz pro id da conta
 * dona do token, e a doc do private reply usa /<IG_ID>/messages — mesmo
 * endpoint, mesma família. Mantém a promessa do módulo de não depender de
 * IG_USER_ID no caminho de mensagem.
 *
 * NÃO grava em wa_mensagens e NÃO lê opt_out: quem chama (o webhook) já fez
 * as duas coisas, porque precisa da trava de dedupe ANTES do envio.
 */
export async function enviarPrivateReplyInstagram(params: {
  commentId: string;
  texto: string;
}): Promise<{ ok: boolean; messageId?: string; erro?: string }> {
  const r = await postGraphIg(IG_BASE_URL, {
    recipient: { comment_id: params.commentId },
    message: { text: params.texto },
  });
  if (!r.ok) return { ok: false, erro: r.erro };
  return { ok: true, messageId: (r.data as { message_id?: string })?.message_id };
}

/**
 * Resposta pública no fio do comentário. Texto curto e SEM número nenhum —
 * vitrine limpa é regra do feed, e valor em comentário público é a porta de
 * entrada de comparação fora de contexto.
 */
export async function responderComentarioPublico(
  commentId: string,
  mensagem: string
): Promise<{ ok: boolean; id?: string; erro?: string }> {
  const url = `https://graph.instagram.com/${IG_GRAPH_VERSION}/${commentId}/replies`;
  const r = await postGraphIg(url, { message: mensagem });
  if (!r.ok) return { ok: false, erro: r.erro };
  return { ok: true, id: (r.data as { id?: string })?.id };
}

async function registrarEnvio(
  db: ReturnType<typeof createXtvClient>,
  params: EnvioBase & {
    conteudo: string;
    waMessageId?: string | null;
    statusEnvio: "enviado" | "falha";
    erro?: string | null;
  }
): Promise<void> {
  await db.from("wa_mensagens").insert({
    conversa_id: params.conversaId,
    papel: params.papel ?? "prosperito",
    agente: params.agente ?? null,
    conteudo: params.conteudo,
    wa_message_id: params.waMessageId ?? null,
    status_envio: params.statusEnvio,
    erro: params.erro ?? null,
    tokens_in: params.tokensIn ?? null,
    tokens_out: params.tokensOut ?? null,
  });
}

/**
 * Envia texto na DM do Instagram e registra em wa_mensagens. Só funciona
 * dentro da janela aberta pela mensagem da pessoa — o webhook só chama isto
 * em RESPOSTA a um inbound, que por definição está dentro da janela.
 *
 * Guard de opt-out lido aqui dentro (LGPD): "SAIR" no Instagram vale igual
 * ao "SAIR" no WhatsApp. Canal não muda regra de negócio.
 *
 * Texto acima de 1000 bytes vira mensagens sequenciais. O retorno carrega o
 * id da PRIMEIRA parte e só é ok=true se TODAS foram aceitas — meia resposta
 * entregue é falha, não sucesso parcial.
 */
export async function enviarInstagram(
  params: EnvioBase & { texto: string }
): Promise<EnvioResultado> {
  const db = createXtvClient();
  if (await conversaOptOut(db, params.conversaId)) {
    return { ok: false, erro: "opt_out" };
  }

  const partes = fatiar1000Bytes(params.texto);
  let primeiroId: string | undefined;
  let falha: string | undefined;

  for (const parte of partes) {
    const resultado = await chamarInstagram({
      recipient: { id: params.igsid },
      message: { text: parte },
    });

    await registrarEnvio(db, {
      ...params,
      conteudo: parte,
      waMessageId: resultado.id ?? null,
      statusEnvio: resultado.ok ? "enviado" : "falha",
      erro: resultado.ok ? null : resultado.erro,
    });

    if (!resultado.ok) {
      falha = resultado.erro;
      break; // não insiste nas partes seguintes: a ordem já quebrou
    }
    primeiroId ??= resultado.id;
  }

  return falha
    ? { ok: false, waMessageId: primeiroId, erro: falha }
    : { ok: true, waMessageId: primeiroId };
}
