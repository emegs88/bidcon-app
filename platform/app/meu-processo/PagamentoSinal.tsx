"use client";
// Pagamento do sinal (etapa 4 Lance) — 2% do crédito, reserva a cota. Mostra o
// valor e, quando PIX_PROVIDER estiver ligado, o QR/copia-e-cola; sem provedor,
// instrui e permite anexar comprovante (o admin confere manualmente — fallback).
//
// COMPLIANCE: aviso factual, sem promessa. LGPD: comprovante é dado sensível
// (bucket privado); nenhum dado bancário do cliente é coletado aqui.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  LABEL_STATUS_PAGAMENTO,
  TONE_STATUS_PAGAMENTO,
  type StatusPagamento,
} from "@/lib/status";
import { brl } from "@/lib/status";
import styles from "./fluxo.module.css";

export function PagamentoSinal({
  processoId,
  valorSinal,
  residualEntrada,
  status,
  qrPayload,
}: {
  processoId: string;
  valorSinal: number | null;
  residualEntrada: number | null;
  // null => ainda sem cobrança registrada
  status: StatusPagamento | null;
  // presente só quando o provedor de PIX estiver configurado
  qrPayload: string | null;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const pago = status === "pago";

  async function anexarComprovante(file: File | null) {
    if (!file || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const fd = new FormData();
      fd.append("processo_id", processoId);
      fd.append("comprovante", file);
      const res = await fetch("/api/processo/sinal", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { erro?: string };
        throw new Error(j.erro ?? "Falha ao anexar o comprovante.");
      }
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao anexar.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div>
      <div className={styles.valores}>
        <div className={styles.valorLinha}>
          <span className={styles.valorLbl}>Sinal da reserva (2% do crédito)</span>
          <span className={styles.valorNum}>
            {valorSinal != null ? brl(valorSinal) : "a definir"}
          </span>
        </div>
        <div className={styles.valorLinha}>
          <span className={styles.valorLbl}>Entrada residual (após o sinal)</span>
          <span className={styles.valorNum}>
            {residualEntrada != null ? brl(residualEntrada) : "a definir"}
          </span>
        </div>
        {status ? (
          <div className={styles.valorLinha}>
            <span className={styles.valorLbl}>Situação</span>
            <Badge tone={TONE_STATUS_PAGAMENTO[status]}>
              {LABEL_STATUS_PAGAMENTO[status]}
            </Badge>
          </div>
        ) : null}
      </div>

      {qrPayload ? (
        <div className={styles.pixBox}>
          <span className={styles.valorLbl}>PIX copia-e-cola</span>
          <code className={styles.pixCode}>{qrPayload}</code>
        </div>
      ) : (
        <p className={styles.aviso}>
          O pagamento é feito por PIX. Após pagar, anexe o comprovante abaixo — a
          equipe confere e confirma a reserva. O valor do sinal é abatido da
          entrada da cota.
        </p>
      )}

      {!pago && (
        <label className={styles.fileInput}>
          <span className={styles.valorLbl}>Anexar comprovante</span>
          <input
            type="file"
            accept="image/*,application/pdf"
            disabled={enviando}
            onChange={(e) => anexarComprovante(e.target.files?.[0] ?? null)}
          />
        </label>
      )}

      {erro && (
        <p className={styles.erro} role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}
