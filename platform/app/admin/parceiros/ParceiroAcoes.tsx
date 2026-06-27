"use client";
// Ações de habilitação/suspensão da CONTA de um parceiro (client só para o
// clique). Nada a ver com crédito — apenas o status do cadastro do parceiro.
// Chama POST /api/admin/parceiros/[id]/status, que escreve via service_role
// depois de confirmar que o chamador é admin. Botões variam pelo status atual.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type { StatusPerfil } from "@/lib/auth";
import styles from "./acoes.module.css";

export function ParceiroAcoes({
  parceiroId,
  status,
}: {
  parceiroId: string;
  status: StatusPerfil;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState<StatusPerfil | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function definir(novo: StatusPerfil) {
    if (novo === status || enviando) return;
    setEnviando(novo);
    setErro(null);
    try {
      const res = await fetch(`/api/admin/parceiros/${parceiroId}/status`, {
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

  return (
    <div className={styles.wrap}>
      <div className={styles.botoes} role="group" aria-label="Ações do parceiro">
        {status !== "ativo" && (
          <Button
            size="sm"
            disabled={enviando !== null}
            onClick={() => definir("ativo")}
          >
            {enviando === "ativo" ? "Salvando…" : "Aprovar"}
          </Button>
        )}
        {status !== "suspenso" && (
          <Button
            size="sm"
            variant="ghost"
            disabled={enviando !== null}
            onClick={() => definir("suspenso")}
          >
            {enviando === "suspenso" ? "Salvando…" : "Suspender"}
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
