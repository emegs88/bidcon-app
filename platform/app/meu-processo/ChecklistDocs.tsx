"use client";
// Check-list de documentos do processo (cliente). Lista SÓ os rótulos dos itens
// do modelo da administradora da carta — o cliente NUNCA vê o nome da
// administradora aqui (isso é resolvido no servidor). Upload direto ao bucket
// privado `processo-docs` (prefixo {processo_id}/...) + POST que grava metadados.
//
// COMPLIANCE/LGPD: nada de promessa; documentos são dado sensível (bucket
// privado, leitura só por signed URL server-side). A validação de MIME/tamanho
// é refeita no servidor (esta checagem no client é só UX).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  LABEL_STATUS_DOCUMENTO,
  TONE_STATUS_DOCUMENTO,
  type StatusDocumento,
} from "@/lib/status";
import styles from "./fluxo.module.css";

export type ItemChecklist = {
  id: string;
  rotulo: string;
  obrigatorio: boolean;
  // status do envio já feito para este item (se houver)
  docStatus: StatusDocumento | null;
  motivo: string | null;
};

export function ChecklistDocs({
  processoId,
  itens,
}: {
  processoId: string;
  itens: ItemChecklist[];
}) {
  const router = useRouter();
  const [enviandoId, setEnviandoId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(itemId: string, file: File | null) {
    if (!file || enviandoId) return;
    setEnviandoId(itemId);
    setErro(null);
    try {
      const fd = new FormData();
      fd.append("processo_id", processoId);
      fd.append("checklist_item_id", itemId);
      fd.append("arquivo", file);
      const res = await fetch("/api/processo/documento", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { erro?: string };
        throw new Error(j.erro ?? "Falha ao enviar o documento.");
      }
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao enviar.");
    } finally {
      setEnviandoId(null);
    }
  }

  if (itens.length === 0) {
    return (
      <p className={styles.aviso}>
        O check-list desta carta ainda não está disponível. O atendimento entra
        em contato para orientar o envio dos documentos.
      </p>
    );
  }

  return (
    <div>
      <ul className={styles.docs}>
        {itens.map((it) => (
          <li key={it.id} className={styles.doc}>
            <span className={styles.docNome}>
              {it.rotulo}
              {it.obrigatorio && <span className={styles.docObrig}>*</span>}
            </span>
            <span className={styles.docAcao}>
              {it.docStatus ? (
                <Badge tone={TONE_STATUS_DOCUMENTO[it.docStatus]}>
                  {LABEL_STATUS_DOCUMENTO[it.docStatus]}
                </Badge>
              ) : null}
              {it.docStatus !== "aprovado" && (
                <label className={styles.fileInput}>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    disabled={enviandoId !== null}
                    onChange={(e) =>
                      enviar(it.id, e.target.files?.[0] ?? null)
                    }
                  />
                </label>
              )}
            </span>
          </li>
        ))}
      </ul>
      {itens.some((it) => it.docStatus === "reprovado") && (
        <p className={styles.aviso}>
          Itens marcados como “Reenviar” precisam de um novo arquivo. Confira o
          motivo com o atendimento e envie novamente.
        </p>
      )}
      {erro && (
        <p className={styles.erro} role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}
