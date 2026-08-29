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
  falhou = false,
}: {
  novas: CartasNovas;
  hrefBase?: string;
  verTodasHref?: string;
  /**
   * REGRA 19 no feed. Sem este parâmetro, "a leitura da vitrine caiu" e "não
   * entrou carta nova nos últimos 7 dias" produziam EXATAMENTE o mesmo pixel:
   * `return null`, seção some, ninguém sabe de nada. Silêncio por escolha e
   * silêncio por defeito ficavam indistinguíveis na home.
   *
   * Quando é falha, a seção aparece dizendo que a leitura não voltou — nunca
   * afirmando que não há carta. Note que a falha VENCE a lista: se a fonte caiu,
   * o que sobrou em `novas` não é resposta, é resto.
   */
  falhou?: boolean;
}) {
  if (falhou) {
    return (
      <section className={styles.novas} role="alert" aria-label="Cartas novas">
        <div className={styles.novasHead}>
          <h2 className={styles.novasTitulo}>Não consegui carregar as cartas agora</h2>
          <a className={styles.novasLink} href={verTodasHref}>
            Tentar de novo
          </a>
        </div>
      </section>
    );
  }

  if (novas.quantidade <= 0) return null;

  return (
    <section
      className={styles.novas}
      aria-label="Cartas novas disponíveis"
      aria-live="polite"
    >
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
