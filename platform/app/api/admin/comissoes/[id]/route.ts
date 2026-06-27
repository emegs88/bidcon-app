// POST /api/admin/comissoes/[id] — admin libera ou marca como paga uma comissão.
// As mudanças reais acontecem nas RPCs liberar_comissao / marcar_comissao_paga
// (security definer, 0006), que são admin-only por construção. Aqui exigimos
// papel admin antes de chamar (defesa em profundidade) e usamos o client COM RLS.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const ACOES = ["liberar", "pagar"] as const;
type Acao = (typeof ACOES)[number];

type Body = { acao?: unknown };

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
  const acao = body.acao as Acao;
  if (!ACOES.includes(acao)) {
    return NextResponse.json({ erro: "Ação inválida." }, { status: 422 });
  }

  const fn = acao === "liberar" ? "liberar_comissao" : "marcar_comissao_paga";
  const { error } = await supabase.rpc(fn, { p_comissao: params.id });

  if (error) {
    if (error.code === "42501") {
      return NextResponse.json({ erro: "Sem permissão." }, { status: 403 });
    }
    if (error.code === "P0002") {
      return NextResponse.json({ erro: "Comissão não encontrada." }, { status: 404 });
    }
    if (error.code === "P0001") {
      return NextResponse.json(
        { erro: "A comissão não está no estado esperado para esta ação." },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { erro: "Não foi possível atualizar a comissão." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
