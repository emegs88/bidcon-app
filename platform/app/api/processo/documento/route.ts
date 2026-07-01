// POST /api/processo/documento — cliente envia um documento do check-list.
// Recebe FormData(processo_id, checklist_item_id, arquivo). O arquivo sobe ao
// bucket PRIVADO `processo-docs` no prefixo '{processo_id}/...' e os metadados
// entram em `processo_documentos` (status nasce 'pendente'; veredito é RPC admin).
//
// Padrão das rotas privilegiadas:
//   1) createClient() (anon+RLS) identifica o chamador (precisa estar logado);
//   2) confirma que o processo é DELE (cliente_id = user) antes de qualquer escrita;
//   3) revalida MIME/tamanho no servidor (a checagem no client é só UX);
//   4) createAdminClient() (service_role) sobe o arquivo e grava os metadados.
//
// LGPD: bucket privado; leitura só por signed URL server-side. Nada em URL pública.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { validarArquivo } from "@/lib/kyc";

export const dynamic = "force-dynamic";

const BUCKET = "processo-docs";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// extensão segura a partir do MIME (evita usar o nome do arquivo do cliente).
function extDoMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "application/pdf":
      return "pdf";
    default:
      return "bin";
  }
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }

  const processoId = String(form.get("processo_id") ?? "").trim();
  const itemId = String(form.get("checklist_item_id") ?? "").trim();
  const arquivo = form.get("arquivo");

  if (!UUID_RE.test(processoId) || !UUID_RE.test(itemId)) {
    return NextResponse.json({ erro: "Identificadores inválidos." }, { status: 422 });
  }
  if (!(arquivo instanceof File)) {
    return NextResponse.json({ erro: "Arquivo ausente." }, { status: 422 });
  }

  // revalida MIME/tamanho no servidor (permite PDF, como documento).
  const val = validarArquivo({ size: arquivo.size, type: arquivo.type }, true);
  if (!val.ok) {
    return NextResponse.json({ erro: val.erro }, { status: 422 });
  }

  // confirma que o processo é do próprio cliente (RLS já filtra, mas checamos
  // explicitamente para não subir arquivo de processo alheio).
  const { data: processo } = await supabase
    .from("processos")
    .select("id")
    .eq("id", processoId)
    .eq("cliente_id", user.id)
    .maybeSingle();
  if (!processo) {
    return NextResponse.json({ erro: "Processo não encontrado." }, { status: 404 });
  }

  const admin = createAdminClient();
  const nome = `${itemId}-${Date.now()}.${extDoMime(arquivo.type)}`;
  const path = `${processoId}/${nome}`;

  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const up = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: arquivo.type,
    upsert: false,
  });
  if (up.error) {
    return NextResponse.json(
      { erro: "Falha ao armazenar o documento." },
      { status: 400 }
    );
  }

  const { error } = await admin.from("processo_documentos").insert({
    processo_id: processoId,
    checklist_item_id: itemId,
    path,
    status: "pendente",
  });
  if (error) {
    // limpeza best-effort do arquivo órfão se o metadado não gravou.
    await admin.storage.from(BUCKET).remove([path]);
    return NextResponse.json(
      { erro: "Não foi possível registrar o documento." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
