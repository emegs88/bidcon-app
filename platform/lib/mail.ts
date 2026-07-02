// ============================================================================
// Envio de e-mail transacional — Resend (SOMENTE no servidor).
// ----------------------------------------------------------------------------
// Primeiro remetente de e-mail do projeto. Usado por rotas server-side que
// precisam avisar o admin (ex.: novo cadastro). NÃO tem "use client".
//
// Sem SDK novo: chamamos a API HTTP do Resend com fetch nativo, então não
// adiciona dependência ao package.json. Precisa das env vars de SERVIDOR:
//   - RESEND_API_KEY   (secreta — nunca no client, nunca no repo, nunca em log)
//   - MAIL_FROM        (remetente verificado no domínio, ex.: avisos@bidcon.com.br)
//   - MAIL_ADMIN       (destino dos avisos internos, ex.: emerson@bidcon.com.br)
//
// COMPLIANCE: este canal é INTERNO (admin). Ainda assim, nada de linguagem de
// "investimento"/"rendimento"/"garantido" — só fato operacional.
// ============================================================================

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type EmailInput = {
  to: string | string[];
  subject: string;
  // texto puro; mantém simples e auditável. HTML é opcional.
  text: string;
  html?: string;
};

export type EmailResult =
  | { ok: true; id: string }
  | { ok: false; erro: string };

/**
 * Envia um e-mail via Resend. Falha "suave": devolve { ok:false } em vez de
 * lançar, para que o chamador (webhook) NUNCA quebre o fluxo por causa do aviso.
 * Nunca loga o corpo nem a API key.
 */
export async function enviarEmail(input: EmailInput): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!apiKey || !from) {
    return { ok: false, erro: "Faltam env vars de servidor (RESEND_API_KEY / MAIL_FROM)." };
  }

  try {
    const resp = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(input.to) ? input.to : [input.to],
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
      }),
    });

    if (!resp.ok) {
      // não expõe corpo do provedor em log; devolve só o status
      return { ok: false, erro: `Resend respondeu ${resp.status}.` };
    }
    const data = (await resp.json()) as { id?: string };
    return { ok: true, id: data.id ?? "" };
  } catch {
    return { ok: false, erro: "Falha de rede ao chamar o Resend." };
  }
}
