// POST /api/admin/conversas/whatsapp/[id]/devolver — CRM-01.
// Retoma o bot: wa_conversas.status='ativo'. Também zera
// `respondendo_desde` (lock de debounce) por segurança — se o admin devolver
// bem no meio de um lock travado (ex.: erro anterior), a próxima mensagem do
// cliente não fica presa esperando o TTL de 2min expirar.
// Diferente de `conversas` (site), `wa_conversas` não tem trigger de
// atualizado_em — seta manualmente pra a lista (ordenada por atualizado_em
// desc) refletir a mudança.
// Gate: checarAdminConsoleApi() (mesmo padrão de /api/admin/cartas/*).
import { NextResponse } from "next/server";
import { checarAdminConsoleApi } from "@/lib/admin-console";
import { createXtvClient } from "@/lib/supabase-xtv";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const acesso = await checarAdminConsoleApi();
  if (!acesso.ok) {
    return NextResponse.json({ erro: acesso.motivo }, { status: acesso.status });
  }

  const id = params.id;
  if (!id) {
    return NextResponse.json({ erro: "id é obrigatório." }, { status: 400 });
  }

  const supabase = createXtvClient();
  const { error } = await supabase
    .from("wa_conversas")
    .update({ status: "ativo", respondendo_desde: null, atualizado_em: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.error("[admin/conversas/whatsapp/devolver] falha ao gravar:", error);
    return NextResponse.json({ erro: "não foi possível devolver a conversa." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
