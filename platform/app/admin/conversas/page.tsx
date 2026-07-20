// /admin/conversas — CRM-01: central única de conversas (WhatsApp + Site).
// Dados vivem no xtv (service_role) — mesmo gate de /admin/revisao e
// /admin/importar (exigirAdminConsolePagina, allowlist BIDCON_ADMIN_EMAILS),
// não exigirPapel("admin") (esse é pra dados no nnv com RLS por sessão).
//
// wa_conversas (WhatsApp) e conversas (Site) são tabelas fisicamente
// separadas — mesclamos aqui numa única lista, ordenada por atualizado_em,
// com badge de canal e badge "Precisa de atenção" quando status='humano'.
import { exigirAdminConsolePagina } from "@/lib/admin-console";
import { createXtvClient } from "@/lib/supabase-xtv";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConversasSubNav } from "./ConversasSubNav";
import areaStyles from "@/components/area.module.css";
import styles from "./conversas.module.css";

export const dynamic = "force-dynamic";

type Canal = "whatsapp" | "site";

type LinhaConversa = {
  id: string;
  canal: Canal;
  nome: string | null;
  telefone: string | null;
  status: string;
  atualizado_em: string;
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

function statusInfo(
  canal: Canal,
  status: string,
): { label: string; tone: "ok" | "amber" | "muted" } {
  if (status === "humano") return { label: "Precisa de atenção", tone: "amber" };
  const encerrada = canal === "whatsapp" ? status === "encerrado" : status === "fechada";
  return encerrada ? { label: "Encerrada", tone: "muted" } : { label: "Bot ativo", tone: "ok" };
}

export default async function AdminConversas({
  searchParams,
}: {
  searchParams: { canal?: string; foco?: string };
}) {
  const { nome } = await exigirAdminConsolePagina();
  const supabase = createXtvClient();

  const [{ data: waConversas }, { data: conversas }] = await Promise.all([
    supabase
      .from("wa_conversas")
      .select("id, telefone, nome, status, atualizado_em")
      .order("atualizado_em", { ascending: false }),
    supabase
      .from("conversas")
      .select("id, interesse_id, status, atualizado_em")
      .order("atualizado_em", { ascending: false }),
  ]);

  const interesseIds = [
    ...new Set((conversas ?? []).map((c) => c.interesse_id).filter(Boolean)),
  ] as string[];
  const { data: interesses } = interesseIds.length
    ? await supabase.from("interesses").select("id, nome, telefone").in("id", interesseIds)
    : { data: [] as { id: string; nome: string; telefone: string }[] };
  const interesseMap = new Map((interesses ?? []).map((i) => [i.id, i]));

  const linhasWa: LinhaConversa[] = (waConversas ?? []).map((c) => ({
    id: c.id as string,
    canal: "whatsapp",
    nome: c.nome as string | null,
    telefone: c.telefone as string | null,
    status: c.status as string,
    atualizado_em: c.atualizado_em as string,
  }));
  const linhasSite: LinhaConversa[] = (conversas ?? []).map((c) => {
    const interesse = c.interesse_id ? interesseMap.get(c.interesse_id as string) : null;
    return {
      id: c.id as string,
      canal: "site",
      nome: interesse?.nome ?? null,
      telefone: interesse?.telefone ?? null,
      status: c.status as string,
      atualizado_em: c.atualizado_em as string,
    };
  });

  const todas = [...linhasWa, ...linhasSite].sort(
    (a, b) => new Date(b.atualizado_em).getTime() - new Date(a.atualizado_em).getTime(),
  );

  const filtroCanal =
    searchParams.canal === "whatsapp" || searchParams.canal === "site" ? searchParams.canal : null;
  const soAtencao = searchParams.foco === "atencao";

  let lista = todas;
  if (filtroCanal) lista = lista.filter((l) => l.canal === filtroCanal);
  if (soAtencao) lista = lista.filter((l) => l.status === "humano");

  const qtdAtencao = todas.filter((l) => l.status === "humano").length;

  function hrefFiltro(canal: string | null, foco: boolean): string {
    const params = new URLSearchParams();
    if (canal) params.set("canal", canal);
    if (foco) params.set("foco", "atencao");
    const qs = params.toString();
    return qs ? `/admin/conversas?${qs}` : "/admin/conversas";
  }

  return (
    <AppShell nome={nome} equipeAdminConsole>
      <PageHeader
        title="Conversas"
        subtitle="WhatsApp e site num só lugar. Assuma uma conversa pra pausar o bot e responder direto."
      />
      <ConversasSubNav />

      <nav className={areaStyles.filtros} aria-label="Filtrar conversas">
        <Button
          href={hrefFiltro(null, soAtencao)}
          variant={!filtroCanal ? "primary" : "ghost"}
          size="sm"
        >
          Todos os canais
        </Button>
        <Button
          href={hrefFiltro("whatsapp", soAtencao)}
          variant={filtroCanal === "whatsapp" ? "primary" : "ghost"}
          size="sm"
        >
          WhatsApp
        </Button>
        <Button
          href={hrefFiltro("site", soAtencao)}
          variant={filtroCanal === "site" ? "primary" : "ghost"}
          size="sm"
        >
          Site
        </Button>
        <Button
          href={hrefFiltro(filtroCanal, !soAtencao)}
          variant={soAtencao ? "primary" : "ghost"}
          size="sm"
        >
          Precisa de atenção{qtdAtencao ? ` (${qtdAtencao})` : ""}
        </Button>
      </nav>

      {lista.length === 0 ? (
        <EmptyState
          icon="💬"
          title="Nenhuma conversa"
          description="Nenhuma conversa encontrada com este filtro."
        />
      ) : (
        <ul className={areaStyles.list}>
          {lista.map((l) => {
            const info = statusInfo(l.canal, l.status);
            const href =
              l.canal === "whatsapp"
                ? `/admin/conversas/whatsapp/${l.id}`
                : `/admin/conversas/site/${l.id}`;
            return (
              <Card key={`${l.canal}-${l.id}`} href={href}>
                <div className={styles.row}>
                  <div className={styles.info}>
                    <div className={styles.linha1}>
                      <Badge tone="muted">{l.canal === "whatsapp" ? "WhatsApp" : "Site"}</Badge>
                      <span className={styles.nomeLead}>{l.nome ?? l.telefone ?? "Sem nome"}</span>
                    </div>
                    <span className={styles.meta}>
                      {l.telefone ?? "—"} · atualizado em {dataHora(l.atualizado_em)}
                    </span>
                  </div>
                  <Badge tone={info.tone}>{info.label}</Badge>
                </div>
              </Card>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
