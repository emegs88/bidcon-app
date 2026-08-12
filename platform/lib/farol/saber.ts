// ============================================================================
// lib/farol/saber.ts — a base de conhecimento da casa: sementes, privacidade e busca
// AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-SABER-01", 08/08/2026.
// ----------------------------------------------------------------------------
// TRÊS COISAS VIVEM AQUI, e elas estão juntas de propósito:
//   1) as SEMENTES — o conhecimento que a casa já tem, escrito;
//   2) `anonimizar()` — a regra dura de privacidade do FAQ VIVO;
//   3) `buscarSaber()` — a leitura, que NUNCA pode derrubar quem a chama.
//
// ---------------------------------------------------------------------------
// AS SEMENTES NÃO FORAM INVENTADAS. A OS foi explícita: "escritas a partir do
// que JÁ existe no repo/site sem inventar lei". Cada verbete abaixo tem
// `origem_no_repo` apontando o arquivo de onde o fato saiu. A maior parte veio
// de `public/llms.txt` — que é, literalmente, o arquivo que a casa escreveu
// para ser lido por LLM: já está no ar, já passou por revisão de compliance e
// já é a versão pública da verdade. Semear a partir dele não é reescrever a
// empresa; é vetorizar o que ela já diz.
//
// EU NÃO ESCREVI NENHUM NÚMERO DE LEI QUE O REPO NÃO TIVESSE. As duas normas
// citadas (Lei 8.935/94 art. 7º-A, incluído pela Lei 14.711/2023; Provimento
// CNJ 197/2025) estão em public/llms.txt e em public/conta-notarial.html. Não
// há nesta lista nenhuma norma que eu tenha buscado de memória.
//
// ---------------------------------------------------------------------------
// A PRIVACIDADE É CÓDIGO, NÃO PROMPT. O FAQ VIVO lê conversa de gente real.
// Um prompt dizendo "não guarde dados pessoais" é uma sugestão a um modelo
// estatístico; `anonimizar()` é uma função que roda sempre, no caminho único
// de escrita, e não tem como ser persuadida. A tabela também não tem coluna
// para telefone, nome ou conversa_id — o que não tem onde ser guardado não
// vaza. As duas travas são independentes de propósito.
//
// ---------------------------------------------------------------------------
// `buscarSaber()` DEVOLVE [] EM QUALQUER FALHA, E NUNCA LANÇA. Ela vai ser
// chamada de dentro do cérebro do WhatsApp, que atende cliente. Se a OpenAI
// estiver fora, se a RPC não existir ainda (a migração é aplicada à mão pelo
// Emerson, então vai haver uma janela em que o código está no ar e a tabela
// não), se a env faltar — o cliente tem que continuar sendo atendido
// exatamente como é hoje. Uma base de conhecimento é um LUXO em cima do
// atendimento; ela não pode virar um ponto único de falha dele.
// ============================================================================
import { gerarEmbedding, embeddingParaSQL } from "@/lib/ia";

export type FonteSaber =
  | "lei"
  | "abac"
  | "administradora"
  | "processo"
  | "faq"
  | "glossario"
  | "caso";

export type Semente = {
  fonte: FonteSaber;
  titulo: string;
  conteudo: string;
  tags: string[];
  /** Arquivo do repo de onde o fato saiu. Auditoria de origem, não é gravado. */
  origem_no_repo: string;
  /**
   * Declara que esta semente CITA o léxico proibido (investimento, rendimento,
   * lucro, CDI...) para ENSINAR a não usá-lo. Existe porque o teste que varre o
   * léxico precisa de uma isenção, e a primeira versão dele isentava a semente
   * pelo TÍTULO — uma string mágica que quebrou na segunda semente de
   * compliance escrita. A isenção passa a ser um campo do dado: quem escrever
   * uma semente nova com "rendimento" no meio tem que declarar aqui, de
   * propósito, em vez de descobrir por acaso que o teste deixou passar.
   * Não é gravado no banco.
   */
  ensina_lexico_proibido?: true;
};

/** Kill-switch da OS. Desarmado, o consumo cirúrgico não acontece. */
export function saberLigado(): boolean {
  return process.env.FAROL_SABER === "on";
}

// ----------------------------------------------------------------------------
// 1) SEMENTES
// ----------------------------------------------------------------------------
export const SEMENTES: Semente[] = [
  {
    fonte: "lei",
    titulo: "Conta Notarial: o que é e por que o dinheiro fica protegido",
    conteudo:
      "Na Bidcon o pagamento não vai para a conta da empresa nem para a do vendedor. " +
      "Vai para uma conta vinculada (escrow) no Banco Safra, atrelada exclusivamente àquele negócio: " +
      "é patrimônio segregado, impenhorável por dívidas alheias à operação, e não se mistura com o " +
      "dinheiro da Bidcon, do vendedor nem do cartório. Quem administra é o 5º Tabelionato de Notas de " +
      "Campinas, com fé pública e sem acesso ao valor. O cartório só libera o dinheiro ao vendedor depois " +
      "que a administradora aprova a transferência da cota; se a administradora não aprovar, o valor é " +
      "devolvido ao comprador. Base legal: art. 7º-A da Lei nº 8.935/1994 (incluído pela Lei nº 14.711/2023) e " +
      "Provimento CNJ 197/2025.",
    tags: ["conta notarial", "seguranca", "pagamento", "cartorio", "escrow"],
    origem_no_repo: "public/llms.txt · public/conta-notarial.html",
  },
  {
    fonte: "processo",
    titulo: "Como a entrada é paga",
    conteudo:
      "A entrada é paga exclusivamente por boleto da conta vinculada ao 5º Tabelionato de Notas de " +
      "Campinas — nunca por transferência para conta de pessoa física, nem para conta da Bidcon. " +
      "O saldo restante é quitado nas parcelas, conforme as regras da administradora do consórcio.",
    tags: ["entrada", "boleto", "pagamento", "processo"],
    origem_no_repo: "public/llms.txt (Observações de conformidade)",
  },
  {
    fonte: "glossario",
    titulo: "O que é uma carta de crédito já contemplada",
    conteudo:
      "É uma cota de consórcio que já foi contemplada, ou seja, que já teve o crédito liberado. " +
      "Quem assume essa cota passa a ter o poder de compra do valor da carta para adquirir o bem, e " +
      "continua pagando as parcelas restantes. A Bidcon intermedeia a compra e a venda dessas cotas e " +
      "organiza a documentação; a transferência de titularidade é sempre formalizada e validada junto à " +
      "administradora do consórcio.",
    tags: ["carta de credito", "contemplada", "glossario", "poder de compra"],
    origem_no_repo: "public/llms.txt · public/blog/como-funciona-carta-de-credito-do-consorcio.html",
  },
  {
    fonte: "processo",
    titulo: "Junção de cartas: quando dá para somar duas ou três",
    conteudo:
      "A junção soma os créditos de cotas contempladas para chegar ao valor do bem desejado. " +
      "Ela tem duas condições que não são negociáveis: as cartas precisam ser da MESMA administradora e " +
      "do MESMO tipo (contemplada com contemplada). A ferramenta monta combinações de 2 a 3 cartas cuja " +
      "soma de crédito chegue perto do valor desejado, com tolerância de cerca de 10%. É simulação de " +
      "referência e fica sujeita à análise e à aprovação da administradora — não é garantia de aprovação.",
    tags: ["juncao", "combinar cartas", "administradora", "processo"],
    origem_no_repo: "public/index.html · public/ferramentas/termo-reserva.html (checarJuncao)",
  },
  {
    fonte: "processo",
    titulo: "Repasse de consórcio (assunção de dívida): o que é e como difere da venda de carta",
    conteudo:
      "Repasse é a assunção de dívida de cotas de consórcio que JÁ tiveram o crédito utilizado — não é " +
      "venda de crédito, e por isso não se confunde com a compra de uma carta contemplada. Quem sai da " +
      "dívida deposita o valor combinado em Conta Notarial; quem assume as parcelas apresenta bem próprio " +
      "em garantia e recebe o líquido depois da anuência da administradora. Toda a operação fica sujeita a " +
      "essa anuência e não envolve nenhuma promessa de contemplação.",
    tags: ["repasse", "assuncao de divida", "diferenca", "processo"],
    origem_no_repo: "public/llms.txt · public/repasse.html",
  },
  {
    fonte: "processo",
    titulo: "Quero vender minha cota contemplada: como funciona",
    conteudo:
      "A Bidcon anuncia e intermedeia a venda de cotas de consórcio já contempladas, organizando a " +
      "documentação e a transferência junto à administradora. Para o vendedor, o ponto que mais importa é " +
      "o pagamento: ele passa por Conta Notarial em cartório, então o dinheiro só é liberado depois que a " +
      "administradora aprova a transferência — e, se ela não aprovar, volta para o comprador. " +
      "Corretores, vendedores de consórcio e imobiliárias também podem cadastrar cotas de clientes e " +
      "receber comissão de captação.",
    tags: ["vender", "cedente", "captacao", "processo", "conta notarial"],
    origem_no_repo:
      "public/llms.txt · public/vender-consorcio-contemplado.html · public/empresas.html",
  },
  {
    fonte: "glossario",
    titulo: "Como a Bidcon apresenta o custo mensal",
    conteudo:
      "Cada cota mostra crédito, entrada, parcela, prazo e o custo mensal estimado, para que dê para " +
      "comparar antes de decidir. O custo é sempre apresentado como taxa ao mês (% a.m.), calculada como " +
      "custo financeiro da operação. Consórcio é compra programada: o número descreve QUANTO CUSTA o " +
      "dinheiro, e nunca quanto alguém ganharia — não existe rendimento, retorno ou comparação com " +
      "aplicação financeira.",
    tags: ["custo", "ao mes", "transparencia", "glossario", "compliance"],
    origem_no_repo: "public/llms.txt (Diferenciais) · CLAUDE.md (léxico)",
    ensina_lexico_proibido: true,
  },
  {
    fonte: "lei",
    titulo: "O que a Bidcon NÃO é, e o que ela não pode prometer",
    conteudo:
      "A Bidcon (EGS Capital Participações Ltda, do Grupo Prospere) não é instituição financeira e não " +
      "aprova crédito. Consórcio é compra programada, não investimento. Os valores exibidos (crédito, " +
      "entrada, parcela, prazo, custo mensal) são estimativas e ficam sujeitos à análise e à transferência " +
      "pela administradora. Contemplação acontece por sorteio ou por lance: ninguém pode prometer, sugerir " +
      "ou estimar quando ela vai ocorrer.",
    tags: ["compliance", "limites", "regulatorio", "contemplacao"],
    origem_no_repo: "public/llms.txt (Observações de conformidade)",
    ensina_lexico_proibido: true,
  },
  {
    fonte: "glossario",
    titulo: "Palavras que a Bidcon não usa ao falar de consórcio",
    conteudo:
      "Consórcio não é produto financeiro de rentabilidade, e o vocabulário acompanha isso. Não se diz " +
      "investimento, investidor, rendimento, rentabilidade, lucro, CDI, retorno financeiro nem " +
      "'garantido'. Também não se diz desconto, aprovação de crédito nem limite de crédito. " +
      "As palavras corretas são: planejamento, compra programada, carta de crédito, poder de compra e " +
      "patrimônio.",
    tags: ["lexico", "compliance", "vocabulario", "glossario"],
    origem_no_repo: "lib/ia.ts (TERMOS_PROIBIDOS) · CLAUDE.md",
    ensina_lexico_proibido: true,
  },
  {
    fonte: "administradora",
    titulo: "Por que a administradora sempre aparece na conversa",
    conteudo:
      "A Bidcon é um marketplace independente: reúne cartas contempladas de administradoras diferentes " +
      "para dar comparação lado a lado, em vez de ficar preso a uma só. Por isso a administradora de cada " +
      "carta é sempre informada — ela define as regras da cota, é quem aprova a transferência de " +
      "titularidade e é o que determina se duas cartas podem ou não ser somadas numa junção.",
    tags: ["administradora", "marketplace", "transferencia"],
    origem_no_repo: "public/llms.txt (Diferenciais)",
  },
  {
    fonte: "processo",
    titulo: "O que a Bidcon atende: tipos de bem e praça",
    conteudo:
      "A intermediação cobre cotas contempladas de veículos (carro, moto, caminhão, utilitário) e de " +
      "imóveis (casa, apartamento, terreno, sala comercial — residencial e comercial). A atuação é em todo " +
      "o Brasil, com sede em São Paulo/SP. Há páginas específicas para lojistas de veículos e para " +
      "imobiliárias, que cruzam o estoque do parceiro com as cartas disponíveis.",
    tags: ["escopo", "imovel", "veiculo", "parceiros"],
    origem_no_repo: "public/llms.txt (Tipo de serviço · Páginas principais)",
  },
  {
    fonte: "caso",
    titulo: "A dúvida mais comum de quem vende: e se a administradora não aprovar?",
    conteudo:
      "É o medo central de quem tem uma cota para vender, e a resposta é o desenho da Conta Notarial. " +
      "O comprador deposita na conta vinculada do cartório, não na mão do vendedor nem na da Bidcon. " +
      "O cartório só libera o valor ao vendedor depois da aprovação da transferência pela administradora. " +
      "Se a administradora não aprovar, o valor é devolvido ao comprador e ninguém fica no prejuízo por " +
      "ter confiado antes da hora.",
    tags: ["cedente", "objecao", "seguranca", "conta notarial"],
    origem_no_repo: "public/llms.txt · public/conta-notarial.html · public/seguranca.html",
  },
];

// ----------------------------------------------------------------------------
// 2) PRIVACIDADE — a regra dura
// ----------------------------------------------------------------------------

/**
 * Remove dado pessoal de um texto ANTES de ele virar linha no banco.
 *
 * Ordem importa: e-mail antes de @ (senão o handle come o domínio), e dígitos
 * longos antes de telefone (senão um CPF sem formatação escaparia como número
 * qualquer). Cada troca deixa um marcador visível em vez de apagar em silêncio
 * — quem ler a linha depois precisa saber que ali havia um dado, e não que a
 * pessoa escreveu uma frase truncada.
 *
 * Isto NÃO é um anonimizador de uso geral e não tenta ser: ele cobre os
 * formatos que aparecem em conversa de WhatsApp brasileira. Um nome próprio
 * solto ("aqui é o Marcos") continua passando — por isso a segunda trava, a de
 * a tabela não ter coluna para identificar ninguém, é que fecha a conta.
 */
// ----------------------------------------------------------------------------
// A AMBIGUIDADE DOS 11 DÍGITOS — decidida, não escondida.
//
// `11987654321` (celular com DDD) e `12345678909` (CPF) são a MESMA FORMA:
// onze dígitos colados. Não existe regex que separe os dois, e a primeira
// versão desta função fingia que existia: como a linha do CPF vinha antes, todo
// celular digitado sem pontuação virava "[cpf]". A redação estava certa (nenhum
// dígito sobrevive nos dois casos), mas o RÓTULO era chute — e o rótulo aqui
// não é cosmético: ele entra no texto que o FAQ VIVO agrupa. O mesmo cliente
// escrevendo "(11) 98765-4321" e "11987654321" geraria dois grupos distintos,
// e a contagem de recorrência — que é o produto inteiro do FAQ VIVO — sairia
// diluída.
//
// A regra passa a ser: rótulo ESPECÍFICO só para forma inequívoca (pontuada,
// ou com comprimento que só um documento tem); forma ambígua vira "[numero]",
// que é neutro e, principalmente, ESTÁVEL. Perder a distinção cpf/telefone num
// texto que já foi anonimizado não custa nada; perder a estabilidade do
// agrupamento custa o recurso todo.
// ----------------------------------------------------------------------------
export function anonimizar(texto: string): string {
  return (
    texto
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
      // 1) Formas pontuadas — inequívocas, ganham rótulo próprio.
      .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, "[cnpj]")
      .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "[cpf]")
      // 2) Telefone só é telefone quando há separador VISÍVEL: parênteses no
      //    DDD, espaço depois do DDD, ou hífen antes dos quatro últimos. Sem
      //    separador nenhum, cai no caso ambíguo lá embaixo — de propósito.
      .replace(/\(\d{2}\)\s?9?\d{4}[-\s]?\d{4}\b/g, "[telefone]")
      .replace(/\b\d{2}\s9?\d{4}[-\s]?\d{4}\b/g, "[telefone]")
      .replace(/\b9?\d{4}-\d{4}\b/g, "[telefone]")
      // 3) Catorze dígitos colados só um CNPJ tem.
      .replace(/\b\d{14}\b/g, "[cnpj]")
      // 4) O caso ambíguo (10 ou 11 dígitos colados) e qualquer outra sequência
      //    longa: marcador neutro e estável.
      .replace(/\b\d{7,}\b/g, "[numero]")
      .replace(/@[A-Za-z0-9._]{2,}/g, "[perfil]")
      .replace(/https?:\/\/\S+/g, "[link]")
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}

/**
 * Quantas pessoas distintas precisam ter feito a pergunta para ela ser GRAVADA
 * no acervo como verbete de FAQ. Uma pergunta única não é um FAQ; é uma
 * conversa.
 *
 * Mora aqui, e não no route que a usa, por um motivo específico: existe um
 * SEGUNDO limiar, `MIN_OCORRENCIAS_PUBLICO` (em `lib/farol/responde.ts`), para
 * o ato diferente de PUBLICAR a mesma pergunta no Instagram. A relação entre os
 * dois — publicar exige mais que gravar — é a regra, e regra que vive em dois
 * arquivos que não se enxergam é regra que um dia deixa de valer sem ninguém
 * notar. Com os dois importáveis, a relação virou teste.
 *
 * Um route do Next não pode exportar constante avulsa (o type-check de rota
 * recusa export desconhecido), então o lugar é a lib.
 */
export const MIN_OCORRENCIAS_ACERVO = 2;

/**
 * O texto parece uma PERGUNTA de cliente?
 *
 * O FAQ VIVO não pode virar um depósito de "oi", "bom dia" e "obrigado". Duas
 * peneiras: sinal de interrogação OU início por palavra interrogativa. O piso
 * de 12 caracteres corta "?" solto e "como?" — que são pergunta na forma, mas
 * não têm assunto para agrupar.
 */
const INICIO_PERGUNTA =
  // `voc[eê]s?` e não `voces`: o teste pegou "vocês atendem imóvel comercial"
  // sendo DESCARTADA porque a lista só tinha a forma sem acento. Cliente de
  // WhatsApp digita com acento — o teclado do celular põe sozinho. Era a
  // pergunta mais comum do inbox caindo fora do FAQ VIVO por um circunflexo.
  /^(como|quanto|quando|onde|qual|quais|quem|por que|porque|pq|o que|oq|tem |voc[eê]s?|vcs?|da pra|dá pra|posso|preciso|serve|funciona|existe|precisa)/i;

export function ehPergunta(texto: string): boolean {
  const t = texto.trim();
  if (t.replace(/\s/g, "").length < 12) return false;
  return t.includes("?") || INICIO_PERGUNTA.test(t);
}

// ----------------------------------------------------------------------------
// 3) BUSCA
// ----------------------------------------------------------------------------

export type TrechoSaber = {
  id?: string;
  fonte: string;
  titulo: string;
  conteudo: string;
  score: number;
};

/**
 * O mínimo que `buscarSaber` precisa de um cliente Supabase.
 *
 * É `PromiseLike` e não `Promise` de propósito: `db.rpc()` do supabase-js
 * devolve um PostgrestFilterBuilder — um *thenable*, que se comporta como
 * promessa no `await` mas NÃO é uma instância de Promise. Declarar `Promise`
 * aqui faria o tsc recusar o cliente real no ponto de uso, e o conserto seria
 * um cast — que é justamente o que apagaria a checagem que este tipo existe
 * para fazer.
 */
export type DbComRpc = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

/** Cosseno entre dois vetores do MESMO modelo. Usado no agrupamento do FAQ. */
export function similaridade(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const den = Math.sqrt(na) * Math.sqrt(nb);
  return den === 0 ? 0 : dot / den;
}

/**
 * Trechos do conhecimento mais próximos de uma pergunta.
 *
 * NUNCA LANÇA e NUNCA loga o texto da pergunta (que pode ser de cliente).
 * Devolve [] em qualquer falha — ver o header sobre por que isso é regra e não
 * preguiça. `minScore` existe porque a RPC sempre devolve os N mais próximos,
 * mesmo que o mais próximo não tenha nada a ver: sem um piso, uma pergunta
 * sobre futebol traria o verbete da Conta Notarial com score 0,1 e o cérebro
 * receberia contexto ruidoso como se fosse resposta.
 */
export async function buscarSaber(
  db: DbComRpc,
  pergunta: string,
  opts: { limite?: number; fontes?: FonteSaber[]; minScore?: number } = {}
): Promise<TrechoSaber[]> {
  const { limite = 5, fontes, minScore = 0.25 } = opts;
  try {
    const vetor = await gerarEmbedding(pergunta);
    const { data, error } = await db.rpc("buscar_saber", {
      p_embedding: embeddingParaSQL(vetor),
      p_limite: limite,
      p_fontes: fontes ?? null,
    });
    if (error || !Array.isArray(data)) {
      if (error) console.warn("[farol-saber] busca falhou:", (error as { message?: string })?.message);
      return [];
    }
    return (data as TrechoSaber[]).filter((t) => Number(t.score) >= minScore);
  } catch (e) {
    console.warn("[farol-saber] busca indisponível:", (e as Error)?.message);
    return [];
  }
}

// ----------------------------------------------------------------------------
// 4) O BLOCO QUE VAI PARA O SYSTEM PROMPT
// ----------------------------------------------------------------------------

/**
 * Monta o trecho de contexto que o cérebro do WhatsApp anexa ao system prompt.
 * Devolve "" quando não há nada a dizer — e "" some no `if (bloco) system +=`
 * do chamador, que é por que o enxerto no cerebro.ts tem duas linhas e nenhum
 * tratamento de erro.
 *
 * O KILL-SWITCH MORA AQUI, NÃO NO CHAMADOR. Sem `FAROL_SABER=on` esta função
 * devolve "" ANTES de gastar um embedding. O desarmado fica literal: desligado,
 * não há chamada à OpenAI, não há latência a mais e o atendimento é byte a byte
 * o de hoje.
 *
 * AS INSTRUÇÕES DO BLOCO SÃO A PARTE QUE MAIS IMPORTA. Anexar cinco parágrafos
 * de conhecimento sem dizer o que fazer com eles produz um atendente que recita
 * documento. Cada regra abaixo existe por um risco concreto:
 *   1) "não é roteiro" — senão o modelo cola o verbete inteiro no WhatsApp;
 *   2) "não complete de cabeça" — o trecho é o LIMITE do que a casa afirma; o
 *      resto seria alucinação com aparência de documentação interna;
 *   3) "não mencione a base" — o cliente não precisa saber que existe um
 *      índice; ele precisa ser atendido.
 *
 * O `score` NUNCA entra no texto. Ele é parecença de vetor, não confiança
 * jurídica, e um modelo que lê "0.83" passa a hedgear ("acho que...") por causa
 * de um número que não significa o que ele supõe.
 */
export async function blocoSaber(
  db: DbComRpc,
  pergunta: string,
  opts: { limite?: number; fontes?: FonteSaber[] } = {}
): Promise<string> {
  if (!saberLigado()) return "";
  const texto = (pergunta ?? "").trim();
  if (texto.length < 8) return "";

  const trechos = await buscarSaber(db, texto, {
    limite: opts.limite ?? 4,
    fontes: opts.fontes,
  });
  if (trechos.length === 0) return "";

  const corpo = trechos.map((t) => `- (${t.fonte}) ${t.titulo}: ${t.conteudo}`).join("\n");

  return (
    "BASE DE CONHECIMENTO DA CASA (referência interna, não é roteiro):\n" +
    corpo +
    "\n\nComo usar: responda com as SUAS palavras, no tom da persona, usando só " +
    "o que estiver acima como fato da casa. Se a resposta não estiver acima, " +
    "diga que vai confirmar — não complete de cabeça. Não mencione que existe " +
    "uma base de conhecimento nem cite estes títulos."
  );
}

/** A última fala do cliente num histórico já carregado — é o que se pergunta à base. */
export function ultimaPerguntaDoCliente(
  hist: Array<{ papel?: string | null; conteudo?: string | null }> | null | undefined
): string {
  if (!Array.isArray(hist)) return "";
  for (let i = hist.length - 1; i >= 0; i--) {
    if (hist[i]?.papel === "cliente") return String(hist[i]?.conteudo ?? "").trim();
  }
  return "";
}
