// /buscar — busca de cartas por linguagem natural (Nível 3).
// Server Component: resolve sessão (RLS) e monta a casca; a interação (campo +
// resultados) vive no client component Busca, que chama /api/buscar-cartas.
// Página da área logada (sem exigir papel): qualquer usuário autenticado busca,
// como na vitrine. A busca em si só devolve estoque 'disponivel' (RPC 0007).
import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Busca } from "./Busca";

export const dynamic = "force-dynamic";

export default async function BuscarPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("nome, tipo")
    .eq("id", user.id)
    .single();
  const nome = profile?.nome ?? user.email ?? null;
  const tipo = profile?.tipo as "cliente" | "parceiro" | "admin" | undefined;

  return (
    <AppShell nome={nome} tipo={tipo}>
      <PageHeader
        title="Buscar carta"
        backHref="/cartas"
        subtitle="Descreva o que você procura em poucas palavras. Mostramos as cartas já contempladas que mais combinam com o seu objetivo."
      />
      <Busca />
    </AppShell>
  );
}
