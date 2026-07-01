// /prospere-ancora — simulador interno da equipe Prospere (tabela Âncora).
// ----------------------------------------------------------------------------
// Server Component. Acesso restrito por DUAS camadas:
//   - aqui (Next): exige sessão + e-mail @prospere.com.br, senão redireciona;
//   - RLS (migration 0013): o SELECT já é negado a quem não é da equipe.
// Lê o estoque já importado (pode estar vazio até o primeiro importar) e entrega
// ao componente client que filtra/simula. Nada de cliente/parceiro aqui.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { ehEquipeProspere } from "@/lib/equipe";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { SimuladorAncora, type LinhaAncora } from "./SimuladorAncora";

export const dynamic = "force-dynamic";

export default async function ProspereAncoraPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  // Gate de equipe na camada de aplicação (a RLS reforça no banco).
  if (!ehEquipeProspere(user.email)) redirect("/");

  const { data: perfil } = await supabase
    .from("profiles")
    .select("nome, tipo")
    .eq("id", user.id)
    .maybeSingle();
  const nome = perfil?.nome ?? user.email ?? null;
  const tipo = (perfil?.tipo ?? "cliente") as "cliente" | "parceiro" | "admin";

  // Estoque da tabela Âncora. RLS garante que só a equipe lê. Sem dado => vazio.
  const { data: linhas } = await supabase
    .from("ancora_tabela")
    .select(
      "id, produto, bem_codigo, bem_nome, valor_do_bem, grupo, plano, prazo_grupo, prazo_comercializacao, taxa_administracao, fundo_reserva, pf_com_seguro, pf_sem_seguro, pj_com_seguro, pj_sem_seguro, assembleia, cotas_ativas, cotas_vagas, status"
    )
    .order("produto", { ascending: true })
    .order("grupo", { ascending: true });

  const dados = (linhas ?? []) as LinhaAncora[];

  return (
    <AppShell nome={nome} tipo={tipo} equipe>
      <PageHeader
        title="PROSPERE byAncora"
        subtitle="Ferramenta interna da equipe. Tabela de venda de cotas novas do portal da Âncora — preço de entrada, taxa e fundo. Os valores são lidos do portal e armazenados como estão (nunca recalculados)."
        action={
          <Button href="/prospere-ancora/importar" variant="ghost" size="sm">
            Importar tabela
          </Button>
        }
      />

      {dados.length === 0 ? (
        <EmptyState
          icon="📊"
          title="Nenhuma tabela importada ainda"
          description="Faça a importação do JSON real capturado no portal autenticado para popular o simulador. Enquanto não houver importação, esta área fica vazia."
          action={
            <Button href="/prospere-ancora/importar" size="sm">
              Importar agora
            </Button>
          }
        />
      ) : (
        <SimuladorAncora linhas={dados} />
      )}
    </AppShell>
  );
}
