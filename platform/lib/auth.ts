// ============================================================================
// Helpers de sessão/papel para a área logada (Server Components / Route Handlers).
// ----------------------------------------------------------------------------
// Centraliza a leitura da sessão + do profile (tipo/status) e a checagem de papel,
// para não repetir o mesmo bloco em cada página de /parceiro e /admin.
// Tudo via lib/supabase-server (anon + cookies) — continua sujeito à RLS.
// NÃO usa service_role aqui: privilégio é decidido pela RLS + checagem explícita.
// ============================================================================
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";

export type TipoPerfil = "cliente" | "parceiro" | "admin";
export type StatusPerfil = "ativo" | "pendente_aprovacao" | "suspenso";

export type Perfil = {
  id: string;
  nome: string | null;
  email: string | null;
  tipo: TipoPerfil;
  status: StatusPerfil;
};

export type Sessao = {
  userId: string;
  email: string | null;
  perfil: Perfil | null;
  nome: string | null; // nome de exibição (perfil.nome ?? email)
};

// Lê a sessão atual. Redireciona para /login se não houver usuário autenticado.
// O profile vem por RLS (profiles_select_self): só a própria linha é retornada.
export async function getSessao(): Promise<Sessao> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: perfil } = await supabase
    .from("profiles")
    .select("id, nome, email, tipo, status")
    .eq("id", user.id)
    .maybeSingle();

  const nome = perfil?.nome ?? user.email ?? null;
  return {
    userId: user.id,
    email: user.email ?? null,
    perfil: (perfil as Perfil | null) ?? null,
    nome,
  };
}

// Garante que o usuário logado tem um dos papéis permitidos.
// Sem sessão → /login (via getSessao); papel insuficiente → redireciona para a home.
// Retorna a sessão já carregada, para a página reaproveitar (nome/perfil).
export async function exigirPapel(...tipos: TipoPerfil[]): Promise<Sessao> {
  const sessao = await getSessao();
  if (!sessao.perfil || !tipos.includes(sessao.perfil.tipo)) {
    redirect("/");
  }
  return sessao;
}
