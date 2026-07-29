// GET /api/comissoes?administradora=<slug>
// Grade de comissão da Prospere por administradora (consorcios.comissoes via
// RPC consorcios_comissoes, projeto xtv — mesmo caminho de /api/analista-grupos).
//
// Regra dura: a grade é casada pelo administradora_id da administradora
// PEDIDA. Sem administradora cadastrada, ou sem grade dela, a resposta vem
// vazia — nunca a grade de outra administradora. Herdar a grade da Porto para
// mostrar um número na tela da Disal seria inventar receita.
//
// Hoje só a Porto (id 1) tem grade cadastrada; a Disal ainda não existe em
// consorcios.administradoras. Esta rota já responde certo quando existir.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createXtvClient } from "@/lib/supabase-xtv";

export const dynamic = "force-dynamic";

type GradeComissao = {
  administradora_id: number | null;
  segmento: string;
  parcelamento_adesao: string;
  pct_total: number | string | null;
  cronograma: number[] | null;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  observacao: string | null;
};

export async function GET(req: NextRequest) {
  try {
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
    if (perfil?.tipo !== "admin") {
      return NextResponse.json({ erro: "Sem permissão." }, { status: 403 });
    }

    const slug = (req.nextUrl.searchParams.get("administradora") ?? "").trim().toLowerCase();
    if (!slug) {
      return NextResponse.json({ erro: "administradora ausente" }, { status: 400 });
    }

    const db = createXtvClient();
    const { data: adms, error: errAdm } = await db
      .schema("consorcios")
      .from("administradoras")
      .select("id, slug")
      .eq("slug", slug)
      .maybeSingle();
    if (errAdm) throw errAdm;
    if (!adms) {
      // administradora não cadastrada — resposta honesta, sem grade emprestada
      return NextResponse.json({ administradora: slug, cadastrada: false, grades: [] });
    }

    const { data, error } = await db.rpc("consorcios_comissoes");
    if (error) throw error;

    const hoje = new Date().toISOString().slice(0, 10);
    const grades = ((data ?? []) as unknown as GradeComissao[]).filter(
      (g) =>
        g.administradora_id === adms.id &&
        (g.vigencia_inicio == null || g.vigencia_inicio <= hoje) &&
        (g.vigencia_fim == null || g.vigencia_fim >= hoje),
    );

    return NextResponse.json({ administradora: slug, cadastrada: true, grades });
  } catch (e: any) {
    return NextResponse.json({ erro: e?.message ?? "erro interno" }, { status: 500 });
  }
}
