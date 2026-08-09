// ============================================================================
// lib/farol/segmentos.ts — por quem o vídeo fala
// AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-SCORE-01", 09/08/2026:
//   "Classificar cada vídeo em UM segmento, com duas camadas: 1. Determinística
//    primeiro: dicionário de termos por segmento — ALUGUEL, FINANCIAMENTO,
//    IMOVEL_ALTO, VEICULO, EMPRESA_CNPJ, OBRA_TERRENO, CEDENTE,
//    EDUCACAO_MITOS. Casou 1 → resolvido, custo zero. 2. IA só no resto (...)
//    Nunca reclassificar o que a camada 1 resolveu."
// ----------------------------------------------------------------------------
// OS OITO SEGMENTOS SÃO AS OITO FÔRMAS. MEDIDO, NÃO SUPOSTO.
// ----------------------------------------------------------------------------
// A OS listou oito segmentos. `lib/farol/formulas.ts` tem oito fôrmas. Conferi
// uma por uma e a correspondência é 1:1 e NA MESMA ORDEM:
//
//   ALUGUEL .......... P1 SAIR DO ALUGUEL
//   FINANCIAMENTO .... P2 QUITAR FINANCIAMENTO
//   IMOVEL_ALTO ...... P3 PODER DE COMPRA À VISTA
//   EMPRESA_CNPJ ..... P4 EMPRESA / CNPJ
//   OBRA_TERRENO ..... P5 OBRA, TERRENO, REFORMA
//   CEDENTE .......... P6 CEDENTE
//   VEICULO .......... P7 CARRO DE TRABALHO
//   EDUCACAO_MITOS ... P8 MITO × VERDADE
//
// Isso não é coincidência, é a mesma lista com outro nome. E tem uma
// CONSEQUÊNCIA DE DESENHO que está relatada no READY: se o segmento determina a
// fôrma, então o passo "cruzar com o índice interno das nossas fôrmas naquele
// segmento" não escolhe entre fôrmas — há exatamente uma. O que a recomendação
// de fato decide é QUAL SEGMENTO gravar hoje; a fôrma, a persona e o alvo de
// duração vêm de carona. `FORMULA_DO_SEGMENTO` abaixo é esse vínculo, escrito
// em UM lugar só para não haver duas verdades.
//
// ----------------------------------------------------------------------------
// ESTE DICIONÁRIO É DE LEITURA, NUNCA DE ESCRITA
// ----------------------------------------------------------------------------
// Ele existe para CLASSIFICAR TÍTULO DOS OUTROS. Por isso contém palavras que a
// casa tem proibição expressa de ESCREVER — "investimento", "render", "lucro".
// Um concorrente que publica "consórcio é investimento?" é exatamente o vídeo
// que queremos marcar como EDUCACAO_MITOS, e para reconhecê-lo é preciso saber
// ler a palavra. Nenhuma string deste arquivo entra em roteiro, legenda ou
// resposta — quem escreve é `reel-texto.ts`, e lá o léxico proibido continua
// proibido. Se algum dia alguém importar este dicionário para gerar texto, o
// erro é de quem importou, e este parágrafo é a prova de que foi avisado.
//
// ----------------------------------------------------------------------------
// "CASOU 1 → RESOLVIDO", E O QUE FAZER QUANDO CASAM DOIS
// ----------------------------------------------------------------------------
// A ordem promete custo zero para o que a regra resolver, e isso é cumprido ao
// pé da letra: QUALQUER acerto de termo resolve o vídeo, que nunca mais vai
// para a IA. O que a ordem não decidiu é o desempate, e ele acontece o tempo
// todo — "financiamento imobiliário para sair do aluguel" acerta dois
// segmentos. Pegar o primeiro da lista faria a classificação depender da ordem
// em que eu digitei o objeto, que é o tipo de acaso que ninguém consegue
// depurar depois.
//
// Regra: ganha quem tiver MAIS termos distintos acertados; empate resolve pela
// PRIORIDADE declarada abaixo. Determinístico, testável, e a prioridade está
// escrita como dado e não como ordem de digitação.
// ============================================================================

/** Os oito segmentos. Nome em CAIXA porque vira valor de coluna no banco. */
export const SEGMENTOS = [
  "ALUGUEL",
  "FINANCIAMENTO",
  "IMOVEL_ALTO",
  "EMPRESA_CNPJ",
  "OBRA_TERRENO",
  "CEDENTE",
  "VEICULO",
  "EDUCACAO_MITOS",
] as const;

export type Segmento = (typeof SEGMENTOS)[number];

/** De onde veio a classificação. Vira coluna: auditar depois exige saber. */
export type OrigemClassificacao = "regra" | "ia";

/**
 * Segmento → fôrma. O vínculo mora aqui e em nenhum outro lugar.
 * Ver "OS OITO SEGMENTOS SÃO AS OITO FÔRMAS" no topo.
 */
export const FORMULA_DO_SEGMENTO: Readonly<Record<Segmento, string>> = {
  ALUGUEL: "P1",
  FINANCIAMENTO: "P2",
  IMOVEL_ALTO: "P3",
  EMPRESA_CNPJ: "P4",
  OBRA_TERRENO: "P5",
  CEDENTE: "P6",
  VEICULO: "P7",
  EDUCACAO_MITOS: "P8",
};

/**
 * PRIORIDADE DE DESEMPATE — do mais específico para o mais genérico.
 *
 * A regra é: quem tem vocabulário próprio e estreito vem primeiro; quem tem
 * vocabulário largo vem por último, senão ele engole os outros. CEDENTE lidera
 * porque "vender cota" não significa mais nada além disso. EDUCACAO_MITOS fecha
 * a fila porque "vale a pena" e "como funciona" cabem em qualquer assunto —
 * ele só deve ganhar quando ganhar por CONTAGEM, não por sorteio.
 */
const PRIORIDADE: readonly Segmento[] = [
  "CEDENTE",
  "EMPRESA_CNPJ",
  "OBRA_TERRENO",
  "ALUGUEL",
  "FINANCIAMENTO",
  "VEICULO",
  "IMOVEL_ALTO",
  "EDUCACAO_MITOS",
];

/**
 * O DICIONÁRIO. É este bloco que o Emerson precisa revisar — está no READY
 * inteiro, em tabela, exatamente por isso.
 *
 * Todos os termos aqui são escritos SEM ACENTO e em minúscula, porque é assim
 * que `normalizar()` deixa o título antes de comparar. Termo com acento neste
 * objeto nunca casaria — e o teste `nenhum termo do dicionario tem acento`
 * existe para essa distração não sobreviver a um commit.
 *
 * Termos com espaço são casados como frase; termos de uma palavra são casados
 * com fronteira de palavra, para "obra" não acertar "manobra".
 */
export const TERMOS: Readonly<Record<Segmento, readonly string[]>> = {
  // Sair do aluguel / primeira casa própria.
  ALUGUEL: [
    "aluguel",
    "alugada",
    "alugado",
    "inquilino",
    "sair do aluguel",
    "pagar aluguel",
    "casa propria",
    "imovel proprio",
    "primeiro imovel",
    "primeira casa",
    "morar de aluguel",
    "fugir do aluguel",
  ],

  // Trocar dívida cara por carta: quitação, juros, saldo devedor.
  FINANCIAMENTO: [
    "financiamento",
    "financiar",
    "financiado",
    "financiada",
    "quitar",
    "quitacao",
    "saldo devedor",
    "amortizar",
    "amortizacao",
    "juros do banco",
    "parcela do banco",
    "divida do imovel",
    "sair do financiamento",
    "trocar financiamento",
    // Sugestões do Emerson (09/08), aceitas — com UMA alteração declarada.
    "juros altos",
    "cet",
    "tabela price",
    "financiamento imobiliario",
    // Ele sugeriu "sac" solto. NÃO entrou assim: "SAC" é, antes de tudo,
    // Serviço de Atendimento ao Consumidor, e num nicho cheio de reclamação
    // de administradora ("SAC da administradora", "reclamei no SAC") o termo
    // arrastaria vídeo de atendimento para dentro de FINANCIAMENTO. A
    // fronteira de palavra não protege disso — o termo casa certo, o sentido
    // é que é outro. Entra só nas formas em que só pode ser amortização.
    "tabela sac",
    "sistema sac",
  ],

  // P3 é "PODER DE COMPRA À VISTA" — o vocabulário é o da NEGOCIAÇÃO à vista,
  // não o de imóvel caro. O nome do segmento na OS é IMOVEL_ALTO; mantive o
  // nome dela e o vocabulário da fôrma, que é o que a peça de fato fala.
  IMOVEL_ALTO: [
    "poder de compra",
    "a vista",
    "pagar a vista",
    "comprar a vista",
    "negociar desconto",
    "desconto a vista",
    "sem financiamento",
    "sem juros",
    "dinheiro na mao",
    "alto padrao",
    "imovel maior",
    "segundo imovel",
  ],

  // B2B. "frota" mora AQUI e não em VEICULO de propósito: quem fala frota está
  // falando de empresa, e deixar o termo nos dois lados criaria empate crônico
  // entre dois segmentos que pedem peças bem diferentes.
  EMPRESA_CNPJ: [
    "cnpj",
    "empresa",
    "empresas",
    "empresarial",
    "pessoa juridica",
    "sede propria",
    "frota",
    "imovel comercial",
    "sala comercial",
    "ponto comercial",
    "galpao",
    "mei",
    "microempresa",
    // Sugestões do Emerson (09/08), aceitas.
    "loja propria",
    "escritorio proprio",
    "expandir a empresa",
  ],

  OBRA_TERRENO: [
    "obra",
    "obras",
    "reforma",
    "reformar",
    "construir",
    "construcao",
    "terreno",
    "lote",
    "ampliar",
    "ampliacao",
    "material de construcao",
    "planta",
    "edicula",
  ],

  // Captação: quem QUER SAIR do consórcio. Vocabulário estreito e inconfundível
  // — por isso lidera a prioridade.
  //
  // ESTE SEGMENTO É O ÚNICO FEITO QUASE SÓ DE VERBOS, e isso o torna frágil de
  // um jeito que os outros não são. "aluguel", "financiamento", "obra" e "carro"
  // são SUBSTANTIVOS: aparecem iguais em qualquer título, conjugado ou não. Já
  // "vender" e "desistir" aparecem no título real conjugados em primeira pessoa
  // do passado — ninguém intitula "vender carta contemplada", intitula "VENDI
  // minha carta contemplada". Escrito só no infinitivo, o dicionário errava o
  // caso mais comum do segmento (medido: o teste de amostra do CEDENTE caiu em
  // `null`). Por isso as conjugações estão listadas explicitamente abaixo.
  //
  // O CRITÉRIO DESTA LISTA, depois da revisão do Emerson (09/08): só entra
  // termo que PROVA INTENÇÃO DE VENDER. Eu tinha posto "carta contemplada" e
  // "cartas contempladas" aqui, argumentando que a frase (diferente de
  // "contemplada" solta) seria do mercado secundário. Está errado, e o
  // contraexemplo é curto: "como COMPRAR carta contemplada" é título de quem
  // quer COMPRAR — o oposto exato deste segmento — e cairia aqui. A frase é
  // genérica do nicho inteiro, então saiu.
  //
  // E faltava a forma mais óbvia de todas: "VENDO" é literalmente a primeira
  // palavra do anúncio real de cedente ("VENDO carta contemplada de 300 mil").
  // O infinitivo e o passado estavam listados; o presente, que é o do anúncio,
  // não. Corrigido abaixo.
  CEDENTE: [
    // presente — a forma do anúncio.
    // O POSSESSIVO ENTRA NO MEIO E QUEBRA A FRASE: "vendo cota" NÃO casa
    // "vendo MINHA cota", porque o casamento é de frase literal. Medido — o
    // teste do anúncio real caiu em `null` com a lista sem os possessivos. Por
    // isso cada forma aparece com e sem "minha/meu".
    "vendo carta",
    "vendo cota",
    "vendo consorcio",
    "vendo minha carta",
    "vendo minha cota",
    "vendo meu consorcio",
    "vendo carta contemplada",
    "quero vender",
    "quero vender minha cota",
    // infinitivo
    "vender cota",
    "vender consorcio",
    "vender carta",
    "vender minha cota",
    // passado — a forma do depoimento
    "vendi minha carta",
    "vendi a carta",
    "vendi minha cota",
    "vendi meu consorcio",
    "desisti do consorcio",
    "desistiu do consorcio",
    "quem desistiu",
    // cessão e saída
    "ceder cota",
    "cessao de cota",
    "cedente",
    "transferir cota",
    "transferencia de cota",
    "passar a carta",
    "desistir do consorcio",
    "sair do consorcio",
    "cancelar consorcio",
    "cancelamento de consorcio",
    "carta a venda",
    "repasse de consorcio",
    "repasse de carta",
  ],

  VEICULO: [
    "carro",
    "carros",
    "veiculo",
    "veiculos",
    "moto",
    "caminhao",
    "caminhonete",
    "picape",
    "utilitario",
    "van",
    "carro de trabalho",
    "carro zero",
    "trocar de carro",
    "motorista de app",
    "uber",
    "carro novo",
    // Sugestões do Emerson (09/08), aceitas. São o vocabulário de quem compra
    // veículo COMO FERRAMENTA DE TRABALHO — que é o que a P7 fala.
    "entregador",
    "frete",
    "moto zero",
    "aplicativo de transporte",
  ],

  // O mais largo. Só ganha por contagem — ver PRIORIDADE.
  // Contém palavras do léxico PROIBIDO PARA ESCRITA ("investimento", "render"):
  // são iscas de MITO alheio, e este arquivo só lê. Ver o bloco do topo.
  EDUCACAO_MITOS: [
    "mito",
    "mitos",
    "verdade",
    "mentira",
    "golpe",
    "cilada",
    "armadilha",
    "pegadinha",
    "cuidado",
    "vale a pena",
    "como funciona",
    "passo a passo",
    "o que e consorcio",
    "entenda",
    "aprenda",
    "explicando",
    "erro",
    "erros",
    "e investimento",
    "e furada",
    "taxa de administracao",
    "fundo de reserva",
    // Vocabulário nº1 do vídeo de mito do nicho (Emerson, 09/08). São os
    // MECANISMOS do consórcio: quem digita "lance embutido" ou "assembleia"
    // está atrás de explicação, não de compra — que é exatamente a P8.
    "sorteio",
    "lance",
    "lance embutido",
    "contemplacao",
    "assembleia",
    "autofinanciamento",
    "consorcio vale a pena",
    "consorcio ou financiamento",
    // MARCADORES DE COMPARAÇÃO. Não são enfeite: sem eles, "Consórcio ou
    // financiamento: qual escolher" perdia para FINANCIAMENTO. O título casa
    // "consorcio ou financiamento" (1 acerto aqui) e "financiamento" (1 acerto
    // lá) — empate, e no empate a PRIORIDADE entrega a FINANCIAMENTO, que vem
    // antes. Título de comparação SEMPRE contém o termo do outro segmento;
    // é da natureza dele. Estes marcadores são o que desempata pela contagem.
    // Ver ACHADO 10 no READY: a contagem trata frase específica e palavra
    // genérica como um acerto cada, e isso é estrutural, não deste título.
    "qual e melhor",
    "qual escolher",
    "vale mais a pena",
    "diferenca entre",
  ],
};

// ----------------------------------------------------------------------------
// Normalização e casamento
// ----------------------------------------------------------------------------

/**
 * Minúscula, sem acento, sem pontuação, espaços colapsados.
 *
 * `NFD` + remoção da faixa de combinantes é o jeito sem dependência de tirar
 * acento: "Consórcio" → "consorcio". A pontuação vira ESPAÇO e não vazio, senão
 * "carro/moto" viraria "carromoto" e perderia os dois termos.
 */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Escapa metacaracteres antes de virar regex — termo é dado, não padrão. */
function escapar(termo: string): string {
  return termo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Casa com FRONTEIRA DE PALAVRA nas duas pontas. É o que impede "obra" de
 * acertar "manobra" e "mei" de acertar "meia". Vale igual para termo de uma
 * palavra e para frase.
 */
function acertou(textoNormalizado: string, termo: string): boolean {
  return new RegExp(`(^|\\s)${escapar(termo)}($|\\s)`).test(textoNormalizado);
}

/** Quantos termos DISTINTOS de um segmento aparecem no texto. */
export function contarAcertos(textoNormalizado: string, seg: Segmento): number {
  let n = 0;
  for (const termo of TERMOS[seg]) {
    if (acertou(textoNormalizado, termo)) n++;
  }
  return n;
}

export type Classificacao = {
  segmento: Segmento | null;
  origem: OrigemClassificacao | null;
  /** Quantos termos casaram no vencedor. 0 quando ninguém casou. */
  acertos: number;
  /** Segmentos que também casaram, para auditar vocabulário ambíguo. */
  disputa: readonly Segmento[];
};

/**
 * CAMADA 1 — determinística, custo zero.
 *
 * Devolve `segmento: null` quando NINGUÉM casou: é esse e só esse o caso que
 * pode ir para a IA. Quem casou está resolvido para sempre, como a ordem manda.
 */
export function classificarPorRegra(texto: string): Classificacao {
  const t = normalizar(texto);

  const placar = SEGMENTOS.map((seg) => ({ seg, n: contarAcertos(t, seg) })).filter(
    (p) => p.n > 0
  );

  if (placar.length === 0) {
    return { segmento: null, origem: null, acertos: 0, disputa: [] };
  }

  const maior = Math.max(...placar.map((p) => p.n));
  const empatados = placar.filter((p) => p.n === maior).map((p) => p.seg);

  // Desempate por PRIORIDADE declarada, nunca por ordem de digitação.
  const vencedor =
    PRIORIDADE.find((s) => empatados.includes(s)) ?? empatados[0];

  return {
    segmento: vencedor,
    origem: "regra",
    acertos: maior,
    disputa: placar.map((p) => p.seg).filter((s) => s !== vencedor),
  };
}

// ----------------------------------------------------------------------------
// CAMADA 2 — IA, e só no que sobrou
// ----------------------------------------------------------------------------

/** Teto diário de itens mandados para a IA. Literal da ordem: "máx 20/dia". */
export const TETO_IA_DIA = 20;

/**
 * Kill-switch da fatia inteira, DESARMADO por padrão (padrão da casa).
 * Sem ele nada calcula, nada classifica por IA e nada recomenda.
 */
export function scoreLigado(): boolean {
  return process.env.FAROL_SCORE === "on";
}

export type ItemParaClassificar = { video_id: string; titulo: string };

/**
 * Monta o prompt do lote. Separado da chamada de rede porque é a parte que dá
 * para TESTAR sem gastar token: o teste confere que os oito nomes de segmento
 * estão na instrução e que os títulos entram identificados por video_id.
 */
export function promptDeLote(itens: readonly ItemParaClassificar[]): string {
  return [
    "Classifique cada vídeo em EXATAMENTE UM segmento da lista.",
    `Segmentos válidos: ${SEGMENTOS.join(", ")}.`,
    "São vídeos brasileiros sobre consórcio, crédito e imóveis.",
    "Se nenhum servir, use EDUCACAO_MITOS.",
    'Responda SOMENTE JSON: {"itens":[{"video_id":"...","segmento":"..."}]}',
    "",
    ...itens.map((i) => `${i.video_id} :: ${i.titulo}`),
  ].join("\n");
}

/**
 * Lê a resposta da IA sem confiar nela. Descarta item com segmento inválido,
 * video_id desconhecido ou repetido — a IA é fonte, não autoridade.
 */
export function lerRespostaDeLote(
  bruto: unknown,
  pedidos: readonly ItemParaClassificar[]
): Map<string, Segmento> {
  const fora = new Map<string, Segmento>();
  const validos = new Set(pedidos.map((p) => p.video_id));

  const itens = (bruto as { itens?: unknown })?.itens;
  if (!Array.isArray(itens)) return fora;

  for (const it of itens) {
    const id = (it as { video_id?: unknown })?.video_id;
    const seg = (it as { segmento?: unknown })?.segmento;
    if (typeof id !== "string" || typeof seg !== "string") continue;
    if (!validos.has(id) || fora.has(id)) continue;
    if (!(SEGMENTOS as readonly string[]).includes(seg)) continue;
    fora.set(id, seg as Segmento);
  }
  return fora;
}
