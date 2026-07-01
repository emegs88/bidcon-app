// POST /api/admin/processo/[id]/documento — admin aprova/reprova um documento
// do check-list. A regra e o papel vivem na RPC decidir_documento (0014,
// security definer, ADMIN-ONLY). Aqui basta o client COM RLS (autenticado);
// a RPC valida o papel.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Body = { documento_id?: unknown; status?: unknown; motivo?: unknown };

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const docId = String(body.documento_id ?? "").trim();
  const status = String(body.status ?? "").trim();
  const motivo =
    typeof body.motivo === "string" ? body.motivo.trim().slice(0, 500) : null;

  if (!UUID_RE.test(docId)) {
    return NextResponse.json({ erro: "Documento inválido." }, { status: 422 });
  }
  if (status !== "aprovado" && status !== "reprovado") {
    return NextResponse.json({ erro: "Status inválido." }, { status: 422 });
  }

  const { error } = await supabase.rpc("decidir_documento", {
    p_doc: docId,
    p_status: status,
    p_motivo: motivo,
  });

  if (error) {
    if (error.code === "42501") {
      return NextResponse.json({ erro: "Sem permissão." }, { status: 403 });
    }
    if (error.code === "P0002") {
      return NextResponse.json({ erro: "Documento não encontrado." }, { status: 404 });
    }
    return NextResponse.json({ erro: "Não foi possível decidir o documento." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
