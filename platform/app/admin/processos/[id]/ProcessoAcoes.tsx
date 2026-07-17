"use client";
// Ações do processo (admin). O clique é client; a regra e o papel são revalidados
// nas RPCs security-definer do servidor (0014). Aqui só orquestramos os POSTs:
//   - avançar status de topo / cancelar   → /api/admin/processos/[id]/status
//   - aprovar/reprovar documento           → /api/admin/processo/[id]/documento
//   - confirmar sinal (fallback manual)    → /api/admin/processo/[id]/sinal
//   - gerar contrato (serviço/cota)        → /api/admin/processo/[id]/contrato
//   - avançar sub-etapa (fluxo Lance)      → /api/admin/processo/[id]/subetapa
//   - gerar magic link de acesso           → /api/admin/processos/[id]/gerar-acesso
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import {
  ORDEM_STATUS,
  LABEL_STATUS,
  ORDEM_SUBETAPA,
  LABEL_SUBETAPA,
  type StatusProcesso,
  type SubetapaProcesso,
  type StatusDocumento,
} from "@/lib/status";
import { linkWhatsApp } from "@/lib/format";
import styles from "./acoes.module.css";

type DocResumo = {
  docId: string | null;
  rotulo: string;
  status: StatusDocumento | null;
};

export function ProcessoAcoes({
  processoId,
  atual,
  subetapa,
  documentos,
  sinalId,
  sinalPago,
  temContratoServico,
  temContratoCota,
  clienteTelefone,
}: {
  processoId: string;
  atual: StatusProcesso;
  subetapa: SubetapaProcesso | null;
  documentos: DocResumo[];
  sinalId: string | null;
  sinalPago: boolean;
  temContratoServico: boolean;
  temContratoCota: boolean;
  clienteTelefone?: string | null;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const terminal = atual === "concluido" || atual === "cancelado";
  const idx = ORDEM_STATUS.indexOf(atual);
  const proximo =
    idx >= 0 && idx < ORDEM_STATUS.length - 1 ? ORDEM_STATUS[idx + 1] : null;

  // próxima sub-etapa da régua Lance (só sugestão de avanço; a RPC valida ordem).
  const idxSub = subetapa ? ORDEM_SUBETAPA.indexOf(subetapa) : -1;
  const proximaSub =
    idxSub < ORDEM_SUBETAPA.length - 1
      ? ORDEM_SUBETAPA[idxSub + 1]
      : null;

  // POST genérico: `chave` identifica o botão em processamento; recarrega ao ok.
  async function acao(
    chave: string,
    url: string,
    body: Record<string, unknown>,
  ) {
    if (enviando) return;
    setEnviando(chave);
    setErro(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
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

  // Gera o magic link — handler à parte de `acao()` porque precisa capturar
  // o link retornado (não só refresh). Fica disponível mesmo com o processo
  // em estado final: reenviar acesso ao cliente não deve depender do status.
  async function gerarAcesso() {
    if (enviando) return;
    setEnviando("acesso");
    setErro(null);
    setLink(null);
    setCopiado(false);
    try {
      const res = await fetch(
        `/api/admin/processos/${processoId}/gerar-acesso`,
        { method: "POST" },
      );
      const j = (await res.json().catch(() => ({}))) as {
        link?: string;
        erro?: string;
      };
      if (!res.ok || !j.link) {
        throw new Error(j.erro ?? "Falha ao gerar link.");
      }
      setLink(j.link);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao gerar link.");
    } finally {
      setEnviando(null);
    }
  }

  async function copiarLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // clipboard indisponível (ex.: contexto não seguro) — o campo readOnly
      // abaixo já permite selecionar e copiar manualmente.
    }
  }

  const ocupado = enviando !== null;

  const acesso = (
    <div className={styles.grupo}>
      <span className={styles.grupoLbl}>Acesso do cliente</span>
      <div className={styles.botoes} role="group" aria-label="Gerar acesso do cliente">
        <Button size="sm" variant="ghost" disabled={ocupado} onClick={gerarAcesso}>
          {enviando === "acesso" ? "Gerando…" : "Gerar link de acesso"}
        </Button>
      </div>
      {link && (
        <div className={styles.linkBox}>
          <input
            className={styles.linkInput}
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className={styles.botoes}>
            <Button size="sm" variant="ghost" onClick={copiarLink}>
              {copiado ? "Copiado!" : "Copiar link"}
            </Button>
            {clienteTelefone && (
              <Button
                size="sm"
                variant="ghost"
                href={linkWhatsApp(
                  clienteTelefone.replace(/\D/g, ""),
                  `Olá! Aqui está seu link de acesso ao portal Bidcon: ${link}`,
                )}
              >
                Enviar por WhatsApp
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  if (terminal) {
    return (
      <div className={styles.wrap}>
        {acesso}
        <p className={styles.terminal}>
          Este processo está em estado final e não pode mais ser alterado.
        </p>
        {erro && (
          <p className={styles.erro} role="alert">
            {erro}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      {acesso}

      {/* 1) Status de topo (régua dos 5 estados) */}
      <div className={styles.botoes} role="group" aria-label="Avançar status">
        {proximo && (
          <Button
            size="sm"
            disabled={ocupado}
            onClick={() =>
              acao("status", `/api/admin/processos/${processoId}/status`, {
                status: proximo,
              })
            }
          >
            {enviando === "status"
              ? "Salvando…"
              : `Avançar para ${LABEL_STATUS[proximo]}`}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={ocupado}
          onClick={() =>
            acao("cancelar", `/api/admin/processos/${processoId}/status`, {
              status: "cancelado",
            })
          }
        >
          {enviando === "cancelar" ? "Salvando…" : "Cancelar processo"}
        </Button>
      </div>

      {/* 2) Sub-etapa do fluxo Lance (próximo passo interno) */}
      {proximaSub && (
        <div className={styles.botoes} role="group" aria-label="Avançar sub-etapa">
          <Button
            size="sm"
            variant="ghost"
            disabled={ocupado}
            onClick={() =>
              acao("subetapa", `/api/admin/processo/${processoId}/subetapa`, {
                subetapa: proximaSub,
              })
            }
          >
            {enviando === "subetapa"
              ? "Salvando…"
              : `Sub-etapa → ${LABEL_SUBETAPA[proximaSub]}`}
          </Button>
        </div>
      )}

      {/* 3) Documentos do check-list: aprovar/reprovar cada envio */}
      {documentos.some((d) => d.docId) && (
        <div className={styles.grupo}>
          <span className={styles.grupoLbl}>Documentos</span>
          {documentos
            .filter((d) => d.docId)
            .map((d) => (
              <div key={d.docId} className={styles.linha}>
                <span className={styles.linhaLbl}>{d.rotulo}</span>
                <div className={styles.botoes}>
                  <Button
                    size="sm"
                    disabled={ocupado || d.status === "aprovado"}
                    onClick={() =>
                      acao(
                        `doc-a-${d.docId}`,
                        `/api/admin/processo/${processoId}/documento`,
                        { documento_id: d.docId, status: "aprovado" },
                      )
                    }
                  >
                    {enviando === `doc-a-${d.docId}` ? "…" : "Aprovar"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={ocupado || d.status === "reprovado"}
                    onClick={() =>
                      acao(
                        `doc-r-${d.docId}`,
                        `/api/admin/processo/${processoId}/documento`,
                        { documento_id: d.docId, status: "reprovado" },
                      )
                    }
                  >
                    {enviando === `doc-r-${d.docId}` ? "…" : "Reenviar"}
                  </Button>
                </div>
              </div>
            ))}
        </div>
      )}

      {/* 4) Sinal: confirmação manual (fallback sem gateway) */}
      {sinalId && !sinalPago && (
        <div className={styles.botoes} role="group" aria-label="Confirmar sinal">
          <Button
            size="sm"
            disabled={ocupado}
            onClick={() =>
              acao("sinal", `/api/admin/processo/${processoId}/sinal`, {
                pagamento_id: sinalId,
              })
            }
          >
            {enviando === "sinal" ? "Confirmando…" : "Confirmar sinal (manual)"}
          </Button>
        </div>
      )}

      {/* 5) Contratos: gerar serviço e (após sinal) a cota */}
      <div className={styles.botoes} role="group" aria-label="Gerar contratos">
        {!temContratoServico && (
          <Button
            size="sm"
            variant="ghost"
            disabled={ocupado}
            onClick={() =>
              acao("ct-servico", `/api/admin/processo/${processoId}/contrato`, {
                tipo: "servico",
              })
            }
          >
            {enviando === "ct-servico" ? "Gerando…" : "Gerar contrato de serviço"}
          </Button>
        )}
        {sinalPago && !temContratoCota && (
          <Button
            size="sm"
            variant="ghost"
            disabled={ocupado}
            onClick={() =>
              acao("ct-cota", `/api/admin/processo/${processoId}/contrato`, {
                tipo: "cota",
              })
            }
          >
            {enviando === "ct-cota" ? "Gerando…" : "Gerar contrato da cota"}
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
