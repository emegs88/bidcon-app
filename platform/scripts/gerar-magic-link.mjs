// Gera um magic link de acesso via auth.admin.generateLink, SEM disparar
// e-mail real (generateLink só cria o link; quem manda e-mail é
// auth.signInWithOtp ou o botão "send" do Studio — aqui não chamamos nada
// disso). Mesmo padrão de app/api/admin/processos/[id]/gerar-acesso/route.ts:
// service_role só nesta máquina, nunca commitada (.env.local está no
// .gitignore), nunca impressa — só o link final vai pro stdout.
//
// Uso (a partir de platform/, com SUPABASE_SERVICE_ROLE_KEY real no
// .env.local):
//   node scripts/gerar-magic-link.mjs <email> [next]
//
// Exemplo (Rafaela, CEDENTE-01):
//   node scripts/gerar-magic-link.mjs rafacruz2321@gmail.com /minha-carta
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const [, , email, next = "/"] = process.argv;
if (!email) {
  console.error("uso: node scripts/gerar-magic-link.mjs <email> [next]");
  process.exit(1);
}

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = {};
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.NEXT_PUBLIC_SUPABASE_URL) {
  console.error("faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY em .env.local");
  process.exit(1);
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email,
  options: { redirectTo: `https://app.bidcon.com.br/auth/callback?next=${next}` },
});

if (error || !data?.properties?.action_link) {
  console.error("ERRO:", error);
  process.exit(1);
}

console.log(data.properties.action_link);
