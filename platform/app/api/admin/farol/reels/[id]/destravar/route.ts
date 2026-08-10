// ============================================================================
// POST /api/admin/farol/reels/[id]/destravar — PAINEL-FAROL-01 item 3
// AUTORIZADO: Emerson Gomes dos Santos — OS "PAINEL-FAROL-01", 08/08/2026:
// "botões para (...) re-tentar linha travada".
// ----------------------------------------------------------------------------
// O QUE "DESTRAVAR" FAZ, EXATAMENTE: zera `container_id`. Só isso.
//
// NÃO é uma operação nova — é a AUTOCURA que a fase 2 já executa sozinha,
// exposta num botão. Em reel-publicar, quando `checarZumbi` acha um container
// parado em IN_PROGRESS além do limiar, ela grava exatamente
// `{ container_id: null, detalhe: {...container_anterior} }` e deixa o caminho
// normal reler o HeyGen, re-hospedar o mp4 e pedir um container novo. Aqui é a
// mesma escrita, disparada por um humano que não quer esperar o limiar.
//
// Reusar a operação da máquina, em vez de inventar um "reset" próprio, é o que
// garante que o botão e a autocura não divirjam. Um destravar artesanal seria
// um segundo caminho para o mesmo estado — e dois caminhos para o mesmo estado
// é como se publica duas vezes.
//
// O `status` NÃO É TOCADO, de propósito. A linha continua 'publicando', e a
// fase 2 a reclama com `.eq("status", linha.status)` — a trava de corrida (2)
// do header dela. Mudar o status aqui quebraria essa reclamação e abriria a
// janela que a trava existe para fechar.
//
// ABANDONAR CONTAINER NÃO PUBLICA NADA POR ACIDENTE: container só vai ao ar por
// chamada explícita de `media_publish`, e o abandonado nunca mais recebe uma.
// Está escrito assim no header de `checarZumbi`, e vale igual aqui.
//
// O QUE ESTA ROTA NÃO FAZ (item 4 da OS): não apaga a linha, não mexe em env,
// não arma nem desarma kill-switch, não publica. Ela devolve a linha ao fluxo
// automático — quem publica continua sendo o cron, ou o botão "publicar agora",
// que tem confirmação própria.
//
// SÓ VALE PARA LINHA VIVA. 'publicado' e 'falhou' são finais: destravar um
// reel publicado não tem significado, e destravar um que falhou mascararia o
// motivo registrado em `erro` sem consertar nada.
// ============================================================================
import { NextResponse } from "next/server";
import { checarAdminConsoleApi } from "@/lib/admin-console";
import { createXtvClient } from "@/lib/supabase-xtv";
import { registrar } from "@/lib/farol/selecao";
import { STATUS_REEL_VIVOS } from "@/lib/farol/painel";
// Vinha de `@/app/api/admin/farol/disparar/route` — uma rota importando outra.
// Além de acoplar duas rotas por uma constante de texto, era esse import que
// escondia do build um export ilegal lá. Ver `lib/farol/confirmacao.ts`.
import { PALAVRA_PUBLICAR as PALAVRA_CONFIRMACAO } from "@/lib/farol/confirmacao";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const acesso = await checarAdminConsoleApi();
  if (!acesso.ok) {
    return NextResponse.json({ erro: acesso.motivo }, { status: acesso.status });
  }

  const id = params.id;
  if (!id) return NextResponse.json({ erro: "id é obrigatório." }, { status: 400 });

  const corpo = (await req.json().catch(() => ({}))) as { confirmacao?: string };
  // Mesma palavra dos disparos, e conferida com o mesmo rigor: destravar joga
  // fora um container que PODE estar prestes a terminar.
  if (corpo.confirmacao !== PALAVRA_CONFIRMACAO) {
    return NextResponse.json(
      { erro: `confirmação nominal ausente — digite ${PALAVRA_CONFIRMACAO}.` },
      { status: 400 }
    );
  }

  const db = createXtvClient();

  const { data: linha, error: errLe } = await db
    .from("farol_reels")
    .select("id,video_id,status,container_id,detalhe")
    .eq("id", id)
    .maybeSingle();

  if (errLe) {
    console.error("[painel-farol] farol_reels ilegível:", errLe.message);
    return NextResponse.json({ erro: "não foi possível ler a linha." }, { status: 500 });
  }
  if (!linha) return NextResponse.json({ erro: "linha não encontrada." }, { status: 404 });

  if (!STATUS_REEL_VIVOS.includes(linha.status as string)) {
    return NextResponse.json(
      { erro: `linha em '${linha.status}' é estado final — não há o que destravar.` },
      { status: 409 }
    );
  }
  if (!linha.container_id) {
    return NextResponse.json(
      { erro: "esta linha não tem container preso; o próximo ciclo já a retoma." },
      { status: 409 }
    );
  }

  // Preserva o id abandonado no detalhe — MESMO campo que a autocura usa. É
  // por ele que a fase 2 reconhece o dedupe da Meta (container novo devolvido
  // igual ao antigo) em vez de deduzir.
  const detalhe = {
    ...((linha.detalhe as Record<string, unknown>) ?? {}),
    container_anterior: linha.container_id,
  };

  const { data: alteradas, error } = await db
    .from("farol_reels")
    .update({ container_id: null, detalhe, atualizado_em: new Date().toISOString() })
    .eq("id", id)
    .eq("container_id", linha.container_id)
    .select("id");

  if (error) {
    console.error("[painel-farol] falha destravando linha:", error.message);
    return NextResponse.json({ erro: "não foi possível destravar." }, { status: 500 });
  }
  if ((alteradas ?? []).length === 0) {
    return NextResponse.json(
      { erro: "o container mudou enquanto você decidia — releia a tela." },
      { status: 409 }
    );
  }

  await registrar(db, "reel_destravado", null, null, {
    reel_id: id,
    video_id: linha.video_id,
    container_abandonado: linha.container_id,
    status: linha.status,
    por: acesso.email,
    user_id: acesso.userId ?? null,
    em: new Date().toISOString(),
  });

  console.log("[painel-farol] linha destravada:", {
    reel_id: id,
    video_id: linha.video_id,
    container_abandonado: linha.container_id,
    por: acesso.email,
  });

  return NextResponse.json({ ok: true, container_abandonado: linha.container_id });
}
