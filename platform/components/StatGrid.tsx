// Grade de cartões-resumo (números por status) reutilizada por Parceiro e Admin.
// Apresentação pura: rótulo + valor + dica opcional. Sem promessas.
import { Card } from "@/components/ui/Card";
import styles from "./StatGrid.module.css";

export type Stat = { label: string; value: string | number; hint?: string };

export function StatGrid({ stats }: { stats: Stat[] }) {
  return (
    <div className={styles.grid}>
      {stats.map((s) => (
        <Card key={s.label} as="div">
          <div className={styles.value}>{s.value}</div>
          <div className={styles.label}>{s.label}</div>
          {s.hint && <div className={styles.hint}>{s.hint}</div>}
        </Card>
      ))}
    </div>
  );
}
