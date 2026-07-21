"use client";
// /interno/simulador-disal — Simulador de planos novos Disal (boletim mensal)
// Identidade Bidcon: navy #0A0E1A, gradiente #8FB7FF→#36C5F0→#1E6FE6,
// Space Grotesk (títulos), IBM Plex Mono (números). Mesmo padrão visual do
// /interno/simulador-porto — mas SEM motor/API: dados 100% estáticos do
// boletim (lib/disal/atual.ts), zero chamada de rede.

import { useState } from "react";
import { linkWhatsApp } from "@/lib/format";
import { BOLETIM_DISAL_ATUAL } from "@/lib/disal/atual";
import type { LinhaImovel } from "@/lib/disal/types";
import {
  linhaAutoMaisProxima,
  totalAuto as calcTotalAuto,
  totalImovel as calcTotalImovel,
} from "@/lib/disal/calculo";
import { SimuladorTabNav } from "../SimuladorTabNav";

type Segmento = "veiculo" | "imovel";
type Base = "100" | "75";

const fmtValor = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtCredito = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmtPct = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

const S = {
  input: {
    background: "#111827",
    border: "1px solid #1E6FE6",
    color: "#fff",
    borderRadius: 8,
    padding: "8px 10px",
    fontFamily: "'IBM Plex Mono', monospace",
  } as const,
  label: { fontSize: 12, opacity: 0.7, display: "block", marginBottom: 4 } as const,
  pill: (ativo: boolean) =>
    ({
      padding: "8px 18px",
      borderRadius: 999,
      border: "1px solid #1E6FE6",
      cursor: "pointer",
      background: ativo ? "linear-gradient(90deg,#36C5F0,#1E6FE6)" : "transparent",
      color: ativo ? "#0A0E1A" : "#8FB7FF",
      fontWeight: 700,
    }) as const,
  card: { background: "#0F1526", borderRadius: 12, padding: 12, border: "1px solid #16213A" } as const,
};

export default function SimuladorDisal() {
  const { autosFaixaII, autosFaixaIII, imoveis220, mes } = BOLETIM_DISAL_ATUAL;

  const [segmento, setSegmento] = useState<Segmento>("veiculo");
  const [base, setBase] = useState<Base>("100");
  const [creditoAuto, setCreditoAuto] = useState<number>(autosFaixaII.linhas[12][0]); // 150.000 (linha central da Faixa II)
  const [imovelIdx, setImovelIdx] = useState(0);
  const [nomeCliente, setNomeCliente] = useState("");
  const [copiado, setCopiado] = useState(false);

  // Snap do slider pro crédito válido mais próximo — mesma lógica de
  // nearest-neighbor, agora em lib/disal/calculo.ts (reaproveitada pela tool
  // buscar_planos). Existe um furo real nos dados entre 180.000 e 190.000.
  function snapCreditoAuto(bruto: number) {
    const { linha } = linhaAutoMaisProxima(bruto, autosFaixaII, autosFaixaIII);
    setCreditoAuto(linha[0]);
  }

  const { linha: linhaAuto, faixa: faixaAuto, rotuloFaixa } = linhaAutoMaisProxima(
    creditoAuto,
    autosFaixaII,
    autosFaixaIII,
  );
  const [, codAuto, parcelaAuto100, parcelaAuto75] = linhaAuto;
  const parcelaAuto = base === "100" ? parcelaAuto100 : parcelaAuto75;
  const parcelaAutoAlt = base === "100" ? parcelaAuto75 : parcelaAuto100;
  const totalAuto = calcTotalAuto(faixaAuto, parcelaAuto);
  const custoAlemAuto = totalAuto - creditoAuto;
  const custoAlemAutoPct = (custoAlemAuto / creditoAuto) * 100;

  const linhaImovel: LinhaImovel = imoveis220.linhas[imovelIdx];
  const fasesImovel = base === "100" ? linhaImovel.b100 : linhaImovel.b75;
  const fasesImovelAlt = base === "100" ? linhaImovel.b75 : linhaImovel.b100;
  const totalImovel = calcTotalImovel(fasesImovel);
  const custoAlemImovel = totalImovel - linhaImovel.credito;
  const custoAlemImovelPct = (custoAlemImovel / linhaImovel.credito) * 100;

  function gerarTexto(): string {
    const nome = nomeCliente.trim() || "Olá";
    if (segmento === "veiculo") {
      return [
        `🚗 *Consórcio de Veículos — Disal*`,
        `_Boletim de Crédito · ${mes}_`,
        ``,
        `${nome}, segue sua simulação 👇`,
        `💳 Carta de crédito: *${fmtCredito(creditoAuto)}*`,
        `📅 Prazo: ${faixaAuto.prazo} meses (${rotuloFaixa})`,
        `🧾 Taxa de administração: ${faixaAuto.taxa} (total do plano)`,
        `📊 Correção anual: ${faixaAuto.indice} · 🛡️ Seguro prestamista incluso`,
        ``,
        `✅ *Parcela Base ${base === "100" ? "100%" : "75% Light"}: ${fmtValor(parcelaAuto)}/mês*`,
        `_(opção ${base === "100" ? "75% Light" : "Base 100%"}: ${fmtValor(parcelaAutoAlt)}/mês)_`,
        `🔖 Cód. bem: ${codAuto}`,
        ``,
        `Compra programada para o seu patrimônio, sem juros de financiamento.`,
        `Contemplação por sorteio ou lance mensal.`,
        ``,
        `*Prospere Consórcios* 🤝`,
      ].join("\n");
    }
    return [
      `🏠 *Consórcio de Imóveis — Disal*`,
      `_Boletim de Crédito · ${mes}_`,
      ``,
      `${nome}, segue sua simulação 👇`,
      `💳 Carta de crédito: *${fmtCredito(linhaImovel.credito)}*`,
      `📅 Prazo: ${imoveis220.prazo} meses`,
      `🧾 Taxa de administração: ${imoveis220.taxa} (total do plano)`,
      `📊 Correção anual: ${imoveis220.indice} · 🛡️ Seguro prestamista incluso`,
      ``,
      `✅ *Parcela Base ${base === "100" ? "100%" : "75% Light"}:*`,
      `   1ª a 12ª: ${fmtValor(fasesImovel[0])}/mês`,
      `   13ª a 219ª: ${fmtValor(fasesImovel[1])}/mês`,
      `   220ª: ${fmtValor(fasesImovel[2])}/mês`,
      `_(opção ${base === "100" ? "75% Light" : "Base 100%"}: ${fmtValor(fasesImovelAlt[0])} / ${fmtValor(fasesImovelAlt[1])} / ${fmtValor(fasesImovelAlt[2])})_`,
      `🔖 Cód. bem: ${linhaImovel.cod}`,
      ``,
      `Compra programada para o seu patrimônio, sem juros de financiamento.`,
      `Contemplação por sorteio ou lance mensal.`,
      ``,
      `*Prospere Consórcios* 🤝`,
    ].join("\n");
  }

  const textoProposta = gerarTexto();

  async function copiarProposta() {
    try {
      await navigator.clipboard.writeText(textoProposta);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // silencioso — botão "Abrir no WhatsApp" segue funcionando como alternativa
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0A0E1A",
        color: "#E5E9F0",
        fontFamily: "'Space Grotesk', system-ui, sans-serif",
        padding: "32px 16px",
      }}
    >
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <SimuladorTabNav ativo="disal" />

        <h1
          style={{
            fontSize: 28,
            margin: 0,
            background: "linear-gradient(90deg,#8FB7FF,#36C5F0,#1E6FE6)",
            WebkitBackgroundClip: "text",
            color: "transparent",
          }}
        >
          Disal · Planos novos
        </h1>
        <p style={{ opacity: 0.6, marginTop: 4, fontSize: 13 }}>
          Boletim de Crédito · {mes} — parcelas com seguro prestamista incluso. Contemplação por sorteio ou lance
          mensal, nunca prometida por data.
        </p>

        <div style={{ display: "flex", gap: 8, margin: "20px 0" }}>
          {(["veiculo", "imovel"] as const).map((s) => (
            <button key={s} onClick={() => setSegmento(s)} style={S.pill(segmento === s)}>
              {s === "veiculo" ? "Veículos" : "Imóveis"}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {(["100", "75"] as const).map((b) => (
            <button key={b} onClick={() => setBase(b)} style={S.pill(base === b)}>
              {b === "100" ? "Base 100%" : "Base 75% Light"}
            </button>
          ))}
          <span style={{ fontSize: 11, opacity: 0.55, maxWidth: 420 }}>
            As taxas incidem sobre 100% do crédito; na contemplação o consorciado escolhe manter 75% ou elevar a
            100%.
          </span>
        </div>

        {segmento === "veiculo" ? (
          <>
            <div
              style={{
                marginTop: 20,
                background: "#0F1526",
                padding: 16,
                borderRadius: 14,
                border: "1px solid #16213A",
              }}
            >
              <label style={S.label}>Carta de crédito: {fmtCredito(creditoAuto)}</label>
              <input
                type="range"
                min={90000}
                max={380000}
                step={5000}
                value={creditoAuto}
                onChange={(e) => snapCreditoAuto(+e.target.value)}
                style={{ width: "100%" }}
              />
              <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
                {rotuloFaixa} · prazo {faixaAuto.prazo} meses · taxa {faixaAuto.taxa} · índice {faixaAuto.indice} ·
                cód. bem {codAuto}
              </div>
            </div>

            <div
              style={{
                marginTop: 20,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
                gap: 10,
              }}
            >
              {[
                ["Carta de crédito", fmtCredito(creditoAuto)],
                [`Parcela (${base === "100" ? "Base 100%" : "75% Light"})`, `${fmtValor(parcelaAuto)}/mês`],
                [`Parcela (${base === "100" ? "75% Light" : "Base 100%"})`, `${fmtValor(parcelaAutoAlt)}/mês`],
                ["Total do plano (sem reajustes)", fmtValor(totalAuto)],
                ["Custo além do crédito", `${fmtValor(custoAlemAuto)} (${fmtPct(custoAlemAutoPct)})`],
              ].map(([k, v]) => (
                <div key={String(k)} style={S.card}>
                  <div style={{ fontSize: 11, opacity: 0.6 }}>{k}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 16, color: "#8FB7FF" }}>{v}</div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, marginTop: 20, flexWrap: "wrap" }}>
              {imoveis220.linhas.map((l, i) => (
                <button key={l.cod} onClick={() => setImovelIdx(i)} style={S.pill(imovelIdx === i)}>
                  {fmtCredito(l.credito)}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 8 }}>
              Plano {imoveis220.prazo} meses · taxa {imoveis220.taxa} · índice {imoveis220.indice} · cód. bem{" "}
              {linhaImovel.cod}
            </div>

            <div
              style={{
                marginTop: 20,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
                gap: 10,
              }}
            >
              {[
                ["Carta de crédito", fmtCredito(linhaImovel.credito)],
                [`Parcela 1ª–12ª (${base === "100" ? "Base 100%" : "75% Light"})`, `${fmtValor(fasesImovel[0])}/mês`],
                [`Parcela 13ª–219ª (${base === "100" ? "Base 100%" : "75% Light"})`, `${fmtValor(fasesImovel[1])}/mês`],
                [`Parcela 220ª (${base === "100" ? "Base 100%" : "75% Light"})`, `${fmtValor(fasesImovel[2])}/mês`],
                ["Total do plano (sem reajustes)", fmtValor(totalImovel)],
                ["Custo além do crédito", `${fmtValor(custoAlemImovel)} (${fmtPct(custoAlemImovelPct)})`],
              ].map(([k, v]) => (
                <div key={String(k)} style={S.card}>
                  <div style={{ fontSize: 11, opacity: 0.6 }}>{k}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 16, color: "#8FB7FF" }}>{v}</div>
                </div>
              ))}
            </div>
          </>
        )}

        <div
          style={{
            marginTop: 28,
            background: "#0F1526",
            padding: 16,
            borderRadius: 14,
            border: "1px solid #16213A",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: "#8FB7FF" }}>
            Gerador de proposta WhatsApp
          </div>
          <label style={S.label}>Nome do cliente (opcional)</label>
          <input
            type="text"
            value={nomeCliente}
            onChange={(e) => setNomeCliente(e.target.value)}
            placeholder="Ex.: Maria"
            style={{ ...S.input, width: "100%", maxWidth: 320, marginBottom: 12 } as any}
          />
          <pre
            style={{
              whiteSpace: "pre-wrap",
              background: "#0A0E1A",
              border: "1px solid #16213A",
              borderRadius: 10,
              padding: 14,
              fontFamily: "'Space Grotesk',sans-serif",
              fontSize: 13,
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            {textoProposta}
          </pre>
          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <button
              onClick={copiarProposta}
              style={{
                padding: "10px 20px",
                borderRadius: 10,
                border: "1px solid #1E6FE6",
                background: "transparent",
                color: "#8FB7FF",
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              {copiado ? "Copiado ✓" : "Copiar proposta"}
            </button>
            <a
              href={linkWhatsApp("", textoProposta)}
              target="_blank"
              rel="noreferrer"
              style={{
                padding: "10px 20px",
                borderRadius: 10,
                border: 0,
                cursor: "pointer",
                background: "linear-gradient(90deg,#8FB7FF,#36C5F0,#1E6FE6)",
                color: "#0A0E1A",
                fontWeight: 800,
                textDecoration: "none",
                display: "inline-block",
              }}
            >
              Abrir no WhatsApp
            </a>
          </div>
        </div>

        <p style={{ marginTop: 32, fontSize: 11, opacity: 0.45, borderTop: "1px solid #16213A", paddingTop: 12 }}>
          Bidcon · Prospere Consórcios. Simulação ilustrativa de planejamento e compra programada de carta de
          crédito, com seguro prestamista incluso. Correção anual por {segmento === "veiculo" ? "IPCA" : "INCC"}.
          Disal Adm. de Consórcios Ltda — Certif. nº 03/00/057/89, grupo fiscalizado pelo Banco Central. Consulte o
          contrato de adesão e o regulamento do grupo. Nenhuma data de contemplação é prometida — sorteio ou lance
          mensal.
        </p>
      </div>
    </main>
  );
}
