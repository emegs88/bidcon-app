"use client";
// ============================================================================
// Painel "Simular locação de veículo" — UI interna da equipe Prospere (byAncora).
// ----------------------------------------------------------------------------
// USO INTERNO. Estes números (locação líquida, cobertura da parcela, payback,
// resultado no prazo, custo efetivo) NUNCA aparecem para cliente/parceiro —
// vivem atrás do gate @prospere.com.br + RLS. Nada aqui é promessa de
// contemplação, de renda ou de locação garantida ao cliente; é ferramenta de
// trabalho da equipe para AVALIAR uma operação.
//
// O QUE FAZ: dada a parcela e o prazo da carta e uma LOCAÇÃO mensal estimada do
// veículo (a equipe digita; os botões de sugestão só PREENCHEM o campo), mostra
// o quanto a locação cobre a parcela e como fica a conta no prazo. Ajustes
// opcionais: ocupação (%), custos mensais (R$) e comissão (%). Todo o cálculo é
// delegado à função PURA `calcularLocacaoVeiculo`; o custo efetivo reusa
// `lib/custo-efetivo`. Este componente só coleta entrada e formata saída.
//
// IMPORTANTE (compliance): as "sugestões" são ESTIMATIVAS INTERNAS de trabalho
// da equipe — NÃO são tabela de preços, oferta nem promessa de locação. A
// equipe confirma/edita sempre.
// ============================================================================
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { brl } from "@/lib/format";
import { calcularLocacaoVeiculo } from "@/lib/locacao-veiculo-ancora";
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

function fmtPct(fracao: number | null): string {
  if (fracao == null) return "—";
  return (fracao * 100).toFixed(0).replace(".", ",") + "%";
}

// Sugestões de locação mensal (ESTIMATIVAS internas — só preenchem o campo).
// Não são tabela/oferta; a equipe confirma/edita. Ajuste livre desta lista.
const SUGESTOES: { rotulo: string; valor: number }[] = [
  { rotulo: "BYD Dolphin", valor: 5000 },
  { rotulo: "BYD Song", valor: 6500 },
  { rotulo: "Compacto", valor: 3500 },
  { rotulo: "SUV", valor: 7000 },
];

export function PainelLocacaoVeiculo({
  creditoBase,
}: {
  creditoBase: number | null;
}) {
  const [aberto, setAberto] = useState(false);

  const [parcela, setParcela] = useState<string>("");
  const [prazo, setPrazo] = useState<string>("");
  const [locacaoMensal, setLocacaoMensal] = useState<string>("");

  // Ajustes opcionais.
  const [ocupacaoPct, setOcupacaoPct] = useState<string>("");
  const [custosMensais, setCustosMensais] = useState<string>("");
  const [comissaoPct, setComissaoPct] = useState<string>("");

  // Crédito líquido p/ custo efetivo (começa com a carta-base, quando houver).
  const [creditoLiquido, setCreditoLiquido] = useState<string>(
    creditoBase != null ? String(creditoBase) : ""
  );

  const resultado = useMemo(() => {
    return calcularLocacaoVeiculo({
      parcela: num(parcela),
      prazo: num(prazo),
      locacaoMensal: num(locacaoMensal),
      ocupacaoPct: fracaoPct(ocupacaoPct),
      custosMensais: num(custosMensais),
      comissaoPct: fracaoPct(comissaoPct),
      creditoLiquido: num(creditoLiquido),
    });
  }, [
    parcela,
    prazo,
    locacaoMensal,
    ocupacaoPct,
    custosMensais,
    comissaoPct,
    creditoLiquido,
  ]);

  const temEntradaMinima = num(locacaoMensal) != null || num(parcela) != null;

  if (!aberto) {
    return (
      <div className={styles.lanceToggle}>
        <Button variant="ghost" size="sm" onClick={() => setAberto(true)}>
          Simular locação de veículo
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.lancePainel}>
      <div className={styles.lanceCabecalho}>
        <span className={styles.parcelasTitulo}>
          Simular locação de veículo (interno)
        </span>
        <Button variant="ghost" size="sm" onClick={() => setAberto(false)}>
          Fechar
        </Button>
      </div>

      {/* --- Locação mensal + sugestões (só preenchem o campo) --- */}
      <div className={styles.lanceForm}>
        <label className={styles.lanceCampo}>
          <span>Locação mensal (R$)</span>
          <input
            inputMode="decimal"
            value={locacaoMensal}
            onChange={(e) => setLocacaoMensal(e.target.value)}
            placeholder="0,00"
          />
        </label>
      </div>
      <div className={styles.sugestoes}>
        <span className={styles.sugestoesRotulo}>Sugestões (estimativa):</span>
        {SUGESTOES.map((s) => (
          <Button
            key={s.rotulo}
            variant="ghost"
            size="sm"
            onClick={() => setLocacaoMensal(String(s.valor))}
          >
            {s.rotulo} · {brl(s.valor)}
          </Button>
        ))}
      </div>

      {/* --- Parcela e prazo da carta --- */}
      <div className={styles.lanceForm}>
        <label className={styles.lanceCampo}>
          <span>Parcela da carta (R$)</span>
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
            placeholder="ex.: 80"
          />
        </label>
        <label className={styles.lanceCampo}>
          <span>Crédito líquido (R$, opcional)</span>
          <input
            inputMode="decimal"
            value={creditoLiquido}
            onChange={(e) => setCreditoLiquido(e.target.value)}
            placeholder="p/ custo efetivo"
          />
        </label>
      </div>

      {/* --- Ajustes opcionais da locação --- */}
      <div className={styles.parcelasTitulo}>Ajustes da locação (opcional)</div>
      <div className={styles.lanceForm}>
        <label className={styles.lanceCampo}>
          <span>Ocupação (%)</span>
          <input
            inputMode="decimal"
            value={ocupacaoPct}
            onChange={(e) => setOcupacaoPct(e.target.value)}
            placeholder="ex.: 80"
          />
        </label>
        <label className={styles.lanceCampo}>
          <span>Custos mensais (R$)</span>
          <input
            inputMode="decimal"
            value={custosMensais}
            onChange={(e) => setCustosMensais(e.target.value)}
            placeholder="manutenção, seguro…"
          />
        </label>
        <label className={styles.lanceCampo}>
          <span>Comissão (%)</span>
          <input
            inputMode="decimal"
            value={comissaoPct}
            onChange={(e) => setComissaoPct(e.target.value)}
            placeholder="sobre a receita"
          />
        </label>
      </div>

      {!temEntradaMinima ? (
        <p className={styles.lanceDica}>
          Informe a locação mensal e a parcela da carta para simular.
        </p>
      ) : (
        <>
          <dl className={styles.dl}>
            <div className={styles.row}>
              <dt>Locação bruta</dt>
              <dd>{fmtValor(resultado.locacaoBruta)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Locação líquida</dt>
              <dd>{fmtValor(resultado.locacaoLiquida)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Parcela da carta</dt>
              <dd>{fmtValor(resultado.parcela)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Cobertura da parcela</dt>
              <dd>
                {resultado.coberturaMensal == null ? (
                  "—"
                ) : (
                  <span
                    className={
                      resultado.cobreParcela
                        ? styles.coberturaPos
                        : styles.coberturaNeg
                    }
                  >
                    {fmtValor(resultado.coberturaMensal)}
                    {resultado.coberturaPct != null &&
                      ` · ${fmtPct(resultado.coberturaPct)}`}
                  </span>
                )}
              </dd>
            </div>
            <div className={styles.row}>
              <dt>Prazo</dt>
              <dd>{resultado.prazo != null ? `${resultado.prazo}m` : "—"}</dd>
            </div>
            <div className={styles.row}>
              <dt>Total pago (parcela × prazo)</dt>
              <dd>{fmtValor(resultado.totalPago)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Total locação no prazo</dt>
              <dd>{fmtValor(resultado.totalLocacao)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Resultado no prazo</dt>
              <dd>
                {resultado.resultadoPrazo == null ? (
                  "—"
                ) : (
                  <span
                    className={
                      resultado.resultadoPrazo >= 0
                        ? styles.coberturaPos
                        : styles.coberturaNeg
                    }
                  >
                    {fmtValor(resultado.resultadoPrazo)}
                  </span>
                )}
              </dd>
            </div>
            <div className={styles.row}>
              <dt>Meses p/ quitar (payback)</dt>
              <dd>
                {resultado.mesesParaQuitar != null
                  ? `${resultado.mesesParaQuitar}m`
                  : "—"}
              </dd>
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
