// ============================================================================
// FAROL-VISUAL-02 Entrega 2 — GET /api/farol/carrossel · "A tabela da semana"
// AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-VISUAL-02", 09/08/2026.
// NASCE DESARMADO. Sem FAROL_CARROSSEL=on, esta rota não publica nada.
// ----------------------------------------------------------------------------
// O QUE A DOC DISSE (Regra nº 1 — Instagram Platform · Content Publishing e a
// referência de IG User Media, medidas em 09/08/2026):
//
//   (a) FILHO: `is_carousel_item` é um Boolean OPCIONAL — "Indicates image or
//       video appears in a carousel". O filho é um container comum, criado no
//       mesmo POST /<IG_USER_ID>/media, SEM caption (a legenda é do pai).
//   (b) PAI: `media_type=CAROUSEL` + `children` = "An array of up to 10
//       container IDs". Depois, media_publish do PAI.
//   (c) TETO DA CONTA: 100 publicações por API em janela móvel de 24h, e o
//       carrossel conta como UMA publicação. Com post + story + reel diários e
//       1 carrossel por semana, o pico é 4/dia = 4% do teto.
//
// DIVERGÊNCIA DECLARADA CONTRA A OS: ela diz "limites de 2 a 10 itens". A doc
// diz "up to 10" e NÃO estabelece mínimo de 2 em lugar nenhum. Não escrevi
// validação de mínimo em cima de uma premissa que não consegui confirmar — o
// que a rota exige é o que ela mesma precisa: as 6 cartas da tabela. Com menos
// de 6 cartas elegíveis ela ABORTA, o que é mais estrito que qualquer mínimo da
// Meta e torna a questão inócua na prática.
//
// ---------------------------------------------------------------------------
// OS 8 FILHOS: capa (texto fixo) + 6 cartas + CTA (texto fixo). Oito, dentro do
// teto de dez. As duas pontas não leem o banco — ver o bloco de comentário em
// app/api/card-image/[id]/route.tsx sobre por que isso REMOVE uma causa de
// falha do conjunto, e não é economia de query.
//
// "ABORTAR O CONJUNTO SE UM FILHO FALHAR" é regra da OS e está cumprida ao pé
// da letra: no primeiro filho recusado a rota sai, sem criar o pai. Os
// containers já criados ficam órfãos e expiram sozinhos em 24h — nunca viram
// post. Um carrossel com slide faltando é pior que carrossel nenhum.
//
// ---------------------------------------------------------------------------
// IDEMPOTÊNCIA EM TRÊS DEGRAUS (a OS pede "gravar os ids dos filhos e o do pai
// antes do publish, para retomar sem duplicar"):
//   1. `carrossel_publicado` do dia existe? Sai. É o degrau que impede post
//      duplicado — o único erro desta rota que o seguidor VÊ.
//   2. `carrossel_pai` do dia existe? Vai DIRETO para o media_publish daquele
//      pai. É o caso do timeout depois de criar o pai: os 8 filhos e o pai já
//      custaram 9 chamadas à Graph, e refazê-los criaria 9 containers órfãos
//      por tentativa.
//   3. Nada gravado? Caminho completo.
// LIMITE HONESTO DESTE DESENHO: container da Meta expira em 24h. A retomada só
// vale dentro do mesmo dia — o que é exatamente o alcance do cron semanal. Uma
// retomada na semana seguinte encontraria um `creation_id` morto e devolveria
// erro da Graph, o que é o comportamento certo: melhor um erro claro do que
// republicar a tabela da semana passada como se fosse a desta.
//
// ---------------------------------------------------------------------------
// DECISÃO DECLARADA — O CARROSSEL NÃO USA A MEMÓRIA ANTI-REPETIÇÃO.
// `publicadasRecentemente()` existe para o post diário não repetir carta. Aqui
// ela seria um erro: a promessa do formato é "as melhores da semana", e uma
// carta ótima ficaria de fora só porque virou post na terça. O leitor não sabe
// nem se importa com o que foi postado antes; ele quer a tabela certa. Então
// a memória entra VAZIA (`memoriaVazia()`), de propósito. Consequência real:
// uma carta pode aparecer no post do dia e no carrossel de sábado. Aceito — é
// reforço, não repetição.
//
// COLISÃO DE CRON DECLARADA: `post-diario` roda "0 14 * * *", TODO dia, sábado
// inclusive. O cron desta rota, pedido pela OS, é sábado 14:00 UTC — o MESMO
// minuto. As duas rotas não disputam nada (não compartilham estado e o teto de
// 100/24h nem é arranhado), mas no sábado o perfil recebe duas publicações
// juntas. Implementei como pedido e declaro o fato: mover para 14:30 seria uma
// decisão de pauta, e pauta é do Emerson.
// ============================================================================
import { NextResponse } from "next/server";
import { createXtvClient } from "@/lib/supabase-xtv";
import {
  chamarGraph,
  publicarContainer,
  urlCard,
  UUID_SLIDE_FIXO,
} from "@/lib/instagram/publicar";
import {
  autorizadoFarol,
  hojeSP,
  candidatos,
  memoriaVazia,
  revisarLegenda,
  registrar,
} from "@/lib/farol/selecao";
import {
  CARTAS_POR_CARROSSEL,
  intercalar,
  montarLegendaCarrossel,
} from "@/lib/farol/carrossel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Oito filhos + pai + publish = 10 chamadas à Graph, cada uma com timeout de
// 20s na lib. O pior caso teórico passa de 60s; 180s dá folga sem prender a
// lambda para sempre.
export const maxDuration = 180;

/** URL de um slide de texto fixo. Uuid sintético — ver `UUID_SLIDE_FIXO`. */
function urlSlideFixo(qual: "capa" | "cta"): string {
  return urlCard(UUID_SLIDE_FIXO, `?formato=feed&slide=${qual}`);
}

export async function GET(req: Request) {
  if (!autorizadoFarol(req)) {
    return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  }

  if (process.env.FAROL_CARROSSEL !== "on") {
    console.log("[farol-carrossel] represado (desarmado)");
    return NextResponse.json({ ok: true, publicado: false, motivo: "desarmado" });
  }

  const db = createXtvClient();
  const { data: hoje } = hojeSP();

  try {
    // ---- Degrau 1: já publiquei hoje? ------------------------------------
    const { data: jaFeito, error: errJa } = await db
      .from("farol_posts")
      .select("post_id")
      .eq("acao", "carrossel_publicado")
      .eq("detalhe->>data", hoje)
      .limit(1);
    if (errJa) throw new Error(`farol_posts_ilegivel: ${errJa.message}`);
    if (jaFeito && jaFeito.length > 0) {
      console.log("[farol-carrossel] já publicado hoje:", {
        data: hoje,
        post_id: (jaFeito[0] as { post_id: string | null }).post_id,
      });
      return NextResponse.json({ ok: true, publicado: false, motivo: "ja_publicado" });
    }

    // ---- Degrau 2: existe pai pendente de hoje? --------------------------
    const { data: paiPendente, error: errPai } = await db
      .from("farol_posts")
      .select("post_id,detalhe")
      .eq("acao", "carrossel_pai")
      .eq("detalhe->>data", hoje)
      .order("criado_em", { ascending: false })
      .limit(1);
    if (errPai) throw new Error(`farol_posts_ilegivel: ${errPai.message}`);

    const pendente = (paiPendente ?? [])[0] as
      | { post_id: string | null; detalhe: Record<string, unknown> | null }
      | undefined;

    if (pendente?.post_id) {
      console.log("[farol-carrossel] retomando pai já criado:", {
        data: hoje,
        container_pai: pendente.post_id,
      });
      return await publicarPai(db, hoje, pendente.post_id, {
        cartas: (pendente.detalhe?.cartas as string[]) ?? [],
        retomado: true,
      });
    }

    // ---- Seleção: as 6 melhores, intercalando os tipos -------------------
    // Memória VAZIA de propósito — ver header.
    const vazio = memoriaVazia();
    const [imoveis, veiculos] = await Promise.all([
      candidatos(db, { tipo: "imovel" }, vazio),
      candidatos(db, { tipo: "veiculo" }, vazio),
    ]);
    const cartas = intercalar(imoveis, veiculos, CARTAS_POR_CARROSSEL);

    if (cartas.length < CARTAS_POR_CARROSSEL) {
      // Menos de 6 é tabela pela metade. Não publica meia tabela.
      console.error("[farol-carrossel] estoque insuficiente:", {
        data: hoje,
        encontradas: cartas.length,
        imoveis: imoveis.length,
        veiculos: veiculos.length,
      });
      await registrar(db, "carrossel_falhou", null, null, {
        data: hoje,
        motivo: "estoque_insuficiente",
        encontradas: cartas.length,
      });
      return NextResponse.json({
        ok: false,
        motivo: "estoque_insuficiente",
        encontradas: cartas.length,
      });
    }

    // ---- Legenda + compliance --------------------------------------------
    const legenda = montarLegendaCarrossel(cartas);
    const reprovada = revisarLegenda(legenda);
    if (reprovada) {
      console.error("[farol-carrossel] legenda reprovada no compliance:", reprovada);
      await registrar(db, "carrossel_falhou", null, null, {
        data: hoje,
        motivo: "legenda_reprovada",
        erro: reprovada,
      });
      return NextResponse.json(
        { ok: false, erro: `legenda_reprovada:${reprovada}` },
        { status: 500 }
      );
    }

    // ---- Os 8 filhos, em ordem -------------------------------------------
    // Sequencial, não `Promise.all`: cada criação faz a Meta BAIXAR a arte da
    // nossa própria rota. Oito downloads simultâneos do mesmo lambda de
    // renderização é a forma mais fácil de transformar arte lenta em filho
    // recusado — e um filho recusado aborta o conjunto inteiro.
    const urls: string[] = [
      urlSlideFixo("capa"),
      ...cartas.map((c) => urlCard(c.id, "?formato=feed")),
      urlSlideFixo("cta"),
    ];

    const filhos: string[] = [];
    for (const [idx, url] of urls.entries()) {
      const filho = await chamarGraph("media", {
        image_url: url,
        is_carousel_item: true,
      });
      if (!filho.ok) {
        console.error("[farol-carrossel] filho recusado — abortando o conjunto:", {
          data: hoje,
          slide: idx + 1,
          de: urls.length,
          image_url: url,
          erro: filho.erro,
          filhos_orfaos: filhos,
        });
        await registrar(db, "carrossel_falhou", null, null, {
          data: hoje,
          motivo: "filho_recusado",
          slide: idx + 1,
          image_url: url,
          erro: filho.erro,
          // Os órfãos ficam registrados: sem isso, containers criados e nunca
          // usados sumiriam do diário e ninguém saberia que existiram.
          filhos_orfaos: filhos,
        });
        return NextResponse.json({
          ok: false,
          motivo: "filho_recusado",
          slide: idx + 1,
          erro: filho.erro,
        });
      }
      filhos.push(filho.id as string);
    }

    // ---- Grava os filhos ANTES do pai (ordem da OS) -----------------------
    await registrar(db, "carrossel_filhos", null, null, {
      data: hoje,
      filhos,
      cartas: cartas.map((c) => c.id),
    });

    // ---- O pai ------------------------------------------------------------
    const pai = await chamarGraph("media", {
      media_type: "CAROUSEL",
      children: filhos.join(","),
      caption: legenda,
    });
    if (!pai.ok) {
      console.error("[farol-carrossel] container-pai recusado:", {
        data: hoje,
        filhos,
        erro: pai.erro,
      });
      await registrar(db, "carrossel_falhou", null, null, {
        data: hoje,
        motivo: "pai_recusado",
        filhos,
        erro: pai.erro,
      });
      return NextResponse.json({ ok: false, motivo: "pai_recusado", erro: pai.erro });
    }

    // ---- Grava o pai ANTES do publish (ordem da OS) -----------------------
    // É esta linha que torna o degrau 2 possível.
    await registrar(db, "carrossel_pai", null, pai.id ?? null, {
      data: hoje,
      filhos,
      cartas: cartas.map((c) => c.id),
    });

    return await publicarPai(db, hoje, pai.id as string, {
      cartas: cartas.map((c) => c.id),
      retomado: false,
    });
  } catch (e) {
    const erro = e instanceof Error ? e.message.slice(0, 500) : "erro_desconhecido";
    console.error("[farol-carrossel] erro no carrossel semanal:", erro);
    return NextResponse.json({ ok: false, erro }, { status: 500 });
  }
}

/**
 * O publish do pai, isolado porque os dois caminhos (completo e retomada)
 * terminam aqui — e terminar em lugares diferentes era o jeito garantido de a
 * retomada gravar um `detalhe` diferente do caminho normal.
 */
async function publicarPai(
  db: ReturnType<typeof createXtvClient>,
  hoje: string,
  containerPai: string,
  ctx: { cartas: string[]; retomado: boolean }
) {
  const publicado = await publicarContainer(containerPai);
  if (!publicado.ok) {
    console.error("[farol-carrossel] publicação recusada:", {
      data: hoje,
      container_pai: containerPai,
      retomado: ctx.retomado,
      erro: publicado.erro,
    });
    await registrar(db, "carrossel_falhou", null, null, {
      data: hoje,
      motivo: "publicacao_recusada",
      container_pai: containerPai,
      retomado: ctx.retomado,
      erro: publicado.erro,
    });
    return NextResponse.json({
      ok: false,
      motivo: "publicacao_recusada",
      container_pai: containerPai,
      erro: publicado.erro,
    });
  }

  console.log("[farol-carrossel] carrossel publicado:", {
    data: hoje,
    post_id: publicado.id,
    cartas: ctx.cartas,
    retomado: ctx.retomado,
  });
  await registrar(db, "carrossel_publicado", null, publicado.id ?? null, {
    data: hoje,
    container_pai: containerPai,
    cartas: ctx.cartas,
    retomado: ctx.retomado,
  });

  return NextResponse.json({
    ok: true,
    publicado: true,
    post_id: publicado.id,
    cartas: ctx.cartas,
    retomado: ctx.retomado,
  });
}
