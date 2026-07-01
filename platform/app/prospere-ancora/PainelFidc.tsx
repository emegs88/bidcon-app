"use client";
// ============================================================================
// Painel "Simular FIDC" — UI interna da equipe Prospere (byAncora).
// ----------------------------------------------------------------------------
// USO INTERNO. Estes números (crédito, entrada fundeada, custos do fundo —
// IOF, juros do fundo, emissão CCB, taxa de transferência —, crédito líquido,
// custo efetivo) NUNCA aparecem para cliente/parceiro. Vivem atrás do gate
// @prospere.com.br + RLS. Nada aqui é promessa de contemplação nem oferta ao
// cliente; é ferramenta de trabalho.
//
// O QUE FAZ: replica o print da operação FIDC — o fundo banca a ENTRADA de uma
// operação (crédito × entrada%), incidem custos NOMEADOS (IOF % e juros do
// fundo % sobre a entrada; emissão CCB e taxa de transf. em R$ fixo, esta
// última dispensável), e o cliente recebe o CRÉDITO LÍQUIDO. A equipe digita
// as taxas/valores (nada é inventado). Todo o cálculo é delegado à função PURA
// `calcularFidc`; o custo efetivo reusa `lib/custo-efetivo`. Este componente só
// coleta entrada e formata saída. Sem I/O, sem rede.
// ============================================================================
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { brl } from "@/lib/format";
import { calcularFidc } from "@/lib/fidc-ancora";
import { fmtCustoEfetivo } from "@/lib/custo-efetivo";
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

export function PainelFidc({ creditoBase }: { creditoBase: number | null }) {
  const [aberto, setAberto] = useState(false);

  // Crédito da operação. Começa com a carta-base da linha, quando houver.
  const [credito, setCredito] = useState<string>(
    creditoBase != null ? String(creditoBase) : ""
  );

  // Entrada fundeada: % do crédito (padrão do print) OU R$ (prioridade).
  const [entradaPct, setEntradaPct] = useState<string>(""); // pontos %
  const [entradaRs, setEntradaRs] = useState<string>(""); // R$ (prioridade)

  // Custos do fundo — percentuais sobre a ENTRADA.
  const [iofPct, setIofPct] = useState<string>(""); // pontos %
  const [jurosPct, setJurosPct] = useState<string>(""); // pontos %
  // Custos do fundo — valores fixos em R$.
  const [emissaoCcbRs, setEmissaoCcbRs] = useState<string>("");
  const [taxaTransfRs, setTaxaTransfRs] = useState<string>("");
  const [taxaTransfDispensada, setTaxaTransfDispensada] = useState<boolean>(false);

  // Contexto do funding (rodapé "operação em X dias"). Só rótulo.
  const [prazoDias, setPrazoDias] = useState<string>("");

  // Médias da carteira p/ o custo efetivo (opcionais).
  const [prazoMedio, setPrazoMedio] = useState<string>("");
  const [parcelaMedia, setParcelaMedia] = useState<string>("");

  const resultado = useMemo(() => {
    const cred = num(credito);
    if (cred == null || cred <= 0) return null;

    return calcularFidc({
      credito: cred,
      entradaRs: num(entradaRs),
      entradaPct: fracaoPct(entradaPct),
      iofPct: fracaoPct(iofPct),
      jurosPct: fracaoPct(jurosPct),
      emissaoCcbRs: num(emissaoCcbRs),
      taxaTransfRs: num(taxaTransfRs),
      taxaTransfDispensada,
      prazoDias: num(prazoDias),
      prazoMedio: num(prazoMedio),
      parcelaMedia: num(parcelaMedia),
    });
  }, [
    credito,
    entradaRs,
    entradaPct,
    iofPct,
    jurosPct,
    emissaoCcbRs,
    taxaTransfRs,
    taxaTransfDispensada,
    prazoDias,
    prazoMedio,
    parcelaMedia,
  ]);

  if (!aberto) {
    return (
      <div className={styles.lanceToggle}>
        <Button variant="ghost" size="sm" onClick={() => setAberto(true)}>
          Simular FIDC
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.lancePainel}>
      <div className={styles.lanceCabecalho}>
        <span className={styles.parcelasTitulo}>Simular FIDC (interno)</span>
        <Button variant="ghost" size="sm" onClick={() => setAberto(false)}>
          Fechar
        </Button>
      </div>

      {/* --- Crédito e entrada fundeada --- */}
      <div className={styles.lanceForm}>
        <label className={styles.lanceCampo}>
          <span>Crédito (R$)</span>
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
            placeholder="ex.: 46"
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
      </div>

      {/* --- Custos do fundo --- */}
      <div className={styles.parcelasTitulo}>Custos do fundo</div>
      <div className={styles.lanceForm}>
        <label className={styles.lanceCampo}>
          <span>IOF (% da entrada)</span>
          <input
            inputMode="decimal"
            value={iofPct}
            onChange={(e) => setIofPct(e.target.value)}
            placeholder="ex.: 0,96"
          />
        </label>
        <label className={styles.lanceCampo}>
          <span>Juros do fundo (% da entrada)</span>
          <input
            inputMode="decimal"
            value={jurosPct}
            onChange={(e) => setJurosPct(e.target.value)}
            placeholder="ex.: 11"
          />
        </label>
        <label className={styles.lanceCampo}>
          <span>Emissão CCB (R$)</span>
          <input
            inputMode="decimal"
            value={emissaoCcbRs}
            onChange={(e) => setEmissaoCcbRs(e.target.value)}
            placeholder="0,00"
          />
        </label>
        <label className={styles.lanceCampo}>
          <span>Taxa de transf. (R$)</span>
          <input
            inputMode="decimal"
            value={taxaTransfRs}
            onChange={(e) => setTaxaTransfRs(e.target.value)}
            placeholder="0,00"
            disabled={taxaTransfDispensada}
          />
        </label>
        <label className={styles.lanceCampo}>
          <span>Dispensar taxa de transf.?</span>
          <select
            value={taxaTransfDispensada ? "sim" : "nao"}
            onChange={(e) => setTaxaTransfDispensada(e.target.value === "sim")}
          >
            <option value="nao">Não</option>
            <option value="sim">Sim (dispensada)</option>
          </select>
        </label>
      </div>

      {/* --- Contexto e médias (opcionais) --- */}
      <div className={styles.parcelasTitulo}>Contexto e médias (opcional)</div>
      <div className={styles.lanceForm}>
        <label className={styles.lanceCampo}>
          <span>Prazo da operação (dias)</span>
          <input
            inputMode="numeric"
            value={prazoDias}
            onChange={(e) => setPrazoDias(e.target.value)}
            placeholder="ex.: 60"
          />
        </label>
        <label className={styles.lanceCampo}>
          <span>Prazo médio (meses)</span>
          <input
            inputMode="numeric"
            value={prazoMedio}
            onChange={(e) => setPrazoMedio(e.target.value)}
            placeholder="p/ custo efetivo"
          />
        </label>
        <label className={styles.lanceCampo}>
          <span>Parcela média (R$)</span>
          <input
            inputMode="decimal"
            value={parcelaMedia}
            onChange={(e) => setParcelaMedia(e.target.value)}
            placeholder="p/ custo efetivo"
          />
        </label>
      </div>

      {resultado == null ? (
        <p className={styles.lanceDica}>
          Informe o crédito da operação (maior que zero) para simular.
        </p>
      ) : (
        <>
          <dl className={styles.dl}>
            <div className={styles.row}>
              <dt>Crédito</dt>
              <dd>{fmtValor(resultado.credito)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Entrada (fundeada)</dt>
              <dd>{fmtValor(resultado.entrada)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Saldo bruto (crédito − entrada)</dt>
              <dd>{fmtValor(resultado.saldoBruto)}</dd>
            </div>
            <div className={styles.row}>
              <dt>IOF</dt>
              <dd>{fmtValor(resultado.iof)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Juros do fundo</dt>
              <dd>{fmtValor(resultado.jurosFundo)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Emissão CCB</dt>
              <dd>{fmtValor(resultado.emissaoCcb)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Taxa de transf.</dt>
              <dd>
                {resultado.taxaTransfDispensada
                  ? "dispensada"
                  : fmtValor(resultado.taxaTransf)}
              </dd>
            </div>
            <div className={styles.row}>
              <dt>Custos do fundo</dt>
              <dd>{fmtValor(resultado.custosDoFundo)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Crédito líquido</dt>
              <dd>{fmtValor(resultado.creditoLiquido)}</dd>
            </div>
            {resultado.custoEfetivoAm != null && (
              <div className={styles.row}>
                <dt>Custo efetivo</dt>
                <dd>{fmtCustoEfetivo(resultado.custoEfetivoAm)}</dd>
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
