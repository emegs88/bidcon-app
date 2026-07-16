// ============================================================================
// Envio de mensagens via WhatsApp Cloud API (Graph API) — FATIA F2+F3.
// ----------------------------------------------------------------------------
// Duas funções: sendText (texto livre — só dentro da janela de 24h; o
// webhook só chama isto em RESPOSTA a um inbound, que por definição está
// dentro da janela) e sendTemplate (fora da janela / retomada proativa —
// não usada ainda nesta fatia, mas já pronta pro handoff/F4).
//
// Guard obrigatório (LGPD): NUNCA envia se wa_conversas.opt_out=true — a
// checagem é feita AQUI DENTRO, não confiando no chamador (mesmo espírito
// de "nunca confiar no client" já usado no webhook pro carta_foco/reserva).
//
// Toda tentativa de envio (sucesso ou falha) é registrada em wa_mensagens.
// papel='prosperito' — o enum wa_papel (cliente|prosperito|humano|sistema,
// ver migration 0046) NÃO tem valor 'agente'; a persona real que respondeu
// (ex. 'valentina') vai na coluna livre `agente`, mesmo padrão de
// mensagens.agente no /api/atende (site).
//
// service_role (createXtvClient): mesmo motivo do webhook — sem sessão de
// usuário, chamado de dentro de uma rota server-only.
// ============================================================================
import { createXtvClient } from "@/lib/supabase-xtv";

const GRAPH_VERSION = "v21.0";

type EnvioBase = {
  conversaId: string;
  telefone: string;
  agente?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
};

export type EnvioResultado = { ok: boolean; waMessageId?: string; erro?: string };

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

async function chamarGraph(
  corpo: Record<string, unknown>
): Promise<{ ok: boolean; id?: string; erro?: string }> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) {
    return { ok: false, erro: "env_ausente(WHATSAPP_TOKEN|WHATSAPP_PHONE_NUMBER_ID)" };
  }
  try {
    const resp = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(corpo),
      }
    );
    const data: unknown = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg =
        (data as { error?: { message?: string } })?.error?.message ??
        `http_${resp.status}`;
      return { ok: false, erro: String(msg).slice(0, 500) };
    }
    const id = (data as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id;
    return { ok: true, id };
  } catch (e) {
    return {
      ok: false,
      erro: e instanceof Error ? e.message.slice(0, 500) : "erro_desconhecido",
    };
  }
}

async function registrarEnvio(
  db: ReturnType<typeof createXtvClient>,
  params: EnvioBase & {
    conteudo: string;
    template?: string | null;
    waMessageId?: string | null;
    statusEnvio: "enviado" | "falha";
    erro?: string | null;
  }
): Promise<void> {
  await db.from("wa_mensagens").insert({
    conversa_id: params.conversaId,
    papel: "prosperito",
    agente: params.agente ?? null,
    conteudo: params.conteudo,
    template: params.template ?? null,
    wa_message_id: params.waMessageId ?? null,
    status_envio: params.statusEnvio,
    erro: params.erro ?? null,
    tokens_in: params.tokensIn ?? null,
    tokens_out: params.tokensOut ?? null,
  });
}

/** Envia texto livre (dentro da janela de 24h) e registra em wa_mensagens. */
export async function sendText(
  params: EnvioBase & { texto: string }
): Promise<EnvioResultado> {
  const db = createXtvClient();
  if (await conversaOptOut(db, params.conversaId)) {
    return { ok: false, erro: "opt_out" };
  }

  const resultado = await chamarGraph({
    messaging_product: "whatsapp",
    to: params.telefone,
    type: "text",
    text: { body: params.texto },
  });

  await registrarEnvio(db, {
    ...params,
    conteudo: params.texto,
    waMessageId: resultado.id ?? null,
    statusEnvio: resultado.ok ? "enviado" : "falha",
    erro: resultado.ok ? null : resultado.erro,
  });

  return { ok: resultado.ok, waMessageId: resultado.id, erro: resultado.erro };
}

/** Envia template aprovado pela Meta (fora da janela de 24h / retomada). Não
 *  chamada ainda nesta fatia (F2/F3 só respondem inbound) — pronta pro F4. */
export async function sendTemplate(
  params: EnvioBase & {
    templateName: string;
    languageCode?: string;
    components?: unknown[];
    textoRegistro: string; // texto legível pra gravar em wa_mensagens.conteudo
  }
): Promise<EnvioResultado> {
  const db = createXtvClient();
  if (await conversaOptOut(db, params.conversaId)) {
    return { ok: false, erro: "opt_out" };
  }

  const resultado = await chamarGraph({
    messaging_product: "whatsapp",
    to: params.telefone,
    type: "template",
    template: {
      name: params.templateName,
      language: { code: params.languageCode ?? "pt_BR" },
      ...(params.components ? { components: params.components } : {}),
    },
  });

  await registrarEnvio(db, {
    ...params,
    conteudo: params.textoRegistro,
    template: params.templateName,
    waMessageId: resultado.id ?? null,
    statusEnvio: resultado.ok ? "enviado" : "falha",
    erro: resultado.ok ? null : resultado.erro,
  });

  return { ok: resultado.ok, waMessageId: resultado.id, erro: resultado.erro };
}
