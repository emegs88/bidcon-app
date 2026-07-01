// POST /api/admin/processo/[id]/sinal — admin confirma manualmente o sinal
// (fallback sem PIX_PROVIDER). A regra e o papel vivem na RPC
// confirmar_pagamento_sinal (0014, security definer, ADMIN-ONLY, idempotente).
// Aqui basta o client COM RLS (autenticado); a RPC valida o papel.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Body = { pagamento_id?: unknown };

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const pagamentoId = String(body.pagamento_id ?? "").trim();

  if (!UUID_RE.test(pagamentoId)) {
    return NextResponse.json({ erro: "Pagamento inválido." }, { status: 422 });
  }

  const { error } = await supabase.rpc("confirmar_pagamento_sinal", {
    p_pagamento: pagamentoId,
  });

  if (error) {
    if (error.code === "42501") {
      return NextResponse.json({ erro: "Sem permissão." }, { status: 403 });
    }
    if (error.code === "P0002") {
      return NextResponse.json({ erro: "Pagamento não encontrado." }, { status: 404 });
    }
    return NextResponse.json({ erro: "Não foi possível confirmar o sinal." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
