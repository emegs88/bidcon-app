-- =====================================================================
-- IDENTIDADE-01 / A3 — funções de sync vigentes no szs (estado PRÉ-T1)
-- v2 — original perdido com sandbox efêmero; recapturado ao vivo
-- =====================================================================
-- Projeto de captura: szs (szsqdpwwxtmrtrhaikuh), schema public.
-- Fonte: pg_get_functiondef() lido AO VIVO — mais autoritativo que dump.
-- Data da recaptura: sessão de execução IDENTIDADE-01, FASE A, antes de T1.
--
-- ESTE ARQUIVO É O RETRATO DO *ANTES*. T1 reescreve (1) e (2); ADENDO-1
-- converte (3) em shim no-op. Guardado para diff e para rollback.
--
-- DEFEITOS CONHECIDOS NESTE ESTADO (o que T1 corrige)
--   D11 (semântica de viva): as três funções usam status='disponivel'
--        como sinônimo de viva. Carta 'reservada' fica fora da contagem M,
--        fora do casamento e fora da reivindicação — errado. Viva deve ser
--        status IN ('disponivel','reservada').
--   D4 (fingerprint materializado): (1) e (2) RECOMPUTAM carta_fingerprint
--        inline a cada linha, em vez de ler a coluna cartas.fingerprint
--        mantida pelo trigger. Proibido por D4 e caro (impede o uso do
--        índice parcial idx_cartas_fonte_fp_vivas).
--   (3) legada: além de D11, sua lista branca não inclui PLAYCONTEMPLADAS
--        e sua identidade é POSICIONAL (numero_externo) — é exatamente o
--        desenho que a fatia está aposentando.
--
-- md5(prosrc) no momento da captura:
--   sync_aplicar_cotas(text,jsonb,boolean)                    ver seção 1
--   sync_varrer_ausentes(text,jsonb,timestamptz)              ver seção 2
--   sync_varrer_ausentes(text,jsonb)  [legada]                ver seção 3
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. sync_aplicar_cotas(p_origem text, p_cotas jsonb, p_varrer boolean)
--    ASSINATURA CONGELADA (D5) — T1 muda o CORPO, nunca a assinatura.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_aplicar_cotas(p_origem text, p_cotas jsonb, p_varrer boolean DEFAULT true)
 RETURNS TABLE(novas integer, atualizadas integer, indisponibilizadas integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_novas int:=0; v_atu int:=0; v_ind int:=0; r record; v_id uuid; v_cand uuid;
  v_admin_id uuid; v_forn_id uuid; v_adm_in uuid; v_adm_fb uuid; v_cat text; v_fp text;
  v_t0 timestamptz; v_now timestamptz:=now(); v_arr jsonb;
begin
  -- ISOLAMENTO DE PARTIÇÃO: só lista branca. BIDCON_DIRETO (estoque exclusivo
  -- curado à mão) e Itaú ficam FORA — o sync nunca os toca.
  if p_origem is null or p_origem not in ('LANCE','CBC','PIFFER','CARTAS','SERVOPA','PLAYCONTEMPLADAS') then
    raise exception 'origem_invalida: %', coalesce(p_origem,'<null>') using errcode='P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('sync:'||p_origem));
  v_t0 := public.sync_ciclo_t0(p_origem, p_cotas);
  v_arr := public.sync_cotas_array(p_cotas);
  select administradora_id, fornecedor_id into v_admin_id, v_forn_id from sync_fonte_config where fonte=p_origem;
  v_adm_fb := case when p_origem='SERVOPA' then v_admin_id else null end;

  for r in select (c->>'numero')::int numero,(c->>'tipo')::tipo_bem tipo,(c->>'valor_credito')::numeric vc,
      (c->>'valor_entrada')::numeric ve,(c->>'valor_parcela')::numeric vp,(c->>'qtd_parcelas')::int qp,
      nullif(c->>'entrada_parceiro','')::numeric ep, nullif(trim(c->>'administradora'),'') adm_raw
    from jsonb_array_elements(v_arr) c
  loop
    v_adm_in := coalesce(public.resolver_administradora(r.adm_raw), v_adm_fb);
    v_cat := case when r.adm_raw ilike '%repasse%' then 'repasse' else 'contemplada' end;
    v_fp := public.carta_fingerprint(r.tipo::text,r.vc,r.ve,r.vp,r.qp,
      public.adm_fingerprint_input((select a.nome from administradoras a where a.id=v_adm_in), r.adm_raw));

    -- candidata NÃO reivindicada neste ciclo (sincronizada_em < ciclo_t0).
    -- Prioridade: vinculadas primeiro, depois as mais antigas.
    select c.id into v_cand from cartas c
     where c.administradora_origem=p_origem and c.status='disponivel'
       and coalesce(c.sincronizada_em,'-infinity') < v_t0
       and public.carta_fingerprint(c.tipo::text,c.valor_credito,c.valor_entrada,c.valor_parcela,c.qtd_parcelas,
             public.adm_fingerprint_input((select a.nome from administradoras a where a.id=c.administradora_id),
               c.administradora_raw)) = v_fp
     order by public.carta_vinculo_ativo(c.id) desc, c.criado_em asc limit 1;

    if v_cand is not null then
      update cartas set numero_externo=null where administradora_origem=p_origem
        and numero_externo=r.numero and id<>v_cand and status='disponivel';
      update cartas set numero_externo=r.numero, valor_credito=r.vc, valor_entrada=r.ve, valor_parcela=r.vp,
        qtd_parcelas=r.qp, entrada_parceiro_raw=r.ep, administradora_raw=coalesce(r.adm_raw,administradora_raw),
        administradora_id=coalesce(v_adm_in,administradora_id), fornecedor_id=coalesce(fornecedor_id,v_forn_id),
        categoria=v_cat, sincronizada_em=v_now where id=v_cand;
      v_atu:=v_atu+1;
    else
      update cartas set numero_externo=null where administradora_origem=p_origem
        and numero_externo=r.numero and status='disponivel';
      insert into cartas (tipo,valor_credito,valor_entrada,valor_parcela,qtd_parcelas,status,numero_externo,
        fonte,criado_via,sincronizada_em,administradora_origem,administradora_id,fornecedor_id,
        entrada_parceiro_raw,administradora_raw,categoria)
      values (r.tipo,r.vc,r.ve,r.vp,r.qp,'disponivel',r.numero,'360prospere','sync',v_now,p_origem,
        v_adm_in,v_forn_id,r.ep,r.adm_raw,v_cat) returning id into v_id;
      v_novas:=v_novas+1;
      insert into eventos_sync(tipo,numero_externo,carta_id,detalhe,push_pendente)
      values ('carta_nova',r.numero,v_id,p_origem||' credito '||r.vc::text,true);
    end if;
    v_cand:=null;
  end loop;
  if p_varrer then select public.sync_varrer_ausentes(p_origem,p_cotas,v_t0) into v_ind; end if;
  novas:=v_novas; atualizadas:=v_atu; indisponibilizadas:=v_ind; return next;
end; $function$
;


-- ---------------------------------------------------------------------
-- 2. sync_varrer_ausentes(p_origem text, p_cotas jsonb, p_ciclo_inicio timestamptz)
--    Assinatura NOVA (D8) — nunca foi congelada.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_varrer_ausentes(p_origem text, p_cotas jsonb, p_ciclo_inicio timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_ind int:=0; v_div int:=0; v_now timestamptz:=now(); v_arr jsonb;
begin
  if p_origem is null or p_origem not in ('LANCE','CBC','PIFFER','CARTAS','SERVOPA','PLAYCONTEMPLADAS') then
    raise exception 'origem_invalida: %', coalesce(p_origem,'<null>') using errcode='P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('sync:'||p_origem));
  v_arr := public.sync_cotas_array(p_cotas);
  if jsonb_array_length(coalesce(v_arr,'[]'::jsonb))=0 then return 0; end if;

  insert into sync_snapshot_ciclo(fonte,ciclo_inicio,total_cotas,payload)
  values (p_origem,p_ciclo_inicio,jsonb_array_length(v_arr),v_arr);

  with entrante as (
    select public.carta_fingerprint((c->>'tipo'),(c->>'valor_credito')::numeric,(c->>'valor_entrada')::numeric,
      (c->>'valor_parcela')::numeric,(c->>'qtd_parcelas')::int,
      public.adm_fingerprint_input((select a.nome from administradoras a
        where a.id=public.resolver_administradora(nullif(trim(c->>'administradora'),''))),
        nullif(trim(c->>'administradora'),''))) fp, count(*) n
    from jsonb_array_elements(v_arr) c group by 1),
  vivo as (
    select public.carta_fingerprint(c.tipo::text,c.valor_credito,c.valor_entrada,c.valor_parcela,c.qtd_parcelas,
      public.adm_fingerprint_input((select a.nome from administradoras a where a.id=c.administradora_id),
        c.administradora_raw)) fp, count(*) m
    from cartas c where c.administradora_origem=p_origem and c.status='disponivel'
      and c.sincronizada_em >= p_ciclo_inicio group by 1)
  select count(*) into v_div from entrante e full join vivo v on v.fp=e.fp
   where coalesce(e.n,0) <> coalesce(v.m,0);

  if v_div>0 then
    insert into eventos_sync(tipo,detalhe) values ('ciclo_integridade_falhou',
      p_origem||' divergencias='||v_div||' ciclo='||p_ciclo_inicio::text);
    -- AUTOCURA: avança o estado mesmo sem orfanizar, para o ciclo seguinte
    -- poder re-reivindicar (evita duplicata quando um lote se perde).
    insert into sync_fonte_estado(fonte,ultima_varredura_em) values (p_origem,v_now)
      on conflict (fonte) do update set ultima_varredura_em=excluded.ultima_varredura_em;
    return 0;
  end if;

  insert into eventos_sync(tipo,numero_externo,carta_id,detalhe)
  select 'ausente_reservada',c.numero_externo,c.id,p_origem||' fp='||
    public.carta_fingerprint(c.tipo::text,c.valor_credito,c.valor_entrada,c.valor_parcela,c.qtd_parcelas,
      public.adm_fingerprint_input((select a.nome from administradoras a where a.id=c.administradora_id),c.administradora_raw))
  from cartas c where c.administradora_origem=p_origem and c.status='disponivel'
    and coalesce(c.sincronizada_em,'-infinity') < p_ciclo_inicio and public.carta_vinculo_ativo(c.id);

  with sumidas as (
    update cartas set status='indisponivel', sincronizada_em=v_now
    where administradora_origem=p_origem and fonte='360prospere' and status='disponivel'
      and coalesce(sincronizada_em,'-infinity') < p_ciclo_inicio
      and not public.carta_vinculo_ativo(cartas.id)
    returning numero_externo,id)
  insert into eventos_sync(tipo,numero_externo,carta_id,detalhe)
  select 'carta_indisponivel',numero_externo,id,p_origem||' ausente na fonte' from sumidas;
  get diagnostics v_ind = row_count;

  insert into sync_fonte_estado(fonte,ultima_varredura_em) values (p_origem,v_now)
    on conflict (fonte) do update set ultima_varredura_em=excluded.ultima_varredura_em;
  return v_ind;
end; $function$
;


-- ---------------------------------------------------------------------
-- 3. sync_varrer_ausentes(p_origem text, p_numeros jsonb) — LEGADA
--    Identidade POSICIONAL (numero_externo). ADENDO-1: vira shim no-op
--    em T1. Drop definitivo só depois do ciclo supervisionado da FASE B.
--    Divergência de inventário reportada na FASE A: a spec não a listava.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_varrer_ausentes(p_origem text, p_numeros jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_ind int := 0;
begin
  if p_origem is null
     or p_origem not in ('LANCE','CBC','PIFFER','CARTAS','SERVOPA') then
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
$function$
;
-- =====================================================================
