// /admin/conversas/leads — lista somente leitura de `interesses` (captura de
// leads da vitrine/chat). Sem escrita nesta fatia (CRM-01 é só leitura +
// Assumir/Devolver nas conversas). Filtro por status via querystring.
import { exigirAdminConsolePagina } from "@/lib/admin-console";
import { createXtvClient } from "@/lib/supabase-xtv";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConversasSubNav } from "../ConversasSubNav";
import areaStyles from "@/components/area.module.css";
import styles from "../conversas.module.css";

export const dynamic = "force-dynamic";

const STATUS = ["novo", "em_atendimento", "convertido", "descartado"] as const;
type StatusInteresse = (typeof STATUS)[number];

const LABEL_STATUS: Record<StatusInteresse, string> = {
  novo: "Novo",
  em_atendimento: "Em atendimento",
  convertido: "Convertido",
  descartado: "Descartado",
};

const TONE_STATUS: Record<StatusInteresse, "ok" | "amber" | "muted" | "info"> = {
  novo: "info",
  em_atendimento: "amber",
  convertido: "ok",
  descartado: "muted",
};

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

export default async function AdminConversasLeads({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const { nome } = await exigirAdminConsolePagina();
  const supabase = createXtvClient();

  const filtro = STATUS.includes(searchParams.status as StatusInteresse)
    ? (searchParams.status as StatusInteresse)
    : null;

  let query = supabase
    .from("interesses")
    .select("id, nome, telefone, origem, intencao, status, carta_id, criado_em")
    .order("criado_em", { ascending: false })
    .limit(200);
  if (filtro) query = query.eq("status", filtro);

  const { data } = await query;
  const lista = data ?? [];

  return (
    <AppShell nome={nome} equipeAdminConsole>
      <PageHeader
        title="Leads"
        subtitle="Interesses capturados na vitrine e no chat. Somente leitura nesta fatia."
      />
      <ConversasSubNav />

      <nav className={areaStyles.filtros} aria-label="Filtrar por status">
        <Button href="/admin/conversas/leads" variant={!filtro ? "primary" : "ghost"} size="sm">
          Todos
        </Button>
        {STATUS.map((s) => (
          <Button
            key={s}
            href={`/admin/conversas/leads?status=${s}`}
            variant={filtro === s ? "primary" : "ghost"}
            size="sm"
          >
            {LABEL_STATUS[s]}
          </Button>
        ))}
      </nav>

      {lista.length === 0 ? (
        <EmptyState icon="🧲" title="Nenhum lead nesta visão" description="Os leads aparecerão aqui conforme forem capturados." />
      ) : (
        <ul className={areaStyles.list}>
          {lista.map((l) => (
            <Card key={l.id} as="li">
              <div className={styles.row}>
                <div className={styles.info}>
                  <div className={styles.linha1}>
                    <span className={styles.nomeLead}>{l.nome}</span>
                    {l.carta_id && <Badge tone="info">carta vinculada</Badge>}
                  </div>
                  <span className={styles.meta}>
                    {l.telefone} · origem {l.origem ?? "—"} · {l.intencao} · captado em{" "}
                    {dataHora(l.criado_em)}
                  </span>
                </div>
                <Badge tone={TONE_STATUS[l.status as StatusInteresse] ?? "muted"}>
                  {LABEL_STATUS[l.status as StatusInteresse] ?? l.status}
                </Badge>
              </div>
            </Card>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
