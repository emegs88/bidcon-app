"use client";
// Ação de status da carta do parceiro. Client component só para o clique:
// chama o Route Handler POST /api/parceiro/cartas/[id]/status, que por sua vez
// executa a RPC definir_status_carta (a mudança real é atômica no servidor).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import {
  LABEL_STATUS_CARTA,
  type StatusCarta,
} from "@/lib/status";
import styles from "./status.module.css";

// Estados que o parceiro pode definir manualmente. "vendida" fica a cargo do
// fluxo de processo/admin — não é uma troca solta do parceiro aqui.
const OPCOES: StatusCarta[] = ["disponivel", "reservada", "indisponivel"];

export function CartaStatusForm({
  cartaId,
  atual,
}: {
  cartaId: string;
  atual: StatusCarta;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState<StatusCarta | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function definir(novo: StatusCarta) {
    if (novo === atual || enviando) return;
    setEnviando(novo);
    setErro(null);
    try {
      const res = await fetch(`/api/parceiro/cartas/${cartaId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: novo }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { erro?: string };
        throw new Error(j.erro ?? "Não foi possível atualizar o status.");
      }
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao atualizar.");
    } finally {
      setEnviando(null);
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.botoes} role="group" aria-label="Alterar status da carta">
        {OPCOES.map((s) => (
          <Button
            key={s}
            variant={s === atual ? "primary" : "ghost"}
            size="sm"
            disabled={s === atual || enviando !== null}
            onClick={() => definir(s)}
          >
            {enviando === s ? "Salvando…" : LABEL_STATUS_CARTA[s]}
          </Button>
        ))}
      </div>
      {erro && (
        <p className={styles.erro} role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}
