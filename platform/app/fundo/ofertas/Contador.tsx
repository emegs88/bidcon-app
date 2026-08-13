"use client";
// ============================================================================
// Contador — quanto falta da janela de 24 horas, atualizado de segundo em segundo
// ----------------------------------------------------------------------------
// A ordem pede "24 horas com contador visível". Visível quer dizer ANDANDO: um
// carimbo "expira às 14h32 de amanhã" obriga cada pessoa a fazer a subtração de
// cabeça, e é a subtração que erra.
//
// POR QUE O INSTANTE INICIAL VEM DO SERVIDOR E O TIQUE É DAQUI. O relógio do
// navegador pode estar errado — e às vezes está, por horas. Se o cliente
// calculasse "agora" sozinho, uma máquina adiantada mostraria oferta expirada
// que o servidor considera viva, e a pessoa deixaria de agir sobre uma proposta
// de pé. Então o servidor manda `restanteMsInicial`, medido com o relógio dele,
// e aqui só se DESCONTA o tempo decorrido desde a montagem (`performance.now`,
// que é monotônico e não pula quando o sistema acerta a hora). O erro possível
// vira o tempo de rede da página — segundos —, e não o desvio do relógio.
//
// Quem decide de verdade se a oferta vale é `statusEfetivo()` no servidor, na
// leitura. Este componente conta; ele não julga.
// ============================================================================
import { useEffect, useState } from "react";
import styles from "../fundo.module.css";

/** "23h 41min 08s" — sem casas que ninguém lê e sem zero à esquerda na maior. */
function formatar(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const dois = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h}h ${dois(m)}min ${dois(s)}s`;
  if (m > 0) return `${m}min ${dois(s)}s`;
  return `${s}s`;
}

export function Contador({ restanteMsInicial }: { restanteMsInicial: number }) {
  const [restante, setRestante] = useState(restanteMsInicial);

  useEffect(() => {
    // Base monotônica: imune a acerto de relógio e a horário de verão.
    const inicio = performance.now();
    const id = setInterval(() => {
      const decorrido = performance.now() - inicio;
      setRestante(Math.max(0, restanteMsInicial - decorrido));
    }, 1000);
    return () => clearInterval(id);
  }, [restanteMsInicial]);

  if (restante <= 0) {
    return <span className={styles.contadorMorto}>janela encerrada</span>;
  }

  // `aria-live="off"`: um contador que se anuncia a cada segundo tornaria a
  // página impossível de usar com leitor de tela. O valor fica legível sob
  // demanda, não gritado.
  return (
    <span className={styles.contador} aria-live="off">
      faltam {formatar(restante)}
    </span>
  );
}
