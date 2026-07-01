// Balança de cartas — fluxo diário de ENTRADA (quantas cartas entram por dia).
// Componente de apresentação PURA (server-safe): recebe a série já agregada por
// lib/cartas-fluxo.fluxoDiario() e desenha barras proporcionais + um resumo.
// Sem promessas/prazos; é uma métrica operacional interna (admin/parceiro).
import { Card } from "@/components/ui/Card";
import { brl } from "@/lib/status";
import type { DiaFluxo, ResumoFluxo } from "@/lib/cartas-fluxo";
import styles from "@/app/admin/painel.module.css";

// dia "YYYY-MM-DD" → "DD/MM" curto para o eixo.
function rotuloDia(dia: string): string {
  const [, m, d] = dia.split("-");
  return d && m ? `${d}/${m}` : dia;
}

export function Balanca({
  serie,
  resumo,
  titulo = "Balança de cartas",
}: {
  serie: DiaFluxo[];
  resumo: ResumoFluxo;
  titulo?: string;
}) {
  const maxQtd = Math.max(1, ...serie.map((d) => d.quantidade));
  const ultimoIdx = serie.length - 1;

  return (
    <Card as="section">
      <div className={styles.balanca}>
        <h2 style={{ margin: 0, fontSize: 16 }}>{titulo}</h2>

        <div className={styles.barras} role="img" aria-label="Entrada de cartas por dia">
          {serie.map((d, i) => {
            const altura = Math.round((d.quantidade / maxQtd) * 100);
            const hoje = i === ultimoIdx;
            return (
              <div key={d.dia} className={styles.barraCol}>
                <div
                  className={`${styles.barra} ${hoje ? styles.barraHoje : ""}`}
                  style={{ height: `${Math.max(2, altura)}%` }}
                  title={`${rotuloDia(d.dia)}: ${d.quantidade} carta(s) · ${brl(d.valorCredito)}`}
                />
                <span className={styles.barraDia}>{rotuloDia(d.dia)}</span>
              </div>
            );
          })}
        </div>

        <div className={styles.balancaResumo}>
          <span>
            Hoje: <b>{resumo.hojeQtd}</b> carta(s)
          </span>
          <span>
            Média/dia: <b>{resumo.mediaDia.toFixed(1)}</b>
          </span>
          <span>
            Janela ({resumo.dias}d): <b>{resumo.totalQtd}</b> · {brl(resumo.totalCredito)}
          </span>
        </div>
      </div>
    </Card>
  );
}
