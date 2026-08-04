// /admin/conversas/whatsapp/[id] — thread de wa_mensagens + ações
// Assumir/Devolver + envio pelo painel (PAINEL-WA-01 item 3). Mesmo
// gate/dados do resto de /admin/conversas.
//
// A janela de 24h é calculada AQUI, no servidor, a partir da última mensagem
// DO CLIENTE — resposta nossa não reabre janela nenhuma. O componente recebe
// o resultado pronto: relógio de navegador não decide regra da Meta.
import { notFound } from "next/navigation";
import { exigirAdminConsolePagina } from "@/lib/admin-console";
import { createXtvClient } from "@/lib/supabase-xtv";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ConversaAcoes } from "../../ConversaAcoes";
import { ResponderWhatsApp } from "../../ResponderWhatsApp";
import styles from "../../conversas.module.css";

export const dynamic = "force-dynamic";

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

// wa_papel: 'cliente' | 'prosperito' | 'humano' | 'sistema'. Visualmente
// tratamos 'prosperito' e 'humano' como bolha "agente" (lado direito).
function bolhaClasse(papel: string): string {
  if (papel === "cliente") return styles.cliente;
  if (papel === "sistema") return styles.sistema;
  return styles.agente;
}

export default async function AdminConversaWhatsApp({
  params,
}: {
  params: { id: string };
}) {
  const { nome } = await exigirAdminConsolePagina();
  const supabase = createXtvClient();

  const { data: conversa } = await supabase
    .from("wa_conversas")
    .select("id, telefone, nome, status, agente_ativo, opt_out")
    .eq("id", params.id)
    .maybeSingle();

  if (!conversa) notFound();

  const { data: mensagens } = await supabase
    .from("wa_mensagens")
    .select("id, papel, conteudo, agente, criado_em, status_envio, erro")
    .eq("conversa_id", conversa.id)
    .order("criado_em", { ascending: true });

  // Janela de 24h: medida da última mensagem DO CLIENTE. `mensagens` já está em
  // ordem crescente, então o último 'cliente' do array é o marco — evita uma
  // segunda ida ao banco pra buscar o que já está na memória.
  const JANELA_MS = 24 * 60 * 60 * 1000;
  const ultimaCliente = [...(mensagens ?? [])]
    .reverse()
    .find((m) => m.papel === "cliente");
  const marco = ultimaCliente?.criado_em
    ? new Date(ultimaCliente.criado_em as string).getTime()
    : null;
  const janelaAberta = marco !== null && Date.now() - marco < JANELA_MS;
  const janelaTexto =
    marco === null
      ? "Esta conversa não tem mensagem do cliente — a janela de 24h nunca abriu."
      : janelaAberta
        ? `Janela de 24h aberta até ${dataHora(new Date(marco + JANELA_MS).toISOString())}.`
        : `Janela de 24h fechada desde ${dataHora(new Date(marco + JANELA_MS).toISOString())}.`;

  return (
    <AppShell nome={nome} equipeAdminConsole>
      <PageHeader
        title={conversa.nome || conversa.telefone}
        subtitle="Canal WhatsApp — thread completa. Assuma a conversa para responder por aqui."
        backHref="/admin/conversas"
        backLabel="Conversas"
      />

      <Card>
        <div className={styles.header}>
          <div className={styles.info}>
            <span className={styles.nomeLead}>{conversa.telefone}</span>
            <span className={styles.meta}>
              Agente ativo: {conversa.agente_ativo ?? "—"}
              {conversa.opt_out ? " · lead optou por sair (opt-out)" : ""}
            </span>
          </div>
          <Badge tone={conversa.status === "humano" ? "amber" : "ok"}>
            {conversa.status === "humano" ? "Precisa de atenção" : conversa.status}
          </Badge>
        </div>
        <ConversaAcoes
          canal="whatsapp"
          conversaId={conversa.id}
          status={conversa.status}
          telefone={conversa.telefone as string | null}
        />
        <ResponderWhatsApp
          conversaId={conversa.id as string}
          assumida={conversa.status === "humano"}
          optOut={conversa.opt_out === true}
          janelaAberta={janelaAberta}
          janelaTexto={janelaTexto}
        />
      </Card>

      <ul className={styles.thread}>
        {(mensagens ?? []).map((m) => (
          <li key={m.id} className={`${styles.bolha} ${bolhaClasse(m.papel as string)}`}>
            {m.conteudo}
            <span className={styles.bolhaMeta}>
              {m.papel}
              {m.agente ? ` · ${m.agente}` : ""} · {dataHora(m.criado_em as string)}
              {m.status_envio === "falha" ? (
                <span className={styles.falha}>
                  {" "}
                  · não entregue{m.erro ? `: ${String(m.erro)}` : ""}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
