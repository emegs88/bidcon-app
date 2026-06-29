// POST /api/admin/kyc/[id]/decidir — registra a decisão de KYC de um cliente.
// Decisões: verificado | rejeitado | bloqueado. A escrita do veredito (status +
// verificado_em/por + evento de auditoria) é feita pela RPC kyc_decidir
// (security definer), que é a ÚNICA porta para mexer nos campos de veredito.
// Fluxo desta rota:
//   1) client COM RLS (createClient) identifica o chamador e checa papel admin;
//   2) a RPC kyc_decidir é chamada com ESSE MESMO client RLS (não service_role),
//      porque ela revalida is_admin() internamente — e is_admin() depende de
//      auth.uid(). Com service_role, auth.uid() é null e a RPC falharia (42501).
// A checagem de papel + o is_admin() na RPC mantêm a defesa em profundidade.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const PERMITIDOS = ["verificado", "rejeitado", "bloqueado"] as const;
type Permitido = (typeof PERMITIDOS)[number];

type Body = { status?: unknown; motivo?: unknown };

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

  if (!perfil || perfil.tipo !== "admin") {
    return NextResponse.json({ erro: "Sem permissão." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const novo = body.status as Permitido;
  if (!PERMITIDOS.includes(novo)) {
    return NextResponse.json({ erro: "Decisão inválida." }, { status: 422 });
  }

  const motivo =
    typeof body.motivo === "string" && body.motivo.trim()
      ? body.motivo.trim()
      : null;

  // Rejeitar/Bloquear exigem motivo (a RPC também valida, mas falhamos cedo).
  if ((novo === "rejeitado" || novo === "bloqueado") && !motivo) {
    return NextResponse.json(
      { erro: "Informe o motivo para rejeitar ou bloquear." },
      { status: 422 }
    );
  }

  // Veredito via RPC (security definer) — porta única para os campos sensíveis.
  // IMPORTANTE: a RPC revalida is_admin() internamente, que depende de auth.uid().
  // Por isso ela é chamada com o client RLS do próprio admin (auth.uid() = admin),
  // e NÃO com service_role (onde auth.uid() é null e is_admin() falharia com 42501).
  // A checagem de papel acima + o is_admin() na RPC mantêm a defesa em profundidade.
  const { error } = await supabase.rpc("kyc_decidir", {
    p_user: params.id,
    p_status: novo,
    p_motivo: motivo,
  });

  if (error) {
    // 42501 = sem permissão; P0001 = validação na RPC. Mensagem neutra ao client.
    return NextResponse.json(
      { erro: "Não foi possível registrar a decisão." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
