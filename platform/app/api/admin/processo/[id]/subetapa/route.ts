// POST /api/admin/processo/[id]/subetapa — avança a sub-etapa do fluxo Lance.
// A ordem, o papel (admin OU parceiro-dono) e a trilha de eventos vivem na RPC
// processo_avancar_subetapa (0014, security definer). Aqui basta o client COM
// RLS (autenticado); a RPC valida tudo.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { ORDEM_SUBETAPA, type SubetapaProcesso } from "@/lib/status";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Body = { subetapa?: unknown; nota?: unknown };

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

  const processoId = String(params.id ?? "").trim();
  const body = (await req.json().catch(() => ({}))) as Body;
  const subetapa = String(body.subetapa ?? "").trim();
  const nota =
    typeof body.nota === "string" ? body.nota.trim().slice(0, 500) : null;

  if (!UUID_RE.test(processoId)) {
    return NextResponse.json({ erro: "Processo inválido." }, { status: 422 });
  }
  if (!ORDEM_SUBETAPA.includes(subetapa as SubetapaProcesso)) {
    return NextResponse.json({ erro: "Sub-etapa inválida." }, { status: 422 });
  }

  const { error } = await supabase.rpc("processo_avancar_subetapa", {
    p_processo: processoId,
    p_subetapa: subetapa,
    p_nota: nota,
  });

  if (error) {
    if (error.code === "42501") {
      return NextResponse.json({ erro: "Sem permissão." }, { status: 403 });
    }
    if (error.code === "P0002") {
      return NextResponse.json({ erro: "Processo não encontrado." }, { status: 404 });
    }
    return NextResponse.json(
      { erro: "Não foi possível avançar a sub-etapa." },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true });
}
