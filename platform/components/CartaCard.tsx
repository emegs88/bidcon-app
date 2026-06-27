// Cartão de carta na vitrine. Apresentação pura (sem promessa de contemplação).
import { LABEL_TIPO_BEM } from "@/lib/status";
import { brl } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import styles from "./CartaCard.module.css";

export type CartaVitrine = {
  id: string;
  tipo: string;
  valor_credito: number;
  valor_entrada: number | null;
  valor_parcela: number | null;
  qtd_parcelas: number | null;
};

export function CartaCard({ carta }: { carta: CartaVitrine }) {
  return (
    <Card href={`/cartas/${carta.id}`}>
      <div className={styles.top}>
        <Badge tone={carta.tipo === "imovel" ? "info" : "amber"}>
          {LABEL_TIPO_BEM[carta.tipo] ?? carta.tipo}
        </Badge>
        <span className={styles.disp}>Disponível</span>
      </div>

      <div className={styles.credito}>{brl(carta.valor_credito)}</div>
      <div className={styles.creditoLbl}>crédito da carta</div>

      <dl className={styles.specs}>
        <div>
          <dt>Entrada</dt>
          <dd>{brl(carta.valor_entrada)}</dd>
        </div>
        {carta.valor_parcela != null && (
          <div>
            <dt>Parcela</dt>
            <dd>{brl(carta.valor_parcela)}</dd>
          </div>
        )}
        {carta.qtd_parcelas != null && (
          <div>
            <dt>Parcelas</dt>
            <dd>{carta.qtd_parcelas}x</dd>
          </div>
        )}
      </dl>

      <span className={styles.verMais}>Ver detalhes →</span>
    </Card>
  );
}
