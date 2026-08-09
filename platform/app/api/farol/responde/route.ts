// ============================================================================
// GET /api/farol/responde — a série "Responde, Porta-voz"
// AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-SABER-01", Entrega 3.
// ----------------------------------------------------------------------------
// Cron diário. Pega a dúvida mais repetida do FAQ VIVO, transforma em roteiro
// pergunta → resposta → CTA, mede no linter de compliance e dispara UM render
// no HeyGen — a mesma fase 1 do FAROL-REEL, e por isso a fase 2 que já existe
// (`/api/farol/reel-publicar`) recolhe este vídeo sem nenhuma mudança: ele
// nasce em `farol_reels` com status 'renderizando', igual aos outros.
//
// KILL-SWITCH `FAROL_RESPONDE` DESARMADO, como a OS mandou. Enquanto ele não
// for "on" esta rota lê 401/desarmado e devolve 200 sem tocar em banco, em
// modelo ou em HeyGen. Ela também depende do FAQ VIVO ter rodado antes: sem
// `farol_saber` populada não há pergunta, e a rota sai por "sem_pergunta".
//
// ---------------------------------------------------------------------------
// A ORDEM DAS TRAVAS, DA MAIS BARATA PRA MAIS CARA — mesma disciplina do
// reel-render, porque a última linha de cada uma dessas rotas custa dinheiro:
//   1. guard            (header)  — 401, nada acontece
//   2. FAROL_RESPONDE   (env)     — desarmado, nada acontece
//   3. envs do HeyGen   (env)     — falta avatar/voz => sai ANTES do banco
//   4. já saiu hoje?    (banco)   — um por dia, ANTES de gastar modelo
//   5. pergunta elegível(código)  — `podePublicar()`, determinística
//   6. base + redação   (modelo)  — a chamada barata
//   7. compliance       (código)  — texto reprovado NÃO vira render
//   8. render           (HeyGen)  — a única linha cara
//
// ---------------------------------------------------------------------------
// POR QUE A ANTIRREPETIÇÃO É POR `saber_id` E NÃO POR DATA. As perguntas do
// FAQ ficam ordenadas por `ocorrencias desc`, e a campeã continua campeã por
// semanas. Sem memória, esta rota publicaria a MESMA pergunta todo dia até
// alguém reparar. A memória lê o `detalhe->>saber_id` dos reels da série já
// gravados e pula esses ids — a mesma ideia de `publicadasRecentemente()` do
// FAROL-POST, aplicada a perguntas em vez de cartas.
//
// ---------------------------------------------------------------------------
// O QUE VAI PARA O `detalhe` (ordem da OS: "origem + id"):
//   serie: "responde" · origem: "faq" · saber_id · ocorrencias · persona
// E o que NÃO vai: o texto da pergunta do cliente. Ver o header de
// `lib/farol/responde.ts` — o histórico do Instagram não vira cópia do inbox.
// ============================================================================
import { NextResponse } from "next/server";

import { createXtvClient } from "@/lib/supabase-xtv";
import { autorizadoFarol, hojeSP, revisarLegenda, registrar } from "@/lib/farol/selecao";
import { blocoSaber } from "@/lib/farol/saber";
import {
  podePublicar,
  escreverResposta,
  montarRoteiroResposta,
  montarLegendaResposta,
  type PerguntaFaq,
} from "@/lib/farol/responde";
import { dispararRender, tituloRender } from "@/lib/heygen";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Quantas candidatas ler do topo do FAQ antes de desistir do dia. */
const CANDIDATAS = 20;

/** Janela da memória antirrepetição, em dias. */
const MEMORIA_DIAS = 120;

/**
 * Fontes que a resposta pode citar. "faq" fica de FORA pelo mesmo motivo do
 * route da pauta: verbete de FAQ é pergunta de cliente, e a série responde
 * perguntas com FATO da casa — não com outra pergunta.
 */
const FONTES_RESPOSTA = ["lei", "abac", "administradora", "processo", "glossario", "caso"] as const;

/** Início do dia de hoje em São Paulo, em ISO. -03:00 é fixo desde 2019. */
function inicioDoDiaSP(dataSP: string): string {
  return new Date(`${dataSP}T00:00:00-03:00`).toISOString();
}

export async function GET(req: Request) {
  if (!autorizadoFarol(req)) {
    return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  }

  // ---- Trava 2: kill-switch, ANTES de qualquer leitura --------------------
  if (process.env.FAROL_RESPONDE !== "on") {
    console.log("[farol-responde] represado (desarmado)");
    return NextResponse.json({ ok: true, renderizou: false, motivo: "desarmado" });
  }

  // ---- Trava 3: envs do HeyGen -------------------------------------------
  // A série é do Porta-voz — está no nome dela. Nada de `escalar()`/FAROL_DUPLA
  // aqui: a persona é parte da identidade da série, não uma rotação.
  const avatarId = process.env.HEYGEN_AVATAR_ID;
  const voiceId = process.env.HEYGEN_VOICE_ID;
  const tipoAvatar = process.env.HEYGEN_AVATAR_TIPO ?? "avatar";
  if (!avatarId || !voiceId) {
    const faltando = [!avatarId && "HEYGEN_AVATAR_ID", !voiceId && "HEYGEN_VOICE_ID"]
      .filter(Boolean)
      .join(",");
    console.error("[farol-responde] env ausente:", faltando);
    return NextResponse.json({ ok: false, erro: `env_ausente(${faltando})` }, { status: 500 });
  }

  const db = createXtvClient();
  const { data: hoje } = hojeSP();

  try {
    // ---- Trava 4: um por dia ---------------------------------------------
    const { count, error: errConta } = await db
      .from("farol_reels")
      .select("id", { count: "exact", head: true })
      .eq("detalhe->>serie", "responde")
      .gte("criado_em", inicioDoDiaSP(hoje));
    if (errConta) throw new Error(`farol_reels_ilegivel: ${errConta.message}`);
    if ((count ?? 0) >= 1) {
      console.log("[farol-responde] já saiu hoje:", { data: hoje });
      return NextResponse.json({ ok: true, renderizou: false, motivo: "ja_saiu_hoje" });
    }

    // ---- Memória antirrepetição (ver header) ------------------------------
    const desde = new Date(Date.now() - MEMORIA_DIAS * 86_400_000).toISOString();
    const { data: jaFeitos, error: errMem } = await db
      .from("farol_reels")
      .select("detalhe")
      .eq("detalhe->>serie", "responde")
      .gte("criado_em", desde);
    if (errMem) throw new Error(`memoria_ilegivel: ${errMem.message}`);
    const usados = new Set(
      (jaFeitos ?? [])
        .map((r) => (r.detalhe as Record<string, unknown> | null)?.saber_id)
        .filter((v): v is string => typeof v === "string")
    );

    // ---- Trava 5: pergunta elegível --------------------------------------
    // Colunas uma a uma (regra da casa com service-role). `embedding` NUNCA
    // entra: são 1536 floats por linha que ninguém aqui vai ler.
    const { data: faqs, error: errFaq } = await db
      .from("farol_saber")
      .select("id, titulo, conteudo, ocorrencias")
      .eq("fonte", "faq")
      .order("ocorrencias", { ascending: false })
      .limit(CANDIDATAS);
    if (errFaq) {
      // A migração 0072 é aplicada à mão. Enquanto ela não rodar, a tabela não
      // existe — e isso é um estado esperado, não um incidente.
      console.error("[farol-responde] farol_saber ilegível:", errFaq.message);
      return NextResponse.json({
        ok: true,
        renderizou: false,
        motivo: "saber_indisponivel",
        erro: errFaq.message,
      });
    }

    const recusas: Array<{ id: string; motivo: string }> = [];
    let escolhida: PerguntaFaq | null = null;
    for (const f of (faqs ?? []) as PerguntaFaq[]) {
      if (usados.has(f.id)) {
        recusas.push({ id: f.id, motivo: "ja_respondida" });
        continue;
      }
      const motivo = podePublicar(f);
      if (motivo) {
        recusas.push({ id: f.id, motivo });
        continue;
      }
      escolhida = f;
      break;
    }

    if (!escolhida) {
      // Estado normal nas primeiras semanas: o FAQ VIVO precisa de tempo para
      // uma pergunta chegar a três ocorrências. Não é falha.
      console.log("[farol-responde] nenhuma pergunta elegível hoje:", {
        data: hoje,
        candidatas: faqs?.length ?? 0,
        recusas: recusas.length,
      });
      return NextResponse.json({
        ok: true,
        renderizou: false,
        motivo: "sem_pergunta",
        candidatas: faqs?.length ?? 0,
        // Só os motivos, agregados — nunca o texto de nenhuma pergunta.
        recusas: recusas.map((r) => r.motivo),
      });
    }

    // ---- Trava 6: a base e a redação (uma chamada só) ---------------------
    const saber = await blocoSaber(db, escolhida.conteudo, {
      limite: 5,
      fontes: [...FONTES_RESPOSTA],
    });

    const texto = await escreverResposta({ pergunta: escolhida, saber });
    if (!texto.ok) {
      console.error("[farol-responde] redação falhou:", texto.erro);
      return NextResponse.json({
        ok: true,
        renderizou: false,
        motivo: "redacao_falhou",
        erro: texto.erro,
      });
    }

    const roteiro = montarRoteiroResposta(texto);
    const legenda = montarLegendaResposta(texto);

    // ---- Trava 7: compliance, a MESMA cerca do resto do FAROL -------------
    const reprovado = revisarLegenda(roteiro) ?? revisarLegenda(legenda);
    if (reprovado) {
      // Não vira render: texto reprovado é dinheiro que não se gasta. Fica no
      // log e no farol_posts, que é onde o padrão vai aparecer com o tempo.
      console.error("[farol-responde] texto reprovado no compliance:", reprovado);
      await registrar(db, "responde_reprovado", null, null, {
        data: hoje,
        saber_id: escolhida.id,
        motivo: reprovado,
      });
      return NextResponse.json({
        ok: true,
        renderizou: false,
        motivo: "texto_reprovado",
        motivo_linter: reprovado,
      });
    }

    // ---- Trava 8: o render (a única linha que custa) ----------------------
    const r = await dispararRender({
      roteiro,
      avatarId,
      voiceId,
      tipo: tipoAvatar,
      titulo: tituloRender(hoje, "responde"),
    });
    if (!r.ok) {
      console.error("[farol-responde] render recusado:", { data: hoje, erro: r.erro });
      await registrar(db, "responde_falhou", null, null, {
        data: hoje,
        saber_id: escolhida.id,
        erro: r.erro,
      });
      return NextResponse.json({ ok: false, erro: r.erro }, { status: 502 });
    }

    // ---- Registro: falha AQUI é erro, não sucesso -------------------------
    // Mesma regra do reel-render: render disparado e não registrado é dinheiro
    // gasto que some. O video_id vai no log E na resposta, porque é a única
    // forma de recuperar o vídeo à mão.
    const { error: errIns } = await db.from("farol_reels").insert({
      carta_id: null,
      video_id: r.data.videoId,
      status: "renderizando",
      roteiro,
      legenda,
      detalhe: {
        data: hoje,
        serie: "responde",
        origem: "faq",
        saber_id: escolhida.id,
        ocorrencias: escolhida.ocorrencias,
        persona: "porta_voz",
        avatar_tipo: tipoAvatar,
      },
    });

    if (errIns) {
      console.error("[farol-responde] render ÓRFÃO (insert falhou):", {
        video_id: r.data.videoId,
        erro: errIns.message,
      });
      return NextResponse.json(
        { ok: false, erro: `insert_falhou: ${errIns.message}`, video_id: r.data.videoId },
        { status: 500 }
      );
    }

    await registrar(db, "responde_renderizou", null, null, {
      data: hoje,
      saber_id: escolhida.id,
      ocorrencias: escolhida.ocorrencias,
      video_id: r.data.videoId,
      com_base: saber.length > 0,
    });

    console.log("[farol-responde] render disparado:", {
      data: hoje,
      video_id: r.data.videoId,
      saber_id: escolhida.id,
      ocorrencias: escolhida.ocorrencias,
      com_base: saber.length > 0,
    });

    return NextResponse.json({
      ok: true,
      renderizou: true,
      video_id: r.data.videoId,
      saber_id: escolhida.id,
      ocorrencias: escolhida.ocorrencias,
      com_base: saber.length > 0,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[farol-responde] erro:", msg);
    return NextResponse.json({ ok: false, erro: msg }, { status: 500 });
  }
}
