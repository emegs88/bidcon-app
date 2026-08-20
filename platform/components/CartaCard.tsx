// Cartão de carta na vitrine. Apresentação pura (sem promessa de contemplação).
import { LABEL_TIPO_BEM } from "@/lib/status";
import { brl } from "@/lib/format";
import { custoEfetivoCarta, fmtCustoEfetivo } from "@/lib/custo-efetivo";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import styles from "./CartaCard.module.css";

// Atributos PÚBLICOS da administradora (marca do bem). Vêm do join cartas →
// administradoras, liberado por RLS para usuário logado (migration 0011).
// NUNCA inclui fornecedor (de quem compramos) — esse é segredo admin-only.
export type AdministradoraVitrine = {
  nome: string;
  // `null` = NÃO SEI, e isso é diferente de `false`. A vitrine unificada
  // (CATALOGO-UNIFICA-01) lê `vw_vitrine_viva`, que NÃO carrega esta coluna; o
  // valor vem de um dicionário à parte, casado por nome. Quando o nome não bate
  // — ou quando o dicionário não respondeu — escrever `false` afirmaria à
  // pessoa que a administradora não aceita assunção sem ninguém ter medido
  // isso. `null` é falsy, então o selo abaixo e o filtro "Só aceita assunção"
  // seguem se comportando; a diferença é que a casa não passa a mentir.
  // Ver lib/vitrine.ts → adaptarCarta.
  aceita_assuncao: boolean | null;
};

export type CartaVitrine = {
  id: string;
  tipo: string;
  valor_credito: number;
  valor_entrada: number | null;
  valor_parcela: number | null;
  qtd_parcelas: number | null;
  // Referências de planejamento Bidcon Price (já calculadas no banco). Só exibir.
  bidcon_agio_150: number | null;
  bidcon_agio_120: number | null;
  bidcon_custo_am: number | null;
  // pode ser null quando a carta ainda não tem administradora vinculada.
  administradora: AdministradoraVitrine | null;
  // Carta de cliente direto (`fonte = 'cliente_direto'` na origem). É o EIXO
  // OFICIAL da partição — nunca mais comparar a string "BIDCON_DIRETO". Aqui o
  // campo é só EXIBIÇÃO (o selo é marca); quem decide a ORDEM é
  // `ordenarExclusivaPrimeiro` em lib/vitrine.ts.
  exclusiva?: boolean;
};

export function CartaCard({ carta }: { carta: CartaVitrine }) {
  // Mesma fórmula do site estático (taxaEfetiva). Só exibe se for calculável.
  const custoEfetivo = custoEfetivoCarta(carta);

  return (
    <Card href={`/cartas/${carta.id}`}>
      <div className={styles.top}>
        <Badge tone={carta.tipo === "imovel" ? "info" : "amber"}>
          {LABEL_TIPO_BEM[carta.tipo] ?? carta.tipo}
        </Badge>
        <span className={styles.disp}>Disponível</span>
      </div>

      <div className={styles.credito}>{brl(carta.valor_credito)}</div>
      <div className={styles.creditoLbl}>
        crédito da carta
        {carta.administradora?.nome ? ` · ${carta.administradora.nome}` : ""}
      </div>

      {/* Selos Bidcon Price — referências de planejamento (nunca investimento/rendimento). */}
      {carta.bidcon_agio_150 != null && carta.bidcon_agio_150 > 0 && (
        <div className={styles.seloDourado}>
          <span className={styles.seloDouradoTitulo}>Bidcon Price</span>
          <span className={styles.seloDouradoVal}>
            ágio justo até {brl(carta.bidcon_agio_150)}
          </span>
        </div>
      )}
      {carta.bidcon_agio_120 != null && carta.bidcon_agio_120 > 0 && (
        <div className={styles.seloVerde}>Custo excelente</div>
      )}
      <p className={styles.seloNota}>Referência de planejamento, não é oferta de investimento.</p>

      {/* Selo de marca. Quem ORDENA é `ordenarExclusivaPrimeiro`; aqui é só a
          etiqueta que a pessoa vê. Se um dia a ordem sumir e o selo continuar,
          é sinal de que alguém trocou a partição — não de que o selo mentiu. */}
      {(carta.exclusiva || carta.administradora?.aceita_assuncao) && (
        <div className={styles.atributos}>
          {carta.exclusiva && <Badge tone="amber">BIDCON DIRETO</Badge>}
          {carta.administradora?.aceita_assuncao && (
            <Badge tone="ok">Aceita assunção</Badge>
          )}
        </div>
      )}

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

      {custoEfetivo != null && (
        <div className={styles.ce}>
          <span className={styles.ceLbl}>Custo efetivo</span>
          <span className={styles.ceVal}>{fmtCustoEfetivo(custoEfetivo)}</span>
        </div>
      )}

      <span className={styles.verMais}>Ver detalhes →</span>
    </Card>
  );
}
