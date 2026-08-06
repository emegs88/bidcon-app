// ============================================================================
// CARROSSEL-OPS-01 Peça 4 — carta que saiu da vitrine.
// ----------------------------------------------------------------------------
// Por que existe (medido em 05/08/2026): a vitrine é SUBSTITUÍDA INTEIRA por
// rodada de sync (2.584 cartas com `sincronizada_em` dentro de 25 segundos), e
// o carrossel do WhatsApp vive pra sempre no celular do cliente. Logo, o link
// `/cartas/<uuid>` de uma campanha expira em horas e o clique em D+2 caía num
// 404 seco. Link morto é o caso MAJORITÁRIO do funil, não a exceção.
//
// Apresentação pura. NÃO exibe nenhum número da carta morta (entrada, parcela,
// custo ao mês, administradora): os valores estão vencidos e anunciar preço de
// carta que não existe mais é promessa falsa. Só o tipo do bem entra, como
// frase de contexto, pra que a página não pareça um erro genérico.
// Léxico compliance: nunca investimento/rendimento/lucro, nunca contemplação
// prometida. A bolha do Prosperito vem do layout raiz (prosperito-widget.js) e
// cobre o atendimento em qualquer página, esta inclusive.
// ============================================================================
import { CartaCard, type CartaVitrine } from "@/components/CartaCard";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import styles from "./detalhe.module.css";

// Destino de TODO caminho de saída de /cartas/[id], nos dois ramos: o CTA "ver o
// estoque inteiro" e o "← Cartas" do cabeçalho aqui (carta morta), mais o
// "← Cartas" do cabeçalho da carta viva, que importa esta constante de
// page.tsx. Exportada pra que a URL exista em UM lugar só.
// NÃO aponta pra /cartas de propósito:
// medido em 06/08/2026, /cartas faz redirect("/login") quando não há sessão, e
// o lead que chega por este caminho é anônimo POR CONSTRUÇÃO — veio do carrossel
// do WhatsApp, sem cadastro. Mandá-lo pra /cartas trocava um 404 por um paredão
// de login, que é o mesmo beco com outra placa.
// A vitrine estática de www.bidcon.com.br é pública, não exige sessão e é gerada
// por scripts/gerar-vitrine.mjs a partir do MESMO estoque (view vw_cartas_publicas
// no xtv) que alimenta esta página — não são dois catálogos divergentes.
// `#cotas` é a âncora que o próprio site usa nos seus CTAs internos de vitrine.
export const VITRINE_PUBLICA = "https://www.bidcon.com.br/#cotas";

export function CartaForaDaVitrine({
  tipoLabel,
  similares,
}: {
  tipoLabel: string;
  similares: CartaVitrine[];
}) {
  return (
    <>
      <PageHeader
        title="Esta carta já saiu da vitrine"
        backHref={VITRINE_PUBLICA}
        backLabel="Cartas"
        subtitle="Cotas de consórcio já contempladas. Os valores são da carta; a transferência é feita pela administradora do consórcio."
      />

      <div className={styles.stack}>
        <Card>
          <h2 className={styles.h2}>Ela era uma carta de {tipoLabel.toLowerCase()}</h2>
          <p className={styles.texto}>
            Cartas boas giram rápido: esta já foi negociada ou retirada do
            estoque. O que aparece abaixo são opções vivas agora, na mesma faixa
            de crédito — os valores de cada uma são os dela, conferidos no
            momento em que você abre a página.
          </p>
        </Card>

        {similares.length > 0 && (
          <>
            {similares.map((carta) => (
              <CartaCard key={carta.id} carta={carta} />
            ))}
          </>
        )}

        <Card>
          <h2 className={styles.h2}>Quer ver o estoque inteiro?</h2>
          <p className={styles.texto}>
            A vitrine muda várias vezes ao dia. Nenhuma contemplação é
            prometida: são cotas já contempladas sendo transferidas.
          </p>
          <Button href={VITRINE_PUBLICA} block>
            Ver a vitrine completa
          </Button>
        </Card>
      </div>
    </>
  );
}
