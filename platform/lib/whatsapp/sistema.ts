// Mensagem de sistema na thread do WhatsApp — PAINEL-WA-01 item 4.
// ----------------------------------------------------------------------------
// O handoff existe desde 20/07 e NUNCA deixou rastro: assumir/devolver mudam
// uma coluna, e coluna não conta história. Medido em 04/08/2026: zero linhas
// com papel 'humano' ou 'sistema' em 93 mensagens. Quem abre a thread depois
// vê o bot parar de falar e uma pessoa começar, sem nada explicando a troca.
//
// Esta função escreve esse acontecimento como mensagem. É ela também que
// PASSA A SER a portadora da hora do handoff, enquanto `assumido_em` não
// existir (a migration wa-atendente depende de autorização nominal) — e
// `respondendo_desde` continua intocado, porque é lock de debounce do bot e
// dois significados no mesmo campo é bug esperando data.
//
// Seguro por construção: cerebro.ts (montarMensagensWa) descarta papel
// 'sistema' ao montar o histórico pro modelo, então narrar o handoff na
// thread não faz o agente acreditar que ele disse isso.
//
// O {error} é conferido explicitamente: supabase-js DEVOLVE erro, não lança.
// Um try/catch aqui não pegaria nada e a ausência do registro seria
// indistinguível de sucesso — que é exatamente o defeito do item 6.
import { createXtvClient } from "@/lib/supabase-xtv";

export async function registrarMensagemSistema(params: {
  conversaId: string;
  conteudo: string;
  /** Quem provocou o evento. Vai na coluna livre `agente` — mesmo lugar onde
   *  a persona do bot é gravada — e é o que a bolha exibe como autoria. */
  agente?: string | null;
}): Promise<{ ok: boolean; erro?: string }> {
  const db = createXtvClient();
  const { error } = await db.from("wa_mensagens").insert({
    conversa_id: params.conversaId,
    papel: "sistema",
    conteudo: params.conteudo,
    agente: params.agente ?? null,
  });
  if (error) {
    console.error("[whatsapp/sistema] falha ao registrar na thread:", error.message);
    return { ok: false, erro: error.message };
  }
  return { ok: true };
}
