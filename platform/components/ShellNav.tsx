"use client";
// Navegação do topo com destaque da rota ativa. Client component só para ler
// o pathname; os links são <a> comuns (navegação normal do Next).
// Os itens variam por papel: cliente vê o básico; parceiro/admin ganham seções.
import { usePathname } from "next/navigation";
import styles from "./AppShell.module.css";

type Tipo = "cliente" | "parceiro" | "admin";
// `exato` marca raízes de seção (/, /parceiro, /admin) que não devem acender
// quando uma sub-rota está ativa (ex.: /parceiro/carteira).
type Link = { href: string; label: string; exato?: boolean };

const BASE: Link[] = [
  { href: "/", label: "Início", exato: true },
  { href: "/meu-processo", label: "Meu processo" },
  { href: "/cartas", label: "Cartas" },
  { href: "/reservar", label: "Reservar" },
  { href: "/buscar", label: "Buscar" },
];

const PARCEIRO: Link[] = [
  { href: "/parceiro", label: "Painel", exato: true },
  { href: "/parceiro/carteira", label: "Carteira" },
  { href: "/parceiro/indicacoes", label: "Indicações" },
  { href: "/parceiro/comissoes", label: "Comissões" },
];

const ADMIN: Link[] = [
  { href: "/admin", label: "Admin", exato: true },
  { href: "/admin/perfis", label: "Perfis" },
  { href: "/admin/audit-logs", label: "Auditoria" },
];

// Link exclusivo da equipe Prospere (gate por e-mail @prospere.com.br, decidido
// no servidor). Não depende de `tipo`: um cliente da equipe também o vê, um admin
// fora da equipe não. A RLS da migration 0013 reforça o sigilo no banco.
const EQUIPE: Link[] = [{ href: "/prospere-ancora", label: "byAncora" }];

// Console admin (FATIA F1 — importador + fila de revisão), gate por allowlist
// de e-mail (BIDCON_ADMIN_EMAILS, lib/admin-console.ts). Independente de
// `tipo`/`equipe`: é um allowlist próprio, sem sistema de papéis (F3 futura).
const ADMIN_CONSOLE: Link[] = [
  { href: "/admin/importar", label: "Importar" },
  { href: "/admin/revisao", label: "Revisão" },
  { href: "/admin/conversas", label: "Conversas" },
];

function linksPara(tipo?: Tipo, equipe?: boolean, equipeAdminConsole?: boolean): Link[] {
  let links: Link[];
  if (tipo === "admin") links = [...BASE, ...ADMIN];
  else if (tipo === "parceiro") links = [...BASE, ...PARCEIRO];
  else links = [...BASE];
  if (equipe) links = [...links, ...EQUIPE];
  if (equipeAdminConsole) links = [...links, ...ADMIN_CONSOLE];
  return links;
}

export function ShellNav({
  tipo,
  equipe,
  equipeAdminConsole,
}: {
  tipo?: Tipo;
  equipe?: boolean;
  equipeAdminConsole?: boolean;
}) {
  const path = usePathname();
  const links = linksPara(tipo, equipe, equipeAdminConsole);
  return (
    <nav className={styles.nav}>
      {links.map((l) => {
        const ativo = l.exato ? path === l.href : path.startsWith(l.href);
        return (
          <a
            key={l.href}
            href={l.href}
            className={`${styles.navLink} ${ativo ? styles.navActive : ""}`}
            aria-current={ativo ? "page" : undefined}
          >
            {l.label}
          </a>
        );
      })}
    </nav>
  );
}
