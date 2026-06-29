"use client";
// Wizard de reserva (client component). Cliente já verificado (gate na página).
// Passos:
//   1) Escolher carta — grade das cartas disponíveis (recebidas do server).
//   2) Revisar e confirmar — resumo dos valores (carta / recursos próprios).
//   -> POST /api/reservar { carta_id } -> RPC reservar_carta -> processo criado.
//   3) Sucesso — link para acompanhar em /meu-processo.
//
// Compliance: só valor da carta e recursos próprios (entrada). Nada de
// administradora/taxa/fundo; nenhuma promessa de contemplação.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LABEL_TIPO_BEM } from "@/lib/status";
import { brl } from "@/lib/format";
import styles from "./reservar.module.css";

export type CartaReserva = {
  id: string;
  tipo: string;
  valor_credito: number;
  valor_entrada: number | null;
  valor_parcela: number | null;
  qtd_parcelas: number | null;
};

type Passo = 1 | 2 | 3;

export function ReservarWizard({
  cartas,
  cartaInicial,
}: {
  cartas: CartaReserva[];
  cartaInicial: string | null;
}) {
  const router = useRouter();

  // Se veio ?carta=<id> e ela está na lista, já começa no passo 2.
  const inicial = cartaInicial
    ? cartas.find((c) => c.id === cartaInicial) ?? null
    : null;
  const [sel, setSel] = useState<CartaReserva | null>(inicial);
  const [passo, setPasso] = useState<Passo>(inicial ? 2 : 1);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function escolher(c: CartaReserva) {
    setSel(c);
    setErro(null);
    setPasso(2);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function voltar() {
    setErro(null);
    setPasso(1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function confirmar() {
    if (!sel || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const res = await fetch("/api/reservar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ carta_id: sel.id }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        erro?: string;
      };
      if (!res.ok || !json.ok) {
        setErro(json.erro ?? "Não foi possível reservar esta carta agora.");
        setEnviando(false);
        return;
      }
      setPasso(3);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setErro("Falha de conexão. Tente novamente.");
      setEnviando(false);
    }
  }

  // ----- stepper visual -----
  const steps = ["Escolher carta", "Revisar e confirmar", "Concluído"];
  const stepper = (
    <ol className={styles.steps} aria-label="Etapas da reserva">
      {steps.map((label, i) => {
        const n = (i + 1) as Passo;
        const estado = n === passo ? "on" : n < passo ? "done" : "";
        return (
          <li key={label} className={`${styles.st} ${estado ? styles[estado] : ""}`}>
            <span className={styles.stNum}>{n < passo ? "✓" : n}</span>
            <span className={styles.stLbl}>{label}</span>
          </li>
        );
      })}
    </ol>
  );

  return (
    <div className={styles.wrap}>
      {stepper}

      {/* PASSO 1 — escolher carta */}
      {passo === 1 && (
        <div className={styles.grid}>
          {cartas.map((c) => (
            <Card key={c.id}>
              <div className={styles.cardTop}>
                <Badge tone={c.tipo === "imovel" ? "info" : "amber"}>
                  {LABEL_TIPO_BEM[c.tipo] ?? c.tipo}
                </Badge>
                <span className={styles.disp}>Disponível</span>
              </div>
              <div className={styles.credito}>{brl(c.valor_credito)}</div>
              <div className={styles.creditoLbl}>crédito da carta</div>
              <dl className={styles.specs}>
                <div>
                  <dt>Entrada</dt>
                  <dd>{brl(c.valor_entrada)}</dd>
                </div>
                {c.valor_parcela != null && (
                  <div>
                    <dt>Parcela</dt>
                    <dd>{brl(c.valor_parcela)}</dd>
                  </div>
                )}
                {c.qtd_parcelas != null && (
                  <div>
                    <dt>Parcelas</dt>
                    <dd>{c.qtd_parcelas}x</dd>
                  </div>
                )}
              </dl>
              <Button block onClick={() => escolher(c)}>
                Reservar esta carta
              </Button>
            </Card>
          ))}
        </div>
      )}

      {/* PASSO 2 — revisar e confirmar */}
      {passo === 2 && sel && (
        <Card>
          <h2 className={styles.h2}>Revise e confirme a reserva</h2>
          <div className={styles.cardTop}>
            <Badge tone={sel.tipo === "imovel" ? "info" : "amber"}>
              {LABEL_TIPO_BEM[sel.tipo] ?? sel.tipo}
            </Badge>
          </div>

          <dl className={styles.resumo}>
            <div className={styles.row}>
              <dt>Tipo de bem</dt>
              <dd>{LABEL_TIPO_BEM[sel.tipo] ?? sel.tipo}</dd>
            </div>
            <div className={styles.row}>
              <dt>Crédito da carta</dt>
              <dd>{brl(sel.valor_credito)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Recursos próprios (entrada)</dt>
              <dd>{brl(sel.valor_entrada)}</dd>
            </div>
            {sel.valor_parcela != null && (
              <div className={styles.row}>
                <dt>Parcela</dt>
                <dd>{brl(sel.valor_parcela)}</dd>
              </div>
            )}
            {sel.qtd_parcelas != null && (
              <div className={styles.row}>
                <dt>Parcelas restantes</dt>
                <dd>{sel.qtd_parcelas}x</dd>
              </div>
            )}
          </dl>

          <p className={styles.aviso}>
            Ao confirmar, criamos sua reserva e o atendimento dá sequência. A
            transferência da cota é feita pela administradora do consórcio.
            Nenhuma contemplação é prometida: trata-se de uma cota já contemplada
            sendo transferida.
          </p>

          {erro && (
            <p className={styles.erro} role="alert">
              {erro}
            </p>
          )}

          <div className={styles.nav}>
            <Button variant="ghost" onClick={voltar} disabled={enviando}>
              ← Voltar
            </Button>
            <Button onClick={confirmar} disabled={enviando}>
              {enviando ? "Reservando…" : "Confirmar reserva ✓"}
            </Button>
          </div>
        </Card>
      )}

      {/* PASSO 3 — sucesso */}
      {passo === 3 && sel && (
        <Card>
          <div className={styles.okBig}>✓</div>
          <h2 className={styles.h2}>Reserva iniciada!</h2>
          <p className={styles.aviso}>
            Sua reserva da carta de {(LABEL_TIPO_BEM[sel.tipo] ?? sel.tipo).toLowerCase()} (
            {brl(sel.valor_credito)}) foi registrada. Acompanhe o andamento no seu
            processo.
          </p>
          <div className={styles.nav}>
            <Button onClick={() => router.push("/meu-processo")}>
              Acompanhar meu processo →
            </Button>
            <Button variant="ghost" onClick={() => router.push("/cartas")}>
              Ver outras cartas
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
