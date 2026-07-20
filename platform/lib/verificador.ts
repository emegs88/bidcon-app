// ============================================================================
// Verificador IA v1 — extração de extrato/documentos de consórcio. SERVIDOR-ONLY.
// ----------------------------------------------------------------------------
// Importar este arquivo de um Client Component quebra o build de propósito (não
// há "use client" e ele lê ANTHROPIC_API_KEY). Mantê-lo só em rotas/handlers
// server-side (app/api/verificador).
//
// Provedor: Anthropic Messages API via fetch puro (zero dependência nova —
// mesma disciplina de lib/ia.ts, que usa fetch direto na OpenAI). Modelo de
// visão lê PDF/JPG/PNG em base64 e devolve JSON ESTRITO no schema do §7 do
// Master Build Prompt.
//
// COMPLIANCE (inviolável): toda string de alerta passa por garantirLexico
// (lib/lexico.ts) antes de sair. A chave NUNCA vai ao client, repo ou log; o
// corpo de erro do provedor NUNCA é repassado (pode conter detalhe da conta).
// Este módulo NÃO grava em banco e NÃO expõe o texto bruto do documento.
// ============================================================================

import { garantirLexico } from "@/lib/lexico";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODELO = "claude-3-5-sonnet-20241022";
const MAX_TOKENS = 1500;

// Lê a chave só quando precisa (não no import) — evita explodir o build/SSG,
// espelhando o padrão de lib/ia.ts.
function apiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error("Falta ANTHROPIC_API_KEY (env de servidor) para o verificador.");
  }
  return key;
}

// ----------------------------------------------------------------------------
// Contrato de dados (§7 do Master Build Prompt) — schema atual.
// ----------------------------------------------------------------------------
export type SegmentoBem = "Automóvel" | "Imóvel" | null;
export type TipoBem = "veiculo" | "imovel" | null;

export type CotaExtraida = {
  administradora: string | null;
  segmento: SegmentoBem; // do campo Produto/Bem: AUT→Automóvel, IMÓVEL→Imóvel
  saldo_devedor: number | null;
  parcela_atual: number | null;
  parcelas_restantes: number | null;
  contemplada: boolean | null;
  data_emissao: string | null; // ISO AAAA-MM-DD quando legível
};

export type BemGarantia = {
  tipo: TipoBem;
  identificacao: string | null; // placa/RENAVAM, matrícula, etc.
  proprietario: string | null;
  valor_referencia: number | null;
  onus: string[]; // ônus/alienação/gravame lidos no documento
};

export type ResultadoVerificador = {
  ok: boolean;
  cota: CotaExtraida;
  bem: BemGarantia;
  alertas: string[]; // já passadas por garantirLexico
};

// Documento de entrada já validado pela rota (base64 sem prefixo data:).
export type DocEntrada = {
  media_type: "application/pdf" | "image/jpeg" | "image/png";
  data_base64: string;
};

// ----------------------------------------------------------------------------
// Prompt de extração — JSON estrito, sem prosa. Regras do §7 embutidas.
// ----------------------------------------------------------------------------
const PROMPT_SISTEMA = [
  "Você extrai dados de EXTRATOS e documentos de consórcio (Brasil) para um",
  "sistema de assunção de dívida. Responda SOMENTE um JSON válido, sem texto",
  "fora do JSON, sem markdown, sem comentários. Chaves exatas:",
  "{",
  '  "cota": {',
  '    "administradora": string|null,',
  '    "segmento": "Automóvel"|"Imóvel"|null,',
  '    "saldo_devedor": number|null,',
  '    "parcela_atual": number|null,',
  '    "parcelas_restantes": number|null,',
  '    "contemplada": boolean|null,',
  '    "data_emissao": "AAAA-MM-DD"|null',
  "  },",
  '  "bem": {',
  '    "tipo": "veiculo"|"imovel"|null,',
  '    "identificacao": string|null,',
  '    "proprietario": string|null,',
  '    "valor_referencia": number|null,',
  '    "onus": string[]',
  "  },",
  '  "alertas": string[]',
  "}",
  "Regras:",
  "- segmento: leia do campo Produto/Bem. 'AUT'/'AUTO'/'AUTOMÓVEL' => 'Automóvel';",
  "  'IMÓVEL'/'IMOVEL'/'IMOB' => 'Imóvel'; caso contrário null.",
  "- tipo do bem: 'veiculo' para automóvel/moto/caminhão; 'imovel' para casa/",
  "  apartamento/terreno; null se não der para saber.",
  "- Números em reais como número puro (sem 'R$', sem separador de milhar).",
  "  '1.504,26' => 1504.26.",
  "- onus: liste gravames/alienação fiduciária/penhora citados no documento;",
  "  lista vazia se nenhum.",
  "- alertas: gere quando aplicável, em português, tom factual, SEM promessas.",
  "  Situações que exigem alerta:",
  "  (1) extrato com data de emissão com mais de 7 dias — cite a data;",
  "  (2) parcela aparenta reduzida/estimada — marque 'estimada, a confirmar';",
  "  (3) sinais de inadimplência/atraso;",
  "  (4) ônus/alienação sobre a garantia.",
  "- Nunca prometa contemplação, prazo ou data de contemplação.",
  "- Se um campo não for legível, use null (não invente).",
].join("\n");

const PROMPT_USUARIO =
  "Extraia os campos do(s) documento(s) anexado(s) e devolva apenas o JSON.";

// ----------------------------------------------------------------------------
// fetch com timeout — uma chamada de IA travada nunca pode pendurar a rota.
// Não vaza corpo de erro do provedor (só status).
// ----------------------------------------------------------------------------
async function chamarAnthropic(docs: DocEntrada[], timeoutMs = 30_000): Promise<string> {
  const conteudo: unknown[] = docs.map((d) => {
    // PDF vai como document; imagem vai como image (formatos do Anthropic).
    if (d.media_type === "application/pdf") {
      return {
        type: "document",
        source: { type: "base64", media_type: d.media_type, data: d.data_base64 },
      };
    }
    return {
      type: "image",
      source: { type: "base64", media_type: d.media_type, data: d.data_base64 },
    };
  });
  conteudo.push({ type: "text", text: PROMPT_USUARIO });

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
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
        system: PROMPT_SISTEMA,
        messages: [{ role: "user", content: conteudo }],
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      // Nunca repassa o corpo (pode conter detalhe da conta) — só o status.
      throw new Error(`Anthropic respondeu ${resp.status}`);
    }
    const json = (await resp.json()) as {
      content?: { type?: string; text?: string }[];
    };
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

// ----------------------------------------------------------------------------
// Coerção defensiva do JSON do modelo para o schema tipado. Qualquer campo
// ausente/estranho vira null (ou [] para listas). Nunca confia cegamente.
// ----------------------------------------------------------------------------
function extrairJSON(cru: string): unknown {
  // Tolera cerca de ```json ... ``` e texto residual: pega do 1º { ao último }.
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
    // "1.504,26" => 1504.26 ; "159451,56" => 159451.56 ; "180000" => 180000
    const limpo = v.replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
    const n = Number(limpo);
    return Number.isFinite(n) ? n : null;
  }
  return null;
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
function segmento(v: unknown): SegmentoBem {
  const s = (str(v) ?? "").toLowerCase();
  if (s.startsWith("aut")) return "Automóvel";
  if (s.startsWith("im")) return "Imóvel";
  return null;
}
function tipoBem(v: unknown): TipoBem {
  const s = (str(v) ?? "").toLowerCase();
  if (s === "veiculo" || s === "veículo") return "veiculo";
  if (s === "imovel" || s === "imóvel") return "imovel";
  return null;
}
function listaStr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x)).filter((x): x is string => !!x);
}

// Filtra alertas pela guarda de léxico: só passa a string se garantirLexico ok.
// Uma string que violaria a régua é substituída por um alerta neutro genérico,
// preservando o sinal ("há um alerta") sem verbalizar termo proibido.
function alertasSeguros(brutos: string[]): string[] {
  const out: string[] = [];
  for (const a of brutos) {
    const r = garantirLexico(a);
    out.push(r.ok ? a : "Alerta detectado no documento — verificar manualmente.");
  }
  return out;
}

// ----------------------------------------------------------------------------
// API pública do módulo: recebe docs já validados, devolve o resultado tipado.
// Lança em falha de rede/JSON/timeout — a ROTA decide o status HTTP.
// ----------------------------------------------------------------------------
export async function extrairDocumentos(
  docs: DocEntrada[]
): Promise<ResultadoVerificador> {
  const cru = await chamarAnthropic(docs);
  const obj = extrairJSON(cru) as {
    cota?: Record<string, unknown>;
    bem?: Record<string, unknown>;
    alertas?: unknown;
  };
  const c = obj.cota ?? {};
  const b = obj.bem ?? {};

  const cota: CotaExtraida = {
    administradora: str(c.administradora),
    segmento: segmento(c.segmento),
    saldo_devedor: num(c.saldo_devedor),
    parcela_atual: num(c.parcela_atual),
    parcelas_restantes: num(c.parcelas_restantes),
    contemplada: bool(c.contemplada),
    data_emissao: str(c.data_emissao),
  };
  const bem: BemGarantia = {
    tipo: tipoBem(b.tipo),
    identificacao: str(b.identificacao),
    proprietario: str(b.proprietario),
    valor_referencia: num(b.valor_referencia),
    onus: listaStr(b.onus),
  };

  return {
    ok: true,
    cota,
    bem,
    alertas: alertasSeguros(listaStr(obj.alertas)),
  };
}
