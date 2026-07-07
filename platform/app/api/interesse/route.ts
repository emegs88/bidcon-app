// POST /api/interesse — captura de lead (nome + WhatsApp) ANTES do chat.
//
// Contrato "já contatável": o front chama este endpoint primeiro (nome +
// telefone), recebe { interesse_id } e só então abre o chat em /api/atende
// passando esse id. Este endpoint NUNCA lida com o conteúdo da conversa.
//
// LEAD ANÔNIMO: sem sessão de usuário. A tabela `interesses` vive no projeto
// Supabase "xtv" — usamos createXtvClient() (service_role, server-only),
// igual ao /api/atende. NÃO usar createAdminClient (é do projeto "nnv").
//
// CORS: mesmo padrão do /api/atende — o widget roda em bidcon.com.br
// (vitrine) e chama app.bidcon.com.br (este endpoint), cross-origin. Auth
// (allowlist de origem + rate-limit) e headers CORS vêm de @/lib/api-guard,
// compartilhados com /api/atende — sem duplicar.
import { NextResponse } from "next/server";
import { createXtvClient } from "@/lib/supabase-xtv";
import {
  origemPermitida,
  rateLimitExcedido,
  ipDe,
  corsHeaders,
  handlePreflight,
} from "@/lib/api-guard";

export const dynamic = "force-dynamic";

// Preflight CORS (bidcon.com.br chamando app.bidcon.com.br).
export async function OPTIONS(req: Request) {
  return handlePreflight(req);
}

export async function POST(req: Request) {
  // AUTH camada 1: só origem confiável (bidcon.com.br / app.bidcon.com.br).
  if (!origemPermitida(req)) {
    return NextResponse.json(
      { erro: "Origem não autorizada." },
      { status: 403, headers: corsHeaders(req) }
    );
  }

  // AUTH camada 2: rate-limit por IP (20 req/min). Estouro -> 429.
  if (rateLimitExcedido(ipDe(req))) {
    return NextResponse.json(
      { erro: "Muitas requisições. Tente novamente em instantes." },
      { status: 429, headers: corsHeaders(req) }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    nome?: unknown;
    telefone?: unknown;
    origem?: unknown;
  };

  const nome = String(body.nome ?? "").trim();
  const telefoneDigitos = String(body.telefone ?? "").replace(/\D/g, "");
  const origem = String(body.origem ?? "").trim() || "chat";

  if (nome.length < 2) {
    return NextResponse.json(
      { erro: "Nome inválido." },
      { status: 400, headers: corsHeaders(req) }
    );
  }
  if (telefoneDigitos.length < 10) {
    return NextResponse.json(
      { erro: "Telefone inválido." },
      { status: 400, headers: corsHeaders(req) }
    );
  }

  const supabase = createXtvClient();

  const { data, error } = await supabase
    .from("interesses")
    .insert({
      nome,
      telefone: telefoneDigitos,
      origem,
      status: "novo",
      intencao: "interesse",
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[interesse] erro ao criar interesse:", error);
    return NextResponse.json(
      { erro: "Não foi possível registrar o interesse." },
      { status: 500, headers: corsHeaders(req) }
    );
  }

  return NextResponse.json(
    { interesse_id: data.id },
    { headers: corsHeaders(req) }
  );
}
