// /admin — visão geral. Server Component. Admin enxerga tudo (policies *_admin_all
// + is_admin()). Cartões-resumo: perfis, cartas, processos e comissões por estado.
// exigirPapel("admin") barra qualquer outro papel (cliente/parceiro → home).
import { createClient } from "@/lib/supabase-server";
import { exigirPapel } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatGrid, type Stat } from "@/components/StatGrid";
import { Button } from "@/components/ui/Button";
import styles from "@/components/area.module.css";

export const dynamic = "force-dynamic";

export default async function AdminPainel() {
  const sessao = await exigirPapel("admin");
  const supabase = createClient();

  const [profiles, cartas, processos, comissoes] = await Promise.all([
    supabase.from("profiles").select("tipo, status"),
    supabase.from("cartas").select("status"),
    supabase.from("processos").select("status"),
    supabase.from("comissoes").select("status"),
  ]);

  const perfis = profiles.data ?? [];
  const listaCartas = cartas.data ?? [];
  const listaProc = processos.data ?? [];
  const listaCom = comissoes.data ?? [];

  const parceiros = perfis.filter((p) => p.tipo === "parceiro").length;
  const parceirosPendentes = perfis.filter(
    (p) => p.tipo === "parceiro" && p.status === "pendente_aprovacao"
  ).length;
  const clientes = perfis.filter((p) => p.tipo === "cliente").length;

  const cartasDisp = listaCartas.filter((c) => c.status === "disponivel").length;
  const procAtivos = listaProc.filter(
    (p) => p.status !== "concluido" && p.status !== "cancelado"
  ).length;
  const comPrev = listaCom.filter((c) => c.status === "prevista").length;

  const stats: Stat[] = [
    { label: "Parceiros", value: parceiros, hint: `${parceirosPendentes} pendentes` },
    { label: "Clientes", value: clientes },
    { label: "Cartas", value: listaCartas.length, hint: `${cartasDisp} disponíveis` },
    { label: "Processos ativos", value: procAtivos, hint: `${listaProc.length} no total` },
    { label: "Comissões previstas", value: comPrev },
  ];

  return (
    <AppShell nome={sessao.nome} tipo={sessao.perfil?.tipo}>
      <PageHeader
        title="Administração"
        subtitle="Visão geral da operação: parceiros, cartas, processos e comissões."
      />

      <div className={styles.stack}>
        <StatGrid stats={stats} />

        <nav className={styles.filtros} aria-label="Seções da administração">
          <Button href="/admin/parceiros" variant="ghost" size="sm">Parceiros</Button>
          <Button href="/admin/processos" variant="ghost" size="sm">Processos</Button>
          <Button href="/admin/cartas" variant="ghost" size="sm">Cartas</Button>
          <Button href="/admin/comissoes" variant="ghost" size="sm">Comissões</Button>
        </nav>
      </div>
    </AppShell>
  );
}
