// ============================================================================
// POST /api/admin/farol/pauta/[id] — PAINEL-FAROL-01 item 2 (aprovação de pauta)
// AUTORIZADO: Emerson Gomes dos Santos — OS "PAINEL-FAROL-01", 08/08/2026:
// "botões Aprovar / Reprovar / Editar texto (edição salva na própria linha,
//  re-passa pelo linter antes de gravar — linter no servidor, sempre)".
// ----------------------------------------------------------------------------
// O LINTER RODA AQUI, E SÓ AQUI. O painel também mede o texto enquanto se
// digita, mas aquilo é conforto: quem decide é este arquivo. A razão não é
// desconfiança do front — é que `fetch` na consola do navegador nunca passa por
// componente nenhum. Uma trava de compliance que mora no cliente é uma trava
// que se contorna com F12.
//
// A MESMA RÉGUA DE SEMPRE. `revisarLegenda()` de lib/farol/selecao.ts é a
// função que o post-diário, o reel-render e a fase 2 já usam. Não escrevi
// validação nova: um segundo linter divergiria do primeiro no dia seguinte, e
// aí o texto aprovado na tela seria barrado na hora de publicar — ou, pior, o
// contrário.
//
// ROTEIRO E LEGENDA SÃO MEDIDOS SEPARADAMENTE, e os dois têm de passar. É o que
// o reel-render faz na 2ª medição (`revisarLegenda(roteiro) ?? revisarLegenda(
// legendaPauta)`), e a ordem importa para a MENSAGEM: dizer "o roteiro tem
// 'investimento'" é acionável; dizer "o texto tem" manda o operador procurar.
//
// APROVAR TAMBÉM MEDE. Não só editar. Uma pauta pode ter sido escrita quando a
// env de aprovação estava desligada, ter nascido 'nova' e chegar aqui sem nunca
// ter passado por uma segunda leitura. Aprovar sem medir seria confiar na
// medição das 10h para um texto que vai ao ar depois — e é justamente o que a
// 2ª medição do reel-render existe para não fazer.
//
// TRANSIÇÕES LEGAIS, e por que a lista é fechada. Só sai de um estado de espera
// ('aguardando_aprovacao' ou 'nova'). 'usada' não volta atrás: o reel já foi
// renderizado com aquele texto, e reprovar depois criaria uma linha que diz
// "recusada" sobre um vídeo que está no ar. 'reprovada' (linter) também não é
// re-aprovável por aqui — se o texto precisa mudar, o caminho é EDITAR, que
// re-mede.
//
// O UPDATE É CONDICIONAL (`.in("status", ...)` na própria instrução). Dois
// admins clicando junto: um muda, o outro recebe zero linhas e vê "a pauta já
// saiu deste estado". Sem isso, o segundo clique sobrescreveria a decisão do
// primeiro em silêncio.
//
// PRÉ-REQUISITO DE BANCO, declarado: 'aprovada' e 'reprovada_humano' ainda não
// passam pelo CHECK de `farol_pauta.status`. A migration está escrita e NÃO
// aplicada — ver `painel-farol-01/` na raiz. Até aplicá-la, aprovar devolve o
// 23514 literal do Postgres, que é ruído honesto e não corrupção.
// ============================================================================
import { NextResponse } from "next/server";
import { checarAdminConsoleApi } from "@/lib/admin-console";
import { createXtvClient } from "@/lib/supabase-xtv";
import { revisarLegenda, registrar } from "@/lib/farol/selecao";

export const dynamic = "force-dynamic";

/** De onde uma pauta pode ser decidida. Ver "transições legais" no header. */
const ESTADOS_DECIDIVEIS = ["aguardando_aprovacao", "nova"];

type Acao = "aprovar" | "reprovar" | "editar";

/**
 * Mede roteiro e legenda com a régua canônica. Devolve a mensagem já pronta
 * para a tela, dizendo QUAL campo caiu — ver header.
 */
function medir(roteiro: string, legenda: string): string | null {
  const noRoteiro = revisarLegenda(roteiro);
  if (noRoteiro) return `roteiro reprovado pelo linter: ${noRoteiro}`;
  const naLegenda = revisarLegenda(legenda);
  if (naLegenda) return `legenda reprovada pelo linter: ${naLegenda}`;
  return null;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const acesso = await checarAdminConsoleApi();
  if (!acesso.ok) {
    return NextResponse.json({ erro: acesso.motivo }, { status: acesso.status });
  }

  const id = params.id;
  if (!id) return NextResponse.json({ erro: "id é obrigatório." }, { status: 400 });

  const corpo = (await req.json().catch(() => ({}))) as {
    acao?: string;
    roteiro?: string;
    legenda?: string;
    motivo?: string;
  };

  const acao = corpo.acao as Acao | undefined;
  if (acao !== "aprovar" && acao !== "reprovar" && acao !== "editar") {
    return NextResponse.json({ erro: "ação inválida." }, { status: 400 });
  }

  const db = createXtvClient();

  // Lê o estado ATUAL antes de decidir. É daqui que sai o texto medido quando a
  // ação é "aprovar" (que não manda texto no corpo) e é isto que impede aprovar
  // uma linha que já saiu do estado de espera.
  const { data: atual, error: errLe } = await db
    .from("farol_pauta")
    .select("id,status,roteiro,legenda,formula,dia")
    .eq("id", id)
    .maybeSingle();

  if (errLe) {
    console.error("[painel-farol] farol_pauta ilegível:", errLe.message);
    return NextResponse.json({ erro: "não foi possível ler a pauta." }, { status: 500 });
  }
  if (!atual) return NextResponse.json({ erro: "pauta não encontrada." }, { status: 404 });

  if (!ESTADOS_DECIDIVEIS.includes(atual.status as string)) {
    return NextResponse.json(
      { erro: `pauta em '${atual.status}' não pode ser decidida aqui.` },
      { status: 409 }
    );
  }

  // ---- O que vai ser gravado ------------------------------------------------
  const campos: Record<string, unknown> = {};
  let acaoLog = "";

  if (acao === "reprovar") {
    // Estado PRÓPRIO da recusa humana — não reusa 'reprovada', que significa
    // "o linter barrou" e alimenta a medição de fôrmas (ver a migration).
    campos.status = "reprovada_humano";
    campos.motivo_linter = `humano:${(corpo.motivo ?? "sem motivo declarado").slice(0, 200)}`;
    acaoLog = "pauta_reprovada_humano";
  } else {
    // Aprovar mede o texto QUE ESTÁ NO BANCO; editar mede o que veio no corpo.
    const roteiro = acao === "editar" ? (corpo.roteiro ?? "") : ((atual.roteiro as string) ?? "");
    const legenda = acao === "editar" ? (corpo.legenda ?? "") : ((atual.legenda as string) ?? "");

    if (!roteiro.trim() || !legenda.trim()) {
      return NextResponse.json(
        { erro: "roteiro e legenda são obrigatórios — pauta vazia não vai ao ar." },
        { status: 400 }
      );
    }

    const reprovado = medir(roteiro, legenda);
    if (reprovado) {
      // NÃO grava e NÃO marca a linha. Texto recusado aqui é rascunho do
      // operador, não veredito sobre a pauta do agente: carimbar 'reprovada'
      // por causa de uma tentativa de edição apagaria o texto original bom.
      return NextResponse.json({ erro: reprovado }, { status: 422 });
    }

    campos.status = "aprovada";
    campos.motivo_linter = null;
    if (acao === "editar") {
      campos.roteiro = roteiro;
      campos.legenda = legenda;
    }
    acaoLog = acao === "editar" ? "pauta_editada_aprovada" : "pauta_aprovada";
  }

  // ---- Update CONDICIONAL — a trava de corrida do header --------------------
  const { data: alteradas, error } = await db
    .from("farol_pauta")
    .update(campos)
    .eq("id", id)
    .in("status", ESTADOS_DECIDIVEIS)
    .select("id,status");

  if (error) {
    console.error("[painel-farol] falha gravando decisão da pauta:", error.message);
    // O 23514 do CHECK cai aqui até a migration ser aplicada — e a mensagem
    // literal do Postgres é o diagnóstico, então ela vai junto.
    return NextResponse.json(
      { erro: `não foi possível gravar a decisão: ${error.message}`.slice(0, 300) },
      { status: 500 }
    );
  }

  if ((alteradas ?? []).length === 0) {
    return NextResponse.json(
      { erro: "a pauta saiu do estado de espera enquanto você decidia." },
      { status: 409 }
    );
  }

  await registrar(db, acaoLog, null, null, {
    pauta_id: id,
    dia: atual.dia,
    formula: atual.formula,
    de: atual.status,
    para: campos.status,
    por: acesso.email,
    user_id: acesso.userId ?? null,
    em: new Date().toISOString(),
    ...(acao === "reprovar" ? { motivo: corpo.motivo ?? null } : {}),
  });

  console.log("[painel-farol] pauta decidida:", {
    pauta_id: id,
    acao: acaoLog,
    por: acesso.email,
  });

  return NextResponse.json({ ok: true, status: campos.status });
}
