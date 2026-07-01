// ============================================================================
// Guarda-chuva (assunção + junção escalonada) — cálculo PURO (uso INTERNO).
// ----------------------------------------------------------------------------
// USO INTERNO da equipe Prospere (PROSPERE byAncora). Estes números (crédito
// somado, entrada, fundo comum, saldo devedor, parcela escalonada, custo
// efetivo) NUNCA aparecem para cliente/parceiro — vivem atrás do gate
// @prospere.com.br + RLS. Compliance: nada aqui é promessa de contemplação nem
// oferta ao cliente; é ferramenta de trabalho da equipe.
//
// O QUE É O GUARDA-CHUVA:
//   Estrutura de assunção onde UMA carta contemplada ("carta-mãe") puxa a
//   operação e a ela se juntam OUTRAS cartas (junção) para formar um único
//   poder de compra. O parcelamento é ESCALONADO: a parcela muda por faixa de
//   meses (ex.: 1–60 num valor, 61–62 noutro), replicando os prints de
//   referência.
//
// FONTE DAS FÓRMULAS (Print 3 "assunção Veículo", conferido nos totais):
//   crédito somado   = Σ crédito de cada carta da junção (mãe + demais)
//   entrada          = informada (R$) OU % do crédito somado
//   fundo comum      = Σ (crédito_i × fundoComum%_i)   [config por carta/grupo]
//   saldo devedor    = crédito somado × (1 + taxa adm.)   [se não informado]
//   crédito líquido  = crédito somado − entrada
//   Escalonado: lista de faixas {de, ate, parcela}. A soma paga em cada faixa é
//   parcela × (ate − de + 1). O prazo total é o maior `ate`.
//
//   Print 3 (assunção Veículo, 6 cartas):
//     crédito 438.415, entrada 219.209 (~50%), fundo comum 394.768,12,
//     saldo devedor 452.949, escalonado 1–60 / 61–62.  ✓ (bate nos totais)
//
// DECISÕES (config manual por grupo/carta, decisão B):
//   - cada carta entra com o crédito e, opcionalmente, o % de fundo comum dela.
//   - entrada, taxa de adm. e escalonamento são digitados pela equipe.
//   - campo faltante que impeça um derivado vira `null` (nunca 0 inventado).
//
// PRINCÍPIO: função pura. Entrada -> saída. Sem I/O, sem rede, sem mutação.
// O custo efetivo é delegado a `lib/custo-efetivo` (mesma fórmula das cartas).
// ============================================================================

import { taxaEfetivaMensal } from "./custo-efetivo";

// Uma carta que entra na junção. A primeira da lista é tratada como a
// carta-mãe (contemplada) apenas para rótulo — a aritmética soma todas igual.
export type CartaJuncao = {
  // rótulo curto p/ exibição (código/nome do bem). Só apresentação.
  rotulo?: string | null;
  // crédito-base do bem (valor da carta).
  credito: number;
  // % de fundo comum específico da carta (fração, ex.: 0.90). Opcional.
  fundoComumPct?: number | null;
  // fundo comum em R$ (prioridade sobre o %). Opcional.
  fundoComumRs?: number | null;
};

// Uma faixa do parcelamento escalonado: paga `parcela` dos meses `de` a `ate`.
export type FaixaEscalonada = {
  de: number;    // 1-based, inclusive
  ate: number;   // inclusive
  parcela: number; // R$/mês nesta faixa
};

export type EntradaGuardaChuva = {
  // cartas da junção (>= 1). A primeira é a "mãe" (contemplada) p/ rótulo.
  cartas: CartaJuncao[];

  // reajuste opcional do crédito somado por índice (INCC/IPCA) — fração
  // acumulada. Ex.: 0.05 = +5%. Aplicado ANTES da entrada/saldo. Ausente => 0.
  reajusteAcumulado?: number | null;

  // ENTRADA (recurso à vista). Informe R$ OU % do crédito somado. R$ prioridade.
  entradaRs?: number | null;
  entradaPct?: number | null; // fração (ex.: 0.50)

  // taxa de administração do grupo (fração). Só p/ estimar o saldo devedor
  // quando ele não é informado. Ex.: 0.24.
  taxaAdministracao?: number | null;
  // saldo devedor informado (R$). Prioridade sobre a estimativa por taxa adm.
  saldoDevedor?: number | null;

  // parcelamento escalonado por faixas. Vazio => sem parcela/prazo derivados.
  escalonado?: FaixaEscalonada[];
};

export type ResultadoGuardaChuva = {
  quantidadeCartas: number;
  creditoSomado: number;       // Σ créditos (já reajustado)
  entradaRs: number;           // entrada aplicada (informada ou estimada)
  fundoComumRs: number;        // Σ fundo comum das cartas (quando informado)
  saldoDevedor: number | null; // informado ou estimado por taxa adm.
  creditoLiquido: number;      // crédito somado − entrada
  parcelaInicial: number | null; // parcela da 1ª faixa (menor `de`)
  prazoTotal: number | null;   // maior `ate` das faixas
  totalParcelado: number | null; // Σ parcela×(ate−de+1) de todas as faixas
  custoEfetivoAm: number | null; // % a.m. sobre o crédito líquido (parcela inicial × prazo total)
  avisos: string[];
};

function centavos(n: number): number {
  return Math.round(n * 100) / 100;
}

// Resolve "R$ ou % do crédito": R$ prioridade; senão fração × crédito; senão null.
function rsOuPct(
  base: number,
  rs: number | null | undefined,
  pct: number | null | undefined
): number | null {
  if (rs != null) return centavos(rs);
  if (pct != null) return centavos(base * pct);
  return null;
}

/**
 * Calcula a estrutura guarda-chuva (assunção + junção escalonada). PURA: não
 * lê banco, não faz rede, não muta a entrada.
 */
export function calcularGuardaChuva(e: EntradaGuardaChuva): ResultadoGuardaChuva {
  const avisos: string[] = [];
  const cartas = e.cartas ?? [];

  if (cartas.length === 0) {
    avisos.push("Nenhuma carta na junção: informe ao menos a carta contemplada.");
  }

  const reajuste = e.reajusteAcumulado ?? 0;
  const fator = 1 + reajuste;

  // Crédito somado (reajustado) e fundo comum agregado das cartas.
  let creditoSomado = 0;
  let fundoComumRs = 0;
  for (const c of cartas) {
    const cred = centavos((c.credito ?? 0) * fator);
    creditoSomado += cred;
    const fc = rsOuPct(cred, c.fundoComumRs, c.fundoComumPct);
    if (fc != null) fundoComumRs += fc;
  }
  creditoSomado = centavos(creditoSomado);
  fundoComumRs = centavos(fundoComumRs);

  // Entrada (informada ou estimada por % do crédito somado).
  const entradaResolvida = rsOuPct(creditoSomado, e.entradaRs, e.entradaPct);
  if (entradaResolvida == null) {
    avisos.push("Entrada não informada: informe o valor (R$) ou o % da entrada.");
  }
  const entradaRs = entradaResolvida ?? 0;

  // Saldo devedor: informado tem prioridade; senão estima por taxa adm.
  let saldoDevedor: number | null = null;
  if (e.saldoDevedor != null) {
    saldoDevedor = centavos(e.saldoDevedor);
  } else if (e.taxaAdministracao != null) {
    saldoDevedor = centavos(creditoSomado * (1 + e.taxaAdministracao));
  }

  const creditoLiquido = centavos(creditoSomado - entradaRs);

  // Escalonamento: parcela inicial (menor `de`), prazo total (maior `ate`),
  // total parcelado (Σ parcela×qtdMeses). Faixas inválidas geram aviso.
  const faixas = (e.escalonado ?? []).filter((f) => f != null);
  let parcelaInicial: number | null = null;
  let prazoTotal: number | null = null;
  let totalParcelado: number | null = null;

  if (faixas.length > 0) {
    let menorDe = Infinity;
    let maiorAte = 0;
    let soma = 0;
    let algumaInvalida = false;
    for (const f of faixas) {
      const de = f.de;
      const ate = f.ate;
      if (!(de >= 1) || !(ate >= de) || !(f.parcela >= 0)) {
        algumaInvalida = true;
        continue;
      }
      const meses = ate - de + 1;
      soma += f.parcela * meses;
      if (de < menorDe) {
        menorDe = de;
        parcelaInicial = centavos(f.parcela);
      }
      if (ate > maiorAte) maiorAte = ate;
    }
    if (algumaInvalidaMsg(algumaInvalida)) {
      avisos.push("Faixa de escalonamento inválida ignorada (verifique de/até/parcela).");
    }
    if (maiorAte > 0) {
      prazoTotal = maiorAte;
      totalParcelado = centavos(soma);
    }
  }

  // Custo efetivo (% a.m.) sobre o crédito líquido, usando a parcela inicial
  // pelo prazo total. Simplificação: a fórmula Price assume parcela constante;
  // o escalonamento é aproximado pela parcela inicial (a de maior peso nos
  // prints). Delegado a lib/custo-efetivo (mesma fórmula das cartas).
  const custoEfetivoAm =
    parcelaInicial != null && prazoTotal != null
      ? taxaEfetivaMensal(creditoLiquido, parcelaInicial, prazoTotal)
      : null;

  return {
    quantidadeCartas: cartas.length,
    creditoSomado,
    entradaRs,
    fundoComumRs,
    saldoDevedor,
    creditoLiquido,
    parcelaInicial,
    prazoTotal,
    totalParcelado,
    custoEfetivoAm,
    avisos,
  };
}

// Pequeno helper puro só p/ manter a intenção explícita no if acima.
function algumaInvalidaMsg(flag: boolean): boolean {
  return flag === true;
}
