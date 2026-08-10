// ============================================================================
// pivo-sem-entrada.ts — o que o Prosperito diz depois de "não tenho entrada"
// (PROSPERITO-SEM-ENTRADA-01)
// ----------------------------------------------------------------------------
//
// O DEFEITO QUE ISTO CONSERTA NÃO É UMA MENTIRA. Na conversa que originou a
// fatia, o Prosperito respondeu que para uma carta CONTEMPLADA a entrada é
// indispensável. Isso é verdade e continua sendo dito aqui, primeiro, sem
// suavizar. O defeito foi parar na verdade — existe uma segunda porta honesta
// e ninguém a abriu.
//
// ----------------------------------------------------------------------------
// POR QUE A RESPOSTA TEM DUAS PARTES, E POR QUE NESSA ORDEM
// ----------------------------------------------------------------------------
// Se a porta viesse primeiro, a mensagem viraria contorno de objeção: o cliente
// diz "não tenho" e ouve "mas tenho outra coisa pra te vender". A verdade
// primeiro faz a segunda parte ser uma ALTERNATIVA, não um desvio. Quem lê na
// ordem certa entende que a primeira resposta continua valendo.
//
// ----------------------------------------------------------------------------
// POR QUE AS TRÊS PERGUNTAS SÃO UMA DE CADA VEZ
// ----------------------------------------------------------------------------
// Três perguntas num balão só, no WhatsApp, recebem uma resposta só — quase
// sempre a da última. As outras duas se perdem e o atendente humano recebe uma
// ficha pela metade sem saber que ficou pela metade. Uma de cada vez custa três
// idas e vindas e chega inteira.
//
// A ordem também não é arbitrária: PRESSA primeiro porque é a única das três
// que pode ENCERRAR o caminho. Quem precisa do bem este mês não deve entrar num
// consórcio novo, e perguntar o crédito antes seria fazer a pessoa sonhar com
// um número para depois dizer que o caminho não serve pra ela.
//
// ----------------------------------------------------------------------------
// O QUE ESTE ARQUIVO TEM PROIBIDO DIZER
// ----------------------------------------------------------------------------
// Nunca prometer contemplação, nunca dar prazo, nunca dizer "garantido", nunca
// sugerir percentual de lance que ganha. Não é recomendação de estilo: é a
// diferença entre informar e vender expectativa que não se controla. O
// cumprimento disso é COBRADO NO TESTE, varrendo todos os textos exportados
// daqui atrás das palavras proibidas — não confio na minha própria revisão.
//
// E o Prosperito NÃO FECHA. Ele coleta as três respostas e entrega a um
// humano. Está escrito no texto do fechamento, para o cliente, não só aqui.
// ============================================================================

/** Kill-switch. Nasce desarmada: sem `PROSPERITO_SEM_ENTRADA=on` nada disto fala. */
export const ENV_KILL_SWITCH = "PROSPERITO_SEM_ENTRADA";

/**
 * As três perguntas, na ordem em que são feitas. Exportada como dado — e não
 * escondida dentro da função — porque o painel precisa listar o que foi
 * coletado, e a lista de campos não pode existir em dois lugares.
 */
export const CAMPOS = ["pressa", "credito", "parcela"] as const;
export type Campo = (typeof CAMPOS)[number];

/** O que já se sabe. `null` = perguntado e não respondido; ausente = nem perguntado. */
export type EstadoPivo = Partial<Record<Campo, string | null>>;

export type Passo = {
  /** Qual etapa a fala pertence. Vai para o `detalhe` da mensagem. */
  etapa: "abertura" | Campo | "fechamento";
  /** O texto que vai para o cliente. */
  texto: string;
  /** Se true, não há mais o que perguntar — hora de chamar o humano. */
  completo: boolean;
};

// ---------------------------------------------------------------------------
// PARTE 1 — a verdade, que não muda
// ---------------------------------------------------------------------------
export const PARTE_1_VERDADE =
  "Sobre a carta contemplada, preciso ser direto com você: a entrada é " +
  "indispensável mesmo. Ela é o que paga a quem está cedendo a carta — sem " +
  "ela não existe negócio, e eu não quero te fazer perder tempo com uma " +
  "possibilidade que não existe.";

// ---------------------------------------------------------------------------
// PARTE 2 — a porta, com o custo dela dito junto
// ---------------------------------------------------------------------------
// "A diferença é o tempo" é a frase que impede a porta de virar promessa. Ela
// aparece ANTES de qualquer convite a continuar.
export const PARTE_2_PORTA =
  "Só que existe outro caminho, e ele pode servir pra você: começar um " +
  "consórcio novo. Nele você não dá entrada — entra pagando só a parcela. " +
  "A diferença está no tempo: na carta contemplada o crédito já está " +
  "liberado, e no consórcio novo você entra num grupo e o crédito sai quando " +
  "você for contemplado, por sorteio ou por lance. Não dá pra saber quando " +
  "isso acontece, e quem te disser que sabe está inventando.";

// ---------------------------------------------------------------------------
// O lance embutido — a explicação honesta
// ---------------------------------------------------------------------------
// Só entra na conversa se o cliente perguntar, ou no fechamento. A segunda
// frase é a que costuma ser omitida por aí, e é justamente a que importa: o
// lance embutido não é dinheiro de graça, é desconto no que você recebe.
export const TEXTO_LANCE_EMBUTIDO =
  "Existe o lance embutido: em vez de tirar o dinheiro do bolso, você usa uma " +
  "parte do próprio crédito como lance. Isso aumenta a chance de você ser " +
  "contemplado antes. Em compensação — e essa parte quase ninguém conta — o " +
  "valor que você recebe no fim diminui na mesma medida: se você embutir, o " +
  "crédito que chega na sua mão é menor do que o contratado. Não é dinheiro " +
  "extra, é troca de valor por tempo. E mesmo com lance, ninguém consegue te " +
  "dizer a data.";

// ---------------------------------------------------------------------------
// As três perguntas
// ---------------------------------------------------------------------------
export const PERGUNTAS: Record<Campo, string> = {
  pressa:
    "Antes de eu te mostrar números, uma pergunta que muda tudo: você precisa " +
    "do bem com urgência, tipo nos próximos meses, ou dá pra esperar? Pergunto " +
    "porque, se a sua necessidade é agora, o consórcio novo não é o caminho " +
    "certo pra você e eu prefiro te dizer isso logo.",
  credito:
    "Certo. E de quanto seria o crédito que você precisa? Pode ser um valor " +
    "aproximado — é só pra eu entender o tamanho do plano.",
  parcela:
    "Última coisa: qual valor de parcela cabe no seu mês, com tranquilidade? " +
    "Prefiro trabalhar com um número que você paga sem apertar do que com um " +
    "que trava lá na frente.",
};

// ---------------------------------------------------------------------------
// O fechamento — onde o Prosperito admite o próprio limite
// ---------------------------------------------------------------------------
export const TEXTO_FECHAMENTO =
  "Anotei tudo. Agora vou passar pra uma pessoa do time, porque quem monta e " +
  "fecha o plano é gente, não eu — eu organizo a conversa até aqui. Ela te " +
  "chama por aqui mesmo com as opções que batem com o que você me disse.";

/**
 * A abertura: as duas partes, na ordem, e já emendando a primeira pergunta.
 * Vêm juntas de propósito — separar a verdade da porta em dois envios deixaria
 * um intervalo em que o cliente lê só "não dá" e sai da conversa.
 */
export function textoAbertura(): string {
  return `${PARTE_1_VERDADE}\n\n${PARTE_2_PORTA}\n\n${PERGUNTAS.pressa}`;
}

/**
 * Qual o próximo campo ainda sem resposta. Função pura, sem estado escondido:
 * recebe o que já se sabe, devolve o que falta.
 *
 * Uma resposta `null` conta como NÃO respondida — a pergunta foi feita e o
 * cliente desviou. Repetir é melhor do que entregar ficha furada ao humano.
 */
export function proximoCampo(estado: EstadoPivo): Campo | null {
  for (const c of CAMPOS) {
    const v = estado[c];
    if (v === undefined || v === null || String(v).trim() === "") return c;
  }
  return null;
}

/**
 * O passo seguinte da conversa.
 *
 * `estado` vazio ⇒ abertura (as duas partes + a primeira pergunta).
 * Todos os campos preenchidos ⇒ fechamento, com `completo: true`.
 */
export function proximoPasso(estado: EstadoPivo = {}): Passo {
  const nenhumPerguntado = CAMPOS.every((c) => estado[c] === undefined);
  if (nenhumPerguntado) {
    return { etapa: "abertura", texto: textoAbertura(), completo: false };
  }
  const campo = proximoCampo(estado);
  if (!campo) {
    return { etapa: "fechamento", texto: TEXTO_FECHAMENTO, completo: true };
  }
  return { etapa: campo, texto: PERGUNTAS[campo], completo: false };
}

/**
 * O que vai para `wa_mensagens.detalhe` / `wa_conversas` — a ficha que o
 * atendente humano lê. Só os campos com resposta: um campo vazio no painel
 * tem de significar "não sabemos", nunca "respondeu vazio".
 */
export function fichaColetada(estado: EstadoPivo): Record<string, string> {
  const ficha: Record<string, string> = {};
  for (const c of CAMPOS) {
    const v = estado[c];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      ficha[c] = String(v).trim();
    }
  }
  return ficha;
}

// ---------------------------------------------------------------------------
// A PONTE COM O CÉREBRO — e por que ela é prompt, não máquina de estados
// ---------------------------------------------------------------------------
// Medido antes de escrever: o WhatsApp da casa NÃO responde por script. Quem
// responde é `gerarRespostaWhatsApp` (lib/whatsapp/cerebro.ts), um modelo com
// histórico. Não existe hoje coluna onde guardar EstadoPivo entre mensagens, e
// criar uma exigiria migração — que é aplicada à mão pela coordenação e
// deixaria esta fatia parada esperando.
//
// Então a ponte é esta função: ela devolve um bloco de instrução que entra no
// system prompt, no mesmo lugar e do mesmo jeito que `blocoSaber` — e vazia
// quando o kill-switch está desarmado, de modo que o system fica IDÊNTICO ao
// de hoje enquanto ninguém armar nada.
//
// O ponto que faz isso valer: o bloco é MONTADO A PARTIR DAS MESMAS
// CONSTANTES acima. Não há segunda cópia dos textos. O que o teste varre atrás
// de "garantido", de prazo e de percentual é exatamente o que chega ao modelo.
// Se eu tivesse reescrito as frases aqui dentro, a varredura estaria vigiando
// um texto que ninguém usa — que é o modo mais comum de um teste virar enfeite.
//
// `proximoPasso`/`fichaColetada` continuam valendo e testados, mas HOJE NÃO
// SÃO O MOTOR: servem ao painel (montar a ficha a partir do que foi coletado)
// e ao dia em que houver onde guardar estado. Está dito aqui para ninguém ler
// o arquivo e supor que a conversa é determinística — ela não é.
export function semEntradaLigado(): boolean {
  return process.env[ENV_KILL_SWITCH] === "on";
}

/**
 * Bloco de instrução para o system prompt. `""` quando desarmado ou quando a
 * mensagem não é de alguém sem entrada — os dois casos deixam o prompt intacto.
 *
 * Recebe o resultado do detector já pronto (booleano) em vez de chamar o
 * detector aqui: mantém este módulo sem dependência do outro e deixa o cérebro
 * decidir, num lugar só, o que conta como gatilho.
 */
export function blocoSemEntrada(clienteSemEntrada: boolean): string {
  if (!semEntradaLigado()) return "";
  if (!clienteSemEntrada) return "";
  return [
    "## O cliente disse que não tem a entrada",
    "",
    "Responda em DUAS partes, nesta ordem, sem inverter:",
    "",
    "1) A verdade, sem suavizar:",
    PARTE_1_VERDADE,
    "",
    "2) A alternativa, com o custo dela dito junto:",
    PARTE_2_PORTA,
    "",
    "Depois, colete três informações — UMA PERGUNTA POR MENSAGEM, nunca as três",
    "juntas, e nesta ordem. Olhe o histórico para saber qual já foi respondida e",
    "não repita pergunta já respondida:",
    `- pressa: ${PERGUNTAS.pressa}`,
    `- credito: ${PERGUNTAS.credito}`,
    `- parcela: ${PERGUNTAS.parcela}`,
    "",
    "Se o cliente perguntar como ser contemplado antes, ou falar em lance,",
    "explique o lance embutido ASSIM — inclusive a segunda metade, que é a que",
    "costuma ser omitida:",
    TEXTO_LANCE_EMBUTIDO,
    "",
    "Quando tiver as três respostas, encerre a sua parte com:",
    TEXTO_FECHAMENTO,
    "",
    "PROIBIDO, sem exceção: prometer contemplação, dizer ou estimar quando ela",
    "acontece, usar a palavra garantido, sugerir percentual de lance que ganha,",
    "e fechar o negócio você mesmo — quem monta e fecha o plano é uma pessoa.",
  ].join("\n");
}

/** Todos os textos que este módulo pode dizer ao cliente. O teste varre isto. */
export const TODOS_OS_TEXTOS: string[] = [
  PARTE_1_VERDADE,
  PARTE_2_PORTA,
  TEXTO_LANCE_EMBUTIDO,
  TEXTO_FECHAMENTO,
  ...Object.values(PERGUNTAS),
];
