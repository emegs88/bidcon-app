"use client";
// Login por e-mail (magic link). Fase 0: prova o fluxo de autenticação.
// O schema também suporta auto-cadastro — a escolha final fica para a fase de
// telas (ver docs/plataforma-arquitetura.md §3).
import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setErro(error.message);
    else setSent(true);
  }

  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: "72px 24px" }}>
      <h1 style={{ fontWeight: 800, marginBottom: 8 }}>Entrar na Bidcon</h1>
      <p style={{ color: "#93A0B8", fontSize: 14, marginTop: 0 }}>
        Enviamos um link de acesso para o seu e-mail.
      </p>

      {sent ? (
        <p style={{ color: "#34D399" }}>
          Link enviado para <b>{email}</b>. Confira sua caixa de entrada.
        </p>
      ) : (
        <form onSubmit={enviar}>
          <input
            type="email"
            required
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            placeholder="seu@email.com"
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,.15)",
              background: "#10182B",
              color: "#f6f6f8",
              marginBottom: 12,
            }}
          />
          <button
            type="submit"
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: 999,
              border: 0,
              background: "linear-gradient(100deg,#8FB7FF,#36C5F0 45%,#1E6FE6)",
              color: "#04121f",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Receber link de acesso
          </button>
          {erro && (
            <p style={{ color: "#f3c34a", fontSize: 13 }}>Erro: {erro}</p>
          )}
        </form>
      )}
    </main>
  );
}
