// ============================================================================
// lib/farol/confirmacao.ts — as palavras que o operador digita para agir
// AUTORIZADO: Emerson Gomes dos Santos — coordenação, 09/08/2026:
//   "ANTES DE TUDO, a micro-fatia: mover PALAVRA_CONFIRMACAO para lib/ — é a
//    armadilha que você achou, custa minutos e evita um build quebrado em
//    arquivo intocado."
// ----------------------------------------------------------------------------
// A ARMADILHA QUE ESTE ARQUIVO DESARMA. Um route handler do Next só admite um
// conjunto FECHADO de exports (`GET`, `POST`, `dynamic`, `runtime`,
// `maxDuration`, `revalidate`, …). Qualquer outro reprova o `next build` com
// "X is not a valid Route export field". `tsc --noEmit` NÃO pega isso — só o
// build pega.
//
// Ainda assim, `app/api/admin/farol/disparar/route.ts` exportava
// PALAVRA_CONFIRMACAO havia semanas e o build passava. A explicação não é
// tolerância do Next; é MEDIÇÃO:
//
//   80 rotas em app/api  ·  79 arquivos em .next/types/app/api/**/route.ts
//   a única faltando: disparar/route.ts
//   a única importada por outra rota: disparar/route.ts (via reels/[id]/destravar)
//
// Correlação, não causalidade provada — mas é o único traço que distingue essa
// rota das outras 79. O import cruzado a tira da geração de tipos, e o que não
// gera tipo não é conferido. Ou seja: o export ilegal sobrevivia PORQUE alguém
// o importava. Quem um dia removesse aquele import — a limpeza mais natural do
// mundo — quebraria o build num arquivo que não tocou, com uma mensagem sobre
// um arquivo que não abriu.
//
// Constante de valor não tem por que morar em route handler. Mora aqui, e o
// build volta a poder conferir a rota.
//
// POR QUE NENHUM IMPORT NESTE ARQUIVO. Ele é lido também por Client Components
// (`FarolAcoes.tsx`, `CuradoriaAcoes.tsx`), que antes repetiam a palavra à mão
// com um comentário pedindo "tem de bater com a rota". Pedido em comentário não
// é garantia: o dia em que a rota mudasse a palavra, o botão continuaria
// mandando a antiga e o operador levaria 400 sem entender. Módulo sem
// dependência atravessa a fronteira servidor/cliente sem arrastar nada — então
// os dois lados passam a ler a MESMA linha.
//
// NÃO É SEGREDO, e não pode virar um. A palavra é pública por desenho: ela
// aparece na tela ("digite PUBLICAR"), no corpo do erro e no botão. Ela não
// autentica ninguém — quem autentica é `checarAdminConsoleApi`. Ela existe para
// impedir o clique por reflexo, não o invasor.
// ============================================================================

/**
 * Palavra dos disparos manuais e do destravar (`/disparar`, `/reels/[id]/destravar`).
 * As duas ações mexem no que VAI AO AR, então compartilham a palavra de propósito:
 * quem digita PUBLICAR sabe que algo pode ficar público.
 */
export const PALAVRA_PUBLICAR = "PUBLICAR";

/**
 * Palavra da curadoria de arte (`/farol/arte`). Diferente de PUBLICAR porque a
 * ação é outra e o risco é outro: aprovar não publica agora, mas coloca a arte
 * no sorteio, de onde ela pode sair sozinha num perfil público. Palavra própria
 * para que o reflexo treinado numa tela não sirva na outra.
 */
export const PALAVRA_APROVAR = "APROVAR";
