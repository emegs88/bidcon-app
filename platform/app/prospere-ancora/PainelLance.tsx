"use client";
// ============================================================================
// Painel "Simular lance" — UI interna da equipe Prospere (PROSPERE byAncora).
// ----------------------------------------------------------------------------
// USO INTERNO. Estes números (embutido, crédito líquido, lance %, nova parcela)
// NUNCA aparecem para cliente/parceiro — vivem atrás do gate @prospere.com.br.
//
// CONTRATO: decisão B = config MANUAL por grupo. Os parâmetros de lance
// (modalidade, embutido%, teto%, recurso próprio, reajuste INCC/IPCA, parcela e
// prazo atuais, modo de amortização) são digitados pela equipe. O crédito-base
// vem do `valor_do_bem` da linha (pode ser sobrescrito). Todo o cálculo é
// delegado à função PURA `calcularLance` — este componente só coleta entrada e
// formata saída. Sem I/O, sem rede.
// ============================================================================
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { brl } from "@/lib/format";
import {
  calcularLance,
  LABEL_MODALIDADE,
  LABEL_MODO,
  type ModalidadeLance,
  type ModoAmortizacao,
} from "@/lib/lance-ancora";
import { taxaEfetivaMensal, fmtCustoEfetivo } from "@/lib/custo-efetivo";
import styles from "./prospere-ancora.module.css";

// Converte string de input em número, ou null se vazio/ilegível (nunca 0 inventado).
function num(v: string): number | null {
  const s = v.trim();
  if (s === "") return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// Fração a partir de campo em pontos percentuais ("25" => 0.25). Vazio => null.
function fracaoPct(v: string): number | null {
  const n = num(v);
  return n == null ? null : n / 100;
}

function fmtValor(n: number | null): string {
  return n == null ? "—" : brl(n);
}

function fmtPct(fracao: number): string {
  return (
    (fracao * 100).toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + "%"
  );
}

const MODALIDADES: ModalidadeLance[] = ["livre", "fixo", "limitado", "embutido"];
const MODOS: ModoAmortizacao[] = ["reduzir_parcela", "reduzir_prazo"];

export function PainelLance({ creditoBase }: { creditoBase: number | null }) {
  const [aberto, setAberto] = useState(false);

  // Entradas (strings cruas do form; convertidas só no cálculo).
  const [credito, setCredito] = useState<string>(
    creditoBase != null ? String(creditoBase) : ""
  );
  const [modalidade, setModalidade] = useState<ModalidadeLance>("embutido");
  const [embutido, setEmbutido] = useState<string>(""); // pontos %
  const [teto, setTeto] = useState<string>(""); // pontos %
  const [recurso, setRecurso] = useState<string>(""); // R$
  const [reajuste, setReajuste] = useState<string>(""); // pontos % (INCC/IPCA acumulado)
  const [parcela, setParcela] = useState<string>(""); // R$
  const [prazo, setPrazo] = useState<string>(""); // meses
  const [modo, setModo] = useState<ModoAmortizacao>("reduzir_parcela");

  const creditoNum = num(credito);

  const resultado = useMemo(() => {
    if (creditoNum == null || creditoNum <= 0) return null;
    return calcularLance({
      credito: creditoNum,
      reajusteAcumulado: fracaoPct(reajuste),
      modalidade,
      embutidoPct: fracaoPct(embutido),
      tetoPct: fracaoPct(teto),
      recursoProprioRs: num(recurso),
      parcelaAtual: num(parcela),
      prazoRestante: num(prazo),
      modo,
    });
  }, [creditoNum, reajuste, modalidade, embutido, teto, recurso, parcela, prazo, modo]);

  // Custo efetivo pós-lance — mesma fórmula das cartas (lib/custo-efetivo).
  // Após o lance, mantém-se o crédito líquido pagando a parcela vigente pelo
  // prazo vigente. Dois lados: R$/mês (parcela) e % a.m. (taxa efetiva).
  //   reduzir_parcela → paga nova parcela pelo prazo restante
  //   reduzir_prazo   → paga a parcela atual pelo novo prazo
  const custoEfetivo = useMemo(() => {
    if (resultado == null) return null;
    const mensalRs =
      modo === "reduzir_parcela" ? resultado.novaParcela : num(parcela);
    const meses =
      modo === "reduzir_parcela" ? num(prazo) : resultado.novoPrazo;
    if (mensalRs == null || meses == null || meses <= 0) return null;
    return {
      mensalRs,
      taxaAm: taxaEfetivaMensal(resultado.creditoLiquido, mensalRs, meses),
    };
  }, [resultado, modo, parcela, prazo]);

  if (!aberto) {
    return (
      <div className={styles.lanceToggle}>
        <Button variant="ghost" size="sm" onClick={() => setAberto(true)}>
          Simular lance
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.lancePainel}>
      <div className={styles.lanceCabecalho}>
        <span className={styles.parcelasTitulo}>Simular lance (interno)</span>
        <Button variant="ghost" size="sm" onClick={() => setAberto(false)}>
          Fechar
        </Button>
      </div>

      <div className={styles.lanceForm}>
        <label className={styles.lanceCampo}>
          <span>Crédito base (R$)</span>
          <input
            inputMode="decimal"
            value={credito}
            onChange={(e) => setCredito(e.target.value)}
            placeholder="0,00"
          />
        </label>

        <label className={styles.lanceCampo}>
          <span>Modalidade</span>
          <select
            value={modalidade}
            onChange={(e) => setModalidade(e.target.value as ModalidadeLance)}
          >
            {MODALIDADES.map((m) => (
              <option key={m} value={m}>
                {LABEL_MODALIDADE[m]}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.lanceCampo}>
          <span>Embutido (%)</span>
          <input
            inputMode="decimal"
            value={embutido}
            onChange={(e) => setEmbutido(e.target.value)}
            placeholder="25"
          />
        </label>

        <label className={styles.lanceCampo}>
          <span>Teto do grupo (%)</span>
          <input
            inputMode="decimal"
            value={teto}
            onChange={(e) => setTeto(e.target.value)}
            placeholder="40"
          />
        </label>

        <label className={styles.lanceCampo}>
          <span>Recurso próprio (R$)</span>
          <input
            inputMode="decimal"
            value={recurso}
            onChange={(e) => setRecurso(e.target.value)}
            placeholder="0,00"
          />
        </label>

        <label className={styles.lanceCampo}>
          <span>Reajuste INCC/IPCA (%)</span>
          <input
            inputMode="decimal"
            value={reajuste}
            onChange={(e) => setReajuste(e.target.value)}
            placeholder="5"
          />
        </label>

        <label className={styles.lanceCampo}>
          <span>Parcela atual (R$)</span>
          <input
            inputMode="decimal"
            value={parcela}
            onChange={(e) => setParcela(e.target.value)}
            placeholder="0,00"
          />
        </label>

        <label className={styles.lanceCampo}>
          <span>Prazo restante (meses)</span>
          <input
            inputMode="numeric"
            value={prazo}
            onChange={(e) => setPrazo(e.target.value)}
            placeholder="0"
          />
        </label>

        <label className={styles.lanceCampo}>
          <span>Amortização</span>
          <select
            value={modo}
            onChange={(e) => setModo(e.target.value as ModoAmortizacao)}
          >
            {MODOS.map((m) => (
              <option key={m} value={m}>
                {LABEL_MODO[m]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {resultado == null ? (
        <p className={styles.lanceDica}>
          Informe um crédito base maior que zero para simular.
        </p>
      ) : (
        <>
          <dl className={styles.dl}>
            <div className={styles.row}>
              <dt>Crédito reajustado</dt>
              <dd>{fmtValor(resultado.creditoReajustado)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Embutido (R$)</dt>
              <dd>{fmtValor(resultado.embutidoRs)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Recurso próprio (R$)</dt>
              <dd>{fmtValor(resultado.recursoProprioRs)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Lance total (R$)</dt>
              <dd>{fmtValor(resultado.lanceTotalRs)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Lance total (%)</dt>
              <dd>{fmtPct(resultado.lanceTotalPct)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Crédito líquido</dt>
              <dd>{fmtValor(resultado.creditoLiquido)}</dd>
            </div>
            {resultado.novaParcela != null && (
              <div className={styles.row}>
                <dt>Nova parcela</dt>
                <dd>{fmtValor(resultado.novaParcela)}</dd>
              </div>
            )}
            {resultado.novoPrazo != null && (
              <div className={styles.row}>
                <dt>Novo prazo</dt>
                <dd>{resultado.novoPrazo}m</dd>
              </div>
            )}
            {custoEfetivo != null && (
              <div className={styles.row}>
                <dt>Custo efetivo</dt>
                <dd>
                  {fmtValor(custoEfetivo.mensalRs)}/mês ·{" "}
                  {fmtCustoEfetivo(custoEfetivo.taxaAm)}
                </dd>
              </div>
            )}
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
