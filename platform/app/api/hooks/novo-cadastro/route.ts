// ============================================================================
// POST /api/hooks/novo-cadastro — aviso de novo cadastro (cliente OU parceiro).
// ----------------------------------------------------------------------------
// Chamado por um Database Webhook do Supabase no INSERT de public.profiles.
// Pega 100% dos cadastros: autocadastro (sempre 'cliente') E parceiro criado
// por promoção admin (UPDATE→INSERT não; INSERT sim). Envia UM e-mail interno
// ao admin com os dados factuais do novo perfil.
//
// SEGURANÇA:
//   - A rota exige um segredo compartilhado (HOOK_SECRET) enviado pelo webhook
//     no header Authorization: Bearer <HOOK_SECRET>. Sem ele → 401. Isso impede
//     que qualquer um POSTe na rota fingindo ser o Supabase.
//   - Não usa service_role nem lê o banco: só reage ao payload do webhook.
//   - Nunca ecoa o segredo nem a API key em resposta/log.
//
// FALHA SUAVE: se o e-mail não sair, respondemos 200 mesmo assim — o webhook
// não deve reprocessar o cadastro por causa de um aviso. O erro fica no corpo.
// ============================================================================
import { NextResponse } from "next/server";
import { enviarEmail } from "@/lib/mail";
import { garantirLexico } from "@/lib/lexico";

export const dynamic = "force-dynamic";

// Formato do payload de Database Webhook do Supabase (INSERT).
type WebhookPayload = {
  type?: string;
  table?: string;
  record?: {
    id?: string;
    email?: string | null;
    nome?: string | null;
    telefone?: string | null;
    tipo?: string | null;
    status?: string | null;
  };
};

function autorizado(req: Request): boolean {
  const secret = process.env.HOOK_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

export async function POST(req: Request) {
  if (!autorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  let body: WebhookPayload;
  try {
    body = (await req.json()) as WebhookPayload;
  } catch {
    return NextResponse.json({ erro: "JSON inválido." }, { status: 400 });
  }

  // só reage a INSERT em profiles; ignora o resto sem erro
  if (body.type !== "INSERT" || body.table !== "profiles" || !body.record) {
    return NextResponse.json({ ignorado: true }, { status: 200 });
  }

  const admin = process.env.MAIL_ADMIN;
  if (!admin) {
    return NextResponse.json(
      { ok: false, erro: "Falta MAIL_ADMIN (destino do aviso)." },
      { status: 200 }
    );
  }

  const r = body.record;
  const tipo = (r.tipo ?? "cliente").trim();
  const nome = (r.nome ?? "").trim() || "(sem nome)";
  const email = (r.email ?? "").trim() || "(sem e-mail)";
  const telefone = (r.telefone ?? "").trim() || "(sem telefone)";

  const assunto = `Novo cadastro na bidcon — ${tipo}: ${nome}`;
  const texto = [
    "Novo cadastro registrado na plataforma bidcon.",
    "",
    `Tipo:      ${tipo}`,
    `Nome:      ${nome}`,
    `E-mail:    ${email}`,
    `Telefone:  ${telefone}`,
    `Status:    ${(r.status ?? "").trim() || "(sem status)"}`,
    `ID:        ${(r.id ?? "").trim() || "(sem id)"}`,
    "",
    "Aviso interno automático. Não responda a este e-mail.",
  ].join("\n");

  // Guarda de léxico ANTES de enviar: se assunto ou corpo tiver termo proibido
  // (ex.: nome de cliente contendo "investimento"), NÃO envia e registra o
  // motivo. Nunca derruba o cadastro — resposta 200 como as demais falhas.
  const lex = garantirLexico(`${assunto}\n${texto}`);
  if (!lex.ok) {
    return NextResponse.json(
      { ok: false, erro: `Léxico bloqueou o envio (termo: ${lex.termo}).` },
      { status: 200 }
    );
  }

  const envio = await enviarEmail({ to: admin, subject: assunto, text: texto });

  // sempre 200: aviso não deve travar o cadastro
  if (!envio.ok) {
    return NextResponse.json({ ok: false, erro: envio.erro }, { status: 200 });
  }
  return NextResponse.json({ ok: true, id: envio.id }, { status: 200 });
}
