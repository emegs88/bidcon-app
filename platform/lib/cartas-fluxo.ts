// ============================================================================
// lib/cartas-fluxo.ts — helpers PUROS de fluxo e leitura de cartas.
// ----------------------------------------------------------------------------
// Aritmética/agregação sem I/O: as telas passam as linhas já lidas do banco.
// Um único lugar para: (a) fluxo diário de entrada (balança), (b) score de
// ranking top-10, (c) detecção de "custo baixo" (oportunidade) e (d) o recorte
// neutro de "cartas novas" para o cliente.
//
// COMPLIANCE (inviolável):
//   • Ranking e "oportunidade" são linguagem COMERCIAL → só Admin/Parceiro.
//     NUNCA exponha score/ranking/"oportunidade"/custo/comissão ao cliente.
//   • O cliente recebe apenas o recorte factual `cartasNovas()` (contagem e
//     lista neutra por janela de dias) — sem ordenar por "melhor".
//   • Nenhum termo de contemplação/prazo/rendimento/juros/CET aqui. O custo é
//     o "custo efetivo ~%/mês" já usado no site (lib/custo-efetivo.ts).
// ============================================================================

import { custoEfetivoCarta } from "./custo-efetivo";

// Forma mínima que os helpers precisam da carta. As telas selecionam ao menos
// estes campos; campos extras são ignorados.
export type CartaFluxo = {
  id: string;
  valor_credito: number;
  valor_entrada: number | null;
  valor_parcela: number | null;
  qtd_parcelas: number | null;
  status: string;
  criado_em: string; // ISO
};

// ---------------------------------------------------------------------------
// Utilidades de data (UTC-safe): reduz um timestamp ao dia "YYYY-MM-DD".
// ---------------------------------------------------------------------------
function diaISO(v: string | Date): string {
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function inicioDoDiaUTC(base: Date): Date {
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
}

/** Verdadeiro se `criado_em` está dentro dos últimos `dias` (inclui hoje). */
export function dentroDaJanela(criadoEm: string, dias: number, agora = new Date()): boolean {
  const t = new Date(criadoEm).getTime();
  if (Number.isNaN(t)) return false;
  const limite = agora.getTime() - dias * 24 * 60 * 60 * 1000;
  return t >= limite;
}

// ===========================================================================
// (a) BALANÇA — fluxo diário de entrada de cartas.
// Quantas cartas entram por dia (contagem + soma do crédito), série dos
// últimos N dias (mais antigo → mais recente), com dias sem entrada zerados.
// ===========================================================================
export type DiaFluxo = {
  dia: string; // "YYYY-MM-DD"
  quantidade: number;
  valorCredito: number;
};

export function fluxoDiario(
  cartas: CartaFluxo[],
  dias = 14,
  agora = new Date()
): DiaFluxo[] {
  const n = Math.max(1, Math.floor(dias));
  // esqueleto com todos os dias zerados (para a série não ter "buracos").
  const base = inicioDoDiaUTC(agora);
  const serie: DiaFluxo[] = [];
  const idx = new Map<string, DiaFluxo>();
  for (let k = n - 1; k >= 0; k--) {
    const d = new Date(base.getTime() - k * 24 * 60 * 60 * 1000);
    const dia = diaISO(d);
    const item: DiaFluxo = { dia, quantidade: 0, valorCredito: 0 };
    serie.push(item);
    idx.set(dia, item);
  }
  for (const c of cartas) {
    const dia = diaISO(c.criado_em);
    const item = idx.get(dia);
    if (!item) continue; // fora da janela
    item.quantidade += 1;
    item.valorCredito += Number(c.valor_credito) || 0;
  }
  return serie;
}

/** Resumo agregado do fluxo (hoje, média/dia, total da janela). */
export type ResumoFluxo = {
  hojeQtd: number;
  hojeCredito: number;
  totalQtd: number;
  totalCredito: number;
  mediaDia: number; // cartas/dia na janela
  dias: number;
  pico: DiaFluxo | null; // dia de maior entrada na janela
};

export function resumoFluxo(serie: DiaFluxo[]): ResumoFluxo {
  const dias = serie.length || 1;
  let totalQtd = 0;
  let totalCredito = 0;
  let pico: DiaFluxo | null = null;
  for (const d of serie) {
    totalQtd += d.quantidade;
    totalCredito += d.valorCredito;
    if (!pico || d.quantidade > pico.quantidade) pico = d;
  }
  const hoje = serie[serie.length - 1] ?? null;
  return {
    hojeQtd: hoje?.quantidade ?? 0,
    hojeCredito: hoje?.valorCredito ?? 0,
    totalQtd,
    totalCredito,
    mediaDia: totalQtd / dias,
    dias,
    pico,
  };
}

// ===========================================================================
// (c) OPORTUNIDADE (Admin/Parceiro) — "custo efetivo muito baixo".
// A carta é oportunidade quando o custo efetivo (%/mês) fica no quartil mais
// barato do conjunto disponível E abaixo de um teto absoluto de segurança.
// Só serve a telas internas; NUNCA vai ao cliente.
// ===========================================================================
export type CartaCusto = CartaFluxo & { custoEfetivo: number | null };

/** Anota cada carta com seu custo efetivo (%/mês) reaproveitando a fórmula única. */
export function anotarCusto(cartas: CartaFluxo[]): CartaCusto[] {
  return cartas.map((c) => ({ ...c, custoEfetivo: custoEfetivoCarta(c) }));
}

/**
 * Limiar de "custo baixo": menor entre um teto absoluto (`tetoAbs`, default
 * 1,00%/mês) e o 1º quartil dos custos calculáveis do conjunto. Retorna null
 * se não houver custos suficientes para um recorte estatístico honesto.
 */
export function limiarCustoBaixo(
  cartas: CartaCusto[],
  tetoAbs = 1.0
): number | null {
  const custos = cartas
    .map((c) => c.custoEfetivo)
    .filter((x): x is number => x != null && x > 0)
    .sort((a, b) => a - b);
  if (custos.length < 4) return null; // amostra pequena: sem quartil confiável
  const q1 = custos[Math.floor((custos.length - 1) * 0.25)];
  return Math.min(tetoAbs, q1);
}

/**
 * Cartas "oportunidade" (custo baixo): disponíveis, com custo ≤ limiar. Ordena
 * do mais barato ao menos barato. USO INTERNO (Admin/Parceiro).
 */
export function oportunidades(
  cartas: CartaFluxo[],
  opts: { tetoAbs?: number; limite?: number } = {}
): CartaCusto[] {
  const anotadas = anotarCusto(cartas.filter((c) => c.status === "disponivel"));
  const limiar = limiarCustoBaixo(anotadas, opts.tetoAbs ?? 1.0);
  if (limiar == null) return [];
  const sel = anotadas
    .filter((c) => c.custoEfetivo != null && c.custoEfetivo <= limiar)
    .sort((a, b) => (a.custoEfetivo as number) - (b.custoEfetivo as number));
  return opts.limite ? sel.slice(0, opts.limite) : sel;
}

// ===========================================================================
// (b) RANKING TOP-10 (Admin/Parceiro) — score composto e transparente.
// Combina: custo efetivo baixo (peso maior), novidade (entrou há pouco) e
// "prontidão" (carta disponível). Score em 0..100, só para telas internas.
// NUNCA client-facing (é ordenação por "melhor" → proibido ao cliente).
// ===========================================================================
export type CartaRankeada = CartaCusto & { score: number };

function normalizarInverso(valor: number, min: number, max: number): number {
  // menor = melhor (1), maior = pior (0). Robusto a min==max.
  if (!(max > min)) return 0.5;
  const x = (valor - min) / (max - min);
  return 1 - Math.min(1, Math.max(0, x));
}

export function rankearCartas(
  cartas: CartaFluxo[],
  opts: { janelaNovidade?: number; limite?: number; agora?: Date } = {}
): CartaRankeada[] {
  const agora = opts.agora ?? new Date();
  const janela = opts.janelaNovidade ?? 14;
  const disponiveis = anotarCusto(cartas.filter((c) => c.status === "disponivel"));

  const custos = disponiveis
    .map((c) => c.custoEfetivo)
    .filter((x): x is number => x != null && x > 0);
  const minC = custos.length ? Math.min(...custos) : 0;
  const maxC = custos.length ? Math.max(...custos) : 0;

  const rankeadas = disponiveis.map((c) => {
    // custo: 0..1 (menor custo → mais perto de 1). Sem custo calculável → 0,5 neutro.
    const sCusto =
      c.custoEfetivo != null && c.custoEfetivo > 0
        ? normalizarInverso(c.custoEfetivo, minC, maxC)
        : 0.5;
    // novidade: 1 no dia da entrada, decai linearmente até 0 ao fim da janela.
    const idadeDias =
      (agora.getTime() - new Date(c.criado_em).getTime()) / (24 * 60 * 60 * 1000);
    const sNovidade = Math.min(1, Math.max(0, 1 - idadeDias / janela));
    // prontidão: disponível = 1 (já filtramos), reservada/indisponível não entram.
    const sPronta = 1;
    // pesos: custo 0.6, novidade 0.3, prontidão 0.1.
    const score = 100 * (0.6 * sCusto + 0.3 * sNovidade + 0.1 * sPronta);
    return { ...c, score: Math.round(score) };
  });

  rankeadas.sort((a, b) => b.score - a.score);
  return opts.limite ? rankeadas.slice(0, opts.limite) : rankeadas;
}

// ===========================================================================
// (d) CARTAS NOVAS (client-safe) — recorte NEUTRO e factual.
// Sem score, sem "oportunidade", sem custo. Só: "entraram X cartas novas nos
// últimos N dias", lista ordenada da mais recente para a mais antiga. Este é
// o ÚNICO recorte de cartas-fluxo que pode ir ao cliente.
// ===========================================================================
export type CartasNovas = {
  quantidade: number;
  desde: string; // ISO do início da janela
  cartas: CartaFluxo[]; // mais recentes primeiro
};

export function cartasNovas(
  cartas: CartaFluxo[],
  opts: { dias?: number; limite?: number; agora?: Date } = {}
): CartasNovas {
  const dias = opts.dias ?? 7;
  const agora = opts.agora ?? new Date();
  const desde = new Date(agora.getTime() - dias * 24 * 60 * 60 * 1000);
  const sel = cartas
    .filter((c) => c.status === "disponivel" && dentroDaJanela(c.criado_em, dias, agora))
    .sort(
      (a, b) => new Date(b.criado_em).getTime() - new Date(a.criado_em).getTime()
    );
  return {
    quantidade: sel.length,
    desde: desde.toISOString(),
    cartas: opts.limite ? sel.slice(0, opts.limite) : sel,
  };
}
