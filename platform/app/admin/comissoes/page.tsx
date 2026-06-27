// /admin/comissoes — todas as comissões (admin via RLS). Filtro por status.
// Liberar/pagar via RPC (0006). A plataforma NÃO guarda dado bancário: só
// rastreia o estado (prevista → liberada → paga).
import { createClient } from "@/lib/supabase-server";
import { exigirPapel } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatGrid, type Stat } from "@/components/StatGrid";
import {
  LABEL_STATUS_COMISSAO,
  TONE_STATUS_COMISSAO,
  type StatusComissao,
} from "@/lib/status";
import { brl, dataBR } from "@/lib/format";
import { ComissaoAcoes } from "./ComissaoAcoes";
import styles from "@/components/area.module.css";
import row from "@/components/ProcessoRow.module.css";

export const dynamic = "force-dynamic";

const STATUS: StatusComissao[] = ["prevista", "liberada", "paga", "cancelada"];

export default async function AdminComissoes({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const sessao = await exigirPapel("admin");
  const supabase = createClient();

  const filtro = STATUS.includes(searchParams.status as StatusComissao)
    ? (searchParams.status as StatusComissao)
    : null;

  let query = supabase
    .from("comissoes")
    .select("id, parceiro_id, percentual, valor_base, valor_comissao, status, liberada_em");
  if (filtro) query = query.eq("status", filtro);

  const { data } = await query;
  const lista = data ?? [];

  // Nomes dos parceiros (mapa auxiliar).
  const parceiroIds = [...new Set(lista.map((c) => c.parceiro_id).filter(Boolean))];
  const { data: parceiros } = parceiroIds.length
    ? await supabase.from("profiles").select("id, nome, email").in("id", parceiroIds)
    : { data: [] as { id: string; nome: string | null; email: string | null }[] };
  const nomeParceiro = new Map(
    (parceiros ?? []).map((p) => [p.id, p.nome ?? p.email ?? "Parceiro"]),
  );

  const soma = (st: StatusComissao) =>
    lista
      .filter((c) => c.status === st)
      .reduce((acc, c) => acc + (c.valor_comissao ?? 0), 0);

  const stats: Stat[] = [
    { label: "Previstas", value: brl(soma("prevista")) },
    { label: "Liberadas", value: brl(soma("liberada")) },
    { label: "Pagas", value: brl(soma("paga")) },
  ];

  return (
    <AppShell nome={sessao.nome} tipo={sessao.perfil?.tipo}>
      <PageHeader
        title="Comissões"
        backHref="/admin"
        backLabel="Administração"
        subtitle="Libere e marque comissões como pagas. Cada ação é registrada com data."
      />

      <div className={styles.stack}>
        <StatGrid stats={stats} />

        <nav className={styles.filtros} aria-label="Filtrar por status">
          <Button href="/admin/comissoes" variant={!filtro ? "primary" : "ghost"} size="sm">
            Todas
          </Button>
          {STATUS.map((s) => (
            <Button
              key={s}
              href={`/admin/comissoes?status=${s}`}
              variant={filtro === s ? "primary" : "ghost"}
              size="sm"
            >
              {LABEL_STATUS_COMISSAO[s]}
            </Button>
          ))}
        </nav>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Detalhamento</h2>
            <span className={styles.count}>{lista.length} no total</span>
          </div>

          {lista.length === 0 ? (
            <EmptyState
              icon="📄"
              title="Nenhuma comissão nesta visão"
              description="As comissões vinculadas aos processos aparecerão aqui."
            />
          ) : (
            <ul className={styles.list}>
              {lista.map((c) => (
                <Card key={c.id} as="li">
                  <div className={row.row}>
                    <div className={row.info}>
                      <span className={row.cliente}>{brl(c.valor_comissao)}</span>
                      <span className={row.meta}>
                        {c.parceiro_id ? nomeParceiro.get(c.parceiro_id) : "—"}
                        {c.percentual != null ? ` · ${c.percentual}%` : ""}
                        {c.valor_base != null ? ` sobre ${brl(c.valor_base)}` : ""}
                        {c.liberada_em ? ` · liberada em ${dataBR(c.liberada_em)}` : ""}
                      </span>
                    </div>
                    <Badge tone={TONE_STATUS_COMISSAO[c.status as StatusComissao]}>
                      {LABEL_STATUS_COMISSAO[c.status as StatusComissao] ?? c.status}
                    </Badge>
                  </div>
                  <ComissaoAcoes
                    comissaoId={c.id}
                    status={c.status as StatusComissao}
                  />
                </Card>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
