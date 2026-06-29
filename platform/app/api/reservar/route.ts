// POST /api/reservar — cliente inicia a reserva de uma carta disponível.
// Toda a regra (KYC verificado, carta disponível, sem duplicar, criação do
// processo + evento) está na RPC public.reservar_carta (security definer,
// migration 0009). Esta rota é fina: identifica o chamador e delega.
//
// IMPORTANTE: a RPC usa auth.uid() (gate de KYC + cliente_id do processo). Por
// isso chamamos com o client RLS do próprio usuário (createClient) — NÃO com
// service_role, onde auth.uid() seria null e a RPC barraria (42501). Mesmo
// padrão de /api/admin/kyc/[id]/decidir.
//
// Sem dado bancário; nada aqui promete contemplação. Os valores do processo são
// copiados da carta dentro da RPC (sem administradora/taxa/fundo).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

type Body = { carta_id?: unknown };

// Mapeia o errcode da RPC para mensagem neutra + status HTTP adequado.
function mapErro(code: string | undefined): { erro: string; status: number } {
  switch (code) {
    case "42501":
      return { erro: "Não autenticado.", status: 401 };
    case "P0002":
      return { erro: "Carta não encontrada.", status: 404 };
    case "P0001":
    default:
      // kyc_nao_verificado | carta_indisponivel caem aqui — mensagem neutra.
      return {
        erro: "Não foi possível reservar esta carta agora.",
        status: 409,
      };
  }
}

export async function POST(req: Request) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const cartaId = typeof body.carta_id === "string" ? body.carta_id.trim() : "";
  if (!cartaId) {
    return NextResponse.json({ erro: "Carta inválida." }, { status: 422 });
  }

  const { data, error } = await supabase.rpc("reservar_carta", {
    p_carta_id: cartaId,
  });

  if (error) {
    const { erro, status } = mapErro(error.code);
    return NextResponse.json({ erro }, { status });
  }

  // data = processo_id (uuid) retornado pela RPC.
  return NextResponse.json({ ok: true, processo_id: data });
}
