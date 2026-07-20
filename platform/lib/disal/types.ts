// Tipos do boletim de crédito Disal (planos novos). Um boletim novo por mês
// — ver lib/disal/atual.ts para o ponto único de import do mês vigente.

// [crédito, códBem, parcelaBase100, parcelaBase75Light]
export type LinhaAuto = [
  credito: number,
  cod: string,
  parcelaBase100: number,
  parcelaBase75: number,
];

export type FaixaAuto = {
  prazo: number;
  taxa: string;
  indice: string;
  linhas: LinhaAuto[];
};

// Imóveis: 3 fases de parcela (meses 1–12 / 13–219 / 220), uma tripla por base.
export type LinhaImovel = {
  credito: number;
  cod: string;
  b100: [number, number, number];
  b75: [number, number, number];
};

export type PlanoImovel = {
  prazo: number;
  taxa: string;
  indice: string;
  linhas: LinhaImovel[];
};

export type BoletimDisal = {
  mes: string; // "AAAA-MM"
  autosFaixaII: FaixaAuto;
  autosFaixaIII: FaixaAuto;
  imoveis220: PlanoImovel;
};
