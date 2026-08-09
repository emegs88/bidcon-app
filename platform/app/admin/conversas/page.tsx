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
import { dataHoraAnoBR } from "@/lib/data-br";
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
  /** Momento da última atividade REAL da conversa — ordena a lista e é o que
   *  a tela mostra. `fonteAtividade` diz de onde veio: as duas fontes não
   *  sabem a mesma coisa, e a tela tem de dizer qual está exibindo. */
  ultimaAtividade: string;
  fonteAtividade: "mensagem" | "registro";
};

// A `dataHora` local foi APAGADA — chamava `toLocaleString` sem `timeZone` e
// carimbava UTC na Vercel. Ver lib/data-br.ts. Aqui o efeito se somava ao
// defeito já documentado abaixo: a lista dizia "última mensagem em 09:43"
// quando a mensagem foi às 06:43, e o operador prioriza por essa hora.

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
      .select("id, telefone, nome, status, atualizado_em"),
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

  // PAINEL-WA-01, item 2 — wa_conversas.atualizado_em NÃO avança com mensagem
  // nova. `conversas` (site) tem o trigger `conversas_touch`; wa_conversas não
  // tem trigger nenhum — medido em pg_trigger, não no comentário do código.
  // Na prática o campo guarda a hora de CRIAÇÃO com nome de atualização: em
  // 04/08/2026 a conversa 9eb5f278 carimbava 15/07 23:44 tendo mensagem de
  // 04/08 09:43 — 19,42 dias de mentira, 64 mensagens. Ordenar e rotular por
  // ele faz o painel errar justamente o dado que o operador usa pra priorizar:
  // ele rola até o fim procurando o que deveria estar no topo.
  //
  // Aqui a última atividade é DERIVADA de max(wa_mensagens.criado_em). Quando
  // o trigger equivalente for autorizado (wa-touch), o campo passa a ser
  // verdadeiro e esta derivação deixa de ser a única fonte pra virar a
  // segunda — dois caminhos concordando, que é o desenho desejado e não
  // redundância desperdiçada.
  //
  // LIMITE_MSGS impede a página de crescer sem teto. As mensagens vêm em ordem
  // decrescente, então a PRIMEIRA ocorrência de cada conversa já é o máximo
  // dela. Conversa antiga o bastante pra cair fora do teto fica sem derivação
  // — e a tela DIZ isso, em vez de exibir o carimbo errado fingindo ser a hora
  // da última mensagem.
  const LIMITE_MSGS = 5000;
  const { data: msgsRecentes } = await supabase
    .from("wa_mensagens")
    .select("conversa_id, criado_em")
    .order("criado_em", { ascending: false })
    .limit(LIMITE_MSGS);

  const ultimaMsgWa = new Map<string, string>();
  for (const m of msgsRecentes ?? []) {
    const cid = m.conversa_id as string;
    if (!ultimaMsgWa.has(cid)) ultimaMsgWa.set(cid, m.criado_em as string);
  }

  const linhasWa: LinhaConversa[] = (waConversas ?? []).map((c) => {
    const derivada = ultimaMsgWa.get(c.id as string);
    return {
      id: c.id as string,
      canal: "whatsapp" as const,
      nome: c.nome as string | null,
      telefone: c.telefone as string | null,
      status: c.status as string,
      ultimaAtividade: derivada ?? (c.atualizado_em as string),
      fonteAtividade: derivada ? ("mensagem" as const) : ("registro" as const),
    };
  });
  const linhasSite: LinhaConversa[] = (conversas ?? []).map((c) => {
    const interesse = c.interesse_id ? interesseMap.get(c.interesse_id as string) : null;
    return {
      id: c.id as string,
      canal: "site",
      nome: interesse?.nome ?? null,
      telefone: interesse?.telefone ?? null,
      status: c.status as string,
      ultimaAtividade: c.atualizado_em as string,
      fonteAtividade: "registro" as const,
    };
  });

  const todas = [...linhasWa, ...linhasSite].sort(
    (a, b) => new Date(b.ultimaAtividade).getTime() - new Date(a.ultimaAtividade).getTime(),
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
                      {l.telefone ?? "—"} ·{" "}
                      {l.fonteAtividade === "mensagem"
                        ? `última mensagem em ${dataHoraAnoBR(l.ultimaAtividade)}`
                        : `registro criado/atualizado em ${dataHoraAnoBR(l.ultimaAtividade)}`}
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
