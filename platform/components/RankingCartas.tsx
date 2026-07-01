// RankingCartas — top-N de cartas por score composto (custo baixo + novidade).
// USO INTERNO (admin/parceiro): ordena por "melhor" e mostra custo efetivo, o
// que é COMERCIAL e NUNCA pode ir ao cliente. O componente não é importado por
// nenhuma tela de cliente. Apresentação pura; a ordenação/score vem de
// lib/cartas-fluxo.rankearCartas().
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { brl } from "@/lib/status";
import { LABEL_TIPO_BEM } from "@/lib/status";
import { fmtCustoEfetivo } from "@/lib/custo-efetivo";
import type { CartaRankeada } from "@/lib/cartas-fluxo";
import styles from "@/app/admin/painel.module.css";

// cada carta pode trazer `tipo` (opcional) para compor o título.
type CartaRank = CartaRankeada & { tipo?: string };

export function RankingCartas({
  cartas,
  titulo = "Ranking de cartas",
  hrefBase,
  mostrarCusto = true,
}: {
  cartas: CartaRank[];
  titulo?: string;
  hrefBase?: string; // ex.: "/admin/cartas" → linka cada item por id
  mostrarCusto?: boolean;
}) {
  return (
    <Card as="section">
      <div className={styles.balanca}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>{titulo}</h2>
          <span className={styles.rankMeta}>uso interno</span>
        </div>

        {cartas.length === 0 ? (
          <p className={styles.rankMeta} style={{ margin: 0 }}>
            Sem cartas disponíveis para ranquear no momento.
          </p>
        ) : (
          <ol className={styles.rank}>
            {cartas.map((c, i) => {
              const tituloCarta =
                (c.tipo ? LABEL_TIPO_BEM[c.tipo] ?? c.tipo : "Carta") +
                " · " +
                brl(c.valor_credito);
              const meta = mostrarCusto
                ? `Custo efetivo ${fmtCustoEfetivo(c.custoEfetivo)}`
                : "";
              const corpo = (
                <>
                  <span className={styles.rankPos}>{i + 1}</span>
                  <span className={styles.rankCorpo}>
                    <span className={styles.rankTitulo}>{tituloCarta}</span>
                    {meta && <span className={styles.rankMeta}>{meta}</span>}
                  </span>
                  <span className={styles.rankScore}>{c.score}</span>
                </>
              );
              return (
                <li key={c.id} className={styles.rankItem}>
                  {hrefBase ? (
                    <a
                      href={`${hrefBase}/${c.id}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        flex: 1,
                        textDecoration: "none",
                        color: "inherit",
                      }}
                    >
                      {corpo}
                    </a>
                  ) : (
                    corpo
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Card>
  );
}

// Bloco de alerta "oportunidade" (custo baixo) — badge âmbar + contagem.
// Também INTERNO. Não usar em telas de cliente.
export function AlertaOportunidade({ quantidade }: { quantidade: number }) {
  if (quantidade <= 0) return null;
  return (
    <Card as="section">
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Badge tone="amber">Oportunidade</Badge>
        <span style={{ color: "var(--text)" }}>
          <b>{quantidade}</b> carta(s) com custo efetivo entre os mais baixos do acervo.
        </span>
      </div>
    </Card>
  );
}
