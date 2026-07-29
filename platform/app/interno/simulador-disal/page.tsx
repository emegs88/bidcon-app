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
  escolherMetricaJuncao,
  totaisFallbackJuncao,
  C_LIMIAR_CORRECAO,
  formatarCustoEfetivoTexto,
  fluxoJuncao,
  fluxoIndependente,
  projetarParcelaMensal,
  projetarParcelaAnual,
  chaveIndiceBcb,
  type FaseFluxo,
} from "@/lib/disal/custo-efetivo-plano-novo";
import {
  simularFinanciamento,
  type SistemaAmortizacao,
  type UnidadeTaxa,
  type ResultadoFinanciamento,
} from "@/lib/financiamento";
import {
  resumirCarteira,
  descreverFases,
  QTD_MIN,
  QTD_MAX,
  type ItemCarteira,
} from "@/lib/disal/carteira";
import { gradeDoSegmento, calcularComissao, type GradeComissao } from "@/lib/comissao";
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

// Junção = várias cartas para UM bem (mesmo segmento, mesma administradora).
// Independente = cotas que não se juntam, cada uma comprando o seu bem.
// São dois produtos diferentes, com dois modelos de fluxo diferentes — não é
// só rótulo. Ver os dois motores em lib/disal/custo-efetivo-plano-novo.ts.
type ModoCarteira = "juncao" | "independente";

// Cenários oferecidos em cada modo. Na junção começam mais tarde de
// propósito: quanto mais cartas, mais tarde tende a ser a última contemplação.
const CENARIOS_C: Record<ModoCarteira, readonly number[]> = {
  juncao: [24, 36, 48, 60],
  independente: [12, 24, 36, 48],
};

// A Disal ainda não está em consorcios.administradoras — a grade vem vazia e
// nada aparece na tela. É o comportamento correto: nunca herdar a da Porto.
const SLUG_ADMINISTRADORA = "disal";

// tipo e regra vêm da lib pura testada em lib/comissao.test.ts

// Acima deste número de cartas, confirmar o limite com a administradora.
// NÃO é um teto: o campo de quantidade continua livre até QTD_MAX. Nenhum
// limite de cartas por junção foi publicado pela Disal — inventar um seria
// inventar regra de negócio.
const COTAS_CONFIRMAR_LIMITE = 10;

// Aviso permanente da junção — mesma frase na tela e no texto do cliente.
const AVISO_JUNCAO =
  "Junção só entre cartas da mesma administradora e do mesmo segmento. " +
  "O poder de compra combinado só fica disponível quando todas as cotas forem contempladas.";

// Sem esta frase a comparação com financiamento é proibida — ela é a
// diferença real entre os dois produtos, e é o que o número sozinho esconde.
const AVISO_COMPARADOR =
  "No financiamento o bem é entregue de imediato; no consórcio a entrega depende de contemplação " +
  "(sorteio ou lance) — os cenários acima usam C declarado como referência, nunca como promessa.";

const fmtPct2 = (v: number) =>
  `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

// Atalhos do dia a dia. Todos existem no boletim vigente (imóvel 200/300/400,
// auto 150) — nenhum crédito inventado.
const PRESETS = [
  { label: "Imóvel R$ 300 mil", tipo: "imovel", credito: 300000, quantidade: 1 },
  { label: "Veículo R$ 150 mil", tipo: "veiculo", credito: 150000, quantidade: 1 },
  { label: "Junção 2× R$ 200 mil imóvel", tipo: "imovel", credito: 200000, quantidade: 2 },
  { label: "Junção 3× R$ 400 mil imóvel", tipo: "imovel", credito: 400000, quantidade: 3 },
] as const;

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

// Gráfico da parcela ao longo do plano — SVG inline, sem dependência nova.
// Mostra os dois efeitos juntos: sobe no aniversário (índice) e despenca
// quando uma cota termina. Escada, não curva: a parcela muda em degraus.
function GraficoParcela({
  serie,
  projetada,
  fmtEixo,
}: {
  serie: number[];
  projetada: boolean;
  fmtEixo: (v: number) => string;
}) {
  if (serie.length < 2) return null;
  const W = 720, H = 240, padL = 74, padR = 12, padT = 14, padB = 30;
  const n = serie.length;
  const max = Math.max(...serie) * 1.08;
  const x = (mes: number) => padL + ((mes - 1) / (n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);

  // caminho em escada: horizontal dentro do mês, vertical na mudança
  let d = `M ${x(1).toFixed(1)} ${y(serie[0]).toFixed(1)}`;
  for (let t = 2; t <= n; t++) {
    d += ` L ${x(t).toFixed(1)} ${y(serie[t - 2]).toFixed(1)}`;
    if (Math.abs(serie[t - 1] - serie[t - 2]) > 0.005) d += ` L ${x(t).toFixed(1)} ${y(serie[t - 1]).toFixed(1)}`;
  }
  const marcasY = [0, max / 2, max];
  const marcasX = [1, Math.round(n / 4), Math.round(n / 2), Math.round((3 * n) / 4), n];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="auto" role="img"
      aria-label={`Parcela mensal ao longo de ${n} meses${projetada ? ", projetada com índice" : ", nominal"}`}
      style={{ display: "block", marginTop: 8 }}>
      {marcasY.map((v) => (
        <g key={v}>
          <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#16213A" strokeWidth={1} />
          <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize={10} fill="#6b7280"
            fontFamily="'IBM Plex Mono',monospace">
            {fmtEixo(v)}
          </text>
        </g>
      ))}
      {marcasX.map((m) => (
        <text key={m} x={x(m)} y={H - 10} textAnchor="middle" fontSize={10} fill="#6b7280"
          fontFamily="'IBM Plex Mono',monospace">
          {m}
        </text>
      ))}
      <path d={d} fill="none" stroke={projetada ? "#36C5F0" : "#6b7280"} strokeWidth={2}
        strokeLinejoin="round" />
      <text x={W - padR} y={padT + 2} textAnchor="end" fontSize={10} fill="#6b7280">
        mês do plano →
      </text>
    </svg>
  );
}

export default function SimuladorDisal() {
  const { autosFaixaII, autosFaixaIII, imoveis220, mes } = BOLETIM_DISAL_ATUAL;

  const [segmento, setSegmento] = useState<Segmento>("veiculo");
  const [base, setBase] = useState<Base>("100");
  const [creditoAuto, setCreditoAuto] = useState<number>(autosFaixaII.linhas[12][0]); // 150.000 (linha central da Faixa II)
  const [imovelIdx, setImovelIdx] = useState(0);
  const [nomeCliente, setNomeCliente] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [itens, setItens] = useState<ItemCarteiraUI[]>([]);
  const [modo, setModo] = useState<ModoCarteira>("juncao");
  // null = acompanha o default do segmento; número = cenário escolhido/digitado
  const [cJuncao, setCJuncao] = useState<number | null>(null);
  const [lancePct, setLancePct] = useState(0);
  const [parcelaAlvo, setParcelaAlvo] = useState("");
  const [frase, setFrase] = useState("");
  const [interpretando, setInterpretando] = useState(false);
  const [resumoPedido, setResumoPedido] = useState("");
  const [erroFrase, setErroFrase] = useState("");
  const [linkCopiado, setLinkCopiado] = useState(false);
  const [gradesDisal, setGradesDisal] = useState<GradeComissao[] | null>(null);
  const [restaurado, setRestaurado] = useState(false);
  // comparador com financiamento — sem taxa default de propósito (G.1)
  const [comparadorAberto, setComparadorAberto] = useState(false);
  const [taxaFin, setTaxaFin] = useState("");
  const [unidadeTaxa, setUnidadeTaxa] = useState<UnidadeTaxa>("aa");
  const [entradaPct, setEntradaPct] = useState(0);
  const [prazoFin, setPrazoFin] = useState<number | null>(null);

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
  // Junção de cartas (mesmo segmento, mesma administradora, um bem só)
  // ---------------------------------------------------------------------
  // Identidade do item: tipo + código do bem + crédito + base. O MD pede
  // "mesmo cod + base", mas o código do bem se repete entre créditos
  // diferentes do boletim — incluir o crédito impede fundir duas cartas
  // distintas numa linha só.
  function montarItemAuto(credito: number, quantidade: number, b: Base = base): ItemCarteiraUI {
    const { linha, faixa, rotuloFaixa: rf } = linhaAutoMaisProxima(credito, autosFaixaII, autosFaixaIII);
    const [creditoReal, cod, p100, p75] = linha;
    return {
      id: `veiculo|${cod}|${creditoReal}|${b}`,
      tipo: "veiculo",
      rotulo: `Veículo · ${fmtCredito(creditoReal)} · ${rf}`,
      cod,
      credito: creditoReal,
      quantidade,
      base: b,
      prazo: faixa.prazo,
      taxa: faixa.taxa,
      indice: faixa.indice,
      fases: [{ meses: faixa.prazo, valor: b === "100" ? p100 : p75 }],
      fasesBase100: [{ meses: faixa.prazo, valor: p100 }],
    };
  }

  function montarItemImovel(linha: LinhaImovel, quantidade: number, b: Base = base): ItemCarteiraUI {
    const f = b === "100" ? linha.b100 : linha.b75;
    return {
      id: `imovel|${linha.cod}|${linha.credito}|${b}`,
      tipo: "imovel",
      rotulo: `Imóvel · ${fmtCredito(linha.credito)}`,
      cod: linha.cod,
      credito: linha.credito,
      quantidade,
      base: b,
      prazo: imoveis220.prazo,
      taxa: imoveis220.taxa,
      indice: imoveis220.indice,
      fases: FASES_IMOVEL_MESES.map((meses, i) => ({ meses, valor: f[i] })),
      fasesBase100: FASES_IMOVEL_MESES.map((meses, i) => ({ meses, valor: linha.b100[i] })),
    };
  }

  function itemAtual(): ItemCarteiraUI {
    return segmento === "veiculo" ? montarItemAuto(creditoAuto, 1) : montarItemImovel(linhaImovel, 1);
  }

  // Presets de 1 clique: monta a junção inteira e já deixa o resultado na
  // tela. Todos apontam para linhas que existem no boletim vigente — se um
  // boletim futuro não tiver o crédito, o snap do auto cai na linha mais
  // próxima e o imóvel some da lista em vez de inventar valor.
  function aplicarPreset(p: (typeof PRESETS)[number]) {
    setSegmento(p.tipo);
    if (p.tipo === "veiculo") {
      const { linha } = linhaAutoMaisProxima(p.credito, autosFaixaII, autosFaixaIII);
      setCreditoAuto(linha[0]);
      setItens([montarItemAuto(p.credito, p.quantidade)]);
    } else {
      const idx = imoveis220.linhas.findIndex((l) => l.credito === p.credito);
      if (idx < 0) return;
      setImovelIdx(idx);
      setItens([montarItemImovel(imoveis220.linhas[idx], p.quantidade)]);
    }
    setCJuncao(null);
  }

  // Segmento travado pela primeira carta adicionada — SÓ no modo junção.
  // Junção é para UM bem: veículo e imóvel não se somam, então a mistura é
  // estado inválido, não alerta. No modo independente as cotas não se juntam,
  // logo misturar segmentos é legítimo e nada é bloqueado.
  const segmentoDaJuncao = itens.find((i) => i.quantidade > 0)?.tipo ?? null;
  const segmentoBloqueado = modo === "juncao" && segmentoDaJuncao != null && segmentoDaJuncao !== segmento;
  const nomeSegmento = (t: "veiculo" | "imovel") => (t === "veiculo" ? "veículo" : "imóvel");
  const razaoBloqueio = segmentoBloqueado
    ? `A junção em andamento é de ${nomeSegmento(segmentoDaJuncao!)}. Cartas de ${nomeSegmento(segmento)} não podem ser juntadas com as de ${nomeSegmento(segmentoDaJuncao!)} — junção é para um bem só, do mesmo segmento. Limpe a junção para começar outra.`
    : "";

  function adicionarACarteira() {
    if (segmentoBloqueado) return;
    const novo = itemAtual();
    setItens((atual) => {
      if (atual.length === 0) setCJuncao(null); // volta ao default do segmento
      const i = atual.findIndex((x) => x.id === novo.id);
      if (i < 0) return [...atual, novo];
      const copia = [...atual];
      copia[i] = { ...copia[i], quantidade: Math.min(QTD_MAX, copia[i].quantidade + 1) };
      return copia;
    });
  }

  function limparJuncao() {
    setItens([]);
    setCJuncao(null);
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

  // Cenário da ÚLTIMA contemplação — é quando o poder de compra combinado
  // fica utilizável. Default = C de referência do segmento da junção; o
  // vendedor pode declarar outro. Clampado ao prazo da cota mais longa.
  const cJuncaoDefault = C_REF[segmentoDaJuncao ?? segmento];
  const cJuncaoEfetivo = temCarteira
    ? Math.max(1, Math.min(cJuncao ?? cJuncaoDefault, carteira.prazoMaximo))
    : cJuncaoDefault;

  // Junção é de segmento único, então o índice é o mesmo em todas as cotas.
  // A checagem continua aqui como trava: se por qualquer motivo houver mais
  // de um, passa null e a projeção sai indisponível — um fator único sobre
  // índices diferentes daria um custo que não corresponde a nenhum contrato.
  const indicesDaCarteira = new Set(itens.filter((i) => i.quantidade > 0).map((i) => i.indice));
  const indiceNomeCarteira = indicesDaCarteira.size === 1 ? [...indicesDaCarteira][0] : undefined;
  const chaveIndiceCarteira = indiceNomeCarteira ? chaveIndiceBcb(indiceNomeCarteira) : null;
  const indiceAnualPctCarteira = chaveIndiceCarteira
    ? indicesBcb?.[chaveIndiceCarteira]?.acumulado12m ?? null
    : null;

  const itensBase100 = itens.map((i) => ({ ...i, fases: i.fasesBase100 }));
  const lance = { lanceProprioPct: lancePct };

  const resultadoCarteira = temCarteira
    ? custoEfetivoCarteira({
        // TIR sempre sobre a Base 100% — ver nota em ItemCarteiraUI.
        itens: itensBase100,
        modo,
        C: modo === "juncao" ? cJuncaoEfetivo : { veiculo: cJuncaoEfetivo, imovel: cJuncaoEfetivo },
        indiceAnualPct: indiceAnualPctCarteira,
        lance,
      })
    : null;

  // Decisão da métrica (regra do Emerson): a partir de C=48 na junção, a
  // corrigida vira a principal; se nem ela fechar, só totais em R$.
  const metrica = temCarteira && modo === "juncao" ? escolherMetricaJuncao(resultadoCarteira!, cJuncaoEfetivo) : null;
  const totaisFallback =
    metrica?.tipo === "totais"
      ? totaisFallbackJuncao({
          fases: carteira.fases,
          poderDeCompra: carteira.creditoTotal,
          C: cJuncaoEfetivo,
          indiceAnualPct: indiceAnualPctCarteira,
        })
      : null;

  const cenarioTexto =
    modo === "juncao"
      ? `poder de compra combinado no mês ${cJuncaoEfetivo}`
      : `carta de crédito no mês ${cJuncaoEfetivo}`;

  const custoEfetivoTextoCarteira = temCarteira
    ? formatarCustoEfetivoTexto({
        resultado: resultadoCarteira!,
        C: cJuncaoEfetivo,
        cenario: cenarioTexto,
        indiceNome: indiceNomeCarteira,
        indiceAnualPct: indiceAnualPctCarteira,
      })
    : "";

  // Número curto para barra fixa e cards — tirado do resultado, NUNCA de
  // fatiar o texto formatado (o cenário também tem dois-pontos).
  // Resumo de um cenário (lance + C) sem tocar no motor: chama os fluxos que
  // já existem e lê deles o prazo efetivo. É o que o lance de fato melhora —
  // antecipa a quitação e reduz a soma de parcelas —, ao contrário da TIR,
  // que sobe porque o dinheiro sai mais cedo.
  function resumirCenario(lPct: number, c: number) {
    if (!temCarteira) return null;
    const cEf = Math.max(1, Math.min(Math.round(c), carteira.prazoMaximo));
    const lanceObj = { lanceProprioPct: lPct };
    const alvoC = modo === "juncao" ? cEf : { veiculo: cEf, imovel: cEf };
    const resultado = custoEfetivoCarteira({
      itens: itensBase100,
      modo,
      C: alvoC,
      indiceAnualPct: indiceAnualPctCarteira,
      lance: lanceObj,
    });
    const fluxo =
      modo === "juncao"
        ? fluxoJuncao({ itens: itensBase100, C: cEf, lance: lanceObj })
        : fluxoIndependente({ itens: itensBase100, C: { veiculo: cEf, imovel: cEf }, lance: lanceObj });
    const prazo = Math.max(0, fluxo.length - 1);
    const serie = projetarParcelaMensal(carteira.fases, indiceAnualPctCarteira).slice(0, prazo);
    const somaParcelas = serie.reduce((s, v) => s + v, 0);
    const lanceRS = (carteira.creditoTotal * lPct) / 100;
    const met = modo === "juncao" ? escolherMetricaJuncao(resultado, cEf) : null;
    const taxa =
      met?.tipo === "tir_corrigida" || met?.tipo === "tir_nominal"
        ? `${fmtPct2(met.mensal * 100)} a.m.`
        : met?.tipo === "totais"
          ? "sem taxa única"
          : resultado.semCorrecao != null
            ? `${fmtPct2(resultado.semCorrecao.mensal * 100)} a.m.`
            : "sem taxa única";
    return {
      C: cEf,
      lancePct: lPct,
      lanceRS,
      prazo,
      totalPago: somaParcelas + lanceRS,
      projetado: projecaoDisponivel,
      taxa,
    };
  }

  const cenarioAtual = resumirCenario(lancePct, cJuncaoEfetivo);
  // D — comparação de 1 clique: dois cenários DECLARADOS, lado a lado
  const cenarioSemLance = resumirCenario(0, 36);
  const cenarioComLance = resumirCenario(30, 12);

  function aplicarCenario(lPct: number, c: number) {
    setLancePct(lPct);
    setCJuncao(c);
  }

  const custoEfetivoCurto = (() => {
    if (!resultadoCarteira) return "—";
    if (metrica?.tipo === "tir_corrigida") {
      return `${fmtPct2(metrica.mensal * 100)} a.m. com ${indiceNomeCarteira ?? "índice"} projetado`;
    }
    if (metrica?.tipo === "totais") return "sem taxa única — ver totais em R$";
    if (resultadoCarteira.semCorrecao != null) return `${fmtPct2(resultadoCarteira.semCorrecao.mensal * 100)} a.m.`;
    return "não fecha numa taxa única";
  })();
  const custoEfetivoCurtoComIndice =
    metrica?.tipo !== "tir_corrigida" && resultadoCarteira?.comIndice != null
      ? `${fmtPct2(resultadoCarteira.comIndice.mensal * 100)} a.m. com ${indiceNomeCarteira} projetado — estimativa`
      : metrica?.tipo === "tir_corrigida" && resultadoCarteira?.semCorrecao != null
        ? `${fmtPct2(resultadoCarteira.semCorrecao.mensal * 100)} a.m. sem correção`
        : null;

  // D.1 — parcela alvo: sugere quantidade, nada automático. O vendedor
  // clica se quiser. Base: parcela inicial de UMA carta da configuração atual.
  const parcelaAlvoNum = Number(parcelaAlvo.replace(/\./g, "").replace(",", "."));
  const parcelaUnitariaAtual = itemAtual().fases[0]?.valor ?? 0;
  const qtdSugerida =
    Number.isFinite(parcelaAlvoNum) && parcelaAlvoNum > 0 && parcelaUnitariaAtual > 0
      ? Math.max(QTD_MIN, Math.min(QTD_MAX, Math.floor(parcelaAlvoNum / parcelaUnitariaAtual)))
      : null;

  function aplicarQuantidadeSugerida() {
    if (qtdSugerida == null) return;
    const novo = itemAtual();
    setItens([{ ...novo, quantidade: qtdSugerida }]);
    setCJuncao(null);
  }

  // D.4 — comissão Prospere: só aparece com grade da PRÓPRIA administradora.
  // A resposta da API já vem filtrada pela administradora pedida. `grades: []`
  // — seja porque a Disal não está cadastrada, seja porque está cadastrada
  // (id 2) e ainda não tem grade — resulta em null aqui e o bloco não
  // aparece. Ver lib/comissao.test.ts.
  const gradeDisal =
    gradesDisal && segmentoDaJuncao
      ? gradeDoSegmento(gradesDisal, segmentoDaJuncao === "veiculo" ? "auto" : "imovel")
      : null;
  const comissaoProspere = temCarteira ? calcularComissao(gradeDisal, carteira.creditoTotal) : null;

  // Estado inválido: a tela bloqueia a mistura na entrada, então isto só
  // aparece se o bloqueio falhar. Fica como rede de segurança visível.
  const juncaoInvalida = carteira.segmentosMisturados;

  const avisosCarteira: string[] = [];
  if (carteira.cotas > COTAS_CONFIRMAR_LIMITE) {
    avisosCarteira.push("Confirmar com a administradora o limite de cartas por junção.");
  }

  // ---------------------------------------------------------------------
  // H — projeção da parcela com o índice acumulado 12m (cenário, não promessa)
  // ---------------------------------------------------------------------
  const projecaoDisponivel = indiceAnualPctCarteira != null;
  const serieParcela = temCarteira ? projetarParcelaMensal(carteira.fases, indiceAnualPctCarteira) : [];
  const anosProjetados = temCarteira ? projetarParcelaAnual(carteira.fases, indiceAnualPctCarteira) : [];
  const rotuloIndices = (() => {
    const partes: string[] = [];
    const incc = indicesBcb?.incc?.acumulado12m;
    const ipca = indicesBcb?.ipca?.acumulado12m;
    if (incc != null) partes.push(`INCC ${fmtPct2(incc)}`);
    if (ipca != null) partes.push(`IPCA ${fmtPct2(ipca)}`);
    return partes.length ? `${partes.join(" / ")} — BCB` : null;
  })();

  // ---------------------------------------------------------------------
  // G — comparador com financiamento. Sem taxa default: o número vem da
  // proposta bancária que o cliente tem na mão.
  // ---------------------------------------------------------------------
  const taxaFinNum = Number(taxaFin.replace(",", "."));
  const taxaFinValida = taxaFin.trim() !== "" && Number.isFinite(taxaFinNum) && taxaFinNum >= 0;
  const prazoFinEfetivo = prazoFin ?? carteira.prazoMaximo;
  const paramsFin = {
    valorBem: carteira.creditoTotal,
    entradaPct,
    taxa: taxaFinNum,
    unidade: unidadeTaxa,
    prazo: prazoFinEfetivo,
  };
  const finPrice: ResultadoFinanciamento | null =
    temCarteira && taxaFinValida ? simularFinanciamento({ ...paramsFin, sistema: "price" }) : null;
  // SAC é praxe no crédito imobiliário; em veículo o mercado usa Price.
  const finSac: ResultadoFinanciamento | null =
    temCarteira && taxaFinValida && segmentoDaJuncao === "imovel"
      ? simularFinanciamento({ ...paramsFin, sistema: "sac" })
      : null;
  const comparaveis = [finSac, finPrice].filter((f): f is ResultadoFinanciamento => f != null);
  const diferencaTotal = (f: ResultadoFinanciamento) => f.totalPago - carteira.totalPlano;

  function imprimir() {
    if (typeof window !== "undefined") window.print();
  }

  // -------------------------------------------------------------------
  // D.3 — estado serializado na querystring. Link interno: só abre para
  // quem tem sessão admin (a página vive sob /interno). Não é link público.
  // -------------------------------------------------------------------
  function querystringAtual(): string {
    const cartas = itens
      .filter((i) => i.quantidade > 0)
      .map((i) => `${i.tipo === "veiculo" ? "v" : "i"}-${i.credito}-${i.quantidade}`)
      .join(",");
    const p = new URLSearchParams();
    p.set("modo", modo);
    p.set("base", base);
    if (cartas) p.set("cartas", cartas);
    if (cJuncao != null) p.set("c", String(cJuncao));
    if (lancePct > 0) p.set("lance", String(lancePct));
    return p.toString();
  }

  async function copiarLink() {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}${window.location.pathname}?${querystringAtual()}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopiado(true);
      setTimeout(() => setLinkCopiado(false), 2000);
    } catch {
      /* sem clipboard: o vendedor copia da barra de endereço */
    }
  }

  // restaura uma vez, na montagem
  useEffect(() => {
    if (restaurado) return;
    setRestaurado(true);
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    const cartas = p.get("cartas");
    if (!cartas) return;
    const b: Base = p.get("base") === "75" ? "75" : "100";
    const m: ModoCarteira = p.get("modo") === "independente" ? "independente" : "juncao";
    const novos: ItemCarteiraUI[] = [];
    for (const parte of cartas.split(",")) {
      const [t, cred, qtd] = parte.split("-");
      const credito = Number(cred);
      const quantidade = Math.max(QTD_MIN, Math.min(QTD_MAX, Number(qtd) || 1));
      if (!Number.isFinite(credito) || credito <= 0) continue;
      if (t === "v") novos.push(montarItemAuto(credito, quantidade, b));
      else if (t === "i") {
        const linha = imoveis220.linhas.find((l) => l.credito === credito);
        if (linha) novos.push(montarItemImovel(linha, quantidade, b));
      }
    }
    if (novos.length === 0) return;
    setBase(b);
    setModo(m);
    setSegmento(novos[0].tipo);
    setItens(novos);
    const c = Number(p.get("c"));
    if (Number.isFinite(c) && c > 0) setCJuncao(c);
    const l = Number(p.get("lance"));
    if (Number.isFinite(l) && l > 0) setLancePct(Math.min(50, l));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurado]);

  // D.4 — grade de comissão da própria administradora. 401/403/vazio => nada
  // na tela. Nunca cai na grade de outra administradora.
  useEffect(() => {
    fetch(`/api/comissoes?administradora=${SLUG_ADMINISTRADORA}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setGradesDisal(Array.isArray(d?.grades) ? d.grades : []))
      .catch(() => setGradesDisal([]));
  }, []);

  // -------------------------------------------------------------------
  // C — conversa. A IA só extrai parâmetros; o snap para um crédito que
  // existe no boletim e todo o cálculo continuam aqui.
  // -------------------------------------------------------------------
  async function interpretarFrase() {
    if (!frase.trim()) return;
    setInterpretando(true);
    setErroFrase("");
    setResumoPedido("");
    try {
      const r = await fetch("/api/interpretar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ texto: frase }),
      });
      const d = await r.json();
      if (r.status === 422) {
        setErroFrase("Não entendi — tente reescrever.");
        return;
      }
      if (!r.ok || d.erro) throw new Error(d.erro ?? "não consegui interpretar");

      const q = d.parametros ?? {};
      // o boletim Disal tem veículo e imóvel; "auto" da IA vira "veiculo"
      const tipo: Segmento = q.segmento === "imovel" ? "imovel" : "veiculo";
      const quantidade = Math.max(QTD_MIN, Math.min(QTD_MAX, Number(q.quantidade) || 1));
      const creditoPedido = Number(q.credito) > 0 ? Number(q.credito) : null;
      if (creditoPedido == null) {
        setErroFrase("Entendi o pedido, mas sem o valor da carta não dá para montar. Diga o valor do crédito.");
        return;
      }
      // "juntar N cartas" é junção; carta única não muda o modo escolhido
      const novoModo: ModoCarteira = quantidade > 1 ? "juncao" : modo;

      let item: ItemCarteiraUI | null = null;
      if (tipo === "veiculo") {
        item = montarItemAuto(creditoPedido, quantidade);
        setCreditoAuto(item.credito);
      } else {
        // snap: crédito de imóvel mais próximo entre os que existem no boletim
        const linha = imoveis220.linhas.reduce((melhor, l) =>
          Math.abs(l.credito - creditoPedido) < Math.abs(melhor.credito - creditoPedido) ? l : melhor,
        );
        item = montarItemImovel(linha, quantidade);
        setImovelIdx(imoveis220.linhas.findIndex((l) => l.cod === linha.cod));
      }

      setSegmento(tipo);
      setModo(novoModo);
      setItens([item]);
      setCJuncao(null);
      const snap =
        item.credito !== creditoPedido
          ? ` (ajustei para ${fmtCredito(item.credito)}, crédito que existe no boletim ${mes})`
          : "";
      setResumoPedido(
        `${quantidade > 1 ? `junção de ${quantidade} cartas` : "1 carta"} de ${fmtCredito(item.credito)} em ${
          tipo === "veiculo" ? "veículo" : "imóvel"
        }${snap}. ${q.resumoPedido ?? ""}`.trim(),
      );
    } catch (e: any) {
      setErroFrase(e.message ?? "não consegui interpretar");
    } finally {
      setInterpretando(false);
    }
  }

  function gerarTextoCarteira(): string {
    const nome = nomeCliente.trim() || "Olá";
    const ativos = itens.filter((i) => i.quantidade > 0);
    const bem = segmentoDaJuncao === "imovel" ? "Imóveis" : "Veículos";
    const ehJuncao = modo === "juncao";
    return [
      ehJuncao ? `🧾 *Junção de cartas — Disal · ${bem}*` : `🧾 *Cotas de consórcio — Disal*`,
      `_Boletim de Crédito · ${mes}_`,
      ``,
      `${nome}, segue sua simulação 👇`,
      ``,
      ehJuncao ? `*Cartas da junção*` : `*Cotas selecionadas*`,
      ...ativos.map(
        (i) =>
          `• ${i.quantidade}× ${fmtCredito(i.credito)} — ${i.prazo} meses (Base ${i.base === "100" ? "100%" : "75% Light"})`,
      ),
      ``,
      ehJuncao
        ? `💳 Poder de compra combinado: *${fmtCredito(carteira.creditoTotal)}*`
        : `💳 Crédito total: *${fmtCredito(carteira.creditoTotal)}*`,
      `🛡️ Seguro prestamista incluso`,
      ``,
      `✅ *Parcela somada:*`,
      ...linhasFases.map((l) => `   ${l}`),
      ``,
      `💰 Total do plano (sem reajustes): ${fmtValor(carteira.totalPlano)}`,
      `📊 Custo além do ${ehJuncao ? "poder de compra" : "crédito"}: ${fmtValor(carteira.custoAlemCredito)} (${fmtPct(carteira.custoAlemCreditoPct)})`,
      ...(metrica?.tipo === "totais" && totaisFallback
        ? [
            `📈 Neste cenário o fluxo não fecha numa taxa única — nem com a correção projetada. Os números em reais:`,
            `   Total pago ao longo do plano: ${fmtValor(totaisFallback.totalPagoProjetado)}`,
            `   Poder de compra no mês ${cJuncaoEfetivo}: ${fmtValor(totaisFallback.poderDeCompraCorrigido)}`,
          ]
        : [`📈 ${custoEfetivoTextoCarteira}`]),
      ...(lancePct > 0 ? [`🎯 Lance próprio considerado: ${lancePct}% (${fmtValor((carteira.creditoTotal * lancePct) / 100)})`] : []),
      `_(cenário de referência declarado, não é promessa de prazo)_`,
      ...(projecaoDisponivel && anosProjetados.length > 1
        ? [
            ``,
            `📅 *Parcela projetada ano a ano* (índice acumulado 12m${rotuloIndices ? `: ${rotuloIndices}` : ""})`,
            ...anosProjetados
              .slice(0, 5)
              .map((a) => `   Ano ${a.ano}: ${fmtValor(a.primeira)}/mês${a.mudaNoAno ? ` → ${fmtValor(a.ultima)}` : ""}`),
            anosProjetados.length > 5 ? `   … plano completo com ${anosProjetados.length} anos` : "",
            `_Cenário com o índice dos últimos 12 meses; o índice futuro varia._`,
          ].filter(Boolean)
        : []),
      ...(comparaveis.length > 0
        ? [
            ``,
            `⚖️ *Comparação com financiamento* (taxa informada: ${taxaFin.replace(".", ",")}% ${unidadeTaxa === "am" ? "a.m." : "a.a."}, entrada ${entradaPct}%)`,
            `   Consórcio — total do plano ${fmtValor(carteira.totalPlano)} · custo efetivo ${custoEfetivoCurto} (cenário: ${cenarioTexto})`,
            ...comparaveis.map(
              (f) =>
                `   Financiamento ${f.sistema === "sac" ? "SAC" : "Price"} — total ${fmtValor(f.totalPago)} · 1ª ${fmtValor(f.primeiraParcela)} · última ${fmtValor(f.ultimaParcela)} · custo efetivo ${f.tirMes != null ? fmtPct2(f.tirMes * 100) : "—"} a.m.`,
            ),
            ...comparaveis
              .filter((f) => diferencaTotal(f) > 0)
              .map(
                (f) =>
                  `   💡 Economia projetada de ${fmtValor(diferencaTotal(f))} ao longo do plano frente ao ${f.sistema === "sac" ? "SAC" : "Price"}.`,
              ),
            `⚠️ ${AVISO_COMPARADOR}`,
          ]
        : []),
      ``,
      ...(ehJuncao ? [`⚠️ ${AVISO_JUNCAO}`] : []),
      ...(ehJuncao ? avisosCarteira.map((a) => `⚠️ ${a}`) : []),
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
        {/* Responsividade e impressão precisam de media query — inline style
            não faz isso. A equipe vende pelo celular: aqui a tabela da junção
            vira cartões empilhados e os steppers ganham alvo de toque ≥40px. */}
        <style>{`
          .dsl-num { font-family: 'IBM Plex Mono', monospace; }
          @media (max-width: 720px) {
            .dsl-tabela-junc thead { display: none; }
            .dsl-tabela-junc, .dsl-tabela-junc tbody, .dsl-tabela-junc tr, .dsl-tabela-junc td { display: block; width: 100%; }
            .dsl-tabela-junc tr { border: 1px solid #16213A; border-radius: 12px; padding: 8px; margin-bottom: 10px; }
            .dsl-tabela-junc td { padding: 6px 4px !important; }
            .dsl-tabela-junc td[data-rot]::before {
              content: attr(data-rot); display: block; font-size: 10px; opacity: .55; margin-bottom: 2px;
            }
            .dsl-toque { min-width: 40px !important; min-height: 40px !important; }
            .dsl-cards { grid-template-columns: 1fr !important; }
            .dsl-barra { position: fixed !important; left: 0; right: 0; bottom: 0; border-radius: 0 !important; }
          }
          @media print {
            .dsl-nao-imprime { display: none !important; }
            .dsl-barra { display: none !important; }
          }
        `}</style>
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

        {/* A — modo: dois produtos diferentes, dois modelos de fluxo */}
        <div className="dsl-nao-imprime" style={{ marginTop: 18 }}>
          <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 8 }}>Modo</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(
              [
                ["juncao", "Junção — um bem só", "Várias cartas somadas para comprar UM bem. Mesmo segmento e mesma administradora."],
                ["independente", "Cotas independentes — patrimônio", "Cotas que não se juntam: cada uma compra o seu bem, no seu próprio prazo."],
              ] as const
            ).map(([m, label, ajuda]) => (
              <button key={m} onClick={() => setModo(m)} style={S.pill(modo === m)} title={ajuda}>
                {label}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 11, opacity: 0.55, margin: "8px 0 0", lineHeight: 1.5 }}>
            {modo === "juncao"
              ? "Na junção o poder de compra combinado só fica disponível quando todas as cartas forem contempladas — por isso o custo é medido no mês da última."
              : "Em cotas independentes cada carta é recebida no seu próprio mês de referência; nada é somado para um bem único."}
          </p>
        </div>

        {/* C — conversa: a IA só extrai parâmetros, o cálculo continua no motor */}
        <div className="dsl-nao-imprime" style={{ marginTop: 18, background: "#0F1526", border: "1px solid #16213A", borderRadius: 14, padding: 14 }}>
          <label style={S.label} htmlFor="frase-disal">
            Montar conversando
          </label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              id="frase-disal"
              type="text"
              value={frase}
              onChange={(e) => setFrase(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !interpretando) interpretarFrase();
              }}
              placeholder="Ex.: juntar 3 cartas de 200 mil de imóvel"
              style={{ ...S.input, flex: "1 1 380px", minWidth: 0, fontFamily: "'Space Grotesk', sans-serif" } as any}
            />
            <button
              onClick={() => interpretarFrase()}
              disabled={interpretando}
              className="dsl-toque"
              style={{
                padding: "10px 24px",
                borderRadius: 10,
                border: 0,
                cursor: interpretando ? "wait" : "pointer",
                background: "linear-gradient(90deg,#8FB7FF,#36C5F0,#1E6FE6)",
                color: "#0A0E1A",
                fontWeight: 800,
              }}
            >
              {interpretando ? "Lendo…" : "Montar"}
            </button>
          </div>
          <p style={{ fontSize: 11, opacity: 0.5, margin: "8px 0 0" }}>
            A frase só preenche os controles — o crédito é encaixado num valor que existe no boletim e todo o cálculo
            continua no motor.
          </p>
          {erroFrase && <p style={{ color: "#F87171", fontSize: 12, margin: "8px 0 0" }}>{erroFrase}</p>}
          {resumoPedido && (
            <p style={{ fontSize: 12, opacity: 0.7, fontStyle: "italic", margin: "8px 0 0" }}>Entendi: {resumoPedido}</p>
          )}
        </div>

        <div className="dsl-nao-imprime" style={{ marginTop: 18 }}>
          <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 8 }}>Atalhos — monta e calcula num clique</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => aplicarPreset(p)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 999,
                  border: "1px solid #16213A",
                  background: "#0F1526",
                  color: "#8FB7FF",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="dsl-nao-imprime" style={{ display: "flex", gap: 8, margin: "20px 0" }}>
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
            disabled={segmentoBloqueado}
            title={segmentoBloqueado ? razaoBloqueio : undefined}
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              border: segmentoBloqueado ? "1px solid #16213A" : 0,
              cursor: segmentoBloqueado ? "not-allowed" : "pointer",
              background: segmentoBloqueado ? "transparent" : "linear-gradient(90deg,#8FB7FF,#36C5F0,#1E6FE6)",
              color: segmentoBloqueado ? "#6b7280" : "#0A0E1A",
              fontWeight: 800,
            }}
          >
            + Adicionar à junção
          </button>
          <span style={{ fontSize: 11, opacity: 0.55 }}>
            {modo === "juncao"
              ? `Junte cartas do mesmo segmento para um bem só (${QTD_MIN} a ${QTD_MAX} por linha).`
              : `Cotas independentes, cada uma com o seu bem (${QTD_MIN} a ${QTD_MAX} por linha).`}
          </span>
        </div>

        {/* D.1 — parcela alvo: sugere, não aplica sozinho */}
        <div className="dsl-nao-imprime" style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label style={S.label} htmlFor="alvo">
              Parcela que o cliente aguenta (R$/mês)
            </label>
            <input
              id="alvo"
              type="text"
              inputMode="decimal"
              value={parcelaAlvo}
              onChange={(e) => setParcelaAlvo(e.target.value)}
              placeholder="ex.: 6000"
              className="dsl-toque"
              style={{ ...S.input, width: 160 } as any}
            />
          </div>
          {qtdSugerida != null && (
            <button
              onClick={aplicarQuantidadeSugerida}
              className="dsl-toque"
              style={{
                padding: "10px 18px",
                borderRadius: 10,
                border: "1px solid #1E6FE6",
                background: "transparent",
                color: "#8FB7FF",
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 12,
              }}
            >
              Sugerir {qtdSugerida} {qtdSugerida === 1 ? "carta" : "cartas"} de {fmtCredito(itemAtual().credito)}
            </button>
          )}
          {parcelaAlvo.trim() !== "" && qtdSugerida == null && (
            <span style={{ fontSize: 11, color: "#FCD34D" }}>Valor não reconhecido.</span>
          )}
          <span style={{ fontSize: 11, opacity: 0.5, maxWidth: 380, lineHeight: 1.5 }}>
            Só sugere — nada é aplicado sem o seu clique. Conta feita sobre a parcela inicial da configuração atual.
          </span>
        </div>

        {segmentoBloqueado && (
          <p
            style={{
              marginTop: 10,
              marginBottom: 0,
              background: "#1a1207",
              border: "1px solid #3f2d0a",
              borderRadius: 10,
              padding: "10px 14px",
              fontSize: 12,
              color: "#FCD34D",
              lineHeight: 1.5,
            }}
          >
            🚫 {razaoBloqueio}
          </p>
        )}

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
                {modo === "juncao" ? "Junção de cartas" : "Cotas independentes"} · {carteira.cotas}{" "}
                {carteira.cotas === 1 ? "carta" : "cartas"} em {carteira.itens}{" "}
                {carteira.itens === 1 ? "linha" : "linhas"}
                {modo === "juncao" && segmentoDaJuncao
                  ? ` · ${segmentoDaJuncao === "imovel" ? "Imóveis" : "Veículos"}`
                  : ""}
              </div>
              <button
                onClick={limparJuncao}
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
                {modo === "juncao" ? "Limpar junção" : "Limpar cotas"}
              </button>
            </div>

            {/* aviso permanente da junção — mesma frase que vai no texto do cliente */}
            {modo === "juncao" && (
            <p
              style={{
                marginTop: 10,
                marginBottom: 0,
                background: "#1a1207",
                border: "1px solid #3f2d0a",
                borderRadius: 10,
                padding: "10px 14px",
                fontSize: 12,
                color: "#FCD34D",
                lineHeight: 1.5,
              }}
            >
              ⚠️ {AVISO_JUNCAO}
            </p>
            )}

            {modo === "juncao" && juncaoInvalida && (
              <p
                style={{
                  marginTop: 10,
                  marginBottom: 0,
                  background: "#2a0d0d",
                  border: "1px solid #7f1d1d",
                  borderRadius: 10,
                  padding: "10px 14px",
                  fontSize: 12,
                  color: "#F87171",
                  lineHeight: 1.5,
                }}
              >
                🚫 Estado inválido: há cartas de segmentos diferentes nesta junção. Limpe a junção — os números acima
                não representam uma junção possível.
              </p>
            )}

            <div style={{ marginTop: 12, overflowX: "auto" }}>
              <table className="dsl-tabela-junc" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ color: "#8FB7FF", textAlign: "left" }}>
                    {["Carta", "Cód. bem", "Qtd.", "Carta de crédito", "× qtd.", "Parcela unit. (1ª)", "Parcela × qtd.", ""].map(
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
                        <td data-rot="Cód. bem" style={{ padding: "8px 10px", fontFamily: "'IBM Plex Mono',monospace", opacity: 0.7 }}>
                          {i.cod}
                        </td>
                        <td data-rot="Quantidade" style={{ padding: "8px 10px" }}>
                          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                            <button
                              className="dsl-toque"
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
                              className="dsl-toque"
                              type="number"
                              min={QTD_MIN}
                              max={QTD_MAX}
                              value={i.quantidade}
                              onChange={(e) => mudarQuantidade(i.id, +e.target.value)}
                              aria-label={`Quantidade de cartas — ${i.rotulo}`}
                              style={{ ...S.input, width: 64, padding: "4px 6px", textAlign: "center" } as any}
                            />
                            <button
                              className="dsl-toque"
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
                        <td data-rot="Carta de crédito" style={{ padding: "8px 10px", fontFamily: "'IBM Plex Mono',monospace" }}>
                          {fmtCredito(i.credito)}
                        </td>
                        <td data-rot="× qtd." style={{ padding: "8px 10px", fontFamily: "'IBM Plex Mono',monospace", color: "#8FB7FF" }}>
                          {fmtCredito(i.credito * i.quantidade)}
                        </td>
                        <td data-rot="Parcela unit. (1ª)" style={{ padding: "8px 10px", fontFamily: "'IBM Plex Mono',monospace" }}>
                          {fmtValor(parcelaUnit)}
                        </td>
                        <td data-rot="Parcela × qtd." style={{ padding: "8px 10px", fontFamily: "'IBM Plex Mono',monospace", color: "#8FB7FF" }}>
                          {fmtValor(parcelaUnit * i.quantidade)}
                        </td>
                        <td className="dsl-nao-imprime" style={{ padding: "8px 10px" }}>
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
                [modo === "juncao" ? "Cartas na junção" : "Cotas", String(carteira.cotas)],
                [modo === "juncao" ? "Poder de compra combinado" : "Crédito total", fmtCredito(carteira.creditoTotal)],
                ["Parcela inicial somada", `${fmtValor(carteira.parcelaInicial)}/mês`],
                ["Total do plano (sem reajustes)", fmtValor(carteira.totalPlano)],
                [
                  modo === "juncao" ? "Custo além do poder de compra" : "Custo além do crédito",
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
              <label style={S.label} htmlFor="cjuncao">
                {modo === "juncao"
                  ? "Cenário de referência — mês da última contemplação da junção"
                  : "Cenário de referência — mês de recebimento da carta"}
              </label>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  id="cjuncao"
                  type="number"
                  min={1}
                  max={carteira.prazoMaximo}
                  value={cJuncao ?? cJuncaoDefault}
                  onChange={(e) => setCJuncao(+e.target.value)}
                  className="dsl-toque"
                  style={{ ...S.input, width: 90 } as any}
                />
                {CENARIOS_C[modo].map((c) => (
                  <button
                    key={c}
                    onClick={() => setCJuncao(c)}
                    className="dsl-toque"
                    style={{
                      ...S.pill(cJuncaoEfetivo === c),
                      padding: "6px 14px",
                      fontSize: 12,
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: 11, opacity: 0.55, marginTop: 8, marginBottom: 0, lineHeight: 1.5 }}>
                {modo === "juncao" ? (
                  <>
                    É só quando a última carta é contemplada que o poder de compra combinado fica utilizável — por
                    isso o custo é medido nesse mês, não no da primeira. Quanto mais cartas, mais tarde tende a ser a
                    última contemplação. Cenário declarado para comparar opções, nunca uma data prometida ao cliente.
                  </>
                ) : (
                  <>
                    Cada cota é recebida no seu próprio mês de referência. Cenário declarado, nunca data prometida.
                  </>
                )}{" "}
                Padrão: {cJuncaoDefault}.
                {cJuncao != null && cJuncao !== cJuncaoEfetivo
                  ? ` Ajustado para ${cJuncaoEfetivo} — limite do plano mais longo (${carteira.prazoMaximo} meses).`
                  : ""}
              </p>
            </div>

            {/* B — métrica principal decidida pela regra do C */}
            <div style={{ ...S.card, marginTop: 10 }}>
              <div style={{ fontSize: 11, opacity: 0.6 }}>
                {modo === "juncao" ? "Custo efetivo da junção" : "Custo efetivo das cotas"} (TIR sobre o fluxo
                consolidado, Base 100% de referência)
              </div>

              {metrica?.tipo === "totais" && totaisFallback ? (
                <>
                  <div style={{ fontSize: 12, color: "#FCD34D", marginTop: 6, lineHeight: 1.5 }}>
                    Neste cenário o fluxo não fecha numa taxa única — nem com a correção projetada. Em vez de uma
                    taxa que não existe, os números em reais:
                  </div>
                  <div
                    className="dsl-cards"
                    style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10, marginTop: 8 }}
                  >
                    <div>
                      <div style={{ fontSize: 11, opacity: 0.6 }}>
                        Total pago ao longo do plano {totaisFallback.projetado ? "(projetado)" : "(nominal)"}
                      </div>
                      <div className="dsl-num" style={{ fontSize: 17, color: "#E5E9F0" }}>
                        {fmtValor(totaisFallback.totalPagoProjetado)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, opacity: 0.6 }}>
                        Poder de compra no mês {cJuncaoEfetivo} {totaisFallback.projetado ? "(corrigido)" : "(nominal)"}
                      </div>
                      <div className="dsl-num" style={{ fontSize: 17, color: "#8FB7FF" }}>
                        {fmtValor(totaisFallback.poderDeCompraCorrigido)}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.55, marginTop: 8, lineHeight: 1.5 }}>
                    Os dois valores são do mesmo cenário declarado. Não há percentual aqui de propósito: um número
                    com cara de taxa, sem ser taxa, enganaria mais do que a ausência.
                  </div>
                </>
              ) : (
                <>
                  <div className="dsl-num" style={{ fontSize: 17, color: "#36C5F0", marginTop: 4 }}>
                    {custoEfetivoCurto}
                  </div>
                  {custoEfetivoCurtoComIndice && (
                    <div className="dsl-num" style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
                      {custoEfetivoCurtoComIndice}
                    </div>
                  )}
                  <div style={{ fontSize: 11, opacity: 0.55, marginTop: 6, lineHeight: 1.5 }}>
                    Cenário: {cenarioTexto}.
                    {metrica?.tipo === "tir_corrigida"
                      ? ` A partir do mês ${C_LIMIAR_CORRECAO} a métrica principal passa a ser a corrigida pelo índice — é a que continua fechando numa taxa única em cenários longos.`
                      : ""}
                  </div>
                </>
              )}

              {/* os números que o lance de fato melhora, ao lado da taxa */}
              {cenarioAtual && (
                <div
                  className="dsl-cards"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
                    gap: 10,
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: "1px solid #16213A",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 11, opacity: 0.6 }}>Prazo até quitar</div>
                    <div className="dsl-num" style={{ fontSize: 16, color: "#8FB7FF" }}>
                      {cenarioAtual.prazo} meses
                    </div>
                    {lancePct > 0 && (
                      <div style={{ fontSize: 10, opacity: 0.5 }}>
                        {carteira.prazoMaximo - cenarioAtual.prazo} a menos que sem lance
                      </div>
                    )}
                  </div>
                  <div>
                    <div style={{ fontSize: 11, opacity: 0.6 }}>
                      Total pago no cenário {cenarioAtual.projetado ? "(projetado)" : "(nominal)"}
                    </div>
                    <div className="dsl-num" style={{ fontSize: 16, color: "#8FB7FF" }}>
                      {fmtValor(cenarioAtual.totalPago)}
                    </div>
                    {lancePct > 0 && (
                      <div style={{ fontSize: 10, opacity: 0.5 }}>
                        inclui o lance de {fmtValor(cenarioAtual.lanceRS)}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* D.2 — lance próprio; embutido travado por falta de teto publicado */}
            <div className="dsl-nao-imprime" style={{ ...S.card, marginTop: 10 }}>
              <label style={S.label} htmlFor="lance">
                Lance próprio: {lancePct}% {lancePct > 0 ? `· ${fmtValor((carteira.creditoTotal * lancePct) / 100)}` : ""}
              </label>
              <input
                id="lance"
                type="range"
                min={0}
                max={50}
                value={lancePct}
                onChange={(e) => setLancePct(+e.target.value)}
                style={{ width: "100%" }}
              />
              <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4, lineHeight: 1.5 }}>
                O lance abate parcelas finais (antecipa a quitação). O que ele compra de verdade é chance de
                contemplar mais cedo — ao aumentar o lance, ajuste o cenário C para baixo.
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                <input type="range" min={0} max={50} value={0} disabled aria-label="Lance embutido (indisponível)"
                  style={{ width: 140, opacity: 0.35 }} />
                <span style={{ fontSize: 11, color: "#FCD34D", lineHeight: 1.5 }}>
                  Lance embutido indisponível — teto Disal não publicado; confirmar com a administradora.
                </span>
              </div>

              {/* comparação de 1 clique — dois cenários DECLARADOS */}
              {cenarioSemLance && cenarioComLance && (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #16213A" }}>
                  <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 8 }}>
                    Comparar cenários — os dois são hipóteses declaradas para conversar com o cliente, nenhum é
                    previsão de quando a carta sai.
                  </div>
                  <div
                    className="dsl-cards"
                    style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}
                  >
                    {[
                      { titulo: "Sem lance · C=36", r: cenarioSemLance },
                      { titulo: "Lance 30% · C=12", r: cenarioComLance },
                    ].map(({ titulo, r }) => {
                      const ativo = lancePct === r.lancePct && cJuncaoEfetivo === r.C;
                      return (
                        <div
                          key={titulo}
                          style={{ ...S.card, borderColor: ativo ? "#1E6FE6" : "#16213A" }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#8FB7FF" }}>{titulo}</div>
                          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>Custo efetivo</div>
                          <div className="dsl-num" style={{ fontSize: 15, color: "#36C5F0" }}>
                            {r.taxa}
                          </div>
                          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>Prazo até quitar</div>
                          <div className="dsl-num" style={{ fontSize: 15 }}>{r.prazo} meses</div>
                          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>
                            Total pago {r.projetado ? "(projetado)" : "(nominal)"}
                          </div>
                          <div className="dsl-num" style={{ fontSize: 15 }}>{fmtValor(r.totalPago)}</div>
                          <button
                            onClick={() => aplicarCenario(r.lancePct, r.C)}
                            className="dsl-toque"
                            style={{
                              marginTop: 10,
                              width: "100%",
                              padding: "8px 0",
                              borderRadius: 8,
                              border: "1px solid #1E6FE6",
                              background: ativo ? "linear-gradient(90deg,#36C5F0,#1E6FE6)" : "transparent",
                              color: ativo ? "#0A0E1A" : "#8FB7FF",
                              cursor: "pointer",
                              fontWeight: 700,
                              fontSize: 12,
                            }}
                          >
                            {ativo ? "Cenário aplicado ✓" : "Usar este cenário"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <p style={{ fontSize: 11, opacity: 0.5, marginTop: 8, marginBottom: 0, lineHeight: 1.5 }}>
                    O lance maior sai mais caro na taxa porque o dinheiro sai antes — o que ele melhora é o prazo e o
                    total pago. Por isso os dois cenários vêm com C diferente: comparar lance alto mantendo o mesmo
                    mês de contemplação esconde justamente o que o lance compra.
                  </p>
                </div>
              )}
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

            {/* H — projeção ano a ano + gráfico */}
            <div style={{ ...S.card, marginTop: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#8FB7FF", marginBottom: 2 }}>
                Sua parcela ano a ano
              </div>
              <div style={{ fontSize: 11, opacity: 0.6, lineHeight: 1.5, marginBottom: 8 }}>
                {projecaoDisponivel ? (
                  <>
                    Projeção com o índice acumulado dos últimos 12 meses
                    {rotuloIndices ? ` (${rotuloIndices})` : ""} — cenário, não promessa; o índice futuro varia.
                    {indiceNomeCarteira ? ` Índice do plano: ${indiceNomeCarteira}.` : ""}
                  </>
                ) : (
                  <>Projeção de índice indisponível — os valores abaixo são nominais, sem correção anual.</>
                )}
              </div>

              <GraficoParcela serie={serieParcela} projetada={projecaoDisponivel} fmtEixo={fmtCredito} />

              <div style={{ overflowX: "auto", marginTop: 10 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: "#8FB7FF", textAlign: "left" }}>
                      {["Ano", "Meses", projecaoDisponivel ? "Parcela/mês projetada" : "Parcela/mês (nominal)"].map(
                        (h) => (
                          <th key={h} style={{ padding: "6px 10px", borderBottom: "1px solid #16213A" }}>
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {anosProjetados.map((a) => (
                      <tr key={a.ano} style={{ borderBottom: "1px solid #10182B" }}>
                        <td style={{ padding: "6px 10px" }}>{a.ano}</td>
                        <td style={{ padding: "6px 10px", opacity: 0.7 }} className="dsl-num">
                          {a.mesInicio}–{a.mesFim}
                        </td>
                        <td style={{ padding: "6px 10px", color: "#8FB7FF" }} className="dsl-num">
                          {fmtValor(a.primeira)}
                          {a.mudaNoAno ? ` → ${fmtValor(a.ultima)}` : ""}
                          {a.mudaNoAno ? (
                            <span style={{ fontSize: 10, opacity: 0.5 }}> (uma carta termina no ano)</span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* D.4 — comissão Prospere. Só aparece com grade da PRÓPRIA
                administradora cadastrada. Hoje a Disal não está em
                consorcios.administradoras, então este bloco fica invisível —
                de propósito: herdar a grade da Porto seria inventar receita. */}
            {comissaoProspere && (
              <div style={{ ...S.card, marginTop: 10 }}>
                <div style={{ fontSize: 12, opacity: 0.6, fontWeight: 700, marginBottom: 6 }}>Comissão Prospere</div>
                <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "baseline" }}>
                  <div>
                    <div style={{ fontSize: 11, opacity: 0.6 }}>Total</div>
                    <div className="dsl-num" style={{ fontSize: 18, color: "#8FB7FF" }}>
                      {fmtValor(comissaoProspere.totalRS)}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.5 }}>
                      {fmtPct2(comissaoProspere.pctTotal)} do crédito
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, opacity: 0.6 }}>Cronograma de recebimento</div>
                    <div className="dsl-num" style={{ fontSize: 13 }}>
                      {comissaoProspere.cronogramaRS.every((v) => Math.abs(v - comissaoProspere.cronogramaRS[0]) < 0.01)
                        ? `${comissaoProspere.cronogramaRS.length}× ${fmtValor(comissaoProspere.cronogramaRS[0])}`
                        : comissaoProspere.cronogramaRS.map((v, i) => `${i + 1}ª ${fmtValor(v)}`).join(" · ")}
                    </div>
                  </div>
                </div>
                <p style={{ fontSize: 11, opacity: 0.6, marginTop: 10, marginBottom: 0 }}>
                  {comissaoProspere.observacao ??
                    "Recebimento condicionado ao pagamento das parcelas pelo cliente. Não considera período de campanha."}
                </p>
              </div>
            )}

            {/* G — comparador com financiamento */}
            <div style={{ ...S.card, marginTop: 10 }}>
              <button
                onClick={() => setComparadorAberto((v) => !v)}
                className="dsl-nao-imprime"
                aria-expanded={comparadorAberto}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: "transparent",
                  border: 0,
                  color: "#8FB7FF",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                {comparadorAberto ? "▾" : "▸"} Comparar com financiamento
              </button>

              {comparadorAberto && (
                <div style={{ marginTop: 12 }}>
                  <p style={{ fontSize: 11, opacity: 0.6, marginTop: 0, lineHeight: 1.5 }}>
                    Digite a taxa da proposta bancária que o cliente tem em mãos. Não há taxa padrão aqui de
                    propósito — a comparação vale pelo número do papel dele, não por uma referência inventada.
                  </p>

                  <div
                    className="dsl-cards"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
                      gap: 10,
                      marginBottom: 12,
                    }}
                  >
                    <div>
                      <label style={S.label} htmlFor="taxafin">
                        Taxa de juros do financiamento
                      </label>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          id="taxafin"
                          type="text"
                          inputMode="decimal"
                          value={taxaFin}
                          onChange={(e) => setTaxaFin(e.target.value)}
                          placeholder="ex.: 11,5"
                          style={{ ...S.input, width: "100%", minWidth: 0 } as any}
                        />
                        {(["aa", "am"] as const).map((u) => (
                          <button
                            key={u}
                            onClick={() => setUnidadeTaxa(u)}
                            className="dsl-toque"
                            style={{
                              padding: "0 10px",
                              borderRadius: 8,
                              border: "1px solid #1E6FE6",
                              cursor: "pointer",
                              background: unidadeTaxa === u ? "linear-gradient(90deg,#36C5F0,#1E6FE6)" : "transparent",
                              color: unidadeTaxa === u ? "#0A0E1A" : "#8FB7FF",
                              fontWeight: 700,
                              fontSize: 12,
                            }}
                          >
                            {u === "aa" ? "a.a." : "a.m."}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label style={S.label} htmlFor="entradafin">
                        Entrada (% do bem)
                      </label>
                      <input
                        id="entradafin"
                        type="number"
                        min={0}
                        max={99}
                        value={entradaPct}
                        onChange={(e) => setEntradaPct(Math.max(0, Math.min(99, +e.target.value || 0)))}
                        style={{ ...S.input, width: "100%" } as any}
                      />
                    </div>
                    <div>
                      <label style={S.label} htmlFor="prazofin">
                        Prazo (meses)
                      </label>
                      <input
                        id="prazofin"
                        type="number"
                        min={1}
                        max={480}
                        value={prazoFin ?? carteira.prazoMaximo}
                        onChange={(e) => setPrazoFin(Math.max(1, Math.min(480, +e.target.value || 1)))}
                        style={{ ...S.input, width: "100%" } as any}
                      />
                      <div style={{ fontSize: 10, opacity: 0.5, marginTop: 2 }}>
                        Padrão: o mesmo prazo do plano ({carteira.prazoMaximo} meses).
                      </div>
                    </div>
                  </div>

                  {!taxaFinValida ? (
                    <p style={{ fontSize: 12, opacity: 0.6, margin: 0 }}>
                      Informe a taxa para comparar.
                    </p>
                  ) : (
                    <>
                      <div
                        className="dsl-cards"
                        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}
                      >
                        <div style={{ ...S.card, borderColor: "#1E6FE6" }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#8FB7FF" }}>
                            Consórcio (junção atual)
                          </div>
                          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>Total do plano</div>
                          <div className="dsl-num" style={{ fontSize: 16, color: "#E5E9F0" }}>
                            {fmtValor(carteira.totalPlano)}
                          </div>
                          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>Custo além do poder de compra</div>
                          <div className="dsl-num" style={{ fontSize: 14, color: "#E5E9F0" }}>
                            {fmtValor(carteira.custoAlemCredito)} ({fmtPct(carteira.custoAlemCreditoPct)})
                          </div>
                          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>Custo efetivo/mês</div>
                          <div className="dsl-num" style={{ fontSize: 14, color: "#36C5F0" }}>
                            {custoEfetivoCurto}
                            {custoEfetivoCurtoComIndice ? (
                              <div style={{ fontSize: 11, opacity: 0.7 }}>{custoEfetivoCurtoComIndice}</div>
                            ) : null}
                          </div>
                          <div style={{ fontSize: 10, opacity: 0.5, marginTop: 6 }}>
                            Compra programada, sem juros de financiamento.
                          </div>
                        </div>

                        {comparaveis.map((f) => (
                          <div key={f.sistema} style={S.card}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#8FB7FF" }}>
                              Financiamento {f.sistema === "sac" ? "SAC" : "Price"}
                            </div>
                            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>Total pago (com entrada)</div>
                            <div className="dsl-num" style={{ fontSize: 16, color: "#E5E9F0" }}>
                              {fmtValor(f.totalPago)}
                            </div>
                            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>Custo além do bem</div>
                            <div className="dsl-num" style={{ fontSize: 14, color: "#E5E9F0" }}>
                              {fmtValor(f.custoAlemDoBem)} ({fmtPct(f.custoAlemDoBemPct)})
                            </div>
                            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>Custo efetivo/mês (TIR)</div>
                            <div className="dsl-num" style={{ fontSize: 14, color: "#36C5F0" }}>
                              {f.tirMes != null ? `${fmtPct2(f.tirMes * 100)} a.m.` : "não fecha numa taxa única"}
                            </div>
                            <div className="dsl-num" style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>
                              1ª {fmtValor(f.primeiraParcela)} · última {fmtValor(f.ultimaParcela)}
                            </div>
                          </div>
                        ))}
                      </div>

                      {comparaveis.some((f) => diferencaTotal(f) > 0) && (
                        <div
                          style={{
                            marginTop: 10,
                            background: "#052e16",
                            border: "1px solid #14532d",
                            borderRadius: 10,
                            padding: "10px 14px",
                          }}
                        >
                          {comparaveis
                            .filter((f) => diferencaTotal(f) > 0)
                            .map((f) => (
                              <p key={f.sistema} style={{ margin: "4px 0", fontSize: 13, color: "#4ade80" }}>
                                Economia projetada de <strong>{fmtValor(diferencaTotal(f))}</strong> ao longo do plano
                                frente ao financiamento {f.sistema === "sac" ? "SAC" : "Price"}.
                              </p>
                            ))}
                        </div>
                      )}

                      <p
                        style={{
                          marginTop: 10,
                          marginBottom: 0,
                          background: "#1a1207",
                          border: "1px solid #3f2d0a",
                          borderRadius: 10,
                          padding: "10px 14px",
                          fontSize: 12,
                          color: "#FCD34D",
                          lineHeight: 1.5,
                        }}
                      >
                        ⚠️ {AVISO_COMPARADOR}
                      </p>

                      <p style={{ fontSize: 11, opacity: 0.55, marginTop: 8, marginBottom: 0, lineHeight: 1.5 }}>
                        A parcela do consórcio acima é projetada pelo índice do plano
                        {indiceNomeCarteira ? ` (${indiceNomeCarteira})` : ""}; a do financiamento usa a taxa informada
                        como está — Price fixa, SAC decrescente. No crédito imobiliário a parcela do banco também
                        costuma ter correção (TR/IPCA, conforme o contrato), que esta simulação não aplica.
                      </p>
                    </>
                  )}
                </div>
              )}
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
            Gerador de proposta WhatsApp{" "}
            {temCarteira ? `· junção de ${carteira.cotas} ${carteira.cotas === 1 ? "carta" : "cartas"}` : ""}
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
          <div className="dsl-nao-imprime" style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <button
              onClick={imprimir}
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
              Imprimir
            </button>
            {temCarteira && (
              <button
                onClick={copiarLink}
                title="Link interno — só abre para quem tem sessão admin"
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
                {linkCopiado ? "Link copiado ✓" : "Copiar link da simulação"}
              </button>
            )}
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

        {/* F.2 — resumo sempre visível enquanto rola; no celular vira rodapé fixo */}
        {temCarteira && (
          <div
            className="dsl-barra"
            style={{
              position: "sticky",
              bottom: 12,
              zIndex: 5,
              marginTop: 20,
              background: "rgba(15,21,38,0.96)",
              border: "1px solid #1E6FE6",
              borderRadius: 14,
              padding: "10px 14px",
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
              {[
                [modo === "juncao" ? "Poder de compra" : "Crédito total", fmtCredito(carteira.creditoTotal)],
                ["Parcela inicial", `${fmtValor(carteira.parcelaInicial)}/mês`],
                [
                  "Custo efetivo",
                  custoEfetivoCurto,
                ],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 10, opacity: 0.55 }}>{k}</div>
                  <div className="dsl-num" style={{ fontSize: 14, color: "#8FB7FF" }}>
                    {v}
                  </div>
                </div>
              ))}
            </div>
            <div className="dsl-nao-imprime" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={imprimir}
                className="dsl-toque"
                style={{
                  padding: "8px 14px",
                  borderRadius: 10,
                  border: "1px solid #1E6FE6",
                  background: "transparent",
                  color: "#8FB7FF",
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 12,
                }}
              >
                Imprimir
              </button>
              <a
                href={linkWhatsApp("", textoProposta)}
                target="_blank"
                rel="noreferrer"
                className="dsl-toque"
                style={{
                  padding: "8px 16px",
                  borderRadius: 10,
                  border: 0,
                  background: "linear-gradient(90deg,#8FB7FF,#36C5F0,#1E6FE6)",
                  color: "#0A0E1A",
                  fontWeight: 800,
                  fontSize: 12,
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                }}
              >
                WhatsApp
              </a>
            </div>
          </div>
        )}

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
