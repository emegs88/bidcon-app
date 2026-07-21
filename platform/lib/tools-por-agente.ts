// ============================================================================
// tools-por-agente.ts — dispatcher único de `tools` (Anthropic Messages API)
// por persona ativa. Usado por route.ts (site) e cerebro.ts (WhatsApp).
// ----------------------------------------------------------------------------
// Antes da FATIA 1 (venda nova), os dois handlers tinham `tools: [BUSCAR_CARTAS_TOOL]`
// hardcoded — igual pras 7 personas, sempre. Esta função generaliza isso SEM
// mudar o comportamento das 7 personas existentes: `toolsParaAgente('valentina')`
// etc. devolve exatamente `[BUSCAR_CARTAS_TOOL]`, mesma referência de sempre.
//
// Só o agente novo (`vendanova`) ganha um conjunto diferente de tools — as
// três da FATIA 1 (buscar_planos/salvar_lead/status_venda), definidas em
// lib/venda-nova/*.ts. Ele NÃO ganha buscar_cartas: quando o cliente sem
// entrada precisa da alternativa de carta contemplada, o Prosperito (vendanova)
// só descreve a opção e passa o bastão pra Valentina (##AGENTE:valentina##,
// ver AGENTES.vendanova em _prompt.ts) — quem busca de verdade é ela.
// ============================================================================
import { BUSCAR_CARTAS_TOOL } from "@/lib/buscar-cartas-tool";
import { BUSCAR_PLANOS_TOOL } from "@/lib/venda-nova/buscar-planos-tool";
import { SALVAR_LEAD_TOOL } from "@/lib/venda-nova/salvar-lead-tool";
import { STATUS_VENDA_TOOL } from "@/lib/venda-nova/status-venda-tool";
import type { AgenteId } from "@/app/api/atende/_prompt";

const TOOLS_CARTAS = [BUSCAR_CARTAS_TOOL];
const TOOLS_VENDA_NOVA = [BUSCAR_PLANOS_TOOL, SALVAR_LEAD_TOOL, STATUS_VENDA_TOOL];

/** Devolve o array `tools` (formato Anthropic) certo pra persona ativa.
 *  Default (todas as 7 personas pré-existentes): [BUSCAR_CARTAS_TOOL], igual
 *  ao hardcode anterior — comportamento idêntico, zero regressão.
 *  vendanova: as três tools da venda nova, sem buscar_cartas. */
export function toolsParaAgente(agente: AgenteId): readonly unknown[] {
  if (agente === "vendanova") return TOOLS_VENDA_NOVA;
  return TOOLS_CARTAS;
}
