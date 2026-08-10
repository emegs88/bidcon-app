// ============================================================================
// GET /api/admin/farol/heygen-inventario — PAINEL-VOZES-01 · o inventário cru
// AUTORIZADO: Emerson Gomes dos Santos — 10/08/2026, depois do reel perdido:
//   "um disparo de LEITURA em /admin/farol ('Listar vozes da HeyGen') que roda
//    no servidor com a HEYGEN_API_KEY que já vive lá (...) Só GET, sessão admin
//    como guarda, nada grava e nada gasta. (...) Mesmo desenho para os avatares."
// ----------------------------------------------------------------------------
// O PROBLEMA QUE ESTA ROTA APAGA. Até hoje, descobrir o id de uma voz exigia
// uma pessoa revelar a `HEYGEN_API_KEY` e colar um segredo num prompt local
// (`scripts/cacar-voz.mjs`). O segredo já vive na Vercel; o que faltava era um
// lugar de dentro que soubesse perguntar. É este arquivo.
//
// ESTA ROTA É CASCO, pelas duas razões de sempre (docs/ponto-cego-do-build.md):
// route handler do Next só admite um conjunto FECHADO de exports, e
// `scripts/testes.mjs` varre só `lib/`. Toda a lógica — paginação, orçamento,
// deduplicação, controle — mora em `lib/heygen.ts` e está sob teste.
//
// ----------------------------------------------------------------------------
// A GUARDA É UMA SÓ, E ISSO É DELIBERADO
// ----------------------------------------------------------------------------
// `checarAdminConsoleApi()` e mais nada. Não há confirmação nominal aqui, ao
// contrário de /api/admin/farol/arte e /disparar, e o desvio está declarado ao
// Emerson, não só neste comentário.
//
// A razão: a palavra existe naquelas rotas porque elas fazem algo
// IRREVERSÍVEL — aprovam uma arte, disparam uma publicação. Esta é GET puro:
// não grava, não publica, não gasta crédito (nenhum POST /v3/videos; só
// listagem). Exigir a palavra num botão inofensivo treinaria o operador a
// digitá-la por reflexo — e o valor daquela trava vem inteiro de ela ser rara.
// Gastar a trava aqui é enfraquecê-la exatamente onde ela importa.
//
// O SEGREDO NÃO SAI. `HEYGEN_API_KEY` é lida dentro de `lib/heygen.ts`, nunca
// atravessa esta resposta e nunca entra em log. O que sai é o normalizado:
// id, nome, idioma, gênero, premium, amostra. O objeto CRU fica de fora de
// propósito — uma conta com ~1000 vozes viraria megabytes numa tela, e o cru
// é justamente onde um campo inesperado da API poderia carregar coisa que não
// pedimos.
// ============================================================================
import { NextResponse } from "next/server";

import { checarAdminConsoleApi } from "@/lib/admin-console";
import { inventarioAvatares, inventarioVozes } from "@/lib/heygen";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Paginação de duas famílias, cada página com timeout de 20s. O orçamento de
// relógio da lib é 120s; 300 aqui deixa a lib decidir onde parar, em vez de a
// Vercel cortar a resposta no meio — resposta cortada não tem `parcial`, e é
// exatamente a lista curta com cara de completa que este trabalho combate.
export const maxDuration = 300;

export async function GET(req: Request) {
  const acesso = await checarAdminConsoleApi();
  if (!acesso.ok) {
    return NextResponse.json({ erro: acesso.motivo }, { status: acesso.status });
  }

  // Env conferida AQUI e devolvida com o NOME dela. Sem isto, chave ausente
  // viraria duas fontes com `env_ausente(HEYGEN_API_KEY)` no meio de um JSON —
  // legível para mim, e um "deu erro" mudo para quem está na tela.
  if (!process.env.HEYGEN_API_KEY) {
    return NextResponse.json(
      {
        erro: "HEYGEN_API_KEY ausente neste ambiente.",
        detalhe:
          "A env vive no projeto bidcon-plataforma na Vercel. Em preview, confira " +
          "se ela está marcada para o ambiente Preview e não só para Production.",
      },
      { status: 503 }
    );
  }

  const fonte = new URL(req.url).searchParams.get("fonte") ?? "vozes";
  if (fonte !== "vozes" && fonte !== "avatares") {
    return NextResponse.json(
      { erro: "fonte inválida — use `vozes` ou `avatares`." },
      { status: 400 }
    );
  }

  const inv =
    fonte === "vozes" ? await inventarioVozes() : await inventarioAvatares();

  // O log leva o formato da resposta, nunca o conteúdo dela e nunca a chave.
  console.log("[heygen-inventario]", {
    quem: acesso.email,
    fonte,
    itens: inv.itens.length,
    parcial: inv.parcial,
    fontes: inv.fontes.map((f) => `${f.nome}:${f.ok ? "ok" : "falhou"}(${f.n})`),
  });

  // 200 mesmo quando `parcial`. Um 5xx aqui esconderia as vozes que VIERAM, e
  // meio inventário responde a pergunta metade das vezes; um erro não responde
  // nunca. Quem lê tem `parcial`, `avisos` e `fontes[]` para saber o que tem
  // na mão — a resposta é honesta sem ser inútil.
  return NextResponse.json({ ok: true, fonte, ...inv });
}
