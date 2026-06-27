// /parceiro — painel do parceiro. Server Component.
// Lê via RLS (parceiro só enxerga o que é dele: policies 0002). Mostra
// cartões-resumo (cartas por status, processos ativos, comissões previstas/
// liberadas) e atalhos. exigirPapel garante que só parceiro/admin entram.
import { createClient } from "@/lib/supabase-server";
import { exigirPapel } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatGrid, type Stat } from "@/components/StatGrid";
import { Button } from "@/components/ui/Button";
import { brl } from "@/lib/format";
import styles from "@/components/area.module.css";

export const dynamic = "force-dynamic";

export default async function ParceiroPainel() {
  const sessao = await exigirPapel("parceiro", "admin");
  const supabase = createClient();
  const uid = sessao.userId;

  // RLS filtra para o próprio parceiro; ainda assim filtramos por parceiro_id
  // explicitamente (admin enxergaria tudo sem isto).
  const [cartas, processos, comissoes] = await Promise.all([
    supabase.from("cartas").select("status").eq("parceiro_id", uid),
    supabase.from("processos").select("status").eq("parceiro_id", uid),
    supabase.from("comissoes").select("status, valor_comissao").eq("parceiro_id", uid),
  ]);

  const listaCartas = cartas.data ?? [];
  const listaProc = processos.data ?? [];
  const listaCom = comissoes.data ?? [];

  const cartasDisp = listaCartas.filter((c) => c.status === "disponivel").length;
  const procAtivos = listaProc.filter(
    (p) => p.status !== "concluido" && p.status !== "cancelado"
  ).length;
  const comPrev = listaCom.filter((c) => c.status === "prevista").length;
  const comLib = listaCom.filter(
    (c) => c.status === "liberada" || c.status === "paga"
  ).length;

  const stats: Stat[] = [
    { label: "Cartas na carteira", value: listaCartas.length, hint: `${cartasDisp} disponíveis` },
    { label: "Processos ativos", value: procAtivos, hint: `${listaProc.length} no total` },
    { label: "Comissões previstas", value: comPrev },
    { label: "Comissões liberadas", value: comLib },
  ];

  return (
    <AppShell nome={sessao.nome} tipo={sessao.perfil?.tipo}>
      <PageHeader
        title="Painel do parceiro"
        subtitle="Resumo da sua carteira, processos e comissões. Os números refletem apenas o que é seu."
        action={<Button href="/parceiro/carteira/nova" size="sm">Cadastrar carta</Button>}
      />

      <div className={styles.stack}>
        <StatGrid stats={stats} />

        <div className={styles.filtros}>
          <Button href="/parceiro/carteira" variant="ghost" size="sm">Minha carteira</Button>
          <Button href="/parceiro/indicacoes" variant="ghost" size="sm">Indicações</Button>
          <Button href="/parceiro/comissoes" variant="ghost" size="sm">Comissões</Button>
        </div>

        <p className={styles.count}>
          Total estimado em comissões previstas:{" "}
          {brl(
            listaCom
              .filter((c) => c.status === "prevista")
              .reduce((s, c) => s + (c.valor_comissao ?? 0), 0)
          )}
          . Liberação e pagamento são feitos pela administração.
        </p>
      </div>
    </AppShell>
  );
}
