"use client";
// Ações de status do processo (client só para o clique). Mostra apenas as
// transições válidas: o PRÓXIMO passo da régua (se houver) e "Cancelar".
// A validação real é refeita na RPC avancar_status_processo (servidor).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ORDEM_STATUS, LABEL_STATUS, type StatusProcesso } from "@/lib/status";
import styles from "./acoes.module.css";

export function ProcessoAcoes({
  processoId,
  atual,
}: {
  processoId: string;
  atual: StatusProcesso;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState<StatusProcesso | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const terminal = atual === "concluido" || atual === "cancelado";
  const idx = ORDEM_STATUS.indexOf(atual);
  const proximo =
    idx >= 0 && idx < ORDEM_STATUS.length - 1 ? ORDEM_STATUS[idx + 1] : null;

  async function avancar(novo: StatusProcesso) {
    if (enviando) return;
    setEnviando(novo);
    setErro(null);
    try {
      const res = await fetch(`/api/admin/processos/${processoId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: novo }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { erro?: string };
        throw new Error(j.erro ?? "Falha ao atualizar.");
      }
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao atualizar.");
    } finally {
      setEnviando(null);
    }
  }

  if (terminal) {
    return (
      <p className={styles.terminal}>
        Este processo está em estado final e não pode mais ser alterado.
      </p>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.botoes} role="group" aria-label="Avançar status">
        {proximo && (
          <Button
            size="sm"
            disabled={enviando !== null}
            onClick={() => avancar(proximo)}
          >
            {enviando === proximo ? "Salvando…" : `Avançar para ${LABEL_STATUS[proximo]}`}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={enviando !== null}
          onClick={() => avancar("cancelado")}
        >
          {enviando === "cancelado" ? "Salvando…" : "Cancelar processo"}
        </Button>
      </div>
      {erro && (
        <p className={styles.erro} role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}
