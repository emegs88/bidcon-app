// ============================================================================
// GET /api/vitrine — endpoint PÚBLICO de leitura das cartas disponíveis,
// direto do xtv (fonte de verdade da vitrine/Bidcon Price). Server-only.
// ----------------------------------------------------------------------------
// Fatia VITRINE-FENOMENO-01: alimenta o index.html (cotasAoVivo()) como fonte
// PRIMÁRIA — os feeds do 360prospere seguem como fallback lá no front, se
// esta chamada falhar. NÃO grava nada; NÃO chama RPC; só leitura.
//
// RESERVA-01: a fonte deixou de ser a tabela `cartas` direto e passou a ser a
// VIEW `vw_vitrine_viva` — ela já embute `status='disponivel' AND
// valor_credito>0 AND NOT EXISTS(reserva ativa com mesmo fingerprint)`, ou
// seja, uma carta reservada via chat (ver app/api/atende/route.ts) some
// daqui automaticamente, sem esta rota precisar saber nada de `reservas`.
// `cartas.status` NUNCA muda quando uma reserva é criada — só a view filtra.
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
  ref: number | null;
  tipo: string | null;
  credito: number | null;
  entrada: number | null;
  parcela: number | null;
  parcelas: number | null;
  custo_am: number | null;
  agio_120: number | null;
  agio_150: number | null;
  administradora: string | null;
};

// Preflight CORS (bidcon.com.br chamando app.bidcon.com.br).
export async function OPTIONS(req: Request) {
  return handlePreflight(req);
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
      "ref,tipo,credito,entrada,parcela,parcelas,custo_am,agio_120,agio_150,administradora";

    // O gateway do Supabase corta em 1000 linhas por resposta mesmo com
    // .limit() maior — pagina via .range() até esgotar ou bater o teto de
    // segurança (5 páginas = 5000 linhas). .order(agio_150, custo_am) não é
    // única, então soma-se .order("id") como tiebreaker estável — sem ele,
    // o .range() pode pular ou duplicar linhas empatadas entre páginas.
    const POR_PAGINA = 1000;
    const MAX_PAGINAS = 5;

    async function buscaCartasPaginado() {
      const todas: LinhaCarta[] = [];
      let pagina = 0;
      while (pagina < MAX_PAGINAS) {
        const { data, error } = await supabase
          .from("vw_vitrine_viva")
          .select(campos)
          .order("agio_150", { ascending: false })
          .order("custo_am", { ascending: true })
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
      n: c.ref,
      t: c.tipo,
      c: num(c.credito),
      e: num(c.entrada),
      p: num(c.parcela),
      x: num(c.parcelas),
      adm: c.administradora,
      custo: c.custo_am,
      agio150: c.agio_150,
      agio120: c.agio_120,
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
