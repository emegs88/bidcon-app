// Troca o código do magic link por uma sessão e redireciona para a home (ou
// para `next`, se informado — usado pelo link de acesso gerado pelo admin em
// /api/admin/processos/[id]/gerar-acesso, que manda o cliente pro próprio
// /meu-processo em vez da home).
// Grava os cookies da sessão DIRETO na resposta de redirect — assim o
// navegador já recebe a sessão e o middleware a mantém nas próximas páginas.
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // `next` só é aceito se for caminho relativo (evita open-redirect via
  // parâmetro controlado por quem recebe o link) — "//host" também é
  // rejeitado, pois o navegador trata como protocolo-relativo.
  const nextParam = searchParams.get("next");
  const destino =
    nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
      ? nextParam
      : "/";
  const response = NextResponse.redirect(`${origin}${destino}`);

  if (code) {
    const cookieStore = cookies();
    const supabase = createServerClient(
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
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            );
          },
        },
      }
    );
    await supabase.auth.exchangeCodeForSession(code);
  }

  return response;
}
