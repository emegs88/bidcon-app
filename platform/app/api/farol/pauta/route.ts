// ============================================================================
// FAROL-ESCUTA-01 · GET /api/farol/pauta
// AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-ESCUTA-01", 08/08/2026:
// "quero agente autonomo que procura videos tendencia crescimentos faz copy
//  adaptado a bidcon".
// ----------------------------------------------------------------------------
// NASCE DESARMADA. Sem FAROL_PAUTA=on esta rota não fala com a Anthropic, não
// gasta busca e não escreve linha. O log diz "represado" e ela sai.
//
// ELA NÃO PUBLICA NADA. Escreve uma linha em `farol_pauta` e vai embora. Quem
// publica é o pipeline de sempre (reel-render → reel-publicar), com os
// kill-switches de sempre. Este cron é o redator; os outros dois são a gráfica
// e o carteiro.
//
// ---- O RELÓGIO (medido, e diferente do que a OS supôs) ---------------------
// Crons de hoje: post-diario 14:00 UTC, reel-render 14:30 UTC. Esta rota entra
// às 13:00 UTC = 10h BRT, como a OS pediu.
// Logo: a pauta é escrita às 10h e consumida às 11h30 DO MESMO DIA, com 90
// minutos de folga. A validação (c) da OS fala em "reel-render do dia
// seguinte" — pela medição dos horários, é no mesmo dia. Declaro a divergência
// porque ela muda o teste de aceite, não o código: quem for validar vai ver a
// pauta virar 'usada' 90 minutos depois, não no dia seguinte.
// Os 90 minutos são a margem: se esta rota falhar ou demorar, o reel-render
// encontra o banco sem pauta 'nova' e cai no template — que é o comportamento
// de hoje, bit a bit.
//
// E no MEIO dessa folga mora o post-diario (11h), que publica uma carta e a
// queima da lista do reel. É por isso que a escolha da carta aqui embaixo não
// é uma chamada só: ver o bloco "Carta do dia". Sem esse cuidado, a pauta das
// 10h sairia escrita sobre a carta do POST, e o reel das 11h30 narraria
// números de uma carta que não é a dele.
//
// ---- ORDEM DAS OPERAÇÕES: CONFERE ANTES DE GASTAR, GRAVA DEPOIS DE ESCREVER
// É o INVERSO do que o /api/farol/yt-comenta faz, e o inverso é proposital.
// Lá a linha nasce antes da ação porque a ação é falar em público e duplicar é
// irreversível. Aqui nada sai para o mundo: o pior caso de uma corrida é gastar
// duas buscas e perder uma escrita no unique (23505). Reservar a linha antes
// teria um custo pior — o reel-render das 11h30 poderia achar uma pauta pela
// metade, com roteiro vazio, e mandar o HeyGen renderizar um vídeo mudo.
//
// ---- O LINTER É OBRIGATÓRIO E ELE MORA AQUI --------------------------------
// `revisarLegenda()` — a MESMA trava determinística do post de feed e do reel —
// mede o ROTEIRO e a LEGENDA. Reprovado: a linha é gravada com status
// 'reprovada' e o motivo, e o dia inteiro cai no template determinístico. O
// show não para, e no dia seguinte alguém consegue perguntar ao banco qual
// fôrma puxa o modelo para fora da cerca.
//
// A cerca roda FORA de lib/farol/pauta.ts de propósito: a trava não pode ser
// escrita pela mesma cabeça que escreve o texto.
//
// ---- CUSTO ------------------------------------------------------------------
// Uma execução por dia. Duas chamadas à Anthropic, no máximo 3 buscas web
// (US$ 10 por 1.000 buscas na doc ⇒ ~US$ 0,90/ano em busca) mais tokens.
// Qualquer erro da API vira log `[farol-pauta]` e fallback silencioso: não
// gravamos nada e o reel-render nem percebe que este cron existiu.
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
import { formulaDoDia } from "@/lib/farol/formulas";
import { ouvirTendencias, escreverPauta } from "@/lib/farol/pauta";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Busca web é lenta por natureza (a API roda as buscas do lado dela antes de
// responder). 60s do reel-render não dão folga para duas chamadas em série.
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!autorizadoFarol(req)) {
    return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  }

  // ---- Kill-switch, ANTES de qualquer I/O ---------------------------------
  if (process.env.FAROL_PAUTA !== "on") {
    console.log("[farol-pauta] represado (desarmado)");
    return NextResponse.json({ ok: true, escreveu: false, motivo: "desarmado" });
  }

  const db = createXtvClient();
  const { data: hoje, dia, segunda } = hojeSP();

  try {
    // ---- Já existe pauta hoje? (pré-check: não gastar busca à toa) --------
    // Qualquer status conta. 'reprovada' também: se o modelo já saiu da cerca
    // hoje, insistir no mesmo dia é pagar de novo pelo mesmo erro.
    const { data: existente, error: errLe } = await db
      .from("farol_pauta")
      .select("id,status")
      .eq("dia", hoje)
      .limit(1);
    if (errLe) throw new Error(`farol_pauta_ilegivel: ${errLe.message}`);
    if (existente && existente.length > 0) {
      console.log("[farol-pauta] ja existe pauta hoje:", {
        data: hoje,
        status: existente[0].status,
      });
      return NextResponse.json({
        ok: true,
        escreveu: false,
        motivo: "ja_existe",
        status: existente[0].status,
      });
    }

    // ---- Carta do dia — A QUE O reel-render VAI ESCOLHER ÀS 11h30 ---------
    // NÃO basta chamar `escolherCartaDoDia` com a memória de agora, e essa é a
    // armadilha mais cara desta fatia. Medido nos crons: entre esta rota (10h)
    // e o reel-render (11h30) roda o post-diario (11h), que PUBLICA uma carta e
    // grava `post_publicado`. Às 11h30 essa carta está na lista de excluídos do
    // reel; às 10h ela ainda não está.
    //
    // Consequência se eu ignorasse isso: às 10h eu escolheria exatamente a
    // carta que o post vai publicar às 11h (post-diario faz a MESMA pergunta à
    // MESMA função), escreveria o roteiro sobre ELA, e às 11h30 o reel
    // renderizaria OUTRA carta narrando crédito e parcela da primeira. Um vídeo
    // que anuncia números que não são os da carta anunciada.
    //
    // Então reproduzo o estado futuro: escolho como o post-diario escolhe
    // (memória ["post_publicado"], idêntica à dele), somo a carta dele aos
    // excluídos e escolho de novo com a memória do reel. Determinístico porque
    // as três rotas fazem a mesma pergunta à mesma função.
    //
    // Só simulo com o post ARMADO: desarmado ele não queima nada, e o
    // reel-render às 11h30 pega a primeira mesmo. E mesmo assim isto é um
    // palpite educado, não uma garantia — se o post falhar, ou se a vitrine
    // mudar entre 10h e 11h30, a carta diverge. Por isso o reel-render tem a
    // trava final: só consome pauta cujo `carta_id` bate com a carta dele.
    const excluidos = await publicadasRecentemente(db, [
      "post_publicado",
      "reel_publicado",
    ]);

    if (process.env.FAROL_ATIVO === "on") {
      const memoriaPost = await publicadasRecentemente(db, ["post_publicado"]);
      const { carta: doPost } = await escolherCartaDoDia(db, {
        dia,
        segunda,
        excluidos: memoriaPost,
      });
      if (doPost) excluidos.add(doPost.id);
    }

    const { carta, motivo: motivoEscolha, tipoDoDia } = await escolherCartaDoDia(db, {
      dia,
      segunda,
      excluidos,
    });

    if (!carta) {
      console.log("[farol-pauta] sem carta elegível hoje:", { data: hoje, tipoDoDia });
      return NextResponse.json({ ok: true, escreveu: false, motivo: "sem_carta" });
    }

    // ---- Fôrma do dia -----------------------------------------------------
    // Rotação determinística DENTRO das fôrmas que fecham no tipo da carta. Sem
    // o terceiro argumento, um dia de "sair do aluguel" aterrissaria no crédito
    // de um carro — o irmão gêmeo do bug da carta divergente. Ver formulas.ts.
    // `carta.exclusiva` não é mais usado na escolha (a exceção foi eliminada em
    // 08/08); a exclusividade virou selo de legenda.
    const formula = formulaDoDia(hoje, carta.exclusiva, carta.tipo);

    // ---- 1ª chamada: a escuta --------------------------------------------
    const escuta = await ouvirTendencias();
    if (!escuta.ok) {
      console.error("[farol-pauta] busca falhou:", escuta.erro);
      return NextResponse.json({
        ok: true,
        escreveu: false,
        motivo: "busca_falhou",
        erro: escuta.erro,
      });
    }

    // ---- 2ª chamada: a redação -------------------------------------------
    const texto = await escreverPauta(carta, formula, escuta.texto);
    if (!texto.ok) {
      console.error("[farol-pauta] redação falhou:", texto.erro);
      return NextResponse.json({
        ok: true,
        escreveu: false,
        motivo: "redacao_falhou",
        erro: texto.erro,
      });
    }

    // ---- LINTER OBRIGATÓRIO, sobre roteiro E legenda ----------------------
    // As hashtags entram na mesma medição: elas saem do modelo e vão para a
    // legenda publicada, então uma "#investimento" precisa reprovar aqui e não
    // no Instagram.
    const reprovado =
      revisarLegenda(texto.roteiro) ??
      revisarLegenda(texto.legenda) ??
      revisarLegenda(texto.hashtags.join(" "));

    const base = {
      dia: hoje,
      formula: formula.id,
      gancho: texto.gancho || null,
      hashtags: texto.hashtags.length > 0 ? texto.hashtags : null,
      fontes: escuta.fontes,
      carta_id: carta.id,
    };

    if (reprovado) {
      // A linha reprovada FICA. É a prova de que a cerca segurou, e é o dado
      // que vai dizer, daqui a um mês, qual fôrma puxa o modelo para fora.
      console.error("[farol-pauta] texto reprovado no compliance:", reprovado);
      const { error: errRep } = await db.from("farol_pauta").insert({
        ...base,
        roteiro: texto.roteiro,
        legenda: texto.legenda,
        status: "reprovada",
        motivo_linter: reprovado,
      });
      if (errRep && errRep.code !== "23505") {
        console.error("[farol-pauta] falha gravando reprovada:", errRep.message);
      }
      await registrar(db, "pauta_reprovada", carta.id, null, {
        data: hoje,
        formula: formula.id,
        motivo: reprovado,
      });
      // 200: o cron fez o trabalho dele. O reel-render vai achar o banco sem
      // pauta 'nova' e cair no template — exatamente como hoje.
      return NextResponse.json({
        ok: true,
        escreveu: true,
        status: "reprovada",
        formula: formula.id,
        motivo_linter: reprovado,
      });
    }

    // ---- Aprovada ---------------------------------------------------------
    const { error: errIns } = await db.from("farol_pauta").insert({
      ...base,
      roteiro: texto.roteiro,
      legenda: texto.legenda,
      status: "nova",
    });

    if (errIns) {
      // 23505 = alguém escreveu a pauta de hoje enquanto esta execução falava
      // com o modelo. Gastamos as buscas à toa; não é erro operacional.
      if (errIns.code === "23505") {
        console.log("[farol-pauta] corrida perdida (pauta do dia já gravada)");
        return NextResponse.json({ ok: true, escreveu: false, motivo: "corrida_perdida" });
      }
      throw new Error(`insert_falhou: ${errIns.message}`);
    }

    await registrar(db, "pauta_escrita", carta.id, null, {
      data: hoje,
      formula: formula.id,
      escolha: motivoEscolha,
      fontes: escuta.fontes.length,
    });

    console.log("[farol-pauta] pauta escrita:", {
      data: hoje,
      formula: formula.id,
      carta_id: carta.id,
      fontes: escuta.fontes.length,
    });

    return NextResponse.json({
      ok: true,
      escreveu: true,
      status: "nova",
      formula: formula.id,
      carta_id: carta.id,
      fontes: escuta.fontes.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[farol-pauta] erro:", msg);
    return NextResponse.json({ ok: false, erro: msg }, { status: 500 });
  }
}
