// /admin/conversas/site/[id] — thread somente leitura de mensagens (chat do
// site) + ações Assumir/Devolver. Mesmo gate/dados do resto de /admin/conversas.
import { notFound } from "next/navigation";
import { exigirAdminConsolePagina } from "@/lib/admin-console";
import { createXtvClient } from "@/lib/supabase-xtv";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ConversaAcoes } from "../../ConversaAcoes";
import styles from "../../conversas.module.css";

export const dynamic = "force-dynamic";

function dataHora(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// papel: 'cliente' | 'agente' | 'sistema'.
function bolhaClasse(papel: string): string {
  if (papel === "cliente") return styles.cliente;
  if (papel === "sistema") return styles.sistema;
  return styles.agente;
}

export default async function AdminConversaSite({
  params,
}: {
  params: { id: string };
}) {
  const { nome } = await exigirAdminConsolePagina();
  const supabase = createXtvClient();

  const { data: conversa } = await supabase
    .from("conversas")
    .select("id, interesse_id, canal, agente_atual, status")
    .eq("id", params.id)
    .maybeSingle();

  if (!conversa) notFound();

  const [{ data: interesse }, { data: mensagens }] = await Promise.all([
    conversa.interesse_id
      ? supabase
          .from("interesses")
          .select("nome, telefone")
          .eq("id", conversa.interesse_id)
          .maybeSingle()
      : Promise.resolve({ data: null as { nome: string; telefone: string } | null }),
    supabase
      .from("mensagens")
      .select("id, papel, conteudo, agente, criado_em")
      .eq("conversa_id", conversa.id)
      .order("criado_em", { ascending: true }),
  ]);

  return (
    <AppShell nome={nome} equipeAdminConsole>
      <PageHeader
        title={interesse?.nome ?? interesse?.telefone ?? "Lead sem nome"}
        subtitle="Canal Site — thread completa, somente leitura."
        backHref="/admin/conversas"
        backLabel="Conversas"
      />

      <Card>
        <div className={styles.header}>
          <div className={styles.info}>
            <span className={styles.nomeLead}>{interesse?.telefone ?? "—"}</span>
            <span className={styles.meta}>Agente atual: {conversa.agente_atual ?? "—"}</span>
          </div>
          <Badge tone={conversa.status === "humano" ? "amber" : "ok"}>
            {conversa.status === "humano" ? "Precisa de atenção" : conversa.status}
          </Badge>
        </div>
        <ConversaAcoes canal="site" conversaId={conversa.id} status={conversa.status} />
      </Card>

      <ul className={styles.thread}>
        {(mensagens ?? []).map((m) => (
          <li key={m.id} className={`${styles.bolha} ${bolhaClasse(m.papel as string)}`}>
            {m.conteudo}
            <span className={styles.bolhaMeta}>
              {m.papel}
              {m.agente ? ` · ${m.agente}` : ""} · {dataHora(m.criado_em as string)}
            </span>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
