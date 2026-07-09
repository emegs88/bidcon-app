// ============================================================================
// GET /api/vitrine — endpoint PÚBLICO de leitura das cartas disponíveis,
// direto do xtv (fonte de verdade da vitrine/Bidcon Price). Server-only.
// ----------------------------------------------------------------------------
// Fatia VITRINE-FENOMENO-01: alimenta o index.html (cotasAoVivo()) como fonte
// PRIMÁRIA — os feeds do 360prospere seguem como fallback lá no front, se
// esta chamada falhar. NÃO grava nada; NÃO chama RPC; só leitura.
//
// Mesmo client/filtro do blocoCartas() (app/api/atende/route.ts): a policy
// de select da vitrine só libera `authenticated`, então anon-key não
// devolveria linha nenhuma — createXtvClient() (service_role) é obrigatório
// aqui, não só estilo.
//
// CORS/preflight: mesmo padrão do atende, via lib/api-guard.ts (allowlist de
// origem + rate-limit por IP). Cache de borda: s-maxage=120,
// stale-while-revalidate=600 — a vitrine não precisa de dado ao segundo.
//
// COMPLIANCE (CLAUDE.md): nunca data de contemplação; custo/TIR é o custo do
// crédito para o comprador (referência), não retorno/rendimento.
// ============================================================================
import { NextResponse } from "next/server";
import { createXtvClient } from "@/lib/supabase-xtv";
import {
  origemPermitida,
  rateLimitExcedido,
  ipDe,
  corsHeaders,
  handlePreflight,
} from "@/lib/api-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type LinhaCarta = {
  numero_externo: number | null;
  tipo: string | null;
  valor_credito: number | null;
  valor_entrada: number | null;
  valor_parcela: number | null;
  qtd_parcelas: number | null;
  bidcon_custo_am: number | null;
  bidcon_agio_120: number | null;
  bidcon_agio_150: number | null;
  administradora: { nome: string | null } | { nome: string | null }[] | null;
};

// Preflight CORS (bidcon.com.br chamando app.bidcon.com.br).
export async function OPTIONS(req: Request) {
  return handlePreflight(req);
}

// administradora vem como objeto (FK 1:1) na maioria dos clients, mas o
// supabase-js tipa join-a-um como array — normaliza os dois formatos.
function nomeAdministradora(a: LinhaCarta["administradora"]): string | null {
  if (!a) return null;
  if (Array.isArray(a)) return a[0]?.nome ?? null;
  return a.nome ?? null;
}

function num(v: number | null): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export async function GET(req: Request) {
  if (!origemPermitida(req)) {
    return NextResponse.json(
      { ok: false, erro: "origem não permitida" },
      { status: 403, headers: corsHeaders(req) }
    );
  }
  const ip = ipDe(req);
  if (rateLimitExcedido(ip)) {
    return NextResponse.json(
      { ok: false, erro: "limite de requisições excedido" },
      { status: 429, headers: corsHeaders(req) }
    );
  }

  try {
    const supabase = createXtvClient();

    const campos =
      "numero_externo,tipo,valor_credito,valor_entrada," +
      "valor_parcela,qtd_parcelas,bidcon_custo_am,bidcon_agio_120,bidcon_agio_150," +
      "administradora:administradora_id(nome)";

    // O gateway do Supabase corta em 1000 linhas por resposta mesmo com
    // .limit() maior — pagina via .range() até esgotar ou bater o teto de
    // segurança (5 páginas = 5000 linhas). .order(bidcon_agio_150,
    // bidcon_custo_am) não é única, então soma-se .order("id") como
    // tiebreaker estável — sem ele, o .range() pode pular ou duplicar
    // linhas empatadas entre páginas.
    const POR_PAGINA = 1000;
    const MAX_PAGINAS = 5;

    async function buscaCartasPaginado() {
      const todas: LinhaCarta[] = [];
      let pagina = 0;
      while (pagina < MAX_PAGINAS) {
        const { data, error } = await supabase
          .from("cartas")
          .select(campos)
          .eq("status", "disponivel")
          .order("bidcon_agio_150", { ascending: false })
          .order("bidcon_custo_am", { ascending: true })
          .order("id", { ascending: true })
          .range(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA - 1);
        if (error) throw error;
        todas.push(...((data ?? []) as unknown as LinhaCarta[]));
        if (!data || data.length < POR_PAGINA) break;
        pagina++;
      }
      return todas;
    }

    let linhas: LinhaCarta[];
    let novasHoje: number | null;
    let erroNovas: unknown;
    try {
      const [cartasPaginadas, resultadoNovas] = await Promise.all([
        buscaCartasPaginado(),
        supabase
          .from("eventos_sync")
          .select("id", { count: "exact", head: true })
          .eq("tipo", "carta_nova")
          .gte("em", new Date().toISOString().slice(0, 10)),
      ]);
      linhas = cartasPaginadas;
      novasHoje = resultadoNovas.count;
      erroNovas = resultadoNovas.error;
    } catch {
      return NextResponse.json(
        { ok: false, erro: "falha ao ler cartas" },
        { status: 500, headers: corsHeaders(req) }
      );
    }

    const cotas = linhas.map((c) => ({
      n: c.numero_externo,
      t: c.tipo,
      c: num(c.valor_credito),
      e: num(c.valor_entrada),
      p: num(c.valor_parcela),
      x: num(c.qtd_parcelas),
      adm: nomeAdministradora(c.administradora),
      custo: c.bidcon_custo_am,
      agio150: c.bidcon_agio_150,
      agio120: c.bidcon_agio_120,
    }));

    return NextResponse.json(
      {
        ok: true,
        atualizado: new Date().toISOString(),
        novas_hoje: erroNovas ? 0 : novasHoje ?? 0,
        cotas,
      },
      {
        status: 200,
        headers: {
          ...corsHeaders(req),
          "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600",
        },
      }
    );
  } catch {
    return NextResponse.json(
      { ok: false, erro: "falha interna" },
      { status: 500, headers: corsHeaders(req) }
    );
  }
}
