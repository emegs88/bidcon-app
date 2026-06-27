// Middleware do Next: renova a sessão Supabase em toda navegação, garantindo
// que o cookie de sessão criado no /auth/callback persista. Sem isto, o login
// por magic link "voltava" para a tela de e-mail (sessão não era mantida).
import { type NextRequest } from "next/server";
import { atualizarSessao } from "@/lib/supabase-middleware";

export async function middleware(request: NextRequest) {
  return atualizarSessao(request);
}

export const config = {
  // Roda em todas as rotas, exceto assets estáticos e imagens.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
