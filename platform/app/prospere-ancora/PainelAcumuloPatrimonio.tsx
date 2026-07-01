"use client";
// ============================================================================
// Painel "Acúmulo de patrimônio" — UI interna da equipe Prospere (byAncora).
// ----------------------------------------------------------------------------
// USO INTERNO. Estes números (parcela paga, patrimônio acumulado, valor de
// venda, lucro, fluxo de caixa) NUNCA aparecem para cliente/parceiro — vivem
// atrás do gate @prospere.com.br + RLS. Nada aqui é promessa de contemplação,
// de renda, de rendimento, de valorização ou de lucro ao cliente; é ferramenta
// de trabalho da equipe para AVALIAR uma estratégia de carteira mês a mês.
//
// O QUE FAZ: reproduz o "Plano de sucesso" (planilha Simulação). A equipe digita
// crédito, taxa de administração, prazo, quantidade de cotas, INCC e % de venda,
// e um PLANO de contemplações por mês (sorteio/fixo/limitado — começa vazio).
// Mostra a evolução mês a mês e dois gráficos (patrimônio acumulado e fluxo de
// caixa acumulado) desenhados em SVG inline (sem lib externa). Todo o cálculo é
// delegado à função PURA `simularAcumuloPatrimonio`. Este componente só coleta
// entrada e formata saída. Sem I/O, sem rede.
//
// IMPORTANTE (compliance): a parcela estimada é APROXIMAÇÃO da planilha; leva
// aviso p/ a equipe comparar com o custo efetivo real quando quiser precisão.
// O plano de contemplações é DIGITADO pela equipe — nada é chutado.
// ============================================================================
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { brl } from "@/lib/format";
import {
  simularAcumuloPatrimonio,
  type ContemplacaoMes,
  type LinhaPatrimonio,
} from "@/lib/patrimonio-ancora";
import styles from "./prospere-ancora.module.css";

function num(v: string): number | null {
  const s = v.trim();
  if (s === "") return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function fracaoPct(v: string): number | null {
  const n = num(v);
  return n == null ? null : n / 100;
}

function fmtValor(n: number | null): string {
  return n == null ? "—" : brl(n);
}

// Linha do plano de contemplações no form (strings cruas; convertidas só no cálculo).
type LinhaContemplacao = {
  mes: string;
  sorteio: string;
  fixo: string;
  limitado: string;
};

// --- Gráfico de linha inline (SVG). Puro: recebe pontos, desenha. -----------
// Sem lib: mapeia [min,max] -> altura do viewBox. Não faz I/O.
function GraficoLinha({
  titulo,
  valorFinal,
  pontos,
  cor,
}: {
  titulo: string;
  valorFinal: string;
  pontos: number[];
  cor: string;
}) {
  const W = 320;
  const H = 90;
  const pad = 4;

  if (pontos.length < 2) {
    return (
      <div className={styles.grafico}>
        <div className={styles.graficoTitulo}>
          <span>{titulo}</span>
          <span className={styles.graficoValor}>{valorFinal}</span>
        </div>
        <p className={styles.lanceDica}>Sem pontos suficientes para o gráfico.</p>
      </div>
    );
  }

  const min = Math.min(...pontos, 0);
  const max = Math.max(...pontos, 0);
  const span = max - min || 1;

  const x = (i: number) =>
    pad + (i / (pontos.length - 1)) * (W - pad * 2);
  const y = (v: number) =>
    H - pad - ((v - min) / span) * (H - pad * 2);

  const d = pontos
    .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");

  // Linha de base no zero (referência visual do positivo/negativo).
  const yZero = y(0);

  return (
    <div className={styles.grafico}>
      <div className={styles.graficoTitulo}>
        <span>{titulo}</span>
        <span className={styles.graficoValor}>{valorFinal}</span>
      </div>
      <svg
        className={styles.graficoSvg}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${titulo}: ${valorFinal}`}
        preserveAspectRatio="none"
      >
        <line
          x1={pad}
          x2={W - pad}
          y1={yZero}
          y2={yZero}
          stroke="var(--border)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
        <path d={d} fill="none" stroke={cor} strokeWidth="1.6" />
      </svg>
    </div>
  );
}

export function PainelAcumuloPatrimonio({
  creditoBase,
}: {
  creditoBase: number | null;
}) {
  const [aberto, setAberto] = useState(false);

  // Premissas (digitadas pela equipe). Começam vazias; crédito herda a carta-base.
  const [credito, setCredito] = useState<string>(
    creditoBase != null ? String(creditoBase) : ""
  );
  const [taxaAdm, setTaxaAdm] = useState<string>("");
  const [prazo, setPrazo] = useState<string>("");
  const [qtdCotas, setQtdCotas] = useState<string>("");
  const [inccPct, setInccPct] = useState<string>("");
  const [pctVenda, setPctVenda] = useState<string>("");
  // Parcela unitária informada (prioridade sobre a estimativa). Opcional.
  const [parcelaUnit, setParcelaUnit] = useState<string>("");

  // Plano de contemplações — começa vazio (a equipe adiciona meses).
  const [contemplacoes, setContemplacoes] = useState<LinhaContemplacao[]>([]);

  const addContemplacao = () =>
    setContemplacoes((cs) => [
      ...cs,
      { mes: "", sorteio: "", fixo: "", limitado: "" },
    ]);
  const setLinha = (i: number, patch: Partial<LinhaContemplacao>) =>
    setContemplacoes((cs) =>
      cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c))
    );
  const rmContemplacao = (i: number) =>
    setContemplacoes((cs) => cs.filter((_, idx) => idx !== i));

  const resultado = useMemo(() => {
    const plano: ContemplacaoMes[] = contemplacoes
      .map((c) => ({
        mes: num(c.mes) ?? 0,
        sorteio: num(c.sorteio),
        fixo: num(c.fixo),
        limitado: num(c.limitado),
      }))
      .filter((c) => c.mes > 0);

    return simularAcumuloPatrimonio({
      credito: num(credito),
      taxaAdministracao: fracaoPct(taxaAdm),
      prazo: num(prazo),
      qtdCotas: num(qtdCotas),
      inccPct: fracaoPct(inccPct),
      pctVenda: fracaoPct(pctVenda),
      parcelaUnit: num(parcelaUnit),
      contemplacoes: plano.length > 0 ? plano : null,
    });
  }, [
    credito,
    taxaAdm,
    prazo,
    qtdCotas,
    inccPct,
    pctVenda,
    parcelaUnit,
    contemplacoes,
  ]);

  const temLinhas = resultado.linhas.length > 0;

  // Séries para os gráficos (uma por linha/mês).
  const seriePatrimonio = resultado.linhas.map((l) => l.patrimonioAcumulado);
  const serieFluxo = resultado.linhas.map((l) => l.fluxoAcumulado);

  if (!aberto) {
    return (
      <div className={styles.lanceToggle}>
        <Button variant="ghost" size="sm" onClick={() => setAberto(true)}>
          Acúmulo de patrimônio
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.lancePainel}>
      <div className={styles.lanceCabecalho}>
        <span className={styles.parcelasTitulo}>
          Acúmulo de patrimônio (interno)
        </span>
        <Button variant="ghost" size="sm" onClick={() => setAberto(false)}>
          Fechar
        </Button>
      </div>

      {/* --- Premissas da carteira --- */}
      <div className={styles.lanceForm}>
        <label className={styles.lanceCampo}>
          <span>Crédito da cota (R$)</span>
          <input
            inputMode="decimal"
            value={credito}
            onChange={(e) => setCredito(e.target.value)}
            placeholder="0,00"
          />
        </label>
        <label className={styles.lanceCampo}>
          <span>Taxa de adm. (%)</span>
          <input
            inputMode="decimal"
            value={taxaAdm}
            onChange={(e) => setTaxaAdm(e.target.value)}
            placeholder="ex.: 24"
          />
        </label>
        <label className={styles.lanceCampo}>
          <span>Prazo (meses)</span>
          <input
            inputMode="numeric"
            value={prazo}
            onChange={(e) => setPrazo(e.target.value)}
            placeholder="ex.: 220"
          />
        </label>
        <label className={styles.lanceCampo}>
          <span>Quantidade de cotas</span>
          <input
            inputMode="numeric"
            value={qtdCotas}
            onChange={(e) => setQtdCotas(e.target.value)}
            placeholder="ex.: 26"
          />
        </label>
        <label className={styles.lanceCampo}>
          <span>INCC mensal (%)</span>
          <input
            inputMode="decimal"
            value={inccPct}
            onChange={(e) => setInccPct(e.target.value)}
            placeholder="ausente = 0"
          />
        </label>
        <label className={styles.lanceCampo}>
          <span>% de venda</span>
          <input
            inputMode="decimal"
            value={pctVenda}
            onChange={(e) => setPctVenda(e.target.value)}
            placeholder="ex.: 50"
          />
        </label>
        <label className={styles.lanceCampo}>
          <span>Parcela unit. (R$, opcional)</span>
          <input
            inputMode="decimal"
            value={parcelaUnit}
            onChange={(e) => setParcelaUnit(e.target.value)}
            placeholder="senão, estimada"
          />
        </label>
      </div>

      {/* --- Plano de contemplações (digitado; começa vazio) --- */}
      <div className={styles.parcelasTitulo}>Plano de contemplações (por mês)</div>
      <div className={styles.planoLista}>
        {contemplacoes.length === 0 && (
          <p className={styles.lanceDica}>
            Sem contemplações: a carteira só paga parcelas. Adicione meses para
            simular vendas.
          </p>
        )}
        {contemplacoes.map((c, i) => (
          <div key={i} className={styles.planoLinha}>
            <label className={styles.lanceCampo}>
              <span>Mês</span>
              <input
                inputMode="numeric"
                value={c.mes}
                onChange={(e) => setLinha(i, { mes: e.target.value })}
                placeholder="ex.: 5"
              />
            </label>
            <label className={styles.lanceCampo}>
              <span>Sorteio</span>
              <input
                inputMode="numeric"
                value={c.sorteio}
                onChange={(e) => setLinha(i, { sorteio: e.target.value })}
                placeholder="0"
              />
            </label>
            <label className={styles.lanceCampo}>
              <span>Fixo</span>
              <input
                inputMode="numeric"
                value={c.fixo}
                onChange={(e) => setLinha(i, { fixo: e.target.value })}
                placeholder="0"
              />
            </label>
            <label className={styles.lanceCampo}>
              <span>Limitado</span>
              <input
                inputMode="numeric"
                value={c.limitado}
                onChange={(e) => setLinha(i, { limitado: e.target.value })}
                placeholder="0"
              />
            </label>
            <div className={styles.gcAcoes}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => rmContemplacao(i)}
              >
                Remover
              </Button>
            </div>
          </div>
        ))}
        <div className={styles.gcAcoes}>
          <Button variant="ghost" size="sm" onClick={addContemplacao}>
            + Adicionar mês
          </Button>
        </div>
      </div>

      {!temLinhas ? (
        <p className={styles.lanceDica}>
          Informe crédito, prazo e quantidade de cotas (e parcela ou taxa de
          administração) para simular.
        </p>
      ) : (
        <>
          {/* --- Resumo no fim do prazo --- */}
          <div className={styles.resumoGrid}>
            <div className={styles.resumoItem}>
              <span className={styles.resumoRotulo}>Patrimônio final</span>
              <span className={styles.resumoValor}>
                {fmtValor(resultado.patrimonioFinal)}
              </span>
            </div>
            <div className={styles.resumoItem}>
              <span className={styles.resumoRotulo}>Fluxo acumulado</span>
              <span className={styles.resumoValor}>
                {fmtValor(resultado.fluxoAcumuladoFinal)}
              </span>
            </div>
            <div className={styles.resumoItem}>
              <span className={styles.resumoRotulo}>Lucro total (vendas)</span>
              <span className={styles.resumoValor}>
                {fmtValor(resultado.lucroTotal)}
              </span>
            </div>
            <div className={styles.resumoItem}>
              <span className={styles.resumoRotulo}>Parcela unitária</span>
              <span className={styles.resumoValor}>
                {fmtValor(resultado.parcelaUnit)}
              </span>
            </div>
          </div>

          {/* --- Gráficos (SVG inline) --- */}
          <GraficoLinha
            titulo="Patrimônio acumulado"
            valorFinal={fmtValor(resultado.patrimonioFinal)}
            pontos={seriePatrimonio}
            cor="var(--text)"
          />
          <GraficoLinha
            titulo="Fluxo de caixa acumulado"
            valorFinal={fmtValor(resultado.fluxoAcumuladoFinal)}
            pontos={serieFluxo}
            cor="var(--text-soft)"
          />
          <div className={styles.graficoLegenda}>
            <span>
              <span
                className={styles.legendaMarca}
                style={{ background: "var(--text)" }}
              />
              Patrimônio = Σ parcelas pagas − contempladas × crédito
            </span>
            <span>
              <span
                className={styles.legendaMarca}
                style={{ background: "var(--text-soft)" }}
              />
              Fluxo = Σ (parcela paga − valor de venda)
            </span>
          </div>

          {/* --- Amostra dos primeiros meses (tabela) --- */}
          <div className={styles.parcelasTitulo}>Evolução (primeiros meses)</div>
          <dl className={styles.dl}>
            {resultado.linhas.slice(0, 6).map((l: LinhaPatrimonio) => (
              <div key={l.mes} className={styles.row}>
                <dt>
                  Mês {l.mes} · {l.qtdCotasAtivas} cotas
                  {l.contempladas > 0 ? ` · ${l.contempladas} contempl.` : ""}
                </dt>
                <dd>
                  {fmtValor(l.parcelaPaga)} pagos · patrim.{" "}
                  {fmtValor(l.patrimonioAcumulado)}
                </dd>
              </div>
            ))}
          </dl>

          {resultado.avisos.length > 0 && (
            <ul className={styles.lanceAvisos}>
              {resultado.avisos.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
