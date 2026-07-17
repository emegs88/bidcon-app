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

  // E-mail de fallback do profile do cliente — resolvido via RLS normal do
  // próprio admin (policy profiles_admin_all), não precisa de service_role
  // pra isso. Usado só se o Auth não devolver e-mail (ver comentário abaixo).
  const { data: perfilCliente } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", processo.cliente_id)
    .maybeSingle();

  const admin = createAdminClient();

  const { data: clienteAuth, error: erroCliente } =
    await admin.auth.admin.getUserById(processo.cliente_id);

  if (erroCliente) {
    // Loga o erro cru do Auth pra diagnosticar rápido da próxima vez — antes
    // disso a falha de API ficava indistinguível de "cliente sem e-mail" (ver
    // incidente SUPABASE_SERVICE_ROLE_KEY no DIARIO-BORDO). Não expõe segredo
    // nenhum, só o erro que o SDK devolveu.
    console.error(
      "[gerar-acesso] auth.admin.getUserById falhou:",
      processo.cliente_id,
      erroCliente
    );
  }

  // Fallback: se o Auth não devolveu e-mail (usuário legado com Auth
  // incompleto, por exemplo), usa profiles.email — o admin já enxerga via
  // RLS própria (profiles_admin_all). Isso NÃO cobre o caso de a API do Auth
  // estar fora do ar / com chave inválida: nesse cenário o generateLink logo
  // abaixo falha do mesmo jeito, e o ganho aqui é o erro claro + log, não o
  // fallback em si.
  const email = clienteAuth?.user?.email || perfilCliente?.email;

  if (!email) {
    return NextResponse.json(
      {
        erro: erroCliente
          ? "Falha ao consultar o Auth do cliente. Veja os logs do servidor."
          : "Cliente sem e-mail cadastrado.",
      },
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
    // Mesmo padrão: loga o erro cru em vez de deixar essa falha invisível.
    console.error(
      "[gerar-acesso] auth.admin.generateLink falhou:",
      processo.cliente_id,
      error
    );
    return NextResponse.json(
      { erro: "Não foi possível gerar o link de acesso. Veja os logs do servidor." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, link: data.properties.action_link });
}
