// /parceiro/comissoes — comissões do parceiro (RLS: SELECT-only para o dono).
// Somente LEITURA: liberar/pagar é ação de admin (RPCs liberar_comissao /
// marcar_comissao_paga, 0006). Aqui o parceiro apenas acompanha o status.
// A plataforma NÃO guarda dado bancário — só rastreia o estado da comissão.
import { createClient } from "@/lib/supabase-server";
import { exigirPapel } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatGrid, type Stat } from "@/components/StatGrid";
import {
  LABEL_STATUS_COMISSAO,
  TONE_STATUS_COMISSAO,
  type StatusComissao,
} from "@/lib/status";
import { brl, dataBR } from "@/lib/format";
import styles from "@/components/area.module.css";
import row from "@/components/ProcessoRow.module.css";

export const dynamic = "force-dynamic";

export default async function ComissoesParceiro() {
  const sessao = await exigirPapel("parceiro", "admin");
  const supabase = createClient();

  const { data } = await supabase
    .from("comissoes")
    .select("id, percentual, valor_base, valor_comissao, status, liberada_em")
    .eq("parceiro_id", sessao.userId);

  const lista = data ?? [];

  // Totais por status (apenas o que existir; sem inventar números).
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
        backHref="/parceiro"
        backLabel="Painel"
        subtitle="Acompanhe o status das suas comissões. A liberação é feita pela equipe Bidcon."
      />

      <div className={styles.stack}>
        <StatGrid stats={stats} />

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Detalhamento</h2>
            <span className={styles.count}>{lista.length} no total</span>
          </div>

          {lista.length === 0 ? (
            <EmptyState
              icon="📄"
              title="Nenhuma comissão registrada"
              description="As comissões vinculadas aos seus processos aparecerão aqui."
            />
          ) : (
            <ul className={styles.list}>
              {lista.map((c) => (
                <Card key={c.id} as="li">
                  <div className={row.row}>
                    <div className={row.info}>
                      <span className={row.cliente}>{brl(c.valor_comissao)}</span>
                      <span className={row.meta}>
                        {c.percentual != null ? `${c.percentual}%` : "—"}
                        {c.valor_base != null ? ` sobre ${brl(c.valor_base)}` : ""}
                        {c.liberada_em ? ` · liberada em ${dataBR(c.liberada_em)}` : ""}
                      </span>
                    </div>
                    <Badge tone={TONE_STATUS_COMISSAO[c.status as StatusComissao]}>
                      {LABEL_STATUS_COMISSAO[c.status as StatusComissao] ?? c.status}
                    </Badge>
                  </div>
                </Card>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
