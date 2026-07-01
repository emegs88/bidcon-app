"use client";
// ============================================================================
// Painel "Simular compra" — UI interna da equipe Prospere (PROSPERE byAncora).
// ----------------------------------------------------------------------------
// USO INTERNO. Estes números (entrada, IOF, CCB, juros do fundo, crédito
// líquido, custo efetivo) NUNCA aparecem para cliente/parceiro — vivem atrás do
// gate @prospere.com.br + RLS.
//
// CONTRATO: config MANUAL por grupo (decisão B). A equipe digita crédito,
// entrada, IOF, emissão de CCB, taxa de transferência (isenta por padrão) e
// juros do fundo. Todo o cálculo é delegado à função PURA `calcularCompra` e o
// custo efetivo reusa `lib/custo-efetivo` (mesma fórmula das cartas). Este
// componente só coleta entrada e formata saída. Sem I/O, sem rede.
// ============================================================================
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { brl } from "@/lib/format";
import { calcularCompra } from "@/lib/compra-ancora";
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

export function PainelCompra({ creditoBase }: { creditoBase: number | null }) {
  const [aberto, setAberto] = useState(false);

  // Entradas (strings cruas do form; convertidas só no cálculo).
  const [credito, setCredito] = useState<string>(
    creditoBase != null ? String(creditoBase) : ""
  );
  const [entradaPct, setEntradaPct] = useState<string>("46"); // pontos % (prints)
  const [entradaRs, setEntradaRs] = useState<string>(""); // R$ (prioridade)
  const [iofPct, setIofPct] = useState<string>("0,96"); // pontos % (prints)
  const [iofRs, setIofRs] = useState<string>(""); // R$ (prioridade)
  const [emissaoCcb, setEmissaoCcb] = useState<string>("15000"); // R$ (prints)
  const [taxaTransf, setTaxaTransf] = useState<string>(""); // R$ (isenta por padrão)
  const [fundoPct, setFundoPct] = useState<string>("11"); // pontos % (prints)
  const [fundoRs, setFundoRs] = useState<string>(""); // R$ (prioridade)
  const [parcela, setParcela] = useState<string>(""); // R$ (p/ custo efetivo)
  const [prazo, setPrazo] = useState<string>(""); // meses (p/ custo efetivo)

  const creditoNum = num(credito);

  const resultado = useMemo(() => {
    if (creditoNum == null || creditoNum <= 0) return null;
    return calcularCompra({
      credito: creditoNum,
      entradaRs: num(entradaRs),
      entradaPct: fracaoPct(entradaPct),
      iofRs: num(iofRs),
      iofPct: fracaoPct(iofPct),
      emissaoCcbRs: num(emissaoCcb),
      taxaTransferenciaRs: num(taxaTransf),
      jurosFundoRs: num(fundoRs),
      jurosFundoPct: fracaoPct(fundoPct),
    });
  }, [
    creditoNum,
    entradaRs,
    entradaPct,
    iofRs,
    iofPct,
    emissaoCcb,
    taxaTransf,
    fundoRs,
    fundoPct,
  ]);

  // Custo efetivo do comprador — mesma fórmula das cartas (lib/custo-efetivo).
  // Saldo financiado = crédito líquido; paga `parcela` por `prazo` meses.
  // Dois lados: R$/mês (a parcela) e % a.m. (taxa efetiva).
  const custoEfetivo = useMemo(() => {
    if (resultado == null) return null;
    const p = num(parcela);
    const m = num(prazo);
    if (p == null || m == null || m <= 0) return null;
    return {
      mensalRs: p,
      taxaAm: taxaEfetivaMensal(resultado.creditoLiquido, p, m),
    };
  }, [resultado, parcela, prazo]);

  if (!aberto) {
    return (
      <div className={styles.lanceToggle}>
        <Button variant="ghost" size="sm" onClick={() => setAberto(true)}>
          Simular compra
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.lancePainel}>
      <div className={styles.lanceCabecalho}>
        <span className={styles.parcelasTitulo}>Simular compra (interno)</span>
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
          <span>Entrada (%)</span>
          <input
            inputMode="decimal"
            value={entradaPct}
            onChange={(e) => setEntradaPct(e.target.value)}
            placeholder="46"
          />
        </label>

        <label className={styles.lanceCampo}>
          <span>Entrada (R$, opcional)</span>
          <input
            inputMode="decimal"
            value={entradaRs}
            onChange={(e) => setEntradaRs(e.target.value)}
            placeholder="prioridade sobre %"
          />
        </label>

        <label className={styles.lanceCampo}>
          <span>IOF (%)</span>
          <input
            inputMode="decimal"
            value={iofPct}
            onChange={(e) => setIofPct(e.target.value)}
            placeholder="0,96"
          />
        </label>

        <label className={styles.lanceCampo}>
          <span>IOF (R$, opcional)</span>
          <input
            inputMode="decimal"
            value={iofRs}
            onChange={(e) => setIofRs(e.target.value)}
            placeholder="prioridade sobre %"
          />
        </label>

        <label className={styles.lanceCampo}>
          <span>Emissão CCB (R$)</span>
          <input
            inputMode="decimal"
            value={emissaoCcb}
            onChange={(e) => setEmissaoCcb(e.target.value)}
            placeholder="15000"
          />
        </label>

        <label className={styles.lanceCampo}>
          <span>Taxa de transf. (R$)</span>
          <input
            inputMode="decimal"
            value={taxaTransf}
            onChange={(e) => setTaxaTransf(e.target.value)}
            placeholder="isenta"
          />
        </label>

        <label className={styles.lanceCampo}>
          <span>Juros do fundo (%)</span>
          <input
            inputMode="decimal"
            value={fundoPct}
            onChange={(e) => setFundoPct(e.target.value)}
            placeholder="11"
          />
        </label>

        <label className={styles.lanceCampo}>
          <span>Juros do fundo (R$, opcional)</span>
          <input
            inputMode="decimal"
            value={fundoRs}
            onChange={(e) => setFundoRs(e.target.value)}
            placeholder="prioridade sobre %"
          />
        </label>

        <label className={styles.lanceCampo}>
          <span>Parcela (R$)</span>
          <input
            inputMode="decimal"
            value={parcela}
            onChange={(e) => setParcela(e.target.value)}
            placeholder="0,00"
          />
        </label>

        <label className={styles.lanceCampo}>
          <span>Prazo (meses)</span>
          <input
            inputMode="numeric"
            value={prazo}
            onChange={(e) => setPrazo(e.target.value)}
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
              <dt>Entrada</dt>
              <dd>{fmtValor(resultado.entradaRs)}</dd>
            </div>
            <div className={styles.row}>
              <dt>IOF</dt>
              <dd>{fmtValor(resultado.iofRs)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Emissão CCB</dt>
              <dd>{fmtValor(resultado.emissaoCcbRs)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Taxa de transferência</dt>
              <dd>{fmtValor(resultado.taxaTransferenciaRs)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Juros do fundo</dt>
              <dd>{fmtValor(resultado.jurosFundoRs)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Custos totais</dt>
              <dd>{fmtValor(resultado.custosTotais)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Crédito líquido</dt>
              <dd>{fmtValor(resultado.creditoLiquido)}</dd>
            </div>
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
