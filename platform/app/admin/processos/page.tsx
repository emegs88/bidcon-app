// /admin/processos — todos os processos (admin enxerga tudo via RLS).
// Filtro por status via ?status=. Cada linha leva ao detalhe (Timeline + ações).
// Evitamos joins implícitos (processos→profiles tem 2 FKs): buscamos os nomes
// de cliente num segundo SELECT e montamos um mapa.
import { createClient } from "@/lib/supabase-server";
import { exigirPapel } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { ProcessoRow, type ProcessoResumo } from "@/components/ProcessoRow";
import { ORDEM_STATUS, LABEL_STATUS, type StatusProcesso } from "@/lib/status";
import styles from "@/components/area.module.css";

export const dynamic = "force-dynamic";

const STATUS: StatusProcesso[] = [...ORDEM_STATUS, "cancelado"];

export default async function AdminProcessos({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const sessao = await exigirPapel("admin");
  const supabase = createClient();

  const filtro = STATUS.includes(searchParams.status as StatusProcesso)
    ? (searchParams.status as StatusProcesso)
    : null;

  let query = supabase
    .from("processos")
    .select("id, status, valor_carta, cliente_id, carta_id")
    .order("atualizado_em", { ascending: false });
  if (filtro) query = query.eq("status", filtro);

  const { data } = await query;
  const lista = data ?? [];

  // Nomes dos clientes e tipo das cartas (mapas auxiliares).
  const clienteIds = [...new Set(lista.map((p) => p.cliente_id).filter(Boolean))];
  const cartaIds = [...new Set(lista.map((p) => p.carta_id).filter(Boolean))];

  const [clientesRes, cartasRes] = await Promise.all([
    clienteIds.length
      ? supabase.from("profiles").select("id, nome, email").in("id", clienteIds)
      : Promise.resolve({ data: [] as { id: string; nome: string | null; email: string | null }[] }),
    cartaIds.length
      ? supabase.from("cartas").select("id, tipo").in("id", cartaIds)
      : Promise.resolve({ data: [] as { id: string; tipo: string }[] }),
  ]);

  const nomeCliente = new Map(
    (clientesRes.data ?? []).map((c) => [c.id, c.nome ?? c.email ?? "Cliente"])
  );
  const tipoCarta = new Map((cartasRes.data ?? []).map((c) => [c.id, c.tipo]));

  return (
    <AppShell nome={sessao.nome} tipo={sessao.perfil?.tipo}>
      <PageHeader
        title="Processos"
        backHref="/admin"
        backLabel="Administração"
        subtitle="Acompanhe e avance o status dos processos. Cada mudança registra a trilha de eventos."
      />

      <nav className={styles.filtros} aria-label="Filtrar por status">
        <Button href="/admin/processos" variant={!filtro ? "primary" : "ghost"} size="sm">
          Todos
        </Button>
        {STATUS.map((s) => (
          <Button
            key={s}
            href={`/admin/processos?status=${s}`}
            variant={filtro === s ? "primary" : "ghost"}
            size="sm"
          >
            {LABEL_STATUS[s]}
          </Button>
        ))}
      </nav>

      {lista.length === 0 ? (
        <EmptyState
          icon="📁"
          title="Nenhum processo nesta visão"
          description="Os processos aparecerão aqui conforme forem criados."
        />
      ) : (
        <ul className={styles.list}>
          {lista.map((p) => {
            const resumo: ProcessoResumo = {
              id: p.id,
              status: p.status as StatusProcesso,
              valor_carta: p.valor_carta,
              cliente_nome: p.cliente_id ? nomeCliente.get(p.cliente_id) : null,
              carta_tipo: p.carta_id ? tipoCarta.get(p.carta_id) : null,
            };
            return (
              <ProcessoRow
                key={p.id}
                processo={resumo}
                href={`/admin/processos/${p.id}`}
              />
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
