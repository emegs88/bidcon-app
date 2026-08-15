// Casca visual da área logada: topo com marca + navegação + identificação do
// usuário + sair. Server Component (recebe nome/email já lidos via RLS na página).
// O <form action="/auth/signout"> mantém o mesmo endpoint POST já existente.
// FATIA SYNC-ID: /cartas/[id] agora é pública (visitante sem sessão) e reusa
// este shell passando nome=null — nesse caso o botão "Sair" não faz sentido
// (não há sessão pra encerrar), então ele só renderiza quando nome existe.
import type { ReactNode } from "react";
import { ShellNav } from "./ShellNav";
import { ThemeControls } from "./ThemeControls";
import styles from "./AppShell.module.css";

export function AppShell({
  nome,
  tipo,
  equipe,
  equipeAdminConsole,
  children,
}: {
  nome?: string | null;
  // "fundo" (FIDC-OFERTAS-01 · E2) ganha navegação PRÓPRIA e curta em ShellNav:
  // sem os links da área de cliente, sem /parceiro, sem /admin.
  tipo?: "cliente" | "parceiro" | "admin" | "fundo";
  equipe?: boolean;
  equipeAdminConsole?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <header className={styles.topbar} data-print="hide">
        <div className={styles.bar}>
          <a className={styles.brand} href="/">
            bid<span className={styles.brandAccent}>con</span>
          </a>
          <ShellNav tipo={tipo} equipe={equipe} equipeAdminConsole={equipeAdminConsole} />
          <div className={styles.user}>
            <ThemeControls />
            {nome && <span className={styles.hello}>{nome}</span>}
            {nome && (
              <form action="/auth/signout" method="post">
                <button type="submit" className={styles.signout}>
                  Sair
                </button>
              </form>
            )}
          </div>
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
