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

export function brl(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
