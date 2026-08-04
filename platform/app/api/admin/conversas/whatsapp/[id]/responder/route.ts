// POST /api/admin/conversas/whatsapp/[id]/responder — PAINEL-WA-01, item 3.
// ----------------------------------------------------------------------------
// Caminho A da fatia: o operador responde DE DENTRO do painel. A mensagem sai
// pela Cloud API no número oficial e o histórico continua num lugar só —
// diferente do Caminho B (atender no WhatsApp pessoal), em que a conversa
// desaparece daqui.
//
// Três recusas explícitas, todas com motivo legível, porque recusa muda é
// pior que recusa:
//   1. status != 'humano' — responder com o agente ativo entrega duas vozes
//      ao cliente; é o defeito do item 1 entrando pela porta da frente.
//   2. opt_out — LGPD; sendText também barra por dentro, aqui é a barreira
//      que consegue EXPLICAR ao operador em vez de falhar em silêncio.
//   3. janela de 24h fechada — a Meta recusa texto livre fora dela. Template
//      está fora do escopo desta fatia (§6), então a resposta honesta é
//      recusar e dizer por quê, nunca fingir envio.
//
// status_envio é o que a Graph API respondeu, nunca 'enviado' otimista:
// sendText grava 'enviado' ou 'falha' e devolve o erro real. Se falhar, a
// mensagem JÁ ficou registrada como falha — o operador vê na thread que
// tentou, o que não aconteceu e pode tentar de novo.
//
// Gate: checarAdminConsoleApi() — mesmo de assumir/devolver.
import { NextResponse } from "next/server";
import { checarAdminConsoleApi } from "@/lib/admin-console";
import { createXtvClient } from "@/lib/supabase-xtv";
import { sendText } from "@/lib/whatsapp/graph";

export const dynamic = "force-dynamic";

/** Teto da Cloud API pra corpo de mensagem de texto. */
const LIMITE_TEXTO = 4096;
const JANELA_MS = 24 * 60 * 60 * 1000;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const acesso = await checarAdminConsoleApi();
  if (!acesso.ok) {
    return NextResponse.json({ erro: acesso.motivo }, { status: acesso.status });
  }

  const id = params.id;
  if (!id) {
    return NextResponse.json({ erro: "id é obrigatório." }, { status: 400 });
  }

  const corpo = (await req.json().catch(() => null)) as { texto?: unknown } | null;
  const texto = typeof corpo?.texto === "string" ? corpo.texto.trim() : "";
  if (!texto) {
    return NextResponse.json({ erro: "escreva alguma coisa antes de enviar." }, { status: 400 });
  }
  if (texto.length > LIMITE_TEXTO) {
    return NextResponse.json(
      { erro: `mensagem com ${texto.length} caracteres; o limite da Cloud API é ${LIMITE_TEXTO}.` },
      { status: 400 }
    );
  }

  const supabase = createXtvClient();
  const { data: conversa } = await supabase
    .from("wa_conversas")
    .select("id, telefone, status, opt_out")
    .eq("id", id)
    .maybeSingle();

  if (!conversa) {
    return NextResponse.json({ erro: "conversa não encontrada." }, { status: 404 });
  }

  if (conversa.status !== "humano") {
    return NextResponse.json(
      {
        erro:
          "assuma a conversa antes de responder — com o agente ativo o cliente receberia duas respostas.",
      },
      { status: 409 }
    );
  }

  if (conversa.opt_out === true) {
    return NextResponse.json(
      { erro: "este lead pediu para não receber mensagens (opt-out). Nada foi enviado." },
      { status: 409 }
    );
  }

  // Janela medida a partir da última mensagem DO CLIENTE: resposta nossa não
  // reabre janela nenhuma.
  const { data: ultimaCliente } = await supabase
    .from("wa_mensagens")
    .select("criado_em")
    .eq("conversa_id", id)
    .eq("papel", "cliente")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  const marco = ultimaCliente?.criado_em
    ? new Date(ultimaCliente.criado_em as string).getTime()
    : null;
  if (marco === null) {
    return NextResponse.json(
      { erro: "esta conversa não tem mensagem do cliente — a janela de 24h nunca abriu." },
      { status: 409 }
    );
  }
  if (Date.now() - marco >= JANELA_MS) {
    return NextResponse.json(
      {
        erro:
          "janela de 24h fechada: a Meta só aceita texto livre até 24h depois da última mensagem do cliente. Envio de template está fora desta fatia.",
      },
      { status: 409 }
    );
  }

  const resultado = await sendText({
    conversaId: id,
    telefone: conversa.telefone as string,
    texto,
    papel: "humano",
    // Até a migration wa-atendente existir, o e-mail de quem enviou é o
    // único registro de autoria — vai na coluna livre `agente`, o mesmo
    // lugar onde a persona do bot já é gravada.
    agente: acesso.email,
  });

  if (!resultado.ok) {
    return NextResponse.json(
      { erro: resultado.erro ?? "falha no envio pela Cloud API.", statusEnvio: "falha" },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    statusEnvio: "enviado",
    waMessageId: resultado.waMessageId ?? null,
  });
}
