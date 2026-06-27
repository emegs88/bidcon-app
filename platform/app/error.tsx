"use client";
// Boundary global de erro. Client Component (exigência do Next). Não vaza stack:
// mostra mensagem neutra e oferece tentar de novo / voltar ao início. O detalhe
// técnico fica só no console do servidor/observabilidade, nunca na tela.
import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import styles from "./fallback.module.css";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // registro mínimo no console (sem expor ao usuário)
    console.error(error);
  }, [error]);

  return (
    <main className={styles.wrap}>
      <div className={styles.box}>
        <div className={styles.emoji} aria-hidden>
          ⚠️
        </div>
        <h1 className={styles.title}>Algo não saiu como esperado</h1>
        <p className={styles.desc}>
          Tivemos um problema ao carregar esta tela. Você pode tentar de novo ou
          voltar ao início.
        </p>
        <div className={styles.acoes}>
          <Button onClick={() => reset()}>Tentar de novo</Button>
          <Button href="/" variant="ghost">
            Voltar ao início
          </Button>
        </div>
      </div>
    </main>
  );
}
