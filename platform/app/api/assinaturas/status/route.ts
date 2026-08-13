// ============================================================================
// GET /api/assinaturas/status?processo_id=... — de quem o envelope está esperando.
// ----------------------------------------------------------------------------
// Admin-only. Devolve o envelope mais recente do processo e o estado de cada
// signatário, que é a pergunta real da operação: "já assinaram? falta quem?".
//
// O QUE NÃO SAI DAQUI, DE PROPÓSITO:
//   • `link_assinatura` — URL-CAPACIDADE: quem tem o link assina no lugar da
//     pessoa. Ele existe no banco sob is_admin() e não tem por que trafegar numa
//     resposta de consulta. Foi por isso que a 0072 removeu a policy de select
//     do cliente em assinatura_signatarios.
//   • `cpf_cnpj` — status não precisa de documento para responder "falta quem".
//     Dado que não sai é dado que não vaza.
// ============================================================================
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const { data: perfil } = await supabase
    .from("profiles")
    .select("tipo")
    .eq("id", user.id)
    .maybeSingle();
  if (!perfil || perfil.tipo !== "admin") {
    return NextResponse.json({ erro: "Sem permissão." }, { status: 403 });
  }

  const processoId = (
    new URL(req.url).searchParams.get("processo_id") ?? ""
  ).trim();
  if (!UUID_RE.test(processoId)) {
    return NextResponse.json({ erro: "Processo inválido." }, { status: 422 });
  }

  const admin = createAdminClient();

  const { data: envelope } = await admin
    .from("assinatura_envelopes")
    .select("id, provedor, status, enviado_em, concluido_em, criado_em")
    .eq("processo_id", processoId)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  const env = envelope as
    | {
        id: string;
        provedor: string;
        status: string;
        enviado_em: string | null;
        concluido_em: string | null;
        criado_em: string;
      }
    | null;

  // Processo sem envelope não é erro: é o estado normal antes do primeiro envio.
  if (!env) {
    return NextResponse.json({ status: "sem_envelope", signatarios: [] });
  }

  const { data: signatarios } = await admin
    .from("assinatura_signatarios")
    .select("papel, nome, status, ordem, assinado_em")
    .eq("envelope_id", env.id)
    .order("ordem", { ascending: true });

  return NextResponse.json({
    status: env.status,
    envelope_id: env.id,
    provedor: env.provedor,
    enviado_em: env.enviado_em,
    concluido_em: env.concluido_em,
    signatarios: signatarios ?? [],
  });
}
