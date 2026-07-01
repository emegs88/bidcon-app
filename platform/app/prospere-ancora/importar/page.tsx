// /prospere-ancora/importar — tela interna da equipe para popular a tabela Âncora.
// ----------------------------------------------------------------------------
// Server Component. Mesmo gate de DUAS camadas do simulador:
//   - aqui (Next): exige sessão + e-mail @prospere.com.br, senão redireciona;
//   - RLS (migration 0013) + a própria rota POST reforçam no banco.
// A tela em si não escreve nada: ela só entrega o <ImportarForm> client, que
// faz o POST para /api/prospere-ancora/importar (onde a service_role grava).
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { ehEquipeProspere } from "@/lib/equipe";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { ImportarForm } from "./ImportarForm";

export const dynamic = "force-dynamic";

export default async function ImportarAncoraPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  // Gate de equipe na camada de aplicação (a RLS e a rota POST reforçam).
  if (!ehEquipeProspere(user.email)) redirect("/");

  const { data: perfil } = await supabase
    .from("profiles")
    .select("nome, tipo")
    .eq("id", user.id)
    .maybeSingle();
  const nome = perfil?.nome ?? user.email ?? null;
  const tipo = (perfil?.tipo ?? "cliente") as "cliente" | "parceiro" | "admin";

  return (
    <AppShell nome={nome} tipo={tipo} equipe>
      <PageHeader
        title="Importar tabela Âncora"
        subtitle="Cole aqui o JSON bruto capturado no portal autenticado da Âncora (cotas novas). Os valores são gravados como vêm — nunca recalculados. A importação substitui as linhas com a mesma chave (produto · bem · grupo · plano)."
      />
      <ImportarForm />
    </AppShell>
  );
}
