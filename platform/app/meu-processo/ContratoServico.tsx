"use client";
// Contrato de prestação de serviço (contrato 1). Exibe o corpo já sanitizado
// (montado no servidor por lib/contratos) e registra o aceite/assinatura.
//
// Ordem jurídica: SERVIÇO → PIX → COTA. Este é o primeiro passo do cliente.
// Sem ESIGN_PROVIDER, o aceite é registrado server-side (fallback manual);
// com provedor, o POST inicia a assinatura eletrônica.
//
// COMPLIANCE: o texto do contrato NÃO cita administradora/taxa/comissão e cada
// parágrafo já passou por `violaCompliance` no servidor. CPF vem MASCARADO.
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

export type CorpoContratoView = { titulo: string; paragrafos: string[] };

export function ContratoServico({
  processoId,
  corpo,
  status,
}: {
  processoId: string;
  corpo: CorpoContratoView;
  // null => ainda não gerado; caso contrário, o status atual do contrato.
  status: StatusContrato | null;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const assinado = status === "assinado";

  async function aceitar() {
    if (enviando || assinado) return;
    setEnviando(true);
    setErro(null);
    try {
      const res = await fetch("/api/processo/contrato", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ processo_id: processoId, tipo: "servico", acao: "aceitar" }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { erro?: string };
        throw new Error(j.erro ?? "Não foi possível registrar o aceite.");
      }
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao registrar aceite.");
    } finally {
      setEnviando(false);
    }
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
        Este é o contrato de intermediação, anterior ao contrato de compra e
        venda da cota. Nada aqui promete contemplação, prazo ou rendimento.
      </p>

      {!assinado && (
        <Button size="sm" onClick={aceitar} disabled={enviando}>
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
