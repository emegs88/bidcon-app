"use client";
// Sub-navegação de /admin/conversas: "Conversas" (WhatsApp+Site) e "Leads"
// (interesses). Mesmo componente Button do design system (não inline
// styles como o SimuladorTabNav do /interno — aqui reusamos o padrão do
// resto do admin).
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/Button";

// PROSPERITO-ANEXO-01, Entrega 2 (item 3): entrou a terceira aba, e com ela o
// booleano `emLeads` deixou de servir. A regra agora é declarativa e a ativa é
// a de PREFIXO MAIS LONGO que casa — sem isso, "/admin/conversas" casaria com
// tudo e as três abas apareceriam acesas em "/admin/conversas/extratos".
const ABAS = [
  { href: "/admin/conversas", rotulo: "Conversas" },
  { href: "/admin/conversas/leads", rotulo: "Leads" },
  { href: "/admin/conversas/extratos", rotulo: "Extratos recebidos" },
] as const;

export function ConversasSubNav() {
  const path = usePathname();

  const ativa = ABAS.reduce<string>((melhor, aba) => {
    const casa = path === aba.href || path.startsWith(`${aba.href}/`);
    if (!casa) return melhor;
    return aba.href.length > melhor.length ? aba.href : melhor;
  }, "");

  return (
    <nav style={{ display: "flex", gap: 8 }} aria-label="Seções de Conversas">
      {ABAS.map((aba) => (
        <Button
          key={aba.href}
          href={aba.href}
          size="sm"
          variant={ativa === aba.href ? "primary" : "ghost"}
        >
          {aba.rotulo}
        </Button>
      ))}
    </nav>
  );
}
