"use client";
// Ações de comissão (admin): liberar (prevista→liberada) e marcar paga
// (liberada→paga). Mostra só a ação válida para o status atual. A escrita real
// é atômica nas RPCs liberar_comissao / marcar_comissao_paga (0006).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type { StatusComissao } from "@/lib/status";
import styles from "./acoes.module.css";

type Acao = "liberar" | "pagar";

export function ComissaoAcoes({
  comissaoId,
  status,
}: {
  comissaoId: string;
  status: StatusComissao;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState<Acao | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function executar(acao: Acao) {
    if (enviando) return;
    setEnviando(acao);
    setErro(null);
    try {
      const res = await fetch(`/api/admin/comissoes/${comissaoId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ acao }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { erro?: string };
        throw new Error(j.erro ?? "Não foi possível atualizar a comissão.");
      }
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao atualizar.");
    } finally {
      setEnviando(null);
    }
  }

  // Nada a fazer para estados finais.
  if (status === "paga" || status === "cancelada") return null;

  return (
    <div className={styles.wrap}>
      <div className={styles.botoes} role="group" aria-label="Ações da comissão">
        {status === "prevista" && (
          <Button
            size="sm"
            disabled={enviando !== null}
            onClick={() => executar("liberar")}
          >
            {enviando === "liberar" ? "Salvando…" : "Liberar"}
          </Button>
        )}
        {status === "liberada" && (
          <Button
            size="sm"
            disabled={enviando !== null}
            onClick={() => executar("pagar")}
          >
            {enviando === "pagar" ? "Salvando…" : "Marcar como paga"}
          </Button>
        )}
      </div>
      {erro && (
        <p className={styles.erro} role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}
