// POST /api/kyc/enviar — recebe os metadados do KYC do cliente e grava.
// O upload dos arquivos já foi feito direto ao Storage privado pelo client
// (prefixo '{uid}/...'); aqui só validamos e persistimos os metadados + paths.
// Padrão das rotas privilegiadas:
//   1) createClient() (anon+RLS) identifica o chamador (precisa estar logado);
//   2) revalida os dados no servidor (não confia no client);
//   3) createAdminClient() (service_role) faz o upsert em kyc_perfis e registra
//      o evento — campos de VEREDITO não são tocados aqui (status vai 'em_analise').
// Sem dado bancário; nada aqui promete crédito ou contemplação.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { cpfValido, soDigitos } from "@/lib/kyc";

export const dynamic = "force-dynamic";

type Endereco = {
  cep?: unknown;
  logradouro?: unknown;
  numero?: unknown;
  complemento?: unknown;
  bairro?: unknown;
  cidade?: unknown;
  uf?: unknown;
};

type Body = {
  cpf?: unknown;
  nascimento?: unknown;
  doc_tipo?: unknown;
  endereco?: Endereco;
  doc_path?: unknown;
  selfie_path?: unknown;
  renda_path?: unknown;
};

const DOC_TIPOS = ["cnh", "rg"] as const;

// Garante que o path enviado pertence ao próprio usuário ('{uid}/...').
function pathDoDono(path: unknown, uid: string): string | null {
  if (typeof path !== "string" || !path) return null;
  if (path.split("/")[0] !== uid) return null;
  return path;
}

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
  const uid = user.id;

  // Não permite reenvio quando já está em análise/verificado/bloqueado.
  const { data: atual } = await supabase
    .from("kyc_perfis")
    .select("status_kyc")
    .eq("user_id", uid)
    .maybeSingle();
  const st = atual?.status_kyc as string | undefined;
  if (st && st !== "pendente" && st !== "rejeitado") {
    return NextResponse.json(
      { erro: "Verificação já enviada." },
      { status: 409 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as Body;

  // ----- validações de servidor -----
  const cpf = soDigitos(txt(body.cpf));
  if (!cpfValido(cpf)) {
    return NextResponse.json({ erro: "CPF inválido." }, { status: 422 });
  }

  const nascimento = txt(body.nascimento);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nascimento)) {
    return NextResponse.json(
      { erro: "Data de nascimento inválida." },
      { status: 422 }
    );
  }

  const docTipo = txt(body.doc_tipo);
  if (!(DOC_TIPOS as readonly string[]).includes(docTipo)) {
    return NextResponse.json({ erro: "Tipo de documento inválido." }, { status: 422 });
  }

  const docPath = pathDoDono(body.doc_path, uid);
  const selfiePath = pathDoDono(body.selfie_path, uid);
  const rendaPath = pathDoDono(body.renda_path, uid);
  if (!docPath || !selfiePath || !rendaPath) {
    return NextResponse.json(
      { erro: "Arquivos ausentes ou inválidos." },
      { status: 422 }
    );
  }

  const e = body.endereco ?? {};
  const endereco = {
    cep: soDigitos(txt(e.cep)),
    logradouro: txt(e.logradouro),
    numero: txt(e.numero),
    complemento: txt(e.complemento),
    bairro: txt(e.bairro),
    cidade: txt(e.cidade),
    uf: txt(e.uf).toUpperCase().slice(0, 2),
  };
  if (
    endereco.cep.length !== 8 ||
    !endereco.logradouro ||
    !endereco.numero ||
    !endereco.bairro ||
    !endereco.cidade ||
    endereco.uf.length !== 2
  ) {
    return NextResponse.json({ erro: "Endereço incompleto." }, { status: 422 });
  }

  // ----- escrita privilegiada (service_role) -----
  const admin = createAdminClient();
  const { error } = await admin.from("kyc_perfis").upsert(
    {
      user_id: uid,
      cpf,
      nascimento,
      doc_tipo: docTipo,
      endereco,
      doc_path: docPath,
      selfie_path: selfiePath,
      renda_path: rendaPath,
      status_kyc: "em_analise",
      ocr_status: "pendente",
      motivo_rejeicao: null,
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    return NextResponse.json(
      { erro: "Não foi possível salvar a verificação." },
      { status: 400 }
    );
  }

  await admin.from("kyc_eventos").insert({
    user_id: uid,
    ator_id: uid,
    evento: "kyc_enviado",
    detalhe: null,
  });

  // ----- camada plugável de OCR/IA (env-gated; falha não bloqueia o envio) -----
  // Disparo "fire-and-forget": se os provedores não estiverem configurados,
  // os endpoints respondem 'nao_configurado' e o admin verifica manualmente.
  const origem = new URL(req.url).origin;
  void Promise.allSettled([
    fetch(`${origem}/api/kyc/ocr`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: uid }),
    }),
    fetch(`${origem}/api/kyc/face`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: uid }),
    }),
  ]);

  return NextResponse.json({ ok: true });
}
