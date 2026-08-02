-- =====================================================================
-- IDENTIDADE-01 / T1 — funções de sync corrigidas (alvo: szs, ensaio)
-- =====================================================================
-- Projeto-alvo: szs (szsqdpwwxtmrtrhaikuh), schema public.
-- Estado ANTERIOR preservado em ident01/A3_funcoes_szs.sql (para diff/rollback).
--
-- O QUE T1 CORRIGE
--   D11 — SEMÂNTICA DE VIVA. Antes: status='disponivel' era sinônimo de viva,
--         o que jogava carta 'reservada' para fora da contagem M, do casamento
--         e da reivindicação. Agora: viva = status in ('disponivel','reservada').
--         A orfanização continua rebaixando SÓ disponivel → indisponivel;
--         'reservada' e 'vendida' jamais mudam de status pelo sync.
--   D4  — FINGERPRINT MATERIALIZADO. Antes: as duas funções recomputavam
--         carta_fingerprint() inline para cada linha ARMAZENADA, o que é
--         proibido por D4 e impedia o uso de idx_cartas_fonte_fp_vivas.
--         Agora: linha armazenada é lida pela coluna cartas.fingerprint
--         (mantida pelo trigger cartas_fingerprint_trg, único calculador).
--         A cota ENTRANTE continua sendo computada inline — ela ainda não é
--         linha; é justamente isso que o trigger vai reproduzir no insert.
--
-- DECISÕES DE T1 QUE VÃO EXPLÍCITAS NO RELATÓRIO (não reabrem D1–D15)
--
--   T1-a — ESCOPO DO DESLOCAMENTO DE NÚMERO (leitura de D7 sob D11).
--     D7 manda liberar o numero detido por outra carta VIVA da fonte. Mas
--     uniq_cartas_origem_numero é (administradora_origem, numero_externo)
--     WHERE numero_externo is not null and administradora_origem is not null
--     — ele IGNORA status. Medição no xtv: 2.165 cartas 'indisponivel' ainda
--     seguram numero (fonte CARTAS: 1.087 mortas com numero contra 228 vivas).
--     Ler D7 ao pé da letra deixaria a carta morta bloquear a viva e estouraria
--     o índice no meio do replay.
--     Decisão: o deslocamento cobre disponivel + reservada + indisponivel.
--     Fundamento textual: D7 encerra dizendo "numero_externo é dado, não
--     identidade" — zerá-lo numa órfã não destrói identidade nenhuma, e não
--     mexe em status, então D11 segue intacto.
--     'vendida' fica FORA: D11 diz que vendida jamais é alterada pelo sync.
--     Se uma vendida segurar o numero, a ENTRANTE fica sem numero (null) e
--     registra evento 'numero_retido' — de novo porque numero é dado, não
--     identidade. Zero risco de violação de índice, zero violação de D11.
--     (Hoje o caso é teórico: o xtv não tem nenhuma linha 'vendida'.)
--
--   T1-b — FALLBACK DE ADMINISTRADORA NA VARREDURA (defeito encontrado em T1).
--     sync_aplicar_cotas resolve a adm com fallback de config
--     (v_adm_fb, só SERVOPA) antes de compor o fingerprint. A CTE 'entrante'
--     da varredura NÃO aplicava esse fallback: para uma cota SERVOPA com
--     administradora crua não resolvível, aplicar_cotas compunha o fp com o
--     nome da adm de config e varrer_ausentes compunha com '' — fingerprints
--     diferentes para a MESMA cota. Efeito: o teste de integridade acusaria
--     divergência espúria em todo ciclo da SERVOPA, disparando
--     'ciclo_integridade_falhou' e suprimindo a orfanização legítima.
--     T1 replica o fallback na varredura. As duas funções passam a compor o
--     fingerprint da cota entrante por caminho idêntico.
--
--   T1-c — EVENTO PARA VIVA AUSENTE QUE NÃO É ORFANIZADA.
--     D8 manda: ausente COM vínculo permanece viva + evento 'ausente_reservada'.
--     Sob D11 existe um segundo jeito de escapar da orfanização: estar
--     'reservada' (a orfanização só rebaixa 'disponivel'). Uma reservada sem
--     vínculo registrado no helper sobreviveria em silêncio. O predicado do
--     evento passa a ser (tem vínculo OU está reservada), de modo que TODA
--     viva ausente que sobrevive deixa rastro. Só amplia observabilidade.
--
--   T1-d — ADENDO-1: a sobrecarga legada vira shim no-op.
--
-- GRANTS — DESVIO DELIBERADO DO TEMPLATE DO CLAUDE.md
--   O rodapé padrão do CLAUDE.md é "revoke from public, anon" + "grant to
--   authenticated". Aqui vale D15 (service-only, padrão SEGURANCA-01/0069):
--   estas funções são SECURITY DEFINER, mutam o catálogo inteiro de uma fonte
--   e têm um único chamador legítimo — o route /api/sync-cotas, que usa
--   service_role. Deixar EXECUTE em 'authenticated' permitiria a qualquer
--   usuário logado disparar reconciliação. Então: revoke de public, anon E
--   authenticated; grant só a service_role. O objetivo central da Regra 1
--   (tirar o anon) é cumprido com folga.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. sync_alocar_numero — helper novo (decisão T1-a)
--    Libera o numero_externo na fonte e devolve o numero utilizável pela
--    carta entrante (ou null, quando uma 'vendida' o retém).
-- ---------------------------------------------------------------------
create or replace function public.sync_alocar_numero(
  p_origem  text,
  p_numero  integer,
  p_excluir uuid default null
) returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_retido boolean;
begin
  if p_numero is null then return null; end if;

  -- D7 ampliado (T1-a): libera o numero de qualquer outra carta da fonte,
  -- EXCETO 'vendida' — D11 proíbe o sync de alterar carta vendida.
  -- A deslocada NÃO é orfanizada: o destino dela é da varredura.
  update cartas
     set numero_externo = null
   where administradora_origem = p_origem
     and numero_externo = p_numero
     and status <> 'vendida'
     and (p_excluir is null or id <> p_excluir);

  -- Sobrou detentora? Só pode ser 'vendida'. A entrante fica sem numero.
  select exists (
    select 1 from cartas
     where administradora_origem = p_origem
       and numero_externo = p_numero
       and (p_excluir is null or id <> p_excluir)
  ) into v_retido;

  if v_retido then
    insert into eventos_sync(tipo, numero_externo, detalhe)
    values ('numero_retido', p_numero,
            p_origem||' numero retido por carta vendida; entrante segue sem numero');
    return null;
  end if;

  return p_numero;
end;
$function$;

revoke all on function public.sync_alocar_numero(text, integer, uuid) from public, anon, authenticated;
grant execute on function public.sync_alocar_numero(text, integer, uuid) to service_role;


-- ---------------------------------------------------------------------
-- 1. sync_aplicar_cotas(p_origem text, p_cotas jsonb, p_varrer boolean)
--    ASSINATURA CONGELADA (D5) — muda o CORPO, nunca a assinatura.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_aplicar_cotas(p_origem text, p_cotas jsonb, p_varrer boolean DEFAULT true)
 RETURNS TABLE(novas integer, atualizadas integer, indisponibilizadas integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_novas int:=0; v_atu int:=0; v_ind int:=0; r record; v_id uuid; v_cand uuid;
  v_admin_id uuid; v_forn_id uuid; v_adm_in uuid; v_adm_fb uuid; v_cat text; v_fp text;
  v_num int; v_t0 timestamptz; v_now timestamptz:=now(); v_arr jsonb;
begin
  -- ISOLAMENTO DE PARTIÇÃO (D12): só lista branca. BIDCON_DIRETO (estoque
  -- exclusivo curado à mão) e Itaú ficam FORA — o sync nunca os toca.
  if p_origem is null or p_origem not in ('LANCE','CBC','PIFFER','CARTAS','SERVOPA','PLAYCONTEMPLADAS') then
    raise exception 'origem_invalida: %', coalesce(p_origem,'<null>') using errcode='P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('sync:'||p_origem));  -- D9
  v_t0 := public.sync_ciclo_t0(p_origem, p_cotas);             -- D6
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
    -- Fingerprint da cota ENTRANTE: computado inline porque ela ainda não é
    -- linha. É exatamente o valor que cartas_fingerprint_trg vai materializar
    -- na coluna quando a linha nascer/for atualizada (D4).
    v_fp := public.carta_fingerprint(r.tipo::text,r.vc,r.ve,r.vp,r.qp,
      public.adm_fingerprint_input((select a.nome from administradoras a where a.id=v_adm_in), r.adm_raw));

    -- Candidata VIVA (D11: disponivel OU reservada) e NÃO reivindicada neste
    -- ciclo (sincronizada_em < ciclo_t0), casada pela COLUNA fingerprint (D4)
    -- — o que permite o índice parcial idx_cartas_fonte_fp_vivas.
    -- Prioridade (D5): vinculadas primeiro, depois as mais antigas.
    select c.id into v_cand from cartas c
     where c.administradora_origem = p_origem
       and c.status in ('disponivel','reservada')
       and c.fingerprint = v_fp
       and coalesce(c.sincronizada_em,'-infinity') < v_t0
     order by public.carta_vinculo_ativo(c.id) desc, c.criado_em asc limit 1;

    if v_cand is not null then
      -- Deslocamento de número (D7 / T1-a) antes de gravar.
      v_num := public.sync_alocar_numero(p_origem, r.numero, v_cand);
      -- ADENDO-4 — REIVINDICAÇÃO NÃO ESCREVE PREÇO.
      -- A candidata foi casada por IGUALDADE DE FINGERPRINT, e o fingerprint
      -- É (tipo, credito, entrada, parcela, parcelas, adm) ao centavo. Logo os
      -- quatro campos comerciais já são idênticos por construção: reescrevê-los
      -- gravaria o mesmo valor e, pior, dispararia trg_bidcon_price
      -- (UPDATE OF valor_credito, valor_entrada, valor_parcela, qtd_parcelas,
      -- tipo) a ~392 ms/linha, recalculando TIR que não mudou.
      -- Mudança REAL de preço muda o fingerprint => a linha antiga não casa,
      -- vira órfã na varredura e nasce linha nova — e aí o trigger dispara no
      -- INSERT, que é o comportamento correto.
      -- administradora_raw/administradora_id PERMANECEM no SET: mantêm
      -- trg_cartas_fingerprint disparando e a coluna fingerprint em dia (D4).
      -- Reivindicação: sincronizada_em := now(). NUNCA mexe em status —
      -- reivindicar uma 'reservada' atualiza numero/metadados e só (D11).
      update cartas set numero_externo=v_num,
        entrada_parceiro_raw=r.ep, administradora_raw=coalesce(r.adm_raw,administradora_raw),
        administradora_id=coalesce(v_adm_in,administradora_id), fornecedor_id=coalesce(fornecedor_id,v_forn_id),
        categoria=v_cat, sincronizada_em=v_now where id=v_cand;
      v_atu:=v_atu+1;
    else
      v_num := public.sync_alocar_numero(p_origem, r.numero, null);
      insert into cartas (tipo,valor_credito,valor_entrada,valor_parcela,qtd_parcelas,status,numero_externo,
        fonte,criado_via,sincronizada_em,administradora_origem,administradora_id,fornecedor_id,
        entrada_parceiro_raw,administradora_raw,categoria)
      values (r.tipo,r.vc,r.ve,r.vp,r.qp,'disponivel',v_num,'360prospere','sync',v_now,p_origem,
        v_adm_in,v_forn_id,r.ep,r.adm_raw,v_cat) returning id into v_id;
      v_novas:=v_novas+1;
      insert into eventos_sync(tipo,numero_externo,carta_id,detalhe,push_pendente)
      values ('carta_nova',v_num,v_id,p_origem||' credito '||r.vc::text,true);
    end if;
    v_cand:=null;
  end loop;
  -- NUNCA orfaniza dentro do lote (D5): operação destrutiva só com
  -- conhecimento do ciclo completo, que é o que a varredura tem.
  if p_varrer then select public.sync_varrer_ausentes(p_origem,p_cotas,v_t0) into v_ind; end if;
  novas:=v_novas; atualizadas:=v_atu; indisponibilizadas:=v_ind; return next;
end; $function$;

revoke all on function public.sync_aplicar_cotas(text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.sync_aplicar_cotas(text, jsonb, boolean) to service_role;


-- ---------------------------------------------------------------------
-- 2. sync_varrer_ausentes(p_origem text, p_cotas jsonb, p_ciclo_inicio timestamptz)
--    Assinatura NOVA (D8) — nunca foi congelada.
--    Ordem interna obrigatória: snapshot → integridade → orfanização →
--    ultima_varredura_em como ÚLTIMO ato.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_varrer_ausentes(p_origem text, p_cotas jsonb, p_ciclo_inicio timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_ind int:=0; v_div int:=0; v_now timestamptz:=now(); v_arr jsonb;
  v_admin_id uuid; v_adm_fb uuid;
begin
  -- ISOLAMENTO DE PARTIÇÃO (D12): BIDCON_DIRETO e Itaú intocáveis.
  if p_origem is null or p_origem not in ('LANCE','CBC','PIFFER','CARTAS','SERVOPA','PLAYCONTEMPLADAS') then
    raise exception 'origem_invalida: %', coalesce(p_origem,'<null>') using errcode='P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('sync:'||p_origem));  -- D9
  v_arr := public.sync_cotas_array(p_cotas);
  if jsonb_array_length(coalesce(v_arr,'[]'::jsonb))=0 then return 0; end if;

  -- Mesmo fallback de administradora usado por sync_aplicar_cotas (T1-b).
  select administradora_id into v_admin_id from sync_fonte_config where fonte=p_origem;
  v_adm_fb := case when p_origem='SERVOPA' then v_admin_id else null end;

  -- (1) snapshot bruto do ciclo
  insert into sync_snapshot_ciclo(fonte,ciclo_inicio,total_cotas,payload)
  values (p_origem,p_ciclo_inicio,jsonb_array_length(v_arr),v_arr);

  -- (2) integridade: contagem por fingerprint do payload vs reivindicadas
  --     desde ciclo_t0. 'entrante' computa inline (cota não é linha);
  --     'vivo' LÊ a coluna materializada (D4) e usa viva = disponivel|reservada (D11).
  with entrante as (
    select public.carta_fingerprint(((c->>'tipo')::tipo_bem)::text,(c->>'valor_credito')::numeric,
      (c->>'valor_entrada')::numeric,(c->>'valor_parcela')::numeric,(c->>'qtd_parcelas')::int,
      public.adm_fingerprint_input((select a.nome from administradoras a
        where a.id = coalesce(public.resolver_administradora(nullif(trim(c->>'administradora'),'')), v_adm_fb)),
        nullif(trim(c->>'administradora'),''))) fp, count(*) n
    from jsonb_array_elements(v_arr) c group by 1),
  vivo as (
    select c.fingerprint fp, count(*) m
    from cartas c where c.administradora_origem=p_origem
      and c.status in ('disponivel','reservada')
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

  -- (3a) viva ausente que SOBREVIVE à orfanização deixa rastro (D8 / T1-c):
  --      ou tem vínculo ativo, ou está 'reservada' (que o sync nunca rebaixa).
  insert into eventos_sync(tipo,numero_externo,carta_id,detalhe)
  select 'ausente_reservada',c.numero_externo,c.id,p_origem||' fp='||c.fingerprint
  from cartas c where c.administradora_origem=p_origem
    and c.status in ('disponivel','reservada')
    and coalesce(c.sincronizada_em,'-infinity') < p_ciclo_inicio
    and (public.carta_vinculo_ativo(c.id) or c.status='reservada');

  -- (3b) orfanização: SÓ rebaixa disponivel → indisponivel (D11).
  --      'reservada' e 'vendida' jamais mudam de status pelo sync.
  with sumidas as (
    update cartas set status='indisponivel', sincronizada_em=v_now
    where administradora_origem=p_origem and fonte='360prospere' and status='disponivel'
      and coalesce(sincronizada_em,'-infinity') < p_ciclo_inicio
      and not public.carta_vinculo_ativo(cartas.id)
    returning numero_externo,id)
  insert into eventos_sync(tipo,numero_externo,carta_id,detalhe)
  select 'carta_indisponivel',numero_externo,id,p_origem||' ausente na fonte' from sumidas;
  get diagnostics v_ind = row_count;

  -- (4) ultima_varredura_em como ÚLTIMO ato.
  insert into sync_fonte_estado(fonte,ultima_varredura_em) values (p_origem,v_now)
    on conflict (fonte) do update set ultima_varredura_em=excluded.ultima_varredura_em;
  return v_ind;
end; $function$;

revoke all on function public.sync_varrer_ausentes(text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.sync_varrer_ausentes(text, jsonb, timestamptz) to service_role;


-- ---------------------------------------------------------------------
-- 3. sync_varrer_ausentes(p_origem text, p_numeros jsonb) — SHIM (ADENDO-1)
--    Era a varredura POSICIONAL (identidade por numero_externo) — exatamente
--    o desenho que esta fatia aposenta. Mantida viva como estava, violaria
--    D11 se chamada. Vira no-op: registra o evento e devolve zero.
--    ZERO escrita em cartas. Drop definitivo só depois do ciclo
--    supervisionado da FASE B confirmar o route no envelope.
--    Não levanta exceção nem para origem inválida: no-op é no-op.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_varrer_ausentes(p_origem text, p_numeros jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  insert into eventos_sync(tipo, detalhe)
  values ('varredura_legada_chamada',
          coalesce(p_origem,'<null>')||' numeros='||
          coalesce(jsonb_array_length(
            case when jsonb_typeof(p_numeros)='array' then p_numeros else '[]'::jsonb end
          ),0)::text||' — no-op (IDENTIDADE-01 ADENDO-1)');
  return 0;
end; $function$;

revoke all on function public.sync_varrer_ausentes(text, jsonb) from public, anon, authenticated;
grant execute on function public.sync_varrer_ausentes(text, jsonb) to service_role;


-- =====================================================================
-- 4. VERIFICAÇÃO PÓS-APLICAÇÃO (lida ao vivo do szs após o apply)
-- =====================================================================
-- Migration aplicada: ident01_t1_funcoes_sync_corrigidas.
--
-- ESTADO DAS FUNÇÕES (pg_proc):
--   sync_alocar_numero(text,integer,uuid)
--     md5(prosrc)=930f17f8fcc3c738bcd0c338901629d1  1018 bytes  secdef=t
--   sync_aplicar_cotas(text,jsonb,boolean)
--     md5(prosrc)=80fa4fddc59d5614cbe019dd43858c6d  4284 bytes  secdef=t
--   sync_varrer_ausentes(text,jsonb,timestamptz)
--     md5(prosrc)=24d96daa94a02949505579b0c93dc050  3970 bytes  secdef=t
--   sync_varrer_ausentes(text,jsonb)  [SHIM ADENDO-1]
--     md5(prosrc)=326559afd4c5369d257338d124e9d34b   346 bytes  secdef=t
--   (md5 do estado PRÉ-T1 preservado em A3_funcoes_szs.sql, para diff.)
--
-- ACL das quatro: "postgres=X/postgres | service_role=X/postgres"
--   → anon e authenticated SEM execute. D15 cumprido.
--   → get_advisors(security) não lista nenhuma das quatro em
--     anon_security_definer_function_executable nem em
--     authenticated_security_definer_function_executable.
--
-- ESTADO INICIAL DO ENSAIO (antes do replay):
--   cartas = 0 linhas; eventos_sync = 0 linhas. Folha em branco — o replay
--   da T4 constrói o estado do zero, o que torna o teste k (bootstrap com
--   estado vazio) o retrato fiel do primeiro ciclo real da FASE B.
--
-- KIT ITEM o — TESTE DE FUMAÇA DO SHIM (rodado aqui; re-rodado formalmente em T4)
--   Chamadas: ('LANCE','[101,102,103]'), ('BIDCON_DIRETO','[1]'), (null,null).
--   Retorno: 0, 0, 0 — inclusive para origem proibida e para null (no-op é no-op).
--   cartas: 0 linhas antes e 0 depois, hash idêntico → ZERO escrita.
--   eventos_sync: 3 eventos 'varredura_legada_chamada', 0 de qualquer outro tipo.
--   Os 3 eventos sintéticos foram removidos em seguida (D14) — eventos_sync
--   voltou a 0 antes do replay.
--   VEREDITO: PASSA.
--
-- ACHADO COLATERAL PARA O RELATÓRIO (não corrigido aqui, de propósito)
--   Helpers PRÉ-EXISTENTES do desenho novo continuam executáveis por
--   'authenticated': sync_ciclo_t0(text,jsonb), sync_cotas_array,
--   carta_vinculo_ativo(uuid), cartas_fingerprint_trg().
--   O mais sensível é sync_ciclo_t0 — é SECURITY DEFINER e no bootstrap
--   INSERE linha em sync_fonte_estado; um usuário logado poderia semear t0.
--   Não apertei agora porque D14 manda o szs seguir o gabarito do xtv:
--   trancar só no ensaio criaria divergência de grants entre os projetos.
--   Vai como item de alinhamento no draft da migration da FASE B (T6), que
--   roda nos dois projetos.
-- =====================================================================
