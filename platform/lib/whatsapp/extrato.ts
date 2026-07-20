// ============================================================================
// Extração de extrato de cota (PDF/imagem) recebido via WhatsApp — FATIA
// WHATSAPP-EXTRATO-01. SERVIDOR-ONLY (lê ANTHROPIC_API_KEY).
// ----------------------------------------------------------------------------
// Espelha lib/verificador.ts (mesma disciplina: fetch puro na Anthropic
// Messages API, content block document/image em base64, prompt fechado
// pedindo SOMENTE JSON, nunca repassa corpo de erro do provedor). Duas
// diferenças deliberadas em relação ao verificador:
//   - Modelo: "claude-fable-5" — mesmo hardcoded de /api/atende e
//     lib/whatsapp/cerebro.ts ("modelo igual ao /api/atende", pedido
//     explícito desta fatia), não o claude-3-5-sonnet-20241022 do
//     verificador.
//   - Schema de saída: campos próprios desta fatia (administradora, grupo,
//     cota, valor_credito, saldo_devedor, parcelas_pagas,
//     parcelas_restantes, valor_parcela, contemplada, confianca) — não o
//     schema {cota,bem,alertas} do verificador (§7 do Master Build Prompt).
//
// Este módulo NÃO grava em banco e NÃO decide nada — só extrai e devolve o
// JSON tipado (ou lança). O chamador (webhook) decide o que fazer com o
// resultado: grava em extratos_cotas como 'pendente_revisao' — NUNCA em
// `cartas`. Falha (rede/timeout/JSON malformado) é sempre capturada pelo
// chamador; nunca derruba o ack 200 do webhook.
// ============================================================================
import { sanitizarCompliance } from "@/lib/ia";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODELO = "claude-fable-5"; // mesmo modelo hardcoded de /api/atende e cerebro.ts
const MAX_TOKENS = 1024;
const TIMEOUT_MS = 30_000;

function apiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error("Falta ANTHROPIC_API_KEY (env de servidor) para o extrato do WhatsApp.");
  }
  return key;
}

// ----------------------------------------------------------------------------
// Contrato de dados desta fatia.
// ----------------------------------------------------------------------------
export type ExtratoExtraido = {
  administradora: string | null;
  grupo: string | null;
  cota: string | null;
  valor_credito: number | null;
  saldo_devedor: number | null;
  parcelas_pagas: number | null;
  parcelas_restantes: number | null;
  valor_parcela: number | null;
  contemplada: boolean | null;
  confianca: number; // 0..1 — 0 quando o modelo não estimou/JSON não trouxe
};

// Documento de entrada já baixado da Graph API (base64 sem prefixo data:).
export type DocEntrada = {
  mimeType: string; // application/pdf | image/jpeg | image/png | image/webp | ...
  base64: string;
};

// ----------------------------------------------------------------------------
// Prompt de extração — JSON estrito, sem prosa.
// ----------------------------------------------------------------------------
const PROMPT_SISTEMA = [
  "Você extrai dados de EXTRATOS de cota de consórcio (Brasil) anexados",
  "numa conversa de WhatsApp. Responda SOMENTE um JSON válido, sem texto",
  "fora do JSON, sem markdown, sem comentários. Chaves exatas:",
  "{",
  '  "administradora": string|null,',
  '  "grupo": string|null,',
  '  "cota": string|null,',
  '  "valor_credito": number|null,',
  '  "saldo_devedor": number|null,',
  '  "parcelas_pagas": number|null,',
  '  "parcelas_restantes": number|null,',
  '  "valor_parcela": number|null,',
  '  "contemplada": boolean|null,',
  '  "confianca": number',
  "}",
  "Regras:",
  "- Números em reais como número puro (sem 'R$', sem separador de milhar).",
  "  '1.504,26' => 1504.26.",
  "- confianca: 0 a 1 — sua estimativa de quão confiável é esta leitura",
  "  (baixa se o documento estiver ilegível, cortado, borrado ou com dados",
  "  ambíguos).",
  "- Se um campo não for legível no documento, use null (não invente).",
  "- Nunca escreva nada fora do JSON, nunca comente, nunca prometa nada.",
].join("\n");

const PROMPT_USUARIO =
  "Extraia os campos do extrato de cota anexado e devolva apenas o JSON.";

function blocoDeConteudo(doc: DocEntrada): unknown {
  // PDF vai como document; qualquer outra coisa (imagem) vai como image —
  // mesmo critério de lib/verificador.ts.
  const tipo = doc.mimeType === "application/pdf" ? "document" : "image";
  return {
    type: tipo,
    source: { type: "base64", media_type: doc.mimeType, data: doc.base64 },
  };
}

// fetch com timeout — uma chamada de IA travada nunca pode pendurar o webhook.
// Não vaza corpo de erro do provedor (só status).
async function chamarAnthropic(doc: DocEntrada): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey(),
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: MAX_TOKENS,
        temperature: 0,
        system: PROMPT_SISTEMA,
        messages: [
          {
            role: "user",
            content: [blocoDeConteudo(doc), { type: "text", text: PROMPT_USUARIO }],
          },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      throw new Error(`Anthropic respondeu ${resp.status}`);
    }
    const json = (await resp.json()) as { content?: { type?: string; text?: string }[] };
    const texto = (json?.content ?? [])
      .filter((b) => b?.type === "text")
      .map((b) => b?.text ?? "")
      .join("")
      .trim();
    if (!texto) throw new Error("Resposta vazia do provedor.");
    return texto;
  } finally {
    clearTimeout(t);
  }
}

function extrairJSON(cru: string): unknown {
  const ini = cru.indexOf("{");
  const fim = cru.lastIndexOf("}");
  if (ini === -1 || fim === -1 || fim < ini) {
    throw new Error("JSON não encontrado na resposta.");
  }
  return JSON.parse(cru.slice(ini, fim + 1));
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const limpo = v.replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
    const n = Number(limpo);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function inteiro(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n);
}
function bool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "sim", "contemplada", "contemplado"].includes(s)) return true;
    if (["false", "nao", "não"].includes(s)) return false;
  }
  return null;
}
function confiancaDe(v: unknown): number {
  const n = num(v);
  if (n === null) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Extrai os campos do extrato anexado. Lança em falha de rede/JSON/timeout
 *  — o chamador (webhook) decide (try/catch, nunca derruba o 200). */
export async function extrairExtrato(doc: DocEntrada): Promise<ExtratoExtraido> {
  const cru = await chamarAnthropic(doc);
  const obj = extrairJSON(cru) as Record<string, unknown>;
  return {
    administradora: str(obj.administradora),
    grupo: str(obj.grupo),
    cota: str(obj.cota),
    valor_credito: num(obj.valor_credito),
    saldo_devedor: num(obj.saldo_devedor),
    parcelas_pagas: inteiro(obj.parcelas_pagas),
    parcelas_restantes: inteiro(obj.parcelas_restantes),
    valor_parcela: num(obj.valor_parcela),
    contemplada: bool(obj.contemplada),
    confianca: confiancaDe(obj.confianca),
  };
}

// ----------------------------------------------------------------------------
// Resumo de resposta pro cliente (WhatsApp) — texto FIXO, montado por nós a
// partir dos campos já tipados (nunca prosa livre do modelo). Mesmo espírito
// de FRASE_RESERVA_WA em cerebro.ts: garantia é do sistema, não da IA.
// Ainda assim passa por sanitizarCompliance como última barreira, porque
// administradora/grupo/cota são strings que VIERAM do modelo (lidas do
// documento) — defesa em profundidade contra o caso extremo de o documento
// conter um termo proibido que o modelo copie ao pé da letra.
// ----------------------------------------------------------------------------
const FALLBACK_RESUMO =
  "Recebemos o extrato! Nossa equipe vai conferir os dados e volta com você em breve.";

function fmtReais(v: number | null): string | null {
  if (v == null) return null;
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function resumoExtratoWa(e: ExtratoExtraido): string {
  const credito = fmtReais(e.valor_credito);
  const saldo = fmtReais(e.saldo_devedor);
  const parcela = fmtReais(e.valor_parcela);

  const linhas = [
    "Recebemos o extrato! Aqui está o que conseguimos ler automaticamente:",
    e.administradora ? `Administradora: ${e.administradora}` : null,
    e.grupo ? `Grupo: ${e.grupo}` : null,
    e.cota ? `Cota: ${e.cota}` : null,
    credito ? `Crédito: ${credito}` : null,
    saldo ? `Saldo devedor: ${saldo}` : null,
    e.parcelas_pagas != null ? `Parcelas pagas: ${e.parcelas_pagas}` : null,
    e.parcelas_restantes != null ? `Parcelas restantes: ${e.parcelas_restantes}` : null,
    parcela ? `Valor da parcela: ${parcela}` : null,
    e.contemplada != null ? `Consta como contemplada no documento: ${e.contemplada ? "sim" : "não"}` : null,
    "Esses dados ainda serão conferidos pela nossa equipe antes de qualquer confirmação.",
  ].filter((l): l is string => !!l);

  return sanitizarCompliance(linhas.join("\n"), FALLBACK_RESUMO);
}
