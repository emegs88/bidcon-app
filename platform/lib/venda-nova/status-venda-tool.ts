// ============================================================================
// Tool `status_venda` (Anthropic tool use) — FATIA 1 (venda nova).
// ----------------------------------------------------------------------------
// Consulta o status da venda nova (funil vendas_novas, projeto nnv) mais
// recente do cliente da conversa atual. SEM campo de identidade no input:
// telefone NUNCA vem do texto do modelo nem de argumento que o modelo
// controla — é sempre injetado pelo handler (route.ts/cerebro.ts) via `ctx`,
// lido de interesses.telefone (site) ou wa_conversas.telefone (WhatsApp),
// nunca de texto livre da conversa. Isso fecha a porta pra um cliente tentar
// "consultar o status de outro número" digitando um telefone na mensagem
// (prompt-injection de identidade) — o modelo nem tem como pedir isso, o
// schema da tool não aceita telefone.
//
// Devolve status NEUTRO, nunca promete prazo (mesmo princípio de
// COMPLIANCE em _prompt.ts — "nunca prometa data de contemplação").
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";

export const STATUS_VENDA_TOOL = {
  name: "status_venda",
  description:
    "Consulta o status atual da venda nova (plano Disal) mais recente do cliente desta conversa, direto " +
    "no banco. Use quando o cliente perguntar 'como está meu processo/pedido/proposta'. Sem parâmetros — " +
    "a identidade do cliente já vem da conversa, nunca peça telefone pra ele.",
  input_schema: {
    type: "object",
    properties: {},
  },
} as const;

const ROTULO_STATUS: Record<string, string> = {
  LEAD: "cadastro recebido, em análise inicial",
  QUALIFICADO: "qualificado, montando a proposta certa",
  PROPOSTA: "proposta apresentada, aguardando sua decisão",
  PIX_ENVIADO: "primeira parcela enviada, aguardando confirmação",
  PAGO_1A: "primeira parcela confirmada",
  DOC_VALIDADA: "documentação validada",
  ATIVA: "cota ativa",
  CANCELADA: "cancelada",
};

export type ResultadoStatusVenda =
  | { encontrado: false }
  | { encontrado: true; status: string; rotulo: string; administradora: string | null; criadoEm: string };

/** Consulta a venda mais recente do telefone (vindo de ctx confiável — nunca
 *  do texto do modelo). Nunca lança: erro de banco vira {encontrado:false}
 *  (logado aqui) — a tool sempre devolve algo consultável pro modelo. */
export async function statusVenda(
  nnvAdmin: SupabaseClient,
  telefone: string
): Promise<ResultadoStatusVenda> {
  if (!telefone) return { encontrado: false };

  const { data, error } = await nnvAdmin
    .from("vendas_novas")
    .select("status, administradora_id, criado_em, administradoras:administradora_id(nome)")
    .eq("whatsapp", telefone)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[status_venda] erro na consulta a vendas_novas:", error);
    return { encontrado: false };
  }
  if (!data) return { encontrado: false };

  const adm = data.administradoras as { nome: string | null } | { nome: string | null }[] | null;
  const nomeAdm = Array.isArray(adm) ? adm[0]?.nome ?? null : adm?.nome ?? null;

  return {
    encontrado: true,
    status: String(data.status),
    rotulo: ROTULO_STATUS[String(data.status)] ?? String(data.status),
    administradora: nomeAdm,
    criadoEm: String(data.criado_em),
  };
}

export function resultadoParaToolStatusVenda(resultado: ResultadoStatusVenda): string {
  return JSON.stringify(resultado);
}
