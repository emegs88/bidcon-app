// POST /api/admin/conversas/whatsapp/[id]/encerrar — PAINEL-WA-01 item 5.
// ----------------------------------------------------------------------------
// Encerrar é ARQUIVAR, não bloquear. A diferença importa e define o desenho:
//
// Antes desta fatia, 'encerrado' existia no enum wa_status e aparecia em UM
// lugar do código inteiro — o ternário do selo na lista (page.tsx). Ninguém
// escrevia, ninguém lia pra decidir nada. Botar um botão que grava esse valor
// sem mais nada criaria uma mentira nova: `podeResponder` no webhook só exclui
// 'humano', então o bot continuaria respondendo enquanto o selo dissesse
// "Encerrada".
//
// Havia dois jeitos de desfazer a mentira:
//   (a) 'encerrado' também silencia o bot. Rejeitado: o cliente que voltasse a
//       escrever receberia silêncio para sempre. Abandono é pior que ruído, e
//       "nunca mais me mande nada" já tem mecanismo próprio — o opt-out.
//   (b) 'encerrado' é arquivo, e mensagem nova do cliente REABRE a conversa.
//       Escolhido: o selo passa a ser verdade nos dois estados, sem custar
//       atendimento a ninguém. A reabertura vive no webhook.
//
// Idempotência e registro na thread: mesmo desenho de assumir/devolver — o
// `.neq` entra no próprio update e o `.select` lê o que mudou na mesma
// instrução, e a falha do registro não derruba a requisição.
//
// Gate: checarAdminConsoleApi().
import { NextResponse } from "next/server";
import { checarAdminConsoleApi } from "@/lib/admin-console";
import { createXtvClient } from "@/lib/supabase-xtv";
import { registrarMensagemSistema } from "@/lib/whatsapp/sistema";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const acesso = await checarAdminConsoleApi();
  if (!acesso.ok) {
    return NextResponse.json({ erro: acesso.motivo }, { status: acesso.status });
  }

  const id = params.id;
  if (!id) {
    return NextResponse.json({ erro: "id é obrigatório." }, { status: 400 });
  }

  const supabase = createXtvClient();
  const { data: alteradas, error } = await supabase
    .from("wa_conversas")
    // `respondendo_desde` zerado pelo mesmo motivo do devolver: encerrar com um
    // lock preso faria a próxima mensagem do cliente esperar o TTL à toa.
    .update({
      status: "encerrado",
      respondendo_desde: null,
      atualizado_em: new Date().toISOString(),
    })
    .eq("id", id)
    .neq("status", "encerrado")
    .select("id");

  if (error) {
    console.error("[admin/conversas/whatsapp/encerrar] falha ao gravar:", error);
    return NextResponse.json({ erro: "não foi possível encerrar a conversa." }, { status: 500 });
  }

  if ((alteradas ?? []).length === 0) {
    return NextResponse.json({ ok: true, alterado: false });
  }

  const registro = await registrarMensagemSistema({
    conversaId: id,
    conteudo:
      "Conversa encerrada no painel. Se o cliente escrever de novo, ela reabre e o bot volta a responder.",
    agente: acesso.email,
  });

  return NextResponse.json({
    ok: true,
    alterado: true,
    registradoNaThread: registro.ok,
  });
}
