// POST /api/admin/importar/publicar — grava as linhas selecionadas pelo
// usuário no /admin/importar. FATIA F1. Gate: checarAdminConsoleApi().
// ----------------------------------------------------------------------------
// NUNCA confia no que veio do client (categoria/fingerprint/administradora_id
// do preview): revalida cada linha (revalidarLinha) e recategoriza do zero
// (analisarLote) antes de decidir INSERT/UPDATE/pular. Sequencial, não
// transacional — melhor esforço: erro numa linha não aborta o lote inteiro,
// só é contabilizado e a próxima segue.
//
// 'nova'        -> INSERT cartas (trigger bidcon_price_calcular cuida do
//                  preço/quarentena — inclui as 5 colunas observadas no SET).
// 'alterada'    -> UPDATE na carta já identificada (mesmo fornecedor +
//                  numero_externo), incluindo as 5 colunas observadas.
// 'ja_existe' / 'com_problema' -> pulada, conta em "rejeitadas".
import { NextResponse } from "next/server";
import { checarAdminConsoleApi } from "@/lib/admin-console";
import { createXtvClient } from "@/lib/supabase-xtv";
import { revalidarLinha } from "@/lib/importador-source";
import { analisarLote } from "@/lib/importador-preview";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const acesso = await checarAdminConsoleApi();
  if (!acesso.ok) {
    return NextResponse.json({ erro: acesso.motivo }, { status: acesso.status });
  }

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return NextResponse.json({ erro: "corpo inválido (esperado JSON)." }, { status: 400 });
  }
  const r = (corpo ?? {}) as Record<string, unknown>;
  const fornecedorId = typeof r.fornecedor_id === "string" ? r.fornecedor_id : null;
  const origem = typeof r.origem === "string" && r.origem.trim() ? r.origem.trim() : "console";
  const arquivoNome = typeof r.arquivo_nome === "string" ? r.arquivo_nome : null;
  const linhasRecebidas = Array.isArray(r.linhas) ? (r.linhas as unknown[]) : [];

  if (!fornecedorId) {
    return NextResponse.json({ erro: "fornecedor_id é obrigatório." }, { status: 400 });
  }
  if (linhasRecebidas.length === 0) {
    return NextResponse.json({ erro: "nenhuma linha selecionada." }, { status: 400 });
  }

  const supabase = createXtvClient();

  // revalida cada linha a partir dos campos brutos recebidos (nunca confia em problemas/categoria do client).
  const linhasRevalidadas = linhasRecebidas.map((l) => revalidarLinha((l ?? {}) as Record<string, unknown>));

  let analise: Awaited<ReturnType<typeof analisarLote>>;
  try {
    analise = await analisarLote(supabase, fornecedorId, linhasRevalidadas);
  } catch (e) {
    console.error("[admin/importar/publicar] falha na revalidação:", e);
    return NextResponse.json({ erro: "falha ao revalidar o lote." }, { status: 500 });
  }

  const { data: importacao, error: erroImportacao } = await supabase
    .from("importacoes")
    .insert({
      fornecedor_id: fornecedorId,
      origem,
      arquivo_nome: arquivoNome,
      status: "previa",
      criado_por: acesso.email,
    })
    .select("id")
    .single();
  if (erroImportacao || !importacao) {
    console.error("[admin/importar/publicar] falha ao criar importacao:", erroImportacao);
    return NextResponse.json({ erro: "não foi possível iniciar a importação." }, { status: 500 });
  }
  const importacaoId = importacao.id as string;

  let novas = 0;
  let alteradas = 0;
  let rejeitadas = 0;
  let erros = 0;

  for (const l of analise.linhas) {
    if (l.categoria === "ja_existe" || l.categoria === "com_problema") {
      rejeitadas++;
      continue;
    }
    try {
      if (l.categoria === "nova") {
        const { error } = await supabase.from("cartas").insert({
          tipo: l.tipo,
          valor_credito: l.credito,
          valor_entrada: l.entrada,
          valor_parcela: l.parcela,
          qtd_parcelas: l.parcelas,
          administradora_id: l.administradora_id,
          administradora_raw: l.adm,
          numero_externo: l.numero_externo,
          fornecedor_id: fornecedorId,
          importacao_id: importacaoId,
          criado_via: "console",
          status: "disponivel",
        });
        if (error) throw error;
        novas++;
      } else if (l.categoria === "alterada" && l.carta_id_existente) {
        const { error } = await supabase
          .from("cartas")
          .update({
            tipo: l.tipo,
            valor_credito: l.credito,
            valor_entrada: l.entrada,
            valor_parcela: l.parcela,
            qtd_parcelas: l.parcelas,
            administradora_id: l.administradora_id,
            administradora_raw: l.adm,
            importacao_id: importacaoId,
          })
          .eq("id", l.carta_id_existente);
        if (error) throw error;
        alteradas++;
      } else {
        rejeitadas++;
      }
    } catch (e) {
      console.error("[admin/importar/publicar] falha ao gravar linha:", e);
      erros++;
    }
  }

  const totalLinhas = analise.linhas.length;
  await supabase
    .from("importacoes")
    .update({
      status: "publicada",
      publicada_em: new Date().toISOString(),
      total_linhas: totalLinhas,
      novas,
      alteradas,
      rejeitadas: rejeitadas + erros,
    })
    .eq("id", importacaoId);

  return NextResponse.json({
    ok: true,
    importacao_id: importacaoId,
    resumo: { total: totalLinhas, novas, alteradas, rejeitadas, erros },
  });
}
