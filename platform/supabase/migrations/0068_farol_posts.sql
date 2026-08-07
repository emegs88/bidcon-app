-- ============================================================================
-- 0068_farol_posts — memória do FAROL (FAROL-POST · post diário autônomo)
-- AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-POST", 06/08/2026 ~22h15.
-- ----------------------------------------------------------------------------
-- DESVIO DECLARADO DA OS (item 4). A OS manda: "MEDIR se `farol_log` já existe
-- no xtv; existe → usar; não existe → migração file-first mínima". Medi em
-- 06/08/2026. Ela existe — e é OUTRA coisa. Colunas reais:
--
--   id, criado_em, plataforma (NOT NULL), tipo_evento (default 'alteracao'),
--   objeto, objeto_id, campo, valor_antes, valor_depois, faixa,
--   metrica, metrica_valor, degrau_vigente, observacao
--
-- Isso é o RADAR DE PREÇO do Sentinela (quem mudou de quanto pra quanto em que
-- plataforma). Nenhuma das quatro colunas que a própria OS especifica —
-- `acao`, `carta_id`, `post_id`, `detalhe jsonb` — existe ali. Pior: `plataforma`
-- é NOT NULL e não tem significado nenhum pra um post nosso; gravar post nela
-- exigiria inventar um valor e passaria a poluir as consultas do radar.
--
-- Medições que fecham o caso:
--   - 0 linhas na tabela;
--   - 0 referências no código (`grep -rn farol_log app lib supabase` devolve
--     só 2 menções EM PROSA, dentro de 0066_sentinela_fundacao.sql);
--   - NENHUM arquivo de migração a cria (`ls supabase/migrations | grep -i
--     farol` → vazio). Ou seja: ela nasceu fora do file-first, é um resíduo
--     do desenho de julho que o código nunca chegou a usar.
--
-- Conclusão: a regra "existe → usar" foi escrita supondo que a tabela existente
-- casasse com o formato pedido. Não casa. Cumpro o PROPÓSITO da OS ("memória do
-- FAROL, registrar todo post publicado") com uma tabela nova e o nome honesto,
-- e deixo `farol_log` intocada. Nada é dropado nesta migração.
--
-- ----------------------------------------------------------------------------
-- PARA QUE ESTA TABELA É LIDA, na prática (define os índices abaixo):
--   1. "quais cartas já foram postadas nos últimos 14 dias?" — a regra de
--      seleção do post do dia. Consulta: carta_id IN (...) WHERE criado_em >
--      now()-14d. Daí o índice por (criado_em desc) e o de carta_id.
--   2. "o que o FAROL fez ontem?" — auditoria por data.
--
-- `acao` é texto livre de propósito (não é enum): o FAROL vai ganhar reel e
-- pauta depois, e cada fatia nova acrescenta um verbo. Enum obrigaria migração
-- pra cada verbo novo — custo sem benefício num log interno.
-- Valores em uso nesta fatia: 'post_publicado', 'post_falhou', 'sem_carta'.
--
-- `detalhe` guarda o contexto do dia (tipo escolhido, custo, se furou fila por
-- ser exclusiva, erro literal da Graph). jsonb porque o formato vai mudar a
-- cada fatia e não vale uma coluna por campo num log.
--
-- SEM FK PARA `cartas`: o log precisa sobreviver à carta. Uma carta vendida
-- pode sumir do estoque; se houvesse FK com cascade o histórico do post
-- desapareceria junto, e é justamente o histórico que impede repetir a carta.
--
-- RLS: ligada, sem policy — igual a sentinela_fila/sentinela_log (0066). Só
-- service_role escreve e lê, e service_role passa por cima de RLS. Ligar sem
-- policy é o que garante que nenhuma chave anon alcance a tabela.
-- ============================================================================

create table if not exists farol_posts (
  id        uuid primary key default gen_random_uuid(),
  acao      text not null,
  carta_id  uuid,
  post_id   text,
  detalhe   jsonb,
  criado_em timestamptz not null default now()
);

-- (1) "já postei esta carta recentemente?" e a auditoria por data.
create index if not exists farol_posts_criado_em_idx
  on farol_posts (criado_em desc);

-- (2) histórico de uma carta específica.
create index if not exists farol_posts_carta_idx
  on farol_posts (carta_id, criado_em desc)
  where carta_id is not null;

alter table farol_posts enable row level security;

comment on table farol_posts is
  'Memória do FAROL: um registro por tentativa de publicação autônoma. Não confundir com farol_log (radar de preço do Sentinela).';
