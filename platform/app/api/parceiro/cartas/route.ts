// POST /api/parceiro/cartas — cadastro de carta da carteira do parceiro.
// Mutação via Route Handler (nunca Server Action). Usa o client COM RLS
// (createClient server): o INSERT cabe na policy cartas_parceiro_insert quando
// parceiro_id = auth.uid(). A checagem de papel é feita aqui no servidor.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

type Body = {
  tipo?: unknown;
  valor_credito?: unknown;
  valor_entrada?: unknown;
  valor_parcela?: unknown;
  qtd_parcelas?: unknown;
};

function numOuNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: Request) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  // checagem de papel no servidor
  const { data: perfil } = await supabase
    .from("profiles")
    .select("tipo, status")
    .eq("id", user.id)
    .maybeSingle();

  if (!perfil || (perfil.tipo !== "parceiro" && perfil.tipo !== "admin")) {
    return NextResponse.json({ erro: "Sem permissão." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;

  const tipo = body.tipo === "imovel" || body.tipo === "veiculo" ? body.tipo : null;
  const valorCredito = numOuNull(body.valor_credito);

  if (!tipo) {
    return NextResponse.json({ erro: "Tipo inválido." }, { status: 422 });
  }
  if (valorCredito === null || valorCredito <= 0) {
    return NextResponse.json({ erro: "Crédito da carta inválido." }, { status: 422 });
  }

  const qtd = numOuNull(body.qtd_parcelas);

  const { data, error } = await supabase
    .from("cartas")
    .insert({
      parceiro_id: user.id,
      tipo,
      valor_credito: valorCredito,
      valor_entrada: numOuNull(body.valor_entrada),
      valor_parcela: numOuNull(body.valor_parcela),
      qtd_parcelas: qtd === null ? null : Math.trunc(qtd),
      status: "disponivel",
      fonte: "manual",
      criado_via: "manual",
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json(
      { erro: "Não foi possível cadastrar a carta." },
      { status: 400 }
    );
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}
