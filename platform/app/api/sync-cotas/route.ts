// ============================================================================
// Cron de sync de cotas — roda 1x/hora (Vercel Cron). Server-only.
// ----------------------------------------------------------------------------
// Agora MULTI-FONTE: consome LANCE + CBC + PIFFER + CARTAS + SERVOPA do feed do
// prospere-360 (lib/cotas-source), cada fonte lida e aplicada SEPARADAMENTE.
//
// Fluxo, POR FONTE (decisão B — isolamento total entre fontes):
//   1) autoriza (CRON_SECRET) — uma vez, ninguém dispara isto de fora;
//   2) p/ cada fonte: lê a contagem boa anterior (cartas DAQUELA fonte ainda
//      disponíveis, via administradora_origem);
//   3) lerCotasFonte(fonte, anterior) roda as 5 GUARDAS só daquela fonte;
//      se abortar, REGISTRA o motivo e PULA a fonte — NÃO toca o estoque de
//      NENHUMA fonte (nem a própria: sem lista íntegra, não marca ausências);
//   4) chama a RPC ATÔMICA sync_aplicar_cotas(p_origem, p_cotas) só com as
//      cotas daquela fonte — upsert + marca ausentes DENTRO da fonte, numa
//      transação no Postgres (rollback automático em erro);
//   5) carta nova nasce com evento push_pendente=true (gatilho do OneSignal,
//      hoje stub — ver lib/notificar.ts).
//
// Uma fonte que falha (HTTP/timeout/parse/volume/RPC) NUNCA derruba as outras:
// o loop segue, e o resultado por fonte é reportado individualmente.
//
// service_role: usada só aqui (lib/supabase-admin), via env var protegida.
// ============================================================================
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { lerCotasFonte, FONTES, type FonteMarca } from "@/lib/cotas-source";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function autorizado(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // sem secret configurado => não roda
  // Vercel Cron manda Authorization: Bearer <CRON_SECRET>
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

type ResultadoFonte = {
  origem: FonteMarca;
  ok: boolean;
  motivo?: string;         // preenchido quando ok=false
  lidas?: number;
  contagemAnterior?: number;
  novas?: number;
  atualizadas?: number;
  indisponibilizadas?: number;
};

export async function GET(req: Request) {
  if (!autorizado(req)) {
    return NextResponse.json({ ok: false, erro: "nao_autorizado" }, { status: 401 });
  }

  const db = createAdminClient();
  const resultados: ResultadoFonte[] = [];

  // itera fonte a fonte — isolamento total (B): o try/catch por fonte garante
  // que um erro inesperado numa fonte não aborta o loop das demais.
  for (const origem of FONTES) {
    try {
      // (2) contagem boa anterior DESTA fonte: cartas do sync ainda disponíveis,
      // escopadas por administradora_origem (não pelo `fonte='360prospere'`, que
      // é o mesmo pra todas). Assim a guarda de queda compara maçã com maçã.
      const { count: anterior, error: errCount } = await db
        .from("cartas")
        .select("id", { count: "exact", head: true })
        .eq("administradora_origem", origem)
        .eq("status", "disponivel");

      if (errCount) {
        resultados.push({ origem, ok: false, motivo: "contagem: " + errCount.message });
        continue;
      }
      const contagemAnterior = anterior ?? 0;

      // (3) as 5 guardas, só desta fonte
      const leitura = await lerCotasFonte(origem, contagemAnterior);
      if (!leitura.ok) {
        // aborta SÓ esta fonte, SEM escrever; registra o motivo p/ auditoria
        await db.from("eventos_sync").insert({
          tipo: "sync_abortado",
          detalhe: origem + ": " + leitura.motivo,
        });
        resultados.push({ origem, ok: false, motivo: leitura.motivo, contagemAnterior });
        continue;
      }

      // (4) transação atômica no Postgres, só com as cotas desta fonte.
      // entrada_parceiro (cru) vai como entrada_parceiro; null vira null no jsonb.
      const payload = leitura.cotas.map((c) => ({
        numero: c.numero,
        tipo: c.tipo,
        valor_credito: c.valorCredito,
        valor_entrada: c.valorEntrada,
        valor_parcela: c.valorParcela,
        qtd_parcelas: c.qtdParcelas,
        entrada_parceiro: c.entradaParceiro, // null p/ LANCE
        administradora: c.administradora,
      }));

      const { data, error } = await db.rpc("sync_aplicar_cotas", {
        p_origem: origem,
        p_cotas: payload,
      });
      if (error) {
        await db.from("eventos_sync").insert({
          tipo: "sync_abortado",
          detalhe: origem + " rpc_falhou: " + error.message,
        });
        resultados.push({ origem, ok: false, motivo: "rpc: " + error.message, contagemAnterior });
        continue;
      }

      const r = Array.isArray(data) ? data[0] : data;
      resultados.push({
        origem,
        ok: true,
        lidas: leitura.cotas.length,
        contagemAnterior,
        novas: r?.novas ?? 0,
        atualizadas: r?.atualizadas ?? 0,
        indisponibilizadas: r?.indisponibilizadas ?? 0,
      });
    } catch (e) {
      // rede de segurança: erro inesperado numa fonte não derruba as outras
      resultados.push({ origem, ok: false, motivo: "excecao: " + (e as Error).message });
    }
  }

  // agrega o resultado: ok geral = pelo menos uma fonte aplicou sem erro.
  // (não exigimos todas — uma fonte fora do ar não deve marcar o cron como falho.)
  const algumaOk = resultados.some((r) => r.ok);
  const totais = resultados.reduce(
    (acc, r) => {
      acc.novas += r.novas ?? 0;
      acc.atualizadas += r.atualizadas ?? 0;
      acc.indisponibilizadas += r.indisponibilizadas ?? 0;
      return acc;
    },
    { novas: 0, atualizadas: 0, indisponibilizadas: 0 }
  );

  return NextResponse.json({
    ok: algumaOk,
    fontes: resultados,
    totais,
    // lembrete: push das novas fica PENDENTE (push_pendente=true) até o OneSignal.
  });
}
