// ============================================================================
// cedente.ts — detector de vocabulário de venda (PAINEL-DASHBOARD-01, conserto 2)
// ----------------------------------------------------------------------------
//
// O QUE ISTO É, DITO SEM ENFEITE: casamento de palavra-chave. Não é
// classificação de intenção, não chama modelo, não entende contexto e vai
// errar nas duas direções. Existe porque a alternativa — a etapa "marcadas
// cedente" do funil ficar vazia para sempre — é pior, e porque uma etiqueta
// barata que acerta a maioria dos casos óbvios já paga o atendimento humano
// chegar primeiro em quem quer vender.
//
// A ETIQUETA É PISTA, NUNCA FATO. Quem lê o painel tem que saber disso, e por
// isso a medida que sai daqui vai rotulada como heurística na tela. No dia em
// que o CAPTACAO-01 trouxer um detector de verdade, ele substitui esta função
// e o resto do sistema não muda de forma: continua gravando 'cedente' em
// wa_conversas.tags.
//
// A REGRA CENTRAL, E O ERRO QUE ELA EVITA. "vender" sozinho NÃO marca ninguém.
// A pergunta mais comum que chega no WhatsApp da Bidcon é "vocês vendem carta
// de crédito?" — comprador, o oposto exato de cedente. Marcar por verbo
// classificaria todo comprador como vendedor e o funil mostraria um número
// alto e invertido, que é o pior resultado possível: parece sucesso. Então
// exige-se DUAS coisas na mesma mensagem: um verbo de saída E uma marca de
// posse em primeira pessoa. "vocês vendem carta?" tem verbo e não tem posse.
// "quero vender minha cota" tem os dois.
// ============================================================================

/**
 * Quando o detector entrou em produção. É o divisor entre "avaliado e nada
 * bateu" e "nunca examinado".
 *
 * Sem esta data, uma conversa de julho com `tags = {}` seria lida como "não é
 * cedente" — mas ninguém nunca olhou para ela. O painel diria 0 de 45 quando o
 * verdadeiro é 0 de 3. Zero sobre uma base errada é o tipo de número que passa
 * despercebido justamente por ser plausível.
 */
export const DETECTOR_CEDENTE_DESDE = "2026-08-09";

/** A etiqueta canônica. Uma constante para não haver 'cedente' digitado em dois lugares. */
export const TAG_CEDENTE = "cedente";

/**
 * Tira acento e caixa. O cliente escreve "consórcio", "consorcio" e "CONSORCIO"
 * na mesma semana, e três grafias da mesma palavra não podem ser três regras.
 */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Verbos de desfazimento. Só entram formas que descrevem SAIR de uma cota.
 * "comprar", "adquirir", "simular" ficam de fora por definição — quem compra
 * não é cedente.
 */
const VERBOS_SAIDA = [
  "vender",
  "vende",
  "vendo",
  "venda",
  "ceder",
  "cedo",
  "transferir",
  "transfiro",
  "repassar",
  "repasso",
  "passar adiante",
  "desistir",
  "desisti",
  "sair do",
  "me livrar",
  "livrar de",
  "dar baixa",
  "abrir mao",
  "nao quero mais",
  "nao consigo mais pagar",
  "nao aguento mais pagar",
];

/**
 * Marcas de posse em primeira pessoa. É esta lista que separa vendedor de
 * comprador — o cedente fala do que é DELE.
 */
const POSSE_PRIMEIRA_PESSOA = [
  "minha cota",
  "minha carta",
  "minha carta de credito",
  "meu consorcio",
  "meu consórcio",
  "minha consorcio",
  "meu grupo",
  "minha parcela",
  "minhas parcelas",
  "meu plano",
  "minha contemplada",
  "meu contemplado",
  "minha cota contemplada",
  "cota que eu tenho",
  "carta que eu tenho",
  "consorcio que eu tenho",
  "que eu pago",
  "que eu tenho",
];

/**
 * Frases que dispensam a exigência dupla porque já são inequívocas sozinhas.
 * Cada uma aqui é uma que eu conseguiria defender em voz alta; na dúvida, a
 * frase NÃO entra e cai na regra dos dois sinais.
 */
const FRASES_INEQUIVOCAS = [
  "quero vender minha",
  "quero vender meu",
  "gostaria de vender minha",
  "gostaria de vender meu",
  "quero ceder minha",
  "quero ceder meu",
  "quero transferir minha",
  "quero transferir meu",
  "quero me desfazer",
  "quero sair do consorcio",
  "quero sair do grupo",
  "voces compram cota",
  "voces compram carta",
  "voces compram consorcio",
  "vcs compram cota",
  "vcs compram carta",
];

/**
 * Negações. "não quero vender minha cota" tem verbo e posse e é o CONTRÁRIO de
 * cedente.
 *
 * O casamento é por proximidade burra: se a negação aparece em qualquer ponto
 * da mensagem, a mensagem inteira é descartada. É deliberadamente conservador —
 * prefiro perder um cedente de verdade a etiquetar quem disse que não quer.
 * Errar para o lado de não marcar custa um lead; errar para o outro põe o
 * atendimento humano em cima de quem já disse não.
 */
const NEGACOES = [
  "nao quero vender",
  "nao vou vender",
  "nao pretendo vender",
  "nao estou vendendo",
  "nao quero ceder",
  "nao quero transferir",
  "nao tenho interesse em vender",
  "nao e para vender",
  "nao quero me desfazer",
];

/**
 * Diz se a mensagem do cliente traz vocabulário de quem quer se desfazer da
 * própria cota.
 *
 * Função PURA: recebe texto, devolve booleano. Toda a decisão testável está
 * aqui, e o webhook só decide o que fazer com a resposta.
 */
export function pareceCedente(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const t = normalizar(texto);
  if (t.trim().length < 4) return false;

  if (NEGACOES.some((n) => t.includes(normalizar(n)))) return false;
  if (FRASES_INEQUIVOCAS.some((f) => t.includes(normalizar(f)))) return true;

  const temVerbo = VERBOS_SAIDA.some((v) => t.includes(normalizar(v)));
  const temPosse = POSSE_PRIMEIRA_PESSOA.some((p) => t.includes(normalizar(p)));
  return temVerbo && temPosse;
}

/**
 * As etiquetas que esta mensagem justifica. Devolve lista, e não um booleano,
 * porque a próxima etiqueta (inadimplente, contemplado) entra aqui sem mudar a
 * assinatura nem o chamador.
 */
export function etiquetasDaMensagem(texto: string | null | undefined): string[] {
  return pareceCedente(texto) ? [TAG_CEDENTE] : [];
}
