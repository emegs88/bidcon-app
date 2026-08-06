// ============================================================================
// Opt-out e normalização de texto — regra de negócio compartilhada entre
// canais (WhatsApp, Instagram). FATIA INSTA-01.
// ----------------------------------------------------------------------------
// LEIA ISTO ANTES DE MEXER — este arquivo tem um GÊMEO conhecido.
//
// As mesmas constantes e a mesma normalizarTexto vivem HOJE, palavra por
// palavra, dentro de app/api/whatsapp/route.ts. Não estão importadas de cá
// por dois motivos medidos, não por descuido:
//
//   1. A OS da INSTA-01 exige que o diff de app/api/whatsapp/route.ts seja
//      VAZIO. Trocar as constantes de lá por um import daqui é um diff.
//   2. Mesmo que o item 1 não existisse, route.ts é um Route Handler do App
//      Router: o Next só aceita um conjunto fechado de exports nesse arquivo
//      (GET, POST, dynamic, runtime, maxDuration...). `export const
//      PALAVRAS_OPT_OUT` não compila lá. Ou seja: importar DE route.ts nunca
//      foi uma opção técnica.
//
// Consequência honesta: existem duas cópias da mesma regra. A dívida está
// declarada aqui em vez de escondida. Quem mudar a lista de palavras precisa
// mudar NOS DOIS lugares — e unificar (route.ts passando a importar daqui)
// depende de autorização pra tocar naquele arquivo, o que esta fatia não tem.
//
// Enquanto isso, este módulo é a fonte única de todo canal NOVO: o Instagram
// já nasce lendo daqui, e o próximo canal também. A duplicação não cresce.
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
