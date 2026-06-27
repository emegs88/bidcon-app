"use client";
// Busca por linguagem natural (client). Campo livre + exemplos clicáveis →
// POST /api/buscar-cartas → lista de cartas com frase de encaixe.
// Reusa CartaCard para o cartão; a frase de encaixe vem acima de cada card.
// Estados: ocioso, carregando, com-resultados, vazio, erro. Sem promessa de
// contemplação em nenhum texto desta tela.
import { useState } from "react";
import { CartaCard, type CartaVitrine } from "@/components/CartaCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import styles from "./Busca.module.css";

type CartaResultado = CartaVitrine & { encaixe: string };

type Resposta = {
  cartas?: CartaResultado[];
  erro?: string;
};

const EXEMPLOS = [
  "Apartamento de uns 300 mil com entrada baixa",
  "Carro até 80 mil pra trocar o meu",
  "Primeiro imóvel pra família",
  "Veículo de trabalho parcelado",
];

export function Busca() {
  const [texto, setTexto] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [cartas, setCartas] = useState<CartaResultado[] | null>(null);

  async function buscar(consulta: string) {
    const q = consulta.trim();
    if (q.length < 3) {
      setErro("Descreva o que você procura em algumas palavras.");
      return;
    }
    setCarregando(true);
    setErro(null);
    try {
      const resp = await fetch("/api/buscar-cartas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: q }),
      });
      const data = (await resp.json().catch(() => ({}))) as Resposta;
      if (!resp.ok) {
        setErro(data.erro ?? "Não foi possível buscar agora. Tente de novo.");
        setCartas(null);
        return;
      }
      setCartas(data.cartas ?? []);
    } catch {
      setErro("Falha de conexão. Tente novamente.");
      setCartas(null);
    } finally {
      setCarregando(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    void buscar(texto);
  }

  function usarExemplo(ex: string) {
    setTexto(ex);
    void buscar(ex);
  }

  return (
    <div className={styles.wrap}>
      <form className={styles.form} onSubmit={onSubmit} role="search">
        <label className={styles.label} htmlFor="busca-texto">
          O que você procura?
        </label>
        <div className={styles.linha}>
          <input
            id="busca-texto"
            className={styles.input}
            type="text"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Ex.: apartamento de uns 300 mil com entrada baixa"
            maxLength={400}
            autoComplete="off"
            disabled={carregando}
          />
          <Button type="submit" disabled={carregando}>
            {carregando ? "Buscando…" : "Buscar"}
          </Button>
        </div>
      </form>

      <div className={styles.exemplos} aria-label="Exemplos de busca">
        <span className={styles.exLbl}>Experimente:</span>
        {EXEMPLOS.map((ex) => (
          <button
            key={ex}
            type="button"
            className={styles.chip}
            onClick={() => usarExemplo(ex)}
            disabled={carregando}
          >
            {ex}
          </button>
        ))}
      </div>

      {erro && (
        <p className={styles.erro} role="alert">
          {erro}
        </p>
      )}

      {carregando && (
        <p className={styles.status} role="status" aria-live="polite">
          Lendo o seu pedido e comparando com as cartas disponíveis…
        </p>
      )}

      {!carregando && cartas !== null && cartas.length === 0 && (
        <EmptyState
          icon="🔎"
          title="Nada encontrado para esse pedido"
          description="Tente descrever de outro jeito (tipo do bem, faixa de valor) ou veja todas as cartas disponíveis."
          action={<Button href="/cartas" variant="ghost">Ver todas as cartas</Button>}
        />
      )}

      {!carregando && cartas !== null && cartas.length > 0 && (
        <div className={styles.resultados}>
          {cartas.map((c) => (
            <article key={c.id} className={styles.item}>
              <p className={styles.encaixe}>{c.encaixe}</p>
              <CartaCard carta={c} />
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
