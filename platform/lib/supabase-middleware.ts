// Refresh de sessão para o middleware (roda em toda navegação).
// Lê os cookies da requisição, deixa o supabase-ssr renovar o token quando
// preciso e GRAVA os cookies atualizados na resposta — é isso que faltava na
// Fase 1 e causava o loop de login (sessão nunca persistia após o magic link).
// Continua usando só a anon key; RLS protege os dados.
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function atualizarSessao(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options?: CookieOptions }[]
        ) {
          // grava em ambos: na request (para handlers a jusante) e na response
          // (para o navegador receber o cookie de sessão renovado).
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Toca a sessão para forçar o refresh do token quando necessário.
  await supabase.auth.getUser();

  return response;
}
