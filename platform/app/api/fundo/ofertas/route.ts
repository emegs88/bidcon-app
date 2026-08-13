// ============================================================================
// POST /api/fundo/ofertas — FIDC-OFERTAS-01 · Entrega 2: o fundo manda a oferta
// ----------------------------------------------------------------------------
// AUTORIZADO: Emerson Gomes dos Santos — OS "FIDC-OFERTAS-01" (12/08/2026):
// "painel para fundo fazer ofertas nas cartas ... em lote ... ofertas válidas
//  24 horas"; e a emenda do mesmo dia: "a oferta é SEMPRE entre 20% (piso) e
//  35% (teto) DO VALOR DO CRÉDITO."
//
// ESTA ROTA É O ÚNICO LUGAR ONDE UMA OFERTA NASCE. Tudo que ela grava vale por
// 24 horas e vira proposta de compra que uma pessoa vai ler. Por isso a regra
// de ouro do arquivo:
//
//     NENHUM NÚMERO DE DINHEIRO VEM DO CLIENTE.
//
// O painel manda IDS e um PERCENTUAL. Ponto. O crédito de cada carta é RELIDO
// da `vw_vitrine_viva` aqui dentro (`buscarCartasPorId`) e o valor ofertado é
// calculado aqui dentro (`montarLote`). Se o valor viesse no corpo, um `fetch`
// na consola do navegador — que não passa por botão nenhum — bastaria para o
// fundo ficar comprometido com um número que a casa não reconhece.
//
// A RELEITURA TAMBÉM É A CONFERÊNCIA DE DISPONIBILIDADE, sem uma linha a mais.
// A view só projeta carta de pé; carta vendida ou reservada entre a tela e o
// clique não volta. Ela sai da oferta e volta NOMEADA em `indisponiveis`. Nada
// some em silêncio: uma oferta silenciosamente menor é uma oferta que ninguém
// consegue conferir depois.
//
// ----------------------------------------------------------------------------
// DUAS DECISÕES QUE DECLARO, porque nenhuma das duas está na ordem.
//
// (a) `comissao_base` e `comissao_valor` ficam NULAS.
//     A decisão ② (Modelo B — 10% do ágio, piso R$ 2.500? percentual próprio?
//     quem paga?) continua com o Emerson, e as colunas nasceram anuláveis na
//     0078 exatamente por isso. Gravar zero seria pior que gravar nada: zero é
//     um número e passa por regra decidida. Nulo é a verdade — "ainda não há
//     regra" — e o dia em que houver, um UPDATE preenche o histórico sem
//     precisar distinguir "comissão zero" de "comissão não definida".
//
// (b) O teto de cartas por oferta é `TETO_TELA` (500).
//     Não é limite de ordem; é coerência: o painel só consegue MOSTRAR 500, e
//     ninguém pode ofertar às cegas no que não viu. O filtro que gerou a
//     seleção fica gravado em `filtro_lote`, então "o que ele estava vendo?"
//     tem resposta depois.
//
// ----------------------------------------------------------------------------
// SEM TRANSAÇÃO, E POR ISSO COM COMPENSAÇÃO. O PostgREST não abre transação
// entre duas chamadas: o cabeçalho (`fidc_ofertas`) e os itens
// (`fidc_oferta_itens`) são dois INSERTs. Se o segundo falhar, o primeiro já
// existe — e uma oferta com cabeçalho e ZERO itens é a pior linha possível no
// banco: aparece na lista do fundo, conta como oferta viva, e não oferta nada
// a ninguém. Então o cabeçalho é APAGADO na falha dos itens, e o erro sobe.
// Perder a oferta inteira é honesto; deixar meia oferta de pé não é.
// ============================================================================
import { NextResponse } from "next/server";
import { checarFundoApi } from "@/lib/fidc-fundos";
import {
  PALAVRA_OFERTAR,
  expiraEm,
  montarLote,
  checarPct,
} from "@/lib/fidc-ofertas";
import {
  TETO_TELA,
  buscarCartasPorId,
  normalizarFiltros,
} from "@/lib/fidc-vitrine";
import { createXtvClient } from "@/lib/supabase-xtv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Forma de UUID. Existe para que id torto vire 400 NOMEADO em vez de 500.
 *
 * Sem esta guarda, um id malformado chega ao `.in()`, o PostgREST devolve erro
 * de sintaxe, o `throw` sobe e o operador lê "erro interno" para um problema
 * que é do que ele mandou. A validação é de FORMA, não de existência — quem
 * responde por existência é a releitura na view.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Corpo = {
  cartaIds?: unknown;
  pct?: unknown;
  confirmacao?: unknown;
  /** Os parâmetros de filtro que o painel estava usando. Só para registro. */
  filtro?: unknown;
};

/**
 * Os ids, limpos: só string, só forma de UUID, sem repetição e sem ordem
 * dependente do cliente.
 *
 * A deduplicação não é capricho: `fidc_oferta_itens_unico` é UNIQUE
 * (oferta_id, carta_id), então id repetido derrubaria o INSERT inteiro dos
 * itens — e, pela compensação acima, a oferta toda. Melhor tirar o duplicado
 * aqui, onde dá para explicar.
 */
function limparIds(bruto: unknown): { ids: string[]; erro: string | null } {
  if (!Array.isArray(bruto)) {
    return { ids: [], erro: "selecione ao menos uma carta." };
  }
  const vistos = new Set<string>();
  for (const v of bruto) {
    if (typeof v !== "string" || !UUID.test(v.trim())) {
      return { ids: [], erro: "há identificador de carta inválido na seleção." };
    }
    vistos.add(v.trim().toLowerCase());
  }
  const ids = [...vistos];
  if (ids.length === 0) {
    return { ids: [], erro: "selecione ao menos uma carta." };
  }
  if (ids.length > TETO_TELA) {
    return {
      ids: [],
      erro: `a seleção passa de ${TETO_TELA} cartas — divida em lotes.`,
    };
  }
  return { ids, erro: null };
}

export async function POST(req: Request) {
  // Primeira linha, sempre. Devolve 404 com o kill-switch desarmado (a rota não
  // existe para quem não deve saber que ela existe), 401 sem sessão, 403 para
  // e-mail fora de qualquer fundo ou fundo suspenso.
  const acesso = await checarFundoApi();
  if (!acesso.ok) {
    return NextResponse.json({ erro: acesso.motivo }, { status: acesso.status });
  }

  const corpo = ((await req.json().catch(() => ({}))) ?? {}) as Corpo;

  // A trava do reflexo. Comparação EXATA — sem trim tolerante, sem ignorar
  // caixa. Uma confirmação que aceita "ofertar " é uma confirmação que se
  // digita sem ler, e o que está do outro lado dela são milhões em compromisso.
  if (corpo.confirmacao !== PALAVRA_OFERTAR) {
    return NextResponse.json(
      { erro: `confirmação nominal ausente — digite ${PALAVRA_OFERTAR}.` },
      { status: 400 }
    );
  }

  const pct = typeof corpo.pct === "number" ? corpo.pct : Number(corpo.pct);
  const faixa = checarPct(pct);
  if (!faixa.ok) {
    // A faixa é conferida ANTES de qualquer ida ao banco: não há por que ler
    // 500 cartas para descobrir que o percentual não vale. E o motivo já vem
    // pronto para a tela, nomeando piso ou teto.
    return NextResponse.json({ erro: faixa.motivo }, { status: 400 });
  }

  const { ids, erro: erroIds } = limparIds(corpo.cartaIds);
  if (erroIds) return NextResponse.json({ erro: erroIds }, { status: 400 });

  // A RELEITURA. Daqui em diante, nenhum número veio do cliente.
  let achadas;
  try {
    achadas = await buscarCartasPorId(ids);
  } catch (e) {
    console.error("[fundo/ofertas] releitura da vitrine falhou:", e);
    return NextResponse.json(
      { erro: "não foi possível conferir as cartas agora. Tente de novo." },
      { status: 503 }
    );
  }

  // Pedidas que não estão mais de pé. Nomeadas, nunca omitidas.
  const indisponiveis = ids.filter((id) => !achadas.has(id));

  const lote = montarLote(
    [...achadas.values()].map((c) => ({ id: c.id, valorCredito: c.credito })),
    pct
  );

  // Não deveria acontecer — a faixa já passou lá em cima —, mas se um dia a
  // regra mudar num lugar e não no outro, a recusa sai por seu nome em vez de
  // virar uma oferta de valor errado.
  if (lote.recusa) {
    return NextResponse.json({ erro: lote.recusa }, { status: 400 });
  }

  if (lote.itens.length === 0) {
    return NextResponse.json(
      {
        erro:
          "nenhuma das cartas selecionadas pode receber oferta agora.",
        indisponiveis,
        descartadas: lote.descartadas,
      },
      { status: 409 }
    );
  }

  const agora = new Date();
  const expira = expiraEm(agora);
  const db = createXtvClient();

  // `criado_em` vai EXPLÍCITO, e não pelo default `now()` do banco. O CHECK
  // `fidc_ofertas_prazo_coerente` exige `expira_em > criado_em`; com o default,
  // os dois instantes viriam de relógios diferentes (o do Node e o do Postgres).
  // Numa janela de 24 horas a diferença nunca reprovaria o CHECK, mas o par
  // gravado deixaria de ser exatamente 24 horas — e é esse par que a tela lê
  // para dizer quanto falta. Gravados juntos, a janela é 24h por construção.
  const { data: criada, error: erroOferta } = await db
    .from("fidc_ofertas")
    .insert({
      fundo_id: acesso.fundo.id,
      escopo: lote.itens.length > 1 ? "lote" : "carta",
      filtro_lote: normalizarFiltros(
        (corpo.filtro ?? {}) as Record<string, string | string[] | undefined>
      ),
      oferta_pct_credito: pct,
      valor_total_calculado: lote.total,
      expira_em: expira.toISOString(),
      criado_em: agora.toISOString(),
      criado_por_email: acesso.email,
      // comissao_base / comissao_valor: nulos de propósito — decisão ② aberta.
    })
    .select("id")
    .single();

  if (erroOferta || !criada) {
    console.error("[fundo/ofertas] insert do cabeçalho falhou:", erroOferta);
    return NextResponse.json(
      { erro: "não foi possível registrar a oferta. Nada foi enviado." },
      { status: 500 }
    );
  }

  const { error: erroItens } = await db.from("fidc_oferta_itens").insert(
    lote.itens.map((i) => ({
      oferta_id: criada.id,
      carta_id: i.cartaId,
      valor_credito: i.valorCredito,
      valor_ofertado: i.valorOfertado,
    }))
  );

  if (erroItens) {
    // COMPENSAÇÃO. Ver o cabeçalho do arquivo: meia oferta é pior que oferta
    // nenhuma. Se a limpeza também falhar, o log grita com o id — é a única
    // linha que alguém vai precisar procurar.
    console.error("[fundo/ofertas] insert dos itens falhou:", erroItens);
    const { error: erroLimpeza } = await db
      .from("fidc_ofertas")
      .delete()
      .eq("id", criada.id);
    if (erroLimpeza) {
      console.error(
        "[fundo/ofertas] ATENÇÃO: oferta órfã sem itens, apagar à mão:",
        { oferta_id: criada.id, erro: erroLimpeza }
      );
    }
    return NextResponse.json(
      { erro: "não foi possível registrar as cartas da oferta. Nada foi enviado." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    ofertaId: criada.id,
    cartas: lote.itens.length,
    total: lote.total,
    expiraEm: expira.toISOString(),
    // As duas listas do que ficou de fora, separadas porque as causas são
    // diferentes e a tela precisa dizer coisas diferentes.
    indisponiveis,
    descartadas: lote.descartadas,
  });
}
