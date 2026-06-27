// /parceiro/indicacoes — indicações do parceiro (RLS: parceiro_id = uid).
// Inclui um bloco "seu link de indicação" que apenas EXIBE o código/origem;
// o fluxo de cadastro de novas indicações não faz parte desta fase.
import { createClient } from "@/lib/supabase-server";
import { exigirPapel } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { dataBR } from "@/lib/format";
import styles from "@/components/area.module.css";
import row from "@/components/ProcessoRow.module.css";

export const dynamic = "force-dynamic";

export default async function IndicacoesParceiro() {
  const sessao = await exigirPapel("parceiro", "admin");
  const supabase = createClient();

  const { data } = await supabase
    .from("indicacoes")
    .select("id, origem, criado_em, cliente_id")
    .eq("parceiro_id", sessao.userId)
    .order("criado_em", { ascending: false });

  const lista = data ?? [];

  return (
    <AppShell nome={sessao.nome} tipo={sessao.perfil?.tipo}>
      <PageHeader
        title="Indicações"
        backHref="/parceiro"
        backLabel="Painel"
        subtitle="Acompanhe as indicações vinculadas ao seu cadastro."
      />

      <div className={styles.stack}>
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Seu identificador</h2>
          </div>
          <Card as="div">
            <p className={row.cliente}>{sessao.perfil?.id ?? "—"}</p>
            <p className={row.meta}>
              Informe este identificador à equipe Bidcon para vincular novas
              indicações ao seu cadastro.
            </p>
          </Card>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Histórico</h2>
            <span className={styles.count}>{lista.length} no total</span>
          </div>

          {lista.length === 0 ? (
            <EmptyState
              icon="🤝"
              title="Nenhuma indicação ainda"
              description="As indicações vinculadas a você aparecerão aqui."
            />
          ) : (
            <ul className={styles.list}>
              {lista.map((i) => (
                <Card key={i.id} as="li">
                  <div className={row.row}>
                    <div className={row.info}>
                      <span className={row.cliente}>
                        {i.origem ?? "Indicação"}
                      </span>
                      <span className={row.meta}>
                        {i.cliente_id ? "Cliente vinculado" : "Aguardando vínculo"}
                      </span>
                    </div>
                    <span className={row.meta}>{dataBR(i.criado_em)}</span>
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
