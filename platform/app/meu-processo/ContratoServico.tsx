"use client";
// Contrato de prestação de serviço (contrato 1). Exibe o corpo já sanitizado
// (montado no servidor por lib/contratos) e registra o aceite/assinatura.
//
// Ordem jurídica: SERVIÇO → Termo de Reserva → documentação → COTA. Este é o
// primeiro passo do cliente.
// Sem ESIGN_PROVIDER, o aceite é registrado server-side (fallback manual);
// com provedor, o POST inicia a assinatura eletrônica.
//
// COMPLIANCE: o texto do contrato NÃO cita administradora/taxa/comissão e cada
// parágrafo já passou por `violaCompliance` no servidor. CPF vem por extenso
// (sem máscara) — o cliente só vê o próprio CPF nesta tela (ver lib/format.ts:
// formatarCpf), qualificação civil completa exigida para validade jurídica.
//
// QUALIFICAÇÃO COMPLETA (v4/FINAL): enquanto nome/CPF do profile não
// estiverem preenchidos e válidos, o botão "Li e aceito" é substituído pelo
// <QualificacaoGate>. O gate real (que não confia no client) é server-side em
// /api/processo/contrato.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  LABEL_STATUS_CONTRATO,
  TONE_STATUS_CONTRATO,
  type StatusContrato,
} from "@/lib/status";
import { QualificacaoGate } from "./QualificacaoGate";
import styles from "./fluxo.module.css";

export type CorpoContratoView = { titulo: string; paragrafos: string[] };

export function ContratoServico({
  processoId,
  corpo,
  status,
  precisaQualificacao,
  nomeAtual,
  cpfAtual,
}: {
  processoId: string;
  corpo: CorpoContratoView;
  // null => ainda não gerado; caso contrário, o status atual do contrato.
  status: StatusContrato | null;
  // true => nome/CPF do profile ainda não estão completos/válidos.
  precisaQualificacao: boolean;
  nomeAtual: string;
  cpfAtual: string;
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

      {!assinado && precisaQualificacao && (
        <QualificacaoGate nomeAtual={nomeAtual} cpfAtual={cpfAtual} />
      )}

      {!assinado && !precisaQualificacao && (
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
