// Cliente Supabase para o SERVIDOR (Server Components / Route Handlers).
// Usa a anon key + cookies da sessão do usuário (continua sujeito à RLS).
// A service_role key NÃO é usada aqui — fica reservada a rotas administrativas
// específicas da Fase 2/3 (mudança de status), nunca exposta ao client.
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export function createClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options?: CookieOptions }[]
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // chamado de um Server Component — ignorável quando há middleware
            // de refresh de sessão. (Fase 1 adiciona middleware.)
          }
        },
      },
    }
  );
}
