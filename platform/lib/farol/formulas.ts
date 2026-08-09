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
//
// ---------------------------------------------------------------------------
// A RÉGUA — os alvos deixaram de ser chute (decisão 2, coordenação 08/08)
// ---------------------------------------------------------------------------
// Os oito `duracao_alvo` originais (15/20/30/35) eram números redondos escritos
// antes de existir vídeo para medir. Em 08/08 eu li o átomo `mvhd` dos dois mp4
// REAIS que foram ao ar:
//
//   reel 07/08  df4b877…   90 palavras → 31,49 s → 171,5 ppm
//   reel 08/08  82572f4…   82 palavras → 32,81 s → 149,9 ppm
//   agregado              172 palavras → 64,30 s → 160,5 ppm = 2,68 pal/s
//
// Rodando o template com a carta real do Itaú (R$ 2.385.990) e a do Bradesco
// (R$ 1.132.000), cada fôrma mede:
//
//   P3  67/66 pal → 25,0 / 24,6 s      P8  78/75 pal → 29,1 / 28,0 s
//   P7  62    pal → 23,1 s             P6  81/80 pal → 30,2 / 29,9 s
//   P5  74    pal → 27,6 s             P4  82/79 pal → 30,6 / 29,5 s
//   P1 104    pal → 38,8 s             P2 105/102 pal → 39,2 / 38,1 s
//
// AUTORIZADO por Emerson nas faixas de 08/08: curtas <= 25s, médias <= 32s,
// longas <= 40s. `duracao_alvo` agora é o TETO da faixa em que a fôrma mede, e
// o valor medido fica no comentário ao lado — teto e medição escritos juntos,
// para ninguém precisar confiar na memória de nenhum dos dois.
//
// A DECISÃO QUE **NÃO** FOI TOMADA: encurtar as fôrmas. P1 e P2 medem ~39s e
// ficam coladas no teto. O número falado NÃO sai do áudio (é promessa da marca,
// decisão 2), então o único jeito de encurtá-las seria cortar mecanismo — e
// isso é escolha editorial do Emerson, não minha.
//
// ---------------------------------------------------------------------------
// A PROVA — o FECHO CURTO virou UNIVERSAL, e o campo `prova` morreu com isso
// ---------------------------------------------------------------------------
// AUTORIZADO: coordenação de 09/08/2026 — "só crédito + custo ao mês passa a
// ser o padrão de TODAS as 8 fôrmas, não só da P6. Entrada e parcelas SAEM do
// áudio e vão para a LEGENDA. O custo ao mês CONTINUA falado — é promessa da
// marca." Motivo medido: o fecho longo consumia ~15s de 39s, quase metade da
// peça, e contradizia o eixo das possibilidades.
//
// EXISTIA AQUI UM CAMPO `prova: "so_credito" | "completa"`, nascido em 08/08
// para separar "o que o fecho fala" de "quanto o fecho dura" — duas coisas que
// até então estavam amarradas em `duracao_alvo <= 20`. Ele cumpriu o papel
// dele: foi por causa dessa separação que P6 não virou "completa" no silêncio
// quando os alvos passaram a ser medidos.
//
// Com o fecho curto universal, o campo deixou de discriminar QUALQUER coisa —
// e um campo que não discrimina nada é pior que campo nenhum, porque continua
// LENDO como se discriminasse: quem abrisse a P1 e lesse `prova: "completa"`
// concluiria que a P1 fala entrada e parcelas, e não fala mais. Foi removido,
// junto com `ehCurta()` (lib/farol/reel-texto.ts), que era seu único leitor em
// todo o repositório. É a mesma lição do `duracao_alvo <= 20`, aplicada ao
// campo que a substituiu.
//
// ---------------------------------------------------------------------------
// A PERSONA — quem FALA cada fôrma (FAROL-DUPLA-01, decisão 6 de 08/08)
// ---------------------------------------------------------------------------
// AUTORIZADO: Emerson Gomes dos Santos — "dados duros/dinheiro/segurança →
// Porta-voz; vida/casa/sonho/cotidiano/captação → Valentina".
//
// A regra foi aplicada sobre o `objetivo` de cada fôrma, que é o eixo editorial
// dela, e não sobre palavras soltas do texto. Fica 4 × 4:
//
//   PORTA-VOZ (dado duro)          VALENTINA (vida)
//   P2 trocar_divida_cara          P1 moradia_propria
//   P3 poder_de_compra             P5 construir_ampliar
//   P4 patrimonio_empresa          P6 captacao
//   P8 quebra_de_objecao           P7 ferramenta_de_renda
//
// O ÚNICO CASO QUE CONFLITA, DECLARADO: P6 CEDENTE. O objetivo dela é
// `captacao`, que a ordem manda para a Valentina; mas o corpo do roteiro cita a
// Conta Notarial, que é SEGURANÇA e a ordem manda para o Porta-voz. Resolvi
// pelo objetivo, porque é ele que define com quem o vídeo fala (aqui, quem TEM
// cota parada e quer vender) — a Conta Notarial ali é mecanismo de apoio, não o
// assunto. Emerson: se preferir P6 no Porta-voz, é trocar UMA linha.
//
// ISTO NÃO MUDA UMA VÍRGULA DO TEXTO. Nenhuma das oito fôrmas se identifica na
// fala — todas abrem pelo `gancho`. Quem se identifica é o roteiro CLÁSSICO
// ("Oi! Aqui é o porta-voz da Bidcon", reel-texto.ts), e é justamente por isso
// que o caminho sem fôrma nunca pode ser da Valentina: ela se apresentaria como
// "o porta-voz". Essa trava é estrutural, não uma checagem — sem fôrma não há
// campo `persona` para ler, e o resolvedor cai no Porta-voz.
// ============================================================================

/** Em que tipo de carta a fôrma consegue aterrissar. */
export type TipoBem = "imovel" | "veiculo";

/**
 * Quem fala a fôrma. Ver "A PERSONA" no header.
 * `porta_voz` é o avatar de sempre (HEYGEN_AVATAR_ID/HEYGEN_VOICE_ID);
 * `valentina` é a segunda persona (HEYGEN_AVATAR_ID_2/HEYGEN_VOICE_ID_2), que
 * só é usada com `FAROL_DUPLA=on`.
 */
export type Persona = "porta_voz" | "valentina";

export type Formula = {
  /** Estável e curto: vira valor de coluna em farol_pauta e chave de métrica. */
  id: string;
  nome: string;
  /**
   * TETO de segundos de fala, nas faixas de 08/08: curtas <= 25, médias <= 32,
   * longas <= 40. Ver "A RÉGUA" no header. É TETO, não meta — o template mede
   * abaixo dele, e o valor MEDIDO está no comentário de cada fôrma.
   */
  duracao_alvo: number;
  /**
   * Quem fala esta fôrma. Ver "A PERSONA" no header. Só tem efeito com
   * `FAROL_DUPLA=on`; desarmada, TODAS falam pelo Porta-voz de sempre.
   */
  persona: Persona;
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
    duracao_alvo: 40, // LONGA — medido: 104 palavras / 2,68 = 38,8s (imóvel)
    persona: "valentina", // casa/sonho
    objetivo: "moradia_propria",
    tipos: ["imovel"],
    gancho:
      "Você paga aluguel há quantos anos? Faz a conta do que já saiu da sua mão.",
    esqueleto:
      "O aluguel pago não volta e não vira patrimônio. A carta contemplada é crédito JÁ liberado: compra o imóvel à vista e troca o aluguel por parcela de algo que fica seu. Explica o mecanismo em duas frases factuais, sem projeção e sem comparar com número que não foi dado. Fecha com o CRÉDITO da carta do dia e o custo ao mês como prova de que existe hoje — só esses dois números, nunca entrada nem parcelas, que vivem na legenda.",
    cta: "Toca no link da bio para ver a carta, ou comenta ALUGUEL que eu te mando a conta.",
  },
  {
    id: "P2",
    nome: "QUITAR FINANCIAMENTO",
    duracao_alvo: 40, // LONGA — medido: 105 pal / 39,2s imóvel; 102 / 38,1s veículo
    persona: "porta_voz", // dinheiro/dívida
    objetivo: "trocar_divida_cara",
    tipos: ["imovel", "veiculo"],
    gancho:
      "Dá para trocar juros de banco por taxa de administração usando carta contemplada.",
    esqueleto:
      "Quem já tem financiamento pode usar o crédito da carta para quitar o saldo devedor e passar a pagar a parcela do consórcio. Descreve o mecanismo, sem prometer economia e sem citar percentual que não seja o custo da própria carta. Fecha com o CRÉDITO da carta do dia e o custo ao mês — só esses dois números, nunca entrada nem parcelas, que vivem na legenda.",
    cta: "Manda no direct o saldo do teu financiamento que a gente faz a conta.",
  },
  {
    id: "P3",
    nome: "PODER DE COMPRA À VISTA",
    duracao_alvo: 25, // CURTA — medido: 67 pal / 25,0s imóvel; 66 / 24,6s veículo
    persona: "porta_voz", // dinheiro/negociação
    objetivo: "poder_de_compra",
    tipos: ["imovel", "veiculo"],
    gancho:
      "Chegar com o crédito na mão muda o desconto que você negocia.",
    esqueleto:
      "Comprador à vista negocia diferente de comprador financiado — é fato de mercado, dito sem número inventado. A carta contemplada é exatamente isso: crédito liberado para comprar à vista. Curta e seca. Fecha com o CRÉDITO da carta do dia e o custo ao mês — só esses dois números, nunca entrada nem parcelas, que vivem na legenda.",
    cta: "Link na bio para ver a carta de hoje.",
  },
  {
    id: "P4",
    nome: "EMPRESA / CNPJ",
    duracao_alvo: 32, // MÉDIA — medido: 82 pal / 30,6s imóvel; 79 / 29,5s veículo
    persona: "porta_voz", // dado duro/B2B
    objetivo: "patrimonio_empresa",
    tipos: ["imovel", "veiculo"],
    gancho:
      "Sua empresa paga aluguel comercial há quanto tempo?",
    esqueleto:
      "Empresa também adquire carta de crédito: sede própria em vez de aluguel comercial, ou frota planejada em vez de compra apertada. Escolhe UM dos dois conforme o tipo da carta do dia — imóvel puxa sede, veículo puxa frota. Fecha com o CRÉDITO da carta do dia e o custo ao mês — só esses dois números, nunca entrada nem parcelas, que vivem na legenda.",
    cta: "Chama no direct com o CNPJ que a gente monta o cenário.",
  },
  {
    id: "P5",
    nome: "OBRA, TERRENO, REFORMA",
    duracao_alvo: 32, // MÉDIA — medido: 74 palavras / 27,6s (imóvel)
    persona: "valentina", // casa/sonho
    objetivo: "construir_ampliar",
    tipos: ["imovel"],
    gancho: "O crédito não é só para casa pronta.",
    esqueleto:
      "Terreno, construção, reforma e ampliação também entram. É o uso que a maioria não sabe que existe, e é fato, não promessa. Duas frases de mecanismo. Fecha com o CRÉDITO da carta do dia e o custo ao mês — só esses dois números, nunca entrada nem parcelas, que vivem na legenda.",
    cta: "Comenta OBRA que eu te explico como usa.",
  },
  {
    id: "P6",
    // A fôrma que virou o PADRÃO. Ela já fechava só com o crédito quando as
    // outras sete recitavam a carta inteira, e foi a comparação com ela que
    // mostrou o preço do fecho longo: ~15s de 39s. A coordenação de 09/08
    // estendeu o fecho da P6 às oito. Ver "A PROVA" no header.
    // Continua sendo a única com abertura de fecho própria ("Esse estoque gira
    // todo dia — hoje tem…"), agora por parâmetro e não por cópia do fecho.
    nome: "CEDENTE",
    duracao_alvo: 32, // MÉDIA — medido: 81 pal / 30,2s imóvel; 80 / 29,9s veículo
    persona: "valentina", // captação — ver "O ÚNICO CASO QUE CONFLITA" no header
    objetivo: "captacao",
    tipos: ["imovel", "veiculo"],
    gancho:
      "Tem carta parada que você já pagou anos? Ela vale dinheiro hoje.",
    esqueleto:
      "Fala com quem TEM carta, não com quem quer comprar. A cota já paga tem valor de mercado agora. Cita a Conta Notarial na descrição canônica da casa, porque a dúvida de quem vende é justamente o pagamento. Fecha usando o CRÉDITO da carta do dia e o custo ao mês como prova de que esse estoque gira — só esses dois números, nunca entrada nem parcelas, que vivem na legenda.",
    cta: "Manda os dados da tua cota no direct que a gente avalia.",
  },
  {
    id: "P7",
    nome: "CARRO DE TRABALHO",
    duracao_alvo: 25, // CURTA — medido: 62 palavras / 23,1s (veículo)
    persona: "valentina", // cotidiano/trabalho
    objetivo: "ferramenta_de_renda",
    tipos: ["veiculo"],
    gancho:
      "Motorista de app, entregador: o veículo que trabalha por você.",
    esqueleto:
      "Para quem roda, o carro não é luxo — é ferramenta. Trocar o veículo com crédito à vista muda a condição de compra. Curta, direta, sem prometer faturamento nem retorno. Fecha com o CRÉDITO da carta do dia e o custo ao mês — só esses dois números, nunca entrada nem parcelas, que vivem na legenda.",
    cta: "Link na bio para ver a carta de hoje.",
  },
  {
    id: "P8",
    nome: "MITO × VERDADE",
    duracao_alvo: 32, // MÉDIA — medido: 78 pal / 29,1s imóvel; 75 / 28,0s veículo
    persona: "porta_voz", // dado duro/objeção
    objetivo: "quebra_de_objecao",
    tipos: ["imovel", "veiculo"],
    gancho: "Consórcio é sorteio? A contemplada já passou por isso.",
    esqueleto:
      "Mito: consórcio é esperar sorteio. Verdade: a carta contemplada JÁ foi contemplada — o que se adquire é o crédito liberado. Diz o mito e a verdade sem rodeio, no passado, sem nenhuma palavra sobre contemplação futura. Fecha com o CRÉDITO da carta do dia e o custo ao mês — só esses dois números, nunca entrada nem parcelas, que vivem na legenda.",
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
