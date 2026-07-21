// ============================================================================
// Tool `buscar_planos` (Anthropic tool use) — FATIA 1 (venda nova).
// ----------------------------------------------------------------------------
// Análoga a lib/buscar-cartas-tool.ts (mesmo padrão: definição + executor que
// nunca lança + formatter), mas pro OUTRO motor de vendas do Time Prosperito:
// planos NOVOS (não contemplados) da Disal, dado estático do boletim mensal
// (lib/disal/atual.ts -> boletim-2026-07.ts), sem I/O — mesma fonte que já
// alimenta o simulador interno (app/interno/simulador-disal).
//
// Multiadministradora por PARÂMETRO (não por identidade de agente — ver
// cabeçalho de _prompt.ts/AGENTES.vendanova): `administradora` default
// 'disal', única suportada nesta fatia. Outra administradora -> erro
// explícito (nunca finge dado que não tem).
//
// Ajuste obrigatório #1 (aprovação condicional do Emerson): `credito_desejado`
// e `parcela_max` são MUTUAMENTE EXCLUSIVOS — o Apêndice B pergunta "qual
// parcela cabe no seu mês?" como caminho de diagnóstico alternativo ao
// crédito desejado. Nenhum dos dois -> erro pedindo um. Os dois -> erro
// (ambíguo). A tool NUNCA adivinha.
//
// Ajuste obrigatório #2: composição acima do teto (imóvel, >400k) é
// calculada AQUI (via lib/disal/calculo.ts/composicaoImovel), nunca pelo
// modelo — regra inegociável (composição só na mesma administradora) vira
// código. O agente só apresenta o que esta tool devolve.
//
// Regra permanente do Emerson ("toda simulação termina em TIR" — ver plano
// noble-herding-melody.md): a tool devolve DOIS campos de texto já prontos
// (`fasesTexto`, `custoEfetivoTexto`) que o modelo cita VERBATIM — nunca
// recompõe enumeração de parcelas nem custo de cabeça (fix do bug de
// composição observado em wa_mensagens id=48: modelo enumerou 2 das 3 fases
// mas declarou "220 meses"). Custo efetivo via TIR real sobre o fluxo de
// caixa (lib/disal/custo-efetivo-plano-novo.ts), cenário de contemplação
// declarado (nunca prometido) — default 36 meses (imóvel) / 24 (veículo),
// sobrescrevível por `mes_cenario`. Lance (`lance_pct`) NÃO muda o cenário
// de contemplação (Disal venda nova não tem corte_ultimo empírico como a
// Porto) — só muda o fluxo de caixa (crédito líquido recebido + abate de
// parcelas finais).
// ============================================================================
import { BOLETIM_DISAL_ATUAL } from "@/lib/disal/atual";
import {
  linhaAutoMaisProxima,
  linhaImovelMaisProxima,
  composicaoImovel,
  creditoMaximoAutoPorParcela,
  creditoMaximoImovelPorParcela,
  totalAuto,
  totalImovel,
} from "@/lib/disal/calculo";
import type { FaixaAuto, LinhaAuto, LinhaImovel } from "@/lib/disal/types";
import {
  custoEfetivoPlanoNovo,
  formatarCustoEfetivoTexto,
  formatarFasesTexto,
  chaveIndiceBcb,
  type FaseFluxo,
} from "@/lib/disal/custo-efetivo-plano-novo";
import { getIndicesBcb } from "@/lib/indices-bcb";

// Cenário de referência default (mês de contemplação DECLARADO, nunca uma
// promessa — regra permanente do Emerson). Mesmos defaults do
// simulador-cliente estático. `mes_cenario` no input da tool sobrescreve.
const MES_CENARIO_DEFAULT = { imovel: 36, veiculo: 24 } as const;

export const BUSCAR_PLANOS_TOOL = {
  name: "buscar_planos",
  description:
    "Busca planos NOVOS de consórcio (não contemplados) direto no boletim de crédito vigente. Use SEMPRE " +
    "que o cliente quiser COMEÇAR um consórcio do zero (nunca foi contemplado, quer entrar num grupo novo), " +
    "diferente de comprar carta já contemplada (essa é buscar_cartas). Informe credito_desejado (o crédito " +
    "que o cliente quer) OU parcela_max (o teto de parcela mensal que cabe no mês dele) — nunca os dois. " +
    "Se o cliente falou só quanto pode pagar por mês, use parcela_max; se falou o valor do bem/crédito, " +
    "use credito_desejado.",
  input_schema: {
    type: "object",
    properties: {
      tipo: {
        type: "string",
        enum: ["imovel", "veiculo"],
        description: "Tipo de bem: imovel ou veiculo. Obrigatório.",
      },
      credito_desejado: {
        type: "number",
        description:
          "Crédito desejado em reais (número puro). Não usar junto com parcela_max.",
      },
      parcela_max: {
        type: "number",
        description:
          "Teto de parcela mensal em reais (número puro) que cabe no orçamento do cliente — busca reversa " +
          "pelo maior crédito cuja parcela não ultrapassa esse valor. Não usar junto com credito_desejado.",
      },
      administradora: {
        type: "string",
        description: "Administradora do plano. Padrão 'disal' (única disponível nesta fatia).",
      },
      lance_pct: {
        type: "number",
        description:
          "Opcional: % do crédito em lance (0-100) que o cliente pretende dar na contemplação. Afeta o " +
          "custo_efetivo_texto (reduz o crédito líquido recebido e abate parcelas finais). Omitir = sem lance.",
      },
      mes_cenario: {
        type: "number",
        description:
          "Opcional: mês de contemplação usado como CENÁRIO DE REFERÊNCIA (nunca uma promessa) pro cálculo " +
          "do custo efetivo. Padrão: 36 (imóvel) / 24 (veículo). Só ajuste se o cliente pedir um cenário " +
          "específico — nunca invente um valor pra parecer mais rápido.",
      },
    },
    required: ["tipo"],
  },
} as const;

export type BuscarPlanosInput = {
  tipo?: unknown;
  credito_desejado?: unknown;
  parcela_max?: unknown;
  administradora?: unknown;
  lance_pct?: unknown;
  mes_cenario?: unknown;
};

export type FaseParcela = { meses: number; valor100: number; valor75: number };

export type PlanoEncontrado = {
  tipo: "imovel" | "veiculo";
  administradora: string;
  credito: number;
  cod: string;
  prazo: number;
  taxa: string;
  indice: string;
  /** auto: 1 fase (parcela fixa por todo o prazo); imóvel: 3 fases (1ª/13ª-219ª/220ª). */
  fases: FaseParcela[];
  total100: number;
  total75: number;
  /** Texto pronto da enumeração de fases (base 100%) — citar VERBATIM (nunca
   *  recompor de cabeça; fix do bug de composição de wa_mensagens id=48). */
  fasesTexto: string;
  /** Texto pronto do custo efetivo mensal via TIR (regra permanente do
   *  Emerson) — citar VERBATIM como última linha antes da pergunta de
   *  fechamento. Nunca recalcular nem reformular. */
  custoEfetivoTexto: string;
  /** Só imóvel: creditoDesejado > 400k (clampado no tier de 400k) ou < 200k (clampado em 200k). */
  tetoAtingido?: boolean;
  pisoAtingido?: boolean;
  /** Só imóvel, quando creditoDesejado > 400k: composição pronta na MESMA administradora
   *  (regra inegociável calculada em código — ver lib/disal/calculo.ts/composicaoImovel). */
  composicao?: {
    partes: { credito: number; cod: string }[];
    creditoTotal: number;
    fases: FaseParcela[];
    aproximado: boolean;
  };
};

export type ResultadoBuscarPlanos = { erro: string } | { total: 1; plano: PlanoEncontrado };

type CtxCustoEfetivo = {
  lancePct: number;
  mesCenario: number;
  indiceAnualPct: number | null;
};

function montarPlanoAuto(linha: LinhaAuto, faixa: FaixaAuto, ctx: CtxCustoEfetivo): PlanoEncontrado {
  const [credito, cod, parcela100, parcela75] = linha;
  const fasesBase100: FaseFluxo[] = [{ meses: faixa.prazo, valor: parcela100 }];
  const custoEfetivo = custoEfetivoPlanoNovo({
    fases: fasesBase100,
    credito,
    lancePct: ctx.lancePct,
    C: ctx.mesCenario,
    indiceAnualPct: ctx.indiceAnualPct,
  });
  return {
    tipo: "veiculo",
    administradora: "Disal",
    credito,
    cod,
    prazo: faixa.prazo,
    taxa: faixa.taxa,
    indice: faixa.indice,
    fases: [{ meses: faixa.prazo, valor100: parcela100, valor75: parcela75 }],
    total100: totalAuto(faixa, parcela100),
    total75: totalAuto(faixa, parcela75),
    fasesTexto: formatarFasesTexto(fasesBase100),
    custoEfetivoTexto: formatarCustoEfetivoTexto({
      resultado: custoEfetivo,
      C: ctx.mesCenario,
      indiceNome: faixa.indice,
      indiceAnualPct: ctx.indiceAnualPct,
    }),
  };
}

const FASES_IMOVEL_MESES: [number, number, number] = [12, 207, 1];

function fasesImovel(linha: LinhaImovel): FaseParcela[] {
  return FASES_IMOVEL_MESES.map((meses, i) => ({
    meses,
    valor100: linha.b100[i],
    valor75: linha.b75[i],
  }));
}

function montarPlanoImovel(
  linha: LinhaImovel,
  tetoAtingido: boolean,
  pisoAtingido: boolean,
  ctx: CtxCustoEfetivo,
  composicao?: ReturnType<typeof composicaoImovel>
): PlanoEncontrado {
  const fasesBase100: FaseFluxo[] = FASES_IMOVEL_MESES.map((meses, i) => ({ meses, valor: linha.b100[i] }));
  const custoEfetivo = custoEfetivoPlanoNovo({
    fases: fasesBase100,
    credito: linha.credito,
    lancePct: ctx.lancePct,
    C: ctx.mesCenario,
    indiceAnualPct: ctx.indiceAnualPct,
  });
  return {
    tipo: "imovel",
    administradora: "Disal",
    credito: linha.credito,
    cod: linha.cod,
    prazo: 220,
    taxa: "27%",
    indice: "INCC",
    fases: fasesImovel(linha),
    total100: totalImovel(linha.b100),
    total75: totalImovel(linha.b75),
    fasesTexto: formatarFasesTexto(fasesBase100),
    custoEfetivoTexto: formatarCustoEfetivoTexto({
      resultado: custoEfetivo,
      C: ctx.mesCenario,
      indiceNome: "INCC",
      indiceAnualPct: ctx.indiceAnualPct,
    }),
    tetoAtingido,
    pisoAtingido,
    ...(composicao
      ? {
          composicao: {
            partes: composicao.partes.map((p) => ({ credito: p.credito, cod: p.linha.cod })),
            creditoTotal: composicao.creditoTotal,
            fases: FASES_IMOVEL_MESES.map((meses, i) => ({
              meses,
              valor100: composicao.parcelaTotal100[i],
              valor75: composicao.parcelaTotal75[i],
            })),
            aproximado: composicao.aproximado,
          },
        }
      : {}),
  };
}

/** Executa a busca no boletim estático (sem I/O — mesma fonte do simulador
 *  interno). Nunca lança: entrada fora do formato/regra esperado devolve
 *  { erro } explícito (nunca adivinha tipo, nunca mistura credito_desejado
 *  com parcela_max, nunca finge administradora que não tem). Único I/O:
 *  busca dos índices BCB (INCC/IPCA) pro custo efetivo "com projeção" —
 *  cacheada 12h (lib/indices-bcb.ts), nunca bloqueia a resposta por muito
 *  tempo; se falhar, custoEfetivoTexto cai no fallback "projeção
 *  indisponível" (nunca inventa número). */
export async function buscarPlanos(input: BuscarPlanosInput): Promise<ResultadoBuscarPlanos> {
  const tipo = input.tipo === "imovel" || input.tipo === "veiculo" ? input.tipo : null;
  if (!tipo) return { erro: "tipo obrigatório: 'imovel' ou 'veiculo'." };

  const administradora =
    typeof input.administradora === "string" && input.administradora.trim()
      ? input.administradora.trim().toLowerCase()
      : "disal";
  if (administradora !== "disal") {
    return {
      erro: `administradora '${administradora}' ainda não disponível nesta fatia (só Disal por enquanto).`,
    };
  }

  const numPositivo = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
  const numNaoNegativo = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  const creditoDesejado = numPositivo(input.credito_desejado);
  const parcelaMax = numPositivo(input.parcela_max);

  if (creditoDesejado !== null && parcelaMax !== null) {
    return { erro: "informe credito_desejado OU parcela_max, nunca os dois na mesma busca." };
  }
  if (creditoDesejado === null && parcelaMax === null) {
    return {
      erro:
        "informe credito_desejado (crédito que o cliente quer) ou parcela_max (teto de parcela mensal que cabe no mês dele).",
    };
  }

  const lancePctInput = numNaoNegativo(input.lance_pct);
  const lancePct = lancePctInput != null ? Math.min(lancePctInput, 100) : 0;
  const mesCenarioInput = numPositivo(input.mes_cenario);
  const mesCenario = mesCenarioInput ?? MES_CENARIO_DEFAULT[tipo === "veiculo" ? "veiculo" : "imovel"];

  try {
    const boletim = BOLETIM_DISAL_ATUAL;

    // índice projetado (INCC imóvel / IPCA veículo) — real, acumulado 12m,
    // fonte BCB (lib/indices-bcb.ts). Nunca inventado; null em caso de falha.
    const indiceNomeBoletim = tipo === "veiculo" ? boletim.autosFaixaII.indice : boletim.imoveis220.indice;
    const chave = chaveIndiceBcb(indiceNomeBoletim);
    const { indices } = await getIndicesBcb();
    const indiceAnualPct = chave ? indices[chave]?.acumulado12m ?? null : null;

    const ctx: CtxCustoEfetivo = { lancePct, mesCenario, indiceAnualPct };

    if (tipo === "veiculo") {
      if (creditoDesejado !== null) {
        const { linha, faixa } = linhaAutoMaisProxima(
          creditoDesejado,
          boletim.autosFaixaII,
          boletim.autosFaixaIII
        );
        return { total: 1, plano: montarPlanoAuto(linha, faixa, ctx) };
      }
      const r = creditoMaximoAutoPorParcela(parcelaMax!, boletim.autosFaixaII, boletim.autosFaixaIII);
      if (!r) return { erro: "nenhum crédito de veículo no boletim atual cabe nessa parcela." };
      return { total: 1, plano: montarPlanoAuto(r.linha, r.faixa, ctx) };
    }

    // imovel
    if (creditoDesejado !== null) {
      const { linha, tetoAtingido, pisoAtingido } = linhaImovelMaisProxima(
        creditoDesejado,
        boletim.imoveis220
      );
      const composicao =
        creditoDesejado > 400000 ? composicaoImovel(creditoDesejado, boletim.imoveis220) : undefined;
      return { total: 1, plano: montarPlanoImovel(linha, tetoAtingido, pisoAtingido, ctx, composicao) };
    }
    const r = creditoMaximoImovelPorParcela(parcelaMax!, boletim.imoveis220);
    if (!r) return { erro: "nenhum crédito de imóvel no boletim atual cabe nessa parcela." };
    return { total: 1, plano: montarPlanoImovel(r.linha, false, false, ctx) };
  } catch (e) {
    console.error("[buscar_planos] erro inesperado:", e);
    return { erro: "erro ao consultar o boletim de planos." };
  }
}

/** Corpo do tool_result devolvido ao modelo — mesmo espírito de
 *  resultadoParaTool em buscar-cartas-tool.ts (JSON simples e explícito). */
export function resultadoParaToolPlanos(resultado: ResultadoBuscarPlanos): string {
  return JSON.stringify(resultado);
}
