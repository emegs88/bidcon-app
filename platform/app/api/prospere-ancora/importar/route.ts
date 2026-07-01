// POST /api/prospere-ancora/importar — popula ancora_tabela com JSON real do
// portal da Âncora (cotas NOVAS). USO INTERNO DA EQUIPE PROSPERE.
// ----------------------------------------------------------------------------
// Defesa em duas camadas, igual ao padrão das rotas admin:
//   1) client COM RLS (createClient) só para identificar o chamador e confirmar
//      que o e-mail é @prospere.com.br (ehEquipeProspere);
//   2) escrita com createAdminClient() (service_role) SÓ depois de confirmar a
//      equipe. A service_role nunca é exposta ao client; vive só neste handler.
//
// CONTRATO: os valores (1ª parcela PF/PJ, taxas) são gravados COMO VÊM do parser
//   (que só lê, nunca recalcula). O parser aplica as 5 guardas; se qualquer uma
//   falhar, abortamos ANTES de escrever — o estoque atual fica intacto.
//
// O CORPO esperado é o JSON BRUTO capturado pelo usuário no portal autenticado
//   (o portal exige sessão da Prospere — fora do alcance do agente). Aceitamos
//   tanto string crua quanto { texto: "<json>" }.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { ehEquipeProspere } from "@/lib/equipe";
import { parsearTabelaAncora, type AncoraLinhaTabela } from "@/lib/ancora-source";

export const dynamic = "force-dynamic";

// Converte o shape camelCase do parser para as colunas snake_case da tabela.
function paraLinhaDb(l: AncoraLinhaTabela) {
  return {
    produto: l.produto,
    bem_codigo: l.bemCodigo,
    bem_nome: l.bemNome,
    valor_do_bem: l.valorDoBem,
    grupo: l.grupo,
    plano: l.plano,
    prazo_grupo: l.prazoGrupo,
    prazo_comercializacao: l.prazoComercializacao,
    taxa_administracao: l.taxaAdministracao,
    fundo_reserva: l.fundoReserva,
    pf_com_seguro: l.pfComSeguro,
    pf_sem_seguro: l.pfSemSeguro,
    pj_com_seguro: l.pjComSeguro,
    pj_sem_seguro: l.pjSemSeguro,
    assembleia: l.assembleia,
    cotas_ativas: l.cotasAtivas,
    cotas_vagas: l.cotasVagas,
    status: l.status,
    importado_em: new Date().toISOString(),
  };
}

export async function POST(req: Request) {
  const supabase = createClient();

  // camada 1: identifica o chamador
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }
  if (!ehEquipeProspere(user.email)) {
    return NextResponse.json({ erro: "Acesso restrito à equipe." }, { status: 403 });
  }

  // corpo: aceita string crua ou { texto }
  const corpo = await req.text();
  let textoBruto: unknown = corpo;
  try {
    const j = JSON.parse(corpo);
    if (j && typeof j === "object" && typeof j.texto === "string") {
      textoBruto = j.texto;
    }
  } catch {
    // corpo já é a string crua do portal — segue como está
  }

  // 5 guardas no parser: se falhar, NÃO escreve nada.
  const leitura = parsearTabelaAncora(textoBruto);
  if (!leitura.ok) {
    return NextResponse.json(
      { erro: "Importação abortada.", motivo: leitura.motivo },
      { status: 422 }
    );
  }

  // camada 2: escrita privilegiada (upsert idempotente pela chave única)
  const admin = createAdminClient();
  const linhas = leitura.linhas.map(paraLinhaDb);
  const { error, count } = await admin
    .from("ancora_tabela")
    .upsert(linhas, {
      onConflict: "produto,bem_codigo,grupo,plano",
      count: "exact",
    });

  if (error) {
    return NextResponse.json(
      { erro: "Não foi possível gravar a tabela." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, recebidas: linhas.length, gravadas: count ?? linhas.length });
}
