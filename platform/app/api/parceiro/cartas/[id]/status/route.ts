// POST /api/parceiro/cartas/[id]/status — altera o status de uma carta.
// A mudança real acontece na RPC definir_status_carta (security definer, 0006):
// a função valida que o chamador é admin OU dono da carta antes de gravar.
// Aqui usamos o client COM RLS (createClient): basta estar autenticado; a RPC
// faz a checagem de papel/posse. Mapeamos os errcodes da função para HTTP.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const PERMITIDOS = ["disponivel", "reservada", "indisponivel"] as const;
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
    // 42501 = sem_permissao; P0002 = carta_inexistente.
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
