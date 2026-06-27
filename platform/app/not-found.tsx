// 404 global. Server Component. Casca visual mínima, sem vazar caminhos internos.
import { Button } from "@/components/ui/Button";
import styles from "./fallback.module.css";

export default function NotFound() {
  return (
    <main className={styles.wrap}>
      <div className={styles.box}>
        <div className={styles.emoji} aria-hidden>
          🧭
        </div>
        <h1 className={styles.title}>Página não encontrada</h1>
        <p className={styles.desc}>
          O endereço não existe ou você não tem acesso a ele. Volte ao início
          para continuar.
        </p>
        <div className={styles.acoes}>
          <Button href="/">Voltar ao início</Button>
        </div>
      </div>
    </main>
  );
}
