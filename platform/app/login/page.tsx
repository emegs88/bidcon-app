"use client";
// Login — senha como principal; magic link como alternativa.
// signInWithPassword (modo padrão) e signInWithOtp (modo "link") coexistem.
// O cadastro com senha vive em /cadastro; o trigger handle_new_user garante o
// profile. Visual padronizado com Card/Button + CSS Module.
import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import styles from "./login.module.css";

type Modo = "senha" | "link";

export default function LoginPage() {
  const [modo, setModo] = useState<Modo>("senha");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [sent, setSent] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function entrarComSenha(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    setCarregando(false);
    if (error) {
      setErro("E-mail ou senha incorretos.");
      return;
    }
    window.location.assign("/");
  }

  async function enviarLink(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setCarregando(false);
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
          {modo === "senha"
            ? "Use seu e-mail e senha para acessar."
            : "Enviamos um link de acesso para o seu e-mail — sem senha."}
        </p>

        {sent ? (
          <p className={styles.ok}>
            Link enviado para <b>{email}</b>. Confira sua caixa de entrada.
          </p>
        ) : modo === "senha" ? (
          <form onSubmit={entrarComSenha}>
            <input
              type="email"
              required
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              placeholder="seu@email.com"
              className={styles.input}
              autoComplete="email"
            />
            <input
              type="password"
              required
              value={senha}
              onChange={(ev) => setSenha(ev.target.value)}
              placeholder="Sua senha"
              className={styles.input}
              autoComplete="current-password"
            />
            <Button type="submit" block disabled={carregando}>
              {carregando ? "Entrando…" : "Entrar"}
            </Button>
            {erro && <p className={styles.erro}>{erro}</p>}
            <p className={styles.sub} style={{ marginTop: "1rem" }}>
              <Button type="button" variant="link" onClick={() => { setModo("link"); setErro(null); }}>
                Entrar com link por e-mail
              </Button>
            </p>
          </form>
        ) : (
          <form onSubmit={enviarLink}>
            <input
              type="email"
              required
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              placeholder="seu@email.com"
              className={styles.input}
              autoComplete="email"
            />
            <Button type="submit" block disabled={carregando}>
              {carregando ? "Enviando…" : "Receber link de acesso"}
            </Button>
            {erro && <p className={styles.erro}>Erro: {erro}</p>}
            <p className={styles.sub} style={{ marginTop: "1rem" }}>
              <Button type="button" variant="link" onClick={() => { setModo("senha"); setErro(null); }}>
                Entrar com e-mail e senha
              </Button>
            </p>
          </form>
        )}

        <p className={styles.sub} style={{ marginTop: "1.5rem", textAlign: "center" }}>
          Não tem conta?{" "}
          <Button href="/cadastro" variant="link">Criar conta</Button>
        </p>
      </Card>
    </main>
  );
}
