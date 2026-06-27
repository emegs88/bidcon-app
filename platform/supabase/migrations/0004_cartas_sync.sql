-- ============================================================================
-- Bidcon — plataforma logada · Migration 0004 · Sync de cotas (Fase 2)
-- ----------------------------------------------------------------------------
-- Rascunho para revisão. Conecta a fonte JÁ PROVADA do site
-- (360prospere.vercel.app/cotas.js) à tabela `cartas` via cron horário.
-- Decisões (aprovadas):
--   - Chave única da cota = numero_externo (campo `n` da API). Upsert idempotente.
--   - Cota que SUMIU da API NÃO vira 'vendida' → vira 'indisponivel' (honesto;
--     sumir != vender). 'vendida' fica para confirmação manual depois.
--   - Só o sync (service_role) escreve estas colunas. RLS já vale para leitura.
--   - Mudança de estoque por ausência só ocorre quando a lista veio íntegra
--     (guardas no cron). API fora do ar = não atualiza, nunca apaga.
-- ============================================================================

-- ----- novo estado para "saiu da lista sem confirmação de venda" -------------
alter type status_carta add value if not exists 'indisponivel';

-- ----- colunas de sincronização na tabela cartas (aditivo, nada removido) ----
alter table cartas
  add column if not exists numero_externo  integer,
  add column if not exists fonte           text not null default 'manual',
  add column if not exists valor_parcela   numeric(14,2),
  add column if not exists qtd_parcelas    integer,
  add column if not exists sincronizada_em timestamptz,
  add column if not exists criado_via      text not null default 'manual';

-- numero_externo é a chave de upsert do sync. Único só quando preenchido:
-- cotas manuais do parceiro (numero_externo null) não colidem entre si.
create unique index if not exists uniq_cartas_numero_externo
  on cartas(numero_externo)
  where numero_externo is not null;

create index if not exists idx_cartas_fonte  on cartas(fonte);
create index if not exists idx_cartas_status on cartas(status);

-- ----- log de eventos do sync (auditoria + ponto de gatilho de push) ---------
-- Registra o que cada execução fez. 'carta_nova' é o evento que, no futuro,
-- aciona o push (OneSignal) — hoje só fica registrado (stub, não dispara).
create table if not exists eventos_sync (
  id             uuid primary key default gen_random_uuid(),
  tipo           text not null,            -- 'carta_nova' | 'carta_atualizada' | 'carta_indisponivel' | 'sync_abortado'
  numero_externo integer,                  -- cota envolvida (null em eventos de execução)
  carta_id       uuid references cartas(id) on delete set null,
  detalhe        text,                     -- motivo do abort, ou resumo da mudança (sem dado sensível)
  push_pendente  boolean not null default false,  -- true em 'carta_nova' até o OneSignal entrar
  em             timestamptz not null default now()
);

create index if not exists idx_eventos_sync_tipo on eventos_sync(tipo);
create index if not exists idx_eventos_sync_em   on eventos_sync(em);

-- ----- RLS na tabela de eventos do sync --------------------------------------
-- Só admin lê pelo client; o sync (service_role) bypassa RLS por padrão.
alter table eventos_sync enable row level security;

create policy eventos_sync_admin_all on eventos_sync
  for all using (is_admin()) with check (is_admin());

-- ----- RPC ATÔMICA do sync ---------------------------------------------------
-- Recebe a lista JÁ VALIDADA de cotas (as 5 guardas rodam no servidor ANTES de
-- chamar isto). Faz tudo numa única transação (a função é atômica): upsert das
-- presentes + marca como 'indisponivel' as que sumiram + registra eventos.
-- Roda como service_role (SECURITY DEFINER não é necessário; o sync já bypassa
-- RLS). Idempotente: rodar 2x com a mesma lista não duplica nem regride status.
--
-- Parâmetro `p_cotas` (jsonb array de objetos):
--   [{ "numero":4033, "tipo":"imovel", "valor_credito":1709569,
--      "valor_entrada":820594, "valor_parcela":10186, "qtd_parcelas":193 }, ...]
create or replace function sync_aplicar_cotas(p_cotas jsonb)
returns table (novas int, atualizadas int, indisponibilizadas int)
language plpgsql
as $$
declare
  v_novas int := 0;
  v_atu   int := 0;
  v_ind   int := 0;
  r record;
  v_id uuid;
  v_existe record;
begin
  -- conjunto de números presentes nesta execução (para o "sumiu da lista")
  create temporary table _presentes (numero integer primary key) on commit drop;
  insert into _presentes (numero)
    select (c->>'numero')::int from jsonb_array_elements(p_cotas) c;

  -- 1) UPSERT das cotas presentes
  for r in
    select
      (c->>'numero')::int        as numero,
      (c->>'tipo')::tipo_bem      as tipo,
      (c->>'valor_credito')::numeric as valor_credito,
      (c->>'valor_entrada')::numeric as valor_entrada,
      (c->>'valor_parcela')::numeric as valor_parcela,
      (c->>'qtd_parcelas')::int      as qtd_parcelas
    from jsonb_array_elements(p_cotas) c
  loop
    select id, valor_credito, valor_entrada, valor_parcela, qtd_parcelas, status
      into v_existe
      from cartas where numero_externo = r.numero;

    if not found then
      -- carta NOVA
      insert into cartas (
        tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas,
        status, numero_externo, fonte, criado_via, sincronizada_em
      ) values (
        r.tipo, r.valor_credito, r.valor_entrada, r.valor_parcela, r.qtd_parcelas,
        'disponivel', r.numero, '360prospere', 'sync', now()
      )
      returning id into v_id;

      v_novas := v_novas + 1;
      -- evento de carta nova: push_pendente=true (gatilho futuro do OneSignal)
      insert into eventos_sync (tipo, numero_externo, carta_id, detalhe, push_pendente)
      values ('carta_nova', r.numero, v_id,
              'crédito ' || r.valor_credito::text, true);

    else
      -- já existe: reativa se estava indisponível, e atualiza se mudou algo
      if v_existe.status = 'indisponivel'
         or v_existe.valor_credito is distinct from r.valor_credito
         or v_existe.valor_entrada is distinct from r.valor_entrada
         or v_existe.valor_parcela is distinct from r.valor_parcela
         or v_existe.qtd_parcelas  is distinct from r.qtd_parcelas
      then
        update cartas set
          tipo = r.tipo,
          valor_credito = r.valor_credito,
          valor_entrada = r.valor_entrada,
          valor_parcela = r.valor_parcela,
          qtd_parcelas  = r.qtd_parcelas,
          -- volta a 'disponivel' se tinha sumido e reapareceu (não mexe em
          -- 'reservada'/'vendida' definidas por processo manual)
          status = case when v_existe.status = 'indisponivel'
                        then 'disponivel' else v_existe.status end,
          sincronizada_em = now()
        where numero_externo = r.numero;

        v_atu := v_atu + 1;
        insert into eventos_sync (tipo, numero_externo, carta_id, detalhe)
        values ('carta_atualizada', r.numero, v_existe.id, 'valores/sync');
      else
        -- sem mudança: só toca o carimbo de "visto agora"
        update cartas set sincronizada_em = now()
        where numero_externo = r.numero;
      end if;
    end if;
  end loop;

  -- 2) SUMIRAM da API: cartas do sync, ainda 'disponivel', que não vieram agora
  --    => 'indisponivel' (NUNCA 'vendida'; venda real é confirmação manual)
  with sumidas as (
    update cartas set status = 'indisponivel', sincronizada_em = now()
    where fonte = '360prospere'
      and status = 'disponivel'
      and numero_externo is not null
      and numero_externo not in (select numero from _presentes)
    returning numero_externo, id
  )
  insert into eventos_sync (tipo, numero_externo, carta_id, detalhe)
  select 'carta_indisponivel', numero_externo, id, 'ausente na fonte'
  from sumidas;

  get diagnostics v_ind = row_count;

  novas := v_novas; atualizadas := v_atu; indisponibilizadas := v_ind;
  return next;
end;
$$;
