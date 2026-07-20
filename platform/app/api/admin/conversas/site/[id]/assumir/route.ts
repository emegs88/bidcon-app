// POST /api/admin/conversas/site/[id]/assumir — CRM-01.
// Pausa o bot no chat do site: conversas.status='humano'. Depende da
// migration 0061 (alarga o CHECK, antes só permitia 'aberta'|'fechada') e do
// gate adicionado em platform/app/api/atende/route.ts (passo 2.5).
// Não seta atualizado_em manualmente — a tabela `conversas` já tem o trigger
// `conversas_touch` cuidando disso em qualquer UPDATE.
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
    .from("conversas")
    .update({ status: "humano" })
    .eq("id", id);

  if (error) {
    console.error("[admin/conversas/site/assumir] falha ao gravar:", error);
    return NextResponse.json({ erro: "não foi possível assumir a conversa." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
