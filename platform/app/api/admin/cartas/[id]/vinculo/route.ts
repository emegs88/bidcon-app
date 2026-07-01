// POST /api/admin/cartas/[id]/vinculo — associa/reassocia a administradora
// (pública) e o fornecedor (admin-only) de uma carta.
//
// Mesma estrutura do /api/admin/parceiros/[id]/status:
//   1) client COM RLS (createClient) só para identificar o chamador e checar papel;
//   2) escrita com createAdminClient() (service_role) DEPOIS de confirmar admin.
// A service_role NUNCA é exposta ao client; vive só neste handler de servidor.
//
// COMPLIANCE: fornecedor_id é segredo operacional (admin-only por RLS, ver 0011).
//   Só admin chega aqui (guard abaixo), então pode gravar os dois. O payload de
//   resposta NÃO devolve nome de fornecedor — só { ok:true }.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type Body = {
  administradora_id?: unknown;
  fornecedor_id?: unknown;
  // metadados admin-only da carta (nunca vão ao payload de cliente/parceiro):
  fonte?: unknown; // site de origem (texto curto)
  comissao_percentual?: unknown; // % da carta (0..100), null p/ limpar
};

// aceita string uuid ou null (para desvincular). Qualquer outra coisa => inválido.
function normalizarUuid(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") return null;
    // validação leve de uuid (não confia em formato; o FK no banco é a trava real)
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
      return s;
    }
    return undefined; // string não-uuid => rejeita
  }
  return undefined; // campo ausente => não mexe
}

// fonte: texto curto (origem interna). "" => null (limpa). >120 => rejeita.
function normalizarFonte(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") return null;
    if (s.length > 120) return undefined;
    return s;
  }
  return undefined;
}

// comissao_percentual: número 0..100 (2 casas) ou null. String numérica aceita.
function normalizarPercentual(v: unknown): number | null | undefined {
  if (v === null) return null;
  if (v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 100) return undefined;
  return Math.round(n * 100) / 100;
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const { data: perfil } = await supabase
    .from("profiles")
    .select("tipo")
    .eq("id", user.id)
    .maybeSingle();

  if (!perfil || perfil.tipo !== "admin") {
    return NextResponse.json({ erro: "Sem permissão." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;

  // só inclui no update os campos realmente enviados (undefined = não mexe).
  const patch: {
    administradora_id?: string | null;
    fornecedor_id?: string | null;
    fonte?: string | null;
    comissao_percentual?: number | null;
  } = {};

  if ("administradora_id" in body) {
    const a = normalizarUuid(body.administradora_id);
    if (a === undefined) {
      return NextResponse.json({ erro: "administradora_id inválido." }, { status: 422 });
    }
    patch.administradora_id = a;
  }
  if ("fornecedor_id" in body) {
    const f = normalizarUuid(body.fornecedor_id);
    if (f === undefined) {
      return NextResponse.json({ erro: "fornecedor_id inválido." }, { status: 422 });
    }
    patch.fornecedor_id = f;
  }
  if ("fonte" in body) {
    const s = normalizarFonte(body.fonte);
    if (s === undefined) {
      return NextResponse.json({ erro: "fonte inválida." }, { status: 422 });
    }
    patch.fonte = s;
  }
  if ("comissao_percentual" in body) {
    const c = normalizarPercentual(body.comissao_percentual);
    if (c === undefined) {
      return NextResponse.json(
        { erro: "comissao_percentual deve ser um número entre 0 e 100." },
        { status: 422 }
      );
    }
    patch.comissao_percentual = c;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ erro: "Nada para atualizar." }, { status: 422 });
  }

  // Escrita privilegiada — só depois de confirmar que o chamador é admin.
  // FK no banco (referências administradoras/fornecedores) é a trava real de
  // integridade: id inexistente => erro 400 do Postgres, não grava lixo.
  const admin = createAdminClient();
  const { error } = await admin.from("cartas").update(patch).eq("id", params.id);

  if (error) {
    return NextResponse.json(
      { erro: "Não foi possível atualizar o vínculo da carta." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
