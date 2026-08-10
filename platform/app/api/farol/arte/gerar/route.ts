// ============================================================================
// POST /api/farol/arte/gerar — FAROL-ARTE-02 · gerar arte e deixar PENDENTE
// AUTORIZADO: Emerson Gomes dos Santos — 10/08/2026, respondendo à pergunta
// "qual modelo, qual chave" do relatório da noite:
//   "(gpt-image-2, OPENAI_API_KEY, rota /api/farol/arte/gerar"
// ----------------------------------------------------------------------------
// ESTA ROTA É CASCO. Valida a entrada, chama a lib, devolve JSON. Toda a
// lógica — kill switch, teto, prompt, dimensão, upload, insert — mora em
// `lib/farol/gerar-arte.ts`, por dois motivos que já custaram caro:
//   · route handler do Next só admite um conjunto FECHADO de exports, e uma
//     constante exportada daqui reprova o `next build` sem que o `tsc --noEmit`
//     veja (docs/ponto-cego-do-build.md);
//   · `scripts/testes.mjs` varre só `lib/` — lógica em `app/` não tem teste, e
//     código que GASTA DINHEIRO é o último que pode viver sem teste.
//
// ----------------------------------------------------------------------------
// AS TRÊS FECHADURAS, E POR QUE SÃO TRÊS E NÃO UMA
// ----------------------------------------------------------------------------
// Cada uma responde a uma pergunta diferente, e nenhuma responde a duas:
//
//   1. GUARD `DISPARO_SECRET` — "quem está chamando?". É o mesmo segredo de
//      /api/farol/reel-opcoes e /api/instagram/diag: rotas operadas À MÃO.
//      NÃO uso `FAROL_SECRET || CRON_SECRET` de propósito, e aqui a razão é
//      mais forte do que a do reel-opcoes: aquele segredo é o que o cron da
//      Vercel manda SOZINHO. Uma rota que gasta dinheiro não pode ser
//      alcançável por algo que dispara sem humano. Se um dia alguém apontar um
//      cron para cá por engano, o segredo errado é o que impede a fatura.
//
//   2. KILL SWITCH `FAROL_ARTE_GERAR` — "esta fatia está ligada?". Vive na lib
//      e nasce desarmado. Segredo certo com switch desarmado não gasta nada.
//      São perguntas independentes: chave vazada não liga a fatia, e fatia
//      ligada não dispensa a chave.
//
//   3. TETO de 3 por chamada — "quanto, no máximo?". Vive na lib e não é
//      configurável pelo corpo do POST. O corpo vem de fora; um array com 50
//      categorias, por engano ou não, seriam 50 chamadas pagas.
//
// ----------------------------------------------------------------------------
// O QUE ESTA ROTA NÃO FAZ, E NÃO PODE PASSAR A FAZER
// ----------------------------------------------------------------------------
// Não escreve `status`. A 0076 diz no comentário da tabela que 'aprovada' é
// escrito SÓ pelo painel de curadoria, com confirmação nominal, e que nada no
// código automatiza essa transição. A linha nasce 'pendente' pelo DEFAULT da
// tabela — nem um erro de digitação no insert poderia aprovar uma arte.
// Quem aprova é /api/admin/farol/arte, que é outro arquivo, com outra guarda,
// e exige uma pessoa digitando uma palavra.
// ============================================================================
import { NextResponse } from "next/server";

import { createXtvClient } from "@/lib/supabase-xtv";
import { CATEGORIAS, type Categoria } from "@/lib/farol/prompts-arte";
import {
  MODELO,
  QUALIDADE,
  TAMANHO,
  TETO_POR_CHAMADA,
  gerarArteLigado,
  gerarLote,
} from "@/lib/farol/gerar-arte";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Três imagens em SÉRIE, e geração de imagem leva dezenas de segundos cada.
// Abaixo disso a rota é cortada no meio da terceira — que já foi paga.
export const maxDuration = 300;

export async function POST(req: Request) {
  // 1ª fechadura — quem chama.
  const secret = process.env.DISPARO_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ erro: "não autorizado." }, { status: 401 });
  }

  // 2ª fechadura — a fatia está ligada? Conferida ANTES de ler o corpo: nada
  // que venha de fora precisa ser interpretado para responder "está desligado".
  if (!gerarArteLigado()) {
    return NextResponse.json(
      { ok: false, erro: "geração de arte desarmada (FAROL_ARTE_GERAR)." },
      { status: 409 }
    );
  }

  const corpo = (await req.json().catch(() => ({}))) as {
    categorias?: unknown;
  };

  const pedidas = Array.isArray(corpo.categorias) ? corpo.categorias : [];
  if (pedidas.length === 0) {
    return NextResponse.json(
      { erro: "informe `categorias`: lista não vazia." },
      { status: 400 }
    );
  }

  // Categoria inválida é 400, não é ignorada em silêncio: gerar 2 de 3 porque
  // a terceira estava mal escrita é o tipo de sucesso parcial que o operador lê
  // como sucesso e só descobre ao montar o card.
  const invalidas = pedidas.filter(
    (c) => typeof c !== "string" || !(CATEGORIAS as readonly string[]).includes(c)
  );
  if (invalidas.length > 0) {
    return NextResponse.json(
      { erro: `categoria inválida: ${invalidas.map(String).join(", ")}` },
      { status: 400 }
    );
  }

  // 3ª fechadura — o teto, aplicado dentro de `gerarLote`. A rota NÃO corta a
  // lista por conta própria: um teto aplicado em dois lugares é um teto que um
  // dia diverge. Ela só AVISA que cortou, para o operador não achar que pediu
  // cinco e recebeu cinco.
  const cortou = pedidas.length > TETO_POR_CHAMADA;

  const db = createXtvClient();
  const resultados = await gerarLote(db, pedidas as Categoria[]);

  const geradas = resultados.filter((r) => r.ok);
  const falhas = resultados.filter((r) => !r.ok);

  console.log("[farol-arte-gerar]", {
    pedidas: pedidas.length,
    geradas: geradas.length,
    falhas: falhas.length,
    modelo: MODELO,
  });

  // 207 quando houve falha parcial: 200 faria o operador ler "deu certo" numa
  // resposta em que metade não saiu.
  const status = falhas.length === 0 ? 200 : geradas.length > 0 ? 207 : 502;

  return NextResponse.json(
    {
      ok: falhas.length === 0,
      modelo: MODELO,
      tamanho: TAMANHO,
      qualidade: QUALIDADE,
      teto: TETO_POR_CHAMADA,
      ...(cortou
        ? { aviso: `pedidas ${pedidas.length}; o teto por chamada é ${TETO_POR_CHAMADA}.` }
        : {}),
      // Nascem todas pendentes — a curadoria é que decide, no painel.
      geradas: geradas.map((r) => (r.ok ? r.arte : null)),
      falhas: falhas.map((r) => (!r.ok ? { categoria: r.categoria, erro: r.erro } : null)),
    },
    { status }
  );
}
