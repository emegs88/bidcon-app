// ============================================================================
// Cron de sync de cotas — roda 1x/hora (Vercel Cron). Server-only.
// ----------------------------------------------------------------------------
// Fluxo:
//   1) autoriza (CRON_SECRET) — ninguém dispara isto de fora;
//   2) lê a contagem boa anterior (cartas do sync ainda disponíveis);
//   3) lerCotasFonte() roda as 5 GUARDAS (HTTP/timeout/parse/volume);
//      se abortar, REGISTRA o motivo e NÃO toca no estoque;
//   4) chama a RPC ATÔMICA sync_aplicar_cotas() (upsert + marca ausentes),
//      tudo numa transação no Postgres (rollback automático em erro);
//   5) carta nova já nasce com evento push_pendente=true (gatilho do OneSignal,
//      hoje stub — ver lib/notificar.ts).
//
// service_role: usada só aqui (lib/supabase-admin), via env var protegida.
// ============================================================================
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { lerCotasFonte } from "@/lib/cotas-source";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function autorizado(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // sem secret configurado => não roda
  // Vercel Cron manda Authorization: Bearer <CRON_SECRET>
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!autorizado(req)) {
    return NextResponse.json({ ok: false, erro: "nao_autorizado" }, { status: 401 });
  }

  const db = createAdminClient();

  // (2) contagem boa anterior: cotas do sync ainda disponíveis
  const { count: anterior, error: errCount } = await db
    .from("cartas")
    .select("id", { count: "exact", head: true })
    .eq("fonte", "360prospere")
    .eq("status", "disponivel");

  if (errCount) {
    return NextResponse.json(
      { ok: false, etapa: "contagem", erro: errCount.message },
      { status: 500 }
    );
  }
  const contagemAnterior = anterior ?? 0;

  // (3) as 5 guardas
  const leitura = await lerCotasFonte(contagemAnterior);
  if (!leitura.ok) {
    // aborta SEM escrever no estoque; só registra o motivo para auditoria
    await db.from("eventos_sync").insert({
      tipo: "sync_abortado",
      detalhe: leitura.motivo,
    });
    return NextResponse.json(
      { ok: false, abortado: true, motivo: leitura.motivo, contagemAnterior },
      { status: 200 } // 200: o cron rodou e protegeu o estoque de propósito
    );
  }

  // (4) transação atômica no Postgres
  const payload = leitura.cotas.map((c) => ({
    numero: c.numero,
    tipo: c.tipo,
    valor_credito: c.valorCredito,
    valor_entrada: c.valorEntrada,
    valor_parcela: c.valorParcela,
    qtd_parcelas: c.qtdParcelas,
  }));

  const { data, error } = await db.rpc("sync_aplicar_cotas", { p_cotas: payload });
  if (error) {
    await db.from("eventos_sync").insert({
      tipo: "sync_abortado",
      detalhe: "rpc_falhou: " + error.message,
    });
    return NextResponse.json(
      { ok: false, etapa: "rpc", erro: error.message },
      { status: 500 }
    );
  }

  const r = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({
    ok: true,
    lidas: leitura.cotas.length,
    contagemAnterior,
    novas: r?.novas ?? 0,
    atualizadas: r?.atualizadas ?? 0,
    indisponibilizadas: r?.indisponibilizadas ?? 0,
    // lembrete: push das novas fica PENDENTE (push_pendente=true) até o OneSignal.
  });
}
