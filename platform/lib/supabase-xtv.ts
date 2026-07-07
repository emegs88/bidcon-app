// ============================================================================
// Cliente Supabase XTV (service_role) — SOMENTE no servidor.
// ----------------------------------------------------------------------------
// O projeto Supabase "nnv" cuida de AUTH e da tabela `cartas`. As tabelas de
// dados do fluxo de atendimento — `interesses`, `conversas`, `mensagens` —
// vivem no projeto "xtv" (xtvjpnyadcdeadhmzyff). Este client aponta pro xtv e é
// usado pelo POST /api/atende para ler/gravar esses dados ignorando RLS
// (lead anônimo, sem sessão). A service_role key:
//   - vem de BIDCON_XTV_SERVICE_ROLE_KEY (env var protegida na Vercel);
//   - NUNCA vai ao client, NUNCA ao repo, NUNCA a logs, NUNCA é NEXT_PUBLIC.
// Importar este arquivo de um Client Component quebra o build de propósito
// (não há "use client"); mantenha-o só em rotas/handlers do servidor.
// ============================================================================
import { createClient } from "@supabase/supabase-js";

export function createXtvClient() {
  const url = process.env.BIDCON_XTV_URL;
  const serviceRole = process.env.BIDCON_XTV_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error(
      "Faltam env vars do servidor (BIDCON_XTV_URL / BIDCON_XTV_SERVICE_ROLE_KEY)."
    );
  }
  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
