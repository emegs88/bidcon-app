// /admin/cartas — estoque global (todas as cartas: Bidcon + parceiros).
// Filtros por tipo (?tipo=) e status (?status=). Ação de status inline via RPC.
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
import { CartaAcoes } from "./CartaAcoes";
import { CartaVinculo, type Opcao } from "./CartaVinculo";
import styles from "@/components/area.module.css";
import row from "@/components/ProcessoRow.module.css";

export const dynamic = "force-dynamic";

const STATUS: StatusCarta[] = ["disponivel", "reservada", "vendida", "indisponivel"];
const TIPOS = ["imovel", "veiculo"] as const;
type Tipo = (typeof TIPOS)[number];

export default async function AdminCartas({
  searchParams,
}: {
  searchParams: { status?: string; tipo?: string };
}) {
  const sessao = await exigirPapel("admin");
  const supabase = createClient();

  const filtroStatus = STATUS.includes(searchParams.status as StatusCarta)
    ? (searchParams.status as StatusCarta)
    : null;
  const filtroTipo = TIPOS.includes(searchParams.tipo as Tipo)
    ? (searchParams.tipo as Tipo)
    : null;

  let query = supabase
    .from("cartas")
    .select(
      "id, tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas, status, parceiro_id, administradora_id, fornecedor_id, fonte, comissao_percentual",
    )
    .order("criado_em", { ascending: false });
  if (filtroStatus) query = query.eq("status", filtroStatus);
  if (filtroTipo) query = query.eq("tipo", filtroTipo);

  const { data } = await query;
  const lista = data ?? [];

  // Opções de vínculo (admin enxerga ambas as tabelas por RLS).
  // fornecedores: leitura só-admin (RLS de 0011) — esta página é exigirPapel("admin").
  const [{ data: admins }, { data: forns }] = await Promise.all([
    supabase.from("administradoras").select("id, nome").eq("ativo", true).order("nome"),
    supabase.from("fornecedores").select("id, nome").eq("ativo", true).order("nome"),
  ]);
  const administradoras = (admins ?? []) as Opcao[];
  const fornecedores = (forns ?? []) as Opcao[];

  function comFiltros(extra: { status?: string | null; tipo?: string | null }) {
    const sp = new URLSearchParams();
    const st = extra.status !== undefined ? extra.status : filtroStatus;
    const tp = extra.tipo !== undefined ? extra.tipo : filtroTipo;
    if (st) sp.set("status", st);
    if (tp) sp.set("tipo", tp);
    const qs = sp.toString();
    return qs ? `/admin/cartas?${qs}` : "/admin/cartas";
  }

  return (
    <AppShell nome={sessao.nome} tipo={sessao.perfil?.tipo}>
      <PageHeader
        title="Estoque de cartas"
        backHref="/admin"
        backLabel="Administração"
        subtitle="Todas as cartas da plataforma. Ajuste a disponibilidade quando necessário."
      />

      <nav className={styles.filtros} aria-label="Filtrar por tipo">
        <Button href={comFiltros({ tipo: null })} variant={!filtroTipo ? "primary" : "ghost"} size="sm">
          Todos os tipos
        </Button>
        {TIPOS.map((t) => (
          <Button
            key={t}
            href={comFiltros({ tipo: t })}
            variant={filtroTipo === t ? "primary" : "ghost"}
            size="sm"
          >
            {LABEL_TIPO_BEM[t]}
          </Button>
        ))}
      </nav>

      <nav className={styles.filtros} aria-label="Filtrar por status">
        <Button href={comFiltros({ status: null })} variant={!filtroStatus ? "primary" : "ghost"} size="sm">
          Todos os status
        </Button>
        {STATUS.map((s) => (
          <Button
            key={s}
            href={comFiltros({ status: s })}
            variant={filtroStatus === s ? "primary" : "ghost"}
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
          description="Ajuste os filtros para ver outras cartas do estoque."
        />
      ) : (
        <ul className={styles.list}>
          {lista.map((c) => (
            <Card key={c.id} as="li">
              <div className={row.row}>
                <div className={row.info}>
                  <span className={row.cliente}>{brl(c.valor_credito)}</span>
                  <span className={row.meta}>
                    {LABEL_TIPO_BEM[c.tipo as Tipo] ?? c.tipo}
                    {c.valor_entrada != null ? ` · entrada ${brl(c.valor_entrada)}` : ""}
                    {c.qtd_parcelas != null ? ` · ${c.qtd_parcelas}x` : ""}
                    {c.parceiro_id ? " · parceiro" : " · estoque Bidcon"}
                    {/* metadados admin-only (nunca vão a tela de cliente/parceiro) */}
                    {(c as { fonte: string | null }).fonte
                      ? ` · origem ${(c as { fonte: string | null }).fonte}`
                      : ""}
                    {(c as { comissao_percentual: number | null }).comissao_percentual != null
                      ? ` · comissão ${(c as { comissao_percentual: number | null }).comissao_percentual}%`
                      : ""}
                  </span>
                </div>
                <Badge tone={TONE_STATUS_CARTA[c.status as StatusCarta]}>
                  {LABEL_STATUS_CARTA[c.status as StatusCarta] ?? c.status}
                </Badge>
              </div>
              <CartaAcoes cartaId={c.id} atual={c.status as StatusCarta} />
              <CartaVinculo
                cartaId={c.id}
                administradoras={administradoras}
                fornecedores={fornecedores}
                administradoraAtual={(c as { administradora_id: string | null }).administradora_id}
                fornecedorAtual={(c as { fornecedor_id: string | null }).fornecedor_id}
                fonteAtual={(c as { fonte: string | null }).fonte}
                comissaoAtual={(c as { comissao_percentual: number | null }).comissao_percentual}
              />
            </Card>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
