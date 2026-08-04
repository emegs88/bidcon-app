// POST /api/admin/conversas/whatsapp/[id]/assumir — CRM-01.
// Pausa o bot: wa_conversas.status='humano'. O webhook
// (platform/app/api/whatsapp/route.ts, `podeResponder`) já respeita esse
// status — nenhuma mudança no motor do WhatsApp foi necessária.
// `atualizado_em` continua sendo setado à mão, mas ele NÃO é mais o que
// ordena a lista: desde o item 2 a última atividade é derivada de
// max(wa_mensagens.criado_em). O campo permanece como fallback pra
// conversa sem mensagem carregada.
// Gate: checarAdminConsoleApi() (mesmo padrão de /api/admin/cartas/*).//
// PAINEL-WA-01 item 4: o handoff passa a virar mensagem na thread.
// Três decisões, cada uma por um motivo:
//   1. o registro vem DEPOIS do update confirmado — nunca narrar um handoff
//      que não aconteceu;
//   2. `.neq` no próprio update dá idempotência: clicar duas vezes não conta
//      o handoff duas vezes. Filtrar e ler o que mudou na MESMA instrução
//      fecha a janela em que dois operadores clicando junto escreveriam dois
//      registros;
//   3. falha ao registrar NÃO derruba a requisição. A pausa é real e está
//      visível no badge; devolver erro faria o operador achar que o bot
//      continua ativo e clicar de novo. A falha vai pro log e pro corpo da
//      resposta, em vez de virar mentira na tela.
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

  // Identidade do atendente (PAINEL-WA-01 / wa-atendente).
  // atendente_id so e preenchido se o perfil EXISTIR em profiles: a coluna tem
  // FK e uma violacao derrubaria o assumir inteiro — o operador perderia a
  // pausa do bot por causa de um campo de registro. Sem perfil, id fica nulo.
  // O nome cai no e-mail autenticado, mesmo fallback de
  // exigirAdminConsolePagina — e dado real da sessao, nao identidade inventada.
  let atendenteId: string | null = null;
  let atendenteNome: string | null = acesso.email ?? null;
  if (acesso.userId) {
    const { data: perfil, error: errPerfil } = await supabase
      .from("profiles")
      .select("id, nome")
      .eq("id", acesso.userId)
      .maybeSingle();
    if (errPerfil) {
      console.error(
        "[admin/conversas/whatsapp/assumir] falha ao ler profiles (segue sem id):",
        errPerfil.message,
      );
    } else if (perfil) {
      atendenteId = (perfil.id as string) ?? null;
      atendenteNome = (perfil.nome as string | null) ?? acesso.email ?? null;
    }
  }

  const agora = new Date().toISOString();
  const { data: alteradas, error } = await supabase
    .from("wa_conversas")
    .update({
      status: "humano",
      atualizado_em: agora,
      atendente_id: atendenteId,
      atendente_nome: atendenteNome,
      assumido_em: agora,
    })
    .eq("id", id)
    .neq("status", "humano")
    .select("id");

  if (error) {
    console.error("[admin/conversas/whatsapp/assumir] falha ao gravar:", error);
    return NextResponse.json({ erro: "não foi possível assumir a conversa." }, { status: 500 });
  }

  if ((alteradas ?? []).length === 0) {
    // Nada mudou: ou a conversa já estava nesse estado, ou o id não existe.
    // Nos dois casos o correto é não escrever nada na thread.
    return NextResponse.json({ ok: true, alterado: false });
  }

  const registro = await registrarMensagemSistema({
    conversaId: id,
    conteudo: "Conversa assumida por um humano — o bot foi pausado aqui.",
    agente: acesso.email,
  });

  return NextResponse.json({
    ok: true,
    alterado: true,
    registradoNaThread: registro.ok,
  });
}
