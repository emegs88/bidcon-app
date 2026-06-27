// /parceiro/carteira — lista as cartas do parceiro (RLS: parceiro_id = uid).
// Filtro por status via ?status=. Cada carta leva ao detalhe com ação de status.
import { createClient } from "@/lib/supabase-server";
import { exigirPapel } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
  LABEL_TIPO_BEM,
  LABEL_STATUS_CARTA,
  TONE_STATUS_CARTA,
  type StatusCarta,
} from "@/lib/status";
import { brl } from "@/lib/format";
import styles from "@/components/area.module.css";
import row from "@/components/ProcessoRow.module.css";

export const dynamic = "force-dynamic";

const STATUS: StatusCarta[] = ["disponivel", "reservada", "vendida", "indisponivel"];

export default async function CarteiraParceiro({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const sessao = await exigirPapel("parceiro", "admin");
  const supabase = createClient();

  const filtro = STATUS.includes(searchParams.status as StatusCarta)
    ? (searchParams.status as StatusCarta)
    : null;

  let query = supabase
    .from("cartas")
    .select("id, tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas, status")
    .eq("parceiro_id", sessao.userId)
    .order("criado_em", { ascending: false });
  if (filtro) query = query.eq("status", filtro);

  const { data } = await query;
  const lista = data ?? [];

  return (
    <AppShell nome={sessao.nome} tipo={sessao.perfil?.tipo}>
      <PageHeader
        title="Minha carteira"
        backHref="/parceiro"
        backLabel="Painel"
        subtitle="As cartas cadastradas por você. O estoque Bidcon (sincronizado) não aparece aqui."
        action={<Button href="/parceiro/carteira/nova" size="sm">Cadastrar carta</Button>}
      />

      <nav className={styles.filtros} aria-label="Filtrar por status">
        <Button href="/parceiro/carteira" variant={!filtro ? "primary" : "ghost"} size="sm">
          Todas
        </Button>
        {STATUS.map((s) => (
          <Button
            key={s}
            href={`/parceiro/carteira?status=${s}`}
            variant={filtro === s ? "primary" : "ghost"}
            size="sm"
          >
            {LABEL_STATUS_CARTA[s]}
          </Button>
        ))}
      </nav>

      {lista.length === 0 ? (
        <EmptyState
          icon="🗂️"
          title="Nenhuma carta nesta visão"
          description="Cadastre uma carta da sua carteira para acompanhá-la por aqui."
          action={<Button href="/parceiro/carteira/nova">Cadastrar carta</Button>}
        />
      ) : (
        <ul className={styles.list}>
          {lista.map((c) => (
            <Card key={c.id} href={`/parceiro/carteira/${c.id}`}>
              <div className={row.row}>
                <div className={row.info}>
                  <span className={row.cliente}>{brl(c.valor_credito)}</span>
                  <span className={row.meta}>
                    {LABEL_TIPO_BEM[c.tipo] ?? c.tipo}
                    {c.valor_entrada != null ? ` · entrada ${brl(c.valor_entrada)}` : ""}
                    {c.qtd_parcelas != null ? ` · ${c.qtd_parcelas}x` : ""}
                  </span>
                </div>
                <Badge tone={TONE_STATUS_CARTA[c.status as StatusCarta]}>
                  {LABEL_STATUS_CARTA[c.status as StatusCarta] ?? c.status}
                </Badge>
              </div>
            </Card>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
