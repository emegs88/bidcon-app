// /meu-processo (Fase 1) — Server Component.
// Lê o processo do cliente logado (RLS garante que só vê o próprio), a carta
// vinculada e o histórico de eventos. Estado vazio quando não há processo.
import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { Timeline } from "./Timeline";
import {
  LABEL_STATUS,
  LABEL_TIPO_BEM,
  brl,
  type StatusProcesso,
} from "@/lib/status";

// número de atendimento (mesmo do site)
const WA = "5519997561909";

export default async function MeuProcesso() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS: retorna apenas processos do próprio cliente
  const { data: processo } = await supabase
    .from("processos")
    .select("id, status, valor_carta, valor_entrada, carta_id")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  const wrap: React.CSSProperties = { maxWidth: 620, margin: "0 auto", padding: "56px 24px" };

  // ----- estado vazio -----
  if (!processo) {
    return (
      <main style={wrap}>
        <a href="/" style={{ color: "#93A0B8", fontSize: 13, textDecoration: "none" }}>← Início</a>
        <h1 style={{ fontWeight: 800, marginTop: 16 }}>Meu processo</h1>
        <p style={{ color: "#93A0B8" }}>
          Você ainda não tem um processo em andamento por aqui. Assim que uma
          negociação começar, o andamento aparece nesta tela.
        </p>
        <a
          href={`https://wa.me/${WA}`}
          style={{
            display: "inline-block",
            marginTop: 16,
            padding: "12px 18px",
            borderRadius: 999,
            background: "linear-gradient(100deg,#8FB7FF,#36C5F0 45%,#1E6FE6)",
            color: "#04121f",
            fontWeight: 800,
            textDecoration: "none",
          }}
        >
          Falar com o atendimento
        </a>
      </main>
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

  const card: React.CSSProperties = {
    background: "#10182B",
    border: "1px solid rgba(255,255,255,.12)",
    borderRadius: 16,
    padding: "20px 22px",
    margin: "18px 0",
  };

  return (
    <main style={wrap}>
      <a href="/" style={{ color: "#93A0B8", fontSize: 13, textDecoration: "none" }}>← Início</a>
      <h1 style={{ fontWeight: 800, marginTop: 16 }}>Meu processo</h1>
      <p style={{ color: "#93A0B8", marginTop: 0 }}>
        Acompanhe cada etapa. As datas dependem da administradora do consórcio;
        esta tela não promete prazo de contemplação.
      </p>

      <section style={card}>
        <h2 style={{ fontSize: 16, margin: "0 0 14px" }}>Andamento</h2>
        <Timeline atual={statusAtual} />
      </section>

      {carta && (
        <section style={card}>
          <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>Carta em negociação</h2>
          <p style={{ margin: "4px 0", color: "#d4d8e2" }}>
            Tipo: <b style={{ color: "#fff" }}>{LABEL_TIPO_BEM[carta.tipo] ?? carta.tipo}</b>
          </p>
          <p style={{ margin: "4px 0", color: "#d4d8e2" }}>
            Crédito: <b style={{ color: "#fff" }}>{brl(carta.valor_credito)}</b>
          </p>
          <p style={{ margin: "4px 0", color: "#d4d8e2" }}>
            Entrada estimada: <b style={{ color: "#fff" }}>{brl(carta.valor_entrada)}</b>
          </p>
        </section>
      )}

      {eventos && eventos.length > 0 && (
        <section style={card}>
          <h2 style={{ fontSize: 16, margin: "0 0 12px" }}>Histórico</h2>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
            {eventos.map((ev, i) => (
              <li key={i} style={{ color: "#d4d8e2", fontSize: 14 }}>
                <b style={{ color: "#fff" }}>
                  {LABEL_STATUS[ev.para_status as StatusProcesso]}
                </b>
                {ev.nota ? ` — ${ev.nota}` : ""}
                <span style={{ color: "#93A0B8", fontSize: 12, display: "block" }}>
                  {new Date(ev.em).toLocaleDateString("pt-BR")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
