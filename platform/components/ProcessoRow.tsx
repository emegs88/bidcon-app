// Linha de processo reutilizável (Parceiro e Admin). Apresentação pura.
// Mostra cliente, carta vinculada (quando houver), valor e status atual.
// Vira link quando recebe href (ex.: detalhe do processo no admin).
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
  LABEL_STATUS,
  TONE_STATUS_PROCESSO,
  LABEL_TIPO_BEM,
  type StatusProcesso,
} from "@/lib/status";
import { brl } from "@/lib/format";
import styles from "./ProcessoRow.module.css";

export type ProcessoResumo = {
  id: string;
  status: StatusProcesso;
  valor_carta: number | null;
  cliente_nome?: string | null;
  carta_tipo?: string | null;
};

export function ProcessoRow({
  processo,
  href,
}: {
  processo: ProcessoResumo;
  href?: string;
}) {
  const conteudo = (
    <div className={styles.row}>
      <div className={styles.info}>
        <span className={styles.cliente}>
          {processo.cliente_nome ?? "Cliente"}
        </span>
        <span className={styles.meta}>
          {processo.carta_tipo
            ? LABEL_TIPO_BEM[processo.carta_tipo] ?? processo.carta_tipo
            : "Sem carta vinculada"}
          {processo.valor_carta != null ? ` · ${brl(processo.valor_carta)}` : ""}
        </span>
      </div>
      <Badge tone={TONE_STATUS_PROCESSO[processo.status]}>
        {LABEL_STATUS[processo.status]}
      </Badge>
    </div>
  );

  if (href) {
    return <Card href={href}>{conteudo}</Card>;
  }
  return <Card as="li">{conteudo}</Card>;
}
