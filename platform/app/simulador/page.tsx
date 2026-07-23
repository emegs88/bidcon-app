// /simulador — Simulador Conta Notarial para Parceiros (fatia SIM-PARCEIRO-01).
// Server Component: gate de papel (exigirPapel) + busca o estoque leve inicial
// (administradoras elegíveis) + casca padrão da área logada (AppShell/PageHeader,
// igual a /parceiro). Toda a lógica de cesta/cálculo/demonstrativo roda no
// client (SimuladorClient), pois é pura (engine.ts) e não precisa ida-e-volta
// ao servidor depois de carregado o estoque de cotas da administradora
// escolhida (via /api/simulador/cotas).
import { exigirPapel } from "@/lib/auth";
import { listarAdministradorasElegiveis } from "@/lib/simulador/data";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { SimuladorClient } from "./SimuladorClient";

export const dynamic = "force-dynamic";

export default async function SimuladorPage() {
  const sessao = await exigirPapel("parceiro", "admin");
  const administradoras = await listarAdministradorasElegiveis();

  return (
    <AppShell nome={sessao.nome} tipo={sessao.perfil?.tipo}>
      <PageHeader
        title="Simulador — Conta Notarial"
        subtitle="Monte a cesta de cartas de crédito do cliente e gere o demonstrativo de planejamento em segundos."
        backHref="/parceiro"
        backLabel="Painel do parceiro"
      />
      <SimuladorClient administradoras={administradoras} />
    </AppShell>
  );
}
