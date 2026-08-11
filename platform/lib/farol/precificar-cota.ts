// ============================================================================
// Precificação de cota captada. EXTRATO-ANALISE-01, Entregas 2 e 3.
// ----------------------------------------------------------------------------
// A DIVISÃO DO TRABALHO QUE SUSTENTA A FATIA: a IA lê o documento, o CÓDIGO
// calcula. Nenhum número daqui vem de modelo generativo. As entradas são os
// campos já consolidados (lib/whatsapp/consolidar-extrato.ts); as saídas são
// dinheiro, e por isso moram em lib/ com teste — `scripts/testes.mjs` varre
// lib/ e NÃO varre páginas.
//
// O CUSTO É O MESMO DA VITRINE, DE PROPÓSITO. `taxaEfetivaMensal` é a função
// que já precifica todas as cartas expostas em app.bidcon.com.br. Reusá-la é o
// que torna a Entrega 3 (posição no estoque) uma comparação honesta: se a cota
// nova fosse medida por outra régua, o ranking seria decorativo.
//
// O MODELO DE REMUNERAÇÃO É O B, CONFIRMADO POR EMERSON EM 10/08/2026:
//   fee = max(ágio x 10%, R$ 2.500)  — incide sobre o ÁGIO, nunca sobre o crédito
//   cedente recebe = ágio - fee
// Canônico em lib/reserve/fee-plan.ts. Os 7% do crédito que aparecem em
// lib/playcontempladas-source.ts são MARGEM DE ORIGINAÇÃO de scraper, coisa
// diferente, e não entram aqui.
//
// O PISO APARECE NOMEADO. Em crédito pequeno o piso de R$ 2.500 domina o
// resultado: ágio de R$ 10.000 paga fee de R$ 2.500, que são 25% do ágio e não
// 10%. Diluir isso dentro de um "preço final" esconderia do cedente a única
// informação que muda a decisão dele. Por isso `piso_aplicado` viaja em cada
// linha de cenário até a tela.
// ============================================================================

import { taxaEfetivaMensal } from "@/lib/custo-efetivo";
import { calcularFee, feePercentual, FEE_MINIMO, type NaturezaCota } from "@/lib/reserve/fee-plan";

export type TipoBem = "imovel" | "veiculo";

// ----- Situação da cota: TRÊS estados aqui, DOIS na vitrine ------------------
//
// Decisão do Emerson em 10/08/2026. A vitrine tem `NaturezaCota` com dois
// valores ("contemplada" | "cancelada") porque é só disso que o fee precisa. A
// camada de ANÁLISE precisa de um terceiro, porque o extrato traz
// `contemplada: false` — que não quer dizer cancelada, quer dizer não
// contemplada ainda, numa cota que pode estar perfeitamente ativa.
//
// O tipo da vitrine NÃO é estendido. Traduzimos aqui, na fronteira, e a
// tradução é explícita e testada. Estender `NaturezaCota` de contrabando
// espalharia um terceiro caso por todo o código de dinheiro da casa para
// resolver um problema que é só desta tela.

/** Situação da cota na camada de análise. NÃO é a `NaturezaCota` da vitrine. */
export type EstadoCota = "contemplada" | "nao_contemplada" | "cancelada";

/**
 * Traduz o estado da análise para a natureza que o fee entende.
 * Só "cancelada" muda o percentual (6%); contemplada e não contemplada pagam os
 * mesmos 10% porque a aritmética do ágio é a mesma nas duas.
 */
export function naturezaParaFee(estado: EstadoCota): NaturezaCota {
  return estado === "cancelada" ? "cancelada" : "contemplada";
}

/**
 * O que o extrato consegue dizer sobre a situação — e o que ele NÃO consegue.
 *
 * `contemplada: true`  -> contemplada
 * `contemplada: false` -> não contemplada
 * `contemplada: null`  -> não lido
 *
 * NUNCA devolve "cancelada": nenhum extrato marca cancelamento no campo
 * booleano de contemplação. Cota cancelada é informação da administradora, e
 * entra por correção humana na tela — não por dedução nossa.
 */
export function estadoDoExtrato(contemplada: boolean | null): EstadoCota | null {
  if (contemplada === null) return null;
  return contemplada ? "contemplada" : "nao_contemplada";
}

export type BloqueioVitrine = {
  /** true quando esta cota não pode ser publicada, qualquer que seja o preço. */
  bloqueia: boolean;
  /** Frase pronta para a tela. null quando não há bloqueio. */
  motivo: string | null;
};

/**
 * A regra da casa: a Bidcon vende carta CONTEMPLADA. Cancelada não entra nunca.
 *
 * O bloqueio é de PUBLICAÇÃO, não de análise — a aritmética roda normalmente
 * nos três estados, porque saber o preço de uma cota que não pode ser publicada
 * ainda é informação útil (o cedente pergunta, a gente responde). O que não
 * pode é a carta escorregar para a vitrine sem alguém ter visto a bandeira.
 */
export function bloqueioDeVitrine(estado: EstadoCota): BloqueioVitrine {
  if (estado === "nao_contemplada")
    return { bloqueia: true, motivo: "não contemplada — não entra na vitrine" };
  if (estado === "cancelada")
    return { bloqueia: true, motivo: "cancelada — não entra na vitrine" };
  return { bloqueia: false, motivo: null };
}

/**
 * Teto de custo ao mês por tipo de bem, em % a.m. Vem da ordem
 * EXTRATO-ANALISE-01. É o custo acima do qual a carta encalha na vitrine.
 */
export const TETO_CUSTO_AM: Record<TipoBem, number> = {
  imovel: 1.0,
  veiculo: 1.5,
};

/** Faixa de varredura pedida na ordem, em fração do crédito. */
export const FAIXA_PADRAO = { min: 0.05, max: 0.4, passo: 0.01 } as const;

/**
 * Até onde a varredura pode ir procurando o teto quando ele não morde dentro da
 * faixa pedida. Medido na cota real da msg 27: o teto de 1,00% a.m. só é
 * alcançado perto de 56,7% do crédito — fora da faixa de 5% a 40% da ordem.
 * Uma tela que parasse em 40% e mostrasse linha em branco mentiria por omissão.
 */
export const LIMITE_BUSCA_TETO = 0.95;

/**
 * O custo ao mês, com os dois `null` de `taxaEfetivaMensal` SEPARADOS.
 *
 * A função canônica devolve null por dois motivos opostos: dado faltando, e
 * `parcela x prazo <= saldo` ("paga menos do que recebe: sem custo"). Na vitrine
 * os dois viram "—" e tudo bem, porque a carta ali já passou por conferência.
 * Numa tela de análise seria armadilha: o mesmo traço para um extrato ilegível e
 * para a melhor cota do estoque. É o "verde vazio" de novo.
 */
export type CustoMensal =
  | { tipo: "ok"; taxa_am: number }
  | { tipo: "sem_custo" }
  | { tipo: "inviavel" }
  | { tipo: "incompleta"; faltam: string[] };

/**
 * Custo ao mês de um cenário, em % a.m.
 *
 * NÃO reimplementa a matemática: delega a `taxaEfetivaMensal` (bisseção). O que
 * esta função acrescenta é só desambiguar o `null`.
 *
 * `inviavel` = o comprador desembolsa à vista um valor >= o crédito e AINDA
 * assume parcelas. Não existe taxa que descreva isso; devolver um número seria
 * pior que devolver a recusa.
 */
export function custoAoMes(
  saldo: number | null,
  parcela: number | null,
  prazo: number | null,
): CustoMensal {
  const faltam: string[] = [];
  if (saldo === null || !Number.isFinite(saldo)) faltam.push("saldo");
  if (parcela === null || !Number.isFinite(parcela) || parcela <= 0) faltam.push("valor da parcela");
  if (prazo === null || !Number.isFinite(prazo) || prazo <= 0) faltam.push("parcelas restantes");
  if (faltam.length > 0) return { tipo: "incompleta", faltam };

  const s = saldo as number;
  const p = parcela as number;
  const n = prazo as number;

  if (s <= 0) return { tipo: "inviavel" };
  if (p * n <= s) return { tipo: "sem_custo" };

  const taxa = taxaEfetivaMensal(s, p, n);
  // Neste ponto os dois motivos de null já foram descartados acima. Se ainda
  // vier null, é defeito nosso e não pode virar número.
  if (taxa === null) return { tipo: "incompleta", faltam: ["cálculo não fechou"] };
  return { tipo: "ok", taxa_am: taxa };
}

/** Só um custo "ok" pode ser comparado ao teto. `sem_custo` está sempre dentro. */
export function dentroDoTeto(custo: CustoMensal, teto: number): boolean {
  if (custo.tipo === "sem_custo") return true;
  if (custo.tipo === "ok") return custo.taxa_am <= teto;
  return false;
}

export type EntradaPrecificacao = {
  valor_credito: number | null;
  valor_parcela: number | null;
  parcelas_restantes: number | null;
  /**
   * Situação da cota, em TRÊS estados. Obrigatória e NÃO adivinhada.
   * `contemplada: false` no extrato vira "nao_contemplada", nunca "cancelada" —
   * traduzir uma na outra trocaria o fee de 10% por 6% em silêncio, que é errar
   * dinheiro por atalho de tipagem.
   */
  estado: EstadoCota | null;
  tipo_bem: TipoBem | null;
};

export type LinhaCenario = {
  /** Ágio em reais. É também o desembolso à vista do comprador. */
  agio: number;
  /** Ágio como fração do crédito, 0..1. */
  agio_pct: number;
  entrada_comprador: number;
  custo: CustoMensal;
  dentro_do_teto: boolean;
  /** Fee da Bidcon neste cenário (Modelo B). */
  fee: number;
  /** true quando o piso de R$ 2.500 mandou mais que o percentual. */
  piso_aplicado: boolean;
  /**
   * O fee como fração do ágio DE VERDADE, 0..1. Em ágio pequeno o piso faz
   * este número disparar muito acima dos 10% nominais.
   */
  fee_pct_efetivo: number;
  /**
   * Frase pronta para a tela quando o piso mandou. Regra do Emerson: mostrar o
   * percentual efetivo junto do piso, porque é ele que decide se o negócio faz
   * sentido para o cedente pequeno. null quando o piso não se aplica.
   */
  rotulo_piso: string | null;
  /** O que sobra para o cedente: ágio - fee. */
  ao_cedente: number;
};

/**
 * Uma linha de cenário para um ágio específico.
 * `entrada_comprador` é igual ao ágio de propósito: pelo `montarLegs` de
 * fee-plan.ts o fee vive DENTRO do ágio (o vendedor recebe `ágio - fee`), então
 * o comprador desembolsa o ágio cheio e nada além dele a título de comissão.
 */
export function cenario(
  agio: number,
  credito: number,
  parcela: number,
  prazo: number,
  estado: EstadoCota,
  teto: number,
): LinhaCenario {
  const natureza = naturezaParaFee(estado);
  const fee = calcularFee(agio, natureza);
  const bruto = agio > 0 ? agio * feePercentual(natureza) : 0;
  const custo = custoAoMes(credito - agio, parcela, prazo);
  const pisoAplicado = bruto < FEE_MINIMO;
  const feePctEfetivo = agio > 0 ? fee / agio : 0;
  return {
    agio,
    agio_pct: credito > 0 ? agio / credito : 0,
    entrada_comprador: agio,
    custo,
    dentro_do_teto: dentroDoTeto(custo, teto),
    fee,
    piso_aplicado: pisoAplicado,
    fee_pct_efetivo: feePctEfetivo,
    rotulo_piso: pisoAplicado ? rotuloPiso(feePctEfetivo) : null,
    ao_cedente: Math.max(0, agio - fee),
  };
}

/**
 * A frase do piso, montada aqui e não na tela — a tela só desenha.
 * Uma casa decimal, e não inteiro, porque perto de R$ 25.000 de ágio o efetivo
 * encosta em 10,0% e arredondar para "10%" faria o rótulo parecer o percentual
 * nominal, escondendo justamente o que ele existe para mostrar.
 */
export function rotuloPiso(feePctEfetivo: number): string {
  const pct = (feePctEfetivo * 100).toFixed(1).replace(".", ",");
  return `piso aplicado — ${pct}% do ágio neste preço`;
}

/**
 * Ágio a partir do qual a cota deixa de ser "sem custo".
 * Forma fechada, sem busca: `sem_custo` vale enquanto `parcela x prazo <= saldo`,
 * e `saldo = crédito - ágio`, logo o ponto de virada é
 * `ágio = crédito - parcela x prazo`.
 * Devolve null quando a virada cai em ágio negativo — isto é, quando a cota já
 * nasce com custo mesmo de graça.
 */
export function agioDeBreakEven(credito: number, parcela: number, prazo: number): number | null {
  const virada = credito - parcela * prazo;
  return virada > 0 ? virada : null;
}

/**
 * Maior ágio cujo custo ao mês ainda respeita o teto.
 *
 * Por bisseção, e por bisseção com um motivo: o custo é monotônico crescente no
 * ágio (mais ágio -> menos saldo -> mesma parcela amortizando menos -> taxa
 * maior), então a raiz é única e a bisseção não precisa de derivada nenhuma.
 * A doutrina da casa é bisseção, nunca Newton — ver CLAUDE.md e lib/tir.ts.
 *
 * Devolve null quando o teto NÃO limita até `LIMITE_BUSCA_TETO` do crédito.
 * Isso não é falha: é a resposta, e a tela precisa escrevê-la com todas as
 * letras ("o teto não limita nesta faixa").
 */
export function agioMaximoNoTeto(
  credito: number,
  parcela: number,
  prazo: number,
  teto: number,
  limite: number = LIMITE_BUSCA_TETO,
): number | null {
  if (!(credito > 0) || !(parcela > 0) || !(prazo > 0) || !(teto > 0)) return null;

  const hi0 = credito * limite;
  const custoHi = custoAoMes(credito - hi0, parcela, prazo);
  // Se nem no extremo o teto morde, ele não limita nesta faixa.
  if (dentroDoTeto(custoHi, teto)) return null;

  const custoLo = custoAoMes(credito - 0, parcela, prazo);
  // Se nem de graça a cota cabe no teto, não há ágio possível.
  if (!dentroDoTeto(custoLo, teto)) return 0;

  let lo = 0;
  let hi = hi0;
  for (let k = 0; k < 200; k++) {
    const meio = (lo + hi) / 2;
    if (dentroDoTeto(custoAoMes(credito - meio, parcela, prazo), teto)) lo = meio;
    else hi = meio;
    if (hi - lo < 0.01) break; // um centavo de precisão basta para dinheiro
  }
  return Math.floor(lo * 100) / 100;
}

export type Varredura = {
  status: "ok" | "incompleta";
  /** Nomes humanos do que falta. Vazio quando status === "ok". */
  faltam: string[];
  teto_am: number | null;
  linhas: LinhaCenario[];
  /** Ágio (R$) onde a cota deixa de ser "sem custo". */
  agio_break_even: number | null;
  /** Maior ágio dentro do teto, ou null quando o teto não limita. */
  agio_maximo_no_teto: number | null;
  /** true quando nenhuma linha da faixa PEDIDA encosta no teto. */
  teto_nao_limita_na_faixa: boolean;
  /** Frase literal para a tela quando o teto não limita. */
  aviso: string | null;
  /**
   * Bandeira de publicação. Viaja JUNTO com o preço, e não em vez dele: a
   * aritmética de uma cota não contemplada é válida e o cedente tem direito à
   * resposta; o que não pode é a carta chegar à vitrine sem alguém ter lido a
   * bandeira. null quando faltou dado para saber o estado.
   */
  bloqueio: BloqueioVitrine | null;
};

/**
 * A tabela de cenários da Entrega 2.
 *
 * A faixa pedida na ordem é 5% a 40% do crédito, de 1 em 1 ponto. Quando o teto
 * não morde dentro dela, a varredura CONTINUA até `LIMITE_BUSCA_TETO` para
 * conseguir responder "a partir de quanto o teto limita" — parar em 40% e
 * devolver silêncio seria mentir por omissão.
 */
export function varrerAgio(
  e: EntradaPrecificacao,
  faixa: { min: number; max: number; passo: number } = FAIXA_PADRAO,
): Varredura {
  const faltam: string[] = [];
  if (e.valor_credito === null || !(e.valor_credito > 0)) faltam.push("valor do crédito");
  if (e.valor_parcela === null || !(e.valor_parcela > 0)) faltam.push("valor da parcela");
  if (e.parcelas_restantes === null || !(e.parcelas_restantes > 0)) faltam.push("parcelas restantes");
  if (e.estado === null) faltam.push("situação da cota (contemplada, não contemplada ou cancelada)");
  if (e.tipo_bem === null) faltam.push("tipo do bem (imóvel ou veículo)");

  if (faltam.length > 0) {
    return {
      status: "incompleta",
      faltam,
      teto_am: null,
      linhas: [],
      agio_break_even: null,
      agio_maximo_no_teto: null,
      teto_nao_limita_na_faixa: false,
      aviso: null,
      bloqueio: null,
    };
  }

  const credito = e.valor_credito as number;
  const parcela = e.valor_parcela as number;
  const prazo = e.parcelas_restantes as number;
  const estado = e.estado as EstadoCota;
  const teto = TETO_CUSTO_AM[e.tipo_bem as TipoBem];

  const linhas: LinhaCenario[] = [];
  for (let pct = faixa.min; pct <= faixa.max + 1e-9; pct += faixa.passo) {
    const agio = Math.round(credito * pct * 100) / 100;
    linhas.push(cenario(agio, credito, parcela, prazo, estado, teto));
  }

  const agioTeto = agioMaximoNoTeto(credito, parcela, prazo, teto);
  const maxDaFaixa = credito * faixa.max;
  const tetoNaoLimita = agioTeto === null || agioTeto >= maxDaFaixa;

  // Quando o teto morde fora da faixa pedida, acrescenta a linha do ponto exato
  // — é a única linha que responde "a partir de quanto encalha".
  if (agioTeto !== null && agioTeto > maxDaFaixa) {
    linhas.push(cenario(agioTeto, credito, parcela, prazo, estado, teto));
  }

  return {
    status: "ok",
    faltam: [],
    teto_am: teto,
    linhas,
    agio_break_even: agioDeBreakEven(credito, parcela, prazo),
    agio_maximo_no_teto: agioTeto,
    teto_nao_limita_na_faixa: tetoNaoLimita,
    aviso: tetoNaoLimita ? "o teto não limita nesta faixa" : null,
    bloqueio: bloqueioDeVitrine(estado),
  };
}

// ----- Entrega 3: posição no estoque ----------------------------------------

export type Comparavel = {
  id: string;
  valor_credito: number;
  custo_am: number;
};

export type PosicaoEstoque = {
  /** Quantas cartas comparáveis já existem na vitrine. */
  comparaveis: number;
  /** 1 = mais barata do que todas. Null quando não há custo para posicionar. */
  posicao: number | null;
  /** Quantas comparáveis ficam MAIS baratas que esta cota. */
  mais_baratas: number;
  /** Mediana do custo das comparáveis, em % a.m. Null quando não há nenhuma. */
  mediana_am: number | null;
};

/**
 * Onde esta cota entraria no estoque: mesmo tipo, crédito +-20%, ordenado por
 * custo ao mês. É o que separa "vende rápido" de "encalha".
 *
 * A filtragem por tipo acontece ANTES, em quem consulta o banco — esta função é
 * pura e recebe só os já comparáveis. `custo` vem de `custoAoMes`, então
 * `sem_custo` entra como a posição 1 (nada é mais barato que não ter custo) e
 * `incompleta`/`inviavel` devolvem posição null em vez de um lugar inventado.
 */
export function posicaoNoEstoque(
  custo: CustoMensal,
  creditoDaCota: number,
  universo: Comparavel[],
  banda = 0.2,
): PosicaoEstoque {
  const piso = creditoDaCota * (1 - banda);
  const teto = creditoDaCota * (1 + banda);
  const comparaveis = universo.filter(
    (c) => c.valor_credito >= piso && c.valor_credito <= teto && Number.isFinite(c.custo_am),
  );

  const custos = comparaveis.map((c) => c.custo_am).sort((a, b) => a - b);
  const mediana =
    custos.length === 0
      ? null
      : custos.length % 2 === 1
        ? custos[(custos.length - 1) / 2]
        : (custos[custos.length / 2 - 1] + custos[custos.length / 2]) / 2;

  if (custo.tipo === "incompleta" || custo.tipo === "inviavel") {
    return { comparaveis: comparaveis.length, posicao: null, mais_baratas: 0, mediana_am: mediana };
  }

  const minha = custo.tipo === "sem_custo" ? -Infinity : custo.taxa_am;
  const maisBaratas = custos.filter((c) => c < minha).length;

  return {
    comparaveis: comparaveis.length,
    posicao: maisBaratas + 1,
    mais_baratas: maisBaratas,
    mediana_am: mediana,
  };
}
