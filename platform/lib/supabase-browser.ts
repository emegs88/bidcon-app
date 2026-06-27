// Cliente Supabase para o BROWSER (usa apenas a anon key, pública).
// RLS protege os dados — a anon key não dá acesso a nada que a policy não permita.
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
