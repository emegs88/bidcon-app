"use client";
// PAINEL-WA-01 item 3 — compositor do Caminho A: o operador responde DE DENTRO
// do painel e a conversa inteira continua num lugar só.
// ----------------------------------------------------------------------------
// Este componente NÃO decide nada sozinho — ele EXPLICA a decisão que a rota
// /responder vai tomar de qualquer jeito. Toda condição chega pronta do
// servidor (props), e é por isso que não existe `Date` aqui dentro: calcular a
// janela no relógio do navegador criaria divergência de hidratação e, pior,
// deixaria o aviso à mercê de um relógio local errado.
//
// O estado que este componente mostra é uma FOTO do instante do render — a
// mesma natureza do valor que viajava no job antes do item 1. A autoridade é a
// rota, que relê status, opt_out e janela no momento do envio. Quando a foto
// envelhece, o operador não recebe silêncio: recebe a recusa real, com motivo.
//
// Duas escolhas deliberadas no erro:
//   1. o texto digitado NUNCA é limpo numa recusa — recusa não pode custar o
//      que a pessoa escreveu;
//   2. quando a Cloud API é quem recusa, sendText JÁ gravou a tentativa como
//      'falha' em wa_mensagens; o refresh traz essa linha pra thread, em vez
//      de deixar a tentativa sumir sem rastro.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import styles from "./conversas.module.css";

/** Mesmo teto da rota e da Cloud API. Duplicado de propósito: aqui ele serve
 *  pra AVISAR antes de gastar uma requisição; lá ele serve pra barrar. */
const LIMITE_TEXTO = 4096;

export function ResponderWhatsApp({
  conversaId,
  assumida,
  optOut,
  janelaAberta,
  janelaTexto,
}: {
  conversaId: string;
  assumida: boolean;
  optOut: boolean;
  janelaAberta: boolean;
  /** Frase pronta, formatada no servidor, sobre o estado da janela de 24h. */
  janelaTexto: string;
}) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Ordem importa: o motivo mostrado é o primeiro que realmente barra. Mostrar
  // "janela fechada" pra quem nem assumiu a conversa mandaria o operador
  // resolver o problema errado.
  const bloqueio = optOut
    ? "Este lead pediu para não receber mensagens (opt-out). Nada pode ser enviado por aqui."
    : !assumida
      ? "Assuma a conversa antes de responder — com o agente ativo o cliente receberia duas respostas."
      : !janelaAberta
        ? `A Meta só aceita texto livre dentro da janela de 24h — ${janelaTexto} Envio de template está fora desta fatia.`
        : null;

  const estourado = texto.length > LIMITE_TEXTO;
  const podeEnviar = !bloqueio && !enviando && texto.trim().length > 0 && !estourado;

  async function enviar() {
    if (!podeEnviar) return;
    setEnviando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/admin/conversas/whatsapp/${conversaId}/responder`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ texto }),
      });
      const dados = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        erro?: string;
        statusEnvio?: string;
      };
      if (!res.ok || !dados?.ok) {
        setErro(dados?.erro ?? "Falha no envio — a Cloud API não confirmou.");
        // Recusa da Meta deixa rastro gravado; recusa das barreiras (status,
        // opt-out, janela) não deixa. Nos dois casos o refresh reexibe o estado
        // real da conversa, que pode ter mudado enquanto a tela estava parada.
        router.refresh();
        return;
      }
      setTexto("");
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro inesperado no envio.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className={styles.compositor}>
      {bloqueio ? (
        <p className={styles.nota}>{bloqueio}</p>
      ) : (
        <p className={styles.nota}>{janelaTexto}</p>
      )}

      <textarea
        className={styles.textarea}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        disabled={bloqueio !== null || enviando}
        placeholder={
          bloqueio ? "Envio indisponível nesta conversa." : "Escreva a resposta ao cliente…"
        }
        aria-label="Resposta ao cliente pelo WhatsApp"
      />

      <div className={styles.compositorRodape}>
        <span className={`${styles.contador} ${estourado ? styles.contadorEstourado : ""}`}>
          {texto.length}/{LIMITE_TEXTO}
          {estourado ? " — acima do limite da Cloud API" : ""}
        </span>
        <Button size="sm" disabled={!podeEnviar} onClick={enviar}>
          {enviando ? "Enviando…" : "Enviar pelo WhatsApp"}
        </Button>
      </div>

      {erro && (
        <p className={styles.erro} role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}
