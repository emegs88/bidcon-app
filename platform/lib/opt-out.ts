// ============================================================================
// Opt-out e normalização de texto — FONTE ÚNICA da regra, para todo canal
// (WhatsApp, Instagram, e o próximo). Nasceu na INSTA-01; unificado na
// OPTOUT-FONTE-UNICA-01 (15/08/2026), autorizado por Emerson.
// ----------------------------------------------------------------------------
// HISTÓRIA, porque ela ensina — este arquivo teve um GÊMEO.
//
// Até 15/08 as mesmas constantes e a mesma normalizarTexto viviam TAMBÉM
// dentro de app/api/whatsapp/route.ts, copiadas palavra por palavra. O
// motivo escrito na época era que um Route Handler do App Router só aceita
// um conjunto fechado de exports (GET, POST, dynamic, runtime...), logo
// `export const PALAVRAS_OPT_OUT` não compila lá.
//
// O motivo era verdadeiro e a conclusão era errada: ele justifica não
// EXPORTAR de route.ts — nunca justificou DUPLICAR. Route Handler IMPORTA de
// lib/ normalmente, e é o que ele faz agora.
//
// Antes de unificar, os dois foram COMPARADOS mecanicamente (literal, conjunto
// de palavras, regex de normalização, corpo da função e 9 casos
// comportamentais): idênticos nos quatro eixos, 0 divergências. Ou seja, a
// duplicação ainda não tinha derivado — a unificação é preventiva, feita
// enquanto era barata. Se tivessem divergido, o achado seria outro: cliente
// saindo de um canal e continuando no outro.
//
// A REGRA QUE FICA: quem mudar o texto de um botão de template da Meta muda
// AQUI, e a suíte (lib/opt-out.test.ts) quebra se o literal sair do lugar.
// Botão renomeado sem passar por aqui = cliente que toca em "sair" e não sai.
// ============================================================================

/** Texto exato do botão de opt-out usado nos templates da Meta. */
export const TEXTO_BOTAO_OPT_OUT = "não quero receber";

/** Palavras que, ditas pelo cliente, ligam wa_conversas.opt_out. Vale igual
 *  em qualquer canal — "SAIR" no Instagram é o mesmo "SAIR" do WhatsApp. */
export const PALAVRAS_OPT_OUT = new Set([
  TEXTO_BOTAO_OPT_OUT,
  "nao quero receber",
  "sair",
  "parar",
  "pare",
  "stop",
  "descadastrar",
]);

/** Minúsculas, sem espaços e sem pontuação nas pontas — pra "Sair.", "SAIR"
 *  e " sair " contarem todos como opt-out. Aspas curvas incluídas porque
 *  teclado de celular as insere sozinho. */
export function normalizarTexto(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/^[\s"'“”‘’.!?,;:]+|[\s"'“”‘’.!?,;:]+$/g, "");
}

/** Conveniência: o texto livre recebido é um pedido de opt-out? */
export function ehTextoOptOut(texto: string | null | undefined): boolean {
  return !!texto && PALAVRAS_OPT_OUT.has(normalizarTexto(texto));
}

/** Título de botão recebido é o opt-out?
 *
 *  Botão vale por IGUALDADE EXATA com TEXTO_BOTAO_OPT_OUT, e de propósito:
 *  o título do botão é escolhido por NÓS ao cadastrar o template na Meta,
 *  não digitado pelo cliente. Aceitar aqui a lista larga de PALAVRAS_OPT_OUT
 *  não ajudaria ninguém e abriria a porta pra um botão de outro template
 *  ("Parar", "Sair") desligar o canal sem querer.
 *
 *  O PREÇO disso, que é a razão desta função existir separada e testada:
 *  qualquer template novo PRECISA usar este literal como título, senão o
 *  cliente toca na saída e nada acontece. Medido em 06/08/2026 — o template
 *  bidcon_vitrine_cartas_v2 usa o literal certo e o opt_out gravou. */
export function ehBotaoOptOut(titulo: string | null | undefined): boolean {
  return !!titulo && normalizarTexto(titulo) === TEXTO_BOTAO_OPT_OUT;
}

/** A mensagem recebida é um opt-out? Cobre as TRÊS formas como ele chega:
 *
 *   1. quick reply de TEMPLATE de marketing → messages[].button.text
 *   2. quick reply de mensagem interativa   → interactive.button_reply.title
 *   3. texto digitado livremente            → text.body
 *
 *  Recebe strings cruas, e não o envelope da Meta, para que este módulo
 *  continue sem dependência de canal: quem conhece o formato do webhook é o
 *  Route Handler, que faz o de-para e chama aqui. */
export function ehOptOut(entrada: {
  botoes?: readonly (string | null | undefined)[];
  texto?: string | null;
}): boolean {
  if ((entrada.botoes ?? []).some(ehBotaoOptOut)) return true;
  return ehTextoOptOut(entrada.texto);
}
