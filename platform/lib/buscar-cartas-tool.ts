// ============================================================================
// Tool `buscar_cartas` (Anthropic tool use) — FATIA F4-TOOL.
// ----------------------------------------------------------------------------
// Motivação (auditoria de 19/07): a Valentina negou estoque que existia de
// verdade ("menores começam perto de 400 mil") porque só enxergava o recorte
// ESTÁTICO injetado no system prompt (blocoCartas() em cerebro.ts/route.ts —
// top ~20 cartas por tipo, ordenadas por ágio/custo). Uma carta de crédito
// menor (ex.: REF 690/652, 116k) podia estar fora desse recorte e o modelo
// concluía, incorretamente, que "não existe" — sem nunca ter consultado o
// banco de verdade.
//
// Esta tool dá ao modelo uma busca de VERDADE, com filtro, contra
// `vw_carousel_cartas` — a MESMA view pública já usada pela vitrine/RLS
// (sem coluna sensível: nunca expõe id interno de cliente, CCB, custo de
// aquisição etc. — só as colunas comerciais). Definição e executor são
// ÚNICOS aqui e importados tanto por lib/whatsapp/cerebro.ts (WhatsApp)
// quanto por app/api/atende/route.ts (site) — mesmo padrão de reuso já usado
// para sanitizarCompliance/montarSystem (ver cabeçalho de cerebro.ts).
//
// GUARDRAIL (texto real vai em app/api/atende/_prompt.ts, PROMPT_BASE):
//   - nunca negar estoque numa faixa sem ter chamado esta tool com aqueles
//     filtros primeiro;
//   - tool vazia -> avisar que vai confirmar com a equipe e emitir o
//     marcador [[ESCALAR]] (ver MARCADOR_ESCALAR em _prompt.ts), que os
//     handlers (cerebro.ts/route.ts) traduzem em status='humano' — garantia
//     de sistema, não promessa solta do modelo;
//   - valores sempre EXATAMENTE como a tool devolveu, nunca recalculados.
//
// TOM-02: `seloCustoExcelente` (booleano) é derivado aqui a partir de
// bidcon_agio_120 (via vw_carousel_cartas, migration 0060) — MESMA regra já
// usada em produção por components/CartaCard.tsx (agio_120 > 0). O valor
// cru do ágio é lido da view mas NUNCA sai desta função: nem no tipo
// CartaEncontrada, nem no JSON devolvido ao modelo — custo_am (TIR) é a
// única métrica de custo exposta, ágio confunde a comparação (card do site
// só mostra o selo textual, mesma regra que já valia pro recibo do
// WhatsApp desde a TOM-01).
//
// Loop de tool-use: cada chamador (cerebro.ts/route.ts) limita a NO MÁXIMO
// 2 rodadas de tool_use por turno — cap aplicado no laço de chamada à
// Anthropic, não aqui (este módulo só define a tool e executa UMA busca).
// ============================================================================
import { createXtvClient } from "@/lib/supabase-xtv";

/** Definição da tool no formato exigido pela Anthropic Messages API
 *  (`tools: [...]` no corpo do POST /v1/messages). */
export const BUSCAR_CARTAS_TOOL = {
  name: "buscar_cartas",
  description:
    "Busca cartas de crédito contempladas disponíveis AGORA, direto no banco (dados reais e completos — " +
    "nunca só a amostra do bloco estático do system prompt). Use SEMPRE que o cliente mencionar um teto de " +
    "crédito e/ou de entrada, e SEMPRE antes de dizer que não existe carta numa faixa — nunca negue estoque " +
    "sem ter chamado esta tool com aqueles filtros primeiro. Filtros são opcionais e combináveis; sem filtro " +
    "nenhum, devolve as cartas de melhor custo em geral (mesmo critério da vitrine).",
  input_schema: {
    type: "object",
    properties: {
      tipo: {
        type: "string",
        enum: ["imovel", "veiculo"],
        description: "Tipo de bem procurado. Omitir para buscar os dois tipos.",
      },
      credito_max: {
        type: "number",
        description: "Teto de CRÉDITO da carta em reais (número puro), se o cliente informou um valor.",
      },
      entrada_max: {
        type: "number",
        description: "Teto de ENTRADA em reais (número puro), se o cliente informou um valor.",
      },
      limite: {
        type: "integer",
        description: "Quantas cartas devolver, no máximo. Padrão 5, teto 10.",
      },
    },
  },
} as const;

export type BuscarCartasInput = {
  tipo?: unknown;
  credito_max?: unknown;
  entrada_max?: unknown;
  limite?: unknown;
};

export type CartaEncontrada = {
  id: string;
  ref: number | null;
  tipo: string;
  credito: number;
  entrada: number;
  parcela: number;
  parcelas: number;
  custo_am: number;
  administradora: string | null;
  /** TOM-02: mesma regra de components/CartaCard.tsx (bidcon_agio_120 > 0).
   *  Só o booleano — o valor cru do ágio NUNCA é exposto aqui (confunde a
   *  comparação; custo_am/TIR é a métrica canônica mostrada ao cliente). */
  seloCustoExcelente: boolean;
};

/** Executa a busca de verdade contra vw_carousel_cartas (mesma view pública
 *  da vitrine — só colunas comerciais, nada sensível). Nunca lança: filtro
 *  fora do formato esperado é simplesmente ignorado (busca sem aquele
 *  filtro); erro de banco volta como lista vazia (logado aqui) — a tool
 *  SEMPRE devolve algo consultável pro modelo, nunca derruba o turno. */
export async function buscarCartas(
  db: ReturnType<typeof createXtvClient>,
  input: BuscarCartasInput
): Promise<CartaEncontrada[]> {
  const tipo = input.tipo === "imovel" || input.tipo === "veiculo" ? input.tipo : null;

  const numPositivo = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
  const creditoMax = numPositivo(input.credito_max);
  const entradaMax = numPositivo(input.entrada_max);

  const limiteBruto =
    typeof input.limite === "number" && Number.isFinite(input.limite)
      ? Math.round(input.limite)
      : 5;
  const limite = Math.min(10, Math.max(1, limiteBruto || 5));

  let q = db
    .from("vw_carousel_cartas")
    .select("id, ref, tipo, credito, entrada, parcela, parcelas, custo_am, administradora, agio_120")
    .order("custo_am", { ascending: true })
    .limit(limite);

  if (tipo) q = q.eq("tipo", tipo);
  if (creditoMax !== null) q = q.lte("credito", creditoMax);
  if (entradaMax !== null) q = q.lte("entrada", entradaMax);

  const { data, error } = await q;
  if (error || !data) {
    console.error("[buscar_cartas] erro na consulta a vw_carousel_cartas:", error);
    return [];
  }

  return data.map((c) => ({
    id: String(c.id),
    ref: c.ref === null || c.ref === undefined ? null : Number(c.ref),
    tipo: String(c.tipo),
    credito: Number(c.credito),
    entrada: Number(c.entrada),
    parcela: Number(c.parcela),
    parcelas: Number(c.parcelas),
    custo_am: Number(c.custo_am),
    administradora: c.administradora ?? null,
    seloCustoExcelente: Number((c as { agio_120?: unknown }).agio_120) > 0,
  }));
}

/** Corpo do tool_result devolvido ao modelo — JSON simples e explícito sobre
 *  contagem (facilita o modelo perceber "0 encontradas" sem ambiguidade e
 *  seguir o guardrail de não negar estoque por conta própria). */
export function resultadoParaTool(cartas: CartaEncontrada[]): string {
  return JSON.stringify({ total: cartas.length, cartas });
}
