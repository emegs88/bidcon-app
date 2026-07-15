"use client";
// /interno/simulador-porto — Simulador de grupos em andamento (multi-administradora)
// Identidade Bidcon: navy #0A0E1A, gradiente #8FB7FF→#36C5F0→#1E6FE6,
// Space Grotesk (títulos), IBM Plex Mono (números).
// Requer as rotas /api/analista-grupos e /api/analista-ia deste pacote.

import { useState } from "react";

const fmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

type Opcao = {
  codigo: string; administradora: string; segmento: string;
  credito: number; creditoLiquido: number; parcela: number;
  tempoEsperadoMeses: number; lancePct: number; lanceProprioRS: number;
  comissaoRS: number; desembolsoContemplacao: number;
  saldoDevedorPos: number; parcelasRestantesPos: number;
  tirMes: number | null; corteReferencia: number | null;
  tendencia: string | null; mesesHistorico: number; veredito: string;
};

export default function SimuladorPorto() {
  const [aba, setAba] = useState<"ranking" | "juncao">("ranking");
  const [segmento, setSegmento] = useState<"auto" | "imovel">("auto");
  const [credito, setCredito] = useState(100000);
  const [alvo, setAlvo] = useState(1000000);
  const [lance, setLance] = useState(30);
  const [tipoLance, setTipoLance] = useState<"livre" | "embutido">("livre");
  const [carregando, setCarregando] = useState(false);
  const [opcoes, setOpcoes] = useState<Opcao[]>([]);
  const [resumo, setResumo] = useState<any>(null);
  const [ia, setIa] = useState("");
  const [erro, setErro] = useState("");

  async function rodar() {
    setCarregando(true); setErro(""); setIa(""); setResumo(null); setOpcoes([]);
    try {
      const body =
        aba === "ranking"
          ? { modo: "ranking", segmento, credito, lancePct: lance, tipoLance, limite: 8 }
          : { modo: "juncao", segmento, creditoAlvo: alvo, lancePct: lance, tipoLance };
      const r = await fetch("/api/analista-grupos", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (d.erro) throw new Error(d.erro);
      if (aba === "ranking") setOpcoes(d.opcoes ?? []);
      else { setResumo(d.resumo); setOpcoes(d.cartas ?? []); }
    } catch (e: any) { setErro(e.message); } finally { setCarregando(false); }
  }

  async function analisarIA() {
    setIa("Analisando…");
    const contexto = aba === "ranking" ? { opcoes: opcoes.slice(0, 5) } : { resumo, cartas: opcoes.slice(0, 10) };
    const r = await fetch("/api/analista-ia", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ pergunta: `Analise estas opções para crédito de ${fmt(aba === "ranking" ? credito : alvo)} com lance de ${lance}% (${tipoLance}).`, contexto }),
    });
    const d = await r.json();
    setIa(d.resposta ?? d.erro ?? "Sem resposta.");
  }

  const S = {
    input: { background: "#111827", border: "1px solid #1E6FE6", color: "#fff", borderRadius: 8, padding: "8px 10px", fontFamily: "'IBM Plex Mono', monospace" } as const,
    label: { fontSize: 12, opacity: 0.7, display: "block", marginBottom: 4 } as const,
  };

  return (
    <main style={{ minHeight: "100vh", background: "#0A0E1A", color: "#E5E9F0", fontFamily: "'Space Grotesk', system-ui, sans-serif", padding: "32px 16px" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <h1 style={{ fontSize: 28, margin: 0, background: "linear-gradient(90deg,#8FB7FF,#36C5F0,#1E6FE6)", WebkitBackgroundClip: "text", color: "transparent" }}>
          Analista de Grupos · Bidcon
        </h1>
        <p style={{ opacity: 0.6, marginTop: 4, fontSize: 13 }}>
          Tempos são estimativas estatísticas — nunca prometemos data de contemplação. Custo financeiro medido por TIR ao mês.
        </p>

        <div style={{ display: "flex", gap: 8, margin: "20px 0" }}>
          {(["ranking", "juncao"] as const).map(a => (
            <button key={a} onClick={() => setAba(a)}
              style={{ padding: "8px 18px", borderRadius: 999, border: "1px solid #1E6FE6", cursor: "pointer",
                       background: aba === a ? "linear-gradient(90deg,#36C5F0,#1E6FE6)" : "transparent",
                       color: aba === a ? "#0A0E1A" : "#8FB7FF", fontWeight: 700 }}>
              {a === "ranking" ? "Melhores grupos" : "Junção de cartas"}
            </button>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, background: "#0F1526", padding: 16, borderRadius: 14, border: "1px solid #16213A" }}>
          <div><label style={S.label}>Segmento</label>
            <select value={segmento} onChange={e => setSegmento(e.target.value as any)} style={S.input as any}>
              <option value="auto">Auto</option><option value="imovel">Imóvel</option>
            </select></div>
          {aba === "ranking" ? (
            <div><label style={S.label}>Carta de crédito (R$)</label>
              <input type="number" value={credito} onChange={e => setCredito(+e.target.value)} style={S.input as any} /></div>
          ) : (
            <div><label style={S.label}>Crédito alvo total (R$)</label>
              <input type="number" value={alvo} onChange={e => setAlvo(+e.target.value)} style={S.input as any} /></div>
          )}
          <div><label style={S.label}>Lance: {lance}%</label>
            <input type="range" min={0} max={80} value={lance} onChange={e => setLance(+e.target.value)} style={{ width: "100%" }} /></div>
          <div><label style={S.label}>Tipo de lance</label>
            <select value={tipoLance} onChange={e => setTipoLance(e.target.value as any)} style={S.input as any}>
              <option value="livre">Livre (recurso próprio)</option>
              <option value="embutido">Embutido (teto do grupo)</option>
            </select></div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button onClick={rodar} disabled={carregando}
              style={{ width: "100%", padding: "10px 0", borderRadius: 10, border: 0, cursor: "pointer",
                       background: "linear-gradient(90deg,#8FB7FF,#36C5F0,#1E6FE6)", color: "#0A0E1A", fontWeight: 800 }}>
              {carregando ? "Calculando…" : "Simular"}
            </button></div>
        </div>

        {erro && <p style={{ color: "#F87171", marginTop: 12 }}>{erro}</p>}

        {resumo && (
          <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
            {[["Crédito total", fmt(resumo.creditoTotal)], ["Cartas", resumo.cartas],
              ["Parcela total/mês", fmt(resumo.parcelaTotal)], ["Desembolso na contemplação", fmt(resumo.desembolsoTotal)],
              ["Saldo devedor pós", fmt(resumo.saldoDevedorTotal)], ["Tempo esperado", `${resumo.tempoEsperadoMeses} ass.`]]
              .map(([k, v]) => (
                <div key={String(k)} style={{ background: "#0F1526", borderRadius: 12, padding: 12, border: "1px solid #16213A" }}>
                  <div style={{ fontSize: 11, opacity: 0.6 }}>{k}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 16, color: "#8FB7FF" }}>{v}</div>
                </div>))}
          </div>
        )}

        {opcoes.length > 0 && (
          <div style={{ marginTop: 20, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: "'IBM Plex Mono',monospace" }}>
              <thead><tr style={{ color: "#8FB7FF", textAlign: "left" }}>
                {["Grupo", "Adm", "Crédito", "Parcela", "Tempo", "Corte ref.", "Hist.", "Desembolso", "TIR/mês", "Veredito"].map(h =>
                  <th key={h} style={{ padding: "8px 10px", borderBottom: "1px solid #16213A" }}>{h}</th>)}
              </tr></thead>
              <tbody>{opcoes.map((o, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #10182B" }}>
                  <td style={{ padding: "8px 10px", fontWeight: 700 }}>{o.codigo}</td>
                  <td style={{ padding: "8px 10px", opacity: .7 }}>{o.administradora}</td>
                  <td style={{ padding: "8px 10px" }}>{fmt(o.credito)}</td>
                  <td style={{ padding: "8px 10px" }}>{fmt(o.parcela)}</td>
                  <td style={{ padding: "8px 10px" }}>{o.tempoEsperadoMeses} ass.</td>
                  <td style={{ padding: "8px 10px" }}>{o.corteReferencia != null ? `${o.corteReferencia}%` : "—"}</td>
                  <td style={{ padding: "8px 10px", opacity: .7 }}>{o.mesesHistorico}m {o.tendencia && o.tendencia !== "base_1_mes" ? `· ${o.tendencia}` : ""}</td>
                  <td style={{ padding: "8px 10px" }}>{fmt(o.desembolsoContemplacao)}</td>
                  <td style={{ padding: "8px 10px", color: "#36C5F0" }}>{o.tirMes != null ? `${o.tirMes}%` : "—"}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11,
                      background: o.veredito === "vence_agora" ? "#052e16" : o.veredito === "janela_3m" ? "#1e293b" : "#27272a",
                      color: o.veredito === "vence_agora" ? "#4ade80" : o.veredito === "janela_3m" ? "#8FB7FF" : "#a1a1aa" }}>
                      {o.veredito === "vence_agora" ? "vence agora" : o.veredito === "janela_3m" ? "janela ~3 ass." : "fila"}
                    </span></td>
                </tr>))}
              </tbody>
            </table>
            <button onClick={analisarIA} style={{ marginTop: 14, padding: "10px 20px", borderRadius: 10, border: "1px solid #1E6FE6", background: "transparent", color: "#8FB7FF", cursor: "pointer", fontWeight: 700 }}>
              Analisar com IA
            </button>
            {ia && <pre style={{ whiteSpace: "pre-wrap", background: "#0F1526", border: "1px solid #16213A", borderRadius: 12, padding: 16, marginTop: 12, fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, lineHeight: 1.5 }}>{ia}</pre>}
          </div>
        )}

        <p style={{ marginTop: 32, fontSize: 11, opacity: 0.45, borderTop: "1px solid #16213A", paddingTop: 12 }}>
          Bidcon · Prospere Consórcios. Simulação de planejamento e compra programada de carta de crédito. Estimativas baseadas em histórico de assembleias; resultados passados não garantem resultados futuros. Nenhuma data de contemplação é prometida.
        </p>
      </div>
    </main>
  );
}
