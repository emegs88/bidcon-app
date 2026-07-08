// ============================================================================
// Cron de sync de cotas — roda 1x/hora (Vercel Cron). Server-only.
// ----------------------------------------------------------------------------
// MULTI-FONTE em LOTES: consome LANCE + CBC + PIFFER + CARTAS + SERVOPA do
// feed do prospere-360 (lib/cotas-source), cada fonte lida e aplicada
// SEPARADAMENTE, e cada fonte aplicada em LOTES de 100 cotas (fatia 0027):
// chamadas curtas na RPC nunca estouram o teto HTTP do gateway (~60s).
//
// Fluxo, POR FONTE (decisão B — isolamento total entre fontes):
//   1) autoriza (CRON_SECRET) — uma vez, ninguém dispara isto de fora;
//   2) p/ cada fonte: lê a contagem boa anterior (cartas DAQUELA fonte ainda
//      disponíveis, via administradora_origem);
//   3) lerCotasFonte(fonte, anterior) roda as 5 GUARDAS só daquela fonte;
//      se abortar, registra evento 'sync_pulado' e PULA a fonte — NÃO toca o
//      estoque de NENHUMA fonte;
//   4) aplica em LOTES: sync_aplicar_cotas(p_origem, p_lote, p_varrer=false)
//      por lote de 100. Falha num lote => 'sync_abortado' com o índice do
//      lote e SEM varredura (lotes já aplicados ficam; a próxima hora cura);
//   5) todos os lotes ok => UMA chamada sync_varrer_ausentes(p_origem,
//      p_numeros) com TODOS os números lidos marca as ausentes da fonte;
//   6) carta nova nasce com evento push_pendente=true (gatilho do OneSignal,
//      hoje stub — ver lib/notificar.ts);
//   7) ao final da execução, evento 'sync_fim' com duração e placar — se um
//      'sync_fim' não aparecer no eventos_sync, a função foi morta pelo teto
//      de duração (maxDuration) antes de terminar.
//
// Uma fonte que falha NUNCA derruba as outras: o loop segue, e o resultado
// por fonte é reportado individualmente.
//
// service_role: usada só aqui (lib/supabase-xtv), via env var protegida.
// ============================================================================
import { NextResponse } from "next/server";
import { createXtvClient } from "@/lib/supabase-xtv";
import { lerCotasFonte, FONTES, type FonteMarca } from "@/lib/cotas-source";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Fatia 0027: teto explícito de duração. Sem isto, a Vercel matava a função
// no meio da fila de fontes (SERVOPA morria muda às 17h e 19h de 08/07).
export const maxDuration = 800;

const TAMANHO_LOTE = 100;

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
  lotes?: number;
  contagemAnterior?: number;
  novas?: number;
  atualizadas?: number;
  indisponibilizadas?: number;
};

export async function GET(req: Request) {
  if (!autorizado(req)) {
    return NextResponse.json({ ok: false, erro: "nao_autorizado" }, { status: 401 });
  }

  const inicio = Date.now();
  const db = createXtvClient();
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
        // Blindagem A: best-effort — falha ao logar nunca derruba o loop das outras fontes.
        try {
          await db.from("eventos_sync").insert({
            tipo: "sync_abortado",
            detalhe: origem + " contagem: " + errCount.message,
          });
        } catch {
          // silencioso de propósito: logging é best-effort, não pode quebrar o sync
        }
        resultados.push({ origem, ok: false, motivo: "contagem: " + errCount.message });
        continue;
      }
      const contagemAnterior = anterior ?? 0;

      // (3) as 5 guardas, só desta fonte. Guarda que barra => 'sync_pulado'
      // (fatia 0027: tipo dedicado e filtrável; 'sync_abortado' fica reservado
      // pra falha de contagem/RPC/lote/exceção).
      const leitura = await lerCotasFonte(origem, contagemAnterior);
      if (!leitura.ok) {
        try {
          await db.from("eventos_sync").insert({
            tipo: "sync_pulado",
            detalhe: origem + ": " + leitura.motivo,
          });
        } catch {
          // silencioso de propósito
        }
        resultados.push({ origem, ok: false, motivo: leitura.motivo, contagemAnterior });
        continue;
      }

      // (4) aplica em LOTES de 100, sem varredura (p_varrer=false).
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

      let novas = 0;
      let atualizadas = 0;
      let falhouLote = false;

      for (let i = 0; i < payload.length; i += TAMANHO_LOTE) {
        const lote = payload.slice(i, i + TAMANHO_LOTE);
        const indice = Math.floor(i / TAMANHO_LOTE) + 1;
        const { data, error } = await db.rpc("sync_aplicar_cotas", {
          p_origem: origem,
          p_cotas: lote,
          p_varrer: false,
        });
        if (error) {
          try {
            await db.from("eventos_sync").insert({
              tipo: "sync_abortado",
              detalhe: origem + " rpc_falhou lote " + indice + ": " + error.message,
            });
          } catch {
            // silencioso de propósito
          }
          resultados.push({
            origem,
            ok: false,
            motivo: "rpc lote " + indice + ": " + error.message,
            contagemAnterior,
            lidas: payload.length,
          });
          falhouLote = true;
          break;
        }
        const r = Array.isArray(data) ? data[0] : data;
        novas += r?.novas ?? 0;
        atualizadas += r?.atualizadas ?? 0;
      }
      if (falhouLote) continue; // lotes aplicados ficam; SEM varredura desta fonte

      // (5) todos os lotes aplicaram => varredura única com a lista COMPLETA.
      // A RPC tem trava própria: lista vazia jamais varre.
      const numeros = payload.map((c) => c.numero);
      const { data: varridas, error: errVarrer } = await db.rpc("sync_varrer_ausentes", {
        p_origem: origem,
        p_numeros: numeros,
      });
      if (errVarrer) {
        try {
          await db.from("eventos_sync").insert({
            tipo: "sync_abortado",
            detalhe: origem + " varredura_falhou: " + errVarrer.message,
          });
        } catch {
          // silencioso de propósito
        }
        resultados.push({
          origem,
          ok: false,
          motivo: "varredura: " + errVarrer.message,
          contagemAnterior,
          lidas: payload.length,
          novas,
          atualizadas,
        });
        continue;
      }

      resultados.push({
        origem,
        ok: true,
        lidas: payload.length,
        lotes: Math.ceil(payload.length / TAMANHO_LOTE),
        contagemAnterior,
        novas,
        atualizadas,
        indisponibilizadas: typeof varridas === "number" ? varridas : 0,
      });
    } catch (e) {
      // rede de segurança: erro inesperado numa fonte não derruba as outras
      // Blindagem A: best-effort — falha ao logar nunca derruba o loop das outras fontes.
      try {
        await db.from("eventos_sync").insert({
          tipo: "sync_abortado",
          detalhe: origem + " excecao: " + (e as Error).message,
        });
      } catch {
        // silencioso de propósito: logging é best-effort, não pode quebrar o sync
      }
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

  // (7) telemetria de fim (fatia 0027): se este evento não existir numa
  // execução, a função foi morta pelo maxDuration antes de completar a fila.
  try {
    await db.from("eventos_sync").insert({
      tipo: "sync_fim",
      detalhe:
        "total_ms=" + (Date.now() - inicio) +
        " fontes_ok=" + resultados.filter((r) => r.ok).length +
        " fontes_falha=" + resultados.filter((r) => !r.ok).length,
    });
  } catch {
    // silencioso de propósito
  }

  return NextResponse.json(
    {
      ok: algumaOk,
      fontes: resultados,
      totais,
      // lembrete: push das novas fica PENDENTE (push_pendente=true) até o OneSignal.
    },
    // Blindagem B: nenhuma fonte aplicou => 500, pro painel de cron do Vercel
    // acusar falha de verdade em vez de um 200 verde mentiroso.
    { status: algumaOk ? 200 : 500 }
  );
}
