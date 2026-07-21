// ============================================================================
// Tool `salvar_lead` (Anthropic tool use) — FATIA 1 (venda nova).
// ----------------------------------------------------------------------------
// Grava/enriquece o lead do funil de venda nova (vendas_novas, projeto nnv).
// SEM campo whatsapp/telefone no input do modelo (ajuste obrigatório #5 —
// aprovação condicional do Emerson): o executor recebe telefone via `ctx`
// injetado pelo handler (route.ts/cerebro.ts, lido de interesses.telefone
// ou wa_conversas.telefone), NUNCA do texto do modelo — mesmo padrão de
// identidade confiável de processarReservaCarta em route.ts.
//
// Exporta duas coisas:
//   - SALVAR_LEAD_TOOL + executarSalvarLead: a tool chamável pelo modelo.
//   - salvarLead: função pura reaproveitável como hook automático de
//     segurança pós-turno (idempotente — nunca duplica se o modelo já
//     chamou a tool nesta mesma resposta).
//
// Ajuste obrigatório #3 (dedup vira ENRIQUECIMENTO, não só bloqueio):
//   1. Busca por telefone com status IN ('LEAD','QUALIFICADO','PROPOSTA',
//      'PIX_ENVIADO') nos últimos 30 dias.
//   2. Achou -> UPDATE só nos campos hoje vazios (nunca sobrescreve campo já
//      preenchido). atualizado_em cuida do trigger existente
//      (vendas_novas_touch).
//   3. Não achou (ou o status mais recente é ATIVA/CANCELADA, que a query já
//      exclui por não estar na lista acima) -> INSERT de linha nova
//      (recompra é lead novo).
//
// Campo `objetivo` (o que o cliente quer comprar) grava direto na coluna
// vendas_novas.objetivo (text, nullable — migration 0022, aplicada em
// produção em paralelo a este trabalho). Não usa `cod_bem` — essa coluna
// é outra coisa (código/tipo do bem já definido na negociação), permanece
// fora do escopo desta fatia.
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarEventoGA4, GA4_EVENTOS } from "@/lib/ga4";

export const SALVAR_LEAD_TOOL = {
  name: "salvar_lead",
  description:
    "Salva ou atualiza o lead do cliente no funil de venda nova. Chame assim que souber nome + pelo menos " +
    "um dado de qualificação (objetivo do bem, crédito de interesse ou administradora). Pode chamar de novo " +
    "na mesma conversa conforme descobrir mais dados — a tool enriquece o cadastro, nunca duplica. NÃO peça " +
    "telefone/whatsapp: a identidade do cliente já vem da conversa.",
  input_schema: {
    type: "object",
    properties: {
      nome: { type: "string", description: "Nome do cliente." },
      origem: {
        type: "string",
        description: "Origem do lead (ex.: 'site', 'whatsapp', nome da campanha se souber).",
      },
      objetivo: {
        type: "string",
        description: "O que o cliente quer comprar (ex.: 'imovel', 'veiculo', descrição curta do bem).",
      },
      credito: { type: "number", description: "Crédito de interesse em reais (número puro), se souber." },
      administradora: {
        type: "string",
        description: "Administradora de interesse (ex.: 'Disal'), se já definida.",
      },
      pais_residencia: {
        type: "string",
        description: "País de residência do cliente. Padrão 'BR' se não informado.",
      },
    },
    required: ["nome", "origem"],
  },
} as const;

export type SalvarLeadInput = {
  nome?: unknown;
  origem?: unknown;
  objetivo?: unknown;
  credito?: unknown;
  administradora?: unknown;
  pais_residencia?: unknown;
};

export type CtxLead = {
  telefone: string;
  utm?: Record<string, unknown> | null;
};

export type DadosLead = {
  telefone: string;
  nome?: string | null;
  origem: string;
  objetivo?: string | null;
  credito?: number | null;
  administradoraNome?: string | null;
  utm?: Record<string, unknown> | null;
  paisResidencia?: string | null;
};

export type ResultadoSalvarLead =
  | { ok: true; modo: "enriquecido" | "criado"; id: string }
  | { ok: false; erro: string };

const STATUS_ENRIQUECIVEIS = ["LEAD", "QUALIFICADO", "PROPOSTA", "PIX_ENVIADO"];

/** Função pura reaproveitável (tool do modelo E hook automático pós-turno).
 *  Nunca lança: erro de banco vira {ok:false, erro} (logado aqui). */
export async function salvarLead(
  nnvAdmin: SupabaseClient,
  dados: DadosLead
): Promise<ResultadoSalvarLead> {
  if (!dados.telefone) {
    return { ok: false, erro: "telefone obrigatório (via ctx, nunca do texto do modelo)." };
  }

  try {
    // Resolve administradora (nome -> id) se informada; não achar não é erro
    // fatal — só não preenche esse campo (nunca inventa um id).
    let administradoraId: string | null = null;
    if (dados.administradoraNome) {
      const { data: adm } = await nnvAdmin
        .from("administradoras")
        .select("id")
        .ilike("nome", dados.administradoraNome)
        .maybeSingle();
      administradoraId = adm?.id ?? null;
    }

    const trintaDiasAtras = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: existente, error: erroSelect } = await nnvAdmin
      .from("vendas_novas")
      .select("id, nome, objetivo, credito, administradora_id, utm, pais_residencia")
      .eq("whatsapp", dados.telefone)
      .in("status", STATUS_ENRIQUECIVEIS)
      .gte("criado_em", trintaDiasAtras)
      .order("criado_em", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (erroSelect) {
      console.error("[salvar_lead] erro ao buscar lead existente:", erroSelect);
      return { ok: false, erro: "erro ao consultar lead existente." };
    }

    if (existente) {
      // Enriquece: só campos hoje vazios. Nunca sobrescreve valor já preenchido.
      const patch: Record<string, unknown> = {};
      if (!existente.nome && dados.nome) patch.nome = dados.nome;
      if (!existente.objetivo && dados.objetivo) patch.objetivo = dados.objetivo;
      if (existente.credito === null && dados.credito != null) patch.credito = dados.credito;
      if (!existente.administradora_id && administradoraId) patch.administradora_id = administradoraId;
      if (!existente.utm && dados.utm) patch.utm = dados.utm;
      if (!existente.pais_residencia && dados.paisResidencia) patch.pais_residencia = dados.paisResidencia;

      if (Object.keys(patch).length === 0) {
        return { ok: true, modo: "enriquecido", id: existente.id };
      }
      const { error: erroUpdate } = await nnvAdmin
        .from("vendas_novas")
        .update(patch)
        .eq("id", existente.id);
      if (erroUpdate) {
        console.error("[salvar_lead] erro ao enriquecer lead:", erroUpdate);
        return { ok: false, erro: "erro ao atualizar lead." };
      }
      return { ok: true, modo: "enriquecido", id: existente.id };
    }

    // Não achou lead enriquecível (novo cliente, ou o mais recente já virou
    // ATIVA/CANCELADA — recompra é lead novo) -> INSERT.
    const { data: novo, error: erroInsert } = await nnvAdmin
      .from("vendas_novas")
      .insert({
        whatsapp: dados.telefone,
        nome: dados.nome || "",
        lead_origem: dados.origem,
        objetivo: dados.objetivo ?? null,
        credito: dados.credito ?? null,
        administradora_id: administradoraId,
        utm: dados.utm ?? null,
        pais_residencia: dados.paisResidencia || "BR",
        status: "LEAD",
      })
      .select("id")
      .single();
    if (erroInsert || !novo) {
      console.error("[salvar_lead] erro ao criar lead:", erroInsert);
      return { ok: false, erro: "erro ao criar lead." };
    }

    // GA4: só no insert novo, não no enriquecimento (evita contar o mesmo
    // lead várias vezes conforme a conversa evolui).
    void enviarEventoGA4(GA4_EVENTOS.LEAD_CRIADO, { origem: dados.origem }, dados.telefone);

    return { ok: true, modo: "criado", id: novo.id };
  } catch (e) {
    console.error("[salvar_lead] falha inesperada:", e);
    return { ok: false, erro: "falha inesperada ao salvar lead." };
  }
}

/** Adapta o input bruto da tool (controlado pelo modelo, exceto telefone/utm
 *  que vêm de ctx) para DadosLead e chama salvarLead. */
export async function executarSalvarLead(
  nnvAdmin: SupabaseClient,
  input: SalvarLeadInput,
  ctx: CtxLead
): Promise<ResultadoSalvarLead> {
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;

  return salvarLead(nnvAdmin, {
    telefone: ctx.telefone,
    nome: str(input.nome),
    origem: str(input.origem) ?? "desconhecida",
    objetivo: str(input.objetivo),
    credito: num(input.credito),
    administradoraNome: str(input.administradora),
    utm: ctx.utm ?? null,
    paisResidencia: str(input.pais_residencia),
  });
}

export function resultadoParaToolSalvarLead(resultado: ResultadoSalvarLead): string {
  return JSON.stringify(resultado);
}
