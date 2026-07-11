// POST /api/admin/importar/preview — analisa um lote (arquivo CSV ou texto
// colado) contra o estoque atual e devolve o diff por categoria, SEM gravar
// nada. FATIA F1. Gate: checarAdminConsoleApi(). Dados sempre no xtv.
// ----------------------------------------------------------------------------
// Corpo aceito: multipart/form-data com campos `arquivo` (File) + `fornecedor_id`,
// OU application/json com { texto, fornecedor_id } (texto colado).
import { NextResponse } from "next/server";
import { checarAdminConsoleApi } from "@/lib/admin-console";
import { createXtvClient } from "@/lib/supabase-xtv";
import { parsearArquivoImportacao, parsearTextoColado, type LeituraImportador } from "@/lib/importador-source";
import { analisarLote } from "@/lib/importador-preview";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const acesso = await checarAdminConsoleApi();
  if (!acesso.ok) {
    return NextResponse.json({ erro: acesso.motivo }, { status: acesso.status });
  }

  const contentType = req.headers.get("content-type") ?? "";
  let fornecedorId: string | null = null;
  let leitura: LeituraImportador;

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const fid = form.get("fornecedor_id");
      fornecedorId = typeof fid === "string" ? fid : null;
      const arquivo = form.get("arquivo");
      if (!(arquivo instanceof File)) {
        return NextResponse.json({ erro: "arquivo ausente (campo 'arquivo')." }, { status: 400 });
      }
      const buffer = await arquivo.arrayBuffer();
      leitura = parsearArquivoImportacao(buffer, arquivo.name);
    } else {
      const corpo = (await req.json()) as unknown;
      const r = (corpo ?? {}) as Record<string, unknown>;
      fornecedorId = typeof r.fornecedor_id === "string" ? r.fornecedor_id : null;
      const texto = typeof r.texto === "string" ? r.texto : "";
      leitura = parsearTextoColado(texto);
    }
  } catch {
    return NextResponse.json({ erro: "corpo da requisição inválido." }, { status: 400 });
  }

  if (!fornecedorId) {
    return NextResponse.json({ erro: "fornecedor_id é obrigatório." }, { status: 400 });
  }
  if (leitura.linhas.length === 0) {
    return NextResponse.json(
      { erro: "nenhuma linha reconhecida no lote.", avisos: leitura.avisos },
      { status: 422 }
    );
  }

  try {
    const supabase = createXtvClient();
    const { linhas, resumo } = await analisarLote(supabase, fornecedorId, leitura.linhas);
    return NextResponse.json({ ok: true, linhas, resumo, avisos: leitura.avisos });
  } catch (e) {
    console.error("[admin/importar/preview] falha na análise:", e);
    return NextResponse.json({ erro: "falha ao analisar o lote." }, { status: 500 });
  }
}
