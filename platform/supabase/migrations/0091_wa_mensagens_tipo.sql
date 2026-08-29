-- ============================================================================
-- 0091_wa_mensagens_tipo.sql — OUVIDO-01 v2, item (a)
-- A coluna que faltava para a casa saber O QUE o cliente mandou.
-- AUTORIZADO: coordenacao, 29/08/2026.
-- ----------------------------------------------------------------------------
-- O DEFEITO QUE ESTA COLUNA COMECA A CONSERTAR
--
-- app/api/whatsapp/route.ts:361-362 decide o anexo com um ternario de dois
-- ramos: `document` e `image`. Audio, video e sticker caem em `undefined`, a
-- cascata de `??` termina em string vazia, e `media_id` e gravado NULL. Medido
-- em 29/08/2026, sobre 976 mensagens (431 de cliente):
--
--   conteudo vazio SEM media_id ... 5      <- o audio do cliente, perdido inteiro
--   conteudo vazio COM media_id ... 0
--   mensagens com mime_type ...... 24      <- imagem e documento SOBREVIVEM
--
-- Os 5 sao 5 audios. Nenhum deles tem ponteiro de midia: nao e so o texto que
-- se perde, e o proprio endereco do arquivo. Sem essa coluna nao da nem para
-- contar o problema sem reabrir o payload da Meta, que ja nao existe mais.
--
-- ----------------------------------------------------------------------------
-- DUAS DAS TRES COLUNAS PEDIDAS JA EXISTEM — E ISSO ESTA MEDIDO
--
-- A ordem pede `tipo`, `media_id` e `mime`. Medido em information_schema:
--
--   media_id  ... text, nullable  ... JA EXISTE
--   mime_type ... text, nullable  ... JA EXISTE
--   tipo      ...                 ... AUSENTE
--
-- As duas primeiras nao estao faltando: estao VAZIAS no caminho do audio,
-- porque o escritor nunca as preenche ali (o ternario acima). Criar de novo
-- daria duas colunas irmas guardando a mesma coisa e um bug novo no lugar de
-- um consertado. Esta migration cria UMA coluna. O resto e o item (b).
--
-- ----------------------------------------------------------------------------
-- POR QUE text + CHECK, E NAO ENUM — a razao e medida, nao estetica
--
-- `wa_mensagens.papel` e enum (`wa_papel`). E por isso que o SENTINELA-CLAIM-01
-- esta na fila precisando de migration a/b so para acrescentar 'enviando':
-- adicionar valor a enum nao roda na mesma transacao que o usa. Enum e um voto
-- de que o vocabulario acabou.
--
-- Aqui o vocabulario e da META, e a Meta acrescenta tipo de mensagem sem pedir
-- licenca. `text` + CHECK nomeado cabe numa migration so, re-executavel, e o
-- dia em que a lista crescer se resolve trocando uma linha.
--
-- ----------------------------------------------------------------------------
-- O CHECK NAO PODE PODER RECUSAR A META. ESTE E O PONTO DELICADO.
--
-- Um CHECK que rejeite um tipo desconhecido faz o INSERT falhar — e o INSERT
-- que falha aqui e a mensagem do cliente sumindo INTEIRA. Isso e estritamente
-- pior que o defeito que estamos consertando: hoje a mensagem entra vazia,
-- amanha nao entraria. A trava viraria a doenca.
--
-- Por isso o contrato e: **quem normaliza e o ESCRITOR**. O webhook mapeia
-- `m.type` contra esta mesma lista e, se nao reconhecer, grava 'desconhecido'.
-- Assim o CHECK governa o NOSSO vocabulario, e nunca o da Meta — ele so pode
-- pegar erro de digitacao nosso, que e exatamente o que se quer que ele pegue.
-- A lista abaixo e a fonte da verdade; `lib/whatsapp/tipos.ts` a espelha.
--
-- 'desconhecido' esta em portugues de proposito, no meio de valores em ingles:
-- a troca de idioma marca no olho que aquele valor e NOSSO, nao veio da Meta.
-- Os 'unknown'/'unsupported' da propria Meta ficam preservados como eles
-- mesmos — "a Meta disse que nao suporta" e "a Meta disse algo que nunca vimos"
-- sao fatos diferentes e nao podem virar o mesmo registro.
--
-- ----------------------------------------------------------------------------
-- AS 976 LINHAS ANTIGAS FICAM NULL, E ISSO E A REGRA 19
--
-- Nao ha backfill. Daria para adivinhar ("tem media_id, logo era imagem"), e
-- adivinhar aqui e inventar: uma linha antiga com mime de imagem PODE ter sido
-- um sticker. NULL diz "gravada antes de 0091, nao sabemos" — que e verdade.
-- Preencher diria "sabemos, era X" — que e mentira, e mentira que nenhuma
-- consulta futura conseguiria desfazer.
--
-- O CHECK aceita NULL de graca: no Postgres, `tipo in (...)` com tipo NULL da
-- UNKNOWN, e CHECK so reprova em FALSE. Isso e sutil e carrega peso — as
-- linhas de agente (papel='prosperito'), as de sistema e as de descarte nao
-- vem da Meta e nao tem tipo nenhum a declarar. Elas continuam entrando.
--
-- Por isso tambem a coluna NAO e NOT NULL: exigir valor obrigaria a inventar
-- os 976 antigos e quebraria todo INSERT que hoje nao passa `tipo`
-- (registrarDescarte em processar-background.ts, entre outros).
-- ============================================================================

-- Regra 3: re-executavel. `if not exists` na coluna, `drop`+`add` no CHECK.
alter table public.wa_mensagens
  add column if not exists tipo text;

-- O CHECK e recriado sempre, de proposito: e assim que a lista cresce no dia em
-- que a Meta inventar um tipo novo — troca-se a lista aqui e roda-se de novo,
-- sem migration a/b e sem tocar em dado nenhum.
alter table public.wa_mensagens
  drop constraint if exists wa_mensagens_tipo_check;

alter table public.wa_mensagens
  add constraint wa_mensagens_tipo_check check (
    tipo in (
      -- vocabulario da Meta, literal (WhatsApp Cloud API)
      'text',
      'image',
      'audio',
      'video',
      'document',
      'sticker',
      'location',
      'contacts',
      'interactive',
      'button',
      'reaction',
      'order',
      'system',
      'unknown',
      'unsupported',
      -- nosso, e so nosso: a Meta mandou algo fora da lista acima
      'desconhecido'
    )
  );

comment on column public.wa_mensagens.tipo is
  'Tipo da mensagem como a Meta declarou (m.type), normalizado pelo webhook contra wa_mensagens_tipo_check. NULL = gravada antes da 0091, ou nao veio da Meta (agente/sistema). Nunca inventar: NULL e "nao sabemos".';

-- ----------------------------------------------------------------------------
-- Grants: NADA a fazer, e o silencio aqui e deliberado.
-- Coluna nova herda os grants da tabela; nao ha funcao nova, entao a Regra 1
-- (revoke/grant) nao tem alvo nesta migration. A RLS de wa_mensagens continua
-- exatamente como estava — esta migration nao afrouxa nem endurece acesso.
-- ----------------------------------------------------------------------------
