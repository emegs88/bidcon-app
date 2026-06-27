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
