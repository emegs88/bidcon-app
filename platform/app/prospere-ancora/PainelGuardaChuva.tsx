"use client";
// ============================================================================
// Painel "Simular guarda-chuva" — UI interna da equipe Prospere (byAncora).
// ----------------------------------------------------------------------------
// USO INTERNO. Estes números (crédito somado, entrada, fundo comum, saldo
// devedor, parcela escalonada, custo efetivo) NUNCA aparecem para
// cliente/parceiro — vivem atrás do gate @prospere.com.br + RLS. Nada aqui é
// promessa de contemplação nem oferta ao cliente; é ferramenta de trabalho.
//
// O QUE FAZ: monta a assunção "guarda-chuva" — uma carta contemplada (mãe) a
// que se juntam OUTRAS cartas (junção), formando um único poder de compra, com
// parcelamento ESCALONADO por faixa de meses (ex.: 1–60 / 61–62). A equipe
// adiciona/remove cartas e faixas livremente. Todo o cálculo é delegado à
// função PURA `calcularGuardaChuva`; o custo efetivo reusa `lib/custo-efetivo`
// (mesma fórmula das cartas). Este componente só coleta entrada e formata
// saída. Sem I/O, sem rede.
// ============================================================================
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { brl } from "@/lib/format";
import {
  calcularGuardaChuva,
  type CartaJuncao,
  type FaixaEscalonada,
} from "@/lib/guarda-chuva-ancora";
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

// Linha de carta no form (strings cruas; convertidas só no cálculo).
type LinhaCarta = { rotulo: string; credito: string; fundoComumPct: string };

// Linha de faixa escalonada no form.
type LinhaFaixa = { de: string; ate: string; parcela: string };

export function PainelGuardaChuva({ creditoBase }: { creditoBase: number | null }) {
  const [aberto, setAberto] = useState(false);

  // Junção de cartas. A 1ª é a "mãe" (contemplada) — só rótulo; a aritmética
  // soma todas igual. Começa com a carta-base da linha, quando houver.
  const [cartas, setCartas] = useState<LinhaCarta[]>([
    {
      rotulo: "Carta contemplada (mãe)",
      credito: creditoBase != null ? String(creditoBase) : "",
      fundoComumPct: "",
    },
  ]);

  const [reajustePct, setReajustePct] = useState<string>(""); // pontos % (INCC/IPCA acumulado)
  const [entradaPct, setEntradaPct] = useState<string>("50"); // pontos % (Print 3)
  const [entradaRs, setEntradaRs] = useState<string>(""); // R$ (prioridade)
  const [taxaAdmPct, setTaxaAdmPct] = useState<string>(""); // pontos % (p/ estimar saldo devedor)
  const [saldoDevedor, setSaldoDevedor] = useState<string>(""); // R$ (prioridade sobre a estimativa)

  // Faixas do escalonado (ex.: 1–60 / 61–62). Começa com uma faixa vazia.
  const [faixas, setFaixas] = useState<LinhaFaixa[]>([
    { de: "1", ate: "", parcela: "" },
  ]);

  // --- Mutadores das listas dinâmicas ---
  function addCarta() {
    setCartas((cs) => [...cs, { rotulo: "", credito: "", fundoComumPct: "" }]);
  }
  function delCarta(i: number) {
    setCartas((cs) => (cs.length > 1 ? cs.filter((_, k) => k !== i) : cs));
  }
  function setCarta(i: number, campo: keyof LinhaCarta, v: string) {
    setCartas((cs) => cs.map((c, k) => (k === i ? { ...c, [campo]: v } : c)));
  }

  function addFaixa() {
    setFaixas((fs) => [...fs, { de: "", ate: "", parcela: "" }]);
  }
  function delFaixa(i: number) {
    setFaixas((fs) => (fs.length > 1 ? fs.filter((_, k) => k !== i) : fs));
  }
  function setFaixa(i: number, campo: keyof LinhaFaixa, v: string) {
    setFaixas((fs) => fs.map((f, k) => (k === i ? { ...f, [campo]: v } : f)));
  }

  const resultado = useMemo(() => {
    const cartasCalc: CartaJuncao[] = cartas
      .map((c) => ({
        rotulo: c.rotulo.trim() || null,
        credito: num(c.credito) ?? 0,
        fundoComumPct: fracaoPct(c.fundoComumPct),
      }))
      .filter((c) => c.credito > 0);

    if (cartasCalc.length === 0) return null;

    const escalonado: FaixaEscalonada[] = faixas
      .map((f) => ({
        de: num(f.de) ?? 0,
        ate: num(f.ate) ?? 0,
        parcela: num(f.parcela) ?? 0,
      }))
      .filter((f) => f.de > 0 || f.ate > 0 || f.parcela > 0);

    return calcularGuardaChuva({
      cartas: cartasCalc,
      reajusteAcumulado: fracaoPct(reajustePct),
      entradaRs: num(entradaRs),
      entradaPct: fracaoPct(entradaPct),
      taxaAdministracao: fracaoPct(taxaAdmPct),
      saldoDevedor: num(saldoDevedor),
      escalonado,
    });
  }, [cartas, faixas, reajustePct, entradaRs, entradaPct, taxaAdmPct, saldoDevedor]);

  if (!aberto) {
    return (
      <div className={styles.lanceToggle}>
        <Button variant="ghost" size="sm" onClick={() => setAberto(true)}>
          Simular guarda-chuva
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.lancePainel}>
      <div className={styles.lanceCabecalho}>
        <span className={styles.parcelasTitulo}>Simular guarda-chuva (interno)</span>
        <Button variant="ghost" size="sm" onClick={() => setAberto(false)}>
          Fechar
        </Button>
      </div>

      {/* --- Junção de cartas (a 1ª é a mãe contemplada) --- */}
      <div className={styles.parcelasTitulo}>Cartas da junção</div>
      <div className={styles.gcLista}>
        {cartas.map((c, i) => (
          <div key={i} className={styles.gcLinha}>
            <label className={styles.lanceCampo}>
              <span>{i === 0 ? "Rótulo (mãe)" : "Rótulo"}</span>
              <input
                value={c.rotulo}
                onChange={(e) => setCarta(i, "rotulo", e.target.value)}
                placeholder={i === 0 ? "contemplada" : "carta"}
              />
            </label>
            <label className={styles.lanceCampo}>
              <span>Crédito (R$)</span>
              <input
                inputMode="decimal"
                value={c.credito}
                onChange={(e) => setCarta(i, "credito", e.target.value)}
                placeholder="0,00"
              />
            </label>
            <label className={styles.lanceCampo}>
              <span>Fundo comum (%)</span>
              <input
                inputMode="decimal"
                value={c.fundoComumPct}
                onChange={(e) => setCarta(i, "fundoComumPct", e.target.value)}
                placeholder="opcional"
              />
            </label>
            <div className={styles.gcAcoes}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => delCarta(i)}
                disabled={cartas.length <= 1}
              >
                Remover
              </Button>
            </div>
          </div>
        ))}
      </div>
      <div>
        <Button variant="ghost" size="sm" onClick={addCarta}>
          + Adicionar carta
        </Button>
      </div>

      {/* --- Parâmetros da operação --- */}
      <div className={styles.lanceForm}>
        <label className={styles.lanceCampo}>
          <span>Reajuste acum. (%)</span>
          <input
            inputMode="decimal"
            value={reajustePct}
            onChange={(e) => setReajustePct(e.target.value)}
            placeholder="INCC/IPCA, opcional"
          />
        </label>
        <label className={styles.lanceCampo}>
          <span>Entrada (%)</span>
          <input
            inputMode="decimal"
            value={entradaPct}
            onChange={(e) => setEntradaPct(e.target.value)}
            placeholder="50"
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
          <span>Taxa adm. (%)</span>
          <input
            inputMode="decimal"
            value={taxaAdmPct}
            onChange={(e) => setTaxaAdmPct(e.target.value)}
            placeholder="p/ estimar saldo"
          />
        </label>
        <label className={styles.lanceCampo}>
          <span>Saldo devedor (R$, opcional)</span>
          <input
            inputMode="decimal"
            value={saldoDevedor}
            onChange={(e) => setSaldoDevedor(e.target.value)}
            placeholder="prioridade sobre taxa adm."
          />
        </label>
      </div>

      {/* --- Escalonamento (faixas de meses) --- */}
      <div className={styles.parcelasTitulo}>Parcelamento escalonado</div>
      <div className={styles.gcLista}>
        {faixas.map((f, i) => (
          <div key={i} className={styles.gcLinha}>
            <label className={styles.lanceCampo}>
              <span>De (mês)</span>
              <input
                inputMode="numeric"
                value={f.de}
                onChange={(e) => setFaixa(i, "de", e.target.value)}
                placeholder="1"
              />
            </label>
            <label className={styles.lanceCampo}>
              <span>Até (mês)</span>
              <input
                inputMode="numeric"
                value={f.ate}
                onChange={(e) => setFaixa(i, "ate", e.target.value)}
                placeholder="60"
              />
            </label>
            <label className={styles.lanceCampo}>
              <span>Parcela (R$)</span>
              <input
                inputMode="decimal"
                value={f.parcela}
                onChange={(e) => setFaixa(i, "parcela", e.target.value)}
                placeholder="0,00"
              />
            </label>
            <div className={styles.gcAcoes}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => delFaixa(i)}
                disabled={faixas.length <= 1}
              >
                Remover
              </Button>
            </div>
          </div>
        ))}
      </div>
      <div>
        <Button variant="ghost" size="sm" onClick={addFaixa}>
          + Adicionar faixa
        </Button>
      </div>

      {resultado == null ? (
        <p className={styles.lanceDica}>
          Informe ao menos uma carta com crédito maior que zero para simular.
        </p>
      ) : (
        <>
          <dl className={styles.dl}>
            <div className={styles.row}>
              <dt>Cartas na junção</dt>
              <dd>{resultado.quantidadeCartas}</dd>
            </div>
            <div className={styles.row}>
              <dt>Crédito somado</dt>
              <dd>{fmtValor(resultado.creditoSomado)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Entrada</dt>
              <dd>{fmtValor(resultado.entradaRs)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Fundo comum</dt>
              <dd>{fmtValor(resultado.fundoComumRs)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Saldo devedor</dt>
              <dd>{fmtValor(resultado.saldoDevedor)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Crédito líquido</dt>
              <dd>{fmtValor(resultado.creditoLiquido)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Parcela inicial</dt>
              <dd>{fmtValor(resultado.parcelaInicial)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Prazo total</dt>
              <dd>{resultado.prazoTotal != null ? `${resultado.prazoTotal}m` : "—"}</dd>
            </div>
            <div className={styles.row}>
              <dt>Total parcelado</dt>
              <dd>{fmtValor(resultado.totalParcelado)}</dd>
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
