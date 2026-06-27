// Home da área logada (Fase 0).
// Server Component: lê a sessão via Supabase (sujeito à RLS) e saúda o usuário.
// Sem telas de negócio ainda — só prova que login/sessão funcionam.
import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";

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

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "64px 24px" }}>
      <h1 style={{ fontWeight: 800 }}>Olá, {nome} 👋</h1>
      <p style={{ color: "#93A0B8" }}>
        Você está na área logada da Bidcon{profile?.tipo ? ` (${profile.tipo})` : ""}.
      </p>
      <p style={{ color: "#93A0B8", fontSize: 14 }}>
        Fase 0 — fundação. As telas de processo, cartas e comissões chegam nas
        próximas fases.
      </p>
      <form action="/auth/signout" method="post" style={{ marginTop: 24 }}>
        <button
          type="submit"
          style={{
            background: "transparent",
            color: "#cfcfd4",
            border: "1px solid rgba(255,255,255,.15)",
            borderRadius: 999,
            padding: "10px 18px",
            cursor: "pointer",
          }}
        >
          Sair
        </button>
      </form>
    </main>
  );
}
