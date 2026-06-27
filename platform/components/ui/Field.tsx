// Campo de formulário padronizado: label + input/select + erro opcional.
// Evita CSS inline nos forms de parceiro/admin. Client-agnostic (sem estado).
import type { ReactNode, InputHTMLAttributes, SelectHTMLAttributes } from "react";
import styles from "./Field.module.css";

type Base = { label: string; hint?: ReactNode; error?: ReactNode };

export function Field({
  label,
  hint,
  error,
  id,
  ...rest
}: Base & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={styles.field} htmlFor={id}>
      <span className={styles.label}>{label}</span>
      <input id={id} className={styles.input} {...rest} />
      {hint && !error && <span className={styles.hint}>{hint}</span>}
      {error && <span className={styles.error}>{error}</span>}
    </label>
  );
}

export function SelectField({
  label,
  hint,
  error,
  id,
  children,
  ...rest
}: Base & SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <label className={styles.field} htmlFor={id}>
      <span className={styles.label}>{label}</span>
      <select id={id} className={styles.input} {...rest}>
        {children}
      </select>
      {hint && !error && <span className={styles.hint}>{hint}</span>}
      {error && <span className={styles.error}>{error}</span>}
    </label>
  );
}
