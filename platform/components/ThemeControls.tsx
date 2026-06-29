"use client";

// Controles de acessibilidade da topbar:
//  - Tema: claro / escuro / alto contraste (baixa visão)
//  - Tamanho de fonte: A- / A+ (escala via [data-font] no <html>)
// A preferência persiste em localStorage e é aplicada antes do paint pelo
// script inline em app/layout.tsx (evita "flash" de tema errado). Aqui só
// refletimos o estado atual e gravamos as mudanças.
import { useEffect, useState } from "react";
import styles from "./ThemeControls.module.css";

type Theme = "light" | "dark" | "contrast";
type Font = "sm" | "md" | "lg" | "xl";

const THEME_KEY = "bidcon-theme";
const FONT_KEY = "bidcon-font";
const FONTS: Font[] = ["sm", "md", "lg", "xl"];

function systemTheme(): Theme {
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  ) {
    return "light";
  }
  return "dark";
}

export function ThemeControls() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [font, setFont] = useState<Font>("md");
  const [montado, setMontado] = useState(false);

  // Lê o que o script do <head> já aplicou no <html> (fonte da verdade).
  useEffect(() => {
    const root = document.documentElement;
    const t = (root.getAttribute("data-theme") as Theme) || systemTheme();
    const f = (root.getAttribute("data-font") as Font) || "md";
    setTheme(t);
    setFont(f);
    setMontado(true);
  }, []);

  function aplicarTema(t: Theme) {
    document.documentElement.setAttribute("data-theme", t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      /* localStorage indisponível (modo privado): tema só nesta sessão */
    }
    setTheme(t);
  }

  function aplicarFonte(f: Font) {
    if (f === "md") document.documentElement.removeAttribute("data-font");
    else document.documentElement.setAttribute("data-font", f);
    try {
      localStorage.setItem(FONT_KEY, f);
    } catch {
      /* idem */
    }
    setFont(f);
  }

  function passoFonte(dir: -1 | 1) {
    const i = FONTS.indexOf(font);
    const prox = FONTS[Math.min(FONTS.length - 1, Math.max(0, i + dir))];
    if (prox) aplicarFonte(prox);
  }

  // Evita divergência visual de hidratação antes de ler o <html>.
  if (!montado) {
    return <div className={styles.wrap} aria-hidden="true" />;
  }

  const temas: { id: Theme; label: string; icon: string }[] = [
    { id: "light", label: "Tema claro", icon: "☀" },
    { id: "dark", label: "Tema escuro", icon: "☾" },
    { id: "contrast", label: "Alto contraste", icon: "◑" },
  ];

  return (
    <div className={styles.wrap} role="group" aria-label="Acessibilidade">
      <div className={styles.fonte} role="group" aria-label="Tamanho do texto">
        <button
          type="button"
          className={styles.fbtn}
          onClick={() => passoFonte(-1)}
          disabled={font === "sm"}
          aria-label="Diminuir tamanho do texto"
          title="Diminuir texto"
        >
          A<span className={styles.minus}>−</span>
        </button>
        <button
          type="button"
          className={styles.fbtn}
          onClick={() => passoFonte(1)}
          disabled={font === "xl"}
          aria-label="Aumentar tamanho do texto"
          title="Aumentar texto"
        >
          A<span className={styles.plus}>+</span>
        </button>
      </div>

      <div className={styles.temas}>
        {temas.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`${styles.tbtn} ${theme === t.id ? styles.on : ""}`}
            onClick={() => aplicarTema(t.id)}
            aria-pressed={theme === t.id}
            aria-label={t.label}
            title={t.label}
          >
            <span aria-hidden="true">{t.icon}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
