"use client";
// Login por e-mail (magic link). Prova o fluxo de autenticação.
// Lógica inalterada; visual padronizado com Card/Button + CSS Module.
import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import styles from "./login.module.css";

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
    <main className={styles.wrap}>
      <a className={styles.brand} href="/">
        bid<span className={styles.brandAccent}>con</span>
      </a>
      <Card>
        <h1 className={styles.title}>Entrar na Bidcon</h1>
        <p className={styles.sub}>
          Enviamos um link de acesso para o seu e-mail — sem senha.
        </p>

        {sent ? (
          <p className={styles.ok}>
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
              className={styles.input}
            />
            <Button type="submit" block>
              Receber link de acesso
            </Button>
            {erro && <p className={styles.erro}>Erro: {erro}</p>}
          </form>
        )}
      </Card>
    </main>
  );
}
