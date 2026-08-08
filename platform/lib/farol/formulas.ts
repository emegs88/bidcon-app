// ============================================================================
// FAROL-VIRAL · as 8 fôrmas do porta-voz
// AUTORIZADO: Emerson Gomes dos Santos — "FAROL-VIRAL, o manual de formatos"
// (08/08/2026) + OS "FAROL-ESCUTA-01" item 2.b ("rotação determinística sobre
// as 8 do manual").
// ----------------------------------------------------------------------------
// O QUE ESTE ARQUIVO É. Oito esqueletos de roteiro curto, cada um com um
// objetivo diferente (alcance, autoridade, curiosidade, educação, engajamento,
// quebra de padrão, conversão, captação). Não são textos prontos: são
// INSTRUÇÕES para o redator — hoje o modelo, amanhã quem for. O texto final
// sempre nasce dos números reais da carta do dia.
//
// A LEI QUE ATRAVESSA AS OITO: o gancho NUNCA abre com saudação. O manual é
// literal — "'Oi, aqui é o porta-voz da Bidcon' é botão de pular" — e mede o
// custo: 80% do resultado se decide nos 2 primeiros segundos. Por isso o
// primeiro frame é NÚMERO ou PERGUNTA, e isso está repetido em cada
// `instrucao_gancho` em vez de ficar só no header: instrução que mora longe do
// ponto de uso é instrução que o redator não lê.
//
// ISTO NÃO APAGA O ROTEIRO DE HOJE. `montarRoteiro()` (lib/farol/reel-texto.ts)
// continua existindo, intacto, e continua sendo o que sai quando o FAROL_PAUTA
// está desarmado ou quando o linter reprova o texto do modelo. As fôrmas são o
// caminho novo; o template é o chão que segura quando o caminho novo falha.
//
// ROTAÇÃO DETERMINÍSTICA, E POR QUE DETERMINÍSTICA. Sorteio faria a mesma fôrma
// cair três dias seguidos de vez em quando, e o manual pede o contrário —
// "formato repetível vira série, série vira reconhecimento" — o que exige ciclo,
// não aleatoriedade. Determinístico também significa que dá para saber qual
// fôrma sai amanhã sem rodar nada, e que reexecutar o mesmo dia dá o mesmo
// resultado (a linha em `farol_pauta` é única por (dia, formula) justamente por
// isso).
//
// A EXCEÇÃO DA EXCLUSIVA. O manual manda: "F1 sempre que a carta for
// exclusiva". Carta exclusiva é carta própria da casa (fonte cliente_direto) —
// é o estoque que a Bidcon quer girar primeiro, e F1 é a fôrma de ALCANCE. A
// exceção passa por cima da rotação; o ciclo continua contando pela data, então
// um dia de exclusiva não desalinha a série.
//
// DIVERGÊNCIA DECLARADA (medida): a lei nº 2 do manual diz "escolher 5-6
// fôrmas", mas o próprio manual lista 8 e a OS executável (FAROL-ESCUTA-01)
// manda rodar "as 8 do manual". Implementei as 8. A poda para 5-6 é
// exatamente o que a FAROL-METRICAS-01 prevê decidir com dado ("as 3 piores
// saem da rotação depois de 2 semanas") — podar agora, no chute, seria escolher
// sem a medição que a própria OS quer esperar.
// ============================================================================

/** Uma fôrma. `esqueleto` é o formato; `instrucao_gancho` é a regra da abertura. */
export type Formula = {
  /** Estável e curto: vira valor de coluna em farol_pauta e chave de métrica. */
  id: string;
  nome: string;
  /** Segundos de fala. O redator recebe isto como teto, não como meta. */
  duracao_alvo: number;
  /** Para que serve — orienta o ângulo, não o texto. */
  objetivo: string;
  instrucao_gancho: string;
  esqueleto: string;
};

export const FORMULAS: readonly Formula[] = [
  {
    id: "F1",
    nome: "NÚMERO SECO",
    duracao_alvo: 12,
    objetivo: "alcance",
    instrucao_gancho:
      "O primeiro frame é o VALOR DO CRÉDITO, dito e escrito. Nada antes dele — nem saudação, nem nome da marca.",
    esqueleto:
      "Crédito, entrada e parcela ditos em sequência, sem adjetivo. Depois: que é carta contemplada e já liberada. Fecha com o link na bio. Sem explicação, sem contexto — a fôrma é a própria oferta.",
  },
  {
    id: "F2",
    nome: "3 ERROS QUE…",
    duracao_alvo: 30,
    objetivo: "autoridade",
    instrucao_gancho:
      "Abre com o número 3 e o erro: '3 erros de quem compra carta contemplada'. Nunca com saudação.",
    esqueleto:
      "Enumera três erros concretos e verificáveis (pagar direto ao vendedor; não conferir a administradora; achar que dá para somar cartas de administradoras diferentes). Um erro por frase curta. Fecha ligando o erro nº1 à Conta Notarial.",
  },
  {
    id: "F3",
    nome: "NINGUÉM TE CONTA",
    duracao_alvo: 20,
    objetivo: "curiosidade",
    instrucao_gancho:
      "Abre com 'Ninguém te conta que…' seguido de um fato de uso, não de uma promessa.",
    esqueleto:
      "Um uso pouco conhecido da carta contemplada (ex.: quitar financiamento — trocar juros de banco por taxa de administração). Explica o mecanismo em duas frases. Fecha com o convite a perguntar.",
  },
  {
    id: "F4",
    nome: "MITO × VERDADE",
    duracao_alvo: 30,
    objetivo: "educacao",
    instrucao_gancho:
      "Abre com a palavra 'Mito:' e a crença errada. A pergunta implícita é o gancho.",
    esqueleto:
      "Mito: consórcio é sorteio. Verdade: a carta contemplada JÁ passou pelo sorteio — o que se compra é o crédito liberado. Encadeia mito e verdade sem rodeio e aterrissa nos números da carta do dia.",
  },
  {
    id: "F5",
    nome: "A OU B",
    duracao_alvo: 15,
    objetivo: "engajamento",
    instrucao_gancho:
      "Abre com a PERGUNTA de escolha, com os dois números na cara: financiamento longo ou carta com custo de X% a.m.?",
    esqueleto:
      "Duas opções claras, uma frase cada, com número em cada lado. Termina com promessa de continuação: 'comenta A ou B que amanhã eu mostro a conta'. A promessa é de CONTEÚDO, nunca de resultado.",
  },
  {
    id: "F6",
    nome: "SE VOCÊ FAZ X, PARE",
    duracao_alvo: 15,
    objetivo: "quebra_de_padrao",
    instrucao_gancho:
      "Abre com a interrupção: 'Se você está prestes a…, PARA.' Verbo no imperativo no primeiro segundo.",
    esqueleto:
      "Nomeia o comportamento de risco (pagar entrada direto na conta do vendedor). Diz por que é risco. Apresenta a Conta Notarial em cartório como o caminho seguro, na descrição canônica da casa.",
  },
  {
    id: "F7",
    nome: "CONTA NA PONTA DO LÁPIS",
    duracao_alvo: 40,
    objetivo: "conversao",
    instrucao_gancho:
      "Abre com os dois números lado a lado: parcela do financiamento contra parcela da carta.",
    esqueleto:
      "Compara parcela a parcela e custo a custo, SÓ COM FATOS. Zero projeção, zero 'você vai economizar X'. Usa exclusivamente os números da carta do dia e diz que o custo está calculado. Fecha oferecendo a conta detalhada no direct.",
  },
  {
    id: "F8",
    nome: "CEDENTE",
    duracao_alvo: 20,
    objetivo: "captacao",
    instrucao_gancho:
      "Abre com a PERGUNTA ao dono da carta parada: 'Tem carta parada pagando parcela?'",
    esqueleto:
      "Fala com quem TEM carta, não com quem quer comprar. Diz que a carta parada vale dinheiro hoje e que o pagamento passa por cartório (Conta Notarial). Fecha convidando a mandar os dados da cota no direct.",
  },
] as const;

/**
 * A fôrma do dia.
 *
 * `dia` no formato YYYY-MM-DD (o mesmo que `hojeSP()` devolve). A rotação é
 * feita sobre o NÚMERO DE DIAS desde a epoch, e não sobre o dia do mês: com
 * `getDate() % 8` os meses de 31 dias fariam a série pular de volta e F1 sairia
 * duas vezes na virada — medido no papel antes de escrever.
 *
 * `exclusiva` verdadeiro força F1 (regra do manual). Note que a rotação NÃO é
 * consumida por isso: o ciclo segue amarrado à data, então o dia seguinte cai
 * onde cairia de qualquer jeito.
 */
export function formulaDoDia(dia: string, exclusiva: boolean): Formula {
  if (exclusiva) return FORMULAS[0];

  // Date.UTC evita que o fuso do runtime mude o índice: a data já vem resolvida
  // em São Paulo por hojeSP(), e daqui para frente ela é só um contador.
  const [ano, mes, d] = dia.split("-").map(Number);
  const dias = Math.floor(Date.UTC(ano, (mes ?? 1) - 1, d ?? 1) / 86_400_000);
  const i = ((dias % FORMULAS.length) + FORMULAS.length) % FORMULAS.length;
  return FORMULAS[i];
}

/** Busca por id — usada para reidratar uma pauta já gravada. */
export function formulaPorId(id: string): Formula | null {
  return FORMULAS.find((f) => f.id === id) ?? null;
}
