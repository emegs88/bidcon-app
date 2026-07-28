"use client";
// /interno/simulador-porto — Simulador de grupos em andamento (multi-administradora)
// Identidade Bidcon: navy #0A0E1A, gradiente #8FB7FF→#36C5F0→#1E6FE6,
// Space Grotesk (títulos), IBM Plex Mono (números).
// Requer as rotas /api/analista-grupos, /api/analista-ia e /api/interpretar deste pacote.

import { useEffect, useState } from "react";
import { SimuladorTabNav } from "../SimuladorTabNav";

const fmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmtCent = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Segmento = "auto" | "imovel" | "pesados";
type Modalidade = "venda_nova" | "contemplada";
type TipoLance = "livre" | "embutido";
type Parcelamento = "qualquer" | "a_vista" | "3x" | "5x" | "12x";

type ComissaoProspere = {
  pctTotal: number; totalRS: number; cronogramaRS: number[];
  parcelas: number; observacao: string | null;
};

type Opcao = {
  codigo: string; administradora: string; segmento: string;
  credito: number; creditoLiquido: number; parcela: number;
  tempoEsperadoMeses: number; lancePct: number; lanceProprioRS: number;
  modalidade: Modalidade;
  comissaoRS: number; comissaoProspere: ComissaoProspere | null;
  desembolsoContemplacao: number;
  saldoDevedorPos: number; parcelasRestantesPos: number;
  tirMes: number | null; tirMesComIndice: number | null; indiceLabel: "INCC" | "IPCA" | null;
  corteReferencia: number | null;
  tendencia: string | null; mesesHistorico: number; veredito: string;
};

type Indice = { acumulado12m: number | null; atualizadoEm: string };
type Indices = { incc: Indice; ipca: Indice; igpm: Indice };

// parâmetros de uma rodada — o que a caixa de conversa preenche e os
// controles da tela editam. rodar() aceita um override para não depender
// do setState (assíncrono) logo depois de interpretar a frase.
type Params = {
  aba: "ranking" | "juncao";
  segmento: Segmento;
  credito: number;
  alvo: number;
  lance: number;
  tipoLance: TipoLance;
  modalidade: Modalidade;
  parcelamento: Parcelamento;
  codigo: string | null;
};

// ▲ subindo = mais caro vencer; ▼ caindo = janela abrindo; — estável
function Tendencia({ t, meses }: { t: string | null; meses: number }) {
  const base = { fontFamily: "'IBM Plex Mono',monospace" } as const;
  if (!t || t === "base_1_mes") {
    return <span style={{ ...base, opacity: 0.6 }}>{meses}m · base curta</span>;
  }
  const mapa: Record<string, { seta: string; cor: string; texto: string }> = {
    subindo: { seta: "▲", cor: "#F87171", texto: "subindo" },
    caindo: { seta: "▼", cor: "#4ade80", texto: "caindo" },
    estavel: { seta: "—", cor: "#a1a1aa", texto: "estável" },
  };
  const m = mapa[t];
  if (!m) return <span style={{ ...base, opacity: 0.7 }}>{meses}m · {t}</span>;
  return (
    <span style={{ ...base, color: m.cor }} title={
      t === "subindo" ? "corte subindo — está mais caro vencer"
      : t === "caindo" ? "corte caindo — janela abrindo"
      : "corte estável"}>
      {m.seta} {meses}m · {m.texto}
    </span>
  );
}

function linhaCronograma(cron: number[]): string {
  if (!cron.length) return "—";
  const todosIguais = cron.every(v => Math.abs(v - cron[0]) < 0.01);
  if (todosIguais) return `${cron.length}× ${fmtCent(cron[0])}`;
  return cron.map((v, i) => `${i + 1}ª ${fmtCent(v)}`).join(" · ");
}

export default function SimuladorPorto() {
  const [aba, setAba] = useState<"ranking" | "juncao">("ranking");
  const [segmento, setSegmento] = useState<Segmento>("auto");
  const [credito, setCredito] = useState(100000);
  const [alvo, setAlvo] = useState(1000000);
  const [lance, setLance] = useState(30);
  const [tipoLance, setTipoLance] = useState<TipoLance>("livre");
  const [modalidade, setModalidade] = useState<Modalidade>("venda_nova");
  const [parcelamento, setParcelamento] = useState<Parcelamento>("qualquer");
  const [carregando, setCarregando] = useState(false);
  const [opcoes, setOpcoes] = useState<Opcao[]>([]);
  const [resumo, setResumo] = useState<any>(null);
  const [ia, setIa] = useState("");
  const [erro, setErro] = useState("");
  const [indices, setIndices] = useState<Indices | null>(null);
  const [frase, setFrase] = useState("");
  const [interpretando, setInterpretando] = useState(false);
  const [resumoPedido, setResumoPedido] = useState("");

  useEffect(() => {
    fetch("/api/indices")
      .then((r) => r.json())
      .then((d) => { if (d?.indices) setIndices(d.indices); })
      .catch(() => {});
  }, []);

  // reajuste anual: imóvel acompanha INCC 12m acumulado; auto mantém a parcela
  // (o valor do bem é quem se ajusta, não a parcela do consórcio).
  function parcelaPosReajuste(o: Opcao): { valor: number; projetado: boolean } {
    if (o.segmento === "imovel" && indices?.incc?.acumulado12m != null) {
      return { valor: o.parcela * (1 + indices.incc.acumulado12m / 100), projetado: true };
    }
    return { valor: o.parcela, projetado: false };
  }

  async function rodar(over?: Partial<Params>) {
    const p: Params = {
      aba, segmento, credito, alvo, lance, tipoLance, modalidade, parcelamento, codigo: null,
      ...over,
    };
    setCarregando(true); setErro(""); setIa(""); setResumo(null); setOpcoes([]);
    try {
      const comum = {
        segmento: p.segmento,
        lancePct: p.lance,
        tipoLance: p.tipoLance,
        modalidade: p.modalidade,
        parcelamentoAdesao: p.parcelamento,
      };
      const body =
        p.codigo
          ? { modo: "grupo", codigo: p.codigo, credito: p.credito, ...comum }
          : p.aba === "ranking"
            ? { modo: "ranking", credito: p.credito, limite: 8, ...comum }
            : { modo: "juncao", creditoAlvo: p.alvo, ...comum };
      const r = await fetch("/api/analista-grupos", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (d.erro) throw new Error(d.erro);
      if (p.codigo) setOpcoes(d.opcao ? [d.opcao] : []);
      else if (p.aba === "ranking") setOpcoes(d.opcoes ?? []);
      else { setResumo(d.resumo); setOpcoes(d.cartas ?? []); }
    } catch (e: any) { setErro(e.message); } finally { setCarregando(false); }
  }

  // Caixa de conversa: a IA só extrai parâmetros; quem calcula é o motor.
  // Os valores voltam para os controles da tela, para o vendedor conferir
  // e poder ajustar antes/depois de rodar.
  async function interpretar() {
    if (!frase.trim()) return;
    setInterpretando(true); setErro(""); setResumoPedido("");
    try {
      const r = await fetch("/api/interpretar", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ texto: frase }),
      });
      const d = await r.json();
      if (r.status === 422) { setErro("Não entendi — tente reescrever."); return; }
      if (!r.ok || d.erro) throw new Error(d.erro ?? "não consegui interpretar");

      const q = d.parametros ?? {};
      const novaAba: "ranking" | "juncao" = q.modo === "juncao" ? "juncao" : "ranking";
      const novo: Params = {
        aba: novaAba,
        segmento: (["auto", "imovel", "pesados"] as const).includes(q.segmento) ? q.segmento : segmento,
        credito: q.credito != null ? Number(q.credito) : credito,
        alvo: q.creditoAlvo != null ? Number(q.creditoAlvo) : alvo,
        lance: q.lancePct != null ? Number(q.lancePct) : lance,
        tipoLance: q.tipoLance === "embutido" ? "embutido" : "livre",
        modalidade: q.modalidade === "contemplada" ? "contemplada" : "venda_nova",
        parcelamento: (["a_vista", "3x", "5x", "12x"] as const).includes(q.parcelamentoAdesao)
          ? q.parcelamentoAdesao : "qualquer",
        codigo: q.modo === "grupo" && q.codigo ? String(q.codigo) : null,
      };

      // 1) preenche os controles (o vendedor vê e pode ajustar)
      setAba(novo.aba); setSegmento(novo.segmento); setCredito(novo.credito); setAlvo(novo.alvo);
      setLance(novo.lance); setTipoLance(novo.tipoLance); setModalidade(novo.modalidade);
      setParcelamento(novo.parcelamento);
      setResumoPedido(d.resumoPedido ?? "");
      // 2) roda com esses valores (sem depender do setState)
      await rodar(novo);
    } catch (e: any) {
      setErro(e.message ?? "não consegui interpretar");
    } finally { setInterpretando(false); }
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

  const pill = (ativo: boolean) => ({
    padding: "8px 18px", borderRadius: 999, border: "1px solid #1E6FE6", cursor: "pointer",
    background: ativo ? "linear-gradient(90deg,#36C5F0,#1E6FE6)" : "transparent",
    color: ativo ? "#0A0E1A" : "#8FB7FF", fontWeight: 700,
  } as const);

  // comissão a exibir: no ranking é por carta (mesmo crédito e segmento em
  // todas as linhas); na junção é o consolidado devolvido pelo motor.
  const comissaoCarta = opcoes.find(o => o.comissaoProspere)?.comissaoProspere ?? null;
  const comissaoJuncaoTotal: number | null = resumo?.comissaoProspereTotal ?? null;
  const comissaoJuncaoCron: number[] | null = resumo?.comissaoProspereCronograma ?? null;
  const mostraComissao =
    modalidade === "venda_nova" && (aba === "juncao" ? comissaoJuncaoTotal != null : comissaoCarta != null);

  return (
    <main style={{ minHeight: "100vh", background: "#0A0E1A", color: "#E5E9F0", fontFamily: "'Space Grotesk', system-ui, sans-serif", padding: "32px 16px" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <SimuladorTabNav ativo="porto" />
        <h1 style={{ fontSize: 28, margin: 0, background: "linear-gradient(90deg,#8FB7FF,#36C5F0,#1E6FE6)", WebkitBackgroundClip: "text", color: "transparent" }}>
          Analista de Grupos · Bidcon
        </h1>
        <p style={{ opacity: 0.6, marginTop: 4, fontSize: 13 }}>
          Tempos são estimativas estatísticas — nunca prometemos data de contemplação. Custo financeiro medido por TIR ao mês.
        </p>

        {/* caixa de conversa — atalho para preencher os controles, não substituto deles */}
        <div style={{ marginTop: 18, background: "#0F1526", border: "1px solid #16213A", borderRadius: 14, padding: 14 }}>
          <label style={S.label} htmlFor="frase">Simular conversando</label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              id="frase" type="text" value={frase}
              onChange={e => setFrase(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !interpretando) interpretar(); }}
              placeholder="Ex.: cliente quer 300 mil em imóvel e tem 80 mil de lance"
              style={{ ...S.input, flex: "1 1 420px", minWidth: 0, fontFamily: "'Space Grotesk', sans-serif" } as any}
            />
            <button onClick={() => interpretar()} disabled={interpretando || carregando}
              style={{ padding: "10px 26px", borderRadius: 10, border: 0, cursor: "pointer",
                       background: "linear-gradient(90deg,#8FB7FF,#36C5F0,#1E6FE6)", color: "#0A0E1A", fontWeight: 800 }}>
              {interpretando ? "Lendo…" : "Simular"}
            </button>
          </div>
          <p style={{ fontSize: 11, opacity: 0.5, margin: "8px 0 0" }}>
            A frase só preenche os controles abaixo — todo cálculo continua no motor.
          </p>
        </div>

        {indices && (
          <div style={{ marginTop: 12, display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center",
                        background: "#0F1526", border: "1px solid #16213A", borderRadius: 10, padding: "8px 14px" }}>
            <span style={{ fontSize: 11, opacity: 0.6, fontWeight: 700 }}>Índices oficiais (BCB) · 12m acum.</span>
            <span style={{ fontSize: 12, fontFamily: "'IBM Plex Mono',monospace", opacity: 0.85 }}>
              INCC-DI: {indices.incc.acumulado12m != null ? `${indices.incc.acumulado12m}%` : "—"}
            </span>
            <span style={{ fontSize: 12, fontFamily: "'IBM Plex Mono',monospace", opacity: 0.85 }}>
              IPCA: {indices.ipca.acumulado12m != null ? `${indices.ipca.acumulado12m}%` : "—"}
            </span>
            <span style={{ fontSize: 12, fontFamily: "'IBM Plex Mono',monospace", opacity: 0.85 }}>
              IGP-M: {indices.igpm.acumulado12m != null ? `${indices.igpm.acumulado12m}%` : "—"}
            </span>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, margin: "20px 0", flexWrap: "wrap", alignItems: "center" }}>
          {(["ranking", "juncao"] as const).map(a => (
            <button key={a} onClick={() => setAba(a)} style={pill(aba === a)}>
              {a === "ranking" ? "Melhores grupos" : "Junção de cartas"}
            </button>
          ))}
          <span style={{ width: 1, alignSelf: "stretch", background: "#16213A", margin: "0 6px" }} />
          {([
            ["venda_nova", "Venda nova (cota não contemplada)"],
            ["contemplada", "Cota contemplada (Bidcon)"],
          ] as const).map(([m, label]) => (
            <button key={m} onClick={() => setModalidade(m)} style={pill(modalidade === m)}
              title={m === "venda_nova"
                ? "Cota não contemplada: o cliente não paga os 7% Bidcon."
                : "Marketplace Bidcon: 7% do crédito somados à entrada."}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, background: "#0F1526", padding: 16, borderRadius: 14, border: "1px solid #16213A" }}>
          <div><label style={S.label}>Segmento</label>
            <select value={segmento} onChange={e => setSegmento(e.target.value as Segmento)} style={S.input as any}>
              <option value="auto">Auto</option>
              <option value="imovel">Imóvel</option>
              <option value="pesados">Pesados</option>
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
            <select value={tipoLance} onChange={e => setTipoLance(e.target.value as TipoLance)} style={S.input as any}>
              <option value="livre">Livre (recurso próprio)</option>
              <option value="embutido">Embutido (teto do grupo)</option>
            </select></div>
          {/* só imóvel tem grade de comissão por parcelamento da adesão */}
          {modalidade === "venda_nova" && segmento === "imovel" && (
            <div><label style={S.label}>Parcelamento da adesão</label>
              <select value={parcelamento} onChange={e => setParcelamento(e.target.value as Parcelamento)} style={S.input as any}>
                <option value="qualquer">Padrão (à vista)</option>
                <option value="a_vista">À vista</option>
                <option value="3x">3x</option>
                <option value="5x">5x</option>
                <option value="12x">12x</option>
              </select></div>
          )}
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button onClick={() => rodar()} disabled={carregando}
              style={{ width: "100%", padding: "10px 0", borderRadius: 10, border: 0, cursor: "pointer",
                       background: "linear-gradient(90deg,#8FB7FF,#36C5F0,#1E6FE6)", color: "#0A0E1A", fontWeight: 800 }}>
              {carregando ? "Calculando…" : "Simular"}
            </button></div>
        </div>

        {erro && <p style={{ color: "#F87171", marginTop: 12 }}>{erro}</p>}

        {resumoPedido && (
          <p style={{ marginTop: 14, marginBottom: 0, fontSize: 12, opacity: 0.65, fontStyle: "italic" }}>
            Entendi: {resumoPedido}
          </p>
        )}

        {resumo && (
          <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
            {[["Crédito total", fmt(resumo.creditoTotal)], ["Cartas", resumo.cartas],
              ["Grupos distintos", resumo.gruposDistintos ?? "—"],
              ["Parcela total/mês", fmt(resumo.parcelaTotal)],
              ["Parcela total pós-reajuste (12m)", fmt(opcoes.reduce((s, o) => s + parcelaPosReajuste(o).valor, 0))],
              ["Desembolso na contemplação", fmt(resumo.desembolsoTotal)],
              ["Saldo devedor pós", fmt(resumo.saldoDevedorTotal)], ["Tempo esperado", `${resumo.tempoEsperadoMeses} ass.`],
              ["TIR média", resumo.tirMedia != null ? `${resumo.tirMedia}%` : "—"],
              ["TIR média (com índice)", resumo.tirMediaComIndice != null ? `${resumo.tirMediaComIndice}% — estimativa` : "—"]]
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
                {["Grupo", "Adm", "Crédito", "Parcela", "Pós-reajuste (12m)", "Tempo", "Corte ref.", "Hist.", "Desembolso", "TIR/mês", "TIR/mês (com índice)", "Veredito"].map(h =>
                  <th key={h} style={{ padding: "8px 10px", borderBottom: "1px solid #16213A" }}>{h}</th>)}
              </tr></thead>
              <tbody>{opcoes.map((o, i) => {
                const pos = parcelaPosReajuste(o);
                return (
                <tr key={i} style={{ borderBottom: "1px solid #10182B" }}>
                  <td style={{ padding: "8px 10px", fontWeight: 700 }}>{o.codigo}</td>
                  <td style={{ padding: "8px 10px", opacity: .7 }}>{o.administradora}</td>
                  <td style={{ padding: "8px 10px" }}>{fmt(o.credito)}</td>
                  <td style={{ padding: "8px 10px" }}>{fmt(o.parcela)}</td>
                  <td style={{ padding: "8px 10px" }}>
                    {fmt(pos.valor)}
                    {!pos.projetado && (
                      <div style={{ fontSize: 10, opacity: 0.5 }}>reajuste acompanha o valor do bem</div>
                    )}
                  </td>
                  <td style={{ padding: "8px 10px" }}>{o.tempoEsperadoMeses} ass.</td>
                  <td style={{ padding: "8px 10px" }}>{o.corteReferencia != null ? `${o.corteReferencia}%` : "—"}</td>
                  <td style={{ padding: "8px 10px" }}><Tendencia t={o.tendencia} meses={o.mesesHistorico} /></td>
                  <td style={{ padding: "8px 10px" }}>{fmt(o.desembolsoContemplacao)}</td>
                  <td style={{ padding: "8px 10px", color: "#36C5F0" }}>{o.tirMes != null ? `${o.tirMes}%` : "—"}</td>
                  <td style={{ padding: "8px 10px", color: "#8FB7FF" }}>
                    {o.tirMesComIndice != null
                      ? `${o.tirMesComIndice}% ${o.indiceLabel ?? ""}`.trim()
                      : "—"}
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11,
                      background: o.veredito === "vence_agora" ? "#052e16" : o.veredito === "janela_3m" ? "#1e293b" : "#27272a",
                      color: o.veredito === "vence_agora" ? "#4ade80" : o.veredito === "janela_3m" ? "#8FB7FF" : "#a1a1aa" }}>
                      {o.veredito === "vence_agora" ? "vence agora" : o.veredito === "janela_3m" ? "janela ~3 ass." : "fila"}
                    </span></td>
                </tr>
                );
              })}
              </tbody>
            </table>

            {/* Comissão Prospere: receita da corretora, nunca custo do cliente.
                Só aparece em venda nova. */}
            {mostraComissao && (
              <div style={{ marginTop: 16, background: "#0F1526", border: "1px solid #16213A", borderRadius: 14, padding: 16 }}>
                <div style={{ fontSize: 12, opacity: 0.6, fontWeight: 700, marginBottom: 8 }}>
                  Comissão Prospere {aba === "juncao" ? "· consolidado da junção" : `· por carta de ${fmt(opcoes[0]?.credito ?? 0)}`}
                </div>
                <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "baseline" }}>
                  <div>
                    <div style={{ fontSize: 11, opacity: 0.6 }}>Total</div>
                    <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 20, color: "#8FB7FF" }}>
                      {fmtCent(aba === "juncao" ? (comissaoJuncaoTotal ?? 0) : (comissaoCarta?.totalRS ?? 0))}
                    </div>
                    {aba !== "juncao" && comissaoCarta && (
                      <div style={{ fontSize: 11, opacity: 0.5 }}>
                        {String(comissaoCarta.pctTotal).replace(".", ",")}% do crédito
                      </div>
                    )}
                  </div>
                  <div>
                    <div style={{ fontSize: 11, opacity: 0.6 }}>Cronograma de recebimento</div>
                    <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 14, color: "#E5E9F0" }}>
                      {linhaCronograma(aba === "juncao" ? (comissaoJuncaoCron ?? []) : (comissaoCarta?.cronogramaRS ?? []))}
                    </div>
                  </div>
                </div>
                <p style={{ fontSize: 11, opacity: 0.6, marginTop: 12, marginBottom: 0 }}>
                  Recebimento condicionado ao pagamento das parcelas pelo cliente. Não considera período de campanha.
                </p>
              </div>
            )}

            <button onClick={analisarIA} style={{ marginTop: 14, padding: "10px 20px", borderRadius: 10, border: "1px solid #1E6FE6", background: "transparent", color: "#8FB7FF", cursor: "pointer", fontWeight: 700 }}>
              Analisar com IA
            </button>
            {ia && <pre style={{ whiteSpace: "pre-wrap", background: "#0F1526", border: "1px solid #16213A", borderRadius: 12, padding: 16, marginTop: 12, fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, lineHeight: 1.5 }}>{ia}</pre>}
          </div>
        )}

        <p style={{ marginTop: 32, fontSize: 11, opacity: 0.45, borderTop: "1px solid #16213A", paddingTop: 12 }}>
          Bidcon · Prospere Consórcios. Simulação de planejamento e compra programada de carta de crédito. Estimativas baseadas em histórico de assembleias; resultados passados não garantem resultados futuros. Nenhuma data de contemplação é prometida.
          <br />
          Reajuste anual no aniversário do grupo; índices BCB/FGV.
        </p>
      </div>
    </main>
  );
}
