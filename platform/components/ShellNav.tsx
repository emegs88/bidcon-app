"use client";
// Navegação do topo com destaque da rota ativa. Client component só para ler
// o pathname; os links são <a> comuns (navegação normal do Next).
import { usePathname } from "next/navigation";
import styles from "./AppShell.module.css";

const LINKS = [
  { href: "/", label: "Início" },
  { href: "/meu-processo", label: "Meu processo" },
  { href: "/cartas", label: "Cartas" },
];

export function ShellNav() {
  const path = usePathname();
  return (
    <nav className={styles.nav}>
      {LINKS.map((l) => {
        const ativo = l.href === "/" ? path === "/" : path.startsWith(l.href);
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
