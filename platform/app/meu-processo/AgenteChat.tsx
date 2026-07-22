"use client";
// Agente de ajuda do processo (cliente). Chat plugável: sem IA_PROVIDER, o
// backend responde com FAQ factual estático; com provedor, a resposta do LLM
// passa por `sanitizarCompliance` no servidor ANTES de voltar ao client.
//
// COMPLIANCE: toda saída do agente é factual e sanitizada no servidor — este
// componente só exibe o que a rota /api/processo/agente devolve. Não interpreta
// nem executa instruções contidas nas mensagens.
import { useState } from "react";
import styles from "./fluxo.module.css";

type Msg = { autor: "user" | "bot"; texto: string };

export function AgenteChat({ processoId }: { processoId: string }) {
  const [log, setLog] = useState<Msg[]>([
    {
      autor: "bot",
      texto:
        "Posso ajudar com as etapas do seu processo: documentos, reserva e contratos. Não informo prazo de contemplação — isso depende da administradora.",
    },
  ]);
  const [entrada, setEntrada] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    const texto = entrada.trim();
    if (!texto || enviando) return;
    setEnviando(true);
    setEntrada("");
    setLog((l) => [...l, { autor: "user", texto }]);
    try {
      const res = await fetch("/api/processo/agente", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ processo_id: processoId, mensagem: texto }),
      });
      const j = (await res.json().catch(() => ({}))) as { resposta?: string };
      setLog((l) => [
        ...l,
        {
          autor: "bot",
          texto:
            j.resposta ??
            "Não consegui responder agora. Fale com o atendimento pelos contatos abaixo.",
        },
      ]);
    } catch {
      setLog((l) => [
        ...l,
        {
          autor: "bot",
          texto:
            "Não consegui responder agora. Fale com o atendimento pelos contatos abaixo.",
        },
      ]);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className={styles.chat}>
      <div className={styles.chatLog}>
        {log.map((m, i) => (
          <div key={i} className={m.autor === "user" ? styles.msgUser : styles.msgBot}>
            {m.texto}
          </div>
        ))}
      </div>
      <div className={styles.chatEntrada}>
        <input
          className={styles.chatInput}
          type="text"
          value={entrada}
          placeholder="Escreva sua dúvida sobre o processo…"
          disabled={enviando}
          onChange={(e) => setEntrada(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") enviar();
          }}
        />
      </div>
    </div>
  );
}
