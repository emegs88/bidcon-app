// /meu-processo (Fase 1) — Server Component.
// Lê o processo do cliente logado (RLS garante que só vê o próprio), a carta
// vinculada e o histórico de eventos. Estado vazio quando não há processo.
import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { Timeline } from "./Timeline";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { LABEL_STATUS, LABEL_TIPO_BEM, type StatusProcesso } from "@/lib/status";
import { brl, dataBR } from "@/lib/format";
import styles from "./processo.module.css";

// número de atendimento (mesmo do site)
const WA = "5519997561909";

export default async function MeuProcesso() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // identificação do usuário para a casca
  const { data: profile } = await supabase
    .from("profiles")
    .select("nome, tipo")
    .eq("id", user.id)
    .single();
  const nome = profile?.nome ?? user.email ?? null;
  const tipo = profile?.tipo as "cliente" | "parceiro" | "admin" | undefined;

  // RLS: retorna apenas processos do próprio cliente
  const { data: processo } = await supabase
    .from("processos")
    .select("id, status, valor_carta, valor_entrada, carta_id")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  // ----- estado vazio -----
  if (!processo) {
    return (
      <AppShell nome={nome} tipo={tipo}>
        <PageHeader title="Meu processo" backHref="/" />
        <EmptyState
          title="Nenhum processo em andamento"
          description="Assim que uma negociação começar, o andamento aparece nesta tela."
          action={
            <Button href={`https://wa.me/${WA}`}>Falar com o atendimento</Button>
          }
        />
      </AppShell>
    );
  }

  // ----- carta vinculada (RLS pode bloquear leitura da carta de outro parceiro;
  // por isso tratamos ausência com segurança) -----
  let carta: { tipo: string; valor_credito: number; valor_entrada: number | null } | null = null;
  if (processo.carta_id) {
    const { data } = await supabase
      .from("cartas")
      .select("tipo, valor_credito, valor_entrada")
      .eq("id", processo.carta_id)
      .maybeSingle();
    carta = data ?? null;
  }

  // ----- histórico de eventos -----
  const { data: eventos } = await supabase
    .from("processo_eventos")
    .select("de_status, para_status, nota, em")
    .eq("processo_id", processo.id)
    .order("em", { ascending: true });

  const statusAtual = processo.status as StatusProcesso;

  return (
    <AppShell nome={nome} tipo={tipo}>
      <PageHeader
        title="Meu processo"
        backHref="/"
        subtitle="Acompanhe cada etapa. As datas dependem da administradora do consórcio; esta tela não promete prazo de contemplação."
      />

      <div className={styles.stack}>
        <Card>
          <h2 className={styles.h2}>Andamento</h2>
          <Timeline atual={statusAtual} />
        </Card>

        {carta && (
          <Card>
            <h2 className={styles.h2}>Carta em negociação</h2>
            <dl className={styles.dl}>
              <div className={styles.row}>
                <dt>Tipo</dt>
                <dd>{LABEL_TIPO_BEM[carta.tipo] ?? carta.tipo}</dd>
              </div>
              <div className={styles.row}>
                <dt>Crédito</dt>
                <dd>{brl(carta.valor_credito)}</dd>
              </div>
              <div className={styles.row}>
                <dt>Entrada estimada</dt>
                <dd>{brl(carta.valor_entrada)}</dd>
              </div>
            </dl>
          </Card>
        )}

        {eventos && eventos.length > 0 && (
          <Card>
            <h2 className={styles.h2}>Histórico</h2>
            <ul className={styles.hist}>
              {eventos.map((ev, i) => (
                <li key={i}>
                  <b>{LABEL_STATUS[ev.para_status as StatusProcesso]}</b>
                  {ev.nota ? ` — ${ev.nota}` : ""}
                  <span className={styles.data}>{dataBR(ev.em)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
