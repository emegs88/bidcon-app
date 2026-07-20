"use client";
// Ações da conversa (CRM-01): "Assumir" pausa o bot (status='humano' —
// wa_conversas já suportava; conversas do site ganhou o valor na migration
// 0061 + o gate em /api/atende) e "Devolver ao agente" retoma o bot.
// Mesmo padrão genérico de ProcessoAcoes/RevisaoCartaAcoes: POST → router.refresh().
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import styles from "./conversas.module.css";

export function ConversaAcoes({
  canal,
  conversaId,
  status,
}: {
  canal: "whatsapp" | "site";
  conversaId: string;
  status: string;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState<"assumir" | "devolver" | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const assumida = status === "humano";

  async function acao(chave: "assumir" | "devolver") {
    if (enviando) return;
    setEnviando(chave);
    setErro(null);
    try {
      const res = await fetch(`/api/admin/conversas/${canal}/${conversaId}/${chave}`, {
        method: "POST",
      });
      const dados = (await res.json().catch(() => ({}))) as { ok?: boolean; erro?: string };
      if (!res.ok || !dados?.ok) {
        throw new Error(dados?.erro ?? "Falha ao atualizar a conversa.");
      }
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro inesperado.");
    } finally {
      setEnviando(null);
    }
  }

  return (
    <div className={styles.acoesWrap}>
      <div className={styles.botoes} role="group" aria-label="Assumir ou devolver conversa">
        {assumida ? (
          <Button size="sm" disabled={enviando !== null} onClick={() => acao("devolver")}>
            {enviando === "devolver" ? "Devolvendo…" : "Devolver ao agente"}
          </Button>
        ) : (
          <Button size="sm" disabled={enviando !== null} onClick={() => acao("assumir")}>
            {enviando === "assumir" ? "Assumindo…" : "Assumir"}
          </Button>
        )}
        <span className={styles.nota}>
          {assumida
            ? "Bot pausado nesta conversa — só respostas manuais."
            : "O bot continua respondendo automaticamente até alguém assumir."}
        </span>
      </div>
      {erro && (
        <p className={styles.erro} role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}
