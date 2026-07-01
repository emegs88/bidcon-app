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

// ---------------------------------------------------------------------------
// Status de KYC (verificação de identidade do cliente). Usado no onboarding do
// cliente e no painel admin de perfis. Os rótulos descrevem o estado real da
// verificação; nada aqui promete contemplação ou aprovação de crédito.
// ---------------------------------------------------------------------------
export type StatusKYC =
  | "pendente"
  | "em_analise"
  | "verificado"
  | "rejeitado"
  | "bloqueado";

export const LABEL_STATUS_KYC: Record<StatusKYC, string> = {
  pendente: "Não enviado",
  em_analise: "Em análise",
  verificado: "Verificado",
  rejeitado: "Rejeitado",
  bloqueado: "Bloqueado",
};

export const TONE_STATUS_KYC: Record<StatusKYC, "info" | "ok" | "muted" | "amber"> = {
  pendente: "muted",
  em_analise: "amber",
  verificado: "ok",
  rejeitado: "amber",
  bloqueado: "muted",
};

// ---------------------------------------------------------------------------
// SUB-ETAPA do processo (fluxo pós-reserva, modelo Lance — migration 0014).
// Vive DENTRO dos 5 status de topo; a régua de topo (0006) não muda. Os rótulos
// descrevem o passo real do cliente; NUNCA prometem contemplação/prazo.
// ---------------------------------------------------------------------------
export type SubetapaProcesso =
  | "docs_enviados"
  | "pre_analise"
  | "sinal_pix"
  | "contrato_cota"
  | "entrada"
  | "formulario"
  | "link_transferencia"
  | "efetivacao"
  | "faturamento";

// Ordem canônica do fluxo Lance (para exibição do "próximo passo").
export const ORDEM_SUBETAPA: SubetapaProcesso[] = [
  "docs_enviados",
  "pre_analise",
  "sinal_pix",
  "contrato_cota",
  "entrada",
  "formulario",
  "link_transferencia",
  "efetivacao",
  "faturamento",
];

export const LABEL_SUBETAPA: Record<SubetapaProcesso, string> = {
  docs_enviados: "Documentos enviados",
  pre_analise: "Análise da documentação",
  sinal_pix: "Reserva da cota (sinal)",
  contrato_cota: "Assinatura do contrato da cota",
  entrada: "Pagamento da entrada",
  formulario: "Envio do formulário",
  link_transferencia: "Assinatura da transferência",
  efetivacao: "Efetivação da transferência",
  faturamento: "Faturamento",
};

export const TONE_SUBETAPA: Record<SubetapaProcesso, "info" | "ok" | "muted" | "amber"> = {
  docs_enviados: "info",
  pre_analise: "info",
  sinal_pix: "amber",
  contrato_cota: "amber",
  entrada: "amber",
  formulario: "info",
  link_transferencia: "info",
  efetivacao: "info",
  faturamento: "ok",
};

// ---------------------------------------------------------------------------
// Status de DOCUMENTO do processo (item do check-list enviado pelo cliente).
// ---------------------------------------------------------------------------
export type StatusDocumento = "pendente" | "aprovado" | "reprovado";

export const LABEL_STATUS_DOCUMENTO: Record<StatusDocumento, string> = {
  pendente: "Em análise",
  aprovado: "Aprovado",
  reprovado: "Reenviar",
};

export const TONE_STATUS_DOCUMENTO: Record<StatusDocumento, "info" | "ok" | "muted" | "amber"> = {
  pendente: "amber",
  aprovado: "ok",
  reprovado: "muted",
};

// ---------------------------------------------------------------------------
// Status do PAGAMENTO do sinal (PIX). "manual" = comprovante anexado, à espera
// de conferência da equipe (fallback sem gateway). Sem dado bancário do cliente.
// ---------------------------------------------------------------------------
export type StatusPagamento = "pendente" | "pago" | "expirado" | "manual";

export const LABEL_STATUS_PAGAMENTO: Record<StatusPagamento, string> = {
  pendente: "Aguardando pagamento",
  pago: "Pago",
  expirado: "Expirado",
  manual: "Comprovante em conferência",
};

export const TONE_STATUS_PAGAMENTO: Record<StatusPagamento, "info" | "ok" | "muted" | "amber"> = {
  pendente: "amber",
  pago: "ok",
  expirado: "muted",
  manual: "info",
};

// ---------------------------------------------------------------------------
// Status de CONTRATO (serviço e cota).
// ---------------------------------------------------------------------------
export type StatusContrato = "gerado" | "enviado" | "assinado" | "cancelado";

export const LABEL_STATUS_CONTRATO: Record<StatusContrato, string> = {
  gerado: "Disponível",
  enviado: "Enviado",
  assinado: "Assinado",
  cancelado: "Cancelado",
};

export const TONE_STATUS_CONTRATO: Record<StatusContrato, "info" | "ok" | "muted" | "amber"> = {
  gerado: "info",
  enviado: "amber",
  assinado: "ok",
  cancelado: "muted",
};

export function brl(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
