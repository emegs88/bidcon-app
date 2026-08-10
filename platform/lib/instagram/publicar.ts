// ============================================================================
// FAROL-POST item 6 — lib compartilhada de publicação no feed do @bidcon.br
// AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-POST", 06/08/2026 ~22h15:
// "reaproveitar a lógica existente: extrair a função de publicação de
//  /publicar para uma lib compartilhada SEM mudar o comportamento daquela
//  rota (diff funcional dela = zero); a rota do FAROL chama a lib."
// ----------------------------------------------------------------------------
// ESTE ARQUIVO É MUDANÇA DE ENDEREÇO, NÃO DE COMPORTAMENTO. Todo o corpo abaixo
// veio de app/api/instagram/publicar/route.ts (commit 44c19c3), que está em
// produção e com post inaugural comprovado (18132427570616550). O que mudou:
//   - `chamarGraph` e as constantes saíram da rota e vieram pra cá, IDÊNTICAS;
//   - a sequência "valida na view → container → publish com 1 retry" virou a
//     função `publicarCartaNoFeed`, que devolve um resultado DISCRIMINADO em
//     vez de montar NextResponse. Quem monta HTTP continua sendo a rota.
// Os `console.*` continuam com o prefixo literal `[ig-publicar]` de propósito:
// se eu trocasse o prefixo, o diff da rota deixaria de ser funcionalmente zero
// (log É comportamento observável — é por ele que se depura em produção). O
// FAROL acrescenta o `[farol]` dele por cima, não substitui este.
//
// POR QUE O RESULTADO É DISCRIMINADO E NÃO UM `{ok,erro}` SIMPLES: a rota
// devolve status HTTP diferente pra cada falha (500 consulta, 409 carta fora
// da vitrine, 502 Graph) e, no caso da publicação recusada, devolve TAMBÉM o
// `container_id` no corpo. Um `{ok:false, erro}` genérico apagaria essa
// distinção e mudaria a resposta da rota — exatamente o que a OS proíbe.
//
// AS DECISÕES ORIGINAIS SEGUEM VALENDO (repetidas aqui porque agora moram aqui):
//   - fluxo de DOIS passos: POST /<IG_USER_ID>/media → POST .../media_publish;
//   - v25.0, a mesma de lib/instagram/graph.ts, pra manter o produto numa
//     versão só (a doc usa placeholder <LATEST_API_VERSION>, sem número);
//   - a imagem é buscada PELO SERVIDOR DA META: a URL precisa ser absoluta e
//     pública, por isso host fixo de produção e não o host da request (num
//     preview seria uma URL atrás de SSO que a Meta não consegue ler);
//   - validação em `vw_vitrine_viva` e NÃO em `cartas.status` — é a MESMA fonte
//     que /api/card-image/[id] lê, então "carta_indisponivel" fica honesto em
//     vez de virar um 404 na image_url disfarçado de erro da Graph. A view
//     também não expõe `fornecedor_id`: a regra é cumprida por construção;
//   - o token NUNCA entra em log; o que entra é post_id, carta e o erro
//     literal da Graph (code/subcode/message), que é o diagnóstico.
// ============================================================================
import { createXtvClient } from "@/lib/supabase-xtv";

const IG_GRAPH_VERSION = "v25.0";

/** Host público de produção. Fixo de propósito — ver header. */
export const HOST_PUBLICO = "https://app.bidcon.com.br";

/** A Meta baixa a imagem dentro desta chamada; 20s dá folga pro fetch dela. */
const TIMEOUT_IG_MS = 20_000;

/** Colunas lidas na view. Explícitas (nunca `*`) e sem fornecedor_id. */
export const CAMPOS_CARTA = "id,tipo,credito,administradora";

export type RespostaGraph = { ok: boolean; id?: string; erro?: string };

/**
 * POST na Graph do Instagram. Nunca lança: env ausente e falha de rede viram
 * erro nomeado, no mesmo contrato de lib/instagram/graph.ts.
 * O erro da Graph é repassado LITERAL (code + message) — é o diagnóstico.
 */
export async function chamarGraph(
  caminho: string,
  corpo: Record<string, unknown>
): Promise<RespostaGraph> {
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) return { ok: false, erro: "env_ausente(IG_ACCESS_TOKEN)" };
  const igUserId = process.env.IG_USER_ID;
  if (!igUserId) return { ok: false, erro: "env_ausente(IG_USER_ID)" };

  const url = `https://graph.instagram.com/${IG_GRAPH_VERSION}/${igUserId}/${caminho}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_IG_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(corpo),
      signal: controller.signal,
    });
    const data: unknown = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      const err = (data as { error?: { message?: string; code?: number; error_subcode?: number } })
        ?.error;
      const partes = [
        err?.code !== undefined ? `code=${err.code}` : null,
        err?.error_subcode !== undefined ? `subcode=${err.error_subcode}` : null,
        err?.message ?? `http_${resp.status}`,
      ].filter(Boolean);
      return { ok: false, erro: partes.join(" ").slice(0, 800) };
    }

    const id = (data as { id?: string })?.id;
    if (!id) return { ok: false, erro: "resposta_sem_id" };
    return { ok: true, id };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, erro: `timeout_instagram_api(${TIMEOUT_IG_MS}ms)` };
    }
    return {
      ok: false,
      erro: e instanceof Error ? e.message.slice(0, 800) : "erro_desconhecido",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** O que a view devolve pro log de sucesso. */
export type CartaPublicada = {
  tipo?: string | null;
  credito?: number | null;
  administradora?: string | null;
};

// ---------------------------------------------------------------------------
// EXTRAÇÕES DA FAROL-VISUAL-02 (09/08/2026) — story e carrossel precisam das
// MESMAS três coisas que o post de feed já fazia inline aqui dentro. Os corpos
// abaixo saíram de `publicarCartaNoFeed` LITERAIS (mesmas mensagens, mesmos
// logs, mesmo retry de 3s) e ela passou a chamá-los. DIFF FUNCIONAL DAS ROTAS
// ATUAIS = ZERO — é a mesma doutrina que criou este arquivo.
//
// Por que extrair em vez de o story chamar `chamarGraph` por conta própria: o
// retry de 3s do media_publish não é detalhe, é a cobertura do caso em que a
// Meta ainda está baixando a imagem. Um story sem esse retry falharia de vez em
// quando, de um jeito que parece intermitência de rede e não regra faltando.
// ---------------------------------------------------------------------------

/** URL pública da arte. Host fixo de produção — ver header. */
export function urlCard(cartaId: string, query: string): string {
  return `${HOST_PUBLICO}/api/card-image/${cartaId}${query}`;
}

/**
 * Uuid sintético dos slides de texto fixo (capa e CTA do carrossel).
 * O gerador exige formato de uuid no caminho ANTES de olhar o `?slide=`, e os
 * slides fixos não leem o banco — então este valor passa no guard e morre ali.
 * Zeros, e não o id de uma carta real, porque um id real mentiria no log.
 */
export const UUID_SLIDE_FIXO = "00000000-0000-0000-0000-000000000000";

/**
 * A carta está viva na vitrine? Mesma fonte que a arte lê — por isso
 * "carta_indisponivel" fica honesto em vez de virar um 404 na image_url
 * disfarçado de erro da Graph.
 */
export async function lerCartaViva(
  cartaId: string
): Promise<
  | { ok: true; carta: CartaPublicada }
  | { ok: false; motivo: "falha_consulta" | "carta_indisponivel"; erro: string }
> {
  const db = createXtvClient();
  const { data, error } = await db
    .from("vw_vitrine_viva")
    .select(CAMPOS_CARTA)
    .eq("id", cartaId)
    .maybeSingle();

  if (error) {
    console.error("[ig-publicar] falha lendo a carta:", error.message);
    return {
      ok: false,
      motivo: "falha_consulta",
      erro: `falha_consulta: ${error.message}`,
    };
  }
  if (!data) {
    // Não existe, não está disponível, não é contemplada, crédito zerado ou
    // está reservada. Qualquer um destes faria a image_url devolver 404.
    return {
      ok: false,
      motivo: "carta_indisponivel",
      erro: "carta_indisponivel",
    };
  }
  return { ok: true, carta: data as CartaPublicada };
}

// ---------------------------------------------------------------------------
// RETENTATIVA — um mecanismo só, para os dois passos da publicação
// ---------------------------------------------------------------------------
// POR QUE ISTO FOI MEXIDO — 10/08/2026, medido, não preventivo.
//
// O post das 11h falhou com `code=9004 subcode=2207052 Only photo or video can
// be accepted as media type`. Investigado, o card estava SÃO: a mesma URL
// respondia 200, `image/png`, magic 89504e47, PNG 1080×1080 RGBA — e era
// indistinguível, no cabeçalho e no corpo, do card que a Meta ACEITOU em 09/08.
// Aquela mensagem é o envelope GENÉRICO da Meta para "não consegui buscar a
// mídia nesta URI"; ela não descreve o que a URI devolveu.
//
// E aí apareceu a assimetria que este bloco conserta: `publicarContainer` já
// tinha retentativa, com um comentário dizendo que ela existe "quando a Meta
// ainda está baixando a imagem" — mas quem BAIXA a imagem é o passo `media`, e
// era justamente ele que não tinha nenhuma. A retentativa estava no passo
// errado. Isto é conserto de defeito NOSSO, e vale independentemente de qual
// hipótese sobre a Meta esteja certa.
//
// UM MECANISMO, NÃO DOIS. `criarContainerImagem` e `publicarContainer` são
// irmãos e passaram a dividir esta função. Duas cópias da regra de retentativa
// seriam duas verdades sobre quando repetir — e a primeira a divergir venceria
// em silêncio.

/** Espera entre a 1ª e a 2ª tentativa. Um só valor para os dois passos. */
export const ESPERA_RETENTATIVA_MS = 3000;

/**
 * Erro que a segunda tentativa não tem como consertar. Hoje há exatamente um:
 * `chamarGraph` devolve `env_ausente(...)` ANTES de tocar a rede, então repetir
 * é dormir 3s para reler a mesma string. Todo o resto — inclusive OAuth e 4xx —
 * é retentado, porque eu NÃO consigo provar que são permanentes e o custo de
 * errar para este lado são três segundos dentro de um cron de 60s.
 */
export function inutilRepetir(erro: string | undefined): boolean {
  return (erro ?? "").startsWith("env_ausente(");
}

/**
 * UMA segunda tentativa, com espera, e o log que a torna medível.
 *
 * OS DOIS WARNS SÃO PARTE DO CONSERTO, não enfeite. Sem eles, uma retentativa
 * que salva o post do dia fica, no log, idêntica a uma que nunca precisou
 * existir — e daqui a um mês ninguém sabe dizer se ela alguma vez serviu. Um
 * conserto que não pode ser medido é indistinguível de um conserto que não
 * funciona.
 *
 * `esperaMs` é parâmetro com padrão, e não constante lida aqui dentro, para que
 * o teste consiga exercitar a ORQUESTRAÇÃO (quantas chamadas, qual resultado
 * volta) passando 0 — em vez de a suíte dormir 3s de verdade, ou de a regra
 * ficar sem teste nenhum, que é o desfecho de sempre quando testar dói.
 */
export async function comRetentativa(
  rotulo: string,
  tentar: () => Promise<RespostaGraph>,
  esperaMs: number = ESPERA_RETENTATIVA_MS
): Promise<RespostaGraph> {
  const primeira = await tentar();
  if (primeira.ok || inutilRepetir(primeira.erro)) return primeira;

  console.warn(`[ig-publicar] ${rotulo} recusado — 2ª tentativa em ${esperaMs}ms:`, {
    erro: primeira.erro,
  });
  if (esperaMs > 0) await new Promise((r) => setTimeout(r, esperaMs));

  const segunda = await tentar();
  if (segunda.ok) {
    console.warn(`[ig-publicar] ${rotulo} aceito na 2ª tentativa:`, {
      erro_1: primeira.erro,
    });
  } else {
    console.error(`[ig-publicar] ${rotulo} recusado nas DUAS tentativas:`, {
      erro_1: primeira.erro,
      erro_2: segunda.erro,
    });
  }
  return segunda;
}

/**
 * Cria o container de IMAGEM, com UMA segunda tentativa. É o passo em que a
 * Meta baixa o nosso card — ou seja, o passo que falhou em 10/08.
 *
 * REPETIR AQUI É SEGURO, e esta é a parte que precisa ficar escrita: se a 1ª
 * chamada tiver dado certo do lado da Meta e a resposta se perdido (timeout de
 * 20s), a 2ª cria um SEGUNDO container. Container é rascunho: só vira post se
 * alguém chamar `media_publish` com o id dele, e nós só publicamos o id que
 * volta desta função. O container órfão expira sozinho em 24h. Ou seja: o pior
 * caso é lixo invisível, nunca post duplicado no perfil.
 *
 * ESCOPO DECLARADO — troquei UM ponto de chamada, o do feed, que é o que
 * falhou. `/api/farol/story` e `/api/farol/carrossel` também chamam `media` com
 * a mesma natureza (a Meta baixa uma imagem nossa) e têm o mesmo defeito
 * latente; estão desarmados e n=0, então não os mexi às cegas de carona num
 * conserto medido. `/api/farol/reel-publicar` fica de fora de propósito: lá o
 * container é vídeo e aquele arquivo já argumenta, por escrito, por que não
 * retenta.
 */
export async function criarContainerImagem(
  campos: Record<string, unknown>
): Promise<RespostaGraph> {
  return comRetentativa("container", () => chamarGraph("media", campos));
}

/**
 * Publica um container já criado, com UMA segunda tentativa após 3s.
 * Container de IMAGEM costuma nascer pronto, mas a Meta não garante: quando
 * ela ainda está baixando a imagem, o media_publish responde erro transitório.
 * Uma segunda tentativa depois de 3s cobre esse caso sem virar loop. Falhou
 * duas vezes, devolve o erro literal — o container fica lá, não vira post.
 *
 * O CORPO virou uma chamada a `comRetentativa` (10/08/2026): mesmo número de
 * tentativas, mesma espera, mesma ordem. As duas únicas diferenças de
 * comportamento são ganhos — sai 3s mais cedo quando falta env (devolvendo o
 * mesmo erro literal), e agora escreve no log que houve segunda tentativa.
 */
export async function publicarContainer(
  creationId: string
): Promise<RespostaGraph> {
  return comRetentativa("publicação", () =>
    chamarGraph("media_publish", { creation_id: creationId })
  );
}

export type ResultadoPublicacao =
  | { ok: true; postId: string; carta: CartaPublicada }
  | { ok: false; motivo: "falha_consulta"; erro: string; status: 500 }
  | { ok: false; motivo: "carta_indisponivel"; erro: "carta_indisponivel"; status: 409 }
  | { ok: false; motivo: "container_recusado"; erro: string; status: 502 }
  | {
      ok: false;
      motivo: "publicacao_recusada";
      erro: string;
      containerId?: string;
      status: 502;
    };

/**
 * Valida a carta na vitrine viva, monta o container e publica.
 * Não valida entrada (carta_id/legenda vazios) — isso é contrato de quem chama.
 * Nunca lança; toda falha vira um ramo de `ResultadoPublicacao`.
 */
export async function publicarCartaNoFeed(params: {
  cartaId: string;
  legenda: string;
}): Promise<ResultadoPublicacao> {
  const { cartaId, legenda } = params;

  // ---- 1. A carta está viva? (mesma fonte que a arte — ver header) ---------
  // O corpo desta checagem mora agora em `lerCartaViva`. Os dois ramos de falha
  // continuam devolvendo os MESMOS motivos e os MESMOS status (500 e 409) — o
  // status é o que a rota manual escreve no HTTP, e mexer nele quebraria o
  // contrato dela.
  const viva = await lerCartaViva(cartaId);
  if (!viva.ok) {
    return viva.motivo === "falha_consulta"
      ? { ok: false, motivo: "falha_consulta", erro: viva.erro, status: 500 }
      : { ok: false, motivo: "carta_indisponivel", erro: "carta_indisponivel", status: 409 };
  }
  const carta = viva.carta;

  // VISUAL-KIT-APLICADO-01 (06/08/2026 ~23h30): `?formato=feed` = 1080×1080.
  // Sem ele, sai o card do WhatsApp (1200×630). O Instagram ACEITA 1.91:1 no
  // feed — o post inaugural provou —, mas o GRID do perfil é quadrado e corta
  // as laterais: o crédito, que é a única coisa que faz alguém parar de rolar,
  // some. E o kit v3 nunca aparece. O quadrado resolve os dois.
  //
  // ISTO MUDA TAMBÉM A ARTE DA ROTA MANUAL /api/instagram/publicar, que chama
  // esta mesma função. É intencional, e é o certo: as duas publicam no MESMO
  // feed, e um grid com duas proporções diferentes seria pior do que qualquer
  // uma das duas sozinha. Declarado porque a OS anterior exigia diff funcional
  // zero naquela rota — este é o único ponto em que ela muda, e por decisão.
  const imageUrl = urlCard(cartaId, "?formato=feed");

  // ---- 2. Container ------------------------------------------------------
  // A retentativa mora em `criarContainerImagem` — ver lá POR QUE ela nasceu
  // aqui e não no passo de publicar (10/08/2026).
  const container = await criarContainerImagem({
    image_url: imageUrl,
    caption: legenda,
  });
  if (!container.ok) {
    console.error("[ig-publicar] container recusado:", {
      carta_id: cartaId,
      image_url: imageUrl,
      erro: container.erro,
    });
    return {
      ok: false,
      motivo: "container_recusado",
      erro: container.erro ?? "erro_desconhecido",
      status: 502,
    };
  }

  // ---- 3. Publicar -------------------------------------------------------
  // O retry de 3s mora agora em `publicarContainer` — mesmo número de
  // tentativas, mesma espera, mesma ordem.
  const publicado = await publicarContainer(container.id as string);

  if (!publicado.ok) {
    console.error("[ig-publicar] publicação recusada:", {
      carta_id: cartaId,
      container_id: container.id,
      erro: publicado.erro,
    });
    return {
      ok: false,
      motivo: "publicacao_recusada",
      erro: publicado.erro ?? "erro_desconhecido",
      containerId: container.id,
      status: 502,
    };
  }

  console.log("[ig-publicar] publicado:", {
    post_id: publicado.id,
    carta_id: cartaId,
    // Os `as CartaPublicada` que existiam aqui sumiram porque `lerCartaViva` já
    // devolve o tipo; o que sai no log é byte a byte o mesmo.
    tipo: carta.tipo ?? null,
    administradora: carta.administradora ?? null,
    credito: carta.credito ?? null,
  });

  return { ok: true, postId: publicado.id as string, carta };
}
