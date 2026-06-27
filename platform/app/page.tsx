// Home da área logada. Server Component: lê a sessão (RLS) e saúda o usuário.
// Atalhos para Meu processo e Cartas dentro da AppShell.
import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/Card";
import styles from "./home.module.css";

export default async function Home() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // perfil é protegido por RLS: só retorna a própria linha
  const { data: profile } = await supabase
    .from("profiles")
    .select("nome, tipo")
    .eq("id", user.id)
    .single();

  const nome = profile?.nome ?? user.email ?? "visitante";
  const primeiroNome = nome.split(" ")[0];

  return (
    <AppShell nome={nome}>
      <h1 className={styles.hi}>Olá, {primeiroNome} 👋</h1>
      <p className={styles.sub}>
        Bem-vindo à sua área Bidcon{profile?.tipo ? ` · ${profile.tipo}` : ""}.
        Acompanhe seu processo e veja as cartas contempladas disponíveis.
      </p>

      <div className={styles.grid}>
        <Card href="/meu-processo">
          <span className={styles.cardTitle}>Meu processo</span>
          <span className={styles.cardDesc}>
            Acompanhe cada etapa da sua carta contemplada.
          </span>
        </Card>
        <Card href="/cartas">
          <span className={styles.cardTitle}>Cartas disponíveis</span>
          <span className={styles.cardDesc}>
            Explore cotas de consórcio já contempladas, de imóvel e veículo.
          </span>
        </Card>
      </div>
    </AppShell>
  );
}
