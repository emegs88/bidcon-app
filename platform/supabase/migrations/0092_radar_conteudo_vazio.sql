-- ============================================================================
-- 0092_radar_conteudo_vazio.sql — OUVIDO-01 v2, item (e)
-- A medição do vigia 10 do RADAR: mensagem de cliente que entrou SEM CONTEÚDO.
-- AUTORIZADO: coordenação, 28/08/2026.
-- ----------------------------------------------------------------------------
-- O NÚMERO 0092 SAIU DO LEDGER, NÃO DO DIRETÓRIO — e isso não é preciosismo.
--
-- Medido hoje em supabase_migrations.schema_migrations do xtv: a última é 0091.
-- O DIRETÓRIO deste repositório, porém, pula de 0087 para 0089 e de 0089 para
-- 0091: `0088_captacoes` e `0090_revoke_anon_buscar_cartas_semantica` estão
-- APLICADAS em produção e não têm arquivo aqui. Quem derivar o próximo número
-- contando arquivos escreve 0090 — um número já queimado — e o ledger passa a
-- ter duas coisas diferentes com o mesmo nome. (O ledger também registra 0089
-- DUAS vezes, pelo mesmo tipo de descuido.) O ledger é a única fonte que
-- descreve o banco; o diretório descreve apenas o que alguém lembrou de commitar.
--
-- ----------------------------------------------------------------------------
-- A CONDIÇÃO, E POR QUE ELA PRECISA DE VIGIA AGORA
--
-- Até esta fatia, áudio do cliente virava turno VAZIO: a mensagem entrava com
-- `conteudo` em branco, o cérebro não tinha o que ler e o cliente não era
-- respondido. Os itens (b) e (c) fecharam esse buraco por dois lados — a
-- transcrição no caminho, e a rede honesta (`mereceRede`) quando a transcrição
-- falha ou o tipo não é transcrevível. Depois deles, conteúdo vazio de cliente
-- deixou de ser possível POR DESENHO.
--
-- É exatamente por isso que ele merece vigia. "Impossível por desenho" é uma
-- afirmação sobre o código que eu escrevi, não sobre o mundo. Este vigia é o
-- que transforma essa afirmação em algo verificável todo dia: se ele ficar
-- mudo, a rede segura; se ele gritar, alguma coisa furou a rede e nós ficamos
-- sabendo no mesmo dia, em vez de descobrir por um cliente que sumiu.
--
-- ----------------------------------------------------------------------------
-- POR QUE RPC, E NÃO UMA CONSULTA PostgREST NA ROTA
--
-- Medido em 28/08/2026 sobre as 431 mensagens de cliente do xtv:
--
--   total_cliente 431 · nulo 0 · so_espaco 6 · vazio_total 6
--
-- Os seis vazios são TODOS de espaço em branco, e NENHUM é NULL. Ou seja: o
-- caso real desta condição é `btrim(conteudo) = ''`, não `conteudo is null`.
-- O PostgREST expressa `is.null` e `eq.` (string vazia), mas não sabe aplicar
-- `btrim` antes de comparar — então uma consulta na rota veria ZERO nos seis
-- casos que existem de verdade. Um vigia que nasce cego para a única forma
-- observada do defeito é pior do que nenhum: ele produz silêncio com aparência
-- de boa notícia.
--
-- ----------------------------------------------------------------------------
-- A JANELA EXISTE PARA O VIGIA PODER SE CALAR
--
-- As seis linhas vazias são históricas — 21/07, 06/08 (2), 20/08 (2) e 23/08 —
-- e todas anteriores ao conserto. Sem janela, este vigia nasceria aberto sobre
-- uma ferida já costurada e NUNCA fecharia, porque a história não muda. Alerta
-- permanentemente aceso é ruído, e ruído treina a pessoa a fechar o painel sem
-- ler — o mesmo defeito que a correção de 16/08 tirou do vigia de movimento.
--
-- Com janela, a condição se resolve sozinha quando para de acontecer. É o mesmo
-- desenho de `reincidente:*` na quarentena, que a doutrina desta casa já usa.
--
-- ----------------------------------------------------------------------------
-- `por_tipo` É A PERÍCIA QUE OS SEIS CASOS HISTÓRICOS NÃO TÊM
--
-- Medido: os seis vazios têm `tipo`, `media_id` e `mime_type` TODOS nulos — são
-- anteriores à 0091, que criou a coluna `tipo`. Não há como saber o que eram.
-- Por isso eu NÃO afirmo que a rede de (b)+(c) cobre esses seis casos: não
-- tenho o dado para afirmar. `por_tipo` garante que o próximo furo chegue com
-- a perícia junto — o operador vê QUAL tipo passou, não só que passou.
--
-- ----------------------------------------------------------------------------
-- O QUE ESTA FUNÇÃO NÃO FAZ
--
-- Não escreve nada. Não abre alerta. Não sabe o que é severidade. Ela conta, e
-- quem julga é lib/radar/vigias.ts — a fase 2 da varredura continua pura.
-- ============================================================================

-- Regra 3: re-executável. `create or replace` e nenhum estado criado fora daqui.
create or replace function public.radar_conteudo_vazio(p_horas int default 24)
returns table (
  vazias int,
  total int,
  por_tipo jsonb
)
language sql
stable
set search_path = public, pg_temp
as $$
  with janela as (
    select
      m.tipo,
      -- As duas formas do vazio na mesma expressão. `btrim` é o que o PostgREST
      -- não alcança, e é a forma que os seis casos reais têm.
      (m.conteudo is null or btrim(m.conteudo) = '') as vazia
    from wa_mensagens m
    where m.papel = 'cliente'
      and m.criado_em > now() - make_interval(hours => p_horas)
  )
  select
    (select (count(*) filter (where vazia))::int from janela),
    -- `total` viaja ao lado de `vazias` de propósito: 2 vazias em 42 mensagens
    -- e 2 vazias em 2 mensagens são situações diferentes, e a contagem sozinha
    -- não separa as duas. Mesmo princípio de `falhas`/`feitos` no vigia 8.
    (select count(*)::int from janela),
    -- A quebra por tipo, só das VAZIAS. `coalesce` no rótulo porque `tipo` é
    -- nullable (0091 não fez backfill, Regra 19): linha antiga entra como
    -- '(sem tipo)' em vez de sumir do agrupamento, que é o que jsonb_object_agg
    -- faria com uma chave nula.
    coalesce(
      (select jsonb_object_agg(coalesce(tipo, '(sem tipo)'), n)
         from (select tipo, count(*)::int as n
                 from janela where vazia group by tipo) t),
      '{}'::jsonb
    );
$$;

-- ----------------------------------------------------------------------------
-- Regra 1. A função conta mensagens de cliente: quem puder executá-la infere
-- volume e ritmo de atendimento sem passar por RLS nenhuma. Só a varredura, que
-- roda por service_role, tem o que fazer com ela.
-- `revoke` ANTES do `grant`, e também de PUBLIC, porque o Postgres concede
-- execute a PUBLIC por padrão em toda função nova — o `grant` sozinho deixaria
-- a porta aberta e pareceria fechada. (Neste projeto há ainda o `pg_default_acl`
-- do Supabase concedendo execute a anon/authenticated no schema public: o
-- revoke abaixo fecha ESTA função, mas a fábrica continua nascendo aberta, e
-- isso está reportado à coordenação como achado próprio.)
-- ----------------------------------------------------------------------------
revoke all on function public.radar_conteudo_vazio(int) from public, anon, authenticated;
grant execute on function public.radar_conteudo_vazio(int) to service_role;

comment on function public.radar_conteudo_vazio(int) is
  'RADAR vigia 10 (OUVIDO-01 e): mensagens de cliente que entraram sem conteudo nas ultimas p_horas. So conta; quem julga e lib/radar/vigias.ts.';
