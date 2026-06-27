// /admin/parceiros — lista os parceiros e permite aprovar/suspender.
// Leitura via RLS (admin enxerga todos os profiles). A ação de status é feita
// pelo Route Handler /api/admin/parceiros/[id]/status (service_role + guard).
import { createClient } from "@/lib/supabase-server";
import { exigirPapel } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
  LABEL_STATUS_PERFIL,
  TONE_STATUS_PERFIL,
  type StatusPerfilLabel,
} from "@/lib/status";
import { dataBR } from "@/lib/format";
import { ParceiroAcoes } from "./ParceiroAcoes";
import styles from "@/components/area.module.css";
import row from "@/components/ProcessoRow.module.css";

export const dynamic = "force-dynamic";

export default async function AdminParceiros() {
  const sessao = await exigirPapel("admin");
  const supabase = createClient();

  const { data } = await supabase
    .from("profiles")
    .select("id, nome, email, status, criado_em")
    .eq("tipo", "parceiro")
    .order("criado_em", { ascending: false });

  const lista = data ?? [];
  const pendentes = lista.filter((p) => p.status === "pendente_aprovacao").length;

  return (
    <AppShell nome={sessao.nome} tipo={sessao.perfil?.tipo}>
      <PageHeader
        title="Parceiros"
        backHref="/admin"
        backLabel="Administração"
        subtitle="Aprove novos parceiros e gerencie o acesso dos existentes."
      />

      <div className={styles.stack}>
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Cadastros</h2>
            <span className={styles.count}>
              {lista.length} no total · {pendentes} pendentes
            </span>
          </div>

          {lista.length === 0 ? (
            <EmptyState
              icon="👥"
              title="Nenhum parceiro cadastrado"
              description="Os parceiros aparecerão aqui assim que se cadastrarem."
            />
          ) : (
            <ul className={styles.list}>
              {lista.map((p) => (
                <Card key={p.id} as="li">
                  <div className={row.row}>
                    <div className={row.info}>
                      <span className={row.cliente}>{p.nome ?? p.email ?? "Parceiro"}</span>
                      <span className={row.meta}>
                        {p.email ?? "sem e-mail"} · desde {dataBR(p.criado_em)}
                      </span>
                      <Badge tone={TONE_STATUS_PERFIL[p.status as StatusPerfilLabel]}>
                        {LABEL_STATUS_PERFIL[p.status as StatusPerfilLabel] ?? p.status}
                      </Badge>
                    </div>
                    <ParceiroAcoes
                      parceiroId={p.id}
                      status={p.status as StatusPerfilLabel}
                    />
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
