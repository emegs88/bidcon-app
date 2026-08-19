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

/**
 * A WABA de onde o Sentinela ENVIA — e, desde 19/08/2026, também onde o
 * template vive. As duas coisas precisavam ser a mesma, e agora são.
 *
 * Proveniência do número: provado por comportamento em 05/08/2026 (LEIAME
 * SENTINELA-01 — outbound entregue, único registro Conectado do número, e o
 * phone_number_id conferido na tela da Meta). Não é palpite.
 *
 * POR QUE ESTA CONSTANTE SAIU DA ROTA. Ela morava como literal dentro de
 * `app/api/whatsapp/template-info/route.ts`, e o arnês varre `lib/` e só —
 * o mesmo defeito de fundo que deixou `pt_BR` sem rede e custou 75 envios.
 * Um dedo errado num dígito faria o instrumento de diagnóstico consultar
 * OUTRA conta e responder "o template não existe" com toda a segurança do
 * mundo, mandando quem lê atrás da causa errada.
 *
 * É TAMBÉM A RESPOSTA À CAUSA ③. A hipótese aberta pelo #132001 era
 * "aprovado noutra WABA que não a que envia". Enquanto o número da consulta
 * e o número do envio forem este mesmo literal, a hipótese não pode voltar
 * pela porta dos fundos.
 */
export const WABA_SENTINELA = "1569741627872302";

/**
 * O ID do modelo recriado pelo Emerson em 19/08/2026, status "Em análise".
 *
 * NÃO VAI NO FIO, e é importante entender por quê: a Graph envia template por
 * (name, language), nunca por ID. Este número existe como ÂNCORA — é o que
 * transforma "o template foi recriado" em "o template 2147898602425568 na
 * WABA 1569741627872302 foi recriado", que é uma afirmação que alguém pode
 * conferir daqui a seis meses sem depender da memória de ninguém.
 *
 * E o status importa: "Em análise" NÃO é aprovado. Enquanto a Meta não
 * aprovar, o #132001 continua sendo a resposta esperada, e as linhas seguem
 * voltando para `aguardando_template` — que é reversível, e é o desenho certo.
 */
export const TEMPLATE_ID_SENTINELA = "2147898602425568";

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
