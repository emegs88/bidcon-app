// Rótulos PT-BR dos status de processo (aprovados pelo Emerson).
// Compliance: descreve o processo real; "Em análise na administradora" deixa
// claro que quem analisa é a administradora do consórcio, não a Bidcon.
// NUNCA redigir como "aprovado" / "garantido".

export type StatusProcesso =
  | "reservada"
  | "documentacao"
  | "analise_administradora"
  | "transferencia"
  | "concluido"
  | "cancelado";

// Ordem da régua (cancelado fica fora — tratado à parte).
export const ORDEM_STATUS: StatusProcesso[] = [
  "reservada",
  "documentacao",
  "analise_administradora",
  "transferencia",
  "concluido",
];

export const LABEL_STATUS: Record<StatusProcesso, string> = {
  reservada: "Reservada",
  documentacao: "Documentação",
  analise_administradora: "Em análise na administradora",
  transferencia: "Transferência",
  concluido: "Concluído",
  cancelado: "Processo encerrado",
};

export const LABEL_TIPO_BEM: Record<string, string> = {
  imovel: "Imóvel",
  veiculo: "Veículo",
};

// Tom do Badge para status de PROCESSO (atual=info, concluído=ok, encerrado=muted).
export const TONE_STATUS_PROCESSO: Record<StatusProcesso, "info" | "ok" | "muted" | "amber"> = {
  reservada: "amber",
  documentacao: "info",
  analise_administradora: "info",
  transferencia: "info",
  concluido: "ok",
  cancelado: "muted",
};

// ---------------------------------------------------------------------------
// Status de CARTA (estoque/carteira). Inclui 'indisponivel' (migration 0004).
// "vendida" descreve o estado da cota; nunca promete contemplação.
// ---------------------------------------------------------------------------
export type StatusCarta = "disponivel" | "reservada" | "vendida" | "indisponivel";

export const LABEL_STATUS_CARTA: Record<StatusCarta, string> = {
  disponivel: "Disponível",
  reservada: "Reservada",
  vendida: "Vendida",
  indisponivel: "Indisponível",
};

export const TONE_STATUS_CARTA: Record<StatusCarta, "info" | "ok" | "muted" | "amber"> = {
  disponivel: "ok",
  reservada: "amber",
  vendida: "info",
  indisponivel: "muted",
};

// ---------------------------------------------------------------------------
// Status de COMISSÃO. A plataforma só RASTREIA o status (sem dado bancário).
// ---------------------------------------------------------------------------
export type StatusComissao = "prevista" | "liberada" | "paga" | "cancelada";

export const LABEL_STATUS_COMISSAO: Record<StatusComissao, string> = {
  prevista: "Prevista",
  liberada: "Liberada",
  paga: "Paga",
  cancelada: "Cancelada",
};

export const TONE_STATUS_COMISSAO: Record<StatusComissao, "info" | "ok" | "muted" | "amber"> = {
  prevista: "amber",
  liberada: "info",
  paga: "ok",
  cancelada: "muted",
};

// ---------------------------------------------------------------------------
// Status de PERFIL (usado no painel admin de parceiros).
// ---------------------------------------------------------------------------
export type StatusPerfilLabel = "ativo" | "pendente_aprovacao" | "suspenso";

export const LABEL_STATUS_PERFIL: Record<StatusPerfilLabel, string> = {
  ativo: "Ativo",
  pendente_aprovacao: "Pendente de aprovação",
  suspenso: "Suspenso",
};

export const TONE_STATUS_PERFIL: Record<StatusPerfilLabel, "info" | "ok" | "muted" | "amber"> = {
  ativo: "ok",
  pendente_aprovacao: "amber",
  suspenso: "muted",
};

export function brl(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
