// GET/POST /api/admin/fornecedores — CRUD leve de fornecedores (FATIA F1).
// ----------------------------------------------------------------------------
// Gate: checarAdminConsoleApi() (allowlist BIDCON_ADMIN_EMAILS). Dados sempre
// no xtv (createXtvClient, via lib/fornecedores-xtv.ts) — nunca no nnv, que
// tem sua PRÓPRIA tabela `fornecedores` (schema diferente, não relacionada).
//
// GET  -> lista fornecedores ativos (popular o <select> do form de importar).
// POST -> cria um fornecedor novo (uso: "criar novo" inline no form).
import { NextResponse } from "next/server";
import { checarAdminConsoleApi } from "@/lib/admin-console";
import { listarFornecedoresAtivos, criarFornecedor } from "@/lib/fornecedores-xtv";

export const dynamic = "force-dynamic";

export async function GET() {
  const acesso = await checarAdminConsoleApi();
  if (!acesso.ok) {
    return NextResponse.json({ erro: acesso.motivo }, { status: acesso.status });
  }
  try {
    const fornecedores = await listarFornecedoresAtivos();
    return NextResponse.json({ ok: true, fornecedores });
  } catch {
    return NextResponse.json({ erro: "Não foi possível listar fornecedores." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const acesso = await checarAdminConsoleApi();
  if (!acesso.ok) {
    return NextResponse.json({ erro: acesso.motivo }, { status: acesso.status });
  }

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return NextResponse.json({ erro: "Corpo inválido (esperado JSON)." }, { status: 400 });
  }
  const r = (corpo ?? {}) as Record<string, unknown>;
  const nome = typeof r.nome === "string" ? r.nome.trim() : "";
  if (!nome) {
    return NextResponse.json({ erro: "Nome do fornecedor é obrigatório." }, { status: 400 });
  }

  try {
    const fornecedor = await criarFornecedor({
      nome,
      contato_nome: typeof r.contato_nome === "string" ? r.contato_nome : null,
      whatsapp: typeof r.whatsapp === "string" ? r.whatsapp : null,
      email: typeof r.email === "string" ? r.email : null,
      observacoes: typeof r.observacoes === "string" ? r.observacoes : null,
    });
    return NextResponse.json({ ok: true, fornecedor });
  } catch {
    return NextResponse.json({ erro: "Não foi possível criar o fornecedor." }, { status: 500 });
  }
}
