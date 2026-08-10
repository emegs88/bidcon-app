// ============================================================================
// POST /api/admin/farol/arte — FAROL-ARTE-01 passo 4 · curadoria do acervo
// AUTORIZADO: Emerson Gomes dos Santos — FAROL-ARTE-01, 09/08/2026:
//   "4. Painel de curadoria com confirmação nominal APROVAR."
// E, na decisão de 09/08 sobre o card montado:
//   "ARTE É DO STORY. O feed fica no card de hoje até prova em contrário."
// ----------------------------------------------------------------------------
// O QUE ESTA ROTA PROTEGE. A migração 0076 diz, no comentário da tabela, que
// `status='aprovada'` é escrito SÓ pelo painel, com confirmação nominal, e que
// nada no código automatiza essa transição. Este arquivo é o único lugar da
// casa que escreve 'aprovada' — e é por isso que ele existe separado da rota de
// geração: quem gera insere 'pendente' e vai embora; quem aprova é uma pessoa,
// com sessão, digitando uma palavra.
//
// POR QUE A CONFIRMAÇÃO NOMINAL É SÓ NA APROVAÇÃO. Aprovar é o movimento
// irreversível na prática: a partir dele a arte entra no sorteio e pode ir a um
// perfil público sem passar por mais ninguém. Rejeitar não publica nada — mas
// EXIGE MOTIVO, e isso não é burocracia: a 0076 registra que o motivo vale
// tanto quanto o prompt para o acervo seguinte, e que "saiu com algo parecido
// com texto no canto" é a rejeição que mais importa gravar, porque é a que
// testa a regra inegociável. Rejeição sem motivo seria a curadoria esquecendo
// de si mesma.
//
// A TRANSIÇÃO É GUARDADA NO UPDATE, NÃO NO IF. O `.eq("status","pendente")`
// viaja junto com o UPDATE, então duas abas abertas na mesma arte não produzem
// duas curadorias: a segunda atualiza ZERO linhas e recebe `nao_pendente`. Um
// `if` lido antes do update teria uma janela entre a leitura e a escrita — e é
// exatamente nessa janela que mora o clique duplo do operador apressado.
//
// A CHECAGEM QUE VALE É ESTA, no servidor. O componente cliente desabilita o
// botão por conforto; `fetch` na consola do navegador não passa por componente
// nenhum.
// ============================================================================
import { NextResponse } from "next/server";
import { checarAdminConsoleApi } from "@/lib/admin-console";
import { createXtvClient } from "@/lib/supabase-xtv";
import { registrar } from "@/lib/farol/selecao";
// A palavra vem de lib/ — nunca daqui. Route handler do Next só admite um
// conjunto fechado de exports, e exportar constante de um deles reprova o
// `next build` com "X is not a valid Route export field" (o `tsc --noEmit`
// passa: só o build pega). Este arquivo chegou a declarar a palavra localmente
// por causa disso; agora ela mora em `lib/farol/confirmacao.ts`, que é também
// de onde o botão a lê — uma linha só para os dois lados.
import { PALAVRA_APROVAR as PALAVRA_CONFIRMACAO } from "@/lib/farol/confirmacao";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Motivo curto demais não é motivo — é um caractere para passar da trava. */
const MOTIVO_MIN = 8;

type Acao = "aprovar" | "rejeitar";

export async function POST(req: Request) {
  const acesso = await checarAdminConsoleApi();
  if (!acesso.ok) {
    return NextResponse.json({ erro: acesso.motivo }, { status: acesso.status });
  }

  const corpo = (await req.json().catch(() => ({}))) as {
    id?: string;
    acao?: string;
    confirmacao?: string;
    motivo?: string;
  };

  const acao = corpo.acao as Acao | undefined;
  if (acao !== "aprovar" && acao !== "rejeitar") {
    return NextResponse.json({ erro: "ação inválida." }, { status: 400 });
  }

  const id = typeof corpo.id === "string" ? corpo.id.trim() : "";
  if (!id) {
    return NextResponse.json({ erro: "id da arte ausente." }, { status: 400 });
  }

  // Comparação EXATA, sem trim tolerante e sem case-insensitive — a mesma
  // doutrina do /disparar. Confirmação que aceita "aprovar " é confirmação que
  // se digita por reflexo.
  if (acao === "aprovar" && corpo.confirmacao !== PALAVRA_CONFIRMACAO) {
    return NextResponse.json(
      { erro: `confirmação nominal ausente — digite ${PALAVRA_CONFIRMACAO}.` },
      { status: 400 }
    );
  }

  const motivo = typeof corpo.motivo === "string" ? corpo.motivo.trim() : "";
  if (acao === "rejeitar" && motivo.length < MOTIVO_MIN) {
    return NextResponse.json(
      { erro: `motivo obrigatório na rejeição (mínimo ${MOTIVO_MIN} caracteres).` },
      { status: 400 }
    );
  }

  const db = createXtvClient();
  const agora = new Date().toISOString();

  // Coluna a coluna, como manda a casa para service-role. `caminho` volta para
  // o diário — é o que identifica o arquivo quando alguém for auditar meses
  // depois, quando o uuid já não disser nada a ninguém.
  const patch =
    acao === "aprovar"
      ? {
          status: "aprovada",
          aprovado_por: acesso.email,
          aprovado_em: agora,
          motivo: motivo || null,
        }
      : {
          status: "rejeitada",
          aprovado_por: acesso.email,
          aprovado_em: agora,
          motivo,
        };

  const { data, error } = await db
    .from("farol_arte")
    .update(patch)
    .eq("id", id)
    .eq("status", "pendente")
    .select("id, caminho, status")
    .maybeSingle();

  if (error) {
    console.error("[curadoria-arte] update falhou:", { id, acao, erro: error.message });
    return NextResponse.json({ ok: false, erro: error.message }, { status: 500 });
  }

  // Zero linhas: ou o id não existe, ou a arte JÁ FOI curada por alguém. Os dois
  // casos são o mesmo aviso para o operador — "esta arte não está mais
  // pendente" — e nenhum deles é erro de servidor.
  if (!data) {
    return NextResponse.json(
      { ok: false, erro: "arte não está pendente (já curada, ou id inexistente)." },
      { status: 409 }
    );
  }

  // Diário. `carta_id`/`post_id` nulos de propósito: este evento é sobre uma
  // ARTE, não sobre uma carta — amarrá-lo a uma carta faria a memória
  // antirrepetição, que lê por carta_id, enxergar uma curadoria como publicação.
  await registrar(db, "curadoria_arte", null, null, {
    arte_id: data.id,
    caminho: data.caminho,
    acao,
    status: data.status,
    por: acesso.email,
    user_id: acesso.userId ?? null,
    em: agora,
    ...(motivo ? { motivo } : {}),
  });

  console.log("[curadoria-arte]", {
    arte_id: data.id,
    acao,
    por: acesso.email,
  });

  return NextResponse.json({ ok: true, id: data.id, status: data.status });
}
