// ============================================================================
// FAROL-REEL-01 · rota 1 — GET /api/farol/reel-opcoes · O CARDÁPIO
// AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-REEL-01", 06/08/2026:
// "lista vozes PT-BR (id+nome+gênero, até 20), avatares (id+nome, até 20) e
//  talking photos da conta (id+nome) — cardápio pro Emerson; NUNCA escolher
//  por ele."
// ----------------------------------------------------------------------------
// POR QUE ESTA ROTA EXISTE, e por que ela é a primeira das três: `HEYGEN_API_KEY`
// está só na Vercel, não no .env.local. Eu NÃO CONSIGO ver a conta daqui. Então
// não sei o id do "Porta-voz Bidcon" nem o id da voz "Brazilian Consultant" —
// e chutar um id seria escolher por ele com cara de medição. Esta rota é o
// instrumento: roda em produção, onde a chave existe, e devolve a lista para o
// Emerson apontar. SÓ LÊ. Não dispara render, não publica, não grava nada.
//
// GUARD: Bearer DISPARO_SECRET, copiado literal de /api/instagram/diag — é a
// mesma natureza (rota de leitura/diagnóstico operada à mão). NÃO usei o
// FAROL_SECRET||CRON_SECRET das outras duas de propósito: aquele é o poder de
// PUBLICAR no perfil, e o cron da Vercel o manda sozinho. Um cardápio não
// precisa desse poder e não deve compartilhar chave com ele.
//
// ---------------------------------------------------------------------------
// O IDIOMA DA VOZ É UMA MEDIÇÃO QUE EU NÃO PUDE FAZER. O OpenAPI da v3 diz que
// `GET /v3/voices?language=` recebe o idioma "por extenso" e exemplifica com
// 'English' — não diz se o português da conta está indexado como 'Portuguese',
// 'Portuguese (Brazil)' ou 'pt-BR'. Em vez de chutar UM e devolver lista vazia
// (que o Emerson leria como "não tem voz PT-BR na conta", uma conclusão falsa),
// esta rota TENTA OS TRÊS, junta, deduplica por id e ainda peneira por
// substring no nome/idioma. Se os três voltarem vazios, ela busca SEM filtro e
// peneira localmente — e diz, no campo `avisos`, que fez isso. Prefiro a rota
// dizer como chegou na lista a ela parecer certa por acaso.
//
// AS TRÊS FAMÍLIAS SÃO LISTADAS SEPARADAS, e não fundidas numa lista só:
//   `avatares`        — GET /v3/avatars/looks (privados, qualquer tipo)
//   `talking_photos`  — GET /v3/avatars/looks?avatar_type=photo_avatar
//   `talking_photos_legado` — GET /v1/talking_photo.list (fora do OpenAPI atual,
//                       mas responde 401 e não 404: existe)
// Se o Porta-voz estiver cadastrado pelo caminho antigo, é na TERCEIRA que ele
// aparece — e o tipo em que ele aparece é o que determina o valor de
// HEYGEN_AVATAR_TIPO. Fundir as listas apagaria justamente essa informação.
//
// FALHA PARCIAL NÃO DERRUBA O CARDÁPIO: cada listagem que falhar vira uma linha
// em `avisos` com o erro literal, e as outras continuam sendo devolvidas. Uma
// conta sem acesso ao endpoint legado ainda precisa conseguir ver as vozes.
//
// SEGREDO: a chave nunca entra na resposta nem em log. O que aparece é o erro
// literal da API (status + mensagem), que é o diagnóstico.
// ============================================================================
import { NextResponse } from "next/server";
import {
  listarVozes,
  listarLooks,
  listarTalkingPhotos,
  type OpcaoVoz,
  type OpcaoAvatar,
} from "@/lib/heygen";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Guard idêntico ao de /api/instagram/diag e /api/whatsapp/disparo. */
function autorizado(req: Request): boolean {
  const secret = process.env.DISPARO_SECRET;
  if (!secret) return false; // sem secret configurado => não roda
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/** Rótulos de idioma que a conta PODE estar usando — ver header. */
const IDIOMAS_TENTADOS = ["Portuguese", "Portuguese (Brazil)", "pt-BR"];

/** Peneira local: o que "parece" português do Brasil no nome ou no idioma. */
function pareceBr(v: OpcaoVoz): boolean {
  const alvo = `${v.idioma ?? ""} ${v.nome}`.toLowerCase();
  return (
    alvo.includes("portug") ||
    alvo.includes("brazil") ||
    alvo.includes("brasil") ||
    alvo.includes("pt-br") ||
    alvo.includes("pt_br")
  );
}

const TETO_VOZES = 20;
const TETO_AVATARES = 20;

export async function GET(req: Request) {
  if (!autorizado(req)) {
    return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  }

  const avisos: string[] = [];

  // ---- Vozes -------------------------------------------------------------
  // Um Map por id: as três tentativas se sobrepõem de propósito, e a mesma voz
  // não pode aparecer três vezes no cardápio.
  const porId = new Map<string, OpcaoVoz>();
  for (const idioma of IDIOMAS_TENTADOS) {
    const r = await listarVozes(idioma, 100);
    if (!r.ok) {
      avisos.push(`vozes(language=${idioma}): ${r.erro}`);
      continue;
    }
    for (const v of r.data) if (!porId.has(v.id)) porId.set(v.id, v);
  }

  let vozes = [...porId.values()].filter(pareceBr);
  let origemVozes = "filtro_por_idioma";

  if (vozes.length === 0) {
    // Nenhum dos três rótulos deu resultado. Pode ser que a conta indexe o
    // idioma com outro nome — então busca sem filtro e peneira aqui. Isso é
    // dito na resposta; não é para o Emerson descobrir sozinho.
    const r = await listarVozes("", 100);
    if (!r.ok) {
      avisos.push(`vozes(sem filtro): ${r.erro}`);
    } else {
      vozes = r.data.filter(pareceBr);
      origemVozes = "sem_filtro_peneirado_localmente";
      avisos.push(
        "nenhum dos rótulos de idioma tentados devolveu voz; a lista veio da " +
          "busca sem filtro, peneirada por 'portug|brazil|brasil|pt-br'"
      );
    }
  }

  // ---- Avatares e talking photos -----------------------------------------
  const avatares: OpcaoAvatar[] = [];
  const rLooks = await listarLooks(null, TETO_AVATARES);
  if (rLooks.ok) avatares.push(...rLooks.data);
  else avisos.push(`avatares(/v3/avatars/looks): ${rLooks.erro}`);

  const talkingPhotos: OpcaoAvatar[] = [];
  const rFotos = await listarLooks("photo_avatar", TETO_AVATARES);
  if (rFotos.ok) talkingPhotos.push(...rFotos.data);
  else avisos.push(`talking_photos(v3 photo_avatar): ${rFotos.erro}`);

  const legado: OpcaoAvatar[] = [];
  const rLegado = await listarTalkingPhotos();
  if (rLegado.ok) legado.push(...rLegado.data);
  else avisos.push(`talking_photos_legado(/v1/talking_photo.list): ${rLegado.erro}`);

  console.log("[farol-reel] cardápio consultado:", {
    vozes: vozes.length,
    avatares: avatares.length,
    talking_photos: talkingPhotos.length,
    talking_photos_legado: legado.length,
    avisos: avisos.length,
  });

  return NextResponse.json({
    ok: true,
    // Como cada id vira env. Está aqui para o Emerson não precisar cruzar com a
    // OS — mas a ESCOLHA é dele: esta rota não marca nenhum como padrão.
    como_usar: {
      HEYGEN_VOICE_ID: "id de `vozes`",
      HEYGEN_AVATAR_ID: "id de `avatares`, `talking_photos` ou `talking_photos_legado`",
      HEYGEN_AVATAR_TIPO:
        "'avatar' se o id veio de `avatares` ou `talking_photos` (v3, padrão); " +
        "'talking_photo' SOMENTE se o id veio de `talking_photos_legado`",
    },
    origem_vozes: origemVozes,
    vozes: vozes.slice(0, TETO_VOZES).map((v) => ({
      id: v.id,
      nome: v.nome,
      genero: v.genero,
      idioma: v.idioma,
    })),
    avatares: avatares.slice(0, TETO_AVATARES).map((a) => ({
      id: a.id,
      nome: a.nome,
      tipo: a.tipo,
    })),
    talking_photos: talkingPhotos.slice(0, TETO_AVATARES).map((a) => ({
      id: a.id,
      nome: a.nome,
      tipo: a.tipo,
    })),
    talking_photos_legado: legado.slice(0, TETO_AVATARES).map((a) => ({
      id: a.id,
      nome: a.nome,
    })),
    avisos,
  });
}
