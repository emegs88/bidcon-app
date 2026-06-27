// Superfície padrão da área logada. Pode virar link interativo via href.
import type { ReactNode } from "react";
import styles from "./Card.module.css";

export function Card({
  children,
  href,
  as = "section",
}: {
  children: ReactNode;
  href?: string;
  as?: "section" | "div" | "li";
}) {
  if (href) {
    return (
      <a className={`${styles.card} ${styles.link}`} href={href}>
        {children}
      </a>
    );
  }
  const Tag = as;
  return <Tag className={styles.card}>{children}</Tag>;
}
