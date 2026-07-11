// POST /api/admin/cartas/[id]/descartar — remove permanentemente uma carta
// da fila de revisão sem tentar corrigi-la. FATIA F1.
// Gate: checarAdminConsoleApi(). Dados sempre no xtv (createXtvClient).
// ----------------------------------------------------------------------------
// IMPORTANTE: o UPDATE abaixo NUNCA inclui nenhuma das 5 colunas observadas
// pela trigger bidcon_price_calcular (tipo/valor_credito/valor_entrada/
// valor_parcela/qtd_parcelas) — se incluísse, a trigger dispararia de novo e
// recalcularia bidcon_price_em/bidcon_custo_am, desfazendo os nulls e
// potencialmente devolvendo a carta pra fila. Só toca em status e nos campos
// de preço/ágio, que a trigger não observa.
import { NextResponse } from "next/server";
import { checarAdminConsoleApi } from "@/lib/admin-console";
import { createXtvClient } from "@/lib/supabase-xtv";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const acesso = await checarAdminConsoleApi();
  if (!acesso.ok) {
    return NextResponse.json({ erro: acesso.motivo }, { status: acesso.status });
  }

  const id = params.id;
  if (!id) {
    return NextResponse.json({ erro: "id é obrigatório." }, { status: 400 });
  }

  const supabase = createXtvClient();

  const { error } = await supabase
    .from("cartas")
    .update({
      status: "indisponivel",
      bidcon_price_em: null,
      bidcon_agio_120: null,
      bidcon_agio_150: null,
    })
    .eq("id", id);
  if (error) {
    console.error("[admin/cartas/descartar] falha ao gravar:", error);
    return NextResponse.json({ erro: "não foi possível descartar a carta." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
