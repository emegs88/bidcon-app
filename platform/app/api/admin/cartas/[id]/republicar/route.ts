// POST /api/admin/cartas/[id]/republicar — corrige os 4 valores de uma carta
// em quarentena (fila de revisão) e tenta republicar. FATIA F1.
// Gate: checarAdminConsoleApi(). Dados sempre no xtv (createXtvClient).
// ----------------------------------------------------------------------------
// Não deixa "forçar" publicação de dado ainda degenerado: recalcula a TIR com
// os valores corrigidos ANTES de gravar; se ainda estiver abaixo do piso
// (mesma constante 0,30% a.m. da trigger bidcon_price_calcular, migration
// 0033) ou não for calculável, responde erro e não grava nada.
//
// Se a TIR estiver ok, grava as 5 colunas observadas pela trigger
// (tipo/valor_credito/valor_entrada/valor_parcela/qtd_parcelas) + força
// status='disponivel' no mesmo UPDATE — a trigger recalcula preço/ágio e a
// carta sai da fila de revisão (bidcon_custo_am deixa de ser nulo).
import { NextResponse } from "next/server";
import { checarAdminConsoleApi } from "@/lib/admin-console";
import { createXtvClient } from "@/lib/supabase-xtv";

export const dynamic = "force-dynamic";

const PISO_TIR = 0.003; // 0,30% a.m. — mesma constante da trigger (migration 0033/0034)

function numeroPositivo(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

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

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return NextResponse.json({ erro: "corpo inválido (esperado JSON)." }, { status: 400 });
  }
  const r = (corpo ?? {}) as Record<string, unknown>;

  const tipo = typeof r.tipo === "string" && (r.tipo === "imovel" || r.tipo === "veiculo") ? r.tipo : null;
  const credito = numeroPositivo(r.valor_credito);
  const entrada = numeroPositivo(r.valor_entrada);
  const parcela = numeroPositivo(r.valor_parcela);
  const parcelasBruto = typeof r.qtd_parcelas === "number" ? r.qtd_parcelas : Number(r.qtd_parcelas);
  const parcelas = Number.isFinite(parcelasBruto) && parcelasBruto > 0 ? Math.round(parcelasBruto) : null;

  if (!tipo || credito == null || entrada == null || parcela == null || parcelas == null) {
    return NextResponse.json(
      { erro: "campos obrigatórios ausentes ou inválidos (tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas)." },
      { status: 400 }
    );
  }
  if (entrada >= credito) {
    return NextResponse.json({ erro: "valor_entrada deve ser menor que valor_credito." }, { status: 400 });
  }

  const supabase = createXtvClient();

  const { data: tirData, error: erroTir } = await supabase.rpc("bidcon_tir_mensal", {
    p_credito: credito,
    p_entrada: entrada,
    p_parcela: parcela,
    p_prazo: parcelas,
  });
  if (erroTir) {
    console.error("[admin/cartas/republicar] falha ao calcular TIR:", erroTir);
    return NextResponse.json({ erro: "não foi possível calcular a TIR." }, { status: 500 });
  }
  const tir = tirData == null ? null : Number(tirData);
  if (tir == null || !Number.isFinite(tir) || tir < PISO_TIR) {
    return NextResponse.json(
      { erro: "valores corrigidos ainda geram TIR abaixo do piso de plausibilidade (0,30% a.m.) — não publicado." },
      { status: 422 }
    );
  }

  const { error: erroUpdate } = await supabase
    .from("cartas")
    .update({
      tipo,
      valor_credito: credito,
      valor_entrada: entrada,
      valor_parcela: parcela,
      qtd_parcelas: parcelas,
      status: "disponivel",
    })
    .eq("id", id);
  if (erroUpdate) {
    console.error("[admin/cartas/republicar] falha ao gravar:", erroUpdate);
    return NextResponse.json({ erro: "não foi possível atualizar a carta." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
