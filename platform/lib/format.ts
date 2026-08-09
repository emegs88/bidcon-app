// Helpers de formatação pt-BR centralizados. `brl` é reexportado de lib/status
// para haver um único ponto de import nas telas, sem duplicar a regra de moeda.
export { brl } from "./status";

// `dataBR` REEXPORTADA de lib/data-br.ts, pelo mesmo motivo do `brl` acima: um
// ponto de import só, sem duplicar a regra.
//
// A versão que morava aqui tinha o defeito de fuso da OS de 09/08 — era
// `d.toLocaleDateString("pt-BR")`, sem `timeZone`, portanto no fuso do processo
// (UTC na Vercel). Como só mostra a DATA, o erro não aparecia como três horas:
// aparecia como UM DIA A MAIS, e só entre 21h e meia-noite de São Paulo. É o
// que /parceiro/comissoes, /parceiro/indicacoes, /admin/comissoes e
// /admin/processos/[id] — todas Server Components, medido — exibiam nessas três
// horas. Numa data de comissão isso não é cosmético.
//
// O formato na tela NÃO muda: "08/08/2026" antes e depois (medido). Só o
// instante muda.
export { dataBR } from "./data-br";

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
