// ============================================================================
// FAROL-FORMULAS-02 · as 8 fôrmas do EIXO DAS POSSIBILIDADES
// AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-FORMULAS-02" (08/08/2026):
// "não quero falando das cartas e sim das possibilidades" + "quero outras formas".
// Substitui as 8 fôrmas do FAROL-VIRAL (NÚMERO SECO, 3 ERROS, …) escritas ontem.
// ----------------------------------------------------------------------------
// A VIRADA DE EIXO, EM UMA FRASE. O roteiro antigo abria pelo PRODUTO ("a carta
// de hoje é…"), o que fala com quem já decidiu comprar carta contemplada — um
// público minúsculo. Daqui em diante o vídeo abre pelo DESEJO ou pelo PROBLEMA
// de quem assiste, e a carta entra só no fecho, como PROVA de que aquilo é
// possível hoje. O produto deixa de ser o assunto e passa a ser a evidência.
//
// ESTRUTURA OBRIGATÓRIA DAS OITO (a ordem importa mais que o texto):
//   1. gancho de possibilidade nos 2 primeiros segundos — nunca saudação,
//      nunca número de carta, nunca nome da marca;
//   2. desenvolvimento curto e FACTUAL (mecanismo, não promessa);
//   3. fecho com a carta do dia como prova + CTA.
//
// ---------------------------------------------------------------------------
// TEMA × TIPO DE CARTA — o campo `tipos`, e por que ele existe
// ---------------------------------------------------------------------------
// ACHADO MEDIDO (08/08, antes de escrever): estas fôrmas são amarradas a TEMA,
// e a carta do dia varia de TIPO. "Sair do aluguel" e "obra/terreno" só fecham
// com IMÓVEL; "carro de trabalho" só fecha com VEÍCULO. Uma rotação cega de 8
// dias iria, inevitavelmente, narrar dois minutos sobre sair do aluguel e
// aterrissar no crédito de um CARRO — que é o irmão gêmeo do bug da carta
// divergente que a FAROL-ESCUTA-01 passou o dia de ontem fechando.
//
// Por isso cada fôrma declara em que tipo de carta ela fecha, e a rotação gira
// só dentro das compatíveis. Elegíveis: imóvel 7, veículo 6.
//
// ---------------------------------------------------------------------------
// A EXCEÇÃO "F1 SE EXCLUSIVA" FOI ELIMINADA (não substituída)
// ---------------------------------------------------------------------------
// AUTORIZADO: Emerson, 08/08 ~12h — "exclusividade se expressa na LEGENDA/CTA
// ('carta exclusiva Bidcon'), nunca forçando tema de roteiro."
//
// O manual FAROL-VIRAL mandava "F1 sempre que a carta for exclusiva", e F1 ali
// era NÚMERO SECO — uma fôrma de ALCANCE, neutra quanto ao tema. Com o eixo
// novo, `FORMULAS[0]` virou SAIR DO ALUGUEL, que é temático e só serve a
// imóvel: manter a regra faria toda carta exclusiva de VEÍCULO virar roteiro de
// aluguel. A regra não foi movida para outra fôrma porque o que ela queria
// (dar destaque ao estoque próprio) não é um assunto — é um selo, e selo mora
// na legenda.
//
// O parâmetro `exclusiva` continua na assinatura de `formulaDoDia()`, sem uso
// na escolha, para não quebrar quem já chama com dois argumentos (a ESCUTA). A
// exclusividade é lida direto de `carta.exclusiva` por quem monta a legenda.
// ============================================================================

/** Em que tipo de carta a fôrma consegue aterrissar. */
export type TipoBem = "imovel" | "veiculo";

export type Formula = {
  /** Estável e curto: vira valor de coluna em farol_pauta e chave de métrica. */
  id: string;
  nome: string;
  /** Segundos de fala. Curtas 7-15s (alcance); explicativas 30-45s. */
  duracao_alvo: number;
  /** A possibilidade que a fôrma ataca. Orienta o ângulo, não o texto. */
  objetivo: string;
  /** Tipos de carta em que o fecho faz sentido. Ver header. */
  tipos: readonly TipoBem[];
  /**
   * A abertura, escrita como MODELO literal. Sem saudação, sem número de carta,
   * sem nome da marca. O redator (modelo ou template) parte daqui.
   */
  gancho: string;
  /** O miolo: o que desenvolver, em fatos. O slot da carta é só no fecho. */
  esqueleto: string;
  /** O pedido final. Uma ação só, verificável. */
  cta: string;
};

export const FORMULAS: readonly Formula[] = [
  {
    id: "P1",
    nome: "SAIR DO ALUGUEL",
    duracao_alvo: 30,
    objetivo: "moradia_propria",
    tipos: ["imovel"],
    gancho:
      "Você paga aluguel há quantos anos? Faz a conta do que já saiu da sua mão.",
    esqueleto:
      "O aluguel pago não volta e não vira patrimônio. A carta contemplada é crédito JÁ liberado: compra o imóvel à vista e troca o aluguel por parcela de algo que fica seu. Explica o mecanismo em duas frases factuais, sem projeção e sem comparar com número que não foi dado. Fecha com os números da carta do dia como prova de que existe hoje.",
    cta: "Toca no link da bio para ver a carta, ou comenta ALUGUEL que eu te mando a conta.",
  },
  {
    id: "P2",
    nome: "QUITAR FINANCIAMENTO",
    duracao_alvo: 35,
    objetivo: "trocar_divida_cara",
    tipos: ["imovel", "veiculo"],
    gancho:
      "Dá para trocar juros de banco por taxa de administração usando carta contemplada.",
    esqueleto:
      "Quem já tem financiamento pode usar o crédito da carta para quitar o saldo devedor e passar a pagar a parcela do consórcio. Descreve o mecanismo, sem prometer economia e sem citar percentual que não seja o custo da própria carta. Fecha com os números da carta do dia.",
    cta: "Manda no direct o saldo do teu financiamento que a gente faz a conta.",
  },
  {
    id: "P3",
    nome: "PODER DE COMPRA À VISTA",
    duracao_alvo: 15,
    objetivo: "poder_de_compra",
    tipos: ["imovel", "veiculo"],
    gancho:
      "Chegar com o crédito na mão muda o desconto que você negocia.",
    esqueleto:
      "Comprador à vista negocia diferente de comprador financiado — é fato de mercado, dito sem número inventado. A carta contemplada é exatamente isso: crédito liberado para comprar à vista. Curta e seca. Fecha com os números da carta do dia.",
    cta: "Link na bio para ver a carta de hoje.",
  },
  {
    id: "P4",
    nome: "EMPRESA / CNPJ",
    duracao_alvo: 35,
    objetivo: "patrimonio_empresa",
    tipos: ["imovel", "veiculo"],
    gancho:
      "Sua empresa paga aluguel comercial há quanto tempo?",
    esqueleto:
      "Empresa também adquire carta de crédito: sede própria em vez de aluguel comercial, ou frota planejada em vez de compra apertada. Escolhe UM dos dois conforme o tipo da carta do dia — imóvel puxa sede, veículo puxa frota. Fecha com os números da carta do dia.",
    cta: "Chama no direct com o CNPJ que a gente monta o cenário.",
  },
  {
    id: "P5",
    nome: "OBRA, TERRENO, REFORMA",
    duracao_alvo: 30,
    objetivo: "construir_ampliar",
    tipos: ["imovel"],
    gancho: "O crédito não é só para casa pronta.",
    esqueleto:
      "Terreno, construção, reforma e ampliação também entram. É o uso que a maioria não sabe que existe, e é fato, não promessa. Duas frases de mecanismo. Fecha com os números da carta do dia.",
    cta: "Comenta OBRA que eu te explico como usa.",
  },
  {
    id: "P6",
    nome: "CEDENTE",
    duracao_alvo: 20,
    objetivo: "captacao",
    tipos: ["imovel", "veiculo"],
    gancho:
      "Tem carta parada que você já pagou anos? Ela vale dinheiro hoje.",
    esqueleto:
      "Fala com quem TEM carta, não com quem quer comprar. A cota já paga tem valor de mercado agora. Cita a Conta Notarial na descrição canônica da casa, porque a dúvida de quem vende é justamente o pagamento. Fecha usando a carta do dia como prova de que esse estoque gira.",
    cta: "Manda os dados da tua cota no direct que a gente avalia.",
  },
  {
    id: "P7",
    nome: "CARRO DE TRABALHO",
    duracao_alvo: 15,
    objetivo: "ferramenta_de_renda",
    tipos: ["veiculo"],
    gancho:
      "Motorista de app, entregador: o veículo que trabalha por você.",
    esqueleto:
      "Para quem roda, o carro não é luxo — é ferramenta. Trocar o veículo com crédito à vista muda a condição de compra. Curta, direta, sem prometer faturamento nem retorno. Fecha com os números da carta do dia.",
    cta: "Link na bio para ver a carta de hoje.",
  },
  {
    id: "P8",
    nome: "MITO × VERDADE",
    duracao_alvo: 30,
    objetivo: "quebra_de_objecao",
    tipos: ["imovel", "veiculo"],
    gancho: "Consórcio é sorteio? A contemplada já passou por isso.",
    esqueleto:
      "Mito: consórcio é esperar sorteio. Verdade: a carta contemplada JÁ foi contemplada — o que se adquire é o crédito liberado. Diz o mito e a verdade sem rodeio, no passado, sem nenhuma palavra sobre contemplação futura. Fecha com os números da carta do dia.",
    cta: "Comenta DÚVIDA que eu respondo a próxima.",
  },
] as const;

/** As fôrmas que fecham no tipo dado. Sem tipo, todas. */
export function formulasDoTipo(tipo?: string): readonly Formula[] {
  if (tipo !== "imovel" && tipo !== "veiculo") return FORMULAS;
  return FORMULAS.filter((f) => f.tipos.includes(tipo));
}

/**
 * A fôrma do dia.
 *
 * `dia` no formato YYYY-MM-DD (o mesmo que `hojeSP()` devolve). A rotação é
 * feita sobre o NÚMERO DE DIAS desde a epoch, e não sobre o dia do mês: com
 * `getDate() % 8` os meses de 31 dias fariam a série pular de volta e a
 * primeira fôrma sairia duas vezes na virada — medido no papel antes de escrever.
 *
 * `exclusiva` NÃO É MAIS USADO na escolha (ver header — a exceção foi
 * eliminada por ordem de 08/08). O parâmetro fica na assinatura porque a ESCUTA
 * já chama com dois argumentos e a OS mandou não quebrar a assinatura.
 *
 * `tipo` é opcional e novo: com ele, a rotação gira só dentro das fôrmas que
 * fecham naquele tipo de carta. Sem ele, gira nas 8 — que é o comportamento de
 * quem ainda não sabe a carta.
 *
 * Note que o índice é calculado sobre a lista JÁ FILTRADA. Isso significa que
 * imóvel e veículo andam em ciclos de tamanhos diferentes (7 e 6), e é o que se
 * quer: cada trilha tem sua própria série, sem buraco no calendário.
 */
export function formulaDoDia(
  dia: string,
  exclusiva: boolean,
  tipo?: string
): Formula {
  void exclusiva; // ver header: eliminado da escolha, mantido na assinatura.

  const lista = formulasDoTipo(tipo);

  // Date.UTC evita que o fuso do runtime mude o índice: a data já vem resolvida
  // em São Paulo por hojeSP(), e daqui para frente ela é só um contador.
  const [ano, mes, d] = dia.split("-").map(Number);
  const dias = Math.floor(Date.UTC(ano, (mes ?? 1) - 1, d ?? 1) / 86_400_000);
  const i = ((dias % lista.length) + lista.length) % lista.length;
  return lista[i];
}

/** Busca por id — usada para reidratar uma pauta já gravada. */
export function formulaPorId(id: string): Formula | null {
  return FORMULAS.find((f) => f.id === id) ?? null;
}
