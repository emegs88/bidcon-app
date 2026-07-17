// POST /api/admin/processos/[id]/gerar-acesso — gera um magic link de acesso
// pro CLIENTE dono do processo, pra entregar por WhatsApp/e-mail quando ele
// não lembra a senha ou nunca chegou a definir uma (fluxo é sempre magic
// link, não tem senha nesse app). Mesmo padrão de 2 passos do
// api/admin/parceiros/[id]/status/route.ts:
//   1) client COM RLS (createClient) só pra identificar o chamador e checar
//      que é admin;
//   2) só depois disso, createAdminClient() (service_role) — necessário
//      porque auth.admin.generateLink() exige service_role, e não existe
//      RPC security-definer equivalente ao avancar_status_processo pra
//      delegar essa checagem.
// A service_role nunca é exposta ao client; vive só neste handler.
//
// O e-mail do cliente NUNCA vem do corpo da requisição — é sempre resolvido
// no servidor a partir de processos.cliente_id (lido com o client do
// próprio admin, então sujeito à RLS normal) e depois de auth.users via
// admin.getUserById(). Isso fecha a porta de um admin (ou alguém com o
// token dele) gerar link de acesso pra um e-mail arbitrário.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

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

  const { data: processo } = await supabase
    .from("processos")
    .select("id, cliente_id")
    .eq("id", params.id)
    .maybeSingle();

  if (!processo) {
    return NextResponse.json(
      { erro: "Processo não encontrado." },
      { status: 404 }
    );
  }

  const admin = createAdminClient();

  const { data: clienteAuth, error: erroCliente } =
    await admin.auth.admin.getUserById(processo.cliente_id);
  const email = clienteAuth?.user?.email;
  if (erroCliente || !email) {
    return NextResponse.json(
      { erro: "Cliente sem e-mail cadastrado." },
      { status: 422 }
    );
  }

  const { origin } = new URL(req.url);
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${origin}/auth/callback?next=/meu-processo` },
  });

  if (error || !data.properties?.action_link) {
    return NextResponse.json(
      { erro: "Não foi possível gerar o link de acesso." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, link: data.properties.action_link });
}
