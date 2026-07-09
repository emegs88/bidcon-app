// POST /api/processo/contrato — cliente gera/aceita um contrato do processo.
// Ordem jurídica: SERVIÇO → PIX → COTA.
//   tipo 'servico', acao 'aceitar'  → gera (se preciso) e registra o aceite.
//   tipo 'cota',    acao 'gerar'    → RPC gerar_contrato (gate: sinal 'pago').
//   tipo 'cota',    acao 'aceitar'  → registra o aceite do contrato da cota.
//
// Sem ESIGN_PROVIDER, o aceite é registrado server-side (fallback manual):
// grava status 'assinado' + assinado_em. Com provedor, o fluxo de assinatura
// eletrônica é iniciado por /api/processo/esign (rota à parte).
//
// COMPLIANCE: o snapshot `dados` (jsonb) é montado por lib/contratos, que NÃO
// inclui administradora/taxa/comissão. A geração via RPC gerar_contrato já
// aplica o gate do sinal para a cota.
//
// QUALIFICAÇÃO COMPLETA (v4/FINAL): nome/CPF/e-mail vêm de `profiles` (não
// mais de kyc_perfis — o KYC de documento/selfie é verificação à parte e não
// é pré-requisito do contrato). Toda 'aceitar' exige nome preenchido e CPF
// válido (dígito verificador) — gate server-side; a UI (ContratoServico +
// QualificacaoGate) já bloqueia antes, mas o servidor é a barreira real.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { resumoSinal } from "@/lib/sinal";
import { cpfValido } from "@/lib/kyc";
import {
  dadosContratoServico,
  dadosContratoCota,
} from "@/lib/contratos";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Body = {
  processo_id?: unknown;
  tipo?: unknown; // 'servico' | 'cota'
  acao?: unknown; // 'gerar' | 'aceitar'
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
  const acao = String(body.acao ?? "").trim();

  if (!UUID_RE.test(processoId)) {
    return NextResponse.json({ erro: "Processo inválido." }, { status: 422 });
  }
  if (tipo !== "servico" && tipo !== "cota") {
    return NextResponse.json({ erro: "Tipo de contrato inválido." }, { status: 422 });
  }
  if (acao !== "gerar" && acao !== "aceitar") {
    return NextResponse.json({ erro: "Ação inválida." }, { status: 422 });
  }

  // confirma dono do processo + carrega o mínimo necessário p/ o snapshot.
  const { data: processo } = await supabase
    .from("processos")
    .select("id, valor_entrada, carta_id")
    .eq("id", processoId)
    .eq("cliente_id", user.id)
    .maybeSingle();
  if (!processo) {
    return NextResponse.json({ erro: "Processo não encontrado." }, { status: 404 });
  }

  const admin = createAdminClient();

  // ----- qualificação do CONTRATANTE (nome + CPF + e-mail), fonte única em
  // `profiles`. Toda ação 'aceitar' exige nome preenchido e CPF válido. -----
  const { data: profileRow } = await admin
    .from("profiles")
    .select("nome, cpf, email")
    .eq("id", user.id)
    .maybeSingle();
  const clienteNome = (profileRow as { nome: string | null } | null)?.nome?.trim() ?? "";
  const clienteCpf = (profileRow as { cpf: string | null } | null)?.cpf ?? null;
  const clienteEmail = (profileRow as { email: string | null } | null)?.email ?? "";

  if (acao === "aceitar" && (!clienteNome || !cpfValido(clienteCpf))) {
    return NextResponse.json(
      { erro: "Preencha nome completo e CPF antes de aceitar." },
      { status: 422 }
    );
  }

  // ----- COTA + gerar: delega o gate (sinal pago) à RPC gerar_contrato -----
  if (tipo === "cota" && acao === "gerar") {
    // snapshot factual da cota (qualificação completa do CONTRATANTE).
    const { data: carta } = processo.carta_id
      ? await admin
          .from("cartas")
          .select("tipo, valor_credito, valor_entrada")
          .eq("id", processo.carta_id)
          .maybeSingle()
      : { data: null };
    if (!carta) {
      return NextResponse.json({ erro: "Carta não vinculada." }, { status: 422 });
    }

    const c = carta as {
      tipo: string;
      valor_credito: number;
      valor_entrada: number | null;
    };
    const { sinal } = resumoSinal({
      valor_credito: c.valor_credito,
      valor_entrada: c.valor_entrada ?? processo.valor_entrada ?? null,
    });
    const dados = dadosContratoCota({
      clienteNome,
      clienteCpf,
      clienteEmail,
      bemTipo: c.tipo,
      valorCredito: c.valor_credito,
      valorEntrada: c.valor_entrada,
      valorSinal: sinal,
    });

    // a RPC aplica o gate: cota exige pagamentos_sinal.status='pago'.
    const { error } = await supabase.rpc("gerar_contrato", {
      p_processo: processoId,
      p_tipo: "cota",
      p_dados: dados as unknown as Record<string, unknown>,
      p_versao: "v1",
    });
    if (error) {
      const msg =
        error.message?.includes("sinal_nao_pago")
          ? "O contrato da cota é liberado após a confirmação do sinal."
          : "Não foi possível gerar o contrato da cota.";
      return NextResponse.json({ erro: msg }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  // ----- SERVIÇO + aceitar: gera (se preciso) e registra o aceite -----
  if (tipo === "servico" && acao === "aceitar") {
    // já existe um contrato de serviço? (idempotência do aceite)
    const { data: existente } = await admin
      .from("contratos")
      .select("id, status")
      .eq("processo_id", processoId)
      .eq("tipo", "servico")
      .order("criado_em", { ascending: false })
      .limit(1)
      .maybeSingle();

    let contratoId = (existente as { id: string } | null)?.id ?? null;

    if (!contratoId) {
      // snapshot do serviço (qualificação completa + valor do sinal 2% do crédito).
      const { data: carta } = processo.carta_id
        ? await admin
            .from("cartas")
            .select("valor_credito, valor_entrada")
            .eq("id", processo.carta_id)
            .maybeSingle()
        : { data: null };

      const cc = carta as {
        valor_credito: number;
        valor_entrada: number | null;
      } | null;
      const { sinal } = resumoSinal({
        valor_credito: cc?.valor_credito ?? null,
        valor_entrada: cc?.valor_entrada ?? processo.valor_entrada ?? null,
      });
      const dados = dadosContratoServico({
        clienteNome,
        clienteCpf,
        clienteEmail,
        valorSinal: sinal,
      });

      const { data: novo, error: gerErr } = await supabase.rpc("gerar_contrato", {
        p_processo: processoId,
        p_tipo: "servico",
        p_dados: dados as unknown as Record<string, unknown>,
        p_versao: "v1",
      });
      if (gerErr || !novo) {
        return NextResponse.json(
          { erro: "Não foi possível gerar o contrato de serviço." },
          { status: 400 }
        );
      }
      contratoId = String(novo);
    }

    // registra o aceite (fallback manual, sem provedor de assinatura).
    const { error: upErr } = await admin
      .from("contratos")
      .update({ status: "assinado", assinado_em: new Date().toISOString() })
      .eq("id", contratoId)
      .eq("processo_id", processoId);
    if (upErr) {
      return NextResponse.json(
        { erro: "Não foi possível registrar o aceite." },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true });
  }

  // ----- COTA + aceitar: registra o aceite do contrato da cota já gerado -----
  if (tipo === "cota" && acao === "aceitar") {
    const { data: contrato } = await admin
      .from("contratos")
      .select("id")
      .eq("processo_id", processoId)
      .eq("tipo", "cota")
      .order("criado_em", { ascending: false })
      .limit(1)
      .maybeSingle();
    const contratoId = (contrato as { id: string } | null)?.id ?? null;
    if (!contratoId) {
      return NextResponse.json(
        { erro: "Gere o contrato da cota antes de aceitar." },
        { status: 422 }
      );
    }
    const { error } = await admin
      .from("contratos")
      .update({ status: "assinado", assinado_em: new Date().toISOString() })
      .eq("id", contratoId)
      .eq("processo_id", processoId);
    if (error) {
      return NextResponse.json(
        { erro: "Não foi possível registrar o aceite." },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ erro: "Combinação não suportada." }, { status: 422 });
}
