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
// COMPLIANCE — termos proibidos no consórcio (mesma lista da régua do projeto).
// Casa em limite de palavra, case-insensitive, ignorando acento. Permite a
// forma NEGADA ("não é investimento") porque a negação é institucional/correta.
// ----------------------------------------------------------------------------
const TERMOS_PROIBIDOS = [
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
];

const NEGACOES = ["nao ", "não ", "sem ", "nunca "];

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// true se o texto contém termo proibido NÃO precedido de negação.
export function violaCompliance(texto: string): boolean {
  const base = semAcento(texto.toLowerCase());
  return TERMOS_PROIBIDOS.some((termoRaw) => {
    const termo = semAcento(termoRaw.toLowerCase());
    let idx = base.indexOf(termo);
    while (idx !== -1) {
      const antes = base.slice(Math.max(0, idx - 8), idx);
      const negado = NEGACOES.some((n) => antes.includes(semAcento(n)));
      if (!negado) return true; // achou ocorrência não-negada → viola
      idx = base.indexOf(termo, idx + termo.length);
    }
    return false;
  });
}

// Devolve a frase só se passar no compliance; senão, um fallback neutro seguro.
export function sanitizarCompliance(frase: string, fallback: string): string {
  const limpa = frase.trim();
  if (!limpa) return fallback;
  if (violaCompliance(limpa)) return fallback;
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
