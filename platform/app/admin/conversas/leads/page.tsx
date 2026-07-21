// /admin/conversas/leads — lista somente leitura de `interesses` (captura de
// leads da vitrine/chat, projeto xtv) MESCLADA com `vendas_novas` (funil da
// venda nova Disal, FATIA 1, projeto nnv — segunda leitura via
// createAdminClient()). Sem escrita nesta fatia (CRM-01 é só leitura +
// Assumir/Devolver nas conversas; a extensão FATIA 1 segue o mesmo
// princípio). Filtro por status via querystring vale só pro lado
// `interesses` (taxonomia de status diferente entre as duas tabelas) — com
// filtro ativo, a lista mostra só interesses; sem filtro, mostra as duas
// fontes mescladas por data, mais recente primeiro.
import { exigirAdminConsolePagina } from "@/lib/admin-console";
import { createXtvClient } from "@/lib/supabase-xtv";
import { createAdminClient } from "@/lib/supabase-admin";
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

// FATIA 1 (venda nova) — vocabulário de status próprio de vendas_novas
// (enum diferente do de interesses; ver status-venda-tool.ts, mesma fonte
// de rótulos usada pela tool status_venda).
const LABEL_STATUS_VENDA_NOVA: Record<string, string> = {
  LEAD: "Lead",
  QUALIFICADO: "Qualificado",
  PROPOSTA: "Proposta enviada",
  PIX_ENVIADO: "Pix enviado",
  PAGO_1A: "1ª parcela paga",
  DOC_VALIDADA: "Documentação validada",
  ATIVA: "Cota ativa",
  CANCELADA: "Cancelada",
};

const TONE_STATUS_VENDA_NOVA: Record<string, "ok" | "amber" | "muted" | "info"> = {
  LEAD: "info",
  QUALIFICADO: "info",
  PROPOSTA: "amber",
  PIX_ENVIADO: "amber",
  PAGO_1A: "amber",
  DOC_VALIDADA: "amber",
  ATIVA: "ok",
  CANCELADA: "muted",
};

// Formato unificado de renderização — cada linha vem de `interesses` (xtv)
// ou `vendas_novas` (nnv), normalizada aqui pra caber no mesmo <Card>.
type LeadRow = {
  chave: string;
  nome: string;
  telefone: string;
  origem: string;
  metaExtra: string;
  statusLabel: string;
  statusTone: "ok" | "amber" | "muted" | "info";
  criadoEm: string | null;
  vendaNova: boolean;
  cartaVinculada: boolean;
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
  const listaInteresses: LeadRow[] = (data ?? []).map((l) => ({
    chave: `interesse-${l.id}`,
    nome: l.nome || "—",
    telefone: l.telefone || "—",
    origem: l.origem ?? "—",
    metaExtra: l.intencao ?? "—",
    statusLabel: LABEL_STATUS[l.status as StatusInteresse] ?? l.status,
    statusTone: TONE_STATUS[l.status as StatusInteresse] ?? "muted",
    criadoEm: l.criado_em,
    vendaNova: false,
    cartaVinculada: !!l.carta_id,
  }));

  // FATIA 1 (venda nova) — segunda leitura, projeto nnv, só quando não há
  // filtro de status ativo (taxonomia de status não é compatível entre as
  // duas tabelas). Nunca derruba a página: erro de env/consulta só loga e
  // a lista segue só com `interesses` (mesmo espírito defensivo das tools).
  let listaVendaNova: LeadRow[] = [];
  if (!filtro) {
    try {
      const nnvAdmin = createAdminClient();
      const { data: vendasNovas } = await nnvAdmin
        .from("vendas_novas")
        .select("id, nome, whatsapp, lead_origem, status, criado_em, administradoras:administradora_id(nome)")
        .order("criado_em", { ascending: false })
        .limit(200);
      listaVendaNova = (vendasNovas ?? []).map((v) => {
        const adm = v.administradoras as { nome: string | null } | { nome: string | null }[] | null;
        const nomeAdm = Array.isArray(adm) ? adm[0]?.nome : adm?.nome;
        return {
          chave: `vendanova-${v.id}`,
          nome: v.nome || "—",
          telefone: v.whatsapp || "—",
          origem: v.lead_origem ?? "—",
          metaExtra: nomeAdm ?? "administradora não definida",
          statusLabel: LABEL_STATUS_VENDA_NOVA[v.status] ?? v.status,
          statusTone: TONE_STATUS_VENDA_NOVA[v.status] ?? "muted",
          criadoEm: v.criado_em,
          vendaNova: true,
          cartaVinculada: false,
        };
      });
    } catch (e) {
      console.error("[admin/leads] erro ao consultar vendas_novas (nnv):", e);
    }
  }

  const lista = [...listaInteresses, ...listaVendaNova].sort((a, b) => {
    const da = a.criadoEm ? new Date(a.criadoEm).getTime() : 0;
    const dbEm = b.criadoEm ? new Date(b.criadoEm).getTime() : 0;
    return dbEm - da;
  });

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
            <Card key={l.chave} as="li">
              <div className={styles.row}>
                <div className={styles.info}>
                  <div className={styles.linha1}>
                    <span className={styles.nomeLead}>{l.nome}</span>
                    {l.cartaVinculada && <Badge tone="info">carta vinculada</Badge>}
                    {l.vendaNova && <Badge tone="info">Venda nova · Disal</Badge>}
                  </div>
                  <span className={styles.meta}>
                    {l.telefone} · origem {l.origem} · {l.metaExtra} · captado em{" "}
                    {dataHora(l.criadoEm)}
                  </span>
                </div>
                <Badge tone={l.statusTone}>{l.statusLabel}</Badge>
              </div>
            </Card>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
