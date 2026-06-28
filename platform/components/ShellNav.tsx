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

function linksPara(tipo?: Tipo): Link[] {
  if (tipo === "admin") return [...BASE, ...ADMIN];
  if (tipo === "parceiro") return [...BASE, ...PARCEIRO];
  return BASE;
}

export function ShellNav({ tipo }: { tipo?: Tipo }) {
  const path = usePathname();
  const links = linksPara(tipo);
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
