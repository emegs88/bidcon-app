// ============================================================================
// FAROL-POST — GET /api/farol/post-diario · o post diário autônomo
// AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-POST", 06/08/2026 ~22h15.
// NASCE DESARMADO. Sem FAROL_ATIVO=on, esta rota não publica nada.
// ----------------------------------------------------------------------------
// O QUE ELA FAZ, uma vez por dia: escolhe UMA carta por regra determinística
// (nenhuma IA nesta fatia), monta a legenda por template fixo, publica pela
// MESMA lib que a rota manual usa (lib/instagram/publicar.ts) e grava o que fez
// em `farol_posts`. Stories, reels e relatório estão FORA de escopo aqui.
//
// ---------------------------------------------------------------------------
// GUARD — desvio declarado, mínimo. A OS manda "mesmo padrão do cron do
// Sentinela (header CRON_SECRET — leia como a varredura valida e espelhe)".
// Lido em app/api/sentinela/varredura/route.ts:
//     const secret = process.env.SENTINELA_SECRET || process.env.CRON_SECRET;
//     if (!secret) return false;                       // sem secret => não roda
//     return req.headers.get("authorization") === `Bearer ${secret}`;
// Espelhei a FORMA exata, trocando só o nome do secret específico do módulo:
// `FAROL_SECRET || CRON_SECRET`. Reusar `SENTINELA_SECRET` faria a chave do
// radar de preço abrir também a publicação no perfil público — dois poderes
// bem diferentes atrás da mesma chave. O `CRON_SECRET` no fim da linha é o que
// o cron da Vercel manda sozinho no header, então o agendamento funciona sem
// env extra; `FAROL_SECRET` existe pra quem quiser disparar à mão.
// O "sem secret => não roda" foi mantido letra por letra: numa preview sem env
// configurada a rota fica fechada, e não aberta.
//
// ---------------------------------------------------------------------------
// SELEÇÃO DA CARTA DO DIA (determinística, sem IA — regra da OS):
//   1. fonte = `vw_vitrine_viva`, a MESMA que /api/card-image lê. Se a carta
//      não está nela, a arte devolveria 404 e a Meta recusaria o container.
//   2. exclui cartas publicadas na janela DO TIPO delas — 14 dias para imóvel,
//      7 para veículo (memória em farol_posts). Ver `JANELA_REPETICAO_DIAS`.
//   3. alterna tipo por dia: ímpar = imóvel, par = veículo. Sem estoque
//      daquele tipo, cai pro outro.
//   4. filtra pelo TETO de custo do tipo e escolhe a de maior ALAVANCAGEM
//      (crédito por real de parcela). Ver lib/farol/selecao.ts. Até 09/08/2026
//      este passo era "escolhe o MENOR custo ao mês".
//   5. exclusiva fura fila 1× por semana, na segunda.
//
// "DIA" É EM SÃO PAULO, NÃO EM UTC. O cron roda 14:00 UTC = 11:00 BRT, então
// hoje as duas datas coincidem — mas horário de verão, mudança de cron ou uma
// execução manual à noite fariam `new Date().getDate()` (que é UTC no runtime
// da Vercel) trocar de dia sozinho e inverter imóvel/veículo sem ninguém mexer
// em nada. Fixar o fuso é o que torna a regra "ímpar = imóvel" verdadeira.
//
// CUSTO: `custoEfetivoCarta` via `normalizarCarta` (lib/carrossel-formato.ts) —
// a MESMA função que a página /cartas/<uuid>, destino do clique, usa. A view
// tem uma coluna `custo_am` pronta, usada só para PRÉ-FILTRAR (um `lte` no
// teto + `ORDER BY`) em vez de trazer as 2.582 linhas. Quem decide é o cálculo
// canônico, em memória.
//
// ESTE PARÁGRAFO FOI REESCRITO EM 09/08/2026 PORQUE O ARGUMENTO ANTIGO CAIU.
// Ele dizia: "nenhuma carta fora do topo-80 por `custo_am` pode ser a mais
// barata de verdade" — verdadeiro enquanto o ranking ERA o custo. Com o ranking
// por alavancagem, a melhor carta pode estar em qualquer posição da faixa
// elegível, e o topo-80 viraria um recorte arbitrário. Por isso o limite subiu
// para 500 e o teto passou a ser filtrado no banco. A divergência medida entre
// a coluna da view e o canônico é de no máximo 0,005047 p.p. (medida hoje sobre
// as 1.926 linhas com custo), coberta pela folga de 0,01 do `lte`.
//
// ---------------------------------------------------------------------------
// LEGENDA — PENDÊNCIA HONESTA. A OS pede "template fixo no padrão da legenda
// inaugural (mesma estrutura de parágrafos...)". Procurei o texto inaugural no
// repositório e no banco: NÃO EXISTE em lugar nenhum (ele foi escrito por
// Emerson direto no disparo do post 18132427570616550, e a rota manual não
// guarda a legenda). Então o template abaixo foi montado pela DESCRIÇÃO da
// própria OS — estrutura de parágrafos, números da carta, Conta Notarial, CTA
// link na bio + WhatsApp, hashtags — e não por cópia do original. Precisa do
// olho do Emerson antes de armar. Está isolado numa função só (`montarLegenda`)
// exatamente pra ser fácil de reescrever sem tocar em mais nada.
//
// COMPLIANCE (CLAUDE.md): custo SEMPRE como "% a.m."; nunca "investimento",
// "rendimento", "lucro", "CDI"; nenhuma promessa ou data de contemplação; a
// Conta Notarial descrita como ela é, sem "risco zero". O template abaixo
// cumpre isso — e `revisarLegenda()` verifica antes de publicar, para que uma
// edição futura no texto não vire um post irregular no perfil público.
//
// ---------------------------------------------------------------------------
// EXTRAÇÃO (FAROL-REEL-01, 06/08/2026): o guard, a data em São Paulo, a memória
// da janela, a busca de candidatos, a escolha, a trava de compliance e o
// `registrar()` saíram DESTE arquivo e viraram lib/farol/selecao.ts, porque a
// OS do reel manda usar "a MESMA lib de seleção do FAROL-POST" — e ela não
// existia. MUDANÇA DE ENDEREÇO, NÃO DE COMPORTAMENTO: o corpo foi levado
// literal, incluindo strings de erro e prefixo de log. O que sobra aqui é o que
// é só desta rota: o template da legenda e o fluxo do post de feed.
// ============================================================================
import { NextResponse } from "next/server";
import { createXtvClient } from "@/lib/supabase-xtv";
import { publicarCartaNoFeed } from "@/lib/instagram/publicar";
import {
  autorizadoFarol,
  hojeSP,
  publicadasRecentemente,
  escolherCartaDoDia,
  revisarLegenda,
  registrar,
} from "@/lib/farol/selecao";
import {
  reais,
  pctAoMes,
  type CartaCarrossel,
} from "@/lib/carrossel-formato";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Legenda
// ---------------------------------------------------------------------------

const HASHTAGS: Record<string, string> = {
  imovel:
    "#consorcio #cartacontemplada #consorciodeimovel #casapropria #planejamento #patrimonio #bidcon",
  veiculo:
    "#consorcio #cartacontemplada #consorciodeveiculo #carronovo #planejamento #patrimonio #bidcon",
};

/**
 * Template fixo. Uma carta entra, a legenda sai — sem IA, sem variação.
 * PENDENTE DE REVISÃO DO EMERSON: a legenda inaugural não existe no repositório
 * nem no banco, então isto segue a DESCRIÇÃO da OS, não o original. Ver header.
 */
function montarLegenda(c: CartaCarrossel): string {
  const linhas: string[] = [];

  linhas.push(`Carta de crédito contemplada · ${c.tipoLabel}`);
  if (c.administradora) linhas.push(c.administradora);
  linhas.push("");

  linhas.push(`Crédito: ${reais(c.credito)}`);
  if (c.entrada > 0) linhas.push(`Entrada: ${reais(c.entrada)}`);
  if (c.parcelas > 0 && c.parcela > 0) {
    linhas.push(`Parcelas: ${c.parcelas}x de ${reais(c.parcela)}`);
  }
  linhas.push(`Custo: ${pctAoMes(c.custoAm)}`);
  linhas.push("");

  linhas.push(
    "Poder de compra disponível agora — a carta já está contemplada, então não depende de sorteio nem de lance."
  );
  linhas.push("");

  linhas.push(
    "Pagamento por Conta Notarial: o valor vai para uma conta vinculada no Banco Safra, atrelada exclusivamente ao negócio, com patrimônio segregado. O 5º Tabelionato de Notas de Campinas administra com fé pública e sem acesso ao valor — libera ao vendedor só depois que a administradora aprova a transferência; se não aprovar, o valor volta para o comprador."
  );
  linhas.push("");

  linhas.push(
    "Carta completa no link da bio. Prefere conversar? Chama no WhatsApp."
  );
  linhas.push("");

  // RÓTULO-IA no feed (07/08). O reel declara a IA na PRIMEIRA frase porque lá
  // o rótulo é ouvido e some; aqui ele fica por escrito e permanente, então o
  // fim é o lugar certo: no topo empurraria os números para fora da primeira
  // dobra, que é onde a pessoa decide. Mesma tese, posição diferente porque o
  // meio é diferente. Passa pelo mesmo `revisarLegenda()` das linhas de cima.
  linhas.push(
    "🤖 Publicado pelo assistente IA da Bidcon — atendimento humano no direct quando você quiser."
  );
  linhas.push("");

  linhas.push(HASHTAGS[c.tipo] ?? HASHTAGS.imovel);

  return linhas.join("\n");
}

// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  if (!autorizadoFarol(req)) {
    return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  }

  // ---- Kill-switch, ANTES de qualquer leitura ou escrita ------------------
  if (process.env.FAROL_ATIVO !== "on") {
    console.log("[farol] represado (desarmado)");
    return NextResponse.json({ ok: true, publicado: false, motivo: "desarmado" });
  }

  const db = createXtvClient();
  const { data: hoje, dia, segunda } = hojeSP();

  try {
    // Memória com ["post_publicado"] — exatamente a mesma lista de antes da
    // extração, para que o comportamento desta rota não mude. Ver header.
    const memoria = await publicadasRecentemente(db, ["post_publicado"]);

    // ---- Escolha da carta -------------------------------------------------
    const {
      carta: escolhida,
      motivo: motivoEscolha,
      tipoDoDia,
    } = await escolherCartaDoDia(db, { dia, segunda, memoria });

    if (!escolhida) {
      console.log("[farol] sem carta elegível hoje:", { data: hoje, tipoDoDia });
      await registrar(db, "sem_carta", null, null, { data: hoje, tipo_do_dia: tipoDoDia });
      return NextResponse.json({ ok: true, publicado: false, motivo: "sem_carta" });
    }

    // ---- Legenda ----------------------------------------------------------
    const legenda = montarLegenda(escolhida);
    const reprovada = revisarLegenda(legenda);
    if (reprovada) {
      console.error("[farol] legenda reprovada no compliance:", reprovada);
      await registrar(db, "post_falhou", escolhida.id, null, {
        data: hoje,
        erro: `legenda_reprovada:${reprovada}`,
      });
      return NextResponse.json(
        { ok: false, erro: `legenda_reprovada:${reprovada}` },
        { status: 500 }
      );
    }

    // ---- Publicação (mesma lib da rota manual) ----------------------------
    const r = await publicarCartaNoFeed({ cartaId: escolhida.id, legenda });

    if (!r.ok) {
      // Sem loop de retry: o cron de amanhã tenta de novo naturalmente, e a
      // carta continua elegível porque nada foi gravado como publicado.
      console.error("[farol] publicação falhou:", {
        data: hoje,
        carta_id: escolhida.id,
        motivo: r.motivo,
        erro: r.erro,
      });
      await registrar(db, "post_falhou", escolhida.id, null, {
        data: hoje,
        motivo: r.motivo,
        erro: r.erro,
      });
      return NextResponse.json({ ok: false, erro: r.erro, motivo: r.motivo });
    }

    console.log("[farol] post do dia publicado:", {
      data: hoje,
      post_id: r.postId,
      carta_id: escolhida.id,
      tipo: escolhida.tipo,
      custo_am: escolhida.custoAm,
      escolha: motivoEscolha,
    });
    await registrar(db, "post_publicado", escolhida.id, r.postId, {
      data: hoje,
      tipo: escolhida.tipo,
      administradora: escolhida.administradora,
      credito: escolhida.credito,
      custo_am: escolhida.custoAm,
      escolha: motivoEscolha,
    });

    return NextResponse.json({
      ok: true,
      publicado: true,
      post_id: r.postId,
      carta_id: escolhida.id,
      escolha: motivoEscolha,
    });
  } catch (e) {
    const erro = e instanceof Error ? e.message.slice(0, 500) : "erro_desconhecido";
    console.error("[farol] erro no post diário:", erro);
    return NextResponse.json({ ok: false, erro }, { status: 500 });
  }
}
