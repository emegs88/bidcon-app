// /parceiro/carteira/nova — página do formulário de cadastro de carta.
// Server Component faz o guard de papel; o form em si é client.
import { exigirPapel } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { NovaCartaForm } from "./NovaCartaForm";

export const dynamic = "force-dynamic";

export default async function NovaCarta() {
  const sessao = await exigirPapel("parceiro", "admin");
  return (
    <AppShell nome={sessao.nome} tipo={sessao.perfil?.tipo}>
      <PageHeader
        title="Cadastrar carta"
        backHref="/parceiro/carteira"
        backLabel="Minha carteira"
        subtitle="Informe os dados da cota. Os valores são da carta; a transferência é feita pela administradora do consórcio."
      />
      <NovaCartaForm />
    </AppShell>
  );
}
