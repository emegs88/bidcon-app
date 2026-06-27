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
// ============================================================================
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  gerarEmbedding,
  embeddingParaSQL,
  descricaoDeCarta,
} from "@/lib/ia";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Vetorizar várias cartas pode passar dos 10s padrão da função serverless.
export const maxDuration = 60;

const LOTE_PADRAO = 25;
const LOTE_MAX = 100;

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

  const db = createAdminClient();
  const lote = tamanhoLote(req);

  // Cartas ainda sem embedding. Ordena por mais antiga primeiro (estável).
  const { data: pendentes, error: errSelect } = await db
    .from("cartas")
    .select("id, tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas")
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
    return NextResponse.json({ ok: true, processadas: 0, falhas: [], restantes: 0 });
  }

  let processadas = 0;
  const falhas: string[] = [];

  // Sequencial de propósito: respeita rate-limit da OpenAI e mantém custo previsível.
  for (const carta of fila) {
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
  const { count: restantes } = await db
    .from("cartas")
    .select("id", { count: "exact", head: true })
    .is("embedding", null);

  return NextResponse.json({
    ok: true,
    processadas,
    falhas,
    restantes: restantes ?? 0,
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
