"use client";
// Ações da conversa (CRM-01 + PAINEL-WA-01 item 5): "Assumir" pausa o bot (status='humano' —
// wa_conversas já suportava; conversas do site ganhou o valor na migration
// 0061 + o gate em /api/atende) e "Devolver ao agente" retoma o bot.
// Mesmo padrão genérico de ProcessoAcoes/RevisaoCartaAcoes: POST → router.refresh().
//
// item 5 acrescenta duas saídas, e a diferença de peso visual entre elas é
// intencional:
//   - "Encerrar" arquiva (status='encerrado'). Não bloqueia: mensagem nova do
//     cliente reabre a conversa no webhook. Só existe no canal WhatsApp — o
//     site usa 'fechada' e não tem rota equivalente nesta fatia.
//   - "Atender no meu WhatsApp" é o Caminho B, e vem como link, não botão. É o
//     caminho em que a conversa SAI daqui: nada do que for dito depois fica
//     registrado no painel. Tem de estar disponível sem fricção e não pode ser
//     sugerido — por isso o aviso é literal sobre os dois custos (histórico
//     perdido e, se o bot não estiver pausado, duas vozes falando com o
//     cliente ao mesmo tempo).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import styles from "./conversas.module.css";

export function ConversaAcoes({
  canal,
  conversaId,
  status,
  telefone,
}: {
  canal: "whatsapp" | "site";
  conversaId: string;
  status: string;
  /** Só o canal WhatsApp passa — é o que monta o link wa.me do Caminho B. */
  telefone?: string | null;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState<"assumir" | "devolver" | "encerrar" | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const assumida = status === "humano";
  // Mesma leitura da lista: os dois canais chamam "encerrada" de nomes
  // diferentes, e o componente é compartilhado.
  const encerrada = canal === "whatsapp" ? status === "encerrado" : status === "fechada";
  // wa.me exige só dígitos; wa_conversas.telefone guarda com "+".
  const waMe = telefone ? `https://wa.me/${telefone.replace(/\D/g, "")}` : null;

  async function acao(chave: "assumir" | "devolver" | "encerrar") {
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
        {canal === "whatsapp" && !encerrada && (
          <Button
            size="sm"
            variant="ghost"
            disabled={enviando !== null}
            onClick={() => acao("encerrar")}
          >
            {enviando === "encerrar" ? "Encerrando…" : "Encerrar"}
          </Button>
        )}
        <span className={styles.nota}>
          {assumida
            ? "Bot pausado nesta conversa — só respostas manuais."
            : encerrada
              ? "Conversa arquivada. Se o cliente escrever de novo, ela reabre e o bot volta a responder."
              : "O bot continua respondendo automaticamente até alguém assumir."}
        </span>
      </div>
      {canal === "whatsapp" && waMe && (
        <p className={styles.transferencia}>
          <a className={styles.linkExterno} href={waMe} target="_blank" rel="noopener noreferrer">
            Atender no meu WhatsApp
          </a>{" "}
          — a conversa continua fora do painel: nada do que for dito lá fica
          registrado aqui, e o histórico deixa de ficar num lugar só.
          {!assumida && " Assuma antes, ou o bot responde junto com você."}
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
