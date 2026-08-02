-- ============================================================================
-- 0063_identidade_estavel_fingerprint — projeto xtv (xtvjpnyadcdeadhmzyff).
--
-- *** DRAFT DA FASE B. NÃO APLICAR. ***
-- Este arquivo é o entregável T6 da fatia IDENTIDADE-01 (FASE A). Só vira
-- migration de verdade depois da frase "AUTORIZO IDENTIDADE-01 FASE B"
-- digitada pelo Emerson. Enquanto isso ele vive em ident01/, fora de
-- supabase/migrations/, exatamente para não ser aplicado por engano.
--
-- ----------------------------------------------------------------------------
-- O QUE ESTA MIGRATION RESOLVE
--
-- O sync casa cota entrante com carta existente por `numero_externo`. Mas
-- numero_externo é POSIÇÃO no feed do parceiro, não identidade: quando o
-- parceiro reordena a lista, a mesma carta muda de número e o sync a mata e
-- a recria. IDENTIDADE-01/D1: a identidade é o FINGERPRINT dos atributos
-- (tipo, crédito, entrada, parcela, prazo, administradora), e o casamento é
-- por multiconjunto de fingerprints DENTRO da fonte — colisão de fingerprint
-- é estoque múltiplo legítimo (D3), não erro.
--
-- NUMERAÇÃO: 0062 é o maior aplicado. Este é 0063. (Atenção: o histórico tem
-- números duplicados em 0023 e 0024 — conferido, 0063 está livre.)
--
-- CERTIFICAÇÃO: todo objeto abaixo foi construído e exercitado no projeto de
-- ensaio szs (szsqdpwwxtmrtrhaikuh) contra 1.408 cartas reais transportadas do
-- xtv, com replay de 80 ciclos e um kit de 25 provas (a–p) 25/25 PASS —
-- mais um item (n-v2) revogado pela própria auditoria e substituído (n-v3).
-- As DUAS divergências deliberadas contra o szs estão marcadas com
-- "DIVERGE DO ENSAIO" e justificadas no ponto.
--
-- ----------------------------------------------------------------------------
-- ESTA MIGRATION É O PASSO 1 DE 6. NÃO É O FIM.
--
-- Runbook completo e critério de aceite: T7_relatorio_fase_a.md §14.
--   1. esta migration          4. ciclo real supervisionado (cada fonte da
--   2. analyze public.cartas      lista branca), julgado contra §14.2
--   3. deploy do route.ts      5. relatório antes/depois
--                              6. SÓ ENTÃO: drop do SHIM legado (§11)
--
-- A janela entre (1) e (2) fica SEM VARREDURA — deliberado, e seguro pelo
-- kit j. O SHIM fica de pé durante toda a supervisão, de propósito: é ele
-- que segura as varreduras se o aceite falhar.
--
-- REGRA DE PARADA: falha em qualquer item do aceite => PARAR, não corrigir a
-- quente. Diagnóstico primeiro. Em especial (§14.2 item 1): um ciclo quieto
-- ACOMPANHADO de `ciclo_integridade_falhou` NÃO é sucesso — é a varredura se
-- recusando a varrer. Foi assim que o kit n-v2 produziu um verde falso no
-- ensaio (T7 §7-B).
-- ============================================================================

begin;

-- ============================================================================
-- 0. PRÉ-VOO — falha cedo, alto e claro
-- ============================================================================
do $pre$
begin
  if to_regclass('public.cartas') is null then
    raise exception '0063: public.cartas nao existe'; end if;
  if to_regclass('public.reservas') is null then
    raise exception '0063: public.reservas nao existe (esperado da 0036)'; end if;
  -- ÂNCORA D1: carta_fingerprint tem que ser byte-a-byte a mesma do ensaio.
  -- Medido na FASE A: md5(prosrc) igual nos dois projetos.
  if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='carta_fingerprint')
     is distinct from '2b59bc5723f6ad9856ea4958f4ad0450' then
    raise exception '0063: carta_fingerprint divergiu da ancora D1 — PARE e reavalie';
  end if;
end $pre$;


-- ============================================================================
-- 1. unaccent — TEM QUE VIR ANTES de adm_fingerprint_input
--
-- Medido na FASE A: a extensão NÃO está instalada no xtv e nenhuma função
-- `unaccent` é visível. Sem isto, adm_fingerprint_input não compila.
--
-- `with schema public` não é estética: cartas_fingerprint_trg roda com
-- SET search_path TO 'public','pg_temp'. Se unaccent nascer no schema
-- `extensions` (default do Supabase), o trigger não a enxerga e estoura
-- 42883 a cada INSERT em cartas. No ensaio szs ela vive em `public` — é o
-- que estamos reproduzindo.
-- ============================================================================
create extension if not exists unaccent with schema public;


-- ============================================================================
-- 2. adm_fingerprint_input (D2) — normalização da administradora
--
-- Byte-a-byte igual ao ensaio (md5 do corpo: 4593bfdc5938e328c3202745e0287da3).
--
-- Por que existe: carta_fingerprint NÃO normaliza a string da administradora
-- (só faz lower/trim). Quem não resolve para uma administradora do catálogo
-- entra pelo cru — e aí `ITAÚ - P` e `ITAU - P` seriam cartas diferentes.
-- Medido no xtv: 77 raws distintos, 69 resolvem, 8 caem no fallback
-- (REPASSE (CAPITAL DE GIRO) 860, PORTOAF 183, BBRASIL 141, '' 54,
--  ITAÚ - P 46, ITAÚ - M 42, DAF 5, ITAU - P 2) — 1.333 linhas.
-- Exatamente o par ITAÚ-P/ITAU-P que este unaccent colapsa.
--
-- NOTA declarada: IMMUTABLE aqui é uma promessa mais forte que a verdade —
-- unaccent(text) é STABLE (depende do dicionário default). Mantido idêntico
-- ao ensaio de propósito, e é seguro porque o índice adiante indexa a COLUNA
-- materializada, nunca esta expressão.
-- ============================================================================
create or replace function public.adm_fingerprint_input(p_adm_resolvida text, p_adm_raw text)
returns text language sql immutable as $function$
  select case
    when nullif(trim(coalesce(p_adm_resolvida,'')),'') is not null then p_adm_resolvida
    when nullif(trim(coalesce(p_adm_raw,'')),'')      is not null
      then regexp_replace(unaccent(lower(trim(p_adm_raw))), '\s+', ' ', 'g')
    else '' end
$function$;

comment on function public.adm_fingerprint_input(text,text) is
  'IDENTIDADE-01/D2: entrada canônica da administradora no fingerprint. Nome do '
  'catálogo quando resolve; senão o cru normalizado (unaccent+lower+trim+colapso '
  'de espaços). Colapsa ITAÚ - P e ITAU - P no mesmo fingerprint.';


-- ============================================================================
-- 3. carta_vinculo_ativo (D10) — "esta carta tem gente em cima?"
--
-- *** DIVERGE DO ENSAIO (1 de 2) — deliberado e obrigatório. ***
-- No szs a função lê `reservas_vitrine`. Essa tabela NÃO EXISTE no xtv
-- (conferido: existem reservas, interesses, processos). A spec já mandava
-- apontar para "reservas (0036)/interesses/processos reais" — é o que segue.
-- O predicado de reserva é o MESMO que a vw_vitrine_viva já usa hoje
-- (status='ativa' and expira_em>now()), então não inventa semântica nova.
--
-- Medido no xtv agora: reservas 1 linha (cancelada, 0 ativas), interesses 36
-- (todos 'novo'), processos 0. O blast radius desta função hoje é pequeno —
-- mas ela é o que impede o sync de orfanizar uma carta com cliente em cima.
-- ============================================================================
create or replace function public.carta_vinculo_ativo(p_carta_id uuid)
returns boolean language sql stable security definer
set search_path to 'public','pg_temp' as $function$
  select exists(select 1 from reservas r
                 where r.carta_id = p_carta_id and r.status = 'ativa' and r.expira_em > now())
      or exists(select 1 from interesses i where i.carta_id = p_carta_id
                 and coalesce(i.status,'') not in ('descartado','perdido','fechado'))
      or exists(select 1 from processos p where p.carta_id = p_carta_id
                 and coalesce(p.status::text,'') not in ('cancelado','concluido'))
$function$;

comment on function public.carta_vinculo_ativo(uuid) is
  'IDENTIDADE-01/D10: true se a carta tem reserva ativa não expirada, interesse '
  'em aberto ou processo em andamento. A varredura NUNCA orfaniza carta com '
  'vínculo ativo — deixa o evento ausente_reservada como rastro.';


-- ============================================================================
-- 4. cartas.fingerprint (D4) — a coluna materializada + trigger
--
-- Por que materializar em vez de computar na hora: o casamento de candidata
-- roda por linha dentro do laço de cotas. Com expressão, cada cota faz um
-- seq scan de 94 mil linhas. Com coluna + índice parcial, é lookup.
-- ============================================================================
alter table public.cartas add column if not exists fingerprint text;

comment on column public.cartas.fingerprint is
  'IDENTIDADE-01/D4: fingerprint de identidade materializado por '
  'trg_cartas_fingerprint. NÃO editar à mão — é derivado.';

create or replace function public.cartas_fingerprint_trg()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $function$
begin
  new.fingerprint := public.carta_fingerprint(new.tipo::text, new.valor_credito, new.valor_entrada,
    new.valor_parcela, new.qtd_parcelas,
    public.adm_fingerprint_input((select a.nome from administradoras a where a.id=new.administradora_id),
                                 new.administradora_raw));
  return new;
end $function$;

drop trigger if exists trg_cartas_fingerprint on public.cartas;
create trigger trg_cartas_fingerprint
  before insert or update of tipo, valor_credito, valor_entrada, valor_parcela,
                             qtd_parcelas, administradora_id, administradora_raw
  on public.cartas for each row execute function public.cartas_fingerprint_trg();


-- ============================================================================
-- 5. BACKFILL das 94.747 linhas — custo MEDIDO, não estimado
--
-- Medição da FASE A (e a correção de uma suposição que estava errada):
--
--   * trg_bidcon_price custa 392,2 ms/linha (275x o insert nu) — medido em 10
--     linhas descartáveis no szs. ISSO NÃO SE APLICA AQUI. O trigger é
--     `UPDATE OF valor_credito, valor_entrada, valor_parcela, qtd_parcelas,
--     tipo`; um UPDATE que só lista `fingerprint` não o dispara. Provado
--     empiricamente: backfill de 1.408 linhas no szs deixou bidcon_custo_am e
--     bidcon_agio_120 com md5 IDÊNTICO. Sem esse teste, a conta ingênua daria
--     94.747 x 392 ms ≈ 10h19m e teria justificado desligar o trigger de preço
--     em produção sem nenhuma necessidade.
--   * custo real do UPDATE só-da-coluna: 113,2 ms / 1.408 linhas = 0,080 ms/linha.
--   * custo de COMPUTAR a expressão nas 94.747 do xtv, medido em leitura pura:
--     736,1 ms (0,0078 ms/linha).
--
--   => backfill projetado: ~740 ms de CPU + ~7,6 s de escrita/WAL ≈ 10 s.
--      Roda em transação única sem chegar perto de teto nenhum.
--
-- ÂNCORA: o md5 do universo de fingerprints do xtv, computado em leitura pura
-- na FASE A (2026-08-02) com a emulação de unaccent certificada 0-divergência,
-- é 4a4524e919b13e0893db29064216a627. Se o backfill produzir outro valor, ou o
-- estoque mudou entre a medição e a aplicação (esperado, o sync roda de hora em
-- hora), ou a normalização divergiu (NÃO esperado). A asserção abaixo é um
-- AVISO, não um abort, exatamente por isso.
-- ============================================================================
update public.cartas c set fingerprint = public.carta_fingerprint(
  c.tipo::text, c.valor_credito, c.valor_entrada, c.valor_parcela, c.qtd_parcelas,
  public.adm_fingerprint_input(
    (select a.nome from public.administradoras a where a.id = c.administradora_id),
    c.administradora_raw))
where c.fingerprint is null
   or c.fingerprint is distinct from public.carta_fingerprint(
        c.tipo::text, c.valor_credito, c.valor_entrada, c.valor_parcela, c.qtd_parcelas,
        public.adm_fingerprint_input(
          (select a.nome from public.administradoras a where a.id = c.administradora_id),
          c.administradora_raw));

alter table public.cartas alter column fingerprint set not null;

do $bf$
declare v_md5 text; v_n int;
begin
  select count(*), md5(string_agg(fingerprint,'|' order by fingerprint))
    into v_n, v_md5 from public.cartas;
  if v_md5 = '4a4524e919b13e0893db29064216a627' then
    raise notice '0063 backfill: % linhas, md5 BATE com a ancora da FASE A', v_n;
  else
    raise warning '0063 backfill: % linhas, md5=% (ancora FASE A=4a4524e919b13e0893db29064216a627). '
      'Divergencia ESPERADA se o estoque mudou desde a medicao; INVESTIGAR se nao mudou.', v_n, v_md5;
  end if;
end $bf$;

-- Índice parcial: é o que faz o casamento por fingerprint ser lookup e não
-- varredura. Só vivas (D11) — o sync nunca procura candidata morta ou vendida.
create index if not exists idx_cartas_fonte_fp_vivas
  on public.cartas (administradora_origem, fingerprint)
  where status in ('disponivel','reservada');


-- ============================================================================
-- 6. Estado do ciclo por fonte + snapshot auditável
-- ============================================================================
create table if not exists public.sync_fonte_estado (
  fonte               text        primary key,
  ultima_varredura_em timestamptz not null default '-infinity'
);
alter table public.sync_fonte_estado enable row level security;

comment on table public.sync_fonte_estado is
  'IDENTIDADE-01/D6: fronteira entre ciclos por fonte. ultima_varredura_em é '
  'escrito como ÚLTIMO ato da varredura e serve de ciclo_t0 do ciclo seguinte.';

create table if not exists public.sync_snapshot_ciclo (
  id           uuid        primary key default gen_random_uuid(),
  fonte        text        not null,
  ciclo_inicio timestamptz not null,
  gravado_em   timestamptz not null default now(),
  total_cotas  int         not null,
  payload      jsonb       not null
);
alter table public.sync_snapshot_ciclo enable row level security;

create index if not exists idx_snapshot_fonte_ciclo
  on public.sync_snapshot_ciclo (fonte, ciclo_inicio desc);

comment on table public.sync_snapshot_ciclo is
  'IDENTIDADE-01: payload cru de cada ciclo de varredura. É o que permite '
  'refazer a conta depois — sem isto, uma orfanização em massa é indefensável.';

-- Semeia as fontes da rotação. `-infinity` como default é intencional na
-- coluna, mas nenhuma linha nasce com ele aqui: sync_ciclo_t0 faz o bootstrap
-- com now() na primeira chamada de cada fonte (ver comentário lá).
insert into public.sync_fonte_estado(fonte, ultima_varredura_em)
select f, now() from unnest(array['LANCE','CBC','PIFFER','CARTAS','SERVOPA','PLAYCONTEMPLADAS']) f
on conflict (fonte) do nothing;


-- ============================================================================
-- 7. Envelope do ciclo (D6): sync_ciclo_t0 + sync_cotas_array
--
-- O envelope canônico é {"ciclo_t0": <ts>, "cotas": [...]}. As duas funções
-- abaixo aceitam TAMBÉM o array cru — é o que permite aplicar esta migration
-- ANTES do deploy do route.ts sem quebrar nada (ver T6_route_diff.md, "ordem
-- de deploy"): route velho manda array, cai no ramo legado, funciona.
-- ============================================================================
create or replace function public.sync_ciclo_t0(p_origem text, p_cotas jsonb)
returns timestamptz language plpgsql security definer
set search_path to 'public','pg_temp' as $function$
declare v timestamptz;
begin
  -- envelope canônico {"ciclo_t0":..., "cotas":[...]}
  if jsonb_typeof(p_cotas)='object' and p_cotas ? 'ciclo_t0' then
    return (p_cotas->>'ciclo_t0')::timestamptz;
  end if;
  -- legado/avulso: t0 do estado. Bootstrap NUNCA usa -infinity.
  select ultima_varredura_em into v from sync_fonte_estado where fonte=p_origem;
  if v is null then
    insert into sync_fonte_estado(fonte, ultima_varredura_em) values (p_origem, now())
      on conflict (fonte) do nothing;
    select ultima_varredura_em into v from sync_fonte_estado where fonte=p_origem;
  end if;
  return v;
end $function$;

comment on function public.sync_ciclo_t0(text,jsonb) is
  'IDENTIDADE-01/D6: t0 do ciclo. Do envelope quando presente; senão a fronteira '
  'do estado. Jamais -infinity: com -infinity nada seria reivindicável e o sync '
  'duplicaria o estoque inteiro na primeira execução da fonte.';

create or replace function public.sync_cotas_array(p_cotas jsonb)
returns jsonb language sql immutable as $function$
  select case when jsonb_typeof(p_cotas)='object' and p_cotas ? 'cotas'
              then p_cotas->'cotas' else p_cotas end
$function$;

comment on function public.sync_cotas_array(jsonb) is
  'IDENTIDADE-01/D6: desembrulha o envelope. Array cru passa reto (compat).';


-- ============================================================================
-- 8. sync_alocar_numero (D7 ampliado) — deslocamento de número
--
-- numero_externo é POSIÇÃO. Duas cartas da mesma fonte não podem ocupar a
-- mesma posição, então a entrante desaloja a atual. ADENDO-2/Q1, ratificado:
-- o deslocamento cobre disponivel/reservada/indisponivel, mas VENDIDA JAMAIS
-- (D11 proíbe o sync de tocar carta vendida). Quando a detentora é vendida, a
-- entrante fica SEM número e o fato vira evento 'numero_retido' — visível,
-- não silencioso.
--
-- A deslocada NÃO é orfanizada aqui: o destino dela é da varredura, que é a
-- única que enxerga o ciclo inteiro (D5).
-- ============================================================================
create or replace function public.sync_alocar_numero(p_origem text, p_numero integer,
                                                     p_excluir uuid default null)
returns integer language plpgsql security definer
set search_path to 'public','pg_temp' as $function$
declare v_retido boolean;
begin
  if p_numero is null then return null; end if;

  update cartas
     set numero_externo = null
   where administradora_origem = p_origem
     and numero_externo = p_numero
     and status <> 'vendida'
     and (p_excluir is null or id <> p_excluir);

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
end $function$;


-- ============================================================================
-- 9. sync_aplicar_cotas — ASSINATURA CONGELADA (D5)
--
-- (p_origem text, p_cotas jsonb, p_varrer boolean) — igualzinha à de hoje. O
-- route.ts em produção continua chamando com os mesmos três argumentos; o que
-- muda é o CONTEÚDO de p_cotas (envelope) e o miolo do casamento.
--
-- Trocas em relação à função atual do xtv:
--   * candidata por FINGERPRINT + fonte + viva + não-reivindicada-neste-ciclo,
--     em vez de por numero_externo;
--   * prioridade de casamento: vinculadas primeiro, depois as mais antigas —
--     assim uma carta com cliente em cima nunca é a que sobra para morrer;
--   * NUNCA orfaniza dentro do lote (p_varrer chega false do route);
--   * lock por fonte (D9) para dois crons concorrentes não se atropelarem.
-- ============================================================================
create or replace function public.sync_aplicar_cotas(p_origem text, p_cotas jsonb,
                                                     p_varrer boolean default true)
returns table(novas integer, atualizadas integer, indisponibilizadas integer)
language plpgsql security definer
set search_path to 'public','pg_temp' as $function$
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
      -- Deslocamento de número (D7) antes de gravar.
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
      -- Medido no szs com trg_bidcon_price LIGADO: 1.200 reivindicações => 0
      -- disparos, 4,5 s (kit p); 1.224 reivindicações em 13 lotes => 0 disparos,
      -- 3,7 s / 3,05 ms por linha (kit n-v3). O contra-controle p-insert prova
      -- que a sonda dispara mesmo: 25 INSERTs => 25 disparos.
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
end $function$;


-- ============================================================================
-- 10. sync_varrer_ausentes — NOVA, de 3 argumentos
--
-- Ordem dos atos (D8), e a ordem importa:
--   (1) snapshot do payload  — evidência antes de qualquer destruição;
--   (2) checagem de integridade por fingerprint. Divergiu => NÃO ORFANIZA
--       nada, registra 'ciclo_integridade_falhou' e ainda assim avança o
--       estado (autocura: sem isso, um lote perdido faria o ciclo seguinte
--       re-reivindicar e duplicar);
--   (3a) rastro das vivas ausentes que SOBREVIVEM (vínculo ativo ou reservada);
--   (3b) orfanização, só disponivel -> indisponivel;
--   (4) ultima_varredura_em como ÚLTIMO ato — se algo estourar antes, o ciclo
--       seguinte reprocessa em vez de assumir trabalho não feito.
-- ============================================================================
create or replace function public.sync_varrer_ausentes(p_origem text, p_cotas jsonb,
                                                       p_ciclo_inicio timestamptz)
returns integer language plpgsql security definer
set search_path to 'public','pg_temp' as $function$
declare v_ind int:=0; v_div int:=0; v_now timestamptz:=now(); v_arr jsonb;
  v_admin_id uuid; v_adm_fb uuid;
begin
  -- ISOLAMENTO DE PARTIÇÃO (D12): BIDCON_DIRETO e Itaú intocáveis.
  if p_origem is null or p_origem not in ('LANCE','CBC','PIFFER','CARTAS','SERVOPA','PLAYCONTEMPLADAS') then
    raise exception 'origem_invalida: %', coalesce(p_origem,'<null>') using errcode='P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('sync:'||p_origem));  -- D9
  v_arr := public.sync_cotas_array(p_cotas);
  if jsonb_array_length(coalesce(v_arr,'[]'::jsonb))=0 then return 0; end if;

  -- Mesmo fallback de administradora usado por sync_aplicar_cotas (ADENDO-2/Q2:
  -- sem isto, SERVOPA computaria fingerprint diferente aqui e na aplicação, e a
  -- checagem de integridade acusaria divergência em 100% dos ciclos).
  select administradora_id into v_admin_id from sync_fonte_config where fonte=p_origem;
  v_adm_fb := case when p_origem='SERVOPA' then v_admin_id else null end;

  -- (1) snapshot bruto do ciclo
  insert into sync_snapshot_ciclo(fonte,ciclo_inicio,total_cotas,payload)
  values (p_origem,p_ciclo_inicio,jsonb_array_length(v_arr),v_arr);

  -- (2) integridade: contagem por fingerprint do payload vs reivindicadas
  --     desde ciclo_t0. 'entrante' computa inline (cota não é linha);
  --     'vivo' LÊ a coluna materializada (D4), viva = disponivel|reservada (D11).
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
    insert into sync_fonte_estado(fonte,ultima_varredura_em) values (p_origem,v_now)
      on conflict (fonte) do update set ultima_varredura_em=excluded.ultima_varredura_em;
    return 0;
  end if;

  -- (3a) viva ausente que SOBREVIVE à orfanização deixa rastro (D8).
  insert into eventos_sync(tipo,numero_externo,carta_id,detalhe)
  select 'ausente_reservada',c.numero_externo,c.id,p_origem||' fp='||c.fingerprint
  from cartas c where c.administradora_origem=p_origem
    and c.status in ('disponivel','reservada')
    and coalesce(c.sincronizada_em,'-infinity') < p_ciclo_inicio
    and (public.carta_vinculo_ativo(c.id) or c.status='reservada');

  -- (3b) orfanização: SÓ rebaixa disponivel -> indisponivel (D11).
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
end $function$;


-- ============================================================================
-- 11. sync_varrer_ausentes(text, jsonb) LEGADA vira SHIM no-op (ADENDO-1)
--
-- A de 2 args casa por número — o modelo que esta fatia aposenta. Não pode
-- ser derrubada (sobrecarga some, chamador esquecido estoura 42883 e o cron
-- morre), e não pode continuar orfanizando por número (destruiria o casamento
-- por fingerprint). Então: registra que foi chamada, devolve 0, NÃO ESCREVE
-- EM `cartas`. Se este evento aparecer em produção, há chamador desatualizado.
-- ============================================================================
create or replace function public.sync_varrer_ausentes(p_origem text, p_numeros jsonb)
returns integer language plpgsql security definer
set search_path to 'public','pg_temp' as $function$
begin
  insert into eventos_sync(tipo, detalhe)
  values ('varredura_legada_chamada',
          coalesce(p_origem,'<null>')||' numeros='||
          coalesce(jsonb_array_length(
            case when jsonb_typeof(p_numeros)='array' then p_numeros else '[]'::jsonb end
          ),0)::text||' — no-op (IDENTIDADE-01 ADENDO-1)');
  return 0;
end $function$;

comment on function public.sync_varrer_ausentes(text,jsonb) is
  'OBSOLETA (IDENTIDADE-01 ADENDO-1). No-op: só registra varredura_legada_chamada. '
  'Use sync_varrer_ausentes(text,jsonb,timestamptz). Este evento em produção '
  'significa chamador desatualizado.';


-- ============================================================================
-- 12. vw_vitrine_viva passa a LER a coluna (mesma normalização)
--
-- Defeito real medido na FASE A: hoje a view computa o fingerprint inline com
-- `coalesce(a.nome, c.administradora_raw, '')` — SEM adm_fingerprint_input.
-- Para administradora que não resolve, a view produz um fingerprint e o sync
-- produz outro. Consequência prática: a reserva feita pela vitrine grava um
-- fingerprint que jamais casa com o da carta, e a carta NÃO fica bloqueada.
--
-- Alcance hoje: 1 carta viva das 2.569 (raw `ITAÚ - P`, que a view lê como
-- 'ITAÚ - P' e o sync como 'itau - p'). Uma. Mas é uma carta que pode ser
-- reservada por dois clientes ao mesmo tempo, e o histórico tem 1.333 linhas
-- no ramo de fallback. Ler a coluna elimina a classe inteira do problema.
-- ============================================================================
create or replace view public.vw_vitrine_viva as
 select c.id,
    c.numero_externo as ref,
    c.tipo,
    c.valor_credito as credito,
    c.valor_entrada as entrada,
    c.valor_parcela as parcela,
    c.qtd_parcelas  as parcelas,
    c.bidcon_custo_am as custo_am,
    c.bidcon_agio_120 as agio_120,
    c.bidcon_agio_150 as agio_150,
    coalesce(a.nome, c.administradora_raw, ''::text) as administradora,
    c.criado_em,
    c.sincronizada_em as atualizado,
    c.fingerprint,                      -- <== era carta_fingerprint(...) inline
    c.fonte,
    c.fonte = 'cliente_direto'::text as exclusiva
   from cartas c
     left join administradoras a on a.id = c.administradora_id
  where c.status = 'disponivel'::status_carta
    and c.valor_credito > 0::numeric
    and c.categoria = 'contemplada'::text
    and not exists (
      select 1 from reservas r
       where r.status = 'ativa'::text
         and r.expira_em > now()
         and r.fingerprint = c.fingerprint)   -- <== idem
  order by (c.fonte = 'cliente_direto'::text) desc, c.bidcon_custo_am;

comment on view public.vw_vitrine_viva is
  'Vitrine pública. IDENTIDADE-01: lê cartas.fingerprint materializado em vez de '
  'recomputar inline — a normalização da administradora passa a ser a MESMA do '
  'sync (adm_fingerprint_input), fechando o furo em que uma reserva sobre carta '
  'de administradora não-resolvida nunca bloqueava a carta.';


-- ============================================================================
-- 13. reservas.fingerprint ativas — realinhamento
--
-- Medido: 0 reservas ativas no xtv hoje (1 linha, cancelada, expirada em
-- 11/07). O UPDATE abaixo é no-op HOJE e está aqui de propósito: se entre
-- escrever e aplicar esta migration alguém reservar, a reserva tem que
-- carregar o fingerprint na normalização nova, ou nasce órfã.
-- ============================================================================
update public.reservas r
   set fingerprint = c.fingerprint
  from public.cartas c
 where c.id = r.carta_id
   and r.status = 'ativa'
   and r.expira_em > now()
   and r.fingerprint is distinct from c.fingerprint;


-- ============================================================================
-- 14. Contador da home (D13) — VARIANTE B
--
-- Medido na FASE A sobre 10 dias úteis reais do xtv:
--
--   série       mín  máx  média  total
--   bruta       229  517  357,5  3.575
--   A (c/prazo) 132  369  245,7  2.457   -31,3% vs bruta
--   B (s/prazo) 116  342  211,4  2.114   -40,9% vs bruta
--
--   decomposição (B ⟹ A por construção, então os baldes são exatos):
--     nova real     2.114  (59,1%)
--     tick de prazo   343   (9,6%)
--     REPRECIFICADA 1.118  (31,3%)  <== o defeito
--
-- Quase um terço do contador de hoje é a MESMA carta com preço novo. O fp
-- cheio inclui entrada e parcela, então mexer no preço forja identidade nova.
--
-- Por que B e não A: qtd_parcelas decrementa todo mês por natureza — um
-- contador ancorado nele herda um fluxo diário garantido de falso-positivo
-- (medido: ~20 fp/dia, 8,1% da série A) que não some com o tempo. B erra para
-- baixo (~14 fp/dia, 6,6%), e numa superfície pública subcontar não infla a
-- vitrine. B tem menor erro absoluto E relativo.
--
-- Janela de 14 dias: "estreia" é contra o retrospecto, não contra o histórico
-- inteiro — carta que sumiu por três semanas e voltou conta como nova, que é
-- o comportamento que a home quer.
-- ============================================================================
create or replace function public.contador_novas_hoje(p_dia date default current_date)
returns integer language sql stable security definer
set search_path to 'public','pg_temp' as $function$
  with base as (
    select c.criado_em::date dia, c.fingerprint fp,
           md5(lower(coalesce(trim(c.tipo::text),''))||'|'||
               coalesce((round(c.valor_credito*100))::bigint::text,'0')||'|'||
               lower(public.adm_fingerprint_input(
                 (select a.nome from administradoras a where a.id=c.administradora_id),
                 c.administradora_raw))) fpb
      from cartas c
     where c.criado_em >= (p_dia - 14) and c.criado_em < (p_dia + 1)
       and c.fonte = '360prospere'),
  estreia_fp as (
    select fp from base group by fp having min(dia) = p_dia),
  estreia_fpb as (
    select fpb from base group by fpb having min(dia) = p_dia)
  select count(distinct b.fp)::int
    from base b
    join estreia_fp  f  on f.fp  = b.fp
    join estreia_fpb fb on fb.fpb = b.fpb
   where b.dia = p_dia
$function$;

comment on function public.contador_novas_hoje(date) is
  'IDENTIDADE-01/D13 variante B: fingerprints que estreiam no dia E cujo '
  'fp_estrutural (tipo|credito|administradora) também estreia, em retrospecto '
  'de 14 dias. Exclui reprecificação (31,3% da contagem bruta medida) e tick '
  'de prazo. NÃO conta linhas — conta identidades.';


-- ============================================================================
-- 15. RODAPÉ DE GRANTS (D15 / padrão SEGURANCA-01)
--    Nada novo nasce executável por PUBLIC/anon/authenticated.
-- ============================================================================

-- tabelas: service-only. RLS habilitado acima, sem policy => ninguém além do
-- service_role (que faz bypass) enxerga uma linha.
revoke all on table public.sync_fonte_estado   from public, anon, authenticated;
revoke all on table public.sync_snapshot_ciclo from public, anon, authenticated;
grant  all on table public.sync_fonte_estado   to service_role;
grant  all on table public.sync_snapshot_ciclo to service_role;

-- funções do sync: só o service_role (o cron) chama.
revoke all on function public.adm_fingerprint_input(text,text)                   from public, anon, authenticated;
revoke all on function public.carta_vinculo_ativo(uuid)                          from public, anon, authenticated;
revoke all on function public.cartas_fingerprint_trg()                           from public, anon, authenticated;
revoke all on function public.sync_ciclo_t0(text,jsonb)                          from public, anon, authenticated;
revoke all on function public.sync_cotas_array(jsonb)                            from public, anon, authenticated;
revoke all on function public.sync_alocar_numero(text,integer,uuid)              from public, anon, authenticated;
revoke all on function public.sync_aplicar_cotas(text,jsonb,boolean)             from public, anon, authenticated;
revoke all on function public.sync_varrer_ausentes(text,jsonb,timestamptz)       from public, anon, authenticated;
revoke all on function public.sync_varrer_ausentes(text,jsonb)                   from public, anon, authenticated;
revoke all on function public.contador_novas_hoje(date)                          from public, anon, authenticated;

grant execute on function public.adm_fingerprint_input(text,text)                to service_role;
grant execute on function public.carta_vinculo_ativo(uuid)                       to service_role;
grant execute on function public.cartas_fingerprint_trg()                        to service_role;
grant execute on function public.sync_ciclo_t0(text,jsonb)                       to service_role;
grant execute on function public.sync_cotas_array(jsonb)                         to service_role;
grant execute on function public.sync_alocar_numero(text,integer,uuid)           to service_role;
grant execute on function public.sync_aplicar_cotas(text,jsonb,boolean)          to service_role;
grant execute on function public.sync_varrer_ausentes(text,jsonb,timestamptz)    to service_role;
grant execute on function public.sync_varrer_ausentes(text,jsonb)                to service_role;
grant execute on function public.contador_novas_hoje(date)                       to service_role;

-- O trigger dispara mesmo sem EXECUTE para o papel que insere: o Postgres não
-- checa privilégio de execução no disparo. Medido no ensaio (D15).
--
-- contador_novas_hoje: se a home for chamá-lo direto do cliente, adicionar
-- `grant execute ... to anon` NUMA MIGRATION SEPARADA, com a decisão explícita.
-- Não damos isso de graça aqui.


-- ============================================================================
-- 16. PÓS-VOO
-- ============================================================================
do $pos$
declare v int;
begin
  if (select count(*) from public.cartas where fingerprint is null) > 0 then
    raise exception '0063: sobrou fingerprint nulo apos o backfill'; end if;
  if to_regclass('public.idx_cartas_fonte_fp_vivas') is null then
    raise exception '0063: indice parcial nao criado'; end if;
  select count(*) into v from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='sync_varrer_ausentes';
  if v <> 2 then raise exception '0063: esperadas 2 sobrecargas de sync_varrer_ausentes, achei %', v; end if;
  raise notice '0063 OK: fingerprint materializado, indice criado, shim legado no lugar.';
end $pos$;

commit;

-- ============================================================================
-- PÓS-APLICAÇÃO (fora da transação, ordem obrigatória)
-- Runbook completo: T7_relatorio_fase_a.md §14.
--
-- 2. Rodar `analyze public.cartas;` — o planner precisa saber que a coluna
--    nova existe, ou o índice parcial fica sem estatística no primeiro ciclo.
-- 3. SÓ ENTÃO fazer o deploy do route.ts (T6_route_diff.md). A ordem inversa
--    quebra: route novo + migration velha = 42883 em todas as fontes.
-- 4. Ciclo real supervisionado, cobrindo CADA FONTE da lista branca (D12),
--    julgado contra o aceite abaixo.
-- 5. Relatório antes/depois.
-- 6. SÓ ENTÃO: drop do SHIM legado da seção 11. Enquanto o aceite não fechar,
--    o SHIM fica de pé de propósito — é ele que segura as varreduras.
--
-- ----------------------------------------------------------------------------
-- ACEITE DO CICLO SUPERVISIONADO (T7 §14.2) — os 8 itens
--
-- 1. Δ ciclo_integridade_falhou = 0 EM TODAS AS FONTES. Ciclo quieto COM esse
--    evento é a varredura se recusando a varrer, NÃO é sucesso. (T7 §7-B)
-- 2. Controle recíproco de órfãs: orfanizações ~ sumiços reais da fonte no
--    ciclo. Baseline agregada declarada: 650–1.740/dia. A FASE A NÃO verificou
--    essa faixa — a janela reduzida do replay não permitia.
-- 3. Criações em centenas/dia. O contador "novas hoje" (variante B) sai do
--    ~218 falso para o número honesto — REGISTRAR o primeiro valor real.
-- 4. Duplicatas conhecidas da vitrine (22/31) colapsam; as ~22 invisíveis
--    rebaixadas sem evento voltam como NOVAS. Efeito ESPERADO, não anomalia.
-- 5. LANCE: novas reais, zero órfã de guarda. Itaú e BIDCON_DIRETO byte a
--    byte intocadas. Âncora medida na FASE A (14 linhas fora de
--    fonte='360prospere'): md5 = 5c7819be56b9bc584b1704cf11047e96.
--    Query de conferência (rodar antes E depois) em T7 §14.2.1.
-- 6. trg_bidcon_price: disparos só em INSERT / mudança real de preço; custo de
--    reivindicação na ordem do medido (~3 ms/linha). (ADENDO-4, T7 §7-A)
-- 7. eventos_sync: carta_nova / carta_indisponivel 1:1 com criações e
--    orfanizações do ciclo — o kit f-aud rodando em produção.
-- 8. Backfill desta migration: segundos, com md5 das colunas comerciais
--    idêntico antes/depois.
--
-- Acompanhar em eventos_sync: 'ciclo_integridade_falhou',
-- 'varredura_legada_chamada' (= chamador desatualizado) e 'numero_retido'.
-- Conferir que trg_bidcon_price segue em tgenabled='O'. Esta migration não o
-- toca, e não precisa: o backfill não o dispara.
--
-- REGRA DE PARADA: falha em qualquer item => PARAR, NÃO corrigir a quente.
-- O SHIM segura as varreduras; diagnóstico primeiro.
-- ============================================================================
