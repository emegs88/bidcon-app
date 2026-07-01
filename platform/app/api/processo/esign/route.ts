// POST /api/processo/esign — inicia a assinatura eletrônica de um contrato.
// Modo plugável: sem ESIGN_PROVIDER, devolve { status: 'nao_configurado' } e o
// aceite continua sendo registrado pela rota /api/processo/contrato (fallback
// manual server-side). Com provedor (Clicksign/DocuSign/D4Sign, quando definido
// e autorizado), aqui criaríamos o envelope/assinatura ICP/eIDAS e devolveríamos
// a URL de assinatura para o cliente.
//
// Padrão: anon+RLS identifica o chamador → confirma que o contrato é do processo
// DELE → (com provedor) inicia a assinatura. Sem provedor, não muda estado.
//
// COMPLIANCE: o corpo do contrato já foi sanitizado no servidor (lib/contratos);
// esta rota não injeta administradora/comissão. LGPD: nada em URL pública.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Body = {
  processo_id?: unknown;
  tipo?: unknown; // 'servico' | 'cota'
};

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const processoId = String(body.processo_id ?? "").trim();
  const tipo = String(body.tipo ?? "").trim();

  if (!UUID_RE.test(processoId)) {
    return NextResponse.json({ erro: "Processo inválido." }, { status: 422 });
  }
  if (tipo !== "servico" && tipo !== "cota") {
    return NextResponse.json({ erro: "Tipo de contrato inválido." }, { status: 422 });
  }

  // confirma que o processo é do próprio cliente.
  const { data: processo } = await supabase
    .from("processos")
    .select("id")
    .eq("id", processoId)
    .eq("cliente_id", user.id)
    .maybeSingle();
  if (!processo) {
    return NextResponse.json({ erro: "Processo não encontrado." }, { status: 404 });
  }

  // localiza o contrato do tipo pedido (o mais recente).
  const admin = createAdminClient();
  const { data: contrato } = await admin
    .from("contratos")
    .select("id, status")
    .eq("processo_id", processoId)
    .eq("tipo", tipo)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  const contratoId = (contrato as { id: string } | null)?.id ?? null;
  if (!contratoId) {
    return NextResponse.json(
      { erro: "Gere o contrato antes de assinar." },
      { status: 422 }
    );
  }

  // Sem provedor de assinatura => o aceite é feito pela rota /contrato (manual).
  if (!process.env.ESIGN_PROVIDER) {
    return NextResponse.json({ status: "nao_configurado" });
  }

  // provedor configurado: ponto de integração — criar envelope e marcar 'enviado'.
  const { error } = await admin
    .from("contratos")
    .update({ status: "enviado" })
    .eq("id", contratoId)
    .eq("processo_id", processoId);
  if (error) {
    return NextResponse.json(
      { erro: "Não foi possível iniciar a assinatura." },
      { status: 400 }
    );
  }
  return NextResponse.json({ status: "enviado" });
}
