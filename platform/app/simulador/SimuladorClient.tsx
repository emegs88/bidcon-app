"use client";
// Simulador Conta Notarial para Parceiros (fatia SIM-PARCEIRO-01) — wizard de
// 3 passos: (1) escolher administradora elegível, (2) montar a cesta de
// junção com o estoque AO VIVO dessa administradora (via /api/simulador/cotas),
// (3) demonstrativo com os dois objetivos (aquisição direta / levantamento de
// capital), saída por WhatsApp (wa.me) e impressão/PDF (window.print()).
//
// Toda a matemática vem de lib/simulador/engine.ts (motor puro, já validado
// por lib/simulador/engine.test.ts contra os dois datasets de aceite do
// prompt). Este componente só monta o fluxo, formata e apresenta — não
// recalcula nada por conta própria.
//
// Compliance de linguagem (CLAUDE.md): nunca "investimento/investidor/
// rendimento/retorno/lucro/CDI"; usar "planejamento/compra programada/carta
// de crédito/poder de compra/patrimônio"; custo financeiro sempre como TIR
// ao mês (nunca % nominal simples); nunca prometer data de contemplação;
// administradora sempre exposta.

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { brl, linkWhatsApp } from "@/lib/format";
import {
  type CotaSim,
  type ParamsFundo,
  escalaParcelas,
  saldoDevedor,
  tirMensal,
  tirCliente,
  anualEquivalente,
  custosFundo,
  liquidoCliente,
} from "@/lib/simulador/engine";
import type { AdministradoraElegivel } from "@/lib/simulador/data";
import styles from "./SimuladorClient.module.css";

type Passo = "administradora" | "cesta" | "demonstrativo";
type Objetivo = "aquisicao" | "levantamento";

const PARAMS_FUNDO_PADRAO: ParamsFundo = {
  fundoPct: 11,
  ccb: 15_000,
  iofPct: 0.96,
  taxaNoLiquido: false,
};

function somaCredito(cotas: CotaSim[]): number {
  return cotas.reduce((s, c) => s + c.credito, 0);
}
function somaEntrada(cotas: CotaSim[]): number {
  return cotas.reduce((s, c) => s + c.entrada, 0);
}

function tirParaTexto(i: number | null): string {
  if (i == null) return "não fecha numa taxa única neste cenário";
  return `${(i * 100).toFixed(3).replace(".", ",")}% a.m.`;
}

export function SimuladorClient({
  administradoras,
}: {
  administradoras: AdministradoraElegivel[];
}) {
  const [passo, setPasso] = useState<Passo>("administradora");

  const [administradoraId, setAdministradoraId] = useState<string | null>(null);
  const [cotasEstoque, setCotasEstoque] = useState<CotaSim[]>([]);
  const [carregandoCotas, setCarregandoCotas] = useState(false);
  const [erroEstoque, setErroEstoque] = useState("");

  const [cestaIds, setCestaIds] = useState<Set<string>>(new Set());

  const [objetivo, setObjetivo] = useState<Objetivo>("aquisicao");
  const [taxaTransferencia, setTaxaTransferencia] = useState(0);
  const [paramsFundo, setParamsFundo] = useState<ParamsFundo>(PARAMS_FUNDO_PADRAO);
  const [whatsCliente, setWhatsCliente] = useState("");

  const administradoraAtual = useMemo(
    () => administradoras.find((a) => a.id === administradoraId) ?? null,
    [administradoras, administradoraId],
  );

  const cesta = useMemo(
    () => cotasEstoque.filter((c) => cestaIds.has(c.id)),
    [cotasEstoque, cestaIds],
  );

  async function escolherAdministradora(id: string) {
    setAdministradoraId(id);
    setCestaIds(new Set());
    setErroEstoque("");
    setCarregandoCotas(true);
    setPasso("cesta");
    try {
      const r = await fetch(`/api/simulador/cotas?administradoraId=${encodeURIComponent(id)}`);
      const d = await r.json();
      if (!r.ok || d.erro) throw new Error(d.erro ?? "Falha ao ler estoque.");
      setCotasEstoque(d.cotas ?? []);
    } catch (e) {
      setErroEstoque(e instanceof Error ? e.message : "Falha ao ler estoque.");
      setCotasEstoque([]);
    } finally {
      setCarregandoCotas(false);
    }
  }

  function alternarCota(id: string) {
    setCestaIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ---- derivados do demonstrativo (motor puro, lib/simulador/engine.ts) ----
  const poderCompra = somaCredito(cesta);
  const entradaTotal = somaEntrada(cesta);
  const escala = escalaParcelas(cesta);
  const saldo = saldoDevedor(cesta);

  const desembolsoInicial = entradaTotal + taxaTransferencia;
  const tirAquisicao = objetivo === "aquisicao" ? tirMensal(cesta, desembolsoInicial) : null;
  const tirAquisicaoAnual = tirAquisicao != null ? anualEquivalente(tirAquisicao) : null;

  const custos = objetivo === "levantamento" ? custosFundo(entradaTotal, paramsFundo) : null;
  const liquido =
    objetivo === "levantamento"
      ? liquidoCliente(cesta, entradaTotal, taxaTransferencia, paramsFundo)
      : null;
  const tirLevantamento =
    objetivo === "levantamento"
      ? tirCliente(cesta, entradaTotal, taxaTransferencia, paramsFundo)
      : null;
  const tirLevantamentoAnual = tirLevantamento != null ? anualEquivalente(tirLevantamento) : null;

  function textoWhatsApp(): string {
    const linhas: string[] = [];
    linhas.push(`*Planejamento — carta(s) de crédito ${administradoraAtual?.nome ?? ""}*`);
    linhas.push("");
    cesta.forEach((c) => {
      linhas.push(`• ${c.ref} — crédito ${brl(c.credito)} · ${c.prazo}x ${brl(c.parcela)}`);
    });
    linhas.push("");
    linhas.push(`Poder de compra total: ${brl(poderCompra)}`);
    if (objetivo === "aquisicao") {
      linhas.push(`Entrada via Conta Notarial: ${brl(desembolsoInicial)}`);
      linhas.push(`Custo financeiro (TIR): ${tirParaTexto(tirAquisicao)}`);
    } else {
      linhas.push(`Crédito líquido em conta: ${liquido != null ? brl(liquido) : "—"}`);
      linhas.push(`Custo financeiro (TIR): ${tirParaTexto(tirLevantamento)}`);
    }
    linhas.push("");
    linhas.push(
      "Pagamento protegido por Conta Notarial (Banco Safra, 5º Tabelionato de Notas de Campinas) — valor só é liberado após aprovação da administradora.",
    );
    linhas.push("");
    linhas.push(
      "Simulação de planejamento e compra programada. Não há data de contemplação prometida.",
    );
    return linhas.join("\n");
  }

  const podeAvancarParaDemonstrativo = cesta.length > 0;

  return (
    <div className={styles.wrap}>
      <div className={styles.steps} data-print="hide">
        <span className={`${styles.stepPill} ${passo === "administradora" ? styles.stepPillActive : administradoraId ? styles.stepPillDone : ""}`}>
          1. Administradora
        </span>
        <span className={`${styles.stepPill} ${passo === "cesta" ? styles.stepPillActive : cesta.length > 0 ? styles.stepPillDone : ""}`}>
          2. Cesta
        </span>
        <span className={`${styles.stepPill} ${passo === "demonstrativo" ? styles.stepPillActive : ""}`}>
          3. Demonstrativo
        </span>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Passo 1 — administradora                                         */}
      {/* ---------------------------------------------------------------- */}
      {passo === "administradora" && (
        <section className={styles.gridAdm}>
          {administradoras.length === 0 && (
            <p className={styles.erro}>Nenhuma administradora elegível no momento.</p>
          )}
          {administradoras.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`${styles.admCard} ${administradoraId === a.id ? styles.admCardActive : ""}`}
              onClick={() => escolherAdministradora(a.id)}
            >
              <div className={styles.admNome}>{a.nome}</div>
              {a.segmentos && a.segmentos.length > 0 && (
                <div className={styles.admHint}>{a.segmentos.join(" · ")}</div>
              )}
              {a.exigenciaGarantiaPct != null && (
                <div className={styles.admHint}>
                  Exigência de garantia: {a.exigenciaGarantiaPct}%
                </div>
              )}
            </button>
          ))}
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Passo 2 — cesta                                                   */}
      {/* ---------------------------------------------------------------- */}
      {passo === "cesta" && (
        <section className={styles.wrap}>
          <div className={styles.actionsBar} data-print="hide">
            <Button variant="ghost" size="sm" onClick={() => setPasso("administradora")}>
              ← Trocar administradora
            </Button>
            <strong>{administradoraAtual?.nome}</strong>
          </div>

          {carregandoCotas && <p>Carregando estoque…</p>}
          {erroEstoque && <p className={styles.erro}>{erroEstoque}</p>}

          {!carregandoCotas && !erroEstoque && (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th></th>
                      <th>Carta</th>
                      <th>Crédito</th>
                      <th>Entrada</th>
                      <th>Prazo</th>
                      <th>Parcela</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cotasEstoque.length === 0 && (
                      <tr>
                        <td colSpan={6}>Nenhuma cota disponível nesta administradora agora.</td>
                      </tr>
                    )}
                    {cotasEstoque.map((c) => (
                      <tr
                        key={c.id}
                        className={cestaIds.has(c.id) ? styles.rowSelected : ""}
                      >
                        <td>
                          <input
                            type="checkbox"
                            checked={cestaIds.has(c.id)}
                            onChange={() => alternarCota(c.id)}
                          />
                        </td>
                        <td>
                          {c.ref}
                          {c.exclusiva && <span className={styles.badgeExclusiva}>exclusiva</span>}
                        </td>
                        <td className={styles.mono}>{brl(c.credito)}</td>
                        <td className={styles.mono}>{brl(c.entrada)}</td>
                        <td className={styles.mono}>{c.prazo}x</td>
                        <td className={styles.mono}>{brl(c.parcela)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={styles.totaisBar}>
                <div className={styles.totalItem}>
                  <span className={styles.totalLabel}>Cotas na cesta</span>
                  <span className={styles.totalValor}>{cesta.length}</span>
                </div>
                <div className={styles.totalItem}>
                  <span className={styles.totalLabel}>Poder de compra</span>
                  <span className={styles.totalValor}>{brl(poderCompra)}</span>
                </div>
                <div className={styles.totalItem}>
                  <span className={styles.totalLabel}>Entrada total</span>
                  <span className={styles.totalValor}>{brl(entradaTotal)}</span>
                </div>
                <div style={{ flex: 1 }} />
                <Button
                  variant="primary"
                  disabled={!podeAvancarParaDemonstrativo}
                  onClick={() => setPasso("demonstrativo")}
                >
                  Gerar demonstrativo →
                </Button>
              </div>
            </>
          )}
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Passo 3 — demonstrativo                                           */}
      {/* ---------------------------------------------------------------- */}
      {passo === "demonstrativo" && (
        <section className={styles.wrap}>
          <div className={styles.actionsBar} data-print="hide">
            <Button variant="ghost" size="sm" onClick={() => setPasso("cesta")}>
              ← Ajustar cesta
            </Button>
            <div className={styles.objetivoToggle}>
              <button
                type="button"
                className={`${styles.objetivoBtn} ${objetivo === "aquisicao" ? styles.objetivoBtnActive : ""}`}
                onClick={() => setObjetivo("aquisicao")}
              >
                Aquisição direta
              </button>
              <button
                type="button"
                className={`${styles.objetivoBtn} ${objetivo === "levantamento" ? styles.objetivoBtnActive : ""}`}
                onClick={() => setObjetivo("levantamento")}
              >
                Levantamento de capital
              </button>
            </div>
          </div>

          <div className={styles.formGrid} data-print="hide">
            <div className={styles.field}>
              <label>Taxa de transferência (R$)</label>
              <input
                type="number"
                value={taxaTransferencia}
                onChange={(e) => setTaxaTransferencia(Number(e.target.value) || 0)}
              />
            </div>
            {objetivo === "levantamento" && (
              <>
                <div className={styles.field}>
                  <label>Remuneração do fundo (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={paramsFundo.fundoPct}
                    onChange={(e) =>
                      setParamsFundo((p) => ({ ...p, fundoPct: Number(e.target.value) || 0 }))
                    }
                  />
                </div>
                <div className={styles.field}>
                  <label>CCB — estruturação/emissão (R$)</label>
                  <input
                    type="number"
                    value={paramsFundo.ccb}
                    onChange={(e) =>
                      setParamsFundo((p) => ({ ...p, ccb: Number(e.target.value) || 0 }))
                    }
                  />
                </div>
                <div className={styles.field}>
                  <label>IOF (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={paramsFundo.iofPct}
                    onChange={(e) =>
                      setParamsFundo((p) => ({ ...p, iofPct: Number(e.target.value) || 0 }))
                    }
                  />
                </div>
                <div className={styles.checkboxField}>
                  <input
                    type="checkbox"
                    checked={paramsFundo.taxaNoLiquido}
                    onChange={(e) =>
                      setParamsFundo((p) => ({ ...p, taxaNoLiquido: e.target.checked }))
                    }
                  />
                  Deduzir a taxa de transferência do líquido
                </div>
              </>
            )}
          </div>

          <h2 className={styles.secaoTitulo}>
            Cesta — {administradoraAtual?.nome} ({cesta.length}{" "}
            {cesta.length === 1 ? "carta" : "cartas"})
          </h2>
          <div className={styles.statGrid}>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>Poder de compra</div>
              <div className={styles.statValor}>{brl(poderCompra)}</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>Entrada total</div>
              <div className={styles.statValor}>{brl(entradaTotal)}</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>Saldo devedor da cesta</div>
              <div className={styles.statValor}>{brl(saldo)}</div>
            </div>

            {objetivo === "aquisicao" ? (
              <>
                <div className={styles.statCard}>
                  <div className={styles.statLabel}>Entrada via Conta Notarial</div>
                  <div className={styles.statValor}>{brl(desembolsoInicial)}</div>
                </div>
                <div className={styles.statCard}>
                  <div className={styles.statLabel}>Custo financeiro (TIR a.m.)</div>
                  <div className={`${styles.statValor} ${styles.statValorDestaque}`}>
                    {tirParaTexto(tirAquisicao)}
                  </div>
                  {tirAquisicaoAnual != null && (
                    <div className={styles.statLabel}>
                      ≈ {(tirAquisicaoAnual * 100).toFixed(2).replace(".", ",")}% a.a. equivalente
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className={styles.statCard}>
                  <div className={styles.statLabel}>Custos do fundo (IOF + CCB + remuneração)</div>
                  <div className={styles.statValor}>{custos ? brl(custos.total) : "—"}</div>
                </div>
                <div className={styles.statCard}>
                  <div className={styles.statLabel}>Crédito líquido em conta (cliente)</div>
                  <div className={`${styles.statValor} ${styles.statValorDestaque}`}>
                    {liquido != null ? brl(liquido) : "—"}
                  </div>
                </div>
                <div className={styles.statCard}>
                  <div className={styles.statLabel}>Custo financeiro do cliente (TIR a.m.)</div>
                  <div className={`${styles.statValor} ${styles.statValorDestaque}`}>
                    {tirParaTexto(tirLevantamento)}
                  </div>
                  {tirLevantamentoAnual != null && (
                    <div className={styles.statLabel}>
                      ≈ {(tirLevantamentoAnual * 100).toFixed(2).replace(".", ",")}% a.a. equivalente
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          {(objetivo === "aquisicao" ? tirAquisicao : tirLevantamento) == null && (
            <p className={styles.avisoTir}>
              O custo financeiro não fecha numa taxa única neste cenário — ajuste a cesta, a
              entrada ou a taxa de transferência.
            </p>
          )}

          <h2 className={styles.secaoTitulo}>Escala de parcelas da cesta</h2>
          <div className={styles.escalaTableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Meses</th>
                  <th>Cotas ativas</th>
                  <th>Parcela no período</th>
                </tr>
              </thead>
              <tbody>
                {escala.map((f) => (
                  <tr key={`${f.de}-${f.ate}`}>
                    <td>
                      {f.de === f.ate ? `${f.de}` : `${f.de}–${f.ate}`}
                    </td>
                    <td className={styles.mono}>{f.ativas}</td>
                    <td className={styles.mono}>{brl(f.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.formGrid} data-print="hide">
            <div className={styles.field}>
              <label>WhatsApp do cliente (com DDD)</label>
              <input
                type="text"
                placeholder="11999999999"
                value={whatsCliente}
                onChange={(e) => setWhatsCliente(e.target.value)}
              />
            </div>
          </div>

          <div className={styles.actionsBar} data-print="hide">
            <Button
              variant="primary"
              href={linkWhatsApp(whatsCliente.replace(/\D/g, ""), textoWhatsApp())}
              target="_blank"
              rel="noreferrer"
            >
              Enviar por WhatsApp
            </Button>
            <Button variant="ghost" onClick={() => window.print()}>
              Imprimir / Salvar PDF
            </Button>
          </div>

          <p className={styles.footerCompliance}>
            Simulação de planejamento e compra programada de carta de crédito — não constitui
            promessa de contemplação nem data prevista para sorteio ou lance. Custo financeiro
            medido por TIR ao mês (nunca percentual nominal simples). Pagamento protegido por
            Conta Notarial: valores seguem para conta vinculada (escrow) no Banco Safra,
            atrelada exclusivamente a este negócio — patrimônio segregado, impenhorável por
            dívidas alheias à operação. O 5º Tabelionato de Notas de Campinas administra com fé
            pública, sem acesso ao valor: libera ao vendedor só após a administradora aprovar a
            transferência; se não aprovar, o valor retorna ao comprador (Lei 8.935/94 art. 7º-A,
            com redação da Lei 14.711/2024; Provimento CNJ 197/2025).
          </p>
        </section>
      )}
    </div>
  );
}
