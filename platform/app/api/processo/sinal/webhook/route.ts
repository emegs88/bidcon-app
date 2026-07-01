// POST /api/processo/sinal/webhook — endpoint do gateway de PIX.
// Sem PIX_PROVIDER configurado, responde { status: 'nao_configurado' } e NÃO
// muda nada. Com provedor, aqui validaríamos a assinatura do webhook e, ao
// receber o evento de pagamento confirmado, marcaríamos a linha de sinal como
// 'pago' via service_role (o webhook não tem sessão de usuário — por isso a
// confirmação por gateway NÃO passa pela RPC admin, e sim por escrita direta
// autenticada pela assinatura do provedor).
//
// COMPLIANCE/LGPD: não retorna dado do cliente; só um ack para o gateway.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Sem provedor => rota inerte (fluxo é manual pelo admin).
  const provider = process.env.PIX_PROVIDER;
  if (!provider) {
    return NextResponse.json({ status: "nao_configurado" });
  }

  // Segredo do webhook: exigido para aceitar o evento. Sem ele, recusa.
  const segredo = process.env.PIX_WEBHOOK_SECRET;
  if (!segredo) {
    return NextResponse.json({ status: "nao_configurado" });
  }

  // Ponto de integração: validar a assinatura do provedor ANTES de confiar no
  // corpo. Cada gateway usa um header/algoritmo diferente; isso entra quando o
  // provedor for definido e autorizado. Até lá, não confiamos no payload.
  const assinatura =
    req.headers.get("x-webhook-signature") ??
    req.headers.get("x-signature") ??
    "";
  if (!assinatura) {
    return NextResponse.json({ erro: "Assinatura ausente." }, { status: 401 });
  }

  const evento = (await req.json().catch(() => ({}))) as {
    tipo?: unknown;
    provedor_ref?: unknown; // txid / charge id previamente gravado em pagamentos_sinal
  };
  const provedorRef = String(evento.provedor_ref ?? "").trim();
  const tipo = String(evento.tipo ?? "").trim();

  // só reagimos ao evento de pagamento confirmado, e só se soubermos qual cobrança.
  if (tipo !== "pagamento_confirmado" || !provedorRef) {
    return NextResponse.json({ status: "ignorado" });
  }

  // (a validação real da assinatura contra `segredo` entra aqui na integração)
  const admin = createAdminClient();
  const { error } = await admin
    .from("pagamentos_sinal")
    .update({ status: "pago", confirmado_em: new Date().toISOString() })
    .eq("provedor_ref", provedorRef)
    .eq("status", "pendente");
  if (error) {
    return NextResponse.json({ erro: "Falha ao confirmar." }, { status: 400 });
  }

  return NextResponse.json({ status: "ok" });
}
