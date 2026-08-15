"use client";
// Navegação do topo com destaque da rota ativa. Client component só para ler
// o pathname; os links são <a> comuns (navegação normal do Next).
// Os itens variam por papel: cliente vê o básico; parceiro/admin ganham seções.
import { usePathname } from "next/navigation";
import styles from "./AppShell.module.css";

type Tipo = "cliente" | "parceiro" | "admin" | "fundo";
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

// Fundo parceiro (FIDC-OFERTAS-01 · E2). ÚNICO caso que NÃO parte de BASE — e é
// o ponto inteiro. A ordem diz "role própria — jamais enxerga /admin", e a forma
// mais barata de cumprir isso é a navegação do fundo não conter rota nenhuma que
// não seja dele: nem /admin, nem /parceiro, nem /meu-processo. As guardas de
// servidor continuam sendo quem bloqueia (`exigirPapel`, `ehAdminConsole`); esta
// lista só garante que a tela nunca CONVIDE para uma porta que vai bater na cara.
const FUNDO: Link[] = [
  { href: "/fundo", label: "Vitrine", exato: true },
  { href: "/fundo/ofertas", label: "Minhas ofertas" },
];

function linksPara(tipo?: Tipo, equipe?: boolean, equipeAdminConsole?: boolean): Link[] {
  // Antes de tudo, e sem `equipe`/`equipeAdminConsole`: um e-mail de fundo não
  // é e-mail da casa, e se um dia for, o painel do fundo não é o lugar de dizer.
  if (tipo === "fundo") return FUNDO;

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
