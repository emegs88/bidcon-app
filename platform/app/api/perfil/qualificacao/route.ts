// POST /api/perfil/qualificacao — cliente confirma nome completo + CPF antes
// de poder aceitar o contrato de serviço (lib/contratos.ts exige qualificação
// completa do CONTRATANTE). Independente do fluxo de KYC (kyc_perfis), que
// segue verificando documento/selfie separadamente.
//
// Padrão das rotas privilegiadas:
//   1) createClient() (anon+RLS) identifica o chamador (precisa estar logado);
//   2) revalida nome/CPF no servidor (não confia no client);
//   3) update em profiles — RLS profiles_update_self (migration 0002) já
//      restringe ao próprio id; não precisa de service_role aqui.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { cpfValido, soDigitos } from "@/lib/kyc";

export const dynamic = "force-dynamic";

type Body = {
  nome?: unknown;
  cpf?: unknown;
};

function txt(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;

  const nome = txt(body.nome);
  if (nome.length < 2) {
    return NextResponse.json({ erro: "Informe seu nome completo." }, { status: 422 });
  }

  const cpf = soDigitos(txt(body.cpf));
  if (!cpfValido(cpf)) {
    return NextResponse.json({ erro: "CPF inválido." }, { status: 422 });
  }

  const { error } = await supabase
    .from("profiles")
    .update({ nome, cpf })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json(
      { erro: "Não foi possível salvar seus dados." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
