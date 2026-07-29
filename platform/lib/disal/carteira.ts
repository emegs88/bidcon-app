// ============================================================================
// Carteira multi-cota Disal (planos novos) — consolida N cotas de segmentos e
// prazos diferentes numa única linha do tempo de parcela.
//
// Por que existe: o simulador montava UMA carta por vez. O cliente que compra
// de 1 a 100 cotas precisa ver a parcela SOMADA — e ela não é constante: cotas
// de veículo (60/80 meses) terminam muito antes das de imóvel (220), então a
// parcela mensal DESCE em degraus ao longo do plano. Somar só a parcela do
// mês 1 e chamar de "a parcela" seria mentira por omissão.
//
// Esta lib é pura (sem rede, sem React) e não calcula TIR — o custo efetivo
// continua saindo de lib/disal/custo-efetivo-plano-novo.ts, que é o motor
// validado. Ver `custoEfetivoCarteira` lá.
// ============================================================================
import type { FaseFluxo } from "./custo-efetivo-plano-novo";

export type TipoItem = "veiculo" | "imovel";

export type ItemCarteira = {
  id: string;
  tipo: TipoItem;
  /** Rótulo de exibição, ex.: "Veículo · R$ 150.000 · Faixa II". */
  rotulo: string;
  cod: string;
  credito: number;
  /** 1 a 100 cotas iguais. */
  quantidade: number;
  base: "100" | "75";
  prazo: number;
  taxa: string;
  indice: string;
  /** Fases da parcela UNITÁRIA na base escolhida (auto: 1 fase; imóvel: 3). */
  fases: FaseFluxo[];
};

export const QTD_MIN = 1;
export const QTD_MAX = 100;

export function totalMesesItem(item: ItemCarteira): number {
  return item.fases.reduce((s, f) => s + f.meses, 0);
}

/** Parcela unitária ativa num mês (1-indexado); 0 depois do fim do plano. */
export function parcelaNoMes(item: ItemCarteira, mes: number): number {
  let acumulado = 0;
  for (const f of item.fases) {
    acumulado += f.meses;
    if (mes <= acumulado) return f.valor;
  }
  return 0;
}

/**
 * Linha do tempo consolidada da carteira: fases contíguas cobrindo do mês 1
 * até o fim da cota mais longa, com a soma das parcelas ativas em cada trecho.
 *
 * Os pontos de quebra são os fins de fase de cada item (12, 60, 219, 220...),
 * então nenhum degrau é perdido nem inventado.
 */
export function consolidarFases(itens: ItemCarteira[]): FaseFluxo[] {
  const ativos = itens.filter((i) => i.quantidade > 0 && i.fases.length > 0);
  if (ativos.length === 0) return [];

  const quebras = new Set<number>([0]);
  for (const item of ativos) {
    let acumulado = 0;
    for (const f of item.fases) {
      acumulado += f.meses;
      quebras.add(acumulado);
    }
  }
  const pontos = [...quebras].sort((a, b) => a - b);

  const fases: FaseFluxo[] = [];
  for (let k = 1; k < pontos.length; k++) {
    const inicio = pontos[k - 1] + 1;
    const meses = pontos[k] - pontos[k - 1];
    if (meses <= 0) continue;
    const valor = ativos.reduce((s, i) => s + parcelaNoMes(i, inicio) * i.quantidade, 0);
    if (valor <= 0) continue;
    // funde com a fase anterior quando o valor não mudou (evita degrau falso)
    const ultima = fases[fases.length - 1];
    if (ultima && Math.abs(ultima.valor - valor) < 0.005) ultima.meses += meses;
    else fases.push({ meses, valor });
  }
  return fases;
}

export type ResumoCarteira = {
  cotas: number;
  itens: number;
  creditoTotal: number;
  /** Parcela somada no mês 1 (a que o cliente pergunta primeiro). */
  parcelaInicial: number;
  /** Soma de todas as parcelas de todas as cotas, sem reajustes. */
  totalPlano: number;
  custoAlemCredito: number;
  custoAlemCreditoPct: number;
  /** Mês final da cota mais longa. */
  prazoMaximo: number;
  fases: FaseFluxo[];
  /** true quando há veículo e imóvel juntos — muda o texto de junção. */
  segmentosMisturados: boolean;
};

export function resumirCarteira(itens: ItemCarteira[]): ResumoCarteira {
  const ativos = itens.filter((i) => i.quantidade > 0);
  const fases = consolidarFases(ativos);
  const creditoTotal = ativos.reduce((s, i) => s + i.credito * i.quantidade, 0);
  const totalPlano = ativos.reduce(
    (s, i) => s + i.fases.reduce((t, f) => t + f.meses * f.valor, 0) * i.quantidade,
    0,
  );
  const tipos = new Set(ativos.map((i) => i.tipo));
  const custoAlem = totalPlano - creditoTotal;

  return {
    cotas: ativos.reduce((s, i) => s + i.quantidade, 0),
    itens: ativos.length,
    creditoTotal,
    parcelaInicial: fases[0]?.valor ?? 0,
    totalPlano,
    custoAlemCredito: custoAlem,
    custoAlemCreditoPct: creditoTotal > 0 ? (custoAlem / creditoTotal) * 100 : 0,
    prazoMaximo: fases.reduce((s, f) => s + f.meses, 0),
    fases,
    segmentosMisturados: tipos.size > 1,
  };
}

/** "1ª a 12ª: R$ 4.200/mês · 13ª a 60ª: R$ 3.100/mês · ..." */
export function descreverFases(fases: FaseFluxo[], fmt: (v: number) => string): string[] {
  const linhas: string[] = [];
  let inicio = 1;
  for (const f of fases) {
    const fim = inicio + f.meses - 1;
    linhas.push(
      inicio === fim ? `${inicio}ª: ${fmt(f.valor)}/mês` : `${inicio}ª a ${fim}ª: ${fmt(f.valor)}/mês`,
    );
    inicio = fim + 1;
  }
  return linhas;
}
