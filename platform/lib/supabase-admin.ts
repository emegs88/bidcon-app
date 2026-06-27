// ============================================================================
// Cliente Supabase ADMIN (service_role) — SOMENTE no servidor.
// ----------------------------------------------------------------------------
// Usado por rotas server-side que precisam ESCREVER ignorando RLS:
// hoje, só o cron de sync de cotas. A service_role key:
//   - vem de SUPABASE_SERVICE_ROLE_KEY (env var protegida na Vercel);
//   - NUNCA vai ao client, NUNCA ao repo, NUNCA a logs.
// Importar este arquivo de um Client Component quebra o build de propósito
// (não há "use client"); mantenha-o só em rotas/handlers do servidor.
// ============================================================================
import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error(
      "Faltam env vars do servidor (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)."
    );
  }
  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
