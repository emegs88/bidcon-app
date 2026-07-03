// ============================================================================
// Bidcon Repasse (Assunção de Dívida) — motor de preço · lógica PURA.
// ----------------------------------------------------------------------------
// Produto NOVO: repasse de cota já com crédito UTILIZADO. Não é venda de crédito
// — é troca de dívida + garantia. Duas pontas numa operação:
//   - REPASSANTE deposita o *valor combinado* na Conta Notarial (Prov. CNJ
//     197/2025) e, na anuência, tem o bem alienado liberado.
//   - CAPTADOR assume as parcelas apresentando bem próprio em garantia; recebe o
//     *líquido* só depois da anuência da administradora.
//
// CASCATA DE DEDUÇÃO (ordem fixa — DELTA-4, inalterada):
//   combinado
//     → Bidcon 10% (mín. R$2.500)                         [PLATFORM]
//     → sobre o RESTO, parceiro captador 10%              [PARTNER_CAPTATION]
//     → tarifa notarial (base = valor movimentado; split 50/50 default)
//     → líquido do captador                               [CAPTADOR_NET]
//   Aferição canônica: 70.000 → 7.000 → 63.000 → 6.300 → 56.700.
//
// CET-ALVO → COMBINADO (cascata reversa — DELTA-1, SEM TETO): dado o CET-alvo
// (default 2%/mês, editável), acha-se o líquido-alvo pela anuidade e inverte-se a
// cascata por ponto-fixo para o combinado que entrega esse líquido. A antiga trava
// "limitado a 50% do saldo" foi REMOVIDA — o combinado é o que fecha o CET-alvo.
//
// CET REAL: recalculado por Newton-Raphson sobre o LÍQUIDO (não o combinado) —
// casa com a régua "custo efetivo ... % a.m." (rótulo neutro; NUNCA "juros").
//
// SEGMENTO comanda o fluxo (DELTA-2): vem do campo Produto/Bem do extrato
// (AUT/AUTOMÓVEL → Automóvel; IMÓVEL → Imóvel) e define, sozinho, a correção anual
// do fluxo (Auto 0% · Imóvel 6% INCC, editáveis) e o comparativo bancário
// (Auto 1,80%/mês · Imóvel 1,10%/mês). Matrícula/CRLV são OPCIONAIS — só conferem
// ônus/alienação do bem, NUNCA identificam o segmento.
//
// COMPLIANCE: nada aqui é investimento/rendimento/retorno. É repartição factual de
// um valor combinado entre as partes da assunção de dívida. A plataforma NÃO move
// dinheiro — gera instrução + grava evento. Sem I/O, sem banco, sem rede/IA.
//
// PARIDADE: reusa `round2`/faixas/`tarifaNotarial`/`repartirTarifaNotarial` de
// `fee-plan.ts` VERBATIM (sem tocar naquele arquivo). Bate centavo a centavo com o
// JS público de `repasse.html` e com os casos de aferição BID-0442 / BID-0492.
// ============================================================================

import {
  tarifaNotarial,
  repartirTarifaNotarial,
  type AlocacaoNotarial,
} from "./fee-plan";

// ----------------------------------------------------------------------------
// round2 — VERBATIM de fee-plan.ts (`centavosLit`). Reexpresso aqui porque a
// função é privada de módulo lá; a FÓRMULA é idêntica, byte a byte.
// ----------------------------------------------------------------------------
/** Arredonda para centavos, evitando ruído de ponto flutuante (idêntico a fee-plan). */
export function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

// ----- Constantes da cascata de repasse (um lugar só para mudar) -------------

/** Fee da Bidcon sobre o valor combinado: 10%. */
export const BIDCON_PCT = 0.10;
/** Piso do fee Bidcon em reais (mínimo, quando há operação). */
export const BIDCON_MINIMO = 2500;
/** Comissão do parceiro captador (PARTNER_CAPTATION): 10% sobre o RESTO. */
export const PARTNER_CAPTATION_PCT = 0.10;

/** CET-alvo default (2% ao mês) — editável nas duas superfícies. */
export const CET_ALVO_DEFAULT = 0.02;
/** Exigência de garantia default (% da avaliação/laudo) — parametrizável por adm. */
export const EXIGENCIA_GARANTIA_PCT_DEFAULT = 100;

/** Segmento da cota — vem 100% do extrato (Produto/Bem). Comanda o fluxo. */
export type Segmento = "AUTOMOVEL" | "IMOVEL";

/** Parâmetros que o segmento comanda (DELTA-2). Correção anual + comparativo bancário. */
export interface ParametrosSegmento {
  /** Correção anual do fluxo (Automóvel 0% · Imóvel 6% INCC). */
  reajusteAnual: number;
  /** Taxa mensal do comparativo bancário (Automóvel 1,80% · Imóvel 1,10%). */
  comparativoBancarioMensal: number;
}

/** Defaults comandados pelo segmento (editáveis na UI). */
export const PARAMS_SEGMENTO: Record<Segmento, ParametrosSegmento> = {
  AUTOMOVEL: { reajusteAnual: 0.0, comparativoBancarioMensal: 0.018 },
  IMOVEL: { reajusteAnual: 0.06, comparativoBancarioMensal: 0.011 },
};

/**
 * Resolve o segmento a partir do campo Produto/Bem do extrato. Matrícula/CRLV
 * NÃO entram aqui (só ônus/alienação). Reconhece AUT/AUTO/AUTOMÓVEL → Automóvel;
 * IMOV/IMÓVEL/IMOVEL → Imóvel. Retorna null quando o texto não identifica.
 */
export function segmentoDoExtrato(produtoBem: string): Segmento | null {
  const t = (produtoBem || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
  if (!t) return null;
  if (t.startsWith("AUT")) return "AUTOMOVEL";
  if (t.startsWith("IMOV") || t.includes("IMOVEL")) return "IMOVEL";
  return null;
}

// ----- Beneficiários das legs de repasse -------------------------------------

/**
 * Tipos de beneficiário das legs de repasse. Reusa `PLATFORM`/`NOTARY_COSTS` de
 * reserva_legs (0016) e antecipa `PARTNER_CAPTATION` (aditivo na 0017). Os pares
 * de entrada/saída da operação (`REPASSANTE_DEPOSITO`/`CAPTADOR_NET`) são o ponto
 * de revisão do SQL (novos tipos vs. reuso) — aqui são rótulos factuais do motor.
 */
export type RepasseBeneficiaryType =
  | "REPASSANTE_DEPOSITO"
  | "PLATFORM"
  | "PARTNER_CAPTATION"
  | "NOTARY_COSTS"
  | "CAPTADOR_NET";

/** Uma perna do plano de repasse (espelha o formato de reserva_legs). */
export interface RepasseLeg {
  beneficiary_type: RepasseBeneficiaryType;
  amount: number;
  notary_alloc?: {
    alocacao: AlocacaoNotarial;
    repassante: number;
    captador: number;
  };
}

// ----------------------------------------------------------------------------
// Anuidade com degrau anual (g) — valor presente do fluxo de parcelas.
// ----------------------------------------------------------------------------
/**
 * VP de `n` parcelas de valor `pmt`, descontadas à taxa mensal `i`, com a parcela
 * crescendo `g` a cada 12 meses (degraus anuais — o reajuste do contrato de
 * consórcio incide no aniversário). Quando `g = 0`, reduz à anuidade padrão
 * `pmt × (1 − (1+i)^-n) / i` (calculada aqui parcela a parcela p/ ficar idêntica
 * ao gabarito, sem divergência de forma fechada vs. laço).
 */
export function vpFluxo(pmt: number, n: number, i: number, g: number): number {
  if (pmt <= 0 || n <= 0) return 0;
  if (i === 0) {
    // sem desconto: soma nominal com os degraus anuais
    let soma = 0;
    let p = pmt;
    for (let m = 1; m <= n; m++) {
      if (m > 1 && (m - 1) % 12 === 0) p = round2(p * (1 + g));
      soma += p;
    }
    return soma;
  }
  let vp = 0;
  let p = pmt;
  for (let m = 1; m <= n; m++) {
    if (m > 1 && (m - 1) % 12 === 0) p = round2(p * (1 + g));
    vp += p / Math.pow(1 + i, m);
  }
  return vp;
}

// ----------------------------------------------------------------------------
// Cascata direta: combinado → PLATFORM → PARTNER_CAPTATION → NOTARY → líquido.
// ----------------------------------------------------------------------------

/** Fee da Bidcon sobre o combinado: max(10% × v, 2.500) quando há operação. */
export function feeBidcon(combinado: number): number {
  if (combinado <= 0) return 0;
  return round2(Math.max(combinado * BIDCON_PCT, BIDCON_MINIMO));
}

/** Resultado detalhado da cascata de dedução (base = valor combinado). */
export interface Cascata {
  combinado: number;
  /** Bidcon 10% (mín. 2.500) → leg PLATFORM. */
  bidcon: number;
  /** Combinado − Bidcon. */
  resto: number;
  /** 10% do resto → leg PARTNER_CAPTATION (null → some para PLATFORM). */
  parceiroCaptacao: number;
  /** Resto − parceiro. */
  posParceiro: number;
  /** Tarifa notarial TOTAL (faixa oficial sobre o valor movimentado). */
  notarialTotal: number;
  /** Parte da tarifa que cabe ao captador (rateio; default 50/50). */
  notarialCaptador: number;
  /** Parte da tarifa que cabe ao repassante (rateio; default 50/50). */
  notarialRepassante: number;
  /** Líquido do captador (posParceiro − parte notarial do captador). */
  liquido: number;
}

/**
 * Aplica a cascata de dedução na ordem fixa (DELTA-4). `temParceiro=false` faz a
 * fatia do parceiro captador NÃO ser cobrada do captador (some do fluxo — não
 * "vira" líquido nem platform; simplesmente não existe a comissão). `alocacaoNotarial`
 * default SPLIT: metade ao captador, metade ao repassante.
 *
 * Base da tarifa notarial = valor MOVIMENTADO. Aqui usamos o `combinado` como valor
 * movimentado (é o que transita pela Conta Notarial), idêntico ao gabarito.
 */
export function cascata(
  combinado: number,
  opts: { temParceiro?: boolean; alocacaoNotarial?: AlocacaoNotarial } = {}
): Cascata {
  const temParceiro = opts.temParceiro ?? true;
  const alocacaoNotarial = opts.alocacaoNotarial ?? "SPLIT";

  const c = round2(combinado);
  const bidcon = feeBidcon(c);
  const resto = round2(c - bidcon);
  const parceiroCaptacao = temParceiro ? round2(resto * PARTNER_CAPTATION_PCT) : 0;
  const posParceiro = round2(resto - parceiroCaptacao);

  const notarialTotal = tarifaNotarial(c);
  const rateio = repartirTarifaNotarial(notarialTotal, alocacaoNotarial);
  // repartirTarifaNotarial devolve {buyer, seller}; aqui buyer=repassante, seller=captador.
  const notarialRepassante = rateio.buyer;
  const notarialCaptador = rateio.seller;

  const liquido = round2(posParceiro - notarialCaptador);

  return {
    combinado: c,
    bidcon,
    resto,
    parceiroCaptacao,
    posParceiro,
    notarialTotal,
    notarialCaptador,
    notarialRepassante,
    liquido,
  };
}

// ----------------------------------------------------------------------------
// CET real por Newton-Raphson sobre o LÍQUIDO (não o combinado).
// ----------------------------------------------------------------------------
/**
 * Custo efetivo mensal do captador: a taxa `i` que zera VP(parcelas; i) − líquido.
 * Newton-Raphson com derivada numérica central. Seed 2%/mês; passo de segurança
 * (halving) evita taxas ≤ 0. Retorna 0 em entradas degeneradas.
 */
export function cetReal(liquido: number, pmt: number, n: number, g: number): number {
  if (liquido <= 0 || pmt <= 0 || n <= 0) return 0;
  let i = 0.02;
  const f = (x: number) => vpFluxo(pmt, n, x, g) - liquido;
  for (let k = 0; k < 200; k++) {
    const h = 1e-7;
    const d = (f(i + h) - f(i - h)) / (2 * h);
    if (Math.abs(d) < 1e-12) break;
    let ni = i - f(i) / d;
    if (ni <= 1e-5) ni = i / 2;
    if (Math.abs(ni - i) < 1e-12) {
      i = ni;
      break;
    }
    i = ni;
  }
  return i;
}

// ----------------------------------------------------------------------------
// CET-alvo → combinado (cascata reversa por ponto-fixo — SEM TETO, DELTA-1).
// ----------------------------------------------------------------------------
/**
 * Dado o CET-alvo (default 2%/mês), acha o COMBINADO que, passado pela cascata,
 * entrega o líquido cujo custo efetivo é exatamente o CET-alvo.
 *
 *   1) líquido-alvo = VP(parcelas; CET-alvo, g)  — o valor presente do fluxo à
 *      taxa-alvo é, por definição, o líquido que gera esse CET.
 *   2) inverte a cascata por ponto-fixo: combinado = líquido + bidcon(combinado)
 *      + parceiro(resto) + notarial_captador(combinado). Seed = líquido/0,81
 *      (aprox. do fator 1 − 0,10 − 0,10×0,90 quando notarial é pequena).
 *
 * SEM TETO: não há trava de 50% do saldo — o combinado é o que fecha o CET-alvo,
 * seja qual for a fração do saldo (a economia do repassante flutua com o prazo).
 */
export function combinadoParaCET(
  pmt: number,
  n: number,
  cetAlvo: number,
  g: number,
  opts: { temParceiro?: boolean; alocacaoNotarial?: AlocacaoNotarial } = {}
): number {
  if (pmt <= 0 || n <= 0) return 0;
  const liqAlvo = vpFluxo(pmt, n, cetAlvo, g);
  let v = liqAlvo / 0.81;
  for (let k = 0; k < 100; k++) {
    const casc = cascata(v, opts);
    // combinado = líquido + tudo que a cascata deduz até o líquido
    const nv = round2(liqAlvo + casc.bidcon + casc.parceiroCaptacao + casc.notarialCaptador);
    if (Math.abs(nv - v) < 1e-6) {
      v = nv;
      break;
    }
    v = nv;
  }
  return round2(v);
}

// ----------------------------------------------------------------------------
// Garantia — cobertura do bem do captador vs. exigência da administradora.
// ----------------------------------------------------------------------------
export type SeloGarantia = "APROVADO" | "APROVADO_COM_FOLGA" | "NAO_COBRE";

/** Resultado da aferição de garantia (DELTA-3). */
export interface AvaliacaoGarantia {
  /** % de cobertura = avaliação / saldo devedor × 100. */
  coberturaPct: number;
  /** Exigência mínima da administradora (default 100). */
  exigenciaPct: number;
  selo: SeloGarantia;
  /** APROVADO/COM FOLGA liberam; NAO_COBRE bloqueia. */
  bloqueia: boolean;
}

/**
 * Julga a garantia: o captador apresenta bem próprio cobrindo 100% da AVALIAÇÃO
 * (laudo), com mínimo parametrizado por administradora (`exigenciaPct`, default
 * 100). A cobertura é a avaliação sobre o saldo devedor assumido.
 *   - APROVADO COM FOLGA: ≥ exigência + 30 pts.
 *   - APROVADO: cobre a exigência.
 *   - NÃO COBRE: abaixo da exigência → bloqueia.
 * Liberação (fora deste cálculo): anuência + substituição de garantia registrada —
 * a alienação migra para o bem do captador e o bem do repassante é liberado.
 */
export function avaliarGarantia(
  avaliacaoLaudo: number,
  saldoDevedor: number,
  exigenciaPct: number = EXIGENCIA_GARANTIA_PCT_DEFAULT
): AvaliacaoGarantia {
  const coberturaPct =
    saldoDevedor > 0 ? round2((avaliacaoLaudo / saldoDevedor) * 100) : 0;
  let selo: SeloGarantia;
  if (coberturaPct >= exigenciaPct + 30) selo = "APROVADO_COM_FOLGA";
  else if (coberturaPct >= exigenciaPct) selo = "APROVADO";
  else selo = "NAO_COBRE";
  return { coberturaPct, exigenciaPct, selo, bloqueia: selo === "NAO_COBRE" };
}

// ----------------------------------------------------------------------------
// Legs de repasse — espelha o formato de reserva_legs.
// ----------------------------------------------------------------------------
/**
 * Monta as legs de payout de uma operação de repasse a partir do combinado:
 *   REPASSANTE_DEPOSITO = combinado + parte notarial do repassante (o que ele
 *     deposita na Conta Notarial — combinado mais sua metade do cartório);
 *   PLATFORM            = fee Bidcon (parceiro nulo → dobra p/ PLATFORM);
 *   PARTNER_CAPTATION   = comissão do parceiro captador (quando há parceiro);
 *   NOTARY_COSTS        = tarifa notarial TOTAL (com rateio repassante/captador);
 *   CAPTADOR_NET        = líquido do captador.
 *
 * Sem I/O: só devolve o template factual (o gravador de banco é outra fatia).
 */
export function montarLegsRepasse(
  combinado: number,
  opts: { temParceiro?: boolean; alocacaoNotarial?: AlocacaoNotarial } = {}
): RepasseLeg[] {
  const temParceiro = opts.temParceiro ?? true;
  const alocacaoNotarial = opts.alocacaoNotarial ?? "SPLIT";
  const casc = cascata(combinado, { temParceiro, alocacaoNotarial });

  // parceiro nulo → sua fatia não é cobrada; o fee Bidcon inteiro fica em PLATFORM.
  const platform = casc.bidcon;

  const legs: RepasseLeg[] = [
    {
      beneficiary_type: "REPASSANTE_DEPOSITO",
      amount: round2(casc.combinado + casc.notarialRepassante),
    },
    { beneficiary_type: "PLATFORM", amount: platform },
  ];

  if (temParceiro && casc.parceiroCaptacao > 0) {
    legs.push({
      beneficiary_type: "PARTNER_CAPTATION",
      amount: casc.parceiroCaptacao,
    });
  }

  legs.push({
    beneficiary_type: "NOTARY_COSTS",
    amount: casc.notarialTotal,
    notary_alloc: {
      alocacao: alocacaoNotarial,
      repassante: casc.notarialRepassante,
      captador: casc.notarialCaptador,
    },
  });

  legs.push({ beneficiary_type: "CAPTADOR_NET", amount: casc.liquido });

  return legs;
}

// ----------------------------------------------------------------------------
// Precificação de ponta a ponta (entrega tudo que as 2 superfícies mostram).
// ----------------------------------------------------------------------------
export interface EntradaRepasse {
  /** Saldo devedor assumido (da carta). */
  saldoDevedor: number;
  /** Parcela mensal atual. */
  parcela: number;
  /** Parcelas restantes. */
  parcelasRestantes: number;
  /** CET-alvo mensal (default 2%). Editável nas 2 superfícies. */
  cetAlvo?: number;
  /** Reajuste anual do fluxo (degrau a cada 12m). Default: comandado pelo segmento. */
  reajusteAnual?: number;
  /** Segmento (comanda correção anual + comparativo bancário). */
  segmento?: Segmento;
  temParceiro?: boolean;
  alocacaoNotarial?: AlocacaoNotarial;
  /** Avaliação do bem do captador (laudo), para a garantia. Opcional. */
  avaliacaoLaudo?: number;
  /** Exigência mínima de garantia (%). Default 100. */
  exigenciaGarantiaPct?: number;
}

export interface ResultadoRepasse {
  combinado: number;
  cascata: Cascata;
  liquido: number;
  cetReal: number;
  cetAlvo: number;
  /** O que o repassante deposita na Conta Notarial (combinado + sua metade notarial). */
  repassanteDeposita: number;
  /** Economia do repassante vs. o saldo devedor (flutua com o prazo). */
  economia: number;
  economiaPct: number;
  /** Comparativo bancário mensal comandado pelo segmento (quando informado). */
  comparativoBancarioMensal: number | null;
  legs: RepasseLeg[];
  garantia: AvaliacaoGarantia | null;
}

/**
 * Precifica a operação inteira: acha o combinado que fecha o CET-alvo, aplica a
 * cascata, recalcula o CET real por Newton sobre o líquido, monta as legs e (se
 * houver avaliação) julga a garantia. Reajuste anual: usa o do segmento quando não
 * informado explicitamente. Puro — sem I/O.
 */
export function precificarRepasse(input: EntradaRepasse): ResultadoRepasse {
  const cetAlvo = input.cetAlvo ?? CET_ALVO_DEFAULT;
  const segParams = input.segmento ? PARAMS_SEGMENTO[input.segmento] : null;
  const g =
    input.reajusteAnual ?? (segParams ? segParams.reajusteAnual : 0);
  const opts = {
    temParceiro: input.temParceiro ?? true,
    alocacaoNotarial: input.alocacaoNotarial ?? ("SPLIT" as AlocacaoNotarial),
  };

  const combinado = combinadoParaCET(
    input.parcela,
    input.parcelasRestantes,
    cetAlvo,
    g,
    opts
  );
  const casc = cascata(combinado, opts);
  const cet = cetReal(casc.liquido, input.parcela, input.parcelasRestantes, g);
  const repassanteDeposita = round2(casc.combinado + casc.notarialRepassante);
  const economia = round2(input.saldoDevedor - repassanteDeposita);
  const economiaPct =
    input.saldoDevedor > 0 ? round2((economia / input.saldoDevedor) * 100) : 0;

  const garantia =
    input.avaliacaoLaudo != null
      ? avaliarGarantia(
          input.avaliacaoLaudo,
          input.saldoDevedor,
          input.exigenciaGarantiaPct ?? EXIGENCIA_GARANTIA_PCT_DEFAULT
        )
      : null;

  return {
    combinado,
    cascata: casc,
    liquido: casc.liquido,
    cetReal: cet,
    cetAlvo,
    repassanteDeposita,
    economia,
    economiaPct,
    comparativoBancarioMensal: segParams
      ? segParams.comparativoBancarioMensal
      : null,
    legs: montarLegsRepasse(combinado, opts),
    garantia,
  };
}
