// ============================================================================
// /fundo — FIDC-OFERTAS-01 · Entrega 2: a vitrine como o FUNDO a enxerga
// ----------------------------------------------------------------------------
// AUTORIZADO: Emerson Gomes dos Santos — OS "FIDC-OFERTAS-01" (12/08/2026):
// "painel para fundo fazer ofertas nas cartas de parceiros da vitrine em lote";
// e, sobre o endereço: "a sigla não mora em URL — mesmo motivo do linter".
// Por isso `/fundo`, e não `/fidc`.
//
// SERVER COMPONENT. O gate é `exigirFundoPagina()`, primeira linha: kill-switch
// desarmado devolve 404, sessão ausente manda para /login, e-mail fora de
// qualquer fundo (ou fundo suspenso) volta para a raiz. A tela não é a barreira
// — a barreira é o servidor; a tela só evita convidar quem não pode entrar.
//
// O QUE ESTA TELA NÃO MOSTRA, e é o ponto mais importante dela:
//
//   · NENHUM dado pessoal de cedente. A leitura é da `vw_vitrine_viva`, que não
//     projeta `parceiro_id`, `fornecedor_id` nem `entrada_parceiro_raw`. Não é
//     disciplina de quem escreveu — é ESTRUTURA: o dado não existe para este
//     leitor. A ordem manda que o fundo não veja pessoa antes do aceite, e a
//     forma barata de cumprir isso é não ter o que esconder.
//   · NENHUM ágio da casa (`agio_120`/`agio_150`). É a nossa margem, e a
//     contraparte aqui é quem COMPRA. Mostrá-la seria negociar contra nós.
//
// FILTRO EM `<form method="get">`, HTML puro, de propósito. O estado do filtro
// vira URL: dá para copiar o endereço, mandar para o colega do fundo e ele ver
// exatamente a mesma lista. Um filtro em estado de cliente não sobrevive a um
// F5 nem cabe num e-mail. Além disso: `normalizarFiltros` roda no SERVIDOR, que
// é onde ele precisa rodar mesmo — a lista tem de ser a mesma que a rota de
// oferta consultaria.
// ============================================================================
import { exigirFundoPagina } from "@/lib/fidc-fundos";
import {
  TETO_TELA,
  buscarVitrine,
  cartasJaOfertadas,
  normalizarFiltros,
} from "@/lib/fidc-vitrine";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import areaStyles from "@/components/area.module.css";
import { PainelFundo } from "./PainelFundo";
import styles from "./fundo.module.css";

export const dynamic = "force-dynamic";

function inteiroBR(n: number): string {
  return n.toLocaleString("pt-BR");
}

function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function FundoPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { fundo, nome } = await exigirFundoPagina();

  const filtros = normalizarFiltros(searchParams);
  const { cartas, total, truncado } = await buscarVitrine(filtros);

  // Aviso, não trava: ver `cartasJaOfertadas`. Serve para o operador não mandar
  // a mesma carta duas vezes no mesmo dia sem perceber.
  const jaOfertadas = await cartasJaOfertadas(fundo.id, new Date());

  // A soma do que está NA TELA. Deliberadamente não é a soma do filtro inteiro:
  // ofertar só é possível sobre o que se vê, então o número que orienta a
  // decisão tem de ser o das cartas visíveis. Quando há truncamento, a tela diz
  // isso em voz alta logo abaixo.
  const somaVisivel = cartas.reduce((s, c) => s + (c.credito ?? 0), 0);

  return (
    <AppShell nome={nome} tipo="fundo">
      <div className={areaStyles.stack}>
        <PageHeader
          title="Vitrine"
          subtitle={
            <>
              {fundo.nome} · {inteiroBR(total)}{" "}
              {total === 1 ? "carta encontrada" : "cartas encontradas"}
              {truncado && (
                <>
                  {" "}
                  — mostrando as {inteiroBR(TETO_TELA)} de maior crédito.{" "}
                  <strong>Refine o filtro para alcançar as demais.</strong>
                </>
              )}
            </>
          }
        />

        <section className={areaStyles.section}>
          <Card>
            {/* GET puro: o filtro vira query string e a página recarrega no
                servidor. `defaultValue` e não `value` porque não há estado de
                cliente aqui — quem guarda o estado é a URL. */}
            <form method="get" className={styles.filtros}>
              <label className={styles.campo}>
                <span>Tipo</span>
                <select name="tipo" defaultValue={filtros.tipo ?? ""}>
                  <option value="">Todos</option>
                  <option value="imovel">Imóvel</option>
                  <option value="veiculo">Veículo</option>
                </select>
              </label>

              <label className={styles.campo}>
                <span>Crédito mínimo</span>
                <input
                  type="text"
                  inputMode="decimal"
                  name="credito_min"
                  placeholder="ex.: 100.000"
                  defaultValue={filtros.creditoMin ?? ""}
                />
              </label>

              <label className={styles.campo}>
                <span>Crédito máximo</span>
                <input
                  type="text"
                  inputMode="decimal"
                  name="credito_max"
                  placeholder="ex.: 500.000"
                  defaultValue={filtros.creditoMax ?? ""}
                />
              </label>

              <label className={styles.campo}>
                <span>Administradora</span>
                <input
                  type="text"
                  name="administradora"
                  placeholder="parte do nome"
                  defaultValue={filtros.administradora ?? ""}
                />
              </label>

              <label className={styles.campo}>
                <span>Custo máx. (% a.m.)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  name="custo_max"
                  placeholder="ex.: 1,2"
                  defaultValue={filtros.custoMax ?? ""}
                />
              </label>

              <div className={styles.filtroAcoes}>
                <button type="submit" className={styles.btnFiltrar}>
                  Filtrar
                </button>
                <a href="/fundo" className={styles.btnLimpar}>
                  Limpar
                </a>
              </div>
            </form>

            <p className={styles.notaFiltro}>
              Cartas sem custo apurado ficam de fora quando há teto de custo — não
              dá para afirmar que estão abaixo de um limite que não se sabe medir.
            </p>
          </Card>
        </section>

        {cartas.length === 0 ? (
          <section className={areaStyles.section}>
            <EmptyState
              icon="🔎"
              title="Nenhuma carta com esse filtro"
              description="Alargue a faixa de crédito ou limpe o filtro para ver a vitrine inteira."
              action={
                <a href="/fundo" className={styles.btnFiltrar}>
                  Limpar filtro
                </a>
              }
            />
          </section>
        ) : (
          <PainelFundo
            cartas={cartas}
            jaOfertadas={[...jaOfertadas]}
            filtro={searchParams}
            somaVisivelTexto={brl(somaVisivel)}
          />
        )}
      </div>
    </AppShell>
  );
}
