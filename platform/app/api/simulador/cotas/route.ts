// GET /api/simulador/cotas?administradoraId=... — estoque ao vivo (xtv) de uma
// administradora elegível, pro passo "cesta" do simulador de parceiro.
// Auth: mesmo padrão de app/api/parceiro/cartas/route.ts — client COM RLS
// (nnv) só pra checar sessão/papel; a leitura do estoque em si é via
// createXtvClient() (service_role), igual /api/vitrine, pois a policy de
// select da vitrine só libera `authenticated` do lado do Postgres do xtv.
// 100% leitura — nenhuma escrita nesta rota.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { listarAdministradorasElegiveis, listarCotasDisponiveis } from "@/lib/simulador/data";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
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

  if (!perfil || (perfil.tipo !== "parceiro" && perfil.tipo !== "admin")) {
    return NextResponse.json({ erro: "Sem permissão." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const administradoraId = searchParams.get("administradoraId");
  if (!administradoraId) {
    return NextResponse.json({ erro: "administradoraId é obrigatório." }, { status: 422 });
  }

  try {
    // Reconfirma no servidor que a administradora pedida está na lista
    // elegível (ativo + aceita_assuncao) — nunca confia em nome vindo do
    // cliente pra montar o rótulo da cota.
    const elegiveis = await listarAdministradorasElegiveis();
    const adm = elegiveis.find((a) => a.id === administradoraId);
    if (!adm) {
      return NextResponse.json(
        { erro: "Administradora não elegível ou não encontrada." },
        { status: 404 },
      );
    }

    const cotas = await listarCotasDisponiveis(adm.id, adm.nome);
    return NextResponse.json({ ok: true, cotas }, { status: 200 });
  } catch {
    return NextResponse.json({ erro: "Falha ao ler estoque." }, { status: 500 });
  }
}
