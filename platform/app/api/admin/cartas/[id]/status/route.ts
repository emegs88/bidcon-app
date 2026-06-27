// POST /api/admin/cartas/[id]/status — admin altera o status de qualquer carta.
// A mudança real acontece na RPC definir_status_carta (security definer, 0006),
// que valida admin OU dono. Aqui exigimos explicitamente papel admin antes de
// chamar a RPC (defesa em profundidade); usamos o client COM RLS.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const PERMITIDOS = ["disponivel", "reservada", "indisponivel", "vendida"] as const;
type Permitido = (typeof PERMITIDOS)[number];

type Body = { status?: unknown };

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

  const { data: perfil } = await supabase
    .from("profiles")
    .select("tipo")
    .eq("id", user.id)
    .maybeSingle();
  if (perfil?.tipo !== "admin") {
    return NextResponse.json({ erro: "Sem permissão." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const novo = body.status as Permitido;
  if (!PERMITIDOS.includes(novo)) {
    return NextResponse.json({ erro: "Status inválido." }, { status: 422 });
  }

  const { error } = await supabase.rpc("definir_status_carta", {
    p_carta: params.id,
    p_novo: novo,
  });

  if (error) {
    if (error.code === "42501") {
      return NextResponse.json({ erro: "Sem permissão." }, { status: 403 });
    }
    if (error.code === "P0002") {
      return NextResponse.json({ erro: "Carta não encontrada." }, { status: 404 });
    }
    return NextResponse.json(
      { erro: "Não foi possível atualizar o status." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
