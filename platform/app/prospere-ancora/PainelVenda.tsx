"use client";
// ============================================================================
// Painel "Simular venda" — UI interna da equipe Prospere (PROSPERE byAncora).
// ----------------------------------------------------------------------------
// USO INTERNO. Estes números (crédito líquido, venda do crédito, lucro nominal
// e a valor presente) NUNCA aparecem para cliente/parceiro — vivem atrás do
// gate @prospere.com.br + RLS.
//
// CONTRATO: config MANUAL por grupo (decisão B). A equipe digita modalidade,
// abate %, %venda, saldo/taxa, parcelas pagas e juro-alvo. Todo o cálculo é
// delegado à função PURA `calcularVenda` — este componente só coleta entrada e
// formata saída. Sem I/O, sem rede.
// ============================================================================
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { brl } from "@/lib/format";
import {
  calcularVenda,
  LABEL_MODALIDADE_VENDA,
  type ModalidadeVenda,
} from "@/lib/venda-ancora";
import { taxaEfetivaMensal, fmtCustoEfetivo } from "@/lib/custo-efetivo";
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

function fmtPct(fracao: number): string {
  return (
    (fracao * 100).toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + "%"
  );
}

const MODALIDADES: ModalidadeVenda[] = ["fixo", "limitado"];

export function PainelVenda({ creditoBase }: { creditoBase: number | null }) {
  const [aberto, setAberto] = useState(false);

  // Entradas (strings cruas do form; convertidas só no cálculo).
  const [credito, setCredito] = useState<string>(
    creditoBase != null ? String(creditoBase) : ""
  );
  const [modalidade, setModalidade] = useState<ModalidadeVenda>("fixo");
  const [abate, setAbate] = useState<string>(""); // pontos %
  const [venda, setVenda] = useState<string>("30"); // pontos % (Bidcon direto = 30)
  const [taxaAdm, setTaxaAdm] = useState<string>(""); // pontos %
  const [saldo, setSaldo] = useState<string>(""); // R$
  const [reajuste, setReajuste] = useState<string>(""); // pontos % (INCC/IPCA)
  const [parcelasPagas, setParcelasPagas] = useState<string>(""); // R$
  const [parcelaComprador, setParcelaComprador] = useState<string>(""); // R$
  const [juroMes, setJuroMes] = useState<string>(""); // pontos %/mês
  const [mesesVenda, setMesesVenda] = useState<string>(""); // meses
  const [prazoComprador, setPrazoComprador] = useState<string>(""); // meses restantes p/ o comprador

  const creditoNum = num(credito);

  const resultado = useMemo(() => {
    if (creditoNum == null || creditoNum <= 0) return null;
    return calcularVenda({
      credito: creditoNum,
      reajusteAcumulado: fracaoPct(reajuste),
      taxaAdministracao: fracaoPct(taxaAdm),
      saldoDevedor: num(saldo),
      modalidade,
      abatePct: fracaoPct(abate),
      vendaPct: fracaoPct(venda),
      parcelasPagasRs: num(parcelasPagas),
      parcelaComprador: num(parcelaComprador),
      juroMes: fracaoPct(juroMes),
      mesesAteVenda: num(mesesVenda),
    });
  }, [
    creditoNum,
    reajuste,
    taxaAdm,
    saldo,
    modalidade,
    abate,
    venda,
    parcelasPagas,
    parcelaComprador,
    juroMes,
    mesesVenda,
  ]);

  // Custo efetivo do COMPRADOR da carta — mesma fórmula das cartas
  // (lib/custo-efetivo). O comprador paga `vendaRs` hoje para receber o
  // crédito líquido e assume as parcelas restantes. Saldo financiado do
  // comprador = crédito líquido − venda paga à vista. Dois lados: R$/mês
  // (a própria parcela do comprador) e % a.m. (taxa efetiva).
  const custoComprador = useMemo(() => {
    if (resultado == null) return null;
    const parcela = resultado.parcelaComprador;
    const prazo = num(prazoComprador);
    if (parcela == null || prazo == null || prazo <= 0) return null;
    const saldoComprador = resultado.creditoLiquido - resultado.vendaRs;
    return {
      mensalRs: parcela,
      taxaAm: taxaEfetivaMensal(saldoComprador, parcela, prazo),
    };
  }, [resultado, prazoComprador]);

  if (!aberto) {
    return (
      <div className={styles.lanceToggle}>
        <Button variant="ghost" size="sm" onClick={() => setAberto(true)}>
          Simular venda
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.lancePainel}>
      <div className={styles.lanceCabecalho}>
        <span className={styles.parcelasTitulo}>Simular venda (interno)</span>
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
            onChange={(e) => setModalidade(e.target.value as ModalidadeVenda)}
          >
            {MODALIDADES.map((m) => (
              <option key={m} value={m}>
                {LABEL_MODALIDADE_VENDA[m]}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.lanceCampo}>
          <span>Abate do lance (%)</span>
          <input
            inputMode="decimal"
            value={abate}
            onChange={(e) => setAbate(e.target.value)}
            placeholder={modalidade === "fixo" ? "24,8" : "40"}
          />
        </label>

        <label className={styles.lanceCampo}>
          <span>%Venda da carta líquida</span>
          <input
            inputMode="decimal"
            value={venda}
            onChange={(e) => setVenda(e.target.value)}
            placeholder="30"
          />
        </label>

        <label className={styles.lanceCampo}>
          <span>Taxa adm. do grupo (%)</span>
          <input
            inputMode="decimal"
            value={taxaAdm}
            onChange={(e) => setTaxaAdm(e.target.value)}
            placeholder="24"
          />
        </label>

        <label className={styles.lanceCampo}>
          <span>Saldo devedor (R$)</span>
          <input
            inputMode="decimal"
            value={saldo}
            onChange={(e) => setSaldo(e.target.value)}
            placeholder="opcional"
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
          <span>Parcelas já pagas (R$)</span>
          <input
            inputMode="decimal"
            value={parcelasPagas}
            onChange={(e) => setParcelasPagas(e.target.value)}
            placeholder="0,00"
          />
        </label>

        <label className={styles.lanceCampo}>
          <span>Parcela comprador (R$)</span>
          <input
            inputMode="decimal"
            value={parcelaComprador}
            onChange={(e) => setParcelaComprador(e.target.value)}
            placeholder="0,00"
          />
        </label>

        <label className={styles.lanceCampo}>
          <span>Juro-alvo (%/mês)</span>
          <input
            inputMode="decimal"
            value={juroMes}
            onChange={(e) => setJuroMes(e.target.value)}
            placeholder="1,1"
          />
        </label>

        <label className={styles.lanceCampo}>
          <span>Meses até a venda</span>
          <input
            inputMode="numeric"
            value={mesesVenda}
            onChange={(e) => setMesesVenda(e.target.value)}
            placeholder="0"
          />
        </label>

        <label className={styles.lanceCampo}>
          <span>Prazo restante comprador (meses)</span>
          <input
            inputMode="numeric"
            value={prazoComprador}
            onChange={(e) => setPrazoComprador(e.target.value)}
            placeholder="0"
          />
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
              <dt>Saldo devedor</dt>
              <dd>{fmtValor(resultado.saldoDevedor)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Abate do lance (R$)</dt>
              <dd>{fmtValor(resultado.abateRs)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Crédito líquido</dt>
              <dd>{fmtValor(resultado.creditoLiquido)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Venda ({fmtPct(resultado.vendaPct)})</dt>
              <dd>{fmtValor(resultado.vendaRs)}</dd>
            </div>
            {resultado.lucroNominal != null && (
              <div className={styles.row}>
                <dt>Lucro nominal</dt>
                <dd>{fmtValor(resultado.lucroNominal)}</dd>
              </div>
            )}
            {resultado.lucroPresente != null && (
              <div className={styles.row}>
                <dt>Lucro a valor presente</dt>
                <dd>{fmtValor(resultado.lucroPresente)}</dd>
              </div>
            )}
            {resultado.parcelaComprador != null && (
              <div className={styles.row}>
                <dt>Parcela comprador</dt>
                <dd>{fmtValor(resultado.parcelaComprador)}</dd>
              </div>
            )}
            {custoComprador != null && (
              <div className={styles.row}>
                <dt>Custo efetivo comprador</dt>
                <dd>
                  {fmtValor(custoComprador.mensalRs)}/mês ·{" "}
                  {fmtCustoEfetivo(custoComprador.taxaAm)}
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
