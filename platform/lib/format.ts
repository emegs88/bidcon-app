// Helpers de formatação pt-BR centralizados. `brl` é reexportado de lib/status
// para haver um único ponto de import nas telas, sem duplicar a regra de moeda.
export { brl } from "./status";

export function dataBR(v: string | number | Date | null | undefined): string {
  if (v == null) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

// Mensagem neutra (sem promessa) para o CTA de WhatsApp da vitrine.
export function linkWhatsApp(numero: string, texto: string): string {
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

// ---------------------------------------------------------------------------
// Mascaramento de documentos (LGPD por design). Em TODAS as telas — inclusive
// admin — CPF/CNPJ aparecem mascarados por padrão; o valor cru fica no banco.
// Mantém só os 2 últimos dígitos para conferência ("***.***.***-NN").
// ---------------------------------------------------------------------------
export function mascararCpf(cpf: string | null | undefined): string {
  const d = (cpf ?? "").replace(/\D/g, "");
  if (d.length !== 11) return cpf ? "•••" : "—";
  return `***.***.***-${d.slice(9)}`;
}

export function mascararCnpj(cnpj: string | null | undefined): string {
  const d = (cnpj ?? "").replace(/\D/g, "");
  if (d.length !== 14) return cnpj ? "•••" : "—";
  return `**.***.***/****-${d.slice(12)}`;
}

// ---------------------------------------------------------------------------
// CPF por extenso (SEM redigir) — uso restrito a documentos que exigem
// qualificação civil completa das partes (ex.: corpo do contrato assinado
// pelo próprio cliente, lib/contratos.ts). O cliente só vê o próprio CPF
// nessas telas; para listas/telas administrativas continue usando
// `mascararCpf` acima (LGPD por design nesses contextos).
// ---------------------------------------------------------------------------
export function formatarCpf(cpf: string | null | undefined): string {
  const d = (cpf ?? "").replace(/\D/g, "");
  if (d.length !== 11) return "—";
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}
