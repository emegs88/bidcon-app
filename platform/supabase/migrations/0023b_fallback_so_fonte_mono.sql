-- ============ 0018b_fallback_so_fonte_mono (originalmente referida como 0023b_fallback_so_fonte_mono) ============
-- APLICADA no xtv em 07/07/2026 (versão VIGENTE da sync_aplicar_cotas).
-- Renumerada para 0018b nesta migração (pasta real ia só até 0017_repasse.sql).
-- Bug pego no ensaio: cota desconhecida herdava administradora errada via
-- fallback fonte-level. Correção: fallback SÓ pra fonte mono-administradora
-- (hardcoded: SERVOPA). Higiene da config nas fontes multi.

update public.sync_fonte_config set administradora_id = null, atualizado_em = now()
 where fonte in ('LANCE','CBC','PIFFER','CARTAS','360prospere') and administradora_id is not null;

create or replace function public.sync_aplicar_cotas(p_origem text, p_cotas jsonb)
 returns table(novas integer, atualizadas integer, indisponibilizadas integer)
 language plpgsql security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_novas int := 0; v_atu int := 0; v_ind int := 0;
  r record; v_id uuid; v_existe record;
  v_admin_id uuid; v_forn_id uuid;
  v_adm_cota uuid;
  v_adm_fallback uuid;
begin
  if p_origem is null
     or p_origem not in ('LANCE','CBC','PIFFER','CARTAS','SERVOPA') then
    raise exception 'origem_invalida: %', coalesce(p_origem, '<null>')
      using errcode = 'P0001';
  end if;

  select administradora_id, fornecedor_id into v_admin_id, v_forn_id
    from sync_fonte_config where fonte = p_origem;

  v_adm_fallback := case when p_origem = 'SERVOPA' then v_admin_id else null end;

  create temporary table _presentes (numero integer primary key) on commit drop;
  insert into _presentes (numero)
    select distinct (c->>'numero')::int
    from jsonb_array_elements(p_cotas) c
    where (c->>'numero') is not null;

  for r in
    select
      (c->>'numero')::int               as numero,
      (c->>'tipo')::tipo_bem            as tipo,
      (c->>'valor_credito')::numeric    as valor_credito,
      (c->>'valor_entrada')::numeric    as valor_entrada,
      (c->>'valor_parcela')::numeric    as valor_parcela,
      (c->>'qtd_parcelas')::int         as qtd_parcelas,
      nullif(c->>'entrada_parceiro','')::numeric as entrada_parceiro,
      nullif(trim(c->>'administradora'),'')      as adm_raw
    from jsonb_array_elements(p_cotas) c
  loop
    v_adm_cota := public.resolver_administradora(r.adm_raw);

    select id, valor_credito, valor_entrada, valor_parcela, qtd_parcelas,
           status, entrada_parceiro_raw
      into v_existe from cartas
     where administradora_origem = p_origem and numero_externo = r.numero;

    if not found then
      insert into cartas (
        tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas,
        status, numero_externo, fonte, criado_via, sincronizada_em,
        administradora_origem, administradora_id, fornecedor_id,
        entrada_parceiro_raw, administradora_raw
      ) values (
        r.tipo, r.valor_credito, r.valor_entrada, r.valor_parcela, r.qtd_parcelas,
        'disponivel', r.numero, '360prospere', 'sync', now(),
        p_origem, coalesce(v_adm_cota, v_adm_fallback), v_forn_id,
        r.entrada_parceiro, r.adm_raw
      ) returning id into v_id;

      v_novas := v_novas + 1;
      insert into eventos_sync (tipo, numero_externo, carta_id, detalhe, push_pendente)
      values ('carta_nova', r.numero, v_id,
              p_origem || ' crédito ' || r.valor_credito::text, true);

    else
      if v_existe.status = 'indisponivel'
         or v_existe.valor_credito is distinct from r.valor_credito
         or v_existe.valor_entrada is distinct from r.valor_entrada
         or v_existe.valor_parcela is distinct from r.valor_parcela
         or v_existe.qtd_parcelas  is distinct from r.qtd_parcelas
         or v_existe.entrada_parceiro_raw is distinct from r.entrada_parceiro
      then
        update cartas set
          tipo = r.tipo,
          valor_credito = r.valor_credito,
          valor_entrada = r.valor_entrada,
          valor_parcela = r.valor_parcela,
          qtd_parcelas  = r.qtd_parcelas,
          entrada_parceiro_raw = r.entrada_parceiro,
          status = case when v_existe.status = 'indisponivel'
                        then 'disponivel' else v_existe.status end,
          sincronizada_em = now(),
          administradora_raw = coalesce(r.adm_raw, administradora_raw),
          administradora_id  = coalesce(v_adm_cota, administradora_id, v_adm_fallback),
          fornecedor_id      = coalesce(fornecedor_id, v_forn_id)
        where administradora_origem = p_origem and numero_externo = r.numero;

        v_atu := v_atu + 1;
        insert into eventos_sync (tipo, numero_externo, carta_id, detalhe)
        values ('carta_atualizada', r.numero, v_existe.id, p_origem || ' valores/sync');
      else
        update cartas set
          sincronizada_em = now(),
          administradora_raw = coalesce(r.adm_raw, administradora_raw),
          administradora_id  = coalesce(v_adm_cota, administradora_id, v_adm_fallback),
          fornecedor_id      = coalesce(fornecedor_id, v_forn_id)
        where administradora_origem = p_origem and numero_externo = r.numero;
      end if;
    end if;
  end loop;

  with sumidas as (
    update cartas set status = 'indisponivel', sincronizada_em = now()
    where administradora_origem = p_origem
      and fonte = '360prospere'
      and status = 'disponivel'
      and numero_externo is not null
      and numero_externo not in (select numero from _presentes)
    returning numero_externo, id
  )
  insert into eventos_sync (tipo, numero_externo, carta_id, detalhe)
  select 'carta_indisponivel', numero_externo, id, p_origem || ' ausente na fonte'
  from sumidas;

  get diagnostics v_ind = row_count;
  novas := v_novas; atualizadas := v_atu; indisponibilizadas := v_ind;
  return next;
end;
$function$;
