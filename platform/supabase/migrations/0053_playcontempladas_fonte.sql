-- ============================================================================
-- 0053_playcontempladas_fonte — projeto xtv (xtvjpnyadcdeadhmzyff).
-- PLAYCONTEMPLADAS-01: adiciona a fonte PLAYCONTEMPLADAS (playcontempladas.
-- com.br, parceria confirmada) à rotação de sync automático — ver
-- docs/PLANO_MESTRE.md §4 e lib/playcontempladas-source.ts.
--
-- Diferente das fontes existentes (LANCE/CBC/PIFFER/CARTAS/SERVOPA), esta
-- é lida direto do HTML do parceiro (sem envelope JSON do prospere-360) e
-- agrega VÁRIAS administradoras num único feed — a resolução por linha via
-- resolver_administradora()/aliases[] (já usada pelo importador do /admin)
-- já dava conta disso sem mudança nenhuma; só faltava liberar a origem nas
-- duas RPCs de sync, que hoje travam numa lista fixa de origens válidas.
-- ============================================================================

-- 1) Libera 'PLAYCONTEMPLADAS' nas duas RPCs de sync (mesma lista nas duas).
--    Corpo idêntico ao existente hoje (conferido via pg_get_functiondef),
--    só a linha do IN-list muda.
create or replace function public.sync_aplicar_cotas(p_origem text, p_cotas jsonb, p_varrer boolean default true)
 returns table(novas integer, atualizadas integer, indisponibilizadas integer)
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_novas int := 0; v_atu int := 0; v_ind int := 0;
  r record; v_id uuid; v_existe record;
  v_admin_id uuid; v_forn_id uuid;
  v_adm_cota uuid;
  v_adm_fallback uuid;
  v_adm_incoming uuid;
  v_diverge boolean;
begin
  if p_origem is null
     or p_origem not in ('LANCE','CBC','PIFFER','CARTAS','SERVOPA','PLAYCONTEMPLADAS') then
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
    v_adm_incoming := coalesce(v_adm_cota, v_adm_fallback);

    select id, tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas,
           status, entrada_parceiro_raw, administradora_id
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
        p_origem, v_adm_incoming, v_forn_id,
        r.entrada_parceiro, r.adm_raw
      ) returning id into v_id;

      v_novas := v_novas + 1;
      insert into eventos_sync (tipo, numero_externo, carta_id, detalhe, push_pendente)
      values ('carta_nova', r.numero, v_id,
              p_origem || ' crédito ' || r.valor_credito::text, true);

    else
      -- GUARDA DE IDENTIDADE: a posição (administradora_origem, numero_externo)
      -- já existia, mas o tipo ou a administradora divergem, ou o crédito mudou
      -- de forma implausível (>50%) — não é mais o mesmo bem. NUNCA sobrescreve;
      -- orfaniza a linha antiga (preserva UUID/histórico) e insere uma nova.
      v_diverge :=
        v_existe.tipo is distinct from r.tipo
        or v_existe.administradora_id is distinct from v_adm_incoming
        or (
          v_existe.valor_credito > 0
          and abs(r.valor_credito - v_existe.valor_credito) / v_existe.valor_credito > 0.5
        );

      if v_diverge then
        update cartas
           set status = 'indisponivel', numero_externo = null, sincronizada_em = now()
         where id = v_existe.id;

        insert into eventos_sync (tipo, numero_externo, carta_id, detalhe)
        values ('carta_indisponivel', r.numero, v_existe.id,
                p_origem || ' posição reocupada por outro bem (identidade divergente)');

        insert into cartas (
          tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas,
          status, numero_externo, fonte, criado_via, sincronizada_em,
          administradora_origem, administradora_id, fornecedor_id,
          entrada_parceiro_raw, administradora_raw
        ) values (
          r.tipo, r.valor_credito, r.valor_entrada, r.valor_parcela, r.qtd_parcelas,
          'disponivel', r.numero, '360prospere', 'sync', now(),
          p_origem, v_adm_incoming, v_forn_id,
          r.entrada_parceiro, r.adm_raw
        ) returning id into v_id;

        v_novas := v_novas + 1;
        insert into eventos_sync (tipo, numero_externo, carta_id, detalhe, push_pendente)
        values ('carta_nova', r.numero, v_id,
                p_origem || ' crédito ' || r.valor_credito::text || ' (posição reciclada)', true);

      elsif v_existe.status = 'indisponivel'
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
          administradora_id  = coalesce(v_adm_incoming, administradora_id),
          fornecedor_id      = coalesce(fornecedor_id, v_forn_id)
        where administradora_origem = p_origem and numero_externo = r.numero;

        v_atu := v_atu + 1;
        insert into eventos_sync (tipo, numero_externo, carta_id, detalhe)
        values ('carta_atualizada', r.numero, v_existe.id, p_origem || ' valores/sync');
      else
        update cartas set
          sincronizada_em = now(),
          administradora_raw = coalesce(r.adm_raw, administradora_raw),
          administradora_id  = coalesce(v_adm_incoming, administradora_id),
          fornecedor_id      = coalesce(fornecedor_id, v_forn_id)
        where administradora_origem = p_origem and numero_externo = r.numero;
      end if;
    end if;
  end loop;

  if p_varrer then
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
  else
    v_ind := 0;
  end if;

  novas := v_novas; atualizadas := v_atu; indisponibilizadas := v_ind;
  return next;
end;
$function$;

create or replace function public.sync_varrer_ausentes(p_origem text, p_numeros jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_ind int := 0;
begin
  if p_origem is null
     or p_origem not in ('LANCE','CBC','PIFFER','CARTAS','SERVOPA','PLAYCONTEMPLADAS') then
    raise exception 'origem_invalida: %', coalesce(p_origem, '<null>')
      using errcode = 'P0001';
  end if;

  -- Trava de segurança: lista vazia NUNCA varre (evitaria apagar a fonte inteira).
  if jsonb_array_length(coalesce(p_numeros, '[]'::jsonb)) = 0 then
    return 0;
  end if;

  create temporary table _presentes_v (numero integer primary key) on commit drop;
  insert into _presentes_v (numero)
    select distinct (x)::int
    from jsonb_array_elements_text(p_numeros) x
    where x is not null;

  with sumidas as (
    update cartas set status = 'indisponivel', sincronizada_em = now()
    where administradora_origem = p_origem
      and fonte = '360prospere'
      and status = 'disponivel'
      and numero_externo is not null
      and numero_externo not in (select numero from _presentes_v)
    returning numero_externo, id
  )
  insert into eventos_sync (tipo, numero_externo, carta_id, detalhe)
  select 'carta_indisponivel', numero_externo, id, p_origem || ' ausente na fonte'
  from sumidas;

  get diagnostics v_ind = row_count;
  return v_ind;
end;
$function$;

-- 2) Registra a fonte (mesmo padrão das outras — sem adm/fornecedor fixo,
--    resolução é por linha via resolver_administradora).
insert into public.sync_fonte_config (fonte, administradora_id, fornecedor_id, ativo)
values ('PLAYCONTEMPLADAS', null, null, true)
on conflict (fonte) do nothing;

-- 3) Aliases pra casar nomes crus do site com administradoras já
--    cadastradas (resolver_administradora já lê aliases[]). "Caixa" funde
--    em "CNP (Caixa)" por decisão confirmada (mesma administradora,
--    denominação informal no site do parceiro).
update public.administradoras set aliases = array_append(aliases, 'BB Consórcios')
  where nome = 'Banco do Brasil' and not ('BB Consórcios' = any(aliases));

update public.administradoras set aliases = array_append(array_append(aliases, 'CNP Consórcio'), 'Caixa')
  where nome = 'CNP (Caixa)'
    and not ('CNP Consórcio' = any(aliases))
    and not ('Caixa' = any(aliases));

update public.administradoras set aliases = array_append(aliases, 'Itaú Motos')
  where nome = 'Itaú' and not ('Itaú Motos' = any(aliases));

update public.administradoras set aliases = array_append(aliases, 'Porto VP')
  where nome = 'Porto Seguro' and not ('Porto VP' = any(aliases));

update public.administradoras set aliases = array_append(aliases, 'Racon Consórcios')
  where nome = 'Racon' and not ('Racon Consórcios' = any(aliases));

update public.administradoras set aliases = array_append(aliases, 'Unicoob (Sicoob)')
  where nome = 'Unicoob' and not ('Unicoob (Sicoob)' = any(aliases));
