// ============================================================================
// FAROL-REEL-01 · rota 2 — GET /api/farol/reel-render · FASE 1 (dispara)
// AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-REEL-01", 06/08/2026:
// "cron 14:30 UTC no vercel.json, guard FAROL_SECRET||CRON_SECRET igual ao
//  post-diario; escolhe a carta do dia pela MESMA lib de seleção do FAROL-POST,
//  roteiro determinístico, dispara o render no HeyGen, grava video_id +
//  carta_id. SEM polling longo."
// NASCE DESARMADA: sem FAROL_REEL=on, esta rota não fala com o HeyGen.
// ----------------------------------------------------------------------------
// POR QUE DUAS FASES, e não uma só que espera. Um render de ~35s no HeyGen leva
// minutos. Segurar a invocação esperando é a forma mais cara e mais frágil de
// errar: a função da Vercel tem teto de tempo, e um timeout no meio deixaria o
// vídeo renderizado no HeyGen sem NINGUÉM sabendo o video_id — pago e perdido.
// Aqui a fase 1 dispara e ESCREVE o video_id no banco antes de responder. A
// partir daí o render é um fato registrado: mesmo que tudo mais falhe, a fase 2
// de 30 minutos depois (ou a do dia seguinte) o encontra.
//
// A ESCRITA VEM ANTES DA RESPOSTA, E É ELA QUE IMPORTA. Se o insert em
// `farol_reels` falhar, esta rota devolve ERRO mesmo com o render já disparado —
// e diz o video_id no corpo e no log. Não finjo sucesso: um render órfão é
// dinheiro gasto que precisa aparecer em algum lugar, nem que seja no log.
//
// ---------------------------------------------------------------------------
// A ORDEM DAS TRAVAS É DE PROPÓSITO, DA MAIS BARATA PRA MAIS CARA:
//   1. guard          (header)      — 401, nada acontece
//   2. FAROL_REEL     (env)         — "represado", nada acontece
//   3. envs do HeyGen (env)         — falta id/voz => sai ANTES de ler o banco
//   4. já rendeu hoje? (banco)      — teto diário, ANTES de gastar crédito
//   5. carta do dia   (banco)
//   6. compliance     (código)      — texto reprovado NÃO vira render
//   7. render         (HeyGen, $$)  — a única linha que custa
// Nenhuma dessas travas é cara depois da que vem antes dela.
//
// TETO DIÁRIO: uma carta por dia, uma linha por dia. `FAROL_REEL_QTD` existe no
// blueprint FAROL-CRIATIVO para subir isso com rampa medida (1/dia na semana 1,
// 2/dia na semana 2, 4/dia depois); aqui ele é LIDO e o padrão é 1. Sem esse
// teto, um cron que retenta sozinho vira uma fatura de HeyGen. A contagem é
// feita no banco, sobre `criado_em >= hoje 00:00 em São Paulo` — não em memória.
//
// COMPLIANCE ANTES DO RENDER, e não antes do publish: um roteiro irregular já
// renderizado é dinheiro gasto num vídeo que não pode sair. `revisarLegenda()`
// (a MESMA trava determinística do post de feed) mede o roteiro E a legenda
// aqui, e a fase 2 mede a legenda de novo antes de mandar pra Meta.
//
// A LEGENDA É MONTADA E GUARDADA AGORA, não na fase 2. Meia hora depois a carta
// pode ter sido vendida e sumido da `vw_vitrine_viva` — e aí a fase 2 teria um
// vídeo pronto e nenhum número pra escrever embaixo. Guardando, o reel publica
// com os números que ele mesmo narra. (Se a carta sumir, o vídeo já gravado
// continua verdadeiro sobre o que era a oferta; o link da bio leva pra vitrine
// atual, não pra uma carta morta.)
// ============================================================================
import { NextResponse } from "next/server";
import { createXtvClient } from "@/lib/supabase-xtv";
import {
  autorizadoFarol,
  hojeSP,
  publicadasRecentemente,
  escolherCartaDoDia,
  revisarLegenda,
  registrar,
} from "@/lib/farol/selecao";
import { montarRoteiro, montarLegendaReel } from "@/lib/farol/reel-texto";
import { dispararRender } from "@/lib/heygen";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Quantos reels por dia. Rampa do blueprint FAROL-CRIATIVO; padrão 1. */
function tetoDiario(): number {
  const bruto = Number(process.env.FAROL_REEL_QTD ?? "1");
  if (!Number.isFinite(bruto) || bruto < 1) return 1;
  return Math.min(Math.floor(bruto), 4); // 4 é o teto do blueprint
}

/** Início do dia de hoje em São Paulo, em ISO — a régua da contagem diária. */
function inicioDoDiaSP(dataSP: string): string {
  // -03:00 é o offset fixo do Brasil desde o fim do horário de verão (2019).
  // Escrito literal de propósito: `new Date("2026-08-06T00:00:00-03:00")` é
  // determinístico, enquanto reconstruir por Intl daria margem a erro de 1h.
  return new Date(`${dataSP}T00:00:00-03:00`).toISOString();
}

export async function GET(req: Request) {
  if (!autorizadoFarol(req)) {
    return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  }

  // ---- Kill-switch, ANTES de qualquer leitura ou escrita ------------------
  if (process.env.FAROL_REEL !== "on") {
    console.log("[farol-reel] represado (desarmado)");
    return NextResponse.json({ ok: true, renderizou: false, motivo: "desarmado" });
  }

  // ---- Envs do HeyGen: falta id ou voz => nem chega no banco --------------
  const avatarId = process.env.HEYGEN_AVATAR_ID;
  const voiceId = process.env.HEYGEN_VOICE_ID;
  const tipoAvatar = process.env.HEYGEN_AVATAR_TIPO ?? "avatar";
  if (!avatarId || !voiceId) {
    const faltando = [!avatarId && "HEYGEN_AVATAR_ID", !voiceId && "HEYGEN_VOICE_ID"]
      .filter(Boolean)
      .join(",");
    console.error("[farol-reel] env ausente:", faltando);
    return NextResponse.json(
      { ok: false, erro: `env_ausente(${faltando})`, dica: "GET /api/farol/reel-opcoes" },
      { status: 500 }
    );
  }

  const db = createXtvClient();
  const { data: hoje, dia, segunda } = hojeSP();

  try {
    // ---- Teto diário, ANTES de gastar crédito -----------------------------
    const { count, error: errConta } = await db
      .from("farol_reels")
      .select("id", { count: "exact", head: true })
      .gte("criado_em", inicioDoDiaSP(hoje));
    if (errConta) throw new Error(`farol_reels_ilegivel: ${errConta.message}`);

    const teto = tetoDiario();
    if ((count ?? 0) >= teto) {
      console.log("[farol-reel] teto diário atingido:", { data: hoje, count, teto });
      return NextResponse.json({
        ok: true,
        renderizou: false,
        motivo: "teto_diario",
        hoje: count,
        teto,
      });
    }

    // ---- Carta do dia (MESMA lib do FAROL-POST) ---------------------------
    // A memória inclui `reel_publicado`: um reel não repete carta que já virou
    // reel. Inclui também `post_publicado` porque a carta do post de feed das
    // 14h já foi mostrada hoje — o reel das 14h30 mostra a PRÓXIMA mais barata,
    // e o perfil ganha duas cartas por dia em vez da mesma duas vezes.
    const excluidos = await publicadasRecentemente(db, [
      "post_publicado",
      "reel_publicado",
    ]);
    const { carta, motivo: motivoEscolha, tipoDoDia } = await escolherCartaDoDia(db, {
      dia,
      segunda,
      excluidos,
    });

    if (!carta) {
      console.log("[farol-reel] sem carta elegível hoje:", { data: hoje, tipoDoDia });
      await registrar(db, "reel_sem_carta", null, null, {
        data: hoje,
        tipo_do_dia: tipoDoDia,
      });
      return NextResponse.json({ ok: true, renderizou: false, motivo: "sem_carta" });
    }

    // ---- Textos + compliance ANTES do render ------------------------------
    const roteiro = montarRoteiro(carta);
    const legenda = montarLegendaReel(carta);

    const reprovado = revisarLegenda(roteiro) ?? revisarLegenda(legenda);
    if (reprovado) {
      console.error("[farol-reel] texto reprovado no compliance:", reprovado);
      await registrar(db, "reel_falhou", carta.id, null, {
        data: hoje,
        erro: `texto_reprovado:${reprovado}`,
      });
      return NextResponse.json(
        { ok: false, erro: `texto_reprovado:${reprovado}` },
        { status: 500 }
      );
    }

    // ---- Render (a única linha que custa) ---------------------------------
    const r = await dispararRender({
      roteiro,
      avatarId,
      voiceId,
      tipo: tipoAvatar,
      titulo: `bidcon ${hoje} ${carta.tipo}`,
    });

    if (!r.ok) {
      console.error("[farol-reel] render recusado:", {
        data: hoje,
        carta_id: carta.id,
        erro: r.erro,
      });
      await registrar(db, "reel_falhou", carta.id, null, { data: hoje, erro: r.erro });
      return NextResponse.json({ ok: false, erro: r.erro }, { status: 502 });
    }

    // ---- Registro do render (ver header: falha AQUI é erro, não sucesso) ---
    const { error: errIns } = await db.from("farol_reels").insert({
      carta_id: carta.id,
      video_id: r.data.videoId,
      status: "renderizando",
      roteiro,
      legenda,
      detalhe: {
        data: hoje,
        tipo: carta.tipo,
        administradora: carta.administradora,
        credito: carta.credito,
        custo_am: carta.custoAm,
        escolha: motivoEscolha,
        avatar_tipo: tipoAvatar,
      },
    });

    if (errIns) {
      // Render disparado e não registrado. O video_id vai no log E na resposta
      // porque é a única forma de alguém recuperar esse vídeo à mão.
      console.error("[farol-reel] RENDER ÓRFÃO — insert falhou:", {
        video_id: r.data.videoId,
        carta_id: carta.id,
        erro: errIns.message,
      });
      return NextResponse.json(
        {
          ok: false,
          erro: `render_orfao: ${errIns.message}`,
          video_id: r.data.videoId,
          carta_id: carta.id,
        },
        { status: 500 }
      );
    }

    console.log("[farol-reel] render disparado:", {
      data: hoje,
      video_id: r.data.videoId,
      carta_id: carta.id,
      tipo: carta.tipo,
      custo_am: carta.custoAm,
      escolha: motivoEscolha,
    });

    return NextResponse.json({
      ok: true,
      renderizou: true,
      video_id: r.data.videoId,
      carta_id: carta.id,
      escolha: motivoEscolha,
    });
  } catch (e) {
    const erro = e instanceof Error ? e.message.slice(0, 500) : "erro_desconhecido";
    console.error("[farol-reel] erro na fase 1:", erro);
    return NextResponse.json({ ok: false, erro }, { status: 500 });
  }
}
