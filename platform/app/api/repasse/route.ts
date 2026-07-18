// ============================================================================
// GET /api/repasse — endpoint PÚBLICO de leitura das cotas em REPASSE
// (capital de giro), direto do xtv. Server-only. Espelha app/api/vitrine/
// route.ts quase linha a linha — mesmas guardas de CORS/rate-limit, mesmo
// client (service_role), mesma paginação. Única diferença de fundo: lê
// `vw_vitrine_viva`,não; lê a nova `vw_repasse_viva` (fatia REPASSE-CAPGIRO-01,
// migration 0056), que filtra `categoria='repasse'` em vez de 'contemplada'.
// ----------------------------------------------------------------------------
// REPASSE-CAPGIRO-01: alimenta o grid novo em public/repasse.html — ao clicar
// num card, o simulador "Simule seu bem" já existente naquela página (motor
// client-side, porta 1:1 de lib/reserve/repasse-pricing.ts) é preenchido com
// os dados reais da cota. Este endpoint NÃO calcula CET/cascata/garantia —
// só devolve os dados crus da cota (parcela, prazo, crédito, saldo devedor
// nominal já calculado na view). NÃO grava nada; NÃO chama RPC; só leitura.
//
// SALDO DEVEDOR: `saldo_devedor` já vem calculado pela view
// (valor_parcela × qtd_parcelas, nominal) — mesma convenção do modal
// "Custos de transferência" da vitrine principal (custosDe() em
// public/index.html). Rótulo no front deve deixar claro que é estimativa,
// sujeita aos valores finais da administradora — ver disclaimer em
// repasse.html.
//
// COMPLIANCE (CLAUDE.md): nunca data de contemplação; custo/CET é o custo da
// operação de assunção (referência), não retorno/rendimento.
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

type LinhaRepasse = {
  ref: number | null;
  tipo: string | null;
  credito: number | null;
  entrada: number | null;
  parcela: number | null;
  parcelas: number | null;
  saldo_devedor: number | null;
  administradora: string | null;
};

// Preflight CORS (bidcon.com.br chamando app.bidcon.com.br) — mesmo padrão.
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

    const campos = "ref,tipo,credito,entrada,parcela,parcelas,saldo_devedor,administradora";

    // Volume esperado é pequeno (dezenas de cotas hoje) — sem paginação
    // por .range() como a vitrine principal; .limit(500) é teto de
    // segurança bem folgado, não um comportamento esperado.
    const { data, error } = await supabase
      .from("vw_repasse_viva")
      .select(campos)
      .order("parcela", { ascending: true })
      .limit(500);

    if (error) throw error;

    const linhas = (data ?? []) as unknown as LinhaRepasse[];

    const cotas = linhas.map((c) => ({
      n: c.ref,
      t: c.tipo,
      c: num(c.credito),
      e: num(c.entrada),
      p: num(c.parcela),
      x: num(c.parcelas),
      saldo: num(c.saldo_devedor),
      adm: c.administradora,
    }));

    return NextResponse.json(
      {
        ok: true,
        atualizado: new Date().toISOString(),
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
