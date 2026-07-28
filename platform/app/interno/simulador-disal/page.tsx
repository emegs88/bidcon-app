"use client";
// /interno/simulador-disal — Simulador de planos novos Disal (boletim mensal)
// Identidade Bidcon: navy #0A0E1A, gradiente #8FB7FF→#36C5F0→#1E6FE6,
// Space Grotesk (títulos), IBM Plex Mono (números). Mesmo padrão visual do
// /interno/simulador-porto — mas SEM motor/API: dados 100% estáticos do
// boletim (lib/disal/atual.ts), zero chamada de rede.

import { useEffect, useState } from "react";
import { linkWhatsApp } from "@/lib/format";
import { BOLETIM_DISAL_ATUAL } from "@/lib/disal/atual";
import type { LinhaImovel } from "@/lib/disal/types";
import {
  linhaAutoMaisProxima,
  totalAuto as calcTotalAuto,
  totalImovel as calcTotalImovel,
} from "@/lib/disal/calculo";
import {
  custoEfetivoPlanoNovo,
  custoEfetivoCarteira,
  formatarCustoEfetivoTexto,
  chaveIndiceBcb,
  type FaseFluxo,
} from "@/lib/disal/custo-efetivo-plano-novo";
import {
  resumirCarteira,
  descreverFases,
  QTD_MIN,
  QTD_MAX,
  type ItemCarteira,
} from "@/lib/disal/carteira";
import { SimuladorTabNav } from "../SimuladorTabNav";

type Segmento = "veiculo" | "imovel";
type Base = "100" | "75";

// O item guarda TAMBÉM as fases da Base 100% além das da base escolhida.
// Motivo: a exibição e a linha do tempo usam a base que o vendedor escolheu,
// mas o custo efetivo continua saindo da Base 100%, como já é a convenção
// desta tela e da tool buscar_planos. Rodar a TIR sobre parcelas de 75%
// contra o crédito cheio produziria um custo menor do que o real — número
// de custo errado é pior que ausência de número.
type ItemCarteiraUI = ItemCarteira & { fasesBase100: FaseFluxo[] };

// Acima deste volume a proposta deixa de ser rotina comercial.
const COTAS_VOLUME_ALTO = 20;

// Cenário de referência do mês de contemplação — mesmo default usado pela
// tool buscar_planos (regra permanente "toda simulação termina em TIR").
// Sem slider aqui de propósito: isso fica só no simulador-cliente estático.
const C_REF = { veiculo: 24, imovel: 36 } as const;
const FASES_IMOVEL_MESES: [number, number, number] = [12, 207, 1];

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
  const [itens, setItens] = useState<ItemCarteiraUI[]>([]);

  // Índices BCB (INCC/IPCA) pro custo efetivo "com correção projetada" —
  // mesma fonte real (acumulado 12m) que a tool buscar_planos usa. Nunca
  // inventa valor: se a chamada falhar, indiceAnualPct fica null e o texto
  // de custo efetivo já sai com o fallback "projeção indisponível".
  const [indicesBcb, setIndicesBcb] = useState<Record<string, { acumulado12m: number | null }> | null>(null);
  useEffect(() => {
    fetch("/api/indices")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setIndicesBcb(data?.indices ?? null))
      .catch(() => setIndicesBcb(null));
  }, []);

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

  // Custo efetivo (TIR) — regra permanente "toda simulação termina em TIR".
  // Sempre calculado sobre a Base 100% (referência), independente da base
  // selecionada na UI — mesma convenção da tool buscar_planos.
  const indiceChaveAuto = chaveIndiceBcb(faixaAuto.indice);
  const indiceAnualPctAuto = indiceChaveAuto ? indicesBcb?.[indiceChaveAuto]?.acumulado12m ?? null : null;
  const fasesBase100Auto: FaseFluxo[] = [{ meses: faixaAuto.prazo, valor: parcelaAuto100 }];
  const custoEfetivoTextoAuto = formatarCustoEfetivoTexto({
    resultado: custoEfetivoPlanoNovo({
      fases: fasesBase100Auto,
      credito: creditoAuto,
      C: C_REF.veiculo,
      indiceAnualPct: indiceAnualPctAuto,
    }),
    C: C_REF.veiculo,
    indiceNome: faixaAuto.indice,
    indiceAnualPct: indiceAnualPctAuto,
  });

  const linhaImovel: LinhaImovel = imoveis220.linhas[imovelIdx];
  const fasesImovel = base === "100" ? linhaImovel.b100 : linhaImovel.b75;
  const fasesImovelAlt = base === "100" ? linhaImovel.b75 : linhaImovel.b100;
  const totalImovel = calcTotalImovel(fasesImovel);
  const custoAlemImovel = totalImovel - linhaImovel.credito;
  const custoAlemImovelPct = (custoAlemImovel / linhaImovel.credito) * 100;

  const indiceChaveImovel = chaveIndiceBcb(imoveis220.indice);
  const indiceAnualPctImovel = indiceChaveImovel ? indicesBcb?.[indiceChaveImovel]?.acumulado12m ?? null : null;
  const fasesBase100Imovel: FaseFluxo[] = FASES_IMOVEL_MESES.map((meses, i) => ({ meses, valor: linhaImovel.b100[i] }));
  const custoEfetivoTextoImovel = formatarCustoEfetivoTexto({
    resultado: custoEfetivoPlanoNovo({
      fases: fasesBase100Imovel,
      credito: linhaImovel.credito,
      C: C_REF.imovel,
      indiceAnualPct: indiceAnualPctImovel,
    }),
    C: C_REF.imovel,
    indiceNome: imoveis220.indice,
    indiceAnualPct: indiceAnualPctImovel,
  });

  // ---------------------------------------------------------------------
  // Carteira multi-cota
  // ---------------------------------------------------------------------
  // Identidade do item: tipo + código do bem + crédito + base. O MD pede
  // "mesmo cod + base", mas o código do bem se repete entre créditos
  // diferentes do boletim — incluir o crédito impede fundir duas cartas
  // distintas numa linha só.
  function itemAtual(): ItemCarteiraUI {
    if (segmento === "veiculo") {
      return {
        id: `veiculo|${codAuto}|${creditoAuto}|${base}`,
        tipo: "veiculo",
        rotulo: `Veículo · ${fmtCredito(creditoAuto)} · ${rotuloFaixa}`,
        cod: codAuto,
        credito: creditoAuto,
        quantidade: 1,
        base,
        prazo: faixaAuto.prazo,
        taxa: faixaAuto.taxa,
        indice: faixaAuto.indice,
        fases: [{ meses: faixaAuto.prazo, valor: parcelaAuto }],
        fasesBase100: fasesBase100Auto,
      };
    }
    return {
      id: `imovel|${linhaImovel.cod}|${linhaImovel.credito}|${base}`,
      tipo: "imovel",
      rotulo: `Imóvel · ${fmtCredito(linhaImovel.credito)}`,
      cod: linhaImovel.cod,
      credito: linhaImovel.credito,
      quantidade: 1,
      base,
      prazo: imoveis220.prazo,
      taxa: imoveis220.taxa,
      indice: imoveis220.indice,
      fases: FASES_IMOVEL_MESES.map((meses, i) => ({ meses, valor: fasesImovel[i] })),
      fasesBase100: fasesBase100Imovel,
    };
  }

  function adicionarACarteira() {
    const novo = itemAtual();
    setItens((atual) => {
      const i = atual.findIndex((x) => x.id === novo.id);
      if (i < 0) return [...atual, novo];
      const copia = [...atual];
      copia[i] = { ...copia[i], quantidade: Math.min(QTD_MAX, copia[i].quantidade + 1) };
      return copia;
    });
  }

  function mudarQuantidade(id: string, valor: number) {
    const q = Math.max(QTD_MIN, Math.min(QTD_MAX, Math.round(valor) || QTD_MIN));
    setItens((atual) => atual.map((x) => (x.id === id ? { ...x, quantidade: q } : x)));
  }

  function removerItem(id: string) {
    setItens((atual) => atual.filter((x) => x.id !== id));
  }

  const carteira = resumirCarteira(itens);
  const temCarteira = itens.length > 0 && carteira.cotas > 0;
  const linhasFases = descreverFases(carteira.fases, fmtValor);

  // Um índice só vale para a carteira toda quando TODAS as cotas seguem o
  // mesmo. Carteira mista (veículo IPCA + imóvel INCC) não tem fator único:
  // passa null e a projeção sai como indisponível, em vez de um número que
  // não corresponde a nenhum contrato.
  const indicesDaCarteira = new Set(itens.filter((i) => i.quantidade > 0).map((i) => i.indice));
  const indiceNomeCarteira = indicesDaCarteira.size === 1 ? [...indicesDaCarteira][0] : undefined;
  const chaveIndiceCarteira = indiceNomeCarteira ? chaveIndiceBcb(indiceNomeCarteira) : null;
  const indiceAnualPctCarteira = chaveIndiceCarteira
    ? indicesBcb?.[chaveIndiceCarteira]?.acumulado12m ?? null
    : null;

  // Cenário declarado: cada tipo recebe a carta no seu próprio mês de
  // referência, então numa carteira mista o texto precisa citar os dois.
  const tiposNaCarteira = new Set(itens.filter((i) => i.quantidade > 0).map((i) => i.tipo));
  const cenarioCarteira =
    tiposNaCarteira.size > 1
      ? `carta de crédito no mês ${C_REF.veiculo} no veículo e ${C_REF.imovel} no imóvel`
      : tiposNaCarteira.has("imovel")
        ? `carta de crédito no mês ${C_REF.imovel}`
        : `carta de crédito no mês ${C_REF.veiculo}`;

  const custoEfetivoTextoCarteira = temCarteira
    ? formatarCustoEfetivoTexto({
        resultado: custoEfetivoCarteira({
          // TIR sempre sobre a Base 100% — ver nota em ItemCarteiraUI.
          itens: itens.map((i) => ({ ...i, fases: i.fasesBase100 })),
          C: C_REF,
          indiceAnualPct: indiceAnualPctCarteira,
        }),
        C: C_REF.imovel,
        cenario: cenarioCarteira,
        indiceNome: indiceNomeCarteira,
        indiceAnualPct: indiceAnualPctCarteira,
      })
    : "";

  const avisosCarteira: string[] = [];
  if (carteira.segmentosMisturados) {
    avisosCarteira.push(
      "Cotas de veículo e imóvel não podem ser juntadas para adquirir um mesmo bem — a soma acima é de cotas independentes.",
    );
  }
  if (temCarteira) {
    avisosCarteira.push("Junção só é permitida entre cartas da mesma administradora.");
  }
  if (carteira.cotas > COTAS_VOLUME_ALTO) {
    avisosCarteira.push(
      "Volume alto — confirmar disponibilidade de grupos e análise de crédito com a administradora antes de apresentar ao cliente.",
    );
  }

  function gerarTextoCarteira(): string {
    const nome = nomeCliente.trim() || "Olá";
    const ativos = itens.filter((i) => i.quantidade > 0);
    return [
      `🧾 *Proposta de cotas — Disal*`,
      `_Boletim de Crédito · ${mes}_`,
      ``,
      `${nome}, segue sua simulação 👇`,
      ``,
      `*Cotas selecionadas*`,
      ...ativos.map(
        (i) =>
          `• ${i.quantidade}× ${i.tipo === "veiculo" ? "Veículo" : "Imóvel"} ${fmtCredito(i.credito)} — ${i.prazo} meses (Base ${i.base === "100" ? "100%" : "75% Light"})`,
      ),
      ``,
      `💳 Crédito total: *${fmtCredito(carteira.creditoTotal)}*`,
      `🛡️ Seguro prestamista incluso`,
      ``,
      `✅ *Parcela somada:*`,
      ...linhasFases.map((l) => `   ${l}`),
      ``,
      `💰 Total do plano (sem reajustes): ${fmtValor(carteira.totalPlano)}`,
      `📊 Custo além do crédito: ${fmtValor(carteira.custoAlemCredito)} (${fmtPct(carteira.custoAlemCreditoPct)})`,
      `📈 ${custoEfetivoTextoCarteira}`,
      ``,
      ...avisosCarteira.map((a) => `⚠️ ${a}`),
      ``,
      `Compra programada para o seu patrimônio, sem juros de financiamento.`,
      `Contemplação por sorteio ou lance mensal.`,
      ``,
      `*Prospere Consórcios* 🤝`,
    ].join("\n");
  }

  function gerarTexto(): string {
    if (temCarteira) return gerarTextoCarteira();
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
        `📈 ${custoEfetivoTextoAuto}`,
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
      `📈 ${custoEfetivoTextoImovel}`,
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

            <div style={{ ...S.card, marginTop: 10 }}>
              <div style={{ fontSize: 11, opacity: 0.6 }}>Custo efetivo (TIR sobre o fluxo real)</div>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: "#8FB7FF", marginTop: 2 }}>
                {custoEfetivoTextoAuto}
              </div>
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

            <div style={{ ...S.card, marginTop: 10 }}>
              <div style={{ fontSize: 11, opacity: 0.6 }}>Custo efetivo (TIR sobre o fluxo real)</div>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: "#8FB7FF", marginTop: 2 }}>
                {custoEfetivoTextoImovel}
              </div>
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
          <button
            onClick={adicionarACarteira}
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              border: 0,
              cursor: "pointer",
              background: "linear-gradient(90deg,#8FB7FF,#36C5F0,#1E6FE6)",
              color: "#0A0E1A",
              fontWeight: 800,
            }}
          >
            + Adicionar à carteira
          </button>
          <span style={{ fontSize: 11, opacity: 0.55 }}>
            Monte uma proposta com várias cotas ({QTD_MIN} a {QTD_MAX} por linha).
          </span>
        </div>

        {temCarteira && (
          <div
            style={{
              marginTop: 20,
              background: "#0F1526",
              padding: 16,
              borderRadius: 14,
              border: "1px solid #16213A",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#8FB7FF" }}>
                Carteira · {carteira.cotas} {carteira.cotas === 1 ? "cota" : "cotas"} em {carteira.itens}{" "}
                {carteira.itens === 1 ? "linha" : "linhas"}
              </div>
              <button
                onClick={() => setItens([])}
                style={{
                  padding: "4px 12px",
                  borderRadius: 999,
                  border: "1px solid #16213A",
                  background: "transparent",
                  color: "#a1a1aa",
                  cursor: "pointer",
                  fontSize: 11,
                }}
              >
                Limpar carteira
              </button>
            </div>

            <div style={{ marginTop: 12, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ color: "#8FB7FF", textAlign: "left" }}>
                    {["Cota", "Cód. bem", "Qtd.", "Crédito unit.", "Crédito × qtd.", "Parcela unit. (1ª)", "Parcela × qtd.", ""].map(
                      (h) => (
                        <th key={h} style={{ padding: "8px 10px", borderBottom: "1px solid #16213A", fontWeight: 700 }}>
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {itens.map((i) => {
                    const parcelaUnit = i.fases[0]?.valor ?? 0;
                    return (
                      <tr key={i.id} style={{ borderBottom: "1px solid #10182B" }}>
                        <td style={{ padding: "8px 10px" }}>
                          {i.rotulo}
                          <div style={{ fontSize: 10, opacity: 0.5 }}>
                            Base {i.base === "100" ? "100%" : "75% Light"} · {i.prazo} meses · {i.indice}
                          </div>
                        </td>
                        <td style={{ padding: "8px 10px", fontFamily: "'IBM Plex Mono',monospace", opacity: 0.7 }}>
                          {i.cod}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                            <button
                              onClick={() => mudarQuantidade(i.id, i.quantidade - 1)}
                              disabled={i.quantidade <= QTD_MIN}
                              aria-label="Diminuir quantidade"
                              style={{
                                width: 28,
                                height: 28,
                                borderRadius: 8,
                                border: "1px solid #1E6FE6",
                                background: "transparent",
                                color: "#8FB7FF",
                                cursor: i.quantidade <= QTD_MIN ? "not-allowed" : "pointer",
                                opacity: i.quantidade <= QTD_MIN ? 0.4 : 1,
                              }}
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min={QTD_MIN}
                              max={QTD_MAX}
                              value={i.quantidade}
                              onChange={(e) => mudarQuantidade(i.id, +e.target.value)}
                              aria-label={`Quantidade de cotas — ${i.rotulo}`}
                              style={{ ...S.input, width: 64, padding: "4px 6px", textAlign: "center" } as any}
                            />
                            <button
                              onClick={() => mudarQuantidade(i.id, i.quantidade + 1)}
                              disabled={i.quantidade >= QTD_MAX}
                              aria-label="Aumentar quantidade"
                              style={{
                                width: 28,
                                height: 28,
                                borderRadius: 8,
                                border: "1px solid #1E6FE6",
                                background: "transparent",
                                color: "#8FB7FF",
                                cursor: i.quantidade >= QTD_MAX ? "not-allowed" : "pointer",
                                opacity: i.quantidade >= QTD_MAX ? 0.4 : 1,
                              }}
                            >
                              +
                            </button>
                          </div>
                        </td>
                        <td style={{ padding: "8px 10px", fontFamily: "'IBM Plex Mono',monospace" }}>
                          {fmtCredito(i.credito)}
                        </td>
                        <td style={{ padding: "8px 10px", fontFamily: "'IBM Plex Mono',monospace", color: "#8FB7FF" }}>
                          {fmtCredito(i.credito * i.quantidade)}
                        </td>
                        <td style={{ padding: "8px 10px", fontFamily: "'IBM Plex Mono',monospace" }}>
                          {fmtValor(parcelaUnit)}
                        </td>
                        <td style={{ padding: "8px 10px", fontFamily: "'IBM Plex Mono',monospace", color: "#8FB7FF" }}>
                          {fmtValor(parcelaUnit * i.quantidade)}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          <button
                            onClick={() => removerItem(i.id)}
                            aria-label={`Remover ${i.rotulo}`}
                            style={{
                              padding: "4px 10px",
                              borderRadius: 8,
                              border: "1px solid #16213A",
                              background: "transparent",
                              color: "#F87171",
                              cursor: "pointer",
                              fontSize: 11,
                            }}
                          >
                            Remover
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {avisosCarteira.length > 0 && (
              <div
                style={{
                  marginTop: 14,
                  background: "#1a1207",
                  border: "1px solid #3f2d0a",
                  borderRadius: 10,
                  padding: "10px 14px",
                }}
              >
                {avisosCarteira.map((a) => (
                  <p key={a} style={{ margin: "4px 0", fontSize: 12, color: "#FCD34D", lineHeight: 1.5 }}>
                    ⚠️ {a}
                  </p>
                ))}
              </div>
            )}

            <div
              style={{
                marginTop: 14,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
                gap: 10,
              }}
            >
              {[
                ["Cotas", String(carteira.cotas)],
                ["Crédito total", fmtCredito(carteira.creditoTotal)],
                ["Parcela inicial somada", `${fmtValor(carteira.parcelaInicial)}/mês`],
                ["Total do plano (sem reajustes)", fmtValor(carteira.totalPlano)],
                [
                  "Custo além do crédito",
                  `${fmtValor(carteira.custoAlemCredito)} (${fmtPct(carteira.custoAlemCreditoPct)})`,
                ],
              ].map(([k, v]) => (
                <div key={k} style={S.card}>
                  <div style={{ fontSize: 11, opacity: 0.6 }}>{k}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 16, color: "#8FB7FF" }}>{v}</div>
                </div>
              ))}
            </div>

            <div style={{ ...S.card, marginTop: 10 }}>
              <div style={{ fontSize: 11, opacity: 0.6 }}>
                Custo efetivo da carteira (TIR sobre o fluxo consolidado, Base 100% de referência)
              </div>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: "#8FB7FF", marginTop: 2 }}>
                {custoEfetivoTextoCarteira}
              </div>
            </div>

            <div style={{ ...S.card, marginTop: 10 }}>
              <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>
                Parcela somada ao longo do plano — cai em degraus conforme as cotas mais curtas terminam
              </div>
              {linhasFases.map((l) => (
                <div key={l} style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: "#E5E9F0" }}>
                  {l}
                </div>
              ))}
            </div>
          </div>
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
            Gerador de proposta WhatsApp {temCarteira ? `· carteira de ${carteira.cotas} cotas` : ""}
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
