// /admin/revisao — fila de revisão: cartas em quarentena de preço (FATIA F1).
// ----------------------------------------------------------------------------
// Server Component. Gate: exigirAdminConsolePagina() (allowlist
// BIDCON_ADMIN_EMAILS, lib/admin-console.ts). Dados sempre no xtv
// (createXtvClient) — cartas/administradoras/fornecedores do xtv, NUNCA nnv.
//
// Fila = cartas onde a trigger bidcon_price_calcular já rodou (bidcon_price_em
// preenchido) mas a TIR calculada ficou nula ou abaixo do piso de
// plausibilidade (bidcon_custo_am nulo) — dado degenerado da origem
// (parcela/prazo/entrada errados). A carta pode continuar "indisponivel" até
// alguém corrigir e republicar, ou descartar definitivamente.
import { exigirAdminConsolePagina } from "@/lib/admin-console";
import { createXtvClient } from "@/lib/supabase-xtv";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { RevisaoCartaAcoes } from "./RevisaoCartaAcoes";
import styles from "./revisao.module.css";

export const dynamic = "force-dynamic";

type CartaFila = {
  id: string;
  tipo: string | null;
  valor_credito: number | null;
  valor_entrada: number | null;
  valor_parcela: number | null;
  qtd_parcelas: number | null;
  administradora_id: string | null;
  administradora_raw: string | null;
  fornecedor_id: string | null;
  numero_externo: number | null;
  bidcon_price_em: string | null;
  criado_em: string | null;
};

function brl(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function dataHora(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default async function RevisaoPage() {
  const { nome } = await exigirAdminConsolePagina();
  const supabase = createXtvClient();

  const [{ data: cartas }, { data: administradoras }, { data: fornecedores }] = await Promise.all([
    supabase
      .from("cartas")
      .select(
        "id, tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas, administradora_id, administradora_raw, fornecedor_id, numero_externo, bidcon_price_em, criado_em"
      )
      .not("bidcon_price_em", "is", null)
      .is("bidcon_custo_am", null)
      .order("bidcon_price_em", { ascending: false })
      .limit(500),
    supabase.from("administradoras").select("id, nome"),
    supabase.from("fornecedores").select("id, nome"),
  ]);

  const nomeAdm = new Map((administradoras ?? []).map((a) => [a.id as string, a.nome as string]));
  const nomeFornecedor = new Map((fornecedores ?? []).map((f) => [f.id as string, f.nome as string]));

  const lista = (cartas ?? []) as CartaFila[];

  return (
    <AppShell nome={nome} equipeAdminConsole>
      <PageHeader
        title="Fila de revisão"
        subtitle="Cartas com dados degenerados da origem (TIR nula ou abaixo do piso de plausibilidade) — sem custo publicado, sem selo, fora do ranking, até alguém corrigir os números ou descartar."
      />

      {lista.length === 0 ? (
        <EmptyState
          icon="✅"
          title="Fila vazia"
          description="Nenhuma carta aguardando revisão no momento."
        />
      ) : (
        <ul className={styles.list}>
          {lista.map((c) => {
            const adm = c.administradora_id ? nomeAdm.get(c.administradora_id) ?? c.administradora_raw : c.administradora_raw;
            const fornecedor = c.fornecedor_id ? nomeFornecedor.get(c.fornecedor_id) ?? "—" : "—";
            return (
              <Card key={c.id} as="li">
                <div className={styles.row}>
                  <div className={styles.info}>
                    <div className={styles.linha1}>
                      <Badge tone="amber">Em quarentena</Badge>
                      <span className={styles.credito}>{brl(c.valor_credito)}</span>
                    </div>
                    <span className={styles.meta}>
                      {c.tipo ?? "—"} · entrada {brl(c.valor_entrada)} · parcela {brl(c.valor_parcela)} ·{" "}
                      {c.qtd_parcelas ?? "—"}x · {adm ?? "—"} · fornecedor {fornecedor} · ref. {c.numero_externo ?? "—"}
                    </span>
                    <span className={styles.meta}>detectada em {dataHora(c.bidcon_price_em)}</span>
                  </div>
                </div>
                <RevisaoCartaAcoes
                  cartaId={c.id}
                  tipoAtual={(c.tipo as "imovel" | "veiculo" | null) ?? "veiculo"}
                  creditoAtual={c.valor_credito}
                  entradaAtual={c.valor_entrada}
                  parcelaAtual={c.valor_parcela}
                  parcelasAtual={c.qtd_parcelas}
                />
              </Card>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
