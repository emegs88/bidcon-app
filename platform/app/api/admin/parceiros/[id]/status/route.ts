// POST /api/admin/parceiros/[id]/status — aprova/suspende um parceiro.
// Altera profiles.status (ativo | suspenso | pendente_aprovacao). Como a RLS de
// profiles só concede UPDATE livre ao admin (profiles_admin_all), e queremos a
// checagem de papel explícita no servidor, fazemos assim:
//   1) client COM RLS (createClient) só para identificar o chamador e checar papel;
//   2) escrita com createAdminClient() (service_role) após confirmar que é admin.
// A service_role NUNCA é exposta ao client; vive só neste handler de servidor.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const PERMITIDOS = ["ativo", "suspenso", "pendente_aprovacao"] as const;
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

  if (!perfil || perfil.tipo !== "admin") {
    return NextResponse.json({ erro: "Sem permissão." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const novo = body.status as Permitido;
  if (!PERMITIDOS.includes(novo)) {
    return NextResponse.json({ erro: "Status inválido." }, { status: 422 });
  }

  // Escrita privilegiada — só depois de confirmar que o chamador é admin.
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ status: novo })
    .eq("id", params.id)
    .eq("tipo", "parceiro"); // só mexe em parceiros (não toca admin/cliente)

  if (error) {
    return NextResponse.json(
      { erro: "Não foi possível atualizar o parceiro." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
