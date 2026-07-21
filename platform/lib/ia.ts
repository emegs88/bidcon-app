// ============================================================================
// Camada de IA da Bidcon (Nível 3 — busca por linguagem natural). SERVIDOR-ONLY.
// ----------------------------------------------------------------------------
// Importar este arquivo de um Client Component quebra o build de propósito (não
// há "use client" e ele lê OPENAI_API_KEY). Mantê-lo só em rotas/handlers e em
// scripts server-side (backfill).
//
// Provedor: OpenAI via fetch puro (zero dependência nova). Modelos:
//   - text-embedding-3-small (1536-d): vetoriza desejo do cliente e descrição da
//     carta. Barato e é o padrão de-facto do ecossistema pgvector.
//   - gpt-4o-mini: extrai filtros duros do texto e redige a frase de encaixe.
//
// COMPLIANCE (inviolável): nenhuma saída pode prometer/sugerir contemplação ou
//   prazo, nem usar "investimento/investidor/rendimento/garantido" (salvo
//   negação), "desconto", "aprovação/limite de crédito". `sanitizarCompliance`
//   é a última barreira: filtra qualquer frase gerada antes de devolvê-la.
//   A chave NUNCA vai ao client, repo ou log.
// ============================================================================

const OPENAI_URL = "https://api.openai.com/v1";
const MODELO_EMBEDDING = "text-embedding-3-small";
const MODELO_CHAT = "gpt-4o-mini";

export const EMBEDDING_DIMENSOES = 1536;

// Lê a chave só quando precisa (não no import) — evita explodir o build/SSG.
function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("Falta OPENAI_API_KEY (env de servidor) para a busca por IA.");
  }
  return key;
}

// fetch com timeout — uma chamada de IA travada nunca pode pendurar a rota.
async function postOpenAI(
  caminho: string,
  corpo: unknown,
  timeoutMs = 12_000
): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(`${OPENAI_URL}${caminho}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey()}`,
      },
      body: JSON.stringify(corpo),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      // Não vaza corpo de erro (pode conter detalhe da conta) — só status.
      throw new Error(`OpenAI ${caminho} respondeu ${resp.status}`);
    }
    return (await resp.json()) as unknown;
  } finally {
    clearTimeout(t);
  }
}

// ----------------------------------------------------------------------------
// COMPLIANCE — barreira reforçada (última linha de defesa de TODA saída de IA).
// Pensada para envolver não só a fraseDeEncaixe (Nível 3) mas QUALQUER resposta
// futura do agente (Níveis 4/5). Duas frentes independentes:
//   (A) violaTermo — lista de termos proibidos (régua regulatória + SIGILO de
//       mecânica interna). Casa em limite de palavra, sem acento, case-insensitive,
//       e LIBERA a forma negada ("não é investimento") por ser institucional.
//   (B) prometeDataContemplacao — detecta o PADRÃO "contemplação + tempo" (data,
//       mês, prazo) que a lista de termos não pega. Contemplação é por SORTEIO ou
//       LANCE: prometer quando ela acontece é a violação mais grave do projeto.
// ----------------------------------------------------------------------------

// (A) Termos proibidos. Inclui mecânica interna (CCB/FIDC/funding/custo de
//     aquisição etc.) que NUNCA pode chegar ao cliente — é sigilo de estrutura.
const TERMOS_PROIBIDOS = [
  // régua regulatória de consórcio
  "investimento",
  "investidor",
  "rendimento",
  "garantido",
  "garantida",
  "desconto",
  "aprovacao de credito",
  "aprovação de crédito",
  "limite de credito",
  "limite de crédito",
  "contemplacao garantida",
  "contemplação garantida",
  // mecânica interna (sigilo) — nunca verbalizar ao cliente
  "ccb",
  "fidc",
  "funding",
  "custo de aquisicao",
  "custo de aquisição",
  "custo de capital",
  "cedula de credito bancario",
  "cédula de crédito bancário",
  "estrutura de aquisicao",
  "estrutura de aquisição",
  // FATIA 1 (venda nova) — o COMPLIANCE de _prompt.ts já promete bloquear
  // estes termos; a régua real (esta lista) não os continha. Consórcio não
  // é aplicação financeira: nunca prometer retorno/rentabilidade.
  "retorno",
  "cdi",
  "lucro",
];

const NEGACOES = ["nao ", "não ", "sem ", "nunca "];

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// (A) true se há termo proibido em LIMITE DE PALAVRA e NÃO negado.
//     A fronteira de palavra evita que siglas curtas (ccb/fidc) casem dentro de
//     outra palavra (ex.: "fundinG" em "profundamente" não dispara).
function violaTermo(base: string): boolean {
  return TERMOS_PROIBIDOS.some((termoRaw) => {
    const termo = semAcento(termoRaw.toLowerCase());
    let idx = base.indexOf(termo);
    while (idx !== -1) {
      const ant = base[idx - 1] ?? " ";
      const dep = base[idx + termo.length] ?? " ";
      const fronteira = /[^a-z0-9]/.test(ant) && /[^a-z0-9]/.test(dep);
      if (fronteira) {
        const antes = base.slice(Math.max(0, idx - 8), idx);
        const negado = NEGACOES.some((n) => antes.includes(semAcento(n)));
        if (!negado) return true; // ocorrência não-negada em fronteira → viola
      }
      idx = base.indexOf(termo, idx + termo.length);
    }
    return false;
  });
}

// (B) Promessa de DATA/PRAZO de contemplação. Estratégia: achar uma ÂNCORA de
//     contemplação e checar se há um token TEMPORAL numa janela curta DEPOIS dela
//     ("contemplado EM março"). Exigir a âncora controla o falso-positivo: um
//     calendário factual de OUTRO sujeito (assembleia/parcela/sorteio em tal data)
//     não tem âncora de contemplação na janela e, portanto, não dispara.
const CONTEMPLA_ANCORAS = [
  "contempl", // contemplado/contemplada/contempla/contemplação/contemplar
  "ser contempl",
  "vai ser contempl",
  "sera contempl",
  "saida da carta", // gíria "quando a carta sai"
];

const TEMPORAIS = [
  // meses
  "janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto",
  "setembro", "outubro", "novembro", "dezembro",
  // relativos
  "ano que vem", "mes que vem", "semana que vem", "proximo mes", "proximos meses",
  "ate dezembro", "ate o fim do ano", "no fim do ano", "ainda este ano", "este ano",
  // prazos por extenso
  "dias", "dia ", "semanas", "meses", "mes ", "ano ", "anos",
  // ordinais usados como prazo de contemplação
  "1o mes", "2o mes", "3o mes", "primeiro mes", "segundo mes", "terceiro mes",
];

// Negações que LIBERAM a promessa ("não há data", "sem prazo de contemplação").
const NEGA_PROMESSA = [
  "nao prom", "sem prom", "nunca prom", "nao garant", "sem garant",
  "nao prevemos", "nao ha data", "sem data", "nao tem data",
];

const JANELA_CONTEMPLA = 40; // caracteres após a âncora de contemplação

function temTemporalNaJanela(janela: string): boolean {
  if (/\b(19|20)\d{2}\b/.test(janela)) return true; // ano com 4 dígitos
  // "90 dias", "3 meses", "1 ano" colados à contemplação
  if (/\b\d{1,3}\s*(dias|dia|semanas|semana|meses|mes|anos|ano)\b/.test(janela)) {
    return true;
  }
  return TEMPORAIS.some((t) => janela.includes(semAcento(t)));
}

function prometeDataContemplacao(base: string): boolean {
  for (const ancoraRaw of CONTEMPLA_ANCORAS) {
    const ancora = semAcento(ancoraRaw);
    let idx = base.indexOf(ancora);
    while (idx !== -1) {
      const janela = base.slice(idx, idx + ancora.length + JANELA_CONTEMPLA);
      const antes = base.slice(Math.max(0, idx - 16), idx);
      const negado = NEGA_PROMESSA.some(
        (n) => antes.includes(semAcento(n)) || janela.includes(semAcento(n))
      );
      if (!negado && temTemporalNaJanela(janela)) return true;
      idx = base.indexOf(ancora, idx + ancora.length);
    }
  }
  return false;
}

// true se o texto viola compliance por QUALQUER frente (termo OU promessa de data).
export function violaCompliance(texto: string): boolean {
  const base = semAcento(texto.toLowerCase());
  return violaTermo(base) || prometeDataContemplacao(base);
}

// Última barreira de saída. Devolve a frase só se passar em TODAS as frentes de
// compliance; senão, um fallback neutro seguro. Use isto para envolver QUALQUER
// texto gerado por IA antes de exibir/transmitir ao cliente (Níveis 3/4/5+).
//
// Observabilidade: quando esta função troca a resposta do modelo pelo fallback,
// ela é a ÚLTIMA barreira antes do cliente — se não logar, a troca é invisível
// (nenhuma exceção, nenhum erro de runtime; só um fallback genérico saindo no
// lugar de uma resposta correta). Por isso todo disparo loga QUAL frente pegou
// (termo proibido / promessa de data) + um trecho da frase engolida, sem mudar
// o valor devolvido em nenhum caso.
export function sanitizarCompliance(frase: string, fallback: string): string {
  const limpa = frase.trim();
  if (!limpa) return fallback;
  const base = semAcento(limpa.toLowerCase());
  if (violaTermo(base)) {
    console.warn(
      `[sanitizarCompliance] termo proibido — trecho engolido: ${limpa.slice(0, 120)}`
    );
    return fallback;
  }
  if (prometeDataContemplacao(base)) {
    console.warn(
      `[sanitizarCompliance] promessa de data de contemplação — trecho engolido: ${limpa.slice(0, 120)}`
    );
    return fallback;
  }
  return limpa;
}

// ----------------------------------------------------------------------------
// 1) gerarEmbedding — vetoriza um texto (desejo do cliente OU descrição da carta).
//    Usado tanto na rota de busca quanto no backfill.
// ----------------------------------------------------------------------------
export async function gerarEmbedding(texto: string): Promise<number[]> {
  const entrada = texto.trim().slice(0, 8_000); // teto defensivo de tokens
  const json = (await postOpenAI("/embeddings", {
    model: MODELO_EMBEDDING,
    input: entrada,
    dimensions: EMBEDDING_DIMENSOES,
  })) as { data?: { embedding?: number[] }[] };

  const vetor = json?.data?.[0]?.embedding;
  if (!Array.isArray(vetor) || vetor.length !== EMBEDDING_DIMENSOES) {
    throw new Error("Embedding inválido retornado pela OpenAI.");
  }
  return vetor;
}

// Formato `vector` do pgvector aceita o literal "[n,n,...]". Helper p/ a RPC.
export function embeddingParaSQL(vetor: number[]): string {
  return `[${vetor.join(",")}]`;
}

// ----------------------------------------------------------------------------
// 2) extrairIntencao — LLM lê o texto livre e devolve FILTROS DUROS (ou null).
//    Esses filtros viram WHERE exato no SQL; o vetor só rankeia dentro deles.
//    Estritamente JSON; qualquer falha → tudo null (busca puramente semântica).
// ----------------------------------------------------------------------------
export type Intencao = {
  tipo_bem: "imovel" | "veiculo" | null;
  valor_max: number | null;
  entrada_max: number | null;
};

const INTENCAO_VAZIA: Intencao = {
  tipo_bem: null,
  valor_max: null,
  entrada_max: null,
};

const PROMPT_INTENCAO = [
  "Você extrai filtros de busca de cartas de consórcio JÁ CONTEMPLADAS a partir",
  "de um texto em português do Brasil. Responda SOMENTE um JSON com as chaves:",
  '{"tipo_bem": "imovel"|"veiculo"|null, "valor_max": number|null, "entrada_max": number|null}.',
  "Regras:",
  "- tipo_bem: 'imovel' para casa/apartamento/terreno/imóvel; 'veiculo' para",
  "  carro/moto/caminhão/veículo; null se não der para saber.",
  "- valor_max: teto do CRÉDITO da carta em reais (número puro, sem R$ nem pontos).",
  "  'uns 300 mil' => 300000; '300k' => 300000; null se não houver.",
  "- entrada_max: teto da ENTRADA em reais; 'entrada baixa/pouca entrada' => null",
  "  (não invente número); só preencha se houver valor explícito.",
  "- Nunca explique. Nunca escreva nada fora do JSON.",
].join("\n");

export async function extrairIntencao(texto: string): Promise<Intencao> {
  try {
    const json = (await postOpenAI("/chat/completions", {
      model: MODELO_CHAT,
      temperature: 0,
      max_tokens: 120,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: PROMPT_INTENCAO },
        { role: "user", content: texto.slice(0, 600) },
      ],
    })) as { choices?: { message?: { content?: string } }[] };

    const cru = json?.choices?.[0]?.message?.content;
    if (!cru) return INTENCAO_VAZIA;
    const obj = JSON.parse(cru) as Partial<Intencao>;

    const tipo =
      obj.tipo_bem === "imovel" || obj.tipo_bem === "veiculo"
        ? obj.tipo_bem
        : null;
    const num = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;

    return { tipo_bem: tipo, valor_max: num(obj.valor_max), entrada_max: num(obj.entrada_max) };
  } catch {
    // Qualquer falha (rede, JSON, timeout) → sem filtros duros. A busca degrada
    // para puramente semântica em vez de quebrar.
    return INTENCAO_VAZIA;
  }
}

// ----------------------------------------------------------------------------
// 3) fraseDeEncaixe — uma linha curta explicando por que a carta combina com o
//    desejo. COMPLIANCE-LOCKED no prompt + filtrada por sanitizarCompliance.
//    Nunca menciona contemplação/prazo. Se falhar/violar → fallback neutro.
// ----------------------------------------------------------------------------
export type CartaParaFrase = {
  tipo: string;
  valor_credito: number;
  valor_entrada: number | null;
};

const PROMPT_FRASE = [
  "Você escreve UMA frase curta (máx. 18 palavras), em português do Brasil, tom",
  "sóbrio, explicando por que uma carta de crédito de consórcio JÁ CONTEMPLADA",
  "combina com o que a pessoa procura. REGRAS DE COMPLIANCE (obrigatórias):",
  "- NUNCA prometa ou sugira contemplação, sorteio, lance, prazo ou data.",
  "- NUNCA use: investimento, investidor, rendimento, garantido, desconto,",
  "  aprovação de crédito, limite de crédito.",
  "- PODE usar: carta de crédito, poder de compra, planejamento, patrimônio,",
  "  compra programada, já contemplada.",
  "- Fale de adequação (valor/entrada/tipo do bem), não de promessa.",
  "- Sem emojis, sem aspas, só a frase.",
].join("\n");

export async function fraseDeEncaixe(
  desejo: string,
  carta: CartaParaFrase
): Promise<string> {
  const fallback = "Esta carta se encaixa no perfil que você descreveu.";
  try {
    const ctx = [
      `Desejo: ${desejo.slice(0, 240)}`,
      `Carta: tipo=${carta.tipo}, crédito=R$${Math.round(carta.valor_credito)}` +
        (carta.valor_entrada != null
          ? `, entrada=R$${Math.round(carta.valor_entrada)}`
          : ""),
    ].join("\n");

    const json = (await postOpenAI("/chat/completions", {
      model: MODELO_CHAT,
      temperature: 0.4,
      max_tokens: 60,
      messages: [
        { role: "system", content: PROMPT_FRASE },
        { role: "user", content: ctx },
      ],
    })) as { choices?: { message?: { content?: string } }[] };

    const frase = json?.choices?.[0]?.message?.content ?? "";
    return sanitizarCompliance(frase, fallback);
  } catch {
    return fallback;
  }
}

// ----------------------------------------------------------------------------
// 4) descricaoDeCarta — texto curto e neutro de catálogo, usado pelo BACKFILL
//    como base do embedding da carta. Determinístico (sem LLM): barato, estável
//    e impossível de violar compliance. Descreve o bem em linguagem que casa com
//    como as pessoas pesquisam ("apartamento", "primeiro imóvel", "troca de carro").
// ----------------------------------------------------------------------------
export function descricaoDeCarta(carta: {
  tipo: string;
  valor_credito: number;
  valor_entrada: number | null;
  valor_parcela: number | null;
  qtd_parcelas: number | null;
}): string {
  const bem =
    carta.tipo === "imovel"
      ? "Carta de crédito já contemplada para imóvel: casa, apartamento, terreno ou sala comercial."
      : "Carta de crédito já contemplada para veículo: carro, moto, caminhão ou utilitário.";

  const partes = [bem, `Poder de compra de cerca de R$ ${Math.round(carta.valor_credito)}.`];
  if (carta.valor_entrada != null) {
    partes.push(`Entrada aproximada de R$ ${Math.round(carta.valor_entrada)}.`);
  }
  if (carta.valor_parcela != null && carta.qtd_parcelas != null) {
    partes.push(
      `Parcelamento em ${carta.qtd_parcelas} vezes de R$ ${Math.round(carta.valor_parcela)}.`
    );
  }
  partes.push("Planejamento patrimonial e compra programada.");
  return partes.join(" ");
}
