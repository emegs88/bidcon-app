-- ============================================================================
-- 0069_farol_reels — fila de renders do reel diário (FAROL-REEL-01)
-- AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-REEL-01", 06/08/2026.
-- ----------------------------------------------------------------------------
-- POR QUE TABELA IRMÃ E NÃO `farol_posts`. A OS deixa a escolha aberta
-- ("em farol_posts ou irmã farol_reels ... decisão sua declarada"). Escolhi a
-- irmã, por uma razão estrutural e não estética:
--
--   `farol_posts` é um LOG — append-only, uma linha por tentativa, `acao` texto
--   livre, nada é atualizado depois de escrito. É lido com "aconteceu?".
--
--   O reel é uma MÁQUINA DE ESTADO que atravessa duas invocações separadas por
--   30 minutos: render disparado (14:30) → vídeo pronto no HeyGen → container
--   criado na Meta → publicado (15:00, ou no ciclo seguinte). A fase 2 precisa
--   PERGUNTAR "o que ficou pendente?" e ATUALIZAR a mesma linha várias vezes.
--
-- Enfiar estado mutável num log append-only obrigaria a fase 2 a reconstruir o
-- estado lendo N linhas e deduzindo qual é a mais recente por carta — que é
-- exatamente o tipo de leitura que produz publicação duplicada quando duas
-- invocações se cruzam. Aqui a idempotência é do BANCO: `video_id` é UNIQUE, e
-- `container_id` é gravado antes do publish. Ver abaixo.
--
-- `farol_posts` continua sendo o diário: o reel publicado também é registrado
-- lá com acao='reel_publicado', para que "o que o FAROL fez ontem?" continue
-- sendo UMA consulta só. Esta tabela é a fila; aquela é a memória.
--
-- ----------------------------------------------------------------------------
-- ESTADOS de `status` (texto, não enum — mesma razão do `acao` em 0068: a fatia
-- de pauta/IA vai acrescentar verbos, e enum obriga migração por verbo):
--
--   'renderizando'  render disparado no HeyGen; temos video_id, não temos mp4.
--   'pronto'        HeyGen devolveu completed + video_url (guardado por rastro;
--                   a URL é presignada e expira — nunca é reusada depois).
--   'publicando'    container REELS criado na Meta; container_id gravado.
--                   ESTE É O ESTADO QUE IMPEDE DUPLICATA: se a invocação morrer
--                   entre criar o container e o media_publish, a próxima RETOMA
--                   o container existente em vez de criar um segundo.
--   'publicado'     media_publish aceito; post_id gravado. Estado final.
--   'falhou'        HeyGen failed, container ERROR/EXPIRED, ou publish recusado
--                   duas vezes. Estado final; `erro` carrega o literal.
--
-- ----------------------------------------------------------------------------
-- `video_id` UNIQUE é a trava de idempotência mais forte que existe aqui: dois
-- crons sobrepostos não conseguem abrir duas linhas para o mesmo render, porque
-- o banco recusa a segunda. Não depende de a aplicação lembrar de checar.
--
-- SEM FK PARA `cartas`: mesma razão de 0068 — a fila precisa sobreviver à carta
-- vendida, senão o histórico some junto com o estoque.
--
-- RLS ligada e SEM policy, igual a farol_posts/sentinela_*: só service_role
-- alcança, e service_role passa por cima de RLS. Ligar sem policy é o que
-- garante que nenhuma chave anon leia a fila.
-- ============================================================================

create table if not exists farol_reels (
  id           uuid primary key default gen_random_uuid(),
  carta_id     uuid,
  -- id do render no HeyGen. UNIQUE = trava de idempotência (ver header).
  video_id     text not null unique,
  -- id do container de mídia na Meta. Gravado ANTES do media_publish.
  container_id text,
  -- id do post publicado no Instagram. Só existe no estado final 'publicado'.
  post_id      text,
  status       text not null default 'renderizando',
  roteiro      text,
  legenda      text,
  erro         text,
  detalhe      jsonb,
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- (1) A consulta da fase 2: "o que está pendente nas últimas 24h?".
--     Parcial de propósito — 'publicado' e 'falhou' são finais e nunca são
--     varridos de novo, então não precisam ocupar o índice.
create index if not exists farol_reels_pendentes_idx
  on farol_reels (criado_em desc)
  where status in ('renderizando', 'pronto', 'publicando');

-- (2) "já fiz reel desta carta recentemente?" — a memória antirrepetição.
create index if not exists farol_reels_carta_idx
  on farol_reels (carta_id, criado_em desc)
  where carta_id is not null;

alter table farol_reels enable row level security;

comment on table farol_reels is
  'Fila de renders do reel diário (HeyGen -> Instagram REELS). Máquina de estado em duas fases; farol_posts continua sendo o diário append-only do FAROL.';
