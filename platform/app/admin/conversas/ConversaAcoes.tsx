"use client";
// Ações da conversa (CRM-01 + PAINEL-WA-01 item 5 + CONVERSAS-02 Entrega 2).
// "Assumir" pausa o bot (status='humano' — wa_conversas já suportava; conversas
// do site ganhou o valor na migration 0061 + o gate em /api/atende) e "Devolver
// ao agente" retoma o bot. Mesmo padrão genérico de ProcessoAcoes/
// RevisaoCartaAcoes: POST → router.refresh().
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
//
// ---------------------------------------------------------------------------
// CONVERSAS-02 — A CONFIRMAÇÃO NOMINAL, E O DESVIO DECLARADO
// ---------------------------------------------------------------------------
// A OS pediu "assumir e devolver direto no card, com confirmação nominal". A
// leitura óbvia de "nominal" é a da tela de exclusão de carta: digitar uma
// palavra. Aqui ela protegeria contra a coisa errada, e o motivo é o contexto:
//
//   - Na exclusão, o risco é o CLIQUE REFLEXO numa ação irreversível. Digitar
//     uma palavra quebra o reflexo, e é por isso que aquela tela pede.
//   - Nesta lista, o risco é OUTRO: são 27 cards quase idênticos, empilhados,
//     que até esta fatia mostravam o mesmo telefone repetido. O erro real não é
//     clicar sem pensar — é clicar na LINHA ERRADA. Digitar "assumir" não
//     protege disso: o operador digitaria a palavra com a mesma convicção no
//     card errado, porque a palavra não fala sobre QUEM.
//
// Então a confirmação aqui NOMEIA a pessoa: "Assumir a conversa de Maria Silva
// · (19) 99756-1909?". É o mesmo gesto de dois passos, mas o segundo passo
// mostra o alvo em vez de pedir uma senha. Quem clicou errado lê um nome que
// não esperava e para.
//
// E ela nomeia com o texto que o CARD JÁ ESTÁ MOSTRANDO — por isso `contato`
// chega pronto por prop em vez de ser formatado aqui. Formatar de novo neste
// componente exigiria o canal real, e este componente só recebe o canal da ROTA
// ('whatsapp' para Instagram também): uma conversa de Instagram teria seu IGSID
// formatado como telefone e a confirmação nomearia a pessoa com um número que
// não existe. Confirmação que mostra um dado diferente do da lista é pior do
// que confirmação nenhuma.
//
// Nenhuma das três ações é irreversível — assumir se desfaz devolvendo,
// encerrar reabre com mensagem nova do cliente. A confirmação existe pela
// pessoa do outro lado, não pelo banco.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import styles from "./conversas.module.css";

type Acao = "assumir" | "devolver" | "encerrar";

/** O que cada ação faz, dito para quem vai confirmar. Sem eufemismo: o texto
 *  diz a consequência para o CLIENTE, que é o que o operador precisa pesar. */
const CONSEQUENCIA: Record<Acao, string> = {
  assumir: "O bot para de responder nesta conversa. A partir daí, quem responde é você.",
  devolver: "O bot volta a responder automaticamente, sem esperar por você.",
  encerrar:
    "A conversa sai da fila. Não bloqueia: se o cliente escrever de novo, ela reabre e o bot responde.",
};

const VERBO: Record<Acao, string> = {
  assumir: "Assumir",
  devolver: "Devolver ao agente",
  encerrar: "Encerrar",
};

const GERUNDIO: Record<Acao, string> = {
  assumir: "Assumindo…",
  devolver: "Devolvendo…",
  encerrar: "Encerrando…",
};

export function ConversaAcoes({
  canal,
  conversaId,
  status,
  telefone,
  nome,
  contato,
  href,
  compacto = false,
}: {
  canal: "whatsapp" | "site";
  conversaId: string;
  status: string;
  /** Só o canal WhatsApp passa — é o que monta o link wa.me do Caminho B. */
  telefone?: string | null;
  /** Nome do contato, quando existe. Entra na confirmação nominal. */
  nome?: string | null;
  /** O contato JÁ FORMATADO, igual ao que o card mostra. Ver o bloco acima
   *  sobre por que ele não é formatado aqui dentro. */
  contato?: string | null;
  /** Link para a conversa completa. Sem ele, o botão "Abrir" não aparece. */
  href?: string;
  /** Modo lista: some com as notas longas e com o Caminho B, que continuam
   *  inteiros na página da conversa. Um card de fila precisa caber na tela. */
  compacto?: boolean;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState<Acao | null>(null);
  const [confirmando, setConfirmando] = useState<Acao | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const assumida = status === "humano";
  // Mesma leitura da lista: os dois canais chamam "encerrada" de nomes
  // diferentes, e o componente é compartilhado.
  const encerrada = canal === "whatsapp" ? status === "encerrado" : status === "fechada";
  // wa.me exige só dígitos; wa_conversas.telefone guarda com "+".
  const waMe = telefone ? `https://wa.me/${telefone.replace(/\D/g, "")}` : null;

  // Quem é esta conversa, em uma linha. Nome e contato juntos quando os dois
  // existem: o nome identifica a pessoa, o número desempata homônimos. Sem
  // nenhum dos dois, o texto ADMITE que não sabe em vez de inventar um rótulo.
  const alvo = [nome, contato].filter((p): p is string => Boolean(p && p.trim())).join(" · ");
  const alvoTexto = alvo || "esta conversa (sem nome e sem contato)";

  async function executar(chave: Acao) {
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
      setConfirmando(null);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro inesperado.");
    } finally {
      setEnviando(null);
    }
  }

  const wrapCls = compacto ? styles.acoesCompactas : styles.acoesWrap;

  // ------------------------------------------------------------------
  // Passo 2: a confirmação que NOMEIA.
  // ------------------------------------------------------------------
  if (confirmando) {
    return (
      <div className={wrapCls}>
        <div className={styles.confirma} role="alertdialog" aria-live="polite">
          <p className={styles.confirmaPergunta}>
            {VERBO[confirmando]} a conversa de <strong>{alvoTexto}</strong>?
          </p>
          <p className={styles.confirmaConsequencia}>{CONSEQUENCIA[confirmando]}</p>
          <div className={styles.botoes}>
            <Button
              size="sm"
              autoFocus
              disabled={enviando !== null}
              onClick={() => executar(confirmando)}
            >
              {enviando ? GERUNDIO[confirmando] : `Sim, ${VERBO[confirmando].toLowerCase()}`}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={enviando !== null}
              onClick={() => {
                setConfirmando(null);
                setErro(null);
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
        {erro && (
          <p className={styles.erro} role="alert">
            {erro}
          </p>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Passo 1: as ações.
  // ------------------------------------------------------------------
  return (
    <div className={wrapCls}>
      <div className={styles.botoes} role="group" aria-label="Ações desta conversa">
        {assumida ? (
          <Button size="sm" onClick={() => setConfirmando("devolver")}>
            Devolver ao agente
          </Button>
        ) : (
          <Button size="sm" onClick={() => setConfirmando("assumir")}>
            Assumir
          </Button>
        )}
        {href && (
          <Button href={href} variant="link" size="sm">
            Abrir
          </Button>
        )}
        {/* ITEM 5 DA CONVERSAS-03 — "ação destrutiva não fica no mesmo peso da
            ação principal".
            DUAS MUDANÇAS, E SÓ DUAS: o peso visual (`ghost`, que desenha borda
            e fundo como o Assumir, vira `link` mais uma classe apagada) e a
            POSIÇÃO — passou para depois do "Abrir", no fim da fileira. A ordem
            importa tanto quanto a cor: enquanto o Encerrar era o segundo botão,
            ele ficava exatamente onde o polegar cai depois do primeiro.
            O QUE NÃO MUDOU: a confirmação nominal. A OS foi explícita ("continua"),
            e ela é a trava que impede encerrar a conversa da linha errada — o
            risco real numa lista de cards quase idênticos. Rebaixar o botão E
            afrouxar a confirmação seria trocar uma defesa por outra; aqui as
            duas ficam. */}
        {canal === "whatsapp" && !encerrada && (
          <Button
            size="sm"
            variant="link"
            className={styles.encerrar}
            onClick={() => setConfirmando("encerrar")}
          >
            Encerrar
          </Button>
        )}
        {/* A nota explica o estado do bot. No card da fila ela sai: a mesma
            informação já está na pastilha de status ao lado do nome, e repetir
            por card empurraria a próxima conversa para fora da tela. */}
        {!compacto && (
          <span className={styles.nota}>
            {assumida
              ? "Bot pausado nesta conversa — só respostas manuais."
              : encerrada
                ? "Conversa arquivada. Se o cliente escrever de novo, ela reabre e o bot volta a responder."
                : "O bot continua respondendo automaticamente até alguém assumir."}
          </span>
        )}
      </div>
      {/* Caminho B só na página da conversa. Escolhê-lo é abrir mão do
          histórico, e essa decisão não deve ser tomada de relance numa fila —
          mas continua a um clique de distância, pelo "Abrir". */}
      {!compacto && canal === "whatsapp" && waMe && (
        <p className={styles.transferencia}>
          <a className={styles.linkExterno} href={waMe} target="_blank" rel="noopener noreferrer">
            Atender no meu WhatsApp
          </a>{" "}
          — a conversa continua fora do painel: nada do que for dito lá fica registrado aqui, e o
          histórico deixa de ficar num lugar só.
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
