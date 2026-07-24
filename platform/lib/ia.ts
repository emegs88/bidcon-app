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
  "investidora",
  "investidores",
  "investidoras",
  "rendimento",
  "rentabilidade",
  "garantido",
  "garantida",
  "desconto",
  "aprovacao de credito",
  "aprovação de crédito",
  "limite de credito",
  "limite de crédito",
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
  // FATIA 1 (venda nova) / FATIA 2 (F3.1 — Guardrail Prosperito v2): consórcio
  // não é aplicação financeira — nunca prometer retorno/rentabilidade/lucro.
  // "retorno" SOZINHO NÃO entra aqui de propósito (bloquearia "Aguardo seu
  // retorno", um uso institucional legítimo e frequente); a forma composta
  // ("retorno financeiro/garantido/sobre/de X%") é pega por
  // RETORNO_FINANCEIRO_RE dentro de termoViolado, não por esta lista.
  "cdi",
  "lucro",
  "lucrar",
  "lucratividade",
  "taxa interna de retorno",
];

const NEGACOES = ["nao ", "não ", "sem ", "nunca "];

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// "retorno" sozinho é institucional e legítimo ("Aguardo seu retorno") — só a
// forma COMPOSTA (financeiro/garantido/percentual/"sobre" + complemento
// FINANCEIRO explícito) é violação. Fora do mecanismo de lista de
// TERMOS_PROIBIDOS porque a cauda é uma alternação, não uma frase fixa.
//
// FATIA 2 · SEGURANCA-01 · F3.1-b (ajuste Emerson): a versão anterior
// (`/\bretorno (financeiro|sobre|garantido|de \d)/`) casava QUALQUER "retorno
// sobre X" — inclusive uso institucional legítimo ("aguardo seu retorno
// sobre a proposta"). Agora "retorno sobre" só viola quando o complemento é
// explicitamente financeiro (investimento/capital/aplicação/patrimônio);
// "retorno sobre o investimento" continua bloqueado — e tem rede dupla,
// porque "investimento" já está em TERMOS_PROIBIDOS por conta própria.
//
// FATIA 2 · SEGURANCA-01 · F3.1-c (ajuste Emerson, nit): flag /i acrescentada
// — o pipeline atual sempre chama isto sobre `base` já em lowercase (via
// semAcento(texto.toLowerCase())), então na prática não muda nenhum teste
// existente, mas deixa a constante robusta por conta própria para qualquer
// chamador futuro que não normalize antes.
const RETORNO_FINANCEIRO_RE =
  /\bretorno\s+(financeiro|garantido|de\s+\d|sobre\s+(o\s+)?(investimento|capital|aplica\w+|patrim[ôo]nio))\b/i;

// (A) devolve o termo proibido casado (em LIMITE DE PALAVRA e NÃO negado), ou
//     null se a frase estiver limpa nesta frente. A fronteira de palavra evita
//     que siglas curtas (ccb/fidc) casem dentro de outra palavra (ex.:
//     "fundinG" em "profundamente" não dispara). Devolver QUAL termo casou
//     (em vez de só true/false) é o que permite o log granular do ITEM 4
//     (`motivo = "lexico:CDI"` etc.) sem duplicar a varredura.
function termoViolado(base: string): string | null {
  for (const termoRaw of TERMOS_PROIBIDOS) {
    const termo = semAcento(termoRaw.toLowerCase());
    let idx = base.indexOf(termo);
    while (idx !== -1) {
      const ant = base[idx - 1] ?? " ";
      const dep = base[idx + termo.length] ?? " ";
      const fronteira = /[^a-z0-9]/.test(ant) && /[^a-z0-9]/.test(dep);
      if (fronteira) {
        const antes = base.slice(Math.max(0, idx - 8), idx);
        const negado = NEGACOES.some((n) => antes.includes(semAcento(n)));
        if (!negado) return termoRaw; // ocorrência não-negada em fronteira → viola
      }
      idx = base.indexOf(termo, idx + termo.length);
    }
  }
  if (RETORNO_FINANCEIRO_RE.test(base)) return "retorno (financeiro/garantido)";
  return null;
}

// true se há termo proibido em LIMITE DE PALAVRA e NÃO negado. Mantido como
// wrapper booleano de termoViolado — assinatura/nome preservados porque
// violaCompliance/sanitizarCompliance (chamadas pelo site) dependem dele.
function violaTermo(base: string): boolean {
  return termoViolado(base) !== null;
}

// (B) Promessa de DATA/PRAZO/GARANTIA de contemplação — matcher F3.1 (FATIA 2
//     · SEGURANCA-01, ver checkpoint). Substitui a antiga estratégia genérica
//     de "âncora + janela de 40 chars com lista de palavras temporais soltas"
//     (causa raiz confirmada do falso-positivo de produção 2026-07-23: a
//     janela genérica casava "contemplada" só por proximidade de caractere
//     com qualquer palavra temporal, sem checar se havia de fato um VERBO de
//     futuro/prazo/garantia). Os 5 padrões abaixo só casam a PROMESSA real —
//     "carta já contemplada"/"cota contemplada"/"foi contemplada por
//     sorteio" (ESTADO do produto, sem futuro/prazo/garantia por perto) NUNCA
//     casam aqui por construção, sem precisar de allowlist em runtime.
const PROMESSA_PRAZO_PATTERNS: RegExp[] = [
  /\bsera contemplad[oa]?\b/, // "você SERÁ contemplado"
  /\bvai contemplar\b/, // "isso VAI CONTEMPLAR você"
  /\bcontemplacao (garantida|rapida|certa|imediata)\b/, // "contemplação GARANTIDA/RÁPIDA/..."
  /\bcontempla(cao|do|da)?\s+em\s+(ate\s+)?\d+\s*(dias?|meses|semanas?)\b/, // "contemplado EM até 3 MESES"
  /\bgarant\w*[\s\S]{0,20}contempl\w*/, // "GARANTIMOS ... CONTEMPLAção" (qualquer ordem/distância curta)
];

// Negações que LIBERAM a promessa ("não há data", "sem prazo de contemplação",
// "ninguém pode garantir que você será contemplado em X meses").
const NEGA_PROMESSA = [
  "nao prom", "sem prom", "nunca prom", "nao garant", "sem garant",
  "nao prevemos", "nao ha data", "sem data", "nao tem data", "nao pode garantir",
  "ninguem pode",
];

// FATIA 2 · SEGURANCA-01 · F3.1-b (ajuste Emerson) — negação de GARANTIA
// "colada" no verbo (sem material entre a negação e o verbo de garantir).
// Existe porque o padrão 5 de PROMESSA_PRAZO_PATTERNS
// (/\bgarant\w*[\s\S]{0,20}contempl\w*/) começa o match exatamente em
// "garant" — a janela "antes" (20 chars) do laço abaixo NUNCA pode conter a
// negação nesses casos, pois o match já consumiu esses caracteres. Avaliada
// ANTES do loop de PROMESSA_PRAZO_PATTERNS: se casar, pula SÓ a checagem de
// promessa para esta base/frase (o léxico proibido, em termoViolado, não é
// afetado — continua valendo normalmente).
//
// A negação é colada de propósito: "não SE PREOCUPE, garantimos contemplação
// em 3 meses" tem material entre "não" e "garantimos" → NÃO casa aqui → a
// promessa continua sendo bloqueada normalmente pelo loop abaixo. O guardrail
// protege a SAÍDA do modelo, não tenta blindar contra todo input adversarial
// de usuário — se um cliente escrever frases separadas testando o limite, a
// frase com a promessa real ainda bloqueia normalmente (ver teste "aceito"
// em ia.guardrail.test.ts).
// NOTA: `base` sempre chega aqui já passado por semAcento() — por isso o
// trecho "é possível" da regra original (com "é" acentuado) é normalizado
// para "e" aqui embaixo (senão nunca casaria contra "e possivel", já que a
// base nunca tem acento). Semântica preservada, só a codificação ajustada
// pra bater com o pipeline de normalização já existente no arquivo.
const NEGACAO_SEGURA_RE =
  /\b(n[ãa]o\s+(garantimos|garante|garanto|garantem|posso\s+garantir|podemos\s+garantir|e\s+poss[íi]vel\s+garantir|h[áa]\s+como\s+garantir|d[áa]\s+para\s+garantir)|ningu[ée]m\s+(pode|consegue)\s+garantir|imposs[íi]vel\s+garantir|sem\s+garantia\s+de)\b/i;

// FATIA 2 · SEGURANCA-01 · F3.1-c (ajuste Emerson) — conjunções adversativas
// que delimitam CLÁUSULAS dentro de uma frase. Existem porque NEGACAO_SEGURA_RE
// aplicada à frase INTEIRA isentava indevidamente uma promessa real que
// aparecesse numa cláusula seguinte ligada por "mas/porém/...": "não
// garantimos datas, MAS você será contemplado em 3 meses" tinha a negação da
// primeira cláusula isentando por engano a promessa real da segunda. Agora
// cada cláusula é avaliada de forma independente (ver dividirEmClausulas e
// prometeDataContemplacao abaixo).
const ADVERSATIVAS_RE =
  /\b(mas|por[ée]m|contudo|entretanto|no entanto|s[óo]\s+que|todavia)\b/;

// Divide uma FRASE em cláusulas nas conjunções adversativas acima. Como
// ADVERSATIVAS_RE tem um único grupo de captura, `.split()` intercala os
// delimitadores casados nos índices ÍMPARES do array resultante — por isso
// mantemos só os índices PARES (o texto de cada lado do conectivo).
function dividirEmClausulas(frase: string): string[] {
  return frase
    .split(ADVERSATIVAS_RE)
    .filter((_, i) => i % 2 === 0)
    .map((c) => c.trim())
    .filter(Boolean);
}

// Núcleo da checagem de promessa/garantia, aplicado a um TRECHO já isolado
// (uma cláusula). Extraído de prometeDataContemplacao para ser chamado por
// cláusula, em vez de uma única vez sobre o texto inteiro.
function trechoPrometeContemplacao(trecho: string): boolean {
  if (NEGACAO_SEGURA_RE.test(trecho)) return false;
  return PROMESSA_PRAZO_PATTERNS.some((re) => {
    const m = re.exec(trecho);
    if (!m) return false;
    const antes = trecho.slice(Math.max(0, m.index - 20), m.index);
    const negado = NEGA_PROMESSA.some((n) => antes.includes(semAcento(n)));
    return !negado;
  });
}

// FATIA 2 · SEGURANCA-01 · F3.1-c (ajuste Emerson) — escopo por FRASE e por
// CLÁUSULA. Antes, NEGACAO_SEGURA_RE (e o loop de PROMESSA_PRAZO_PATTERNS)
// eram avaliados contra `base` INTEIRO, então uma negação em qualquer canto
// do texto podia isentar por engano uma promessa real ligada por uma
// adversativa ("não garantimos, MAS será contemplado em 3 meses"). Agora o
// split acontece AQUI DENTRO (não no chamador): divide `base` em frases
// (dividirEmFrases) e cada frase em cláusulas (dividirEmClausulas), avaliando
// cada cláusula de forma independente — basta UMA cláusula sem negação segura
// e com promessa real para bloquear, mesmo que outra cláusula da mesma frase
// tenha negação legítima. Fazer o split dentro da função (em vez de exigir
// que o chamador normalize antes) garante que TODO caller ganhe a mesma
// granularidade automaticamente: sanitizarCompliance (site) passa o texto
// inteiro sem pré-dividir, e avaliarComplianceGradual (WhatsApp) já pré-divide
// em frases antes de chamar esta função — nesse segundo caso, dividir uma
// string que já é uma única frase em "frases" é idempotente (dividirEmFrases
// devolve a própria string como único elemento quando não há mais pontuação
// terminal para splitar), então não há dupla-divisão nem mudança de
// comportamento no caminho que já pré-divide.
function prometeDataContemplacao(base: string): boolean {
  for (const frase of dividirEmFrases(base)) {
    for (const clausula of dividirEmClausulas(frase)) {
      if (trechoPrometeContemplacao(clausula)) return true;
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
// avaliarComplianceGradual — FATIA 2 (SEGURANCA-01 · F3.1), ITEM 2 (ação
// gradual). Usada SÓ pelo canal WhatsApp (lib/whatsapp/cerebro.ts) — o site
// (app/api/atende/route.ts) continua chamando sanitizarCompliance() acima,
// sem NENHUMA mudança de assinatura/comportamento, porque essa função já é
// contrato público consumido por um arquivo fora do escopo desta fatia.
//
// Em vez de engolir a resposta inteira ao primeiro termo/promessa encontrado
// (o que causava o loop de fallback genérico reportado em produção), esta
// função opera por FRASE: remove só a(s) frase(s) ofensora(s) e devolve o
// que sobrar, se ainda for útil. O chamador decide o que fazer com cada
// nível:
//   nivel 0 — texto limpo, nada foi removido.
//   nivel 1 — algo foi podado mas sobrou conteúdo útil (>= 6 chars não-espaço)
//             — envia o restante.
//   nivel 2 — nada de útil sobrou (resposta inteira era problemática, ou já
//             veio vazia) — o chamador deve tentar UMA regeneração (Nível 2
//             da spec) e, falhando, cair no fallback de Nível 3.
// `motivos` é uma entrada por frase removida, no formato esperado pelo log de
// wa_guardrail_log (ITEM 4): "lexico:<termo>" ou "promessa_prazo".
export type ResultadoComplianceGradual = {
  texto: string;
  nivel: 0 | 1 | 2;
  motivos: string[];
};

// Divide em frases por pontuação terminal (. ! ?), preservando o separador
// como fronteira (lookbehind) — não perde o delimitador de cada frase.
function dividirEmFrases(texto: string): string[] {
  return texto
    .split(/(?<=[.!?])\s+/)
    .map((f) => f.trim())
    .filter(Boolean);
}

export function avaliarComplianceGradual(texto: string): ResultadoComplianceGradual {
  const limpa = texto.trim();
  if (!limpa) return { texto: "", nivel: 2, motivos: ["vazio"] };

  const frases = dividirEmFrases(limpa);
  const mantidas: string[] = [];
  const motivos: string[] = [];

  for (const frase of frases) {
    const base = semAcento(frase.toLowerCase());
    const termo = termoViolado(base);
    if (termo) {
      motivos.push(`lexico:${termo}`);
      console.warn(
        `[avaliarComplianceGradual] termo proibido (${termo}) — frase removida: ${frase.slice(0, 120)}`
      );
      continue;
    }
    if (prometeDataContemplacao(base)) {
      motivos.push("promessa_prazo");
      console.warn(
        `[avaliarComplianceGradual] promessa de prazo/garantia — frase removida: ${frase.slice(0, 120)}`
      );
      continue;
    }
    mantidas.push(frase);
  }

  if (motivos.length === 0) {
    return { texto: limpa, nivel: 0, motivos: [] };
  }

  const restante = mantidas.join(" ").trim();
  if (mantidas.length > 0 && restante.replace(/\s/g, "").length >= 6) {
    return { texto: restante, nivel: 1, motivos };
  }
  return { texto: "", nivel: 2, motivos };
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
