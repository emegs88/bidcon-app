-- ============================================================================
-- 0070_farol_yt_comentarios — memória das respostas públicas no YouTube
-- AUTORIZADO: Emerson Gomes dos Santos — OS "YT-COMENTA-01", 07/08/2026:
-- "dedupe ESTRUTURAL: tabela farol_yt_comentarios via migração file-first
--  (id, comment_id UNIQUE, video_id, autor, resposta_id, criado_em), escrita
--  ANTES de responder (claim), resposta_id atualizado depois".
-- ----------------------------------------------------------------------------
-- POR QUE ESTA TABELA EXISTE. O YouTube não tem webhook de comentário: a
-- captura é POLLING. O cron acorda de 10 em 10 minutos e pede ao
-- `commentThreads.list` os threads mais recentes do canal — e a lista devolvida
-- às 14h10 contém quase tudo que a lista das 14h00 já continha. Sem memória
-- persistida, o bot responderia o MESMO comentário 144 vezes por dia, em
-- público, no canal da Bidcon.
--
-- POR QUE `comment_id` É UNIQUE E NÃO UM SELECT ANTES DO INSERT. Dois crons
-- podem se cruzar (a Vercel não garante execução única quando um tique demora
-- mais que o intervalo). Um `select ... where comment_id = X` seguido de
-- `insert` tem uma janela entre a leitura e a escrita na qual as duas
-- invocações leem "não existe" e as duas respondem. A UNIQUE fecha essa janela
-- no BANCO: a segunda invocação toma erro 23505 no insert e desiste ANTES de
-- falar com o Google. A idempotência não depende de a aplicação lembrar.
--
-- POR QUE A LINHA NASCE ANTES DA RESPOSTA (claim). A ordem é deliberada:
--
--   1. insert {comment_id, video_id, autor}  ← reivindica o comentário
--   2. comments.insert no Google             ← publica a resposta
--   3. update resposta_id                    ← registra o que saiu
--
-- Se a invocação morrer entre 1 e 2, o comentário fica marcado como reivindicado
-- e NUNCA será respondido — perdemos uma resposta. Se a ordem fosse invertida e
-- a invocação morresse entre a publicação e a gravação, o comentário seria
-- respondido DE NOVO no tique seguinte — resposta duplicada, pública, no canal.
-- Entre perder uma resposta e duplicar uma resposta em público, a casa escolhe
-- perder. `resposta_id is null` deixa esse caso auditável: é a lista dos
-- comentários reivindicados que não geraram resposta.
--
-- POR QUE `criado_em` É O CONTADOR DE COTA. A OS mandou o teto diário de 60
-- respostas ser contado "por count de hoje na própria farol_yt_comentarios —
-- sem tabela de estado nova". É esta coluna que sustenta essa contagem, e é por
-- isso que ela tem índice próprio: a consulta roda em TODO tique.
--
-- SEM FK PARA NADA. `video_id` é o id do vídeo no YouTube (texto do Google, não
-- uuid nosso) e `autor` é o channelId de um terceiro. Nenhum dos dois tem
-- correspondente em tabela nossa, e não deve ter.
--
-- RLS ligada e SEM policy, igual a farol_posts/farol_reels/sentinela_*: só
-- service_role alcança, e service_role passa por cima de RLS. Ligar sem policy
-- é o que garante que nenhuma chave anon leia quem comentou no canal.
-- ============================================================================

create table if not exists farol_yt_comentarios (
  id          uuid primary key default gen_random_uuid(),
  -- id do comentário de topo que estamos respondendo. UNIQUE = a trava de
  -- idempotência inteira desta fatia (ver header).
  comment_id  text not null unique,
  -- vídeo onde o comentário vive. Só para auditoria/leitura humana.
  video_id    text,
  -- channelId de quem comentou. NÃO é o nome de exibição: nome muda, id não.
  autor       text,
  -- id da resposta publicada. NULL = reivindicado e não respondido (ver header).
  resposta_id text,
  criado_em   timestamptz not null default now()
);

-- O contador do teto diário. Roda em todo tique, por isso tem índice.
create index if not exists farol_yt_comentarios_dia_idx
  on farol_yt_comentarios (criado_em desc);

alter table farol_yt_comentarios enable row level security;

comment on table farol_yt_comentarios is
  'Memória de dedupe das respostas públicas do FAROL no YouTube. comment_id UNIQUE e a linha nasce ANTES da resposta (claim): entre perder uma resposta e duplicar em público, a casa perde.';
