// Etiqueta de status. As cores espelham a régua da Timeline:
// atual=info (ciano), concluído=ok (verde), encerrado/neutro=muted.
import type { ReactNode } from "react";
import styles from "./Badge.module.css";

type Tone = "info" | "ok" | "muted" | "amber";

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: Tone }) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>;
}
