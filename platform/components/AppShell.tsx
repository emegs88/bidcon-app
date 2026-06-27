// Casca visual da área logada: topo com marca + navegação + identificação do
// usuário + sair. Server Component (recebe nome/email já lidos via RLS na página).
// O <form action="/auth/signout"> mantém o mesmo endpoint POST já existente.
import type { ReactNode } from "react";
import { ShellNav } from "./ShellNav";
import styles from "./AppShell.module.css";

export function AppShell({
  nome,
  tipo,
  children,
}: {
  nome?: string | null;
  tipo?: "cliente" | "parceiro" | "admin";
  children: ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.bar}>
          <a className={styles.brand} href="/">
            bid<span className={styles.brandAccent}>con</span>
          </a>
          <ShellNav tipo={tipo} />
          <div className={styles.user}>
            {nome && <span className={styles.hello}>{nome}</span>}
            <form action="/auth/signout" method="post">
              <button type="submit" className={styles.signout}>
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
