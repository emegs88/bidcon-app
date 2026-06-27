// POST /api/admin/processos/[id]/status — avança (ou cancela) um processo.
// A regra de transição e a trilha de eventos vivem na RPC avancar_status_processo
// (security definer, 0006): admin OU parceiro-dono, só um passo à frente ou
// cancelar. Aqui basta o client COM RLS (autenticado); a RPC valida o papel.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { ORDEM_STATUS } from "@/lib/status";

export const dynamic = "force-dynamic";

const PERMITIDOS = [...ORDEM_STATUS, "cancelado"] as const;

type Body = { status?: unknown; nota?: unknown };

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const novo = body.status;
  if (typeof novo !== "string" || !PERMITIDOS.includes(novo as (typeof PERMITIDOS)[number])) {
    return NextResponse.json({ erro: "Status inválido." }, { status: 422 });
  }
  const nota = typeof body.nota === "string" ? body.nota : null;

  const { error } = await supabase.rpc("avancar_status_processo", {
    p_processo: params.id,
    p_novo: novo,
    p_nota: nota,
  });

  if (error) {
    if (error.code === "42501") {
      return NextResponse.json({ erro: "Sem permissão." }, { status: 403 });
    }
    if (error.code === "P0002") {
      return NextResponse.json({ erro: "Processo não encontrado." }, { status: 404 });
    }
    // P0001 = status_terminal / transicao_invalida
    return NextResponse.json(
      { erro: "Transição de status não permitida." },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true });
}
