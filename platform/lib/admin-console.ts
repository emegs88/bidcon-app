// ============================================================================
// Console admin (FATIA F1 — importador + fila de revisão) — gate de acesso
// por allowlist de e-mail. Modelado em lib/equipe.ts (mesmo espírito: critério
// simples de aplicação, sem sistema de papéis). Um único nível de acesso —
// admin/operador/leitura fica para uma fatia futura (F3), por decisão do
// usuário: não construir isso agora.
// ----------------------------------------------------------------------------
// A allowlist vem de BIDCON_ADMIN_EMAILS (env var, servidor), lista separada
// por vírgula. Comparação case-insensitive, com trim. Sem RLS reforçando isso
// no banco (diferente do byAncora) porque os dados que este console maneja
// (cartas/fornecedores/importações) vivem no xtv e são acessados via
// service_role (createXtvClient) — a única barreira real é esta, na aplicação.
// ============================================================================
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";

function allowlist(): string[] {
  return (process.env.BIDCON_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

/**
 * True somente para e-mails presentes na allowlist BIDCON_ADMIN_EMAILS.
 * Case-insensitive, tolera null/undefined (retorna false).
 */
export function ehAdminConsole(email: string | null | undefined): boolean {
  if (typeof email !== "string") return false;
  const alvo = email.trim().toLowerCase();
  if (!alvo) return false;
  return allowlist().includes(alvo);
}

/**
 * Server Component helper: exige sessão + e-mail na allowlist, senão
 * redireciona (sem sessão -> /login; sessão fora da allowlist -> /). Retorna
 * {nome, email} para a página usar no AppShell.
 */
export async function exigirAdminConsolePagina(): Promise<{
  nome: string | null;
  email: string;
}> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!ehAdminConsole(user.email)) redirect("/");

  const { data: perfil } = await supabase
    .from("profiles")
    .select("nome")
    .eq("id", user.id)
    .maybeSingle();

  return { nome: perfil?.nome ?? user.email ?? null, email: user.email as string };
}

export type CheckAdminConsoleApi =
  | { ok: true; email: string }
  | { ok: false; status: 401 | 403; motivo: string };

/**
 * Versão Route Handler do gate: sem redirect — devolve um union pra rota
 * decidir a resposta HTTP (401 sem sessão, 403 fora da allowlist).
 */
export async function checarAdminConsoleApi(): Promise<CheckAdminConsoleApi> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, motivo: "não autenticado" };
  if (!ehAdminConsole(user.email)) {
    return { ok: false, status: 403, motivo: "acesso restrito ao console admin" };
  }
  return { ok: true, email: user.email as string };
}
