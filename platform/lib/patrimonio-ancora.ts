// ============================================================================
// Acúmulo de patrimônio (plano de sucesso) — cálculo PURO (uso INTERNO).
// ----------------------------------------------------------------------------
// USO INTERNO da equipe Prospere (PROSPERE byAncora). Estes números (parcela
// paga, patrimônio acumulado, valor de venda, lucro, fluxo de caixa) NUNCA
// aparecem para cliente/parceiro — vivem atrás do gate @prospere.com.br + RLS.
// Nada aqui é promessa de contemplação, de renda, de rendimento, de valorização
// ou de lucro ao cliente; é ferramenta de trabalho da equipe para AVALIAR uma
// estratégia de carteira mês a mês.
//
// ORIGEM DO MODELO: reproduz a lógica da planilha "Simulação" (aba única) que a
// equipe já usa. As fórmulas abaixo são a tradução célula-a-célula dessa
// planilha (conferidas: mês 1 => parcela paga e patrimônio = 8.745,45 com
// crédito 100.000, tx adm 24%, prazo 220, 26 cotas).
//
// FÓRMULAS (por mês m; todas as entradas são digitadas pela equipe):
//   parcelaUnit   = (crédito×txAdm + crédito/2) / prazo   (parcela estimada da
//                   planilha; APROXIMAÇÃO — não é a Price real. Ver aviso.)
//   parcelaPaga   = parcelaUnit × qtdCotasAtivas(m)
//   creditoLib    = sorteio×crédito + fixo×crédito×0.75 + limitado×crédito×0.5
//                   (ponderação das contemplações do mês por tipo)
//   valorVenda    = creditoLib × %Venda
//   parceladasPg  = parcelaUnit × contempladasNoMes × m
//   lucro         = valorVenda − parceladasPg
//   fluxoMensal   = parcelaPaga − valorVenda
//   fluxoAcum     = Σ fluxoMensal
//   patrimonioAcum= patrimonioAcum(m-1) + parcelaPaga − (contempladasNoMes×crédito)
//   INCC          = a cada mês o crédito é reajustado: crédito×(1+incc)^(m-1)
//                   (na planilha o reajuste aparece por blocos; aqui é mensal
//                    composto — a equipe controla o índice; ausente => 0).
//   qtdCotasAtivas(m+1) = qtdCotasAtivas(m) − contempladasNoMes
//                   (cotas contempladas saem da carteira ativa).
//
// DECISÕES DE MODELAGEM:
//   - Plano de contemplações é DIGITADO pela equipe (sorteio/fixo/limitado por
//     mês). Sem plano => nenhuma contemplação (carteira só paga parcelas).
//   - Campo faltante que impeça um derivado vira `null`/aviso (nunca 0 chutado).
//   - A parcela é a APROXIMAÇÃO da planilha; leva aviso p/ a equipe comparar com
//     o custo efetivo real (lib/custo-efetivo) quando quiser precisão.
//
// PRINCÍPIO: função pura. Entrada -> saída. Sem I/O, sem rede, sem mutação.
// ============================================================================

// Contemplações de um mês, por tipo (ponderação de crédito liberado).
export type ContemplacaoMes = {
  mes: number; // 1-based
  sorteio?: number | null; // nº de cotas contempladas por sorteio (100%)
  fixo?: number | null; // nº de cotas por lance fixo (75%)
  limitado?: number | null; // nº de cotas por lance limitado (50%)
};

export type EntradaPatrimonio = {
  credito?: number | null; // valor da cota (R$)
  taxaAdministracao?: number | null; // fração (ex.: 0.24 = 24%)
  prazo?: number | null; // meses do grupo
  qtdCotas?: number | null; // cotas ativas no mês 1
  inccPct?: number | null; // fração de reajuste mensal (ex.: 0.05). Ausente => 0
  pctVenda?: number | null; // fração do crédito liberado vendido (ex.: 0.50)

  // parcela unitária informada (R$). Se ausente, é ESTIMADA pela fórmula da
  // planilha. Prioridade sobre a estimativa quando informada.
  parcelaUnit?: number | null;

  // plano de contemplações por mês (digitado). Ausente => sem contemplações.
  contemplacoes?: ContemplacaoMes[] | null;
};

export type LinhaPatrimonio = {
  mes: number;
  qtdCotasAtivas: number;
  creditoReajustado: number; // crédito da cota no mês (com INCC acumulado)
  parcelaPaga: number; // parcelaUnit × cotas ativas
  contempladas: number; // total contempladas no mês
  creditoLiberado: number; // ponderado por tipo
  valorVenda: number; // creditoLiberado × %Venda
  parceladasPagas: number;
  lucro: number; // venda − parceladas pagas
  fluxoMensal: number; // parcelaPaga − venda
  fluxoAcumulado: number;
  patrimonioAcumulado: number;
};

export type ResultadoPatrimonio = {
  parcelaUnit: number | null; // parcela unitária usada (informada ou estimada)
  parcelaEstimada: boolean; // true se veio da fórmula (aproximação)
  linhas: LinhaPatrimonio[];
  // totais no fim do prazo (última linha), p/ leitura rápida:
  patrimonioFinal: number | null;
  fluxoAcumuladoFinal: number | null;
  lucroTotal: number | null; // Σ lucro
  avisos: string[];
};

function centavos(n: number): number {
  return Math.round(n * 100) / 100;
}

function n0(v: number | null | undefined): number {
  return v != null && Number.isFinite(v) ? v : 0;
}

/**
 * Simula o acúmulo de patrimônio de uma carteira de cotas mês a mês, no modelo
 * da planilha "Plano de sucesso". PURA: não lê banco, não faz rede, não muta a
 * entrada. Todas as premissas são digitadas pela equipe.
 */
export function simularAcumuloPatrimonio(
  e: EntradaPatrimonio
): ResultadoPatrimonio {
  const avisos: string[] = [];

  const credito =
    e.credito != null && e.credito > 0 ? centavos(e.credito) : null;
  const prazo = e.prazo != null && e.prazo > 0 ? Math.floor(e.prazo) : null;
  const qtd0 =
    e.qtdCotas != null && e.qtdCotas > 0 ? Math.floor(e.qtdCotas) : null;

  if (credito == null) avisos.push("Crédito não informado: informe o valor da cota.");
  if (prazo == null) avisos.push("Prazo não informado: informe os meses do grupo.");
  if (qtd0 == null) avisos.push("Quantidade de cotas não informada.");

  // Parcela unitária: informada tem prioridade; senão estima pela planilha.
  // `parcelaUnit` é o valor arredondado p/ EXIBIR; `parcelaPrecisa` guarda a
  // fração cheia usada nos PRODUTOS (a planilha multiplica com precisão total,
  // ex.: 336,3636…×26 = 8.745,45 — arredondar antes daria 8.745,36).
  let parcelaUnit: number | null = null;
  let parcelaPrecisa: number | null = null;
  let parcelaEstimada = false;
  if (e.parcelaUnit != null && e.parcelaUnit > 0) {
    parcelaPrecisa = e.parcelaUnit;
    parcelaUnit = centavos(e.parcelaUnit);
  } else if (credito != null && prazo != null && e.taxaAdministracao != null) {
    // (crédito×txAdm + crédito/2) / prazo — fórmula G23 da planilha.
    parcelaPrecisa = (credito * e.taxaAdministracao + credito / 2) / prazo;
    parcelaUnit = centavos(parcelaPrecisa);
    parcelaEstimada = true;
    avisos.push(
      "Parcela estimada pela fórmula da planilha (aproximação): compare com o custo efetivo real quando precisar de precisão."
    );
  } else {
    avisos.push(
      "Parcela não calculada: informe a parcela ou (crédito + taxa de administração + prazo)."
    );
  }

  const incc = e.inccPct != null ? e.inccPct : 0;
  const pctVenda = e.pctVenda != null ? e.pctVenda : 0;

  // Indexa o plano de contemplações por mês.
  const planoPorMes = new Map<number, ContemplacaoMes>();
  if (e.contemplacoes) {
    for (const c of e.contemplacoes) {
      if (c.mes != null && c.mes > 0) planoPorMes.set(Math.floor(c.mes), c);
    }
  }

  const linhas: LinhaPatrimonio[] = [];
  let lucroTotal = 0;

  if (
    credito != null &&
    prazo != null &&
    qtd0 != null &&
    parcelaPrecisa != null
  ) {
    let cotasAtivas = qtd0;
    let fluxoAcumulado = 0;
    let patrimonioAcumulado = 0;

    for (let m = 1; m <= prazo; m++) {
      // Crédito reajustado por INCC composto (mês 1 = crédito cheio).
      const creditoReaj = centavos(credito * Math.pow(1 + incc, m - 1));

      const parcelaPaga = centavos(parcelaPrecisa * cotasAtivas);

      const plano = planoPorMes.get(m);
      const sorteio = n0(plano?.sorteio);
      const fixo = n0(plano?.fixo);
      const limitado = n0(plano?.limitado);
      const contempladas = sorteio + fixo + limitado;

      // Crédito liberado ponderado por tipo (sorteio 100%, fixo 75%, lim. 50%).
      const creditoLiberado = centavos(
        sorteio * creditoReaj +
          fixo * creditoReaj * 0.75 +
          limitado * creditoReaj * 0.5
      );
      const valorVenda = centavos(creditoLiberado * pctVenda);
      const parceladasPagas = centavos(parcelaPrecisa * contempladas * m);
      const lucro = centavos(valorVenda - parceladasPagas);
      const fluxoMensal = centavos(parcelaPaga - valorVenda);

      fluxoAcumulado = centavos(fluxoAcumulado + fluxoMensal);
      patrimonioAcumulado = centavos(
        patrimonioAcumulado + parcelaPaga - contempladas * creditoReaj
      );
      lucroTotal = centavos(lucroTotal + lucro);

      linhas.push({
        mes: m,
        qtdCotasAtivas: cotasAtivas,
        creditoReajustado: creditoReaj,
        parcelaPaga,
        contempladas,
        creditoLiberado,
        valorVenda,
        parceladasPagas,
        lucro,
        fluxoMensal,
        fluxoAcumulado,
        patrimonioAcumulado,
      });

      // Cotas contempladas saem da carteira ativa no mês seguinte.
      cotasAtivas = Math.max(0, cotasAtivas - contempladas);
    }
  }

  const ultima = linhas.length > 0 ? linhas[linhas.length - 1] : null;

  return {
    parcelaUnit,
    parcelaEstimada,
    linhas,
    patrimonioFinal: ultima ? ultima.patrimonioAcumulado : null,
    fluxoAcumuladoFinal: ultima ? ultima.fluxoAcumulado : null,
    lucroTotal: linhas.length > 0 ? lucroTotal : null,
    avisos,
  };
}
