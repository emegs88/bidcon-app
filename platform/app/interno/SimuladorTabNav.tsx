"use client";
// Nav compartilhada entre os simuladores internos (Porto / Disal). Não é uma
// rota (sem page.tsx/layout.tsx/route.ts) — Next ignora este arquivo no
// roteamento; é só um componente colocation com as duas páginas que o usam.
// Mesma identidade visual das abas internas do simulador Porto: botões pill,
// ativo = gradiente de marca, inativo = transparente.
import Link from "next/link";

const ABAS = [
  { key: "porto", label: "Porto Seguro · Grupos em andamento", href: "/interno/simulador-porto" },
  { key: "disal", label: "Disal · Planos novos", href: "/interno/simulador-disal" },
] as const;

export function SimuladorTabNav({ ativo }: { ativo: "porto" | "disal" }) {
  return (
    <nav style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
      {ABAS.map((a) => (
        <Link
          key={a.key}
          href={a.href}
          style={{
            padding: "8px 18px",
            borderRadius: 999,
            border: "1px solid #1E6FE6",
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 700,
            background: ativo === a.key ? "linear-gradient(90deg,#8FB7FF,#36C5F0,#1E6FE6)" : "transparent",
            color: ativo === a.key ? "#0A0E1A" : "#8FB7FF",
          }}
        >
          {a.label}
        </Link>
      ))}
    </nav>
  );
}
