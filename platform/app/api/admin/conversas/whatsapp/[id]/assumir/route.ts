// POST /api/admin/conversas/whatsapp/[id]/assumir — CRM-01.
// Pausa o bot: wa_conversas.status='humano'. O webhook
// (platform/app/api/whatsapp/route.ts, `podeResponder`) já respeita esse
// status — nenhuma mudança no motor do WhatsApp foi necessária.
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
    .update({ status: "humano", atualizado_em: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.error("[admin/conversas/whatsapp/assumir] falha ao gravar:", error);
    return NextResponse.json({ erro: "não foi possível assumir a conversa." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
