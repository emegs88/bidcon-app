// ============================================================================
// Bidcon Reserve — plano de fee e template de legs (Slice 1) · lógica pura.
// ----------------------------------------------------------------------------
// Calcula: (1) o fee da Bidcon sobre o ágio, (2) a tarifa notarial por faixa
// (NOTARY_COSTS, não-reembolsável, paga pelo cliente) e (3) o template das legs
// de payout (split 40/40/20 + NOTARY_COSTS). Aritmética factual sobre valores da
// própria operação. Sem I/O, sem banco, sem dependências.
//
// COMPLIANCE: nada aqui é investimento/rendimento/retorno. É repartição de um
// ágio já acordado entre as partes da cessão. legs/fee NUNCA vão a payload de
// cliente (RLS + view redigida cuidam disso na camada de dados — 0016 §6).
//
// PARAMETRIZAÇÃO: os números (percentual do fee, mínimo, faixas de tarifa) ficam
// em constantes num lugar só. A tarifa notarial é por FAIXA (pct sobre o ágio, com
// piso por faixa), com `vigencia`+`fonte` versionadas. As 11 faixas foram TRANSCRITAS
// literalmente da tabela oficial do CNB-CF (fonte abaixo) — mínimos hardcoded como
// fonte de verdade. A validação final é o boleto real do wizard CNB (passo 2) na
// 1ª operação. A alocação do NOTARY_COSTS é parametrizável por reserva
// (BUYER|SELLER|SPLIT, default SPLIT 50/50) e a tarifa é NÃO-reembolsável em
// negócio desfeito.
// ============================================================================

import type { ReservaState } from "./state-machine";

/** Tipos de beneficiário de uma leg (espelha o check da tabela reserva_legs). */
export type BeneficiaryType =
  | "SELLER"
  | "PLATFORM"
  | "SOURCING_PARTNER"
  | "SELLING_PARTNER"
  | "OVERRIDE"
  | "CREDIT_PROVIDER"
  | "REFUND_BUYER"
  | "NOTARY_COSTS";

/** Uma perna do plano de payout (sem dado bancário — isso vive cifrado no banco). */
export interface Leg {
  beneficiary_type: BeneficiaryType;
  /** Perfil beneficiário (quando aplicável). null p/ NOTARY_COSTS (é o cartório). */
  beneficiary_id: string | null;
  amount: number;
  /**
   * Só na leg NOTARY_COSTS: como a tarifa é rateada entre as partes que a custeiam
   * (BUYER/SELLER/SPLIT) e o quanto cabe a cada uma. NÃO-reembolsável em negócio
   * desfeito (ver `legRefundBuyer`). Ausente nas demais legs.
   */
  notary_alloc?: {
    alocacao: AlocacaoNotarial;
    buyer: number;
    seller: number;
  };
}

/** Natureza da cota, para o percentual de fee correto. */
export type NaturezaCota = "contemplada" | "cancelada";

/** Arredonda para centavos (versão de nível de módulo, usável em constantes). */
function centavosLit(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

// ----- Constantes de negócio (um lugar só para mudar) ------------------------

/** Fee da Bidcon sobre o ágio: 10% em cota contemplada. */
export const FEE_PCT_CONTEMPLADA = 0.10;
/** Fee da Bidcon sobre o ágio: 6% em cota cancelada. */
export const FEE_PCT_CANCELADA = 0.06;
/** Piso do fee em reais, independentemente do percentual. */
export const FEE_MINIMO = 2500;

/** Split default do fee entre as partes internas: 40% sourcing / 40% selling / 20% plataforma. */
export const SPLIT_DEFAULT = {
  SOURCING_PARTNER: 0.40,
  SELLING_PARTNER: 0.40,
  PLATFORM: 0.20,
} as const;

/**
 * Faixas de tarifa notarial (NOTARY_COSTS) por valor MOVIMENTADO na operação
 * (= o ágio; NÃO o crédito da carta). Paga pelo cliente, NÃO-reembolsável.
 *
 * MODELO: cada faixa cobra `pct` sobre o valor, com piso `min`. `ate` = teto
 * inclusivo da faixa (null = faixa final, sem teto). Os mínimos são os VALORES
 * OFICIAIS da tabela CNB-CF (hardcoded como fonte de verdade).
 *
 * NOTA sobre a regra "mín = teto anterior × pct": era uma aproximação e NÃO
 * coincide com a tabela oficial em nenhuma faixa (o cartório fixa pisos próprios,
 * mais altos). Ex.: Faixa 2 tem piso R$500, não R$450 (=99.999,99×0,45%). Por isso
 * a regra NÃO é usada como assertion — fica só aqui como registro histórico.
 *
 * PROVENIÊNCIA / vigência da tabela abaixo:
 *   vigencia: "2026-04-01"
 *   fonte:    artigo "Conta Notarial (Escrow Account) — Esclarecimentos gerais"
 *             (CNB-CF) — URL em TARIFA_NOTARIAL_FONTE.
 *   TODO(negócio): "conferir contra o boleto real na abertura da 1ª operação"
 *   (o wizard CNB recalcula o custo no passo 2 — essa é a validação de verdade).
 *
 * Regra oficial confirmada com exemplo: operação de R$100.000 (Faixa 2) daria
 * R$450 a 0,45%, mas aplica-se o mínimo de R$500. Base = valor movimentado (ágio),
 * NÃO o crédito da carta.
 *
 * Despesas de cobrança (~R$2,00/boleto, ~R$1,00/TED) são custo operacional à parte
 * — NÃO entram nesta tabela de faixas.
 *
 * Distribuição interna da tarifa (Cartório 59% / CNB 1% / Safra 40%) é informação
 * de negócio — NÃO entra no cálculo. Fica só como comentário de referência.
 */
export const TARIFA_NOTARIAL_VIGENCIA = "2026-04-01" as const;
export const TARIFA_NOTARIAL_FONTE =
  "https://suporte.notariado.org.br/support/solutions/articles/43000735084-conta-notarial-escrow-account-esclarecimentos-gerais" as const;

export interface FaixaTarifa {
  /** Teto inclusivo da faixa em reais (null = faixa final, sem teto). */
  ate: number | null;
  /** Percentual sobre o valor movimentado (0 quando a faixa é só piso fixo). */
  pct: number;
  /** Piso em reais da faixa (mínimo oficial cobrado). */
  min: number;
}

/**
 * TABELA OFICIAL — 11 faixas transcritas literalmente da fonte CNB-CF
 * (TARIFA_NOTARIAL_FONTE), vigência a partir de 01/04/2026. Mínimos hardcoded
 * como fonte de verdade. `ate` = teto inclusivo da faixa (null = sem teto).
 * Base de cálculo = valor movimentado na operação (o ágio).
 *
 *   Faixa  Até (R$)              %       Mín. tarifa (R$)
 *    1     99.999,99             n/a       500,00
 *    2     100.000–299.999,99    0,45%     500,00
 *    3     300.000–499.999,99    0,35%   1.350,00
 *    4     500.000–699.999,99    0,32%   1.750,00
 *    5     700.000–999.999,99    0,31%   2.240,00
 *    6   1.000.000–1.999.999,99  0,23%   3.100,00
 *    7   2.000.000–2.999.999,99  0,17%   4.600,00
 *    8   3.000.000–3.999.999,99  0,16%   5.100,00
 *    9   4.000.000–4.999.999,99  0,15%   6.400,00
 *   10   5.000.000–5.999.999,99  0,14%   7.500,00
 *   11   ≥ 6.000.000,00          0,13%   8.400,00
 */
export const FAIXAS_TARIFA_NOTARIAL: FaixaTarifa[] = [
  { ate: 99_999.99, pct: 0, min: 500 },
  { ate: 299_999.99, pct: 0.0045, min: 500 },
  { ate: 499_999.99, pct: 0.0035, min: 1_350 },
  { ate: 699_999.99, pct: 0.0032, min: 1_750 },
  { ate: 999_999.99, pct: 0.0031, min: 2_240 },
  { ate: 1_999_999.99, pct: 0.0023, min: 3_100 },
  { ate: 2_999_999.99, pct: 0.0017, min: 4_600 },
  { ate: 3_999_999.99, pct: 0.0016, min: 5_100 },
  { ate: 4_999_999.99, pct: 0.0015, min: 6_400 },
  { ate: 5_999_999.99, pct: 0.0014, min: 7_500 },
  { ate: null, pct: 0.0013, min: 8_400 },
];

/** Alocação do NOTARY_COSTS entre as partes (parametrizável por reserva). */
export type AlocacaoNotarial = "BUYER" | "SELLER" | "SPLIT";
/** Padrão da alocação: rateio 50/50 entre comprador e vendedor. */
export const ALOCACAO_NOTARIAL_DEFAULT: AlocacaoNotarial = "SPLIT";

/** Arredonda para centavos, evitando ruído de ponto flutuante. */
function centavos(v: number): number {
  return centavosLit(v);
}

/** Percentual de fee conforme a natureza da cota. */
export function feePercentual(natureza: NaturezaCota): number {
  return natureza === "cancelada" ? FEE_PCT_CANCELADA : FEE_PCT_CONTEMPLADA;
}

/**
 * Fee da Bidcon sobre o ágio: max(percentual × ágio, mínimo). Ágio não-positivo
 * ⇒ fee = mínimo (piso sempre vale). Retorna valor em reais (2 casas).
 */
export function calcularFee(agio: number, natureza: NaturezaCota): number {
  const pct = feePercentual(natureza);
  const bruto = agio > 0 ? agio * pct : 0;
  return centavos(Math.max(bruto, FEE_MINIMO));
}

/**
 * Tarifa notarial pela faixa do VALOR MOVIMENTADO (o ágio). Cada faixa cobra
 * `max(pct × valor, min)`. Valor não-positivo ⇒ piso da 1ª faixa. Retorna reais.
 */
export function tarifaNotarial(valorOperacao: number): number {
  if (valorOperacao <= 0) return FAIXAS_TARIFA_NOTARIAL[0].min;
  for (const f of FAIXAS_TARIFA_NOTARIAL) {
    if (f.ate === null || valorOperacao <= f.ate) {
      return centavos(Math.max(valorOperacao * f.pct, f.min));
    }
  }
  // fallback defensivo (última faixa é sem teto, então não chega aqui):
  const ultima = FAIXAS_TARIFA_NOTARIAL[FAIXAS_TARIFA_NOTARIAL.length - 1];
  return centavos(Math.max(valorOperacao * ultima.pct, ultima.min));
}

/**
 * Reparte a tarifa notarial entre comprador e vendedor conforme a alocação.
 *   BUYER  → tudo no comprador · SELLER → tudo no vendedor · SPLIT → 50/50.
 * Retorna { buyer, seller } em reais. No SPLIT de valor ímpar, o buyer recebe o
 * complemento (t − seller): buyer + seller === tarifa SEMPRE (sem sumir/criar
 * dinheiro); a diferença entre as metades é de no máximo 1 centavo.
 */
export function repartirTarifaNotarial(
  tarifa: number,
  alocacao: AlocacaoNotarial = ALOCACAO_NOTARIAL_DEFAULT
): { buyer: number; seller: number } {
  const t = centavos(tarifa);
  if (alocacao === "BUYER") return { buyer: t, seller: 0 };
  if (alocacao === "SELLER") return { buyer: 0, seller: t };
  const seller = centavos(t / 2);
  const buyer = centavos(t - seller); // complemento garante soma exata
  return { buyer, seller };
}

/** Partes internas do split (ids dos perfis). Qualquer uma pode ser null. */
export interface PartesSplit {
  sourcing_partner_id: string | null;
  selling_partner_id: string | null;
  seller_id: string | null;
}

/**
 * Monta o template de legs de uma reserva NORMAL (caminho feliz):
 *   - SELLER recebe (ágio − fee): o vendedor fica com o ágio menos o fee Bidcon.
 *   - o fee Bidcon é repartido 40/40/20 em SOURCING/SELLING/PLATFORM.
 *   - NOTARY_COSTS entra como leg própria (cliente paga; cartório recebe).
 * Se um parceiro for null, sua fatia do split cai em PLATFORM (não some dinheiro).
 * A soma das legs de repasse do ágio (exceto NOTARY_COSTS) = ágio.
 *
 * A leg NOTARY_COSTS carrega o rateio comprador/vendedor em `notary_alloc`
 * (default SPLIT 50/50). A tarifa é NÃO-reembolsável: em anuência negada o refund
 * do buyer é integral sobre o PRINCIPAL (sinal), e a tarifa já paga não retorna.
 */
export function montarLegs(input: {
  agio: number;
  natureza: NaturezaCota;
  partes: PartesSplit;
  alocacaoNotarial?: AlocacaoNotarial;
}): Leg[] {
  const { agio, natureza, partes } = input;
  const alocacaoNotarial = input.alocacaoNotarial ?? ALOCACAO_NOTARIAL_DEFAULT;
  const fee = calcularFee(agio, natureza);
  const aoVendedor = centavos(Math.max(0, agio - fee));

  // reparte o fee; fatia de parceiro ausente vai p/ plataforma
  let sourcing = centavos(fee * SPLIT_DEFAULT.SOURCING_PARTNER);
  let selling = centavos(fee * SPLIT_DEFAULT.SELLING_PARTNER);
  let platform = centavos(fee - sourcing - selling); // resíduo garante soma exata

  if (!partes.sourcing_partner_id) {
    platform = centavos(platform + sourcing);
    sourcing = 0;
  }
  if (!partes.selling_partner_id) {
    platform = centavos(platform + selling);
    selling = 0;
  }

  const legs: Leg[] = [
    { beneficiary_type: "SELLER", beneficiary_id: partes.seller_id, amount: aoVendedor },
    { beneficiary_type: "PLATFORM", beneficiary_id: null, amount: platform },
  ];
  if (sourcing > 0)
    legs.push({ beneficiary_type: "SOURCING_PARTNER", beneficiary_id: partes.sourcing_partner_id, amount: sourcing });
  if (selling > 0)
    legs.push({ beneficiary_type: "SELLING_PARTNER", beneficiary_id: partes.selling_partner_id, amount: selling });

  // tarifa notarial (base = ágio movimentado; cliente paga; não-reembolsável)
  const tarifa = tarifaNotarial(agio);
  const rateio = repartirTarifaNotarial(tarifa, alocacaoNotarial);
  legs.push({
    beneficiary_type: "NOTARY_COSTS",
    beneficiary_id: null,
    amount: tarifa,
    notary_alloc: { alocacao: alocacaoNotarial, buyer: rateio.buyer, seller: rateio.seller },
  });

  return legs;
}

/**
 * Leg de refund em anuência negada (§5): devolve o PRINCIPAL (sinal) INTEGRAL ao
 * comprador. A tarifa notarial já paga NÃO volta (não-reembolsável) — por isso não
 * entra aqui e DEVE estar prevista no Termo. Espelha o que a RPC
 * `reserva_transicionar` faz ao entrar em ANUENCIA_DENIED.
 */
export function legRefundBuyer(buyerId: string | null, sinal: number): Leg {
  return { beneficiary_type: "REFUND_BUYER", beneficiary_id: buyerId, amount: centavos(sinal) };
}

/**
 * fee_plan em JSON para gravar em `reservas.fee_plan`. Snapshot factual do que
 * foi acordado, para auditoria. Não é payload de cliente. Carrega a vigência/fonte
 * da tabela de tarifa notarial usada, para rastreabilidade.
 */
export function montarFeePlan(input: {
  agio: number;
  natureza: NaturezaCota;
  partes: PartesSplit;
  alocacaoNotarial?: AlocacaoNotarial;
}): {
  agio: number;
  natureza: NaturezaCota;
  fee_pct: number;
  fee: number;
  tarifa_notarial: number;
  alocacao_notarial: AlocacaoNotarial;
  tarifa_notarial_vigencia: string;
  tarifa_notarial_fonte: string;
  legs: Leg[];
} {
  const fee = calcularFee(input.agio, input.natureza);
  const alocacaoNotarial = input.alocacaoNotarial ?? ALOCACAO_NOTARIAL_DEFAULT;
  return {
    agio: centavos(input.agio),
    natureza: input.natureza,
    fee_pct: feePercentual(input.natureza),
    fee,
    tarifa_notarial: tarifaNotarial(input.agio),
    alocacao_notarial: alocacaoNotarial,
    tarifa_notarial_vigencia: TARIFA_NOTARIAL_VIGENCIA,
    tarifa_notarial_fonte: TARIFA_NOTARIAL_FONTE,
    legs: montarLegs({ ...input, alocacaoNotarial }),
  };
}

/**
 * Faixa de sinal permitida (10–20% do ágio) — espelha o guard de `reserva_criar`
 * (0016 §5.2). Retorna {min,max} em reais para a UI validar antes de chamar a RPC.
 */
export function faixaSinal(agio: number): { min: number; max: number } {
  return { min: centavos(agio * 0.10), max: centavos(agio * 0.20) };
}

/** True se o sinal está dentro da faixa 10–20% do ágio. */
export function sinalValido(agio: number, sinal: number): boolean {
  const { min, max } = faixaSinal(agio);
  return sinal >= min && sinal <= max;
}

// Referência de estado (evita import não-usado ser removido; documenta o vínculo
// com a máquina de estados — o fee-plan é consumido nas transições de dinheiro).
export type { ReservaState };
