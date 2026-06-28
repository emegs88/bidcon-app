"use client";
// Decisão de KYC de um cliente (client só para o clique). Verificar / Rejeitar /
// Bloquear. Rejeitar e Bloquear exigem um motivo. Chama POST
// /api/admin/kyc/[id]/decidir, que valida o papel admin e executa a RPC
// kyc_decidir via service_role. Botões variam pelo status atual.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { type StatusKYC } from "@/lib/status";
import styles from "./acoes.module.css";

// Só estes três são decisões do admin (os demais são estados de fluxo).
type Decisao = "verificado" | "rejeitado" | "bloqueado";

export function KycAcoes({
  userId,
  status,
}: {
  userId: string;
  status: StatusKYC;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState<Decisao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  async function decidir(novo: Decisao) {
    if (novo === status || enviando) return;
    // Rejeitar/Bloquear precisam de motivo registrado.
    if ((novo === "rejeitado" || novo === "bloqueado") && !motivo.trim()) {
      setErro("Informe o motivo para rejeitar ou bloquear.");
      return;
    }
    setEnviando(novo);
    setErro(null);
    try {
      const res = await fetch(`/api/admin/kyc/${userId}/decidir`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: novo, motivo: motivo.trim() || null }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { erro?: string };
        throw new Error(j.erro ?? "Falha ao registrar a decisão.");
      }
      setMotivo("");
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao registrar a decisão.");
    } finally {
      setEnviando(null);
    }
  }

  return (
    <div className={styles.wrap}>
      <label className={styles.campo}>
        <span className={styles.rotulo}>Motivo (obrigatório ao rejeitar ou bloquear)</span>
        <textarea
          className={styles.textarea}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={2}
          placeholder="Ex.: documento ilegível, selfie não confere, dados divergentes."
        />
      </label>

      <div className={styles.botoes} role="group" aria-label="Decisão de KYC">
        {status !== "verificado" && (
          <Button
            size="sm"
            disabled={enviando !== null}
            onClick={() => decidir("verificado")}
          >
            {enviando === "verificado" ? "Salvando…" : "Verificar"}
          </Button>
        )}
        {status !== "rejeitado" && (
          <Button
            size="sm"
            variant="ghost"
            disabled={enviando !== null}
            onClick={() => decidir("rejeitado")}
          >
            {enviando === "rejeitado" ? "Salvando…" : "Rejeitar"}
          </Button>
        )}
        {status !== "bloqueado" && (
          <Button
            size="sm"
            variant="ghost"
            disabled={enviando !== null}
            onClick={() => decidir("bloqueado")}
          >
            {enviando === "bloqueado" ? "Salvando…" : "Bloquear"}
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
