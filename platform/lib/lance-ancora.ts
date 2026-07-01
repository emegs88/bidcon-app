// ============================================================================
// Lance Âncora — cálculo PURO de lance (uso INTERNO da equipe Prospere).
// ----------------------------------------------------------------------------
// USO INTERNO. Estes números (embutido, crédito líquido, INCC, lucro) NUNCA
// aparecem em tela de cliente/parceiro — só vivem dentro do PROSPERE byAncora,
// atrás do gate @prospere.com.br + RLS. Compliance: nada aqui é promessa de
// contemplação nem oferta ao cliente; é ferramenta de trabalho da equipe.
//
// FONTE DAS FÓRMULAS (decidido com o usuário + planilhas de referência):
//   - "Fluxo Banco de Cotas" abas Lance limitado / Lance fixo
//   - "teste01" aba Simulação
//   Confirmado nas planilhas:
//     crédito líquido   = crédito − embutido(R$)
//     embutido(R$)      = crédito × embutido%
//     lance total(R$)   = embutido(R$) + recurso próprio(R$)
//     lance total(%)    = lance total(R$) ÷ crédito
//     venda do crédito  = crédito líquido × %venda   (metade nas planilhas)
//   Reajuste do crédito por INCC/IPCA é aplicado ao crédito-base ANTES do lance.
//
// CONTRATO DE PARÂMETROS (decisão B = config manual por grupo):
//   Os limites de lance (embutido%, tipo fixo/limitado, teto) são informados
//   pela equipe por grupo — NÃO vêm do portal. Este módulo apenas calcula sobre
//   os parâmetros recebidos; não lê banco, não faz rede, não tem efeito colateral.
//
// PRINCÍPIO: função pura. Entrada -> saída. Sem I/O. Fácil de testar e auditar.
// ============================================================================

// Modalidade de lance. "livre" e "limitado" diferem só pelo teto que a equipe
// informa; "fixo" é percentual fixo do grupo; "embutido" abate do próprio crédito.
export type ModalidadeLance = "livre" | "fixo" | "limitado" | "embutido";

// Modo de amortização pós-contemplação (confirmado nas planilhas): ou reduz a
// parcela mantendo o prazo, ou reduz o prazo mantendo a parcela.
export type ModoAmortizacao = "reduzir_parcela" | "reduzir_prazo";

export type EntradaLance = {
  // crédito-base do bem (valor da carta) antes de qualquer reajuste.
  credito: number;

  // reajuste opcional do crédito por índice (INCC/IPCA) — fração acumulada.
  // Ex.: 0.05 = +5%. Aplicado ANTES do lance. Ausente => sem reajuste.
  reajusteAcumulado?: number | null;

  // modalidade e percentuais (frações). Config manual por grupo.
  modalidade: ModalidadeLance;
  // % de lance embutido (abate do crédito). Ex.: 0.25. Só usado quando faz sentido.
  embutidoPct?: number | null;
  // teto de lance permitido pelo grupo (fração do crédito). Ex.: 0.40 no limitado.
  tetoPct?: number | null;
  // recurso próprio em R$ que o cliente coloca além do embutido.
  recursoProprioRs?: number | null;

  // parcela e prazo atuais (para simular a amortização). Opcionais: se faltar,
  // os campos de amortização saem null (não inventamos).
  parcelaAtual?: number | null;
  prazoRestante?: number | null; // meses restantes

  // modo de amortização escolhido pela equipe.
  modo?: ModoAmortizacao;
};

export type ResultadoLance = {
  // crédito depois do reajuste (INCC/IPCA). Igual ao crédito se sem reajuste.
  creditoReajustado: number;

  // parcela do lance
  embutidoRs: number;          // parte que abate do próprio crédito
  recursoProprioRs: number;    // parte de fora (dinheiro do cliente)
  lanceTotalRs: number;        // embutido + recurso próprio
  lanceTotalPct: number;       // lanceTotalRs / creditoReajustado
  creditoLiquido: number;      // creditoReajustado − embutidoRs

  // amortização pós-contemplação (null se faltou parcela/prazo)
  novaParcela: number | null;  // quando modo = reduzir_parcela
  novoPrazo: number | null;    // quando modo = reduzir_prazo (meses)

  // avisos não-bloqueantes (ex.: lance acima do teto do grupo)
  avisos: string[];
};

// Arredonda para centavos sem viés (guarda dinheiro, não fração).
function centavos(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Calcula um lance a partir dos parâmetros informados pela equipe.
 * PURA: não lê banco, não faz rede, não muta a entrada. Campo faltante que
 * impeça um cálculo derivado vira `null` (nunca 0 inventado).
 */
export function calcularLance(e: EntradaLance): ResultadoLance {
  const avisos: string[] = [];

  // 1) crédito reajustado por índice (INCC/IPCA), se informado.
  const fatorReajuste = 1 + (e.reajusteAcumulado ?? 0);
  const creditoReajustado = centavos(e.credito * fatorReajuste);

  // 2) embutido em R$ (abate do próprio crédito). Só nas modalidades que usam.
  const usaEmbutido = e.modalidade === "embutido" || (e.embutidoPct ?? 0) > 0;
  const embutidoRs = usaEmbutido
    ? centavos(creditoReajustado * (e.embutidoPct ?? 0))
    : 0;

  // 3) recurso próprio de fora (dinheiro do cliente).
  const recursoProprioRs = centavos(e.recursoProprioRs ?? 0);

  // 4) lance total e % sobre o crédito reajustado.
  const lanceTotalRs = centavos(embutidoRs + recursoProprioRs);
  const lanceTotalPct =
    creditoReajustado > 0 ? lanceTotalRs / creditoReajustado : 0;

  // 5) crédito líquido = crédito − embutido (recurso próprio NÃO abate crédito).
  const creditoLiquido = centavos(creditoReajustado - embutidoRs);

  // 6) aviso de teto do grupo (não bloqueia; a equipe decide).
  if (e.tetoPct != null && lanceTotalPct > e.tetoPct) {
    avisos.push(
      `Lance total ${(lanceTotalPct * 100).toFixed(2)}% acima do teto do grupo ` +
        `(${(e.tetoPct * 100).toFixed(2)}%).`
    );
  }

  // 7) amortização pós-contemplação (só se houver parcela/prazo).
  let novaParcela: number | null = null;
  let novoPrazo: number | null = null;

  const temBase =
    e.parcelaAtual != null &&
    e.parcelaAtual > 0 &&
    e.prazoRestante != null &&
    e.prazoRestante > 0;

  if (temBase) {
    const parcela = e.parcelaAtual as number;
    const prazo = e.prazoRestante as number;
    // saldo devedor aproximado remanescente = parcela × prazo restante.
    const saldoRemanescente = parcela * prazo;
    // o lance abate do saldo. Quanto sobra a pagar:
    const saldoPosLance = Math.max(saldoRemanescente - lanceTotalRs, 0);

    if (e.modo === "reduzir_prazo") {
      // mantém a parcela, reduz o número de meses.
      novoPrazo = parcela > 0 ? Math.ceil(saldoPosLance / parcela) : null;
    } else {
      // padrão: reduz a parcela, mantém o prazo.
      novaParcela = prazo > 0 ? centavos(saldoPosLance / prazo) : null;
    }
  }

  return {
    creditoReajustado,
    embutidoRs,
    recursoProprioRs,
    lanceTotalRs,
    lanceTotalPct,
    creditoLiquido,
    novaParcela,
    novoPrazo,
    avisos,
  };
}

// Rótulos legíveis das modalidades (para a UI da equipe).
export const LABEL_MODALIDADE: Record<ModalidadeLance, string> = {
  livre: "Lance livre",
  fixo: "Lance fixo",
  limitado: "Lance limitado",
  embutido: "Lance embutido",
};

export const LABEL_MODO: Record<ModoAmortizacao, string> = {
  reduzir_parcela: "Reduzir parcela (mantém prazo)",
  reduzir_prazo: "Reduzir prazo (mantém parcela)",
};
