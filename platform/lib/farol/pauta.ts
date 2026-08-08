// ============================================================================
// FAROL-ESCUTA-01 · o redator de pauta (busca de tendência + redação)
// AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-ESCUTA-01", 08/08/2026.
// ----------------------------------------------------------------------------
// O QUE ESTE ARQUIVO FAZ, EM UMA FRASE: pergunta ao modelo o que está em alta
// no vídeo curto financeiro brasileiro, com busca web de verdade ligada, e
// depois pede a ele que escreva roteiro e legenda ORIGINAIS para a fôrma do dia
// usando os números reais da carta. Não publica nada. Não baixa vídeo de
// ninguém. Não copia frase de terceiro.
//
// DUAS CHAMADAS, DE PROPÓSITO — E O PADRÃO É MEDIDO, NÃO INVENTADO.
// A 1ª vai COM a ferramenta de busca. A 2ª vai SEM ferramenta nenhuma. Isso
// copia o que o cérebro do Prosperito já faz em produção (lib/whatsapp/cerebro.ts:
// "omitimos `tools` do body pra forçar o modelo a fechar com texto"): com
// ferramenta na mesa o modelo pode terminar o turno pedindo mais uma busca, e
// aí a resposta final que a gente precisa parsear simplesmente não existe.
// Separar também deixa a auditoria honesta: as FONTES saem da chamada que
// buscou, e a REDAÇÃO sai de uma chamada que não tinha acesso a nada — o texto
// não pode ser cópia daquilo que ele não estava mais lendo.
//
// ------------------------------ DIVERGÊNCIAS MEDIDAS -----------------------
//
// (1) `ANTHROPIC_MODEL` NÃO EXISTE. A OS diz "o mesmo padrão do cérebro
//     (lib/whatsapp/cerebro.ts, ANTHROPIC_MODEL com default)". Medido: o
//     cérebro NÃO lê env nenhuma — ele tem "claude-fable-5" escrito à mão em
//     DOIS lugares (linhas 417 e 552), e o comentário dele (linhas 45-48) diz
//     explicitamente que a spec sugeria a env e que ela foi recusada em favor
//     do "valor comprovado em produção". Ou seja: o padrão que a OS descreve
//     não está lá.
//     O QUE FIZ: `process.env.ANTHROPIC_MODEL ?? "claude-fable-5"`. Atende a
//     letra da OS (env com default) e mantém como default exatamente o valor
//     que roda hoje — sem a env, o comportamento é idêntico ao do cérebro.
//
// (2) VERSÃO DA FERRAMENTA DE BUSCA. A doc atual oferece três:
//     `web_search_20250305` (básica), `web_search_20260209` e
//     `web_search_20260318`. As duas novas trazem "dynamic filtering" e, com
//     elas, `allowed_callers` passa a valer `["code_execution_20260120"]` POR
//     DEFAULT — a busca roda por dentro do code execution, e modelo que não
//     suporta chamada programática devolve 400 mandando setar
//     `allowed_callers: ["direct"]`.
//     O QUE FIZ: fiquei na `web_search_20250305`, que a própria OS nomeia
//     primeiro. Ela é direta por construção, não provisiona code execution e
//     não tem o 400 escondido. Filtragem dinâmica economiza token numa pesquisa
//     grande; a nossa é de 3 buscas por dia. Trocar depois é mudar uma string.
//
// (3) `pause_turn` — O MODO DE FALHA QUE A OS NÃO PREVIU. Com ferramenta de
//     servidor, a API pode encerrar o turno com `stop_reason: "pause_turn"` e
//     SEM o texto final. Quem não trata isso lê `content` vazio, conclui "o
//     modelo não respondeu" e cai no fallback — todo dia, silenciosamente, sem
//     nunca dar erro. A doc diz o remédio: reenviar a mensagem do assistente
//     intacta. É o que o laço abaixo faz, com teto de rodadas.
//
// (4) A CERCA DO LINTER TEM UMA REGRA QUE O PRÓPRIO MANUAL VIOLA. Medido em
//     `revisarLegenda()`: `if (t.includes("%") && !t.includes("% a.m."))` →
//     reprovado. O exemplo da fôrma F5 no manual FAROL-VIRAL está escrito
//     "custo de 0,49% ao mês" — que tem "%" e não tem "% a.m.", e seria
//     REPROVADO pela nossa própria trava. Não é bug do linter: é a casa
//     exigindo uma grafia única. Por isso o system prompt abaixo manda escrever
//     "% a.m." literalmente e proíbe "ao mês" por extenso depois de número.
//     Sem esse aviso, a fôrma F5 cairia no fallback um dia em cada oito.
//
// (5) HASHTAGS: 5 A 7. Fica declarado que a contradição segue aberta — o manual
//     de alcance fala em "3-5" e o `HASHTAGS_REEL` que roda hoje tem 7. Pedi a
//     faixa que contém o comportamento medido em produção em vez de mudar o
//     número por conta própria.
//
// ------------------------------ O QUE NÃO ESTÁ AQUI ------------------------
// Nenhuma trava de compliance. O linter é `revisarLegenda()` e ele roda na
// ROTA, sobre o resultado deste arquivo, do lado de fora. Colocar a cerca aqui
// dentro faria a cerca ser escrita pela mesma cabeça que escreve o texto — e a
// única razão de a trava ser determinística é justamente não depender do humor
// do modelo.
// ============================================================================

import type { CartaCarrossel } from "@/lib/carrossel-formato";
import type { Formula } from "@/lib/farol/formulas";

const URL_API = "https://api.anthropic.com/v1/messages";
const VERSAO_API = "2023-06-01";

/** Ver divergência (1) no header. */
const MODELO = process.env.ANTHROPIC_MODEL ?? "claude-fable-5";

/** Ver divergência (2) no header. */
const FERRAMENTA_BUSCA = "web_search_20250305";

/**
 * Teto de buscas por execução. A doc precifica: US$ 10 por 1.000 buscas. Três
 * por dia é ~US$ 0,01/mês em busca. O teto existe para que um prompt mal
 * escrito não vire vinte buscas sem ninguém perceber — quando estoura, a API
 * devolve `max_uses_exceeded` DENTRO de um 200, não um erro HTTP.
 */
const MAX_BUSCAS = 3;

/** Rodadas de continuação após `pause_turn`. Ver divergência (3). */
const MAX_RODADAS = 3;

const TIMEOUT_BUSCA_MS = 60_000;
const TIMEOUT_REDACAO_MS = 30_000;

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** O que guardamos em `farol_pauta.fontes`. Origem, não conteúdo. */
export type Fonte = {
  url: string;
  titulo: string | null;
  /** `page_age` da doc: quando a página foi atualizada. Útil para "isto é tendência mesmo?". */
  idade: string | null;
};

export type Angulos = {
  /** Os 3 ângulos em texto corrido, como o modelo devolveu. Vira insumo da 2ª chamada. */
  texto: string;
  fontes: Fonte[];
};

export type TextoPauta = {
  gancho: string;
  roteiro: string;
  legenda: string;
  hashtags: string[];
};

export type R<T> = ({ ok: true } & T) | { ok: false; erro: string };

// ---------------------------------------------------------------------------
// Chamada crua
// ---------------------------------------------------------------------------

type BlocoQualquer = Record<string, unknown>;

async function chamar(
  corpo: Record<string, unknown>,
  timeoutMs: number
): Promise<R<{ data: { content?: BlocoQualquer[]; stop_reason?: string } }>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, erro: "env_ausente(ANTHROPIC_API_KEY)" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(URL_API, {
      method: "POST",
      headers: {
        // A chave vai no header e SÓ no header. Nada do que sai deste arquivo
        // para log ou para o banco carrega credencial — mesma regra dos
        // callbacks de OAuth.
        "x-api-key": apiKey,
        "anthropic-version": VERSAO_API,
        "content-type": "application/json",
      },
      body: JSON.stringify(corpo),
      signal: controller.signal,
    });

    if (!resp.ok) {
      // O corpo de erro da Anthropic não contém a chave; ainda assim é cortado,
      // porque log de cron é lido por muita gente e HTML de proxy é ruído.
      const bruto = await resp.text().catch(() => "");
      return { ok: false, erro: `http_${resp.status}: ${bruto.slice(0, 300)}` };
    }
    return { ok: true, data: await resp.json() };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, erro: msg === "The operation was aborted." ? "timeout" : msg };
  } finally {
    clearTimeout(timer);
  }
}

/** Junta os blocos `text` de uma resposta. Ignora tool_use e resultados. */
function textoDe(content: BlocoQualquer[] | undefined): string {
  let out = "";
  for (const b of content ?? []) {
    if (b?.type === "text" && typeof b.text === "string") out += b.text;
  }
  return out.trim();
}

/**
 * Extrai as fontes dos blocos `web_search_tool_result`.
 *
 * MEDIDO na doc: em sucesso, `content` é uma LISTA de `web_search_result`
 * (url/title/page_age/encrypted_content). Em erro, `content` é um OBJETO
 * `web_search_tool_result_error` com `error_code` — e a resposta HTTP continua
 * sendo 200. Tratar os dois com o mesmo `Array.isArray` é o que evita explodir
 * quando o rate limit bate.
 */
function fontesDe(content: BlocoQualquer[] | undefined): { fontes: Fonte[]; erroBusca: string | null } {
  const fontes: Fonte[] = [];
  let erroBusca: string | null = null;

  for (const b of content ?? []) {
    if (b?.type !== "web_search_tool_result") continue;
    const c = b.content;

    if (!Array.isArray(c)) {
      const cod = (c as BlocoQualquer | null)?.error_code;
      if (typeof cod === "string") erroBusca = cod;
      continue;
    }
    for (const r of c as BlocoQualquer[]) {
      if (r?.type !== "web_search_result" || typeof r.url !== "string") continue;
      fontes.push({
        url: r.url,
        titulo: typeof r.title === "string" ? r.title : null,
        idade: typeof r.page_age === "string" ? r.page_age : null,
      });
    }
  }
  return { fontes, erroBusca };
}

// ---------------------------------------------------------------------------
// 1ª chamada — a escuta
// ---------------------------------------------------------------------------

const SYSTEM_ESCUTA = [
  "Você é um pesquisador de tendências de conteúdo curto, não um redator.",
  "Sua tarefa é observar o que está em alta AGORA e devolver ESTRUTURA.",
  "",
  "REGRA ABSOLUTA: nunca reproduza texto, legenda, roteiro ou frase de outro",
  "criador. Nem entre aspas, nem parafraseado de perto. Você descreve o",
  "PADRÃO (que tipo de gancho, que ângulo, que formato, que tema), nunca o",
  "conteúdo literal. Se um resultado de busca trouxer o texto de um vídeo,",
  "você extrai a mecânica dele e descarta as palavras.",
].join("\n");

/**
 * Pergunta o que está em alta e devolve 3 ângulos + as fontes lidas.
 *
 * O LAÇO DE `pause_turn`: a doc manda reenviar a mensagem do assistente
 * INTACTA (os blocos exatamente como vieram, incluindo `encrypted_content` —
 * mexer neles dá 400 de validação). Por isso empilhamos `data.content` cru em
 * `messages`, sem tocar em nada.
 */
export async function ouvirTendencias(): Promise<R<Angulos>> {
  const mensagens: Array<{ role: string; content: unknown }> = [
    {
      role: "user",
      content: [
        "Pesquise o que está em alta AGORA em conteúdo financeiro brasileiro de",
        "vídeo curto (Reels/Shorts/TikTok) nos temas: consórcio, carta",
        "contemplada, financiamento imobiliário, sair do aluguel, comprar imóvel",
        "ou carro.",
        "",
        "Devolva exatamente 3 ÂNGULOS/GANCHOS em tendência. Para cada um:",
        "- o padrão de gancho (que tipo de abertura prende nos 2 primeiros segundos)",
        "- o ângulo (que dor ou curiosidade ele ataca)",
        "- o formato (duração, ritmo, se tem texto na tela)",
        "",
        "Só a ESTRUTURA e o TEMA. Nenhuma frase copiada de ninguém.",
        "Responda em português do Brasil, em texto corrido curto.",
      ].join("\n"),
    },
  ];

  const fontes: Fonte[] = [];
  let erroBuscaFinal: string | null = null;

  for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
    const r = await chamar(
      {
        model: MODELO,
        max_tokens: 2048,
        system: SYSTEM_ESCUTA,
        messages: mensagens,
        tools: [
          {
            type: FERRAMENTA_BUSCA,
            name: "web_search",
            max_uses: MAX_BUSCAS,
            // Localiza a busca no Brasil. Sem isto, "consórcio" traz resultado
            // de Portugal e o timezone muda o que a busca considera "hoje".
            user_location: {
              type: "approximate",
              country: "BR",
              timezone: "America/Sao_Paulo",
            },
          },
        ],
      },
      TIMEOUT_BUSCA_MS
    );
    if (!r.ok) return r;

    const colhido = fontesDe(r.data.content);
    fontes.push(...colhido.fontes);
    if (colhido.erroBusca) erroBuscaFinal = colhido.erroBusca;

    if (r.data.stop_reason === "pause_turn") {
      // Devolve o turno pausado sem alterar um byte e continua. Ver header (3).
      mensagens.push({ role: "assistant", content: r.data.content ?? [] });
      continue;
    }

    const texto = textoDe(r.data.content);
    if (!texto) {
      return {
        ok: false,
        erro: erroBuscaFinal ? `busca_sem_texto(${erroBuscaFinal})` : "busca_sem_texto",
      };
    }
    return { ok: true, texto, fontes };
  }

  return { ok: false, erro: `pause_turn_sem_fim(${MAX_RODADAS} rodadas)` };
}

// ---------------------------------------------------------------------------
// 2ª chamada — a redação
// ---------------------------------------------------------------------------

/**
 * As regras da casa, escritas para o modelo.
 *
 * ISTO NÃO SUBSTITUI O LINTER. É o cinto; `revisarLegenda()` é o airbag. O
 * modelo obedece quase sempre — e o "quase" é exatamente o que a trava
 * determinística existe para pegar.
 */
function systemRedacao(f: Formula): string {
  return [
    "Você escreve roteiro falado e legenda para o perfil da Bidcon, uma casa que",
    "intermedia CARTAS DE CRÉDITO DE CONSÓRCIO contempladas. Português do Brasil.",
    "",
    "LÉXICO OBRIGATÓRIO: planejamento, compra programada, carta de crédito,",
    "poder de compra, patrimônio.",
    "",
    "PALAVRAS TERMINANTEMENTE PROIBIDAS (o texto é rejeitado automaticamente se",
    "qualquer uma aparecer, em qualquer flexão ou contexto):",
    "investimento, investidor, rendimento, lucro, CDI, risco zero, 100% seguro,",
    "garantido, garantida. Consórcio NÃO é produto de rentabilidade.",
    "",
    "NUNCA prometa nem sugira contemplação futura: nada de 'será contemplado',",
    "'vai ser contemplada', 'contemplação garantida', 'contemplado em X meses'.",
    "Falar que a carta JÁ FOI contemplada é fato e é permitido.",
    "",
    "CUSTO: escreva SEMPRE na forma exata '0,49% a.m.' — com o literal '% a.m.'.",
    "NUNCA escreva 'ao mês' por extenso depois de um número, nem '% ao ano', nem",
    "'% de juros'. Qualquer '%' que não venha seguido de ' a.m.' reprova o texto.",
    "Se for citar percentual, só o custo da carta, e só nessa grafia.",
    "",
    "CONTA NOTARIAL, quando citada, sai na descrição canônica: o pagamento vai",
    "para conta vinculada em cartório e só é liberado ao vendedor depois da",
    "aprovação da administradora. Nunca prometa 'risco zero'.",
    "",
    "FORMATO DO VÍDEO:",
    `- fôrma do dia: ${f.id} — ${f.nome} (${f.objetivo})`,
    `- duração alvo: até ${f.duracao_alvo} segundos de fala, nunca mais que 35`,
    `- gancho: ${f.instrucao_gancho}`,
    `- esqueleto: ${f.esqueleto}`,
    "",
    "O PRIMEIRO FRAME É NÚMERO OU PERGUNTA. Jamais comece com saudação,",
    "apresentação, nome da marca ou 'oi'. Isso é botão de pular.",
    "Comece-meio-fim: gancho → desenvolvimento → CTA claro.",
    "",
    "Use SOMENTE os números reais da carta que eu passar. Não invente valor,",
    "não arredonde, não estime, não compare com número que você não recebeu.",
    "",
    "RESPONDA APENAS COM JSON VÁLIDO, sem cercas de código, neste formato:",
    '{"gancho":"...","roteiro":"...","legenda":"...","hashtags":["#a","#b"]}',
    "- gancho: a primeira frase do vídeo, isolada (ela também vai no texto da tela)",
    "- roteiro: o texto falado inteiro, incluindo o gancho, em uma linha",
    "- legenda: o texto escrito do post, sem as hashtags",
    "- hashtags: de 5 a 7, com #, começando pelas do tema e terminando em #bidcon",
  ].join("\n");
}

function numeros(c: CartaCarrossel): string {
  const l = [
    `tipo: ${c.tipoLabel}`,
    `administradora: ${c.administradora || "(não informada)"}`,
    `crédito: R$ ${c.credito.toLocaleString("pt-BR")}`,
  ];
  if (c.entrada > 0) l.push(`entrada: R$ ${c.entrada.toLocaleString("pt-BR")}`);
  if (c.parcelas > 0 && c.parcela > 0) {
    l.push(`parcelas: ${c.parcelas}x de R$ ${c.parcela.toLocaleString("pt-BR")}`);
  }
  // Duas casas e vírgula — a MESMA grafia que `pctAoMes` produz no card. O
  // modelo copia o que recebe; entregar "0.49" faria sair ponto no vídeo.
  l.push(
    c.custoAm === null
      ? "custo: não exibível (não cite percentual nenhum)"
      : `custo: ${c.custoAm.toFixed(2).replace(".", ",")}% a.m.`
  );
  l.push(`exclusiva da casa: ${c.exclusiva ? "sim" : "não"}`);
  return l.join("\n");
}

/**
 * Tira cercas de markdown e sobras em volta do JSON.
 *
 * O system pede JSON puro e o modelo quase sempre entrega. "Quase" de novo: o
 * recorte entre a primeira `{` e a última `}` custa nada e transforma o modo de
 * falha mais comum (uma frase de cortesia antes do objeto) em não-evento.
 */
function recortarJson(bruto: string): string {
  const s = bruto.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const i = s.indexOf("{");
  const j = s.lastIndexOf("}");
  return i >= 0 && j > i ? s.slice(i, j + 1) : s;
}

export async function escreverPauta(
  carta: CartaCarrossel,
  formula: Formula,
  angulos: string
): Promise<R<TextoPauta>> {
  const r = await chamar(
    {
      model: MODELO,
      max_tokens: 1500,
      system: systemRedacao(formula),
      // SEM `tools` — ver o header. É o que força o turno a fechar em texto.
      messages: [
        {
          role: "user",
          content: [
            "O que está em alta agora (use só como referência de ESTRUTURA — não",
            "copie nenhuma frase daqui):",
            angulos,
            "",
            "A carta de hoje (use estes números e nenhum outro):",
            numeros(carta),
            "",
            `Escreva a pauta na fôrma ${formula.id}. Responda só o JSON.`,
          ].join("\n"),
        },
      ],
    },
    TIMEOUT_REDACAO_MS
  );
  if (!r.ok) return r;

  const bruto = textoDe(r.data.content);
  if (!bruto) return { ok: false, erro: "redacao_sem_texto" };

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(recortarJson(bruto));
  } catch {
    return { ok: false, erro: "json_invalido" };
  }

  const gancho = typeof obj.gancho === "string" ? obj.gancho.trim() : "";
  const roteiro = typeof obj.roteiro === "string" ? obj.roteiro.trim() : "";
  const legenda = typeof obj.legenda === "string" ? obj.legenda.trim() : "";
  const hashtags = Array.isArray(obj.hashtags)
    ? obj.hashtags.filter((h): h is string => typeof h === "string" && h.startsWith("#"))
    : [];

  // Campo vazio não é "pauta fraca", é pauta quebrada: o reel-render mandaria
  // uma string vazia para o HeyGen e pagaria por um vídeo mudo.
  if (!roteiro || !legenda) return { ok: false, erro: "campos_vazios" };

  return { ok: true, gancho, roteiro, legenda, hashtags };
}
