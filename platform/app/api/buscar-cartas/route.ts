// POST /api/buscar-cartas — busca de cartas por linguagem natural (Nível 3).
// ----------------------------------------------------------------------------
// Fluxo (busca HÍBRIDA — ver lib/ia.ts e migration 0007):
//   1) exige usuário autenticado (busca é da área logada, como a vitrine);
//   2) rate-limit por usuário (anti-abuso de custo da OpenAI);
//   3) EM PARALELO: extrai filtros duros (LLM) + gera embedding do desejo;
//   4) chama a RPC buscar_cartas_semantica (filtros duros em SQL + ranking vetor);
//   5) gera uma frase de encaixe por carta (compliance-locked) e devolve.
// Mutação? Não — é leitura. Mas mantemos Route Handler + force-dynamic porque
// usa a sessão e chama serviço externo.
//
// CATALOGO-UNIFICA-01 · FASE 2 (portão g) — DOIS CLIENTES, DE PROPÓSITO:
//   AUTENTICAÇÃO fica no nnv, com RLS (`createClient`). Quem é a pessoa, se ela
//   está logada e qual o rate-limit dela — nada disso mudou de lugar.
//   A BUSCA passa a rodar no xtv (`createXtvClient`), porque é lá que o estoque
//   vive. Medido em 20/08/2026: nnv.cartas = 2 linhas, 0 disponíveis, 2 com
//   vetor; xtv.cartas = 104.965 linhas, 2.308 disponíveis. A busca semântica no
//   nnv era, na prática, uma busca sobre estoque vazio.
//
// As duas RPCs `buscar_cartas_semantica` são IDÊNTICAS em assinatura e em
// colunas de retorno (conferido por `pg_get_functiondef` nos dois projetos em
// 20/08), então o de-para aqui é a troca do cliente e nada mais.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createXtvClient } from "@/lib/supabase-xtv";
import {
  extrairIntencao,
  gerarEmbedding,
  embeddingParaSQL,
  fraseDeEncaixe,
  type CartaParaFrase,
} from "@/lib/ia";

export const dynamic = "force-dynamic";

const MAX_TEXTO = 400;
const LIMITE_RESULTADOS = 3;

// ── Rate-limit em memória (por instância). Suficiente para conter abuso de
//    custo; um limitador durável (KV) entra quando o tráfego justificar. ──────
const JANELA_MS = 60_000; // 1 min
const MAX_POR_JANELA = 8; // buscas por usuário por minuto
const acessos = new Map<string, number[]>();

function rateLimited(chave: string): boolean {
  const agora = Date.now();
  const recentes = (acessos.get(chave) ?? []).filter((t) => agora - t < JANELA_MS);
  if (recentes.length >= MAX_POR_JANELA) {
    acessos.set(chave, recentes);
    return true;
  }
  recentes.push(agora);
  acessos.set(chave, recentes);
  // limpeza preguiçosa para o Map não crescer sem limite
  if (acessos.size > 5_000) {
    for (const [k, ts] of acessos) {
      if (ts.every((t) => agora - t >= JANELA_MS)) acessos.delete(k);
    }
  }
  return false;
}

type Body = { texto?: unknown };

export async function POST(req: Request) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  if (rateLimited(user.id)) {
    return NextResponse.json(
      { erro: "Muitas buscas em sequência. Aguarde um instante." },
      { status: 429 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const texto = typeof body.texto === "string" ? body.texto.trim() : "";
  if (texto.length < 3) {
    return NextResponse.json(
      { erro: "Descreva o que você procura (ao menos algumas palavras)." },
      { status: 422 }
    );
  }
  const desejo = texto.slice(0, MAX_TEXTO);

  // 3) filtros duros + embedding em paralelo
  let intencao;
  let embedding: number[];
  try {
    [intencao, embedding] = await Promise.all([
      extrairIntencao(desejo),
      gerarEmbedding(desejo),
    ]);
  } catch {
    return NextResponse.json(
      { erro: "Não foi possível processar a busca agora. Tente de novo." },
      { status: 503 }
    );
  }

  // 4) RPC no xtv: filtros duros em SQL + ranking por vetor (só estoque
  //    disponível E com vetor — o `embedding is not null` está dentro da função).
  const xtv = createXtvClient();
  const { data: cartas, error } = await xtv.rpc("buscar_cartas_semantica", {
    p_embedding: embeddingParaSQL(embedding),
    p_tipo: intencao.tipo_bem,
    p_valor_max: intencao.valor_max,
    p_entrada_max: intencao.entrada_max,
    p_limite: LIMITE_RESULTADOS,
  });

  if (error) {
    return NextResponse.json(
      { erro: "Não foi possível buscar as cartas agora." },
      { status: 400 }
    );
  }

  type Linha = CartaParaFrase & {
    id: string;
    valor_parcela: number | null;
    qtd_parcelas: number | null;
    score: number;
  };
  const lista = (cartas ?? []) as Linha[];

  // ── REGRA 19 NA BUSCA: zero por falta de VETOR não é zero por falta de CARTA.
  //
  // A função filtra por `embedding is not null`. Medido em 20/08/2026, ANTES do
  // backfill re-apontado: xtv tinha 2.308 cartas disponíveis e ZERO vetores.
  // Nesse estado a RPC devolve lista vazia, sem erro nenhum — e a tela diria
  // "Nada encontrado para esse pedido", como se a casa não tivesse a carta que
  // a pessoa pediu. Mentira por omissão: a carta está lá, quem não está pronto
  // é o índice.
  //
  // O controle custa uma contagem, e SÓ no caminho do zero — busca com resultado
  // não paga nada. E é um controle que pode disparar de verdade (Regra 9): hoje
  // ele dispara; conforme o backfill anda, ele para de disparar sozinho.
  if (lista.length === 0) {
    const { count, error: erroControle } = await xtv
      .from("cartas")
      .select("id", { count: "exact", head: true })
      .eq("status", "disponivel")
      .not("embedding", "is", null);

    // Se nem o controle respondeu, também não dá para afirmar "nada encontrado".
    if (erroControle) {
      console.error("[busca] controle de índice falhou —", erroControle.message);
      return NextResponse.json(
        { erro: "Não foi possível buscar as cartas agora. Tente de novo." },
        { status: 503 }
      );
    }

    if ((count ?? 0) === 0) {
      console.warn("[busca] índice semântico VAZIO — nenhuma carta disponível tem vetor");
      return NextResponse.json(
        {
          erro:
            "A busca por descrição ainda está sendo preparada. " +
            "Enquanto isso, veja as cartas disponíveis na vitrine.",
        },
        { status: 503 }
      );
    }
  }

  // 5) frase de encaixe por carta (paralelo; cada uma já cai em fallback seguro)
  const comFrase = await Promise.all(
    lista.map(async (c) => ({
      id: c.id,
      tipo: c.tipo,
      valor_credito: c.valor_credito,
      valor_entrada: c.valor_entrada,
      valor_parcela: c.valor_parcela,
      qtd_parcelas: c.qtd_parcelas,
      encaixe: await fraseDeEncaixe(desejo, {
        tipo: c.tipo,
        valor_credito: c.valor_credito,
        valor_entrada: c.valor_entrada,
      }),
    }))
  );

  return NextResponse.json({
    cartas: comFrase,
    criterios: {
      tipo_bem: intencao.tipo_bem,
      valor_max: intencao.valor_max,
      entrada_max: intencao.entrada_max,
    },
  });
}
