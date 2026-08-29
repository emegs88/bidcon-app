-- ============================================================================
-- 0089_radar_handoff_mudo.sql — HANDOFF-01, item (c)
-- A medição do vigia 9 do RADAR: conversas cujo bastão passou e ninguém pegou.
-- AUTORIZADO: coordenação, 21/08/2026.
-- ----------------------------------------------------------------------------
-- POR QUE UMA RPC, E NÃO UMA CONSULTA NA ROTA
--
-- A condição precisa de subconsulta correlacionada por conversa ("o agente que
-- está ativo AGORA já falou alguma vez nesta thread?"). O PostgREST não expressa
-- isso. As alternativas eram: puxar wa_conversas e wa_mensagens inteiras para o
-- Node e cruzar na memória — que cresce com o histórico e um dia estoura o
-- tempo da varredura — ou deixar o banco fazer o que banco faz. Mesma escolha
-- que já vale para radar_registrar e radar_resolver.
--
-- ----------------------------------------------------------------------------
-- A LISTA DE AGENTES NÃO É ESCRITA À MÃO, E ISSO IMPORTA
--
-- Nem toda linha com papel='prosperito' é um agente conversando. Medido em
-- 21/08/2026, os remetentes de wa_mensagens são:
--
--   sentinela 104 · valentina 71 · prosperito 71 · caetano 68
--   sistema_extrato 23 · (nulo) 21 · vendanova 19 · tobias 17
--   serena 11 · aurora 3 · farol-comenta 2
--
-- `sentinela`, `sistema_extrato` e `farol-comenta` são DISPARADORES, não
-- agentes. Uma conversa que só recebeu disparo do Sentinela nunca teve handoff
-- nenhum. Contá-la como muda inflava a medição de 16 para 40 — foi exatamente o
-- erro da minha primeira consulta.
--
-- A tentação seguinte era fixar os oito nomes aqui dentro. Não fixa, e o motivo
-- é o modo de falhar: agente novo criado e esquecido nesta lista sairia da
-- vigilância EM SILÊNCIO — o vigia mais perigoso é o que parou de olhar sem
-- avisar. A definição sai da própria coluna `wa_conversas.agente_ativo`, que é
-- o alvo do handoff e por construção só contém agente de conversa. Medido:
--   prosperito 34 · valentina 24 · caetano 11 · tobias 5
--   serena 4 · vendanova 2 · aurora 1 · bento 1   (nenhum nulo, nenhum sistema)
-- Agente novo entra na vigilância no instante em que recebe o primeiro bastão.
--
-- ----------------------------------------------------------------------------
-- O QUE ESTA FUNÇÃO NÃO FAZ
--
-- Não escreve nada. Não abre alerta. Não sabe o que é severidade. Ela conta, e
-- quem julga é lib/radar/vigias.ts — a fase 2 da varredura continua pura.
-- ============================================================================

-- Regra 3: re-executável. `create or replace` e nenhum estado criado fora daqui.
create or replace function public.radar_handoff_mudo(p_minutos int default 30)
returns table (
  mudas int,
  mais_antiga_horas numeric,
  por_agente jsonb
)
language sql
stable
set search_path = public, pg_temp
as $$
  with agentes as (
    -- A definição de "agente de conversa", derivada, nunca digitada. Ver acima.
    select distinct agente_ativo as id
    from wa_conversas
    where agente_ativo is not null
  ),
  por_conversa as (
    select
      c.id,
      c.agente_ativo,
      max(m.criado_em) as ultima_msg,
      -- Alguém DE CONVERSA já falou nesta thread? Sem isso, thread que só levou
      -- disparo do Sentinela entraria na conta.
      count(*) filter (
        where m.papel = 'prosperito'
          and m.agente in (select id from agentes)
      ) as falas_de_agente,
      -- E o que está ativo AGORA, falou? Zero aqui é a assinatura do handoff
      -- mudo: o bastão passou e o novo nunca abriu a boca.
      count(*) filter (
        where m.papel = 'prosperito'
          and m.agente = c.agente_ativo
      ) as falas_do_ativo
    from wa_conversas c
    -- INNER de propósito: conversa sem mensagem nenhuma não pode ser handoff
    -- mudo, porque handoff nenhum aconteceu. Ela é outro problema, de outro
    -- vigia.
    join wa_mensagens m on m.conversa_id = c.id
    where c.status = 'ativo'          -- 'humano' já está na mão de alguém
      and c.opt_out is not true       -- quem pediu para sair não está esperando
      and c.agente_ativo is not null
    group by c.id, c.agente_ativo
  ),
  mudas_cte as (
    select *
    from por_conversa
    where falas_de_agente > 0
      and falas_do_ativo = 0
      -- p_minutos é o mesmo MINUTOS_HANDOFF_MUDO de lib/radar/vigias.ts. Se os
      -- dois divergirem, o alerta mente sobre a própria régua: o título diz uma
      -- janela e a contagem usa outra.
      and ultima_msg < now() - make_interval(mins => p_minutos)
  )
  select
    (select count(*)::int from mudas_cte),
    -- null quando não há nenhuma. Quem chama distingue "zero mudas" de "não sei
    -- a idade" — Regra 19 do lado do SQL.
    (select max(extract(epoch from (now() - ultima_msg)) / 3600.0)::numeric
       from mudas_cte),
    coalesce(
      (select jsonb_object_agg(agente_ativo, n)
         from (select agente_ativo, count(*)::int as n
                 from mudas_cte group by agente_ativo) t),
      '{}'::jsonb
    );
$$;

-- ----------------------------------------------------------------------------
-- Regra 1. A função lê thread de cliente inteira: quem puder executá-la
-- consegue inferir volume e ritmo de atendimento sem passar por RLS nenhuma.
-- Só a varredura, que roda por service_role, tem o que fazer com ela.
-- `revoke` antes do `grant`, e `revoke` também de PUBLIC, porque o Postgres
-- concede execute a PUBLIC por padrão em toda função nova — o `grant` sozinho
-- deixaria a porta aberta e pareceria fechada.
-- ----------------------------------------------------------------------------
revoke all on function public.radar_handoff_mudo(int) from public, anon, authenticated;
grant execute on function public.radar_handoff_mudo(int) to service_role;

comment on function public.radar_handoff_mudo(int) is
  'RADAR vigia 9 (HANDOFF-01 c): conversas ativas cujo agente_ativo nunca falou, paradas ha mais de p_minutos. So conta; quem julga e lib/radar/vigias.ts.';
