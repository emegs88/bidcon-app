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

// Tendência FACTUAL do dia vs. média da janela — só compara números já dados
// (sem previsão/prazo). Retorna seta + rótulo neutro para leitor de tela.
function tendenciaDoDia(hojeQtd: number, mediaDia: number): { seta: string; rotulo: string } {
  // margem de 5% da média para não oscilar por ruído mínimo.
  const margem = Math.max(0.5, mediaDia * 0.05);
  if (hojeQtd > mediaDia + margem) return { seta: "↑", rotulo: "acima da média da janela" };
  if (hojeQtd < mediaDia - margem) return { seta: "↓", rotulo: "abaixo da média da janela" };
  return { seta: "→", rotulo: "em linha com a média da janela" };
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
  const vazia = resumo.totalQtd === 0;
  const tend = tendenciaDoDia(resumo.hojeQtd, resumo.mediaDia);

  // Resumo textual para leitor de tela (as barras são decorativas/aria-hidden).
  const resumoSR = vazia
    ? `${titulo}: sem entradas de cartas na janela de ${resumo.dias} dias.`
    : `${titulo}: hoje ${resumo.hojeQtd} carta(s), ${tend.rotulo}. ` +
      `Média de ${resumo.mediaDia.toFixed(1)} por dia na janela de ${resumo.dias} dias. ` +
      `Total de ${resumo.totalQtd} carta(s) no período.`;

  return (
    <Card as="section">
      <div className={styles.balanca}>
        <div className={styles.vizHead}>
          <h2 className={styles.vizTitulo}>{titulo}</h2>
          {!vazia && (
            <span className={styles.tendencia} aria-hidden="true">
              {tend.seta} hoje {tend.rotulo}
            </span>
          )}
        </div>

        <p className={styles.srOnly}>{resumoSR}</p>

        {vazia ? (
          <p className={styles.vizVazio} aria-hidden="true">
            Sem entradas de cartas na janela.
          </p>
        ) : (
          <div className={styles.barras} aria-hidden="true">
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
        )}

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
          {resumo.pico && resumo.pico.quantidade > 0 && (
            <span>
              Pico: <b>{rotuloDia(resumo.pico.dia)}</b> · {resumo.pico.quantidade}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}
