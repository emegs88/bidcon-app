"use client";
// Cadastro por e-mail + senha, com confirmação de e-mail.
// Autocadastro cria sempre tipo='cliente' (o trigger handle_new_user em 0008
// faz isso a partir de auth.users; nome/telefone vão em options.data). Após o
// signUp, o Supabase envia o e-mail de confirmação e o usuário só entra depois
// de confirmar. Mantém o mesmo visual do /login (Card + login.module.css).
import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import styles from "../login/login.module.css";

const MIN_SENHA = 8;

export default function CadastroPage() {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    if (senha.length < MIN_SENHA) {
      setErro(`A senha precisa de ao menos ${MIN_SENHA} caracteres.`);
      return;
    }

    setEnviando(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password: senha,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: { nome: nome.trim(), telefone: telefone.trim() },
      },
    });
    setEnviando(false);

    if (error) setErro(error.message);
    else setEnviado(true);
  }

  return (
    <main className={styles.wrap}>
      <a className={styles.brand} href="/">
        bid<span className={styles.brandAccent}>con</span>
      </a>
      <Card>
        <h1 className={styles.title}>Criar conta</h1>
        <p className={styles.sub}>
          Cadastre-se com e-mail e senha. Enviamos um link para confirmar seu
          e-mail antes do primeiro acesso.
        </p>

        {enviado ? (
          <p className={styles.ok}>
            Conta criada. Enviamos um e-mail de confirmação para <b>{email}</b>.
            Confirme pelo link e depois entre com sua senha.
          </p>
        ) : (
          <form onSubmit={enviar}>
            <input
              type="text"
              required
              value={nome}
              onChange={(ev) => setNome(ev.target.value)}
              placeholder="Seu nome completo"
              className={styles.input}
              autoComplete="name"
            />
            <input
              type="tel"
              value={telefone}
              onChange={(ev) => setTelefone(ev.target.value)}
              placeholder="Telefone (opcional)"
              className={styles.input}
              autoComplete="tel"
            />
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
              minLength={MIN_SENHA}
              value={senha}
              onChange={(ev) => setSenha(ev.target.value)}
              placeholder={`Senha (mín. ${MIN_SENHA} caracteres)`}
              className={styles.input}
              autoComplete="new-password"
            />
            <Button type="submit" block disabled={enviando}>
              {enviando ? "Criando conta…" : "Criar conta"}
            </Button>
            {erro && <p className={styles.erro}>Erro: {erro}</p>}
          </form>
        )}

        <p className={styles.sub} style={{ marginTop: 18, marginBottom: 0 }}>
          Já tem conta? <a href="/login">Entrar</a>
        </p>
      </Card>
    </main>
  );
}
