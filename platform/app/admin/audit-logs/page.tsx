// /admin/audit-logs — trilha de auditoria do KYC (tabela kyc_eventos).
// Mostra QUEM fez O QUÊ e QUANDO: envio do cliente e decisões do admin
// (verificado/rejeitado/bloqueado). Leitura por RLS (kyc_eventos_admin_select:
// só admin lê). Filtros: Ação (todas/enviado/verificado/rejeitado/bloqueado) e
// Período (7/30/90 dias). Nada sensível aqui — sem CPF, sem arquivos; o
// "detalhe" é o motivo registrado pelo admin, que já passou por compliance.
import { createClient } from "@/lib/supabase-server";
import { exigirPapel } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import styles from "@/components/area.module.css";
import det from "./audit.module.css";

export const dynamic = "force-dynamic";

// Rótulo + tom do Badge por tipo de evento.
const EVENTO_INFO: Record<
  string,
  { label: string; tone: "info" | "ok" | "amber" | "muted" }
> = {
  kyc_enviado: { label: "Verificação enviada", tone: "info" },
  kyc_verificado: { label: "Verificado", tone: "ok" },
  kyc_rejeitado: { label: "Rejeitado", tone: "amber" },
  kyc_bloqueado: { label: "Bloqueado", tone: "muted" },
  perfil_atualizado: { label: "Perfil atualizado", tone: "info" },
};

type Acao = "todas" | "kyc_enviado" | "kyc_verificado" | "kyc_rejeitado" | "kyc_bloqueado";

const ACOES: { chave: Acao; label: string }[] = [
  { chave: "todas", label: "Todas" },
  { chave: "kyc_enviado", label: "Enviadas" },
  { chave: "kyc_verificado", label: "Verificadas" },
  { chave: "kyc_rejeitado", label: "Rejeitadas" },
  { chave: "kyc_bloqueado", label: "Bloqueadas" },
];

const PERIODOS: { chave: string; label: string; dias: number }[] = [
  { chave: "7", label: "7 dias", dias: 7 },
  { chave: "30", label: "30 dias", dias: 30 },
  { chave: "90", label: "90 dias", dias: 90 },
];

// Data/hora pt-BR para a trilha (precisamos de hora, não só dia).
function dataHora(v: string): string {
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

export default async function AdminAuditLogs({
  searchParams,
}: {
  searchParams: { acao?: string; periodo?: string };
}) {
  const sessao = await exigirPapel("admin");
  const supabase = createClient();

  const acaoAtual: Acao =
    (ACOES.find((a) => a.chave === searchParams.acao)?.chave as Acao) ?? "todas";
  const periodoAtual =
    PERIODOS.find((p) => p.chave === searchParams.periodo)?.chave ?? "30";
  const dias = PERIODOS.find((p) => p.chave === periodoAtual)?.dias ?? 30;

  const desde = new Date();
  desde.setDate(desde.getDate() - dias);

  let q = supabase
    .from("kyc_eventos")
    .select("id, user_id, ator_id, evento, detalhe, em")
    .gte("em", desde.toISOString())
    .order("em", { ascending: false })
    .limit(200);

  if (acaoAtual !== "todas") q = q.eq("evento", acaoAtual);

  const { data: eventos } = await q;

  // Resolve nomes/e-mails dos envolvidos (sujeito e ator) em uma só consulta.
  const ids = Array.from(
    new Set(
      (eventos ?? []).flatMap((e) =>
        [e.user_id, e.ator_id].filter((x): x is string => Boolean(x))
      )
    )
  );

  const mapaNome = new Map<string, string>();
  if (ids.length > 0) {
    const { data: perfis } = await supabase
      .from("profiles")
      .select("id, nome, email")
      .in("id", ids);
    for (const p of perfis ?? []) {
      mapaNome.set(p.id, p.nome ?? p.email ?? "—");
    }
  }

  const lista = eventos ?? [];

  return (
    <AppShell nome={sessao.nome} tipo={sessao.perfil?.tipo}>
      <PageHeader
        title="Auditoria"
        backHref="/admin"
        backLabel="Administração"
        subtitle="Trilha de eventos de verificação (KYC): envios dos clientes e decisões da equipe."
      />

      <div className={styles.stack}>
        <div className={styles.filtros}>
          {ACOES.map((a) => (
            <Button
              key={a.chave}
              href={`/admin/audit-logs?acao=${a.chave}&periodo=${periodoAtual}`}
              variant={a.chave === acaoAtual ? "primary" : "ghost"}
              size="sm"
            >
              {a.label}
            </Button>
          ))}
        </div>
        <div className={styles.filtros}>
          {PERIODOS.map((p) => (
            <Button
              key={p.chave}
              href={`/admin/audit-logs?acao=${acaoAtual}&periodo=${p.chave}`}
              variant={p.chave === periodoAtual ? "primary" : "ghost"}
              size="sm"
            >
              {p.label}
            </Button>
          ))}
        </div>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Eventos</h2>
            <span className={styles.count}>
              {lista.length} {lista.length === 1 ? "registro" : "registros"} · últimos {dias} dias
            </span>
          </div>

          {lista.length === 0 ? (
            <EmptyState
              icon="📋"
              title="Nenhum evento no período"
              description="Ajuste o filtro de ação ou amplie o período para ver registros anteriores."
            />
          ) : (
            <ul className={styles.list}>
              {lista.map((e) => {
                const info =
                  EVENTO_INFO[e.evento] ?? { label: e.evento, tone: "info" as const };
                const sujeito = mapaNome.get(e.user_id) ?? "—";
                const ator = e.ator_id ? mapaNome.get(e.ator_id) ?? "—" : null;
                return (
                  <Card key={e.id} as="li">
                    <div className={det.row}>
                      <div className={det.info}>
                        <div className={det.linha1}>
                          <Badge tone={info.tone}>{info.label}</Badge>
                          <span className={det.sujeito}>{sujeito}</span>
                        </div>
                        <span className={det.meta}>
                          {ator ? `por ${ator} · ` : ""}
                          {dataHora(e.em)}
                        </span>
                        {e.detalhe && (
                          <span className={det.detalhe}>Motivo: {e.detalhe}</span>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
