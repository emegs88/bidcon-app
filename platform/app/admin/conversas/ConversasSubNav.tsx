"use client";
// Sub-navegação de /admin/conversas: "Conversas" (WhatsApp+Site) e "Leads"
// (interesses). Mesmo componente Button do design system (não inline
// styles como o SimuladorTabNav do /interno — aqui reusamos o padrão do
// resto do admin).
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function ConversasSubNav() {
  const path = usePathname();
  const emLeads = path.startsWith("/admin/conversas/leads");

  return (
    <nav
      style={{ display: "flex", gap: 8 }}
      aria-label="Seções de Conversas"
    >
      <Button href="/admin/conversas" size="sm" variant={emLeads ? "ghost" : "primary"}>
        Conversas
      </Button>
      <Button href="/admin/conversas/leads" size="sm" variant={emLeads ? "primary" : "ghost"}>
        Leads
      </Button>
    </nav>
  );
}
