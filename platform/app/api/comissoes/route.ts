// GET /api/comissoes?administradora=<slug>
// Grade de comissão da Prospere por administradora (consorcios.comissoes via
// RPC consorcios_comissoes, projeto xtv — mesmo caminho de /api/analista-grupos).
//
// Regra dura: a grade é casada pelo administradora_id da administradora
// PEDIDA. Sem administradora cadastrada, ou sem grade dela, a resposta vem
// vazia — nunca a grade de outra administradora. Herdar a grade da Porto para
// mostrar um número na tela da Disal seria inventar receita.
//
// Estado em 28/07/2026: Porto (id 1) com 6 grades; Disal (id 2) CADASTRADA e
// sem nenhuma grade. Estar cadastrada não é ter grade — a resposta sai
// `cadastrada: true, grades: []` e a tela fica muda, igual a uma
// administradora inexistente. Coberto por lib/comissao.test.ts.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createXtvClient } from "@/lib/supabase-xtv";
import { gradesVigentesDaAdministradora, type GradeComissao } from "@/lib/comissao";

export const dynamic = "force-dynamic";

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
    // filtro em lib pura e testada (lib/comissao.ts + comissao.test.ts):
    // administradora cadastrada SEM grade devolve [], igual a não cadastrada.
    const grades = gradesVigentesDaAdministradora(
      (data ?? []) as unknown as GradeComissao[],
      adms.id,
      hoje,
    );

    return NextResponse.json({ administradora: slug, cadastrada: true, grades });
  } catch (e: any) {
    return NextResponse.json({ erro: e?.message ?? "erro interno" }, { status: 500 });
  }
}
