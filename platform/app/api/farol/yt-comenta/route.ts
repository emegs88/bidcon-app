// ============================================================================
// YT-COMENTA-01 · GET /api/farol/yt-comenta — respostas públicas no YouTube
// AUTORIZADO: Emerson Gomes dos Santos — OS "YT-COMENTA-01", 07/08/2026, e a
// decisão de cota de 07/08/2026: "(a) Máximo 60 respostas/dia (contadas por
// count de hoje na própria farol_yt_comentarios — sem tabela de estado nova);
// (b) reserva sagrada do upload: se o consumo estimado do dia (respostas×50 +
// tiques×1) atingir 7.000 unidades, comentários PARAM e logam '[farol-yt]
// orcamento_reservado_upload'. O teto de 10/tique morre — quem governa é o
// diário." Cron a cada 10 minutos.
// ----------------------------------------------------------------------------
// O QUE ESTA ROTA É. O YouTube não tem DM e não tem webhook de comentário. A
// resposta é PÚBLICA, no thread, e a captura é POLLING. Isto aqui acorda de 10
// em 10 minutos, pergunta ao canal "o que é novo?", e responde uma vez cada.
//
// TUDO O QUE ELA ESCREVE É IRREVERSÍVEL AOS OLHOS DO PÚBLICO. Uma resposta
// duplicada não se desfaz: fica no thread, com a marca da Bidcon, para quem
// passar depois. É por isso que a linha no banco nasce ANTES da chamada ao
// Google (ver 0070_farol_yt_comentarios.sql) e por isso que ela nasce
// DESARMADA.
//
// ----------------------------------------------------------------------------
// OS DOIS TETOS, E POR QUE SÃO DOIS.
//
// A Data API v3 dá 10.000 unidades/dia para o PROJETO — não para o endpoint. O
// `videos.insert` do YOUTUBE-01, que sobe o Short diário, bebe do MESMO balde.
// O teto de 10 respostas/tique que a OS pedia originalmente daria, no pior dia,
// 10 × 144 tiques × 50 = 72.000 unidades: 7,2× a cota inteira. Um teto por
// tique protege LATÊNCIA, não cota — e o custo de descobrir isso em produção
// seria o Short do dia seguinte morrer calado por `quotaExceeded`.
//
//   TETO_DIA_RESPOSTAS (60) — o que governa. 60 × 50 = 3.000 unidades.
//   RESERVA_UPLOAD (7.000)  — o cinto. Só morde se alguém subir o teto acima
//                             sem refazer esta conta.
//
// Com os números de hoje o primeiro sempre bate antes do segundo (3.000 + 144
// de listagem = 3.144, longe de 7.000). Isso é DE PROPÓSITO: o cinto existe
// para o dia em que o número de cima mudar e ninguém lembrar do de baixo.
//
// DECISÃO DECLARADA — "consumo estimado do dia". A frase da OS admite duas
// leituras: o gasto ATÉ AGORA ou o gasto do DIA INTEIRO. Adotei a segunda e
// reservo os 144 tiques completos já no primeiro tique da madrugada. A leitura
// otimista ("só o que já gastei") liberaria respostas de manhã que faltariam à
// noite, e o que faltaria à noite é o upload — que é justamente o que a OS
// chamou de sagrado. Reservar cedo é o único jeito de a reserva significar algo.
//
// ----------------------------------------------------------------------------
// O QUE NÃO É RESPONDIDO, e por quê:
//   · `canReply === false`     — o Google já recusaria; conferir é de graça.
//   · autor == o próprio canal — senão o bot responde a si mesmo, em laço.
//   · texto com http/https     — spam com link não é engajado. Nunca.
//   · já presente na tabela    — a UNIQUE recusa o claim e nós desistimos.
// ============================================================================
import { NextResponse } from "next/server";
import { createXtvClient } from "@/lib/supabase-xtv";
import { autorizadoFarol, registrar, hojeSP } from "@/lib/farol/selecao";
import {
  listarThreads,
  responder,
  ehNosso,
  temLink,
  CUSTO_LIST,
  CUSTO_INSERT,
} from "@/lib/youtube/comentarios";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Teto diário de respostas. Decisão do Emerson, 07/08/2026. */
const TETO_DIA_RESPOSTAS = 60;

/** Reserva intocável para o `videos.insert` do YOUTUBE-01. Mesma decisão. */
const RESERVA_UPLOAD = 7_000;

// Tiques do cron num dia: de 10 em 10 minutos ⇒ 6/hora × 24 = 144. Comentário
// de LINHA, e não de bloco, porque a expressão do cron contém a sequência que
// fecharia um /* */ no meio — bug que compila até parar de compilar.
const TIQUES_DIA = 144;

/**
 * Quantos threads pedir por tique. 50 é meia página; a lista vem em `order=time`
 * e em 10 minutos o canal não recebe 50 comentários novos. Custa 1 unidade
 * independentemente do número.
 */
const THREADS_POR_TIQUE = 50;

/**
 * A resposta. FIXA, palavra por palavra como a OS a escreveu — não é gerada,
 * não passa por IA, não varia. Texto fixo é o que torna esta rota auditável:
 * o que ela publica está inteiro nesta constante, e revisá-lo é lê-la.
 */
const TEXTO_RESPOSTA =
  "Oi! Aqui é o assistente IA da Bidcon 🤖 Obrigado pelo comentário! " +
  "As cartas disponíveis estão em bidcon.com.br — e nosso time humano " +
  "responde pelo WhatsApp do site quando você quiser. 🏛️";

/**
 * Início do dia no fuso de São Paulo, em ISO.
 *
 * `-03:00` é literal porque o Brasil não tem mais horário de verão desde 2019 —
 * se voltar, esta linha é o lugar de consertar, e este comentário é o aviso.
 * Reaproveita `hojeSP()` para não existir uma segunda definição de "hoje" no
 * repositório: duas definições divergem no dia em que uma delas for corrigida.
 */
function inicioDoDiaSP(): string {
  return `${hojeSP().data}T00:00:00-03:00`;
}

export async function GET(req: Request) {
  if (!autorizadoFarol(req)) {
    return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  }

  // Kill-switch ANTES de qualquer I/O — nem banco, nem Google. Nasce desarmado:
  // sem a env, a rota é um no-op de 200. Mesmo padrão de FAROL_REEL.
  if (process.env.FAROL_YT_COMENTA !== "on") {
    console.log("[farol-yt] represado (desarmado)");
    return NextResponse.json({ ok: true, respondeu: 0, motivo: "desarmado" });
  }

  const db = createXtvClient();

  // ---------------------------------------------------------------------
  // Contagem do dia. É a ÚNICA fonte dos dois tetos — sem tabela de estado
  // nova, como a OS mandou. `head: true` traz só o número, não as linhas.
  // ---------------------------------------------------------------------
  const { count, error: erroCount } = await db
    .from("farol_yt_comentarios")
    .select("id", { count: "exact", head: true })
    .gte("criado_em", inicioDoDiaSP());

  if (erroCount) {
    // Sem saber quanto já gastamos, responder seria apostar contra a cota do
    // upload. Aborta — o próximo tique tenta de novo em 10 minutos.
    console.error("[farol-yt] falha lendo contagem do dia:", erroCount.message);
    return NextResponse.json(
      { ok: false, erro: "contagem_indisponivel" },
      { status: 500 }
    );
  }

  const jaHoje = count ?? 0;

  /** Consumo projetado do dia inteiro se respondermos mais `n`. Ver header. */
  const estimado = (n: number) =>
    (jaHoje + n) * CUSTO_INSERT + TIQUES_DIA * CUSTO_LIST;

  if (jaHoje >= TETO_DIA_RESPOSTAS) {
    console.log(`[farol-yt] teto_diario (${jaHoje}/${TETO_DIA_RESPOSTAS})`);
    return NextResponse.json({
      ok: true,
      respondeu: 0,
      motivo: "teto_diario",
      hoje: jaHoje,
    });
  }

  if (estimado(0) >= RESERVA_UPLOAD) {
    console.log("[farol-yt] orcamento_reservado_upload");
    return NextResponse.json({
      ok: true,
      respondeu: 0,
      motivo: "orcamento_reservado_upload",
      hoje: jaHoje,
    });
  }

  // ---------------------------------------------------------------------
  // Listagem: 1 unidade. Só chega aqui quem passou pelos dois tetos.
  // ---------------------------------------------------------------------
  const lista = await listarThreads(THREADS_POR_TIQUE);
  if (!lista.ok) {
    console.error(`[farol-yt] ${lista.erro}`);
    return NextResponse.json({ ok: false, erro: lista.erro }, { status: 502 });
  }

  const candidatos = lista.comentarios.filter(
    (c) => c.canReply && !ehNosso(c) && !temLink(c)
  );

  let respondeu = 0;
  let jaReivindicados = 0;
  const falhas: string[] = [];

  for (const c of candidatos) {
    // Reconferidos A CADA volta, e não só na entrada: `jaHoje + respondeu` é o
    // que a próxima resposta custaria de verdade.
    if (jaHoje + respondeu >= TETO_DIA_RESPOSTAS) {
      console.log(
        `[farol-yt] teto_diario atingido no tique (${jaHoje + respondeu}/${TETO_DIA_RESPOSTAS})`
      );
      break;
    }
    if (estimado(respondeu + 1) > RESERVA_UPLOAD) {
      console.log("[farol-yt] orcamento_reservado_upload");
      break;
    }

    // -----------------------------------------------------------------
    // CLAIM. A linha nasce ANTES da resposta. Se duas invocações do cron se
    // cruzarem, a UNIQUE de `comment_id` recusa a segunda (23505) e ela
    // desiste sem falar com o Google. Ver o header da 0070.
    // -----------------------------------------------------------------
    const { data: claim, error: erroClaim } = await db
      .from("farol_yt_comentarios")
      .insert({
        comment_id: c.commentId,
        video_id: c.videoId,
        autor: c.autor,
      })
      .select("id")
      .single();

    if (erroClaim) {
      // 23505 = unique_violation. É o caso ESPERADO e silencioso: já
      // respondido num tique anterior, ou reivindicado por uma invocação
      // paralela agora mesmo. Não é falha.
      if (erroClaim.code === "23505") {
        jaReivindicados++;
        continue;
      }
      console.error("[farol-yt] falha no claim:", erroClaim.message);
      falhas.push("claim");
      continue;
    }

    // -----------------------------------------------------------------
    // Resposta pública. 50 unidades.
    // -----------------------------------------------------------------
    const env = await responder(c.commentId, TEXTO_RESPOSTA);
    if (!env.ok) {
      // A linha FICA, com `resposta_id` nulo. Não apagamos: se o motivo do
      // erro for permanente (comentário privado, thread fechado), apagar faria
      // o próximo tique tentar de novo, e o seguinte, para sempre. A linha
      // órfã é a lápide — e `resposta_id is null` é a consulta que a encontra.
      console.error(`[farol-yt] ${env.erro}`);
      falhas.push(env.erro);
      continue;
    }

    const { error: erroUpd } = await db
      .from("farol_yt_comentarios")
      .update({ resposta_id: env.respostaId })
      .eq("id", claim.id);
    if (erroUpd) {
      // A resposta JÁ está no ar; só o registro do id falhou. Não é motivo
      // para parar o tique — o claim já impede a duplicata.
      console.error("[farol-yt] falha gravando resposta_id:", erroUpd.message);
    }

    respondeu++;
  }

  // Diário do FAROL. DESVIO DECLARADO: a OS não pediu farol_posts. Registro
  // assim mesmo, e só quando houve resposta, para que "o que o FAROL fez
  // ontem?" continue sendo UMA consulta só — mesma razão do reel-publicar.
  if (respondeu > 0) {
    await registrar(db, "yt_comentario_respondido", null, null, {
      respondeu,
      candidatos: candidatos.length,
      hoje_antes: jaHoje,
      unidades_estimadas_dia: estimado(respondeu),
    });
  }

  return NextResponse.json({
    ok: true,
    respondeu,
    candidatos: candidatos.length,
    listados: lista.comentarios.length,
    ja_reivindicados: jaReivindicados,
    hoje: jaHoje + respondeu,
    teto_dia: TETO_DIA_RESPOSTAS,
    unidades_estimadas_dia: estimado(respondeu),
    falhas: falhas.length,
  });
}
