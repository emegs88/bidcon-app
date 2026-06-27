// Indicador de carregamento reutilizável (usado pelos loading.tsx das rotas server).
import styles from "@/app/loading.module.css";

export function Loading({ label = "Carregando…" }: { label?: string }) {
  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      <div>
        <div className={styles.dotbox} aria-hidden>
          <span className={styles.dot} />
          <span className={styles.dot} />
          <span className={styles.dot} />
        </div>
        <p className={styles.label}>{label}</p>
      </div>
    </div>
  );
}
