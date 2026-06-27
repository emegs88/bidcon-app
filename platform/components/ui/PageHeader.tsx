// Cabeçalho de página: link de volta opcional + título + subtítulo + ação.
import type { ReactNode } from "react";
import styles from "./PageHeader.module.css";

export function PageHeader({
  title,
  subtitle,
  backHref,
  backLabel = "Início",
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  backHref?: string;
  backLabel?: string;
  action?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      {backHref && (
        <a className={styles.back} href={backHref}>
          ← {backLabel}
        </a>
      )}
      <div className={styles.row}>
        <h1 className={styles.title}>{title}</h1>
        {action && <div className={styles.action}>{action}</div>}
      </div>
      {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
    </header>
  );
}
