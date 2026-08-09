// ============================================================================
// FAROL-VISUAL-02 Entrega 1 — GET /api/farol/story · o story diário
// AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-VISUAL-02", 09/08/2026:
// "Publica o card ?formato=story da carta que o post do dia usou (ler
//  farol_posts do dia; sem post do dia → não inventa carta, loga e sai)."
// NASCE DESARMADO. Sem FAROL_STORY=on, esta rota não publica nada.
// ----------------------------------------------------------------------------
// O QUE A DOC DISSE (Regra nº 1 — medido em developers.facebook.com, Instagram
// Platform · Content Publishing / IG User Media, 09/08/2026):
//   - STORIES é um `media_type` do MESMO endpoint POST /<IG_USER_ID>/media, e
//     aceita `image_url` OU `video_url` — mutuamente exclusivos. Nada de
//     endpoint separado;
//   - a publicação continua sendo em DOIS passos (media → media_publish). A OS
//     dizia "publicação em um passo"; a doc não diz isso em lugar nenhum, e o
//     fluxo documentado para stories é o mesmo dos demais. Seguimos a doc;
//   - story expira em 24h (isso a OS acertou);
//   - o teto da conta é de 100 publicações por API em janela móvel de 24h, e um
//     carrossel conta como UMA. Com post + story + reel + 1 carrossel semanal,
//     o pico é 4/dia — 4% do teto.
//
// SEM LINK STICKER, por ordem e por fato: conta com menos de 10 mil seguidores
// não tem link em story, e a Graph não oferece sticker de link nesta API. O CTA
// é o texto do próprio card ("link na bio"). Não fingimos que existe.
//
// ---------------------------------------------------------------------------
// POR QUE ELE NÃO ESCOLHE CARTA (é a decisão de projeto desta rota):
// O story ESPELHA o post do dia. Se ele escolhesse sozinho, o perfil teria duas
// cartas concorrendo no mesmo dia e o story deixaria de ser o reforço do post
// para virar um segundo anúncio. Então a fonte é `farol_posts`: ação
// `post_publicado` com `detalhe->>data` igual ao dia de São Paulo. Sem post do
// dia, a rota sai em silêncio — não inventa carta.
//
// MEDIDO no banco antes de escrever (xtv, 09/08/2026): as três linhas
// `post_publicado` existentes têm `detalhe->>'data'` preenchido com a data em
// SP ('2026-08-09', '2026-08-08', '2026-08-07'). A chave existe e é confiável;
// não precisei de coluna nova nem de migração — `farol_posts.detalhe` já é
// jsonb.
//
// FOLGA DE HORÁRIO: o post-diario roda 14:00 UTC e o último terminou 14:01:29Z.
// Este cron é 15:00 UTC. Uma hora de folga para um passo que leva segundos.
//
// A CARTA AINDA ESTÁ VIVA? Entre 11h e 12h (BRT) a carta pode ter sido vendida.
// A arte lê `vw_vitrine_viva`; se a carta saiu, o card devolveria 404 e a Meta
// recusaria o container com um erro genérico. Perguntamos antes, pela MESMA
// função que o post usa (`lerCartaViva`), para o log dizer "carta_indisponivel"
// em vez de "container recusado, e vá descobrir por quê".
// ============================================================================
import { NextResponse } from "next/server";
import { createXtvClient } from "@/lib/supabase-xtv";
import {
  chamarGraph,
  lerCartaViva,
  publicarContainer,
  urlCard,
} from "@/lib/instagram/publicar";
import { autorizadoFarol, hojeSP, registrar } from "@/lib/farol/selecao";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!autorizadoFarol(req)) {
    return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  }

  // ---- Kill-switch, ANTES de qualquer leitura ou escrita ------------------
  // Chave PRÓPRIA, separada de FAROL_ATIVO: o Emerson tem que poder ligar o
  // story sem ligar mais nada, e desligar o story sem derrubar o post do dia.
  if (process.env.FAROL_STORY !== "on") {
    console.log("[farol-story] represado (desarmado)");
    return NextResponse.json({ ok: true, publicado: false, motivo: "desarmado" });
  }

  const db = createXtvClient();
  const { data: hoje } = hojeSP();

  try {
    // ---- Já publiquei o story de hoje? -----------------------------------
    // O cron é diário, mas um disparo manual, um retry da Vercel ou um deploy
    // no minuto errado repetiriam o story. Dois stories iguais no mesmo dia é
    // o tipo de erro que o seguidor VÊ.
    const { data: jaFeito, error: errJa } = await db
      .from("farol_posts")
      .select("post_id")
      .eq("acao", "story_publicado")
      .eq("detalhe->>data", hoje)
      .limit(1);
    if (errJa) throw new Error(`farol_posts_ilegivel: ${errJa.message}`);
    if (jaFeito && jaFeito.length > 0) {
      console.log("[farol-story] já publicado hoje:", {
        data: hoje,
        story_id: (jaFeito[0] as { post_id: string | null }).post_id,
      });
      return NextResponse.json({ ok: true, publicado: false, motivo: "ja_publicado" });
    }

    // ---- Qual carta o post do dia usou? ----------------------------------
    const { data: posts, error: errPost } = await db
      .from("farol_posts")
      .select("carta_id,post_id")
      .eq("acao", "post_publicado")
      .eq("detalhe->>data", hoje)
      .order("criado_em", { ascending: false })
      .limit(1);
    if (errPost) throw new Error(`farol_posts_ilegivel: ${errPost.message}`);

    const doDia = (posts ?? [])[0] as
      | { carta_id: string | null; post_id: string | null }
      | undefined;

    if (!doDia?.carta_id) {
      // Ordem literal: "não inventa carta, loga e sai". E NÃO grava linha: com
      // o post desarmado, gravar aqui encheria o diário com uma linha por dia
      // dizendo a mesma coisa. Sair sem publicar não é falha.
      console.log("[farol-story] sem post do dia — nada a espelhar:", { data: hoje });
      return NextResponse.json({ ok: true, publicado: false, motivo: "sem_post_do_dia" });
    }

    const cartaId = doDia.carta_id;

    // ---- A carta ainda está viva? (ver header) ---------------------------
    const viva = await lerCartaViva(cartaId);
    if (!viva.ok) {
      console.error("[farol-story] carta do post do dia não está publicável:", {
        data: hoje,
        carta_id: cartaId,
        motivo: viva.motivo,
      });
      await registrar(db, "story_falhou", cartaId, null, {
        data: hoje,
        motivo: viva.motivo,
        erro: viva.erro,
      });
      return NextResponse.json({ ok: false, erro: viva.erro, motivo: viva.motivo });
    }

    // ---- Container STORIES ------------------------------------------------
    // `?formato=story` = 1080×1920 com a zona segura vertical que a
    // VISUAL-KIT-APLICADO-01 já calculou (260px em cima, 280px embaixo, para a
    // UI do Instagram não cobrir número nenhum). Este formato existe desde
    // aquela fatia e nunca foi publicado uma vez — é o que esta rota destrava.
    const imageUrl = urlCard(cartaId, "?formato=story");
    const container = await chamarGraph("media", {
      media_type: "STORIES",
      image_url: imageUrl,
      // Sem `caption`: story não tem legenda. Mandar o campo seria pedir para a
      // Graph decidir o que fazer com um parâmetro que ela não usa.
    });
    if (!container.ok) {
      console.error("[farol-story] container recusado:", {
        data: hoje,
        carta_id: cartaId,
        image_url: imageUrl,
        erro: container.erro,
      });
      await registrar(db, "story_falhou", cartaId, null, {
        data: hoje,
        motivo: "container_recusado",
        erro: container.erro,
      });
      return NextResponse.json({ ok: false, erro: container.erro, motivo: "container_recusado" });
    }

    // ---- Publicar (mesmo retry de 3s do feed — ver lib) -------------------
    const publicado = await publicarContainer(container.id as string);
    if (!publicado.ok) {
      console.error("[farol-story] publicação recusada:", {
        data: hoje,
        carta_id: cartaId,
        container_id: container.id,
        erro: publicado.erro,
      });
      await registrar(db, "story_falhou", cartaId, null, {
        data: hoje,
        motivo: "publicacao_recusada",
        container_id: container.id,
        erro: publicado.erro,
      });
      return NextResponse.json({
        ok: false,
        erro: publicado.erro,
        motivo: "publicacao_recusada",
        container_id: container.id,
      });
    }

    console.log("[farol-story] story publicado:", {
      data: hoje,
      story_id: publicado.id,
      carta_id: cartaId,
      post_do_dia: doDia.post_id,
    });
    await registrar(db, "story_publicado", cartaId, publicado.id ?? null, {
      data: hoje,
      // O post que ele espelha, para o painel poder ligar os dois.
      post_do_dia: doDia.post_id,
      tipo: viva.carta.tipo ?? null,
      administradora: viva.carta.administradora ?? null,
      credito: viva.carta.credito ?? null,
      // Story some em 24h: sem isto, uma métrica lida depois não sabe se o
      // story sumiu por expiração ou por remoção.
      expira_em: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });

    return NextResponse.json({
      ok: true,
      publicado: true,
      story_id: publicado.id,
      carta_id: cartaId,
    });
  } catch (e) {
    const erro = e instanceof Error ? e.message.slice(0, 500) : "erro_desconhecido";
    console.error("[farol-story] erro no story diário:", erro);
    return NextResponse.json({ ok: false, erro }, { status: 500 });
  }
}
