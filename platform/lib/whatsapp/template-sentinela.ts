// ============================================================================
// lib/whatsapp/template-sentinela.ts — SENTINELA-TEMPLATE-01
// O PAR (name, language) do template de retomada, num lugar só e sob teste.
// AUTORIZADO: Emerson, 19/08/2026 — "teste que fixa (name, language) contra
// regressão".
// ----------------------------------------------------------------------------
// POR QUE ISTO EXISTE, MEDIDO E NÃO SUPOSTO
//
// A Meta recusou 75 envios com (#132001) "Template name does not exist in the
// translation". Medido em wa_mensagens/sentinela_log em 19/08/2026:
//
//   2026-08-17 12:00   falhas 15   entregues 0
//   2026-08-17 18:00   falhas 15   entregues 0
//   2026-08-18 12:00   falhas 15   entregues 0
//   2026-08-18 18:00   falhas 15   entregues 0
//   2026-08-19 12:00   falhas 15   entregues 0
//
// O nome que saiu no fio foi "sentinela_retomada_01", com len 21 — igual ao
// literal, caractere por caractere. Ou seja: NÃO havia espaço nem caractere
// invisível na env. Sobra o outro lado do par.
//
// E o outro lado estava CRAVADO como literal solto dentro da rota
// (`languageCode: "pt_BR"`), onde `scripts/testes.mjs` não alcança. Literal em
// rota é literal sem rede: trocar `pt_BR` por `pt-BR` — o erro mais comum do
// #132001, porque a Meta escreve o idioma com underscore e o resto do mundo
// escreve com hífen — passaria no tsc, passaria no build, e voltaria a derrubar
// a fila inteira em silêncio. Aqui, quebra o teste.
//
// ----------------------------------------------------------------------------
// O QUE ESTE ARQUIVO NÃO FAZ
//
// Não decide SE envia. O portão continua sendo a env `SENTINELA_TEMPLATE`, e
// ela não é criada por assistente, em nenhuma circunstância. Este arquivo só
// responde: dado o nome que a env carrega, qual par vai no fio, e o nome está
// em condição de ir.
// ============================================================================

/**
 * O idioma do template como a META o conhece. Underscore, BR maiúsculo.
 *
 * Não é `pt-BR` (hífen, padrão BCP-47 que o resto da web usa), não é `pt`, não
 * é `pt_br`. A Graph API compara isto por igualdade exata contra a tradução
 * aprovada, e qualquer das variações devolve #132001 — o mesmo erro que já
 * custou 75 envios e dois dias e meio de silêncio.
 */
export const IDIOMA_SENTINELA = "pt_BR";

/**
 * O nome registrado em docs/TEMPLATE-sentinela_retomada_01.md.
 *
 * NÃO é a fonte da verdade do envio — a env é. Serve para acusar divergência:
 * se a env apontar para outro nome, isso pode ser uma troca legítima (um
 * `_02`) ou pode ser o dedo no lugar errado, e quem lê o log decide. Calar
 * sobre a diferença é que não serve.
 */
export const NOME_SENTINELA_DOCUMENTADO = "sentinela_retomada_01";

/**
 * As grafias que PARECEM certas e derrubam o envio. Existem como constante,
 * e não só dentro do teste, porque são a lista de coisas que já sabemos que
 * quebram — quem for mexer no idioma lê isto antes.
 */
export const IDIOMAS_QUE_FALHAM = ["pt-BR", "pt", "pt_br", "PT_BR", "pt_BR "] as const;

export type ParTemplate = {
  /** Vai em `template.name` no corpo da Graph. */
  name: string;
  /** Vai em `template.language.code`. */
  language: string;
};

export type DiagnosticoTemplate =
  | { ok: true; par: ParTemplate; divergeDoDoc: boolean }
  | { ok: false; motivo: "env_ausente" | "nome_com_espaco" };

/**
 * Monta o par que vai no fio a partir do valor cru da env.
 *
 * RECUSA nome com espaço em volta em vez de aparar. Aparar esconderia uma env
 * mal colada e o sintoma voltaria mais tarde, noutro lugar, sem rastro; e
 * enviar assim é falha garantida — 15 mensagens mortas por ciclo, que foi
 * exatamente o que aconteceu. Recusar cedo faz a linha ficar em
 * `aguardando_template`, que é reversível e visível, e o motivo vai para o log.
 */
export function parDoSentinela(nomeCru: string | undefined | null): DiagnosticoTemplate {
  if (nomeCru === undefined || nomeCru === null || nomeCru === "") {
    return { ok: false, motivo: "env_ausente" };
  }
  if (nomeCru !== nomeCru.trim() || nomeCru.trim() === "") {
    return { ok: false, motivo: "nome_com_espaco" };
  }
  return {
    ok: true,
    par: { name: nomeCru, language: IDIOMA_SENTINELA },
    divergeDoDoc: nomeCru !== NOME_SENTINELA_DOCUMENTADO,
  };
}
