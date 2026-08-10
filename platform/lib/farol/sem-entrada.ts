// ============================================================================
// sem-entrada.ts — detector de "não tenho a entrada" (PROSPERITO-SEM-ENTRADA-01)
// ----------------------------------------------------------------------------
//
// A ORIGEM DISTO É UMA CONVERSA REAL QUE MORREU. O cliente disse que não tinha
// a entrada. O Prosperito respondeu a verdade — para uma carta CONTEMPLADA a
// entrada é indispensável — e parou ali. A resposta estava CERTA. O defeito não
// foi mentir, foi terminar a frase. Existe um segundo caminho honesto (começar
// um consórcio novo, sem entrada, pagando só a parcela) e ninguém o ofereceu.
//
// Então este detector não serve para corrigir uma mentira. Serve para achar o
// momento exato em que a conversa vai morrer por falta de continuação.
//
// ----------------------------------------------------------------------------
// POR QUE OS GATILHOS SÃO EXPRESSÃO REGULAR, E NÃO `includes` COMO NO CEDENTE
// ----------------------------------------------------------------------------
// O cedente.ts casa por substring porque lá as duas polaridades usam palavras
// DIFERENTES ("quero vender" vs "vocês vendem"). Aqui não: a frase que dispara
// e a frase que não pode disparar são quase a mesma cadeia de letras.
//
//     "não tenho entrada"   → dispara
//     "tenho a entrada"     → NÃO pode disparar
//
// A segunda está contida na primeira a menos de duas letras. Um `includes`
// ingênuo de "tenho" incendeia tudo, e um `includes` de "nao tenho entrada"
// perde "não tenho A entrada", que é como metade das pessoas escreve. Regex com
// artigo opcional resolve as duas coisas de uma vez.
//
// ----------------------------------------------------------------------------
// E POR QUE NÃO EXISTE LISTA DE NEGAÇÕES AQUI
// ----------------------------------------------------------------------------
// No cedente.ts a negação VETA: "não quero vender minha cota" tem verbo e posse
// e significa o oposto. Aqui a polaridade está invertida — o gatilho JÁ É uma
// negação. Uma lista de vetos por cima disso desarmaria o próprio detector.
//
// A proteção está na precisão de cada padrão, não numa lista de exceções. É por
// isso que o teste anda pelos dois lados: sem os casos negativos, este arquivo
// não tem como provar que não está marcando todo mundo.
//
// ----------------------------------------------------------------------------
// O QUE ELE NÃO É
// ----------------------------------------------------------------------------
// Casamento de padrão. Não chama modelo, não entende contexto, erra nos dois
// sentidos. A etiqueta é PISTA, nunca fato — igual ao cedente, e pelo mesmo
// motivo: quem lê o painel precisa saber que foi uma máquina burra que marcou.
// ============================================================================

/**
 * Quando o detector entrou em produção. Mesma função da constante irmã em
 * cedente.ts: separar "avaliado e nada bateu" de "nunca examinado".
 *
 * Sem esta data, toda conversa anterior a hoje contaria como "não é sem
 * entrada" — e o painel mostraria um zero sobre uma base que ninguém olhou.
 */
export const DETECTOR_SEM_ENTRADA_DESDE = "2026-08-10";

/** A etiqueta canônica. Uma constante para não existir a string solta em dois lugares. */
export const TAG_CONSORCIO_NOVO = "consorcio_novo";

/**
 * Tira acento e caixa, e achata espaço repetido. O cliente escreve "não",
 * "nao" e "NÃO" na mesma semana; e escreve "não  tenho" com dois espaços
 * quando apaga e redigita. Três grafias da mesma frase não podem ser três
 * regras.
 */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Os gatilhos, em cinco famílias. Cada uma nasceu de uma forma diferente de
 * dizer a mesma coisa, e estão separadas para que o relatório consiga dizer
 * QUAL delas pegou — um gatilho que dispara demais precisa ser identificável
 * sem ler o arquivo inteiro.
 *
 * `(?:a |o |essa |esse |uma )?` é o artigo opcional. É ele que faz "não tenho
 * entrada" e "não tenho A entrada" serem um padrão só em vez de dois.
 */
const GATILHOS: ReadonlyArray<{ nome: string; padrao: RegExp }> = [
  {
    // "não tenho entrada", "não tenho a entrada", "não tenho essa entrada"
    nome: "nao-tenho-entrada",
    padrao: /\bnao tenho (?:a |o |essa |esse |uma )?entrada\b/,
  },
  {
    // "sem entrada", "consórcio sem entrada", "tem sem entrada?"
    // Dispara de propósito em quem PERGUNTA por sem entrada: a dúvida é a
    // mesma, e a resposta honesta serve igual.
    nome: "sem-entrada",
    padrao: /\bsem (?:a |uma )?entrada\b/,
  },
  {
    // "não tenho esse valor", "não tenho todo esse dinheiro", "não tenho tanto"
    nome: "nao-tenho-o-valor",
    padrao:
      /\bnao tenho (?:esse |este |essa |tanto |todo esse |todo este |o |esse tanto de )?(?:valor|dinheiro|montante|tudo isso|tanto)\b/,
  },
  {
    // "só consigo a parcela", "só consigo pagar a parcela", "só dá a parcela"
    nome: "so-a-parcela",
    padrao: /\b(?:so|somente|apenas) (?:consigo|posso|da|daria|tenho como) (?:pagar )?(?:a |as )?parcela/,
  },
  {
    // "dá pra parcelar a entrada?", "parcela a entrada?"
    // Quem pede para parcelar a entrada está dizendo, por outra via, que não a
    // tem inteira. É a mesma porta.
    nome: "parcelar-entrada",
    padrao: /\bparcel(?:ar|a|o) (?:a |essa |uma )?entrada\b/,
  },
  {
    // "não tenho como dar entrada", "não posso dar entrada", "não consigo dar
    // a entrada", "sem condição de dar entrada"
    nome: "nao-consigo-dar-entrada",
    padrao:
      /\b(?:nao tenho como|nao posso|nao consigo|nao da pra|nao tenho condicao de|sem condicao de|sem condicoes de) (?:dar|pagar|fazer) (?:a |uma |essa )?entrada\b/,
  },
];

/**
 * Diz se a mensagem do cliente é o momento do pivô — quando ele revela que a
 * entrada é o obstáculo.
 *
 * Função PURA: recebe texto, devolve booleano. Toda a decisão testável mora
 * aqui; o webhook só decide o que fazer com a resposta.
 */
export function pareceSemEntrada(texto: string | null | undefined): boolean {
  return Boolean(gatilhoSemEntrada(texto));
}

/**
 * A mesma decisão, mas dizendo QUAL família disparou — ou `null`.
 *
 * Existe separada de `pareceSemEntrada` por causa do relatório e da aferição:
 * quando um gatilho começar a marcar gente demais, é preciso saber qual, sem
 * reexecutar o detector inteiro na mão. O nome vai para o `detalhe` da
 * mensagem, não para a tela do cliente.
 */
export function gatilhoSemEntrada(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const t = normalizar(texto);
  // Abaixo de 4 caracteres não existe frase; existe ruído ("ok", "sim").
  if (t.length < 4) return null;

  for (const { nome, padrao } of GATILHOS) {
    if (padrao.test(t)) return nome;
  }
  return null;
}

/**
 * As etiquetas que esta mensagem justifica. Devolve lista, e não booleano,
 * pela mesma razão de `etiquetasDaMensagem` no cedente.ts: a próxima etiqueta
 * entra aqui sem mudar assinatura nem chamador.
 */
export function etiquetasSemEntrada(texto: string | null | undefined): string[] {
  return pareceSemEntrada(texto) ? [TAG_CONSORCIO_NOVO] : [];
}
