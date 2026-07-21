// Matemática Disal (planos novos) — extraída de
// app/interno/simulador-disal/page.tsx pra ser reaproveitada pela tool
// buscar_planos (FATIA 1 · venda nova). Mesma lógica, mesmos números: o
// simulador passa a CHAMAR estas funções (não reimplementar); saída visual
// deve continuar pixel-idêntica.
import type { FaixaAuto, LinhaAuto, LinhaImovel, PlanoImovel } from "./types";

export type ResultadoLinhaAuto = {
  linha: LinhaAuto;
  faixa: FaixaAuto;
  rotuloFaixa: "Faixa II" | "Faixa III";
};

// Nearest-neighbor sobre a união das duas faixas (mesma lógica de
// `snapCreditoAuto` no simulador — existe um furo real nos dados entre
// 180.000 e 190.000, por isso a busca é sobre a lista combinada, não sobre
// um intervalo contínuo).
export function linhaAutoMaisProxima(
  creditoDesejado: number,
  faixaII: FaixaAuto,
  faixaIII: FaixaAuto,
): ResultadoLinhaAuto {
  const creditosValidos = [...faixaII.linhas, ...faixaIII.linhas]
    .map((l) => l[0])
    .sort((a, b) => a - b);
  let maisProximo = creditosValidos[0];
  let menorDist = Math.abs(creditoDesejado - maisProximo);
  for (const c of creditosValidos) {
    const d = Math.abs(creditoDesejado - c);
    if (d < menorDist) {
      menorDist = d;
      maisProximo = c;
    }
  }
  const faixa = maisProximo <= 180000 ? faixaII : faixaIII;
  const rotuloFaixa = maisProximo <= 180000 ? "Faixa II" : "Faixa III";
  const linha = faixa.linhas.find((l) => l[0] === maisProximo) ?? faixa.linhas[0];
  return { linha, faixa, rotuloFaixa };
}

// Total do plano (sem reajustes) = prazo × parcela mensal.
export function totalAuto(faixa: FaixaAuto, parcela: number): number {
  return faixa.prazo * parcela;
}

export type ResultadoLinhaImovel = {
  linha: LinhaImovel;
  tetoAtingido: boolean;
  pisoAtingido: boolean;
};

// Regra nova (não existe no simulador, que usa índice de botão fixo):
// nearest-neighbor sobre os 5 tiers reais (200k/250k/300k/350k/400k). Fora
// da faixa: usa o tier extremo e marca o flag correspondente, pro agente
// avisar com honestidade ("a maior carta que tenho nessa faixa é de 400
// mil") em vez de inventar um valor intermediário que não existe.
export function linhaImovelMaisProxima(
  creditoDesejado: number,
  imoveis220: PlanoImovel,
): ResultadoLinhaImovel {
  const tetoAtingido = creditoDesejado > 400000;
  const pisoAtingido = creditoDesejado < 200000;
  const alvo = tetoAtingido ? 400000 : pisoAtingido ? 200000 : creditoDesejado;

  const creditos = imoveis220.linhas.map((l) => l.credito).sort((a, b) => a - b);
  let maisProximo = creditos[0];
  let menorDist = Math.abs(alvo - maisProximo);
  for (const c of creditos) {
    const d = Math.abs(alvo - c);
    if (d < menorDist) {
      menorDist = d;
      maisProximo = c;
    }
  }
  const linha = imoveis220.linhas.find((l) => l.credito === maisProximo) ?? imoveis220.linhas[0];
  return { linha, tetoAtingido, pisoAtingido };
}

// Total do plano (sem reajustes) = 12 parcelas da 1ª fase + 207 da 2ª + 1 da 3ª.
export function totalImovel(fases: [number, number, number]): number {
  return 12 * fases[0] + 207 * fases[1] + 1 * fases[2];
}

// ---------------------------------------------------------------------------
// Composição acima do teto (ajuste obrigatório #2, aprovação condicional do
// Emerson sobre a primeira versão do plano) — regra inegociável ("composição
// só na MESMA administradora") vira código, nunca fica na cabeça do modelo:
// o agente apresenta a composição pronta, nunca monta soma de cartas por
// conta própria. Tabela exata pra créditos acima de 400k (teto de uma única
// carta Disal), todas as partes na mesma administradora.
// ---------------------------------------------------------------------------
const TABELA_COMPOSICAO_IMOVEL: Record<number, number[]> = {
  500000: [250000, 250000],
  600000: [300000, 300000],
  800000: [400000, 400000],
  1000000: [400000, 400000, 200000],
  1200000: [400000, 400000, 400000],
};

export type ParteComposicaoImovel = { credito: number; linha: LinhaImovel };
export type ResultadoComposicaoImovel = {
  partes: ParteComposicaoImovel[];
  creditoTotal: number;
  parcelaTotal100: [number, number, number];
  parcelaTotal75: [number, number, number];
  aproximado: boolean;
};

// Só deve ser chamada quando creditoDesejado > 400000 (teto de uma única
// carta). Se o valor pedido não bate exato com uma das 5 chaves da tabela,
// usa nearest-match sobre as próprias chaves e marca `aproximado:true` — o
// agente avisa que é a composição mais próxima, não a exata pedida.
export function composicaoImovel(
  creditoDesejado: number,
  imoveis220: PlanoImovel,
): ResultadoComposicaoImovel {
  const chaves = Object.keys(TABELA_COMPOSICAO_IMOVEL)
    .map(Number)
    .sort((a, b) => a - b);

  let alvo = creditoDesejado;
  let aproximado = false;
  if (!TABELA_COMPOSICAO_IMOVEL[alvo]) {
    aproximado = true;
    let maisProximo = chaves[0];
    let menorDist = Math.abs(creditoDesejado - maisProximo);
    for (const c of chaves) {
      const d = Math.abs(creditoDesejado - c);
      if (d < menorDist) {
        menorDist = d;
        maisProximo = c;
      }
    }
    alvo = maisProximo;
  }

  const creditosPartes = TABELA_COMPOSICAO_IMOVEL[alvo];
  const partes: ParteComposicaoImovel[] = creditosPartes.map((credito) => {
    const linha = imoveis220.linhas.find((l) => l.credito === credito);
    if (!linha) {
      throw new Error(`composicaoImovel: crédito ${credito} não encontrado no boletim.`);
    }
    return { credito, linha };
  });

  const creditoTotal = creditosPartes.reduce((s, c) => s + c, 0);
  const somarFases = (chave: "b100" | "b75"): [number, number, number] =>
    partes.reduce<[number, number, number]>(
      (acc, p) => {
        const fases = p.linha[chave];
        return [acc[0] + fases[0], acc[1] + fases[1], acc[2] + fases[2]];
      },
      [0, 0, 0],
    );

  return {
    partes,
    creditoTotal,
    parcelaTotal100: somarFases("b100"),
    parcelaTotal75: somarFases("b75"),
    aproximado,
  };
}

// ---------------------------------------------------------------------------
// Busca reversa por parcela (ajuste obrigatório #1) — o Apêndice B pergunta
// "qual parcela cabe no seu mês?" como caminho de diagnóstico alternativo ao
// crédito desejado. Lookup determinístico sobre o dado estático, sem I/O.
// ---------------------------------------------------------------------------
export type ResultadoCreditoMaximoAuto = {
  linha: LinhaAuto;
  faixa: FaixaAuto;
  rotuloFaixa: "Faixa II" | "Faixa III";
  parcela100: number;
  parcela75: number;
};

// Maior crédito (auto) cuja parcela na base pedida não ultrapassa
// `parcelaMax`. Varre em ordem decrescente de crédito e para na primeira
// que cabe. Default base='100' (mais conservador — garante que a parcela
// de 75%, sempre menor, também cabe). Devolve as duas parcelas pro agente
// apresentar as duas opções ao cliente.
export function creditoMaximoAutoPorParcela(
  parcelaMax: number,
  faixaII: FaixaAuto,
  faixaIII: FaixaAuto,
  base: "100" | "75" = "100",
): ResultadoCreditoMaximoAuto | null {
  const todas = [...faixaII.linhas, ...faixaIII.linhas].sort((a, b) => b[0] - a[0]);
  for (const linha of todas) {
    const [credito, , parcela100, parcela75] = linha;
    const parcelaBase = base === "100" ? parcela100 : parcela75;
    if (parcelaBase <= parcelaMax) {
      const faixa = credito <= 180000 ? faixaII : faixaIII;
      const rotuloFaixa = credito <= 180000 ? "Faixa II" : "Faixa III";
      return { linha, faixa, rotuloFaixa, parcela100, parcela75 };
    }
  }
  return null; // nenhum crédito do boletim cabe no teto informado
}

export type ResultadoCreditoMaximoImovel = {
  linha: LinhaImovel;
};

// Maior crédito (imóvel) cuja parcela da fase 13ª–219ª (a que sustenta o
// plano por 207 dos 220 meses — referência mais representativa do "cabe no
// seu mês" do que o pico pontual da 1ª fase) na base pedida não ultrapassa
// `parcelaMax`. Varre os 5 tiers em ordem decrescente de crédito.
export function creditoMaximoImovelPorParcela(
  parcelaMax: number,
  imoveis220: PlanoImovel,
  base: "100" | "75" = "100",
): ResultadoCreditoMaximoImovel | null {
  const todas = [...imoveis220.linhas].sort((a, b) => b.credito - a.credito);
  for (const linha of todas) {
    const parcelaBase = base === "100" ? linha.b100[1] : linha.b75[1];
    if (parcelaBase <= parcelaMax) {
      return { linha };
    }
  }
  return null;
}
