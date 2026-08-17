// ============================================================================
// Cron de sync de cotas — roda 1x/hora (Vercel Cron). Server-only.
// ----------------------------------------------------------------------------
// MULTI-FONTE em LOTES: consome LANCE + CBC + PIFFER + CARTAS do feed do
// prospere-360 (lib/cotas-source) + PLAYCONTEMPLADAS direto do HTML do
// parceiro (lib/playcontempladas-source, PLAYCONTEMPLADAS-01) — cada fonte
// lida e aplicada SEPARADAMENTE, e cada fonte aplicada em LOTES de 100
// cotas (fatia 0027): chamadas curtas na RPC nunca estouram o teto HTTP do
// gateway (~60s). SERVOPA fica fora da rotação (ver nota em FONTES, no
// próprio lib/cotas-source.ts).
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
import {
  lerCotasFonte,
  FONTES,
  type DiagnosticoRaw,
  type FonteMarca,
} from "@/lib/cotas-source";
import { lerCotasPlaycontempladas } from "@/lib/playcontempladas-source";

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

// Tipos de evento do diagnóstico do valor cru (SYNC-RAW-01). Um deles é
// gravado por fonte por ciclo. `eventos_sync.tipo` é text sem check constraint
// (medido) — por isso nenhuma migration é necessária para estreá-los.
const RAW_JA_MANDOU = ["sync_raw_ok", "sync_raw_parcial"] as const;

/**
 * SYNC-RAW-01 (b): grava UM evento por fonte por ciclo com o diagnóstico do
 * valor cru. Best-effort como todos os outros inserts daqui: falha ao logar
 * nunca derruba o sync.
 *
 * O TIPO do evento é o alarme, e ele separa duas coisas que num contador
 * pareceriam iguais:
 *   sync_raw_desenho   : fonte que não manda cru por desenho (LANCE embute os
 *                        7% na origem). Nulo legítimo e NOMEADO. Não alarma.
 *   sync_raw_ok        : esperava o cru e veio em todas.
 *   sync_raw_parcial   : esperava e veio em parte. Contrato meio honrado.
 *   sync_raw_ausente   : esperava, veio ZERO, e nunca se viu esta fonte
 *                        mandando. Zero absoluto — NÃO alarma.
 *   sync_raw_regressao : esperava, veio ZERO, e esta fonte JÁ MANDOU antes.
 *                        Queda de N para zero — ALARMA.
 *
 * LIMITE DECLARADO: a memória do "já mandou antes" é o próprio eventos_sync, e
 * ela começa vazia no primeiro ciclo depois deste deploy. CBC/PIFFER/CARTAS —
 * que hoje mandam zero e que o contrato da migration 0015 diz terem mandado no
 * passado — vão sair como `ausente`, não `regressao`, até que o 360 mande uma
 * vez. O instrumento não inventa passado que não mediu, e quem lê o painel
 * precisa saber disso.
 *
 * O `detalhe` é UMA linha grepável (eventos_sync não tem coluna jsonb) e
 * carrega o LITERAL da URL chamada, com o ?admin=1 visível: sem ele ninguém
 * consegue dizer se o contrato mudou no 360prospere ou se fomos nós que
 * paramos de pedir.
 */
async function registrarRaw(
  db: ReturnType<typeof createXtvClient>,
  raw: DiagnosticoRaw
): Promise<void> {
  try {
    let tipo: string;
    if (!raw.espera) {
      tipo = "sync_raw_desenho";
    } else if (raw.faltando === 0) {
      tipo = "sync_raw_ok";
    } else if (raw.recebidas > 0) {
      tipo = "sync_raw_parcial";
    } else {
      // Zero recebidas: só é regressão se esta fonte já apareceu mandando.
      // O espaço no fim do prefixo evita casar uma fonte com nome maior.
      const { count } = await db
        .from("eventos_sync")
        .select("id", { count: "exact", head: true })
        .in("tipo", RAW_JA_MANDOU as unknown as string[])
        .like("detalhe", "fonte=" + raw.origem + " %");
      tipo = (count ?? 0) > 0 ? "sync_raw_regressao" : "sync_raw_ausente";
    }

    await db.from("eventos_sync").insert({
      tipo,
      detalhe:
        "fonte=" + raw.origem +
        " espera=" + (raw.espera ? 1 : 0) +
        " lidas=" + raw.lidas +
        " recebidas=" + raw.recebidas +
        " faltando=" + raw.faltando +
        " admin=" + (raw.admin ? 1 : 0) +
        " url=" + raw.url,
    });
  } catch {
    // silencioso de propósito: logging é best-effort, não pode quebrar o sync
  }
}

type ResultadoFonte = {
  origem: FonteMarca;
  ok: boolean;
  motivo?: string;         // preenchido quando ok=false
  cicloT0?: string;        // D6: fronteira do ciclo, do relógio do banco
  lidas?: number;
  lotes?: number;
  contagemAnterior?: number;
  novas?: number;
  atualizadas?: number;
  indisponibilizadas?: number;
  // SYNC-RAW-01: o diagnóstico do valor cru viaja também na resposta do cron,
  // não só no eventos_sync — quem lê o painel vê o número sem abrir o banco.
  raw?: DiagnosticoRaw;
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
      // PLAYCONTEMPLADAS-01: fonte lida via HTML (site do parceiro não tem
      // JSON), leitor dedicado — resto do fluxo (lote/varredura/eventos)
      // idêntico às demais.
      const leitura =
        origem === "PLAYCONTEMPLADAS"
          ? await lerCotasPlaycontempladas(contagemAnterior)
          : await lerCotasFonte(origem, contagemAnterior);
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

      // (3c) SYNC-RAW-01: diagnóstico do valor cru DESTA leitura. Vem aqui, e
      // não depois de aplicar, de propósito: o que ele mede é a LEITURA, e o
      // fato continua valendo mesmo que a RPC falhe adiante. A leitura NUNCA é
      // abortada por ausência de cru — as cartas entram do mesmo jeito.
      await registrarRaw(db, leitura.raw);

      // (3b) ABERTURA DO CICLO (D6). Um único t0 por fonte, compartilhado por
      // TODOS os lotes e pela varredura final. Precisa vir do relógio do BANCO:
      // com t0 do relógio do Node adiantado em relação ao Postgres, uma carta
      // reivindicada no lote 1 (sincronizada_em = now() do banco) ainda
      // satisfaria `sincronizada_em < t0` no lote 2 e seria reivindicada duas
      // vezes. sync_ciclo_t0(origem, '{}') devolve o ultima_varredura_em do
      // estado — a fronteira exata entre o ciclo passado e este — e faz o
      // bootstrap com now() na primeira execução da fonte (nunca -infinity).
      const { data: t0Raw, error: errT0 } = await db.rpc("sync_ciclo_t0", {
        p_origem: origem,
        p_cotas: {},
      });
      if (errT0 || !t0Raw) {
        try {
          await db.from("eventos_sync").insert({
            tipo: "sync_abortado",
            detalhe: origem + " ciclo_t0: " + (errT0?.message ?? "nulo"),
          });
        } catch {
          // silencioso de propósito
        }
        resultados.push({ origem, ok: false, motivo: "ciclo_t0", contagemAnterior });
        continue;
      }
      const cicloT0 = t0Raw as string;

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
          // D6: envelope canônico. A assinatura (p_origem, p_cotas, p_varrer)
          // continua CONGELADA — o t0 viaja DENTRO do jsonb, não num 4º arg.
          p_cotas: { ciclo_t0: cicloT0, cotas: lote },
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
            raw: leitura.raw,
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
      // IDENTIDADE-01: a varredura nova casa por FINGERPRINT (D1), não por
      // numero_externo (que é POSIÇÃO, D1). Ela precisa do payload inteiro
      // para recomputar os fingerprints entrantes e rodar a checagem de
      // integridade do ciclo — por isso vai `payload`, não `numeros`.
      // Mesmo cicloT0 dos lotes: a fronteira do ciclo tem que ser uma só.
      const { data: varridas, error: errVarrer } = await db.rpc("sync_varrer_ausentes", {
        p_origem: origem,
        p_cotas: { ciclo_t0: cicloT0, cotas: payload },
        p_ciclo_inicio: cicloT0,
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
          raw: leitura.raw,
        });
        continue;
      }

      resultados.push({
        origem,
        ok: true,
        cicloT0,
        lidas: payload.length,
        lotes: Math.ceil(payload.length / TAMANHO_LOTE),
        contagemAnterior,
        novas,
        atualizadas,
        indisponibilizadas: typeof varridas === "number" ? varridas : 0,
        raw: leitura.raw,
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
      // SYNC-RAW-01: soma só o que DEVERIA ter vindo e não veio. LANCE não
      // entra nesta conta — nulo por desenho não é falta.
      acc.rawFaltando += r.raw?.faltando ?? 0;
      acc.rawRecebidas += r.raw?.recebidas ?? 0;
      return acc;
    },
    { novas: 0, atualizadas: 0, indisponibilizadas: 0, rawFaltando: 0, rawRecebidas: 0 }
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
