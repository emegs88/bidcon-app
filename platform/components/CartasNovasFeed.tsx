// CartasNovasFeed — recorte NEUTRO e factual de cartas novas para o CLIENTE.
// COMPLIANCE (inviolável): só tipo + crédito + data de entrada. SEM ranking,
// SEM score, SEM custo, SEM "oportunidade"/"melhor". É o único recorte de
// cartas-fluxo que pode ir ao cliente. A seleção/ordenação vem de
// lib/cartas-fluxo.cartasNovas() (mais recentes primeiro). Apresentação pura.
import { brl, LABEL_TIPO_BEM } from "@/lib/status";
import { dataBR } from "@/lib/format";
import type { CartasNovas } from "@/lib/cartas-fluxo";
import styles from "@/app/home.module.css";

// cada carta pode trazer `tipo` (opcional) para compor o rótulo factual.
type ItemNova = CartasNovas["cartas"][number] & { tipo?: string };

export function CartasNovasFeed({
  novas,
  hrefBase = "/cartas",
  verTodasHref = "/cartas",
}: {
  novas: CartasNovas;
  hrefBase?: string;
  verTodasHref?: string;
}) {
  if (novas.quantidade <= 0) return null;

  return (
    <section className={styles.novas} aria-label="Cartas novas disponíveis">
      <div className={styles.novasHead}>
        <h2 className={styles.novasTitulo}>
          {novas.quantidade} carta{novas.quantidade === 1 ? "" : "s"} nova
          {novas.quantidade === 1 ? "" : "s"} disponíve
          {novas.quantidade === 1 ? "l" : "is"}
        </h2>
        <a className={styles.novasLink} href={verTodasHref}>
          Ver todas
        </a>
      </div>

      <ul className={styles.novasLista}>
        {(novas.cartas as ItemNova[]).map((c) => {
          const rotulo = c.tipo
            ? LABEL_TIPO_BEM[c.tipo] ?? c.tipo
            : "Carta contemplada";
          return (
            <li key={c.id}>
              <a className={styles.novaItem} href={`${hrefBase}/${c.id}`}>
                <span className={styles.novaInfo}>
                  <span className={styles.novaTipo}>{rotulo}</span>
                  <span className={styles.novaData}>
                    Disponível desde {dataBR(c.criado_em)}
                  </span>
                </span>
                <span className={styles.novaCredito}>{brl(c.valor_credito)}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
