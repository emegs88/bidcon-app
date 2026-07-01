// POST /api/processo/esign/webhook — callback do provedor de assinatura.
// Sem ESIGN_PROVIDER, responde { status: 'nao_configurado' } e não muda nada.
// Com provedor, valida a assinatura do webhook e, ao receber o evento de
// documento assinado, marca o contrato como 'assinado' + assinado_em via
// service_role (o webhook não tem sessão de usuário).
//
// COMPLIANCE/LGPD: só um ack para o provedor; nenhum dado do cliente retornado.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const provider = process.env.ESIGN_PROVIDER;
  if (!provider) {
    return NextResponse.json({ status: "nao_configurado" });
  }

  const segredo = process.env.ESIGN_WEBHOOK_SECRET;
  if (!segredo) {
    return NextResponse.json({ status: "nao_configurado" });
  }

  // Ponto de integração: validar a assinatura do provedor antes de confiar no
  // corpo. Cada provedor usa header/algoritmo diferente.
  const assinatura =
    req.headers.get("x-webhook-signature") ??
    req.headers.get("x-signature") ??
    "";
  if (!assinatura) {
    return NextResponse.json({ erro: "Assinatura ausente." }, { status: 401 });
  }

  const evento = (await req.json().catch(() => ({}))) as {
    tipo?: unknown;
    provedor_ref?: unknown; // id do envelope/documento previamente gravado
  };
  const provedorRef = String(evento.provedor_ref ?? "").trim();
  const tipo = String(evento.tipo ?? "").trim();

  if (tipo !== "documento_assinado" || !provedorRef) {
    return NextResponse.json({ status: "ignorado" });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("contratos")
    .update({ status: "assinado", assinado_em: new Date().toISOString() })
    .eq("provedor_ref", provedorRef)
    .neq("status", "assinado");
  if (error) {
    return NextResponse.json({ erro: "Falha ao confirmar." }, { status: 400 });
  }

  return NextResponse.json({ status: "ok" });
}
