"use client";

// Explorador de cartas — filtros de análise + junção de crédito (Client Component).
// ----------------------------------------------------------------------------
// Recebe a lista já buscada no servidor (cartas 'disponivel') e faz TODO o
// trabalho no cliente: filtra/ordena e permite SOMAR várias cartas para simular
// uma junção de crédito. Aritmética pura sobre campos PÚBLICOS do bem (crédito,
// entrada, parcela, prazo) — NUNCA toca administradora/taxa/fundo (não existem
// no banco; descartados no parser por compliance).
//
// COMPLIANCE: a junção agrupa SÓ por segmento (tipo do bem: imóvel/veículo).
//   Não há agrupamento por administradora. Rótulos neutros: "custo efetivo",
//   "crédito somado" — sem promessa de contemplação, sem "juros"/"desconto".
import { useMemo, useState } from "react";
import { LABEL_TIPO_BEM } from "@/lib/status";
import { brl } from "@/lib/format";
import {
  custoEfetivoCarta,
  custoEfetivoJuncao,
  fmtCustoEfetivo,
} from "@/lib/custo-efetivo";
import { CartaCard, type CartaVitrine } from "@/components/CartaCard";
import styles from "./CartasExplorer.module.css";

type Ordenacao = "credito" | "custo" | "entrada";

// Percentual de entrada sobre o crédito (campo público). null se não der.
function pctEntrada(c: CartaVitrine): number | null {
  if (c.valor_entrada == null || !(c.valor_credito > 0)) return null;
  return (c.valor_entrada / c.valor_credito) * 100;
}

export function CartasExplorer({ cartas }: { cartas: CartaVitrine[] }) {
  // Faixas absolutas (para os limites dos sliders/inputs) a partir da lista.
  const maxCredito = useMemo(
    () => cartas.reduce((m, c) => Math.max(m, c.valor_credito), 0),
    [cartas]
  );

  // --- estado dos filtros (todos opcionais; vazio = sem restrição) ---
  const [creditoMin, setCreditoMin] = useState<string>("");
  const [creditoMax, setCreditoMax] = useState<string>("");
  const [entradaMax, setEntradaMax] = useState<string>("");
  const [pctEntradaMax, setPctEntradaMax] = useState<string>("");
  const [custoMax, setCustoMax] = useState<string>("");
  const [ordenar, setOrdenar] = useState<Ordenacao>("credito");

  // --- junção de crédito: ids selecionados ---
  const [selecao, setSelecao] = useState<Set<string>>(new Set());

  const num = (s: string): number | null => {
    const v = Number(s.replace(/\./g, "").replace(",", "."));
    return s.trim() !== "" && Number.isFinite(v) ? v : null;
  };

  const filtradas = useMemo(() => {
    const cMin = num(creditoMin);
    const cMax = num(creditoMax);
    const eMax = num(entradaMax);
    const peMax = num(pctEntradaMax);
    const ceMax = num(custoMax);

    const passa = cartas.filter((c) => {
      if (cMin != null && c.valor_credito < cMin) return false;
      if (cMax != null && c.valor_credito > cMax) return false;
      if (eMax != null && (c.valor_entrada ?? 0) > eMax) return false;
      if (peMax != null) {
        const pe = pctEntrada(c);
        if (pe == null || pe > peMax) return false;
      }
      if (ceMax != null) {
        const ce = custoEfetivoCarta(c);
        // sem custo calculável fica de fora quando há teto de custo
        if (ce == null || ce > ceMax) return false;
      }
      return true;
    });

    const ordenadas = [...passa].sort((a, b) => {
      if (ordenar === "credito") return a.valor_credito - b.valor_credito;
      if (ordenar === "entrada")
        return (a.valor_entrada ?? 0) - (b.valor_entrada ?? 0);
      // custo: nulos por último, depois crescente
      const ca = custoEfetivoCarta(a);
      const cb = custoEfetivoCarta(b);
      if (ca == null && cb == null) return 0;
      if (ca == null) return 1;
      if (cb == null) return -1;
      return ca - cb;
    });
    return ordenadas;
  }, [cartas, creditoMin, creditoMax, entradaMax, pctEntradaMax, custoMax, ordenar]);

  // Carta(s) selecionada(s) para a junção (a partir da lista completa).
  const selecionadas = useMemo(
    () => cartas.filter((c) => selecao.has(c.id)),
    [cartas, selecao]
  );

  // Segmento da junção: trava na 1ª seleção (mesmo segmento só).
  const segmentoTrava = selecionadas[0]?.tipo ?? null;

  const toggle = (c: CartaVitrine) => {
    setSelecao((prev) => {
      const next = new Set(prev);
      if (next.has(c.id)) {
        next.delete(c.id);
      } else {
        // só permite somar cartas do MESMO segmento
        if (segmentoTrava && c.tipo !== segmentoTrava) return prev;
        next.add(c.id);
      }
      return next;
    });
  };

  const limparSelecao = () => setSelecao(new Set());

  const limparFiltros = () => {
    setCreditoMin("");
    setCreditoMax("");
    setEntradaMax("");
    setPctEntradaMax("");
    setCustoMax("");
    setOrdenar("credito");
  };

  // Somatório da junção (campos públicos) + métricas derivadas do dashboard.
  const soma = useMemo(() => {
    return selecionadas.reduce(
      (acc, c) => ({
        credito: acc.credito + c.valor_credito,
        entrada: acc.entrada + (c.valor_entrada ?? 0),
        parcela: acc.parcela + (c.valor_parcela ?? 0),
        saldo: acc.saldo + Math.max(0, c.valor_credito - (c.valor_entrada ?? 0)),
      }),
      { credito: 0, entrada: 0, parcela: 0, saldo: 0 }
    );
  }, [selecionadas]);

  // % de entrada média da junção (entrada somada sobre crédito somado).
  const pctEntradaJuncao =
    soma.credito > 0 ? (soma.entrada / soma.credito) * 100 : null;

  // Faixa de custo efetivo entre as cartas selecionadas (min–max), p/ contexto.
  const faixaCusto = useMemo(() => {
    const taxas = selecionadas
      .map((c) => custoEfetivoCarta(c))
      .filter((t): t is number => t != null);
    if (taxas.length === 0) return null;
    return { min: Math.min(...taxas), max: Math.max(...taxas) };
  }, [selecionadas]);

  // Prazo (parcelas) somado dá um total de meses-cota; mostramos o maior prazo
  // como horizonte da junção (campo público; sem mecânica interna).
  const prazoMax = useMemo(
    () =>
      selecionadas.reduce(
        (m, c) => Math.max(m, c.qtd_parcelas ?? 0),
        0
      ),
    [selecionadas]
  );

  const custoMedio = useMemo(
    () => custoEfetivoJuncao(selecionadas),
    [selecionadas]
  );

  const imprimirSimulacao = () => {
    if (typeof window !== "undefined") window.print();
  };

  const total = filtradas.length;
  const contagem =
    total === 0
      ? "Nenhuma carta atende a estes filtros"
      : total === 1
        ? "1 carta encontrada"
        : `${total} cartas encontradas`;

  return (
    <div>
      <section className={styles.filtros} aria-label="Filtros de análise">
        <div className={styles.campo}>
          <label htmlFor="cMin">Crédito mín.</label>
          <input
            id="cMin"
            inputMode="numeric"
            placeholder="R$ 0"
            value={creditoMin}
            onChange={(e) => setCreditoMin(e.target.value)}
          />
        </div>
        <div className={styles.campo}>
          <label htmlFor="cMax">Crédito máx.</label>
          <input
            id="cMax"
            inputMode="numeric"
            placeholder={maxCredito > 0 ? brl(maxCredito) : "sem limite"}
            value={creditoMax}
            onChange={(e) => setCreditoMax(e.target.value)}
          />
        </div>
        <div className={styles.campo}>
          <label htmlFor="eMax">Entrada máx.</label>
          <input
            id="eMax"
            inputMode="numeric"
            placeholder="R$"
            value={entradaMax}
            onChange={(e) => setEntradaMax(e.target.value)}
          />
        </div>
        <div className={styles.campo}>
          <label htmlFor="peMax">Entrada máx. (%)</label>
          <input
            id="peMax"
            inputMode="numeric"
            placeholder="%"
            value={pctEntradaMax}
            onChange={(e) => setPctEntradaMax(e.target.value)}
          />
        </div>
        <div className={styles.campo}>
          <label htmlFor="ceMax">Custo efetivo máx. (% a.m.)</label>
          <input
            id="ceMax"
            inputMode="numeric"
            placeholder="% a.m."
            value={custoMax}
            onChange={(e) => setCustoMax(e.target.value)}
          />
        </div>
        <div className={styles.campo}>
          <label htmlFor="ord">Ordenar por</label>
          <select
            id="ord"
            value={ordenar}
            onChange={(e) => setOrdenar(e.target.value as Ordenacao)}
          >
            <option value="credito">Crédito (menor → maior)</option>
            <option value="custo">Custo efetivo (menor → maior)</option>
            <option value="entrada">Entrada (menor → maior)</option>
          </select>
        </div>
        <button type="button" className={styles.limpar} onClick={limparFiltros}>
          Limpar filtros
        </button>
      </section>

      <p className={styles.contagem} aria-live="polite">
        {contagem}
      </p>

      {selecionadas.length > 0 && (
        <section className={styles.juncao} aria-label="Painel de simulação">
          <div className={styles.juncaoTop}>
            <span className={styles.juncaoTitulo}>
              Simulação de junção · {LABEL_TIPO_BEM[segmentoTrava ?? ""] ?? "—"}
            </span>
            <div className={styles.juncaoAcoes}>
              <button
                type="button"
                className={styles.imprimir}
                onClick={imprimirSimulacao}
              >
                Gerar PDF da simulação
              </button>
              <button
                type="button"
                className={styles.limpar}
                onClick={limparSelecao}
              >
                Limpar seleção
              </button>
            </div>
          </div>

          {/* Cabeçalho só visível na impressão (identidade + data). */}
          <div className={styles.printHead} aria-hidden="true">
            <strong>Bidcon · Simulação de junção</strong>
            <span>
              {LABEL_TIPO_BEM[segmentoTrava ?? ""] ?? "—"} ·{" "}
              {new Date().toLocaleDateString("pt-BR")}
            </span>
          </div>

          <dl className={styles.juncaoGrid}>
            <div>
              <dt>Cartas somadas</dt>
              <dd>{selecionadas.length}</dd>
            </div>
            <div>
              <dt>Crédito somado</dt>
              <dd>{brl(soma.credito)}</dd>
            </div>
            <div>
              <dt>Entrada somada</dt>
              <dd>{brl(soma.entrada)}</dd>
            </div>
            <div>
              <dt>Entrada média</dt>
              <dd>
                {pctEntradaJuncao != null
                  ? `${pctEntradaJuncao.toFixed(1).replace(".", ",")}%`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Parcela somada</dt>
              <dd>{brl(soma.parcela)}</dd>
            </div>
            <div>
              <dt>Saldo financiado</dt>
              <dd>{brl(soma.saldo)}</dd>
            </div>
            <div>
              <dt>Maior prazo</dt>
              <dd>{prazoMax > 0 ? `${prazoMax} meses` : "—"}</dd>
            </div>
            <div>
              <dt>Custo efetivo médio</dt>
              <dd>{fmtCustoEfetivo(custoMedio)}</dd>
            </div>
            <div>
              <dt>Faixa de custo</dt>
              <dd>
                {faixaCusto
                  ? `${fmtCustoEfetivo(faixaCusto.min)} – ${fmtCustoEfetivo(
                      faixaCusto.max
                    )}`
                  : "—"}
              </dd>
            </div>
          </dl>

          {/* Lista das cartas da simulação — aparece também no PDF. */}
          <ul className={styles.juncaoLista}>
            {selecionadas.map((c) => (
              <li key={c.id}>
                <span>{LABEL_TIPO_BEM[c.tipo] ?? c.tipo}</span>
                <span>{brl(c.valor_credito)}</span>
                <span>
                  {c.valor_parcela != null ? brl(c.valor_parcela) : "—"} ·{" "}
                  {c.qtd_parcelas != null ? `${c.qtd_parcelas}x` : "—"}
                </span>
                <span>{fmtCustoEfetivo(custoEfetivoCarta(c))}</span>
              </li>
            ))}
          </ul>

          <p className={styles.juncaoNota}>
            O custo efetivo médio é a média das taxas de cada carta ponderada
            pelo saldo financiado. A viabilidade da junção depende das regras da
            administradora de cada cota.
          </p>
          <p className={styles.disclaimer}>
            Simulação — não é proposta nem garantia de contemplação. Os valores
            são da carta; a transferência é feita pela administradora do
            consórcio. Estimativas a partir de dados públicos do bem (crédito,
            entrada, parcela, prazo).
          </p>
        </section>
      )}

      {filtradas.length > 0 && (
        <div className={styles.grid}>
          {filtradas.map((c) => {
            const ativa = selecao.has(c.id);
            const bloqueada =
              !ativa && segmentoTrava != null && c.tipo !== segmentoTrava;
            return (
              <div
                key={c.id}
                className={`${styles.item} ${ativa ? styles.itemAtivo : ""} ${
                  bloqueada ? styles.itemBloqueado : ""
                }`}
              >
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={ativa}
                    disabled={bloqueada}
                    onChange={() => toggle(c)}
                  />
                  <span>Somar à junção</span>
                </label>
                <CartaCard carta={c} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
