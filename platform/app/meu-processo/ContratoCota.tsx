"use client";
// Contrato de compra e venda da cota (contrato 2). Só habilita DEPOIS do sinal
// confirmado (`pago`) — o gate real está na RPC `gerar_contrato` (0014); aqui a
// UI só reflete o estado. Descreve o bem de forma factual (tipo/crédito/entrada).
//
// COMPLIANCE: não cita administradora/taxa/comissão; parágrafos já sanitizados
// no servidor. CPF vem MASCARADO. Sem promessa de contemplação/prazo/rendimento.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  LABEL_STATUS_CONTRATO,
  TONE_STATUS_CONTRATO,
  type StatusContrato,
} from "@/lib/status";
import styles from "./fluxo.module.css";
import type { CorpoContratoView } from "./ContratoServico";

export function ContratoCota({
  processoId,
  corpo,
  status,
  liberado,
}: {
  processoId: string;
  // corpo é null enquanto o contrato não pôde ser montado (sem sinal pago)
  corpo: CorpoContratoView | null;
  status: StatusContrato | null;
  // true quando o sinal está pago (habilita geração/assinatura)
  liberado: boolean;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const assinado = status === "assinado";

  async function acao(acao: "gerar" | "aceitar") {
    if (enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const res = await fetch("/api/processo/contrato", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ processo_id: processoId, tipo: "cota", acao }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { erro?: string };
        throw new Error(j.erro ?? "Não foi possível concluir a ação.");
      }
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro na ação do contrato.");
    } finally {
      setEnviando(false);
    }
  }

  if (!liberado) {
    return (
      <p className={styles.aviso}>
        O contrato de compra e venda da cota fica disponível após a confirmação
        do sinal. Assim que o pagamento for confirmado, esta etapa é liberada.
      </p>
    );
  }

  if (!corpo) {
    return (
      <div className={styles.contrato}>
        <p className={styles.aviso}>
          O sinal está confirmado. Gere o contrato de compra e venda da cota para
          revisar e assinar.
        </p>
        <Button size="sm" onClick={() => acao("gerar")} disabled={enviando}>
          {enviando ? "Gerando…" : "Gerar contrato da cota"}
        </Button>
        {erro && (
          <p className={styles.erro} role="alert">
            {erro}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={styles.contrato}>
      <div className={styles.passo}>
        <h3 className={styles.contratoTitulo}>{corpo.titulo}</h3>
        {status ? (
          <Badge tone={TONE_STATUS_CONTRATO[status]}>
            {LABEL_STATUS_CONTRATO[status]}
          </Badge>
        ) : null}
      </div>

      <div className={styles.contratoTexto}>
        {corpo.paragrafos.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>

      <p className={styles.aviso}>
        Os valores descritos são factuais desta operação e podem ser ajustados
        pela administradora na análise da transferência.
      </p>

      {!assinado && (
        <Button size="sm" onClick={() => acao("aceitar")} disabled={enviando}>
          {enviando ? "Registrando…" : "Li e aceito"}
        </Button>
      )}

      {erro && (
        <p className={styles.erro} role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}
