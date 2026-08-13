"use client";
// ============================================================================
// PainelFundo — seleção das cartas, montador da oferta e o envio
// ----------------------------------------------------------------------------
// Client Component porque seleção múltipla e prévia de valor são estado de
// interação: cada clique muda um número na tela, e uma ida ao servidor por
// clique tornaria a conta lenta justamente onde ela precisa ser instantânea.
//
// A ARITMÉTICA AQUI É A MESMA DO SERVIDOR — literalmente o mesmo `montarLote`
// de `lib/fidc-ofertas.ts`, importado, não recopiado. É a única forma de o
// número da prévia e o número gravado não divergirem. Um montador de tela
// escrito "igualzinho" à mão diverge no primeiro ajuste de arredondamento, e o
// jeito de descobrir seria um fundo reclamando do valor que aprovou.
//
// E, ainda assim, ESTA CONTA NÃO VALE NADA. O servidor relê o crédito de cada
// carta da vitrine viva e refaz tudo (`app/api/fundo/ofertas/route.ts`). O que
// se calcula aqui é PRÉVIA, para a pessoa decidir; o que se grava é o que o
// servidor apurou. Se os dois discordarem — carta vendida entre a tela e o
// clique —, quem manda é o servidor, e a resposta diz nominalmente quais
// ficaram de fora.
// ============================================================================
import { useMemo, useState } from "react";
import {
  OFERTA_PISO_PCT,
  OFERTA_TETO_PCT,
  PALAVRA_OFERTAR,
  JANELA_OFERTA_HORAS,
  montarLote,
} from "@/lib/fidc-ofertas";
import type { CartaVitrine } from "@/lib/fidc-vitrine";
// `dataHoraAnoBR`, e não `toLocaleString` com o fuso escrito na mão. O módulo é
// puro e atravessa a fronteira cliente/servidor, e o cabeçalho dele diz por que
// existe: repetir o `timeZone` literal em cada tela é o defeito que reaparece na
// tela seguinte. Aqui pesa mais do que no servidor — esta linha roda no relógio
// do NAVEGADOR do operador, que pode estar em qualquer fuso; sem o formatador
// fixo, um fundo com a máquina em Lisboa leria o fim da janela quatro horas
// adiante do instante que o servidor gravou.
import { dataHoraAnoBR } from "@/lib/data-br";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import areaStyles from "@/components/area.module.css";
import styles from "./fundo.module.css";

function brl(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function pctBR(v: number | null): string {
  if (v == null) return "—";
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

type Resposta = {
  ok?: true;
  ofertaId?: string;
  cartas?: number;
  total?: number;
  expiraEm?: string;
  indisponiveis?: string[];
  descartadas?: { cartaId: string; motivo: string }[];
  erro?: string;
};

export function PainelFundo({
  cartas,
  jaOfertadas,
  filtro,
  somaVisivelTexto,
}: {
  cartas: CartaVitrine[];
  jaOfertadas: string[];
  /**
   * Os parâmetros de filtro CRUS, como vieram na URL. Viajam de volta ao
   * servidor no corpo do POST para virar `filtro_lote` — o registro de "o que
   * ele estava vendo quando ofertou". Cruz de propósito: quem normaliza é o
   * servidor, com o mesmo código que montou esta lista.
   */
  filtro: Record<string, string | string[] | undefined>;
  somaVisivelTexto: string;
}) {
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  // Texto, e não número, de propósito: um `useState<number>` obrigaria a
  // escolher um valor para o campo vazio, e o candidato natural (0) é um
  // percentual que não existe. Enquanto a pessoa apaga para redigitar, o estado
  // é "" — e "" não finge ser uma oferta de 0%.
  const [pctTexto, setPctTexto] = useState<string>(String(OFERTA_PISO_PCT));
  const [confirmacao, setConfirmacao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resposta, setResposta] = useState<Resposta | null>(null);

  const jaSet = useMemo(() => new Set(jaOfertadas), [jaOfertadas]);

  const pct = Number(pctTexto.replace(",", "."));

  // A prévia. Roda sobre as SELECIONADAS, com o mesmo código do servidor.
  const previa = useMemo(() => {
    const escolhidas = cartas.filter((c) => selecionadas.has(c.id));
    return montarLote(
      escolhidas.map((c) => ({ id: c.id, valorCredito: c.credito })),
      pct
    );
  }, [cartas, selecionadas, pct]);

  const valorPorId = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of previa.itens) m.set(i.cartaId, i.valorOfertado);
    return m;
  }, [previa]);

  function alternar(id: string) {
    setSelecionadas((antes) => {
      const nova = new Set(antes);
      if (nova.has(id)) nova.delete(id);
      else nova.add(id);
      return nova;
    });
    setResposta(null);
  }

  function selecionarTudo() {
    setSelecionadas(new Set(cartas.map((c) => c.id)));
    setResposta(null);
  }

  function limparSelecao() {
    setSelecionadas(new Set());
    setResposta(null);
  }

  const podeEnviar =
    selecionadas.size > 0 &&
    previa.recusa === null &&
    previa.itens.length > 0 &&
    confirmacao === PALAVRA_OFERTAR &&
    !enviando;

  async function enviar() {
    setEnviando(true);
    setResposta(null);
    try {
      const r = await fetch("/api/fundo/ofertas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cartaIds: [...selecionadas],
          pct,
          confirmacao,
          filtro,
        }),
      });
      const corpo = (await r.json().catch(() => ({}))) as Resposta;
      setResposta(corpo);
      if (r.ok && corpo.ok) {
        // Some com a seleção só no sucesso. Em erro, a seleção fica de pé —
        // refazer 200 cliques por causa de um percentual digitado errado seria
        // punir a pessoa pelo defeito da tela.
        setSelecionadas(new Set());
        setConfirmacao("");
      }
    } catch {
      setResposta({ erro: "falha de rede — a oferta não foi enviada." });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <section className={areaStyles.section}>
        <Card>
          <div className={styles.montador}>
            <div className={styles.montadorLinha}>
              <label className={styles.campo}>
                <span>
                  Percentual do crédito ({OFERTA_PISO_PCT}% a {OFERTA_TETO_PCT}%)
                </span>
                <input
                  type="number"
                  min={OFERTA_PISO_PCT}
                  max={OFERTA_TETO_PCT}
                  step="0.5"
                  value={pctTexto}
                  onChange={(e) => {
                    setPctTexto(e.target.value);
                    setResposta(null);
                  }}
                />
              </label>

              <div className={styles.acoesSelecao}>
                <button type="button" onClick={selecionarTudo}>
                  Selecionar as {cartas.length} da tela
                </button>
                <button type="button" onClick={limparSelecao}>
                  Limpar seleção
                </button>
              </div>
            </div>

            {/* O RESUMO. Três números e nada mais: quantas, quanto de crédito,
                quanto o fundo paga. Nenhum deles é "desconto" ou "deságio" — a
                conta é quanto se PAGA do crédito, e a frase acompanha a conta. */}
            <div className={styles.resumo}>
              <div>
                <span className={styles.resumoRotulo}>Cartas selecionadas</span>
                <strong>{previa.itens.length}</strong>
              </div>
              <div>
                <span className={styles.resumoRotulo}>Crédito somado</span>
                <strong>
                  {brl(
                    previa.itens.reduce((s, i) => s + i.valorCredito, 0)
                  )}
                </strong>
              </div>
              <div>
                <span className={styles.resumoRotulo}>
                  O fundo paga ({pctBR(Number.isFinite(pct) ? pct : null)} do crédito)
                </span>
                <strong className={styles.resumoTotal}>{brl(previa.total)}</strong>
              </div>
            </div>

            {previa.recusa && (
              <p className={styles.erro} role="alert">
                {previa.recusa}
              </p>
            )}

            {previa.descartadas.length > 0 && (
              <p className={styles.aviso}>
                {previa.descartadas.length}{" "}
                {previa.descartadas.length === 1
                  ? "carta ficou de fora"
                  : "cartas ficaram de fora"}{" "}
                por não ter valor de crédito utilizável.
              </p>
            )}

            <p className={styles.aviso}>
              A oferta vale por {JANELA_OFERTA_HORAS} horas a partir do envio.
              Enquanto estiver de pé, ela pode ser aceita carta a carta — o aceite
              é de quem vende, e nada é aceito automaticamente em nome de ninguém.
            </p>

            {/* A CONFIRMAÇÃO NOMINAL. Ela não autentica ninguém — quem autentica
                é a guarda do servidor. Ela impede o clique por reflexo, e existe
                porque um "selecionar tudo" no piso alcança oito dígitos. */}
            <div className={styles.envio}>
              <label className={styles.campo}>
                <span>
                  Para enviar, digite <code>{PALAVRA_OFERTAR}</code>
                </span>
                <input
                  type="text"
                  value={confirmacao}
                  onChange={(e) => setConfirmacao(e.target.value)}
                  placeholder={PALAVRA_OFERTAR}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <button
                type="button"
                className={styles.btnOfertar}
                disabled={!podeEnviar}
                onClick={enviar}
              >
                {enviando
                  ? "Enviando…"
                  : `Ofertar ${brl(previa.total)} em ${previa.itens.length} ${
                      previa.itens.length === 1 ? "carta" : "cartas"
                    }`}
              </button>
            </div>

            {resposta?.erro && (
              <p className={styles.erro} role="alert">
                {resposta.erro}
              </p>
            )}

            {resposta?.ok && (
              <div className={styles.sucesso} role="status">
                <p>
                  Oferta registrada: <strong>{resposta.cartas}</strong>{" "}
                  {resposta.cartas === 1 ? "carta" : "cartas"} ·{" "}
                  <strong>{brl(resposta.total ?? 0)}</strong>. Vale até{" "}
                  {dataHoraAnoBR(resposta.expiraEm)}.
                </p>
                {resposta.indisponiveis && resposta.indisponiveis.length > 0 && (
                  <p className={styles.aviso}>
                    {resposta.indisponiveis.length}{" "}
                    {resposta.indisponiveis.length === 1
                      ? "carta saiu"
                      : "cartas saíram"}{" "}
                    da vitrine entre a tela e o envio e não entraram na oferta.
                  </p>
                )}
                <p>
                  <a href="/fundo/ofertas">Ver minhas ofertas →</a>
                </p>
              </div>
            )}
          </div>
        </Card>
      </section>

      <section className={areaStyles.section}>
        <p className={styles.notaTela}>
          Somando o crédito das {cartas.length} cartas desta tela:{" "}
          <strong>{somaVisivelTexto}</strong>.
        </p>

        <ul className={styles.lista}>
          {cartas.map((c) => {
            const marcada = selecionadas.has(c.id);
            const valor = valorPorId.get(c.id) ?? null;
            return (
              <li
                key={c.id}
                className={`${styles.item} ${marcada ? styles.itemMarcado : ""}`}
              >
                <label className={styles.itemLabel}>
                  <input
                    type="checkbox"
                    checked={marcada}
                    onChange={() => alternar(c.id)}
                  />
                  <span className={styles.itemCorpo}>
                    <span className={styles.itemTopo}>
                      <strong>{brl(c.credito)}</strong>
                      <Badge tone={c.tipo === "imovel" ? "info" : "muted"}>
                        {c.tipo === "imovel" ? "Imóvel" : "Veículo"}
                      </Badge>
                      {jaSet.has(c.id) && (
                        <Badge tone="amber">já ofertada</Badge>
                      )}
                    </span>
                    <span className={styles.itemDados}>
                      {c.administradora ?? "administradora não informada"} ·{" "}
                      {c.parcelas ?? "—"}x de {brl(c.parcela)} · entrada{" "}
                      {brl(c.entrada)} · custo{" "}
                      {c.custo_am == null
                        ? "não apurado"
                        : `${c.custo_am.toLocaleString("pt-BR", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}% a.m.`}
                    </span>
                  </span>
                  <span className={styles.itemValor}>
                    {marcada && valor !== null ? brl(valor) : ""}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
