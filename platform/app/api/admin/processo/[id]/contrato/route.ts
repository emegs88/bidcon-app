// POST /api/admin/processo/[id]/contrato — admin gera um contrato (serviço/cota)
// do processo. O snapshot factual (qualificação completa do CONTRATANTE —
// nome/CPF/e-mail de `profiles` — + valores; sem administradora/comissão) é
// montado por lib/contratos. A RPC gerar_contrato (0014, security definer)
// aplica o gate: contrato 'cota' exige sinal 'pago'.
//
// Observação: este endpoint (admin) não bloqueia a geração por qualificação
// incompleta — quem exige nome/CPF válidos antes do ACEITE é o cliente, na
// rota /api/processo/contrato (v4/FINAL). Aqui a RPC grava o que houver.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { resumoSinal } from "@/lib/sinal";
import { dadosContratoServico, dadosContratoCota } from "@/lib/contratos";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Body = { tipo?: unknown };

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const processoId = String(params.id ?? "").trim();
  const body = (await req.json().catch(() => ({}))) as Body;
  const tipo = String(body.tipo ?? "").trim();

  if (!UUID_RE.test(processoId)) {
    return NextResponse.json({ erro: "Processo inválido." }, { status: 422 });
  }
  if (tipo !== "servico" && tipo !== "cota") {
    return NextResponse.json({ erro: "Tipo de contrato inválido." }, { status: 422 });
  }

  // snapshot factual — o admin lê nome/CPF/carta via service_role.
  const admin = createAdminClient();
  const { data: processo } = await admin
    .from("processos")
    .select("id, cliente_id, valor_entrada, carta_id")
    .eq("id", processoId)
    .maybeSingle();
  if (!processo) {
    return NextResponse.json({ erro: "Processo não encontrado." }, { status: 404 });
  }
  const proc = processo as {
    cliente_id: string;
    valor_entrada: number | null;
    carta_id: string | null;
  };

  const { data: carta } = proc.carta_id
    ? await admin
        .from("cartas")
        .select("tipo, valor_credito, valor_entrada")
        .eq("id", proc.carta_id)
        .maybeSingle()
    : { data: null };
  // qualificação do CONTRATANTE (nome + CPF + e-mail), fonte única em
  // `profiles` — mesma fonte usada pela rota do cliente (v4/FINAL).
  const { data: profile } = await admin
    .from("profiles")
    .select("nome, cpf, email")
    .eq("id", proc.cliente_id)
    .maybeSingle();

  const c = carta as {
    tipo: string;
    valor_credito: number;
    valor_entrada: number | null;
  } | null;
  const { sinal } = resumoSinal({
    valor_credito: c?.valor_credito ?? null,
    valor_entrada: c?.valor_entrada ?? proc.valor_entrada ?? null,
  });
  const clienteNome = (profile as { nome: string | null } | null)?.nome ?? "";
  const clienteCpf = (profile as { cpf: string | null } | null)?.cpf ?? null;
  const clienteEmail = (profile as { email: string | null } | null)?.email ?? "";

  const dados =
    tipo === "cota" && c
      ? dadosContratoCota({
          clienteNome,
          clienteCpf,
          clienteEmail,
          bemTipo: c.tipo,
          valorCredito: c.valor_credito,
          valorEntrada: c.valor_entrada,
          valorSinal: sinal,
        })
      : dadosContratoServico({ clienteNome, clienteCpf, clienteEmail, valorSinal: sinal });

  // RLS-client chama a RPC; ela revalida o papel (admin OU cliente dono) e o gate.
  const { error } = await supabase.rpc("gerar_contrato", {
    p_processo: processoId,
    p_tipo: tipo,
    p_dados: dados as unknown as Record<string, unknown>,
    p_versao: "v1",
  });

  if (error) {
    if (error.code === "42501") {
      return NextResponse.json({ erro: "Sem permissão." }, { status: 403 });
    }
    if (error.code === "P0002") {
      return NextResponse.json({ erro: "Processo não encontrado." }, { status: 404 });
    }
    const msg = error.message?.includes("sinal_nao_pago")
      ? "O contrato da cota é liberado após a confirmação do sinal."
      : "Não foi possível gerar o contrato.";
    return NextResponse.json({ erro: msg }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
