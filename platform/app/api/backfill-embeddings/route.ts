// ============================================================================
// Backfill de embeddings das cartas (Nível 3 — busca semântica). Server-only.
// ----------------------------------------------------------------------------
// Vetoriza cartas que ainda não têm embedding (ou cuja descrição mudou). Roda
// sob demanda OU agendado pela Vercel Cron — mesmo padrão de /api/sync-cotas:
//   - autoriza por CRON_SECRET (Authorization: Bearer <segredo>);
//   - usa createAdminClient() (service_role) só aqui, env protegida;
//   - processa em LOTE pequeno (default 25) para caber no tempo da função e não
//     estourar custo/limite da OpenAI; é idempotente e pode ser chamado em loop
//     até `restantes` chegar a 0.
//
// Para cada carta sem embedding:
//   1) descricaoDeCarta() gera um texto de catálogo NEUTRO e determinístico
//      (sem LLM → impossível violar compliance);
//   2) gerarEmbedding() vetoriza essa descrição;
//   3) UPDATE grava descricao + embedding (literal pgvector) + embedding_em.
//
// A chave da OpenAI NUNCA vai ao client/repo/log. Falha numa carta não derruba
// o lote: registra o id no array `falhas` e segue.
//
// ----------------------------------------------------------------------------
// CATALOGO-UNIFICA-01 · FASE 2 (portão g + decisão 1 do Emerson) — TRÊS MUDANÇAS
// ----------------------------------------------------------------------------
// 1) DE BANCO. Era `createAdminClient()` = projeto nnv. Medido em 20/08/2026:
//    nnv.cartas tem 2 linhas, 0 disponíveis, e as 2 JÁ têm vetor — ou seja, este
//    cron vinha rodando de hora em hora para achar nada. O estoque real está no
//    xtv: 104.965 linhas, 2.308 disponíveis, ZERO com vetor. Agora ele lê o xtv,
//    que é a mesma fonte que a busca semântica passou a consultar. UM cron, uma
//    fonte; o backfill do nnv morre por esta troca (não há segunda entrada no
//    `vercel.json` para remover).
//
// 2) DE RECORTE: só `status = 'disponivel'`. São 2.308 em vez de 104.965 — 45×
//    menos. Vetorizar carta morta custaria caro para poluir o resultado com o
//    que ninguém pode reservar. E o filtro é AUTO-MANUTENÍVEL: `disponivel AND
//    embedding IS NULL` já cobre carta nova e carta que voltou a ficar viva, sem
//    ninguém precisar lembrar de nada.
//
// 3) ORÇAMENTO DE RELÓGIO. Antes o freio era só o tamanho do lote (25) e o
//    `maxDuration` de 60s. Com 2.308 pendentes e o cron de hora em hora
//    (`"30 * * * *"`), o backfill levaria ~93 HORAS para fechar. O freio passa a
//    ser o relógio: processa enquanto couber no orçamento e para no meio quando
//    ele estoura, dizendo `parou_por_tempo: true`. Truncar é aceitável — truncar
//    em SILÊNCIO não é.
// ============================================================================
import { NextResponse } from "next/server";
import { createXtvClient } from "@/lib/supabase-xtv";
import {
  gerarEmbedding,
  embeddingParaSQL,
  descricaoDeCarta,
} from "@/lib/ia";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Precedente da casa para rota de lote longo (arte/gerar, pauta). O orçamento
// abaixo é MENOR que este teto de propósito: quem decide a parada é o código,
// que consegue relatar o que fez; não o carrasco da plataforma, que só corta.
export const maxDuration = 300;

// Com o orçamento no comando, o lote é só um teto de segurança. 400 é o que
// cabe folgado em 4 minutos a ~0,5s por carta; se a rede estiver lenta, o
// relógio corta antes e a próxima invocação continua de onde parou.
const LOTE_PADRAO = 400;
const LOTE_MAX = 1000;

// 240s de um teto de 300s. A margem de 60s cobre a contagem final e a resposta:
// estourar o `maxDuration` mataria a função sem devolver NADA — nem o que já
// tinha sido gravado, nem quantas faltam.
const ORCAMENTO_MS = 240_000;

function autorizado(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // sem secret configurado => não roda
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

function tamanhoLote(req: Request): number {
  const bruto = Number(new URL(req.url).searchParams.get("lote"));
  if (!Number.isFinite(bruto) || bruto <= 0) return LOTE_PADRAO;
  return Math.min(Math.floor(bruto), LOTE_MAX);
}

type CartaParaVetorizar = {
  id: string;
  tipo: string;
  valor_credito: number;
  valor_entrada: number | null;
  valor_parcela: number | null;
  qtd_parcelas: number | null;
};

async function processar(req: Request) {
  if (!autorizado(req)) {
    return NextResponse.json({ ok: false, erro: "nao_autorizado" }, { status: 401 });
  }

  const comecou = Date.now();
  const db = createXtvClient();
  const lote = tamanhoLote(req);

  // Cartas DISPONÍVEIS ainda sem embedding. Ordena por mais antiga primeiro
  // (estável). O `.eq("status","disponivel")` é o recorte da decisão 1 e não é
  // opcional: sem ele a fila vira 104.965 cartas, das quais 102.657 estão
  // mortas e nunca serão reservadas por ninguém.
  const { data: pendentes, error: errSelect } = await db
    .from("cartas")
    .select("id, tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas")
    .eq("status", "disponivel")
    .is("embedding", null)
    .order("criado_em", { ascending: true })
    .limit(lote);

  if (errSelect) {
    return NextResponse.json(
      { ok: false, etapa: "selecao", erro: errSelect.message },
      { status: 500 }
    );
  }

  const fila = (pendentes ?? []) as CartaParaVetorizar[];
  if (fila.length === 0) {
    // Zero REAL: o select respondeu sem erro e veio vazio (o `errSelect` acima
    // já tratou a falha). Não há nada disponível sem vetor — o índice fechou.
    return NextResponse.json({
      ok: true,
      processadas: 0,
      falhas: [],
      parou_por_tempo: false,
      restantes: 0,
      restantes_desconhecido: false,
    });
  }

  let processadas = 0;
  let parouPorTempo = false;
  const falhas: string[] = [];

  // Sequencial de propósito: respeita rate-limit da OpenAI e mantém custo previsível.
  for (const carta of fila) {
    // ORÇAMENTO: a checagem vem ANTES de gastar a próxima chamada à OpenAI, não
    // depois. Checar no fim gastaria uma requisição que já se sabia não caber —
    // e é justamente a chamada de rede que pode estourar o teto da função.
    if (Date.now() - comecou > ORCAMENTO_MS) {
      parouPorTempo = true;
      break;
    }
    try {
      const descricao = descricaoDeCarta(carta);
      const vetor = await gerarEmbedding(descricao);
      const { error: errUpdate } = await db
        .from("cartas")
        .update({
          descricao,
          embedding: embeddingParaSQL(vetor),
          embedding_em: new Date().toISOString(),
        })
        .eq("id", carta.id);
      if (errUpdate) {
        falhas.push(carta.id);
        continue;
      }
      processadas += 1;
    } catch {
      // rede/timeout/embedding inválido — não derruba o lote.
      falhas.push(carta.id);
    }
  }

  // Quantas ainda faltam depois deste lote (para o chamador saber se repete).
  //
  // REGRA 19 AQUI, e este era um caso real: o código antigo escrevia
  // `restantes: restantes ?? 0`, descartando o erro. Contagem que FALHA e fila
  // que ACABOU produziam o mesmo `restantes: 0` — o sinal de "terminou". Quem
  // lesse o log concluiria que o backfill fechou justamente quando ele não
  // conseguiu nem perguntar. Agora são estados distintos: `null` é NÃO SEI.
  const { count, error: errContagem } = await db
    .from("cartas")
    .select("id", { count: "exact", head: true })
    .eq("status", "disponivel")
    .is("embedding", null);

  if (errContagem) {
    console.error("[backfill-embeddings] contagem de restantes falhou —", errContagem.message);
  }

  return NextResponse.json({
    ok: true,
    processadas,
    falhas,
    parou_por_tempo: parouPorTempo,
    restantes: errContagem ? null : (count ?? 0),
    restantes_desconhecido: !!errContagem,
  });
}

// POST é o verbo natural (muta estado). GET é alias para o cron agendado da
// Vercel, que dispara por GET — ambos passam pela mesma autorização.
export async function POST(req: Request) {
  return processar(req);
}
export async function GET(req: Request) {
  return processar(req);
}
