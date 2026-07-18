-- ============================================================================
-- Migration 0056 · REPASSE-CAPGIRO-01 — coluna `categoria`, backfill, parser
-- feed-agnóstico e vw_repasse_viva. Projeto: xtv. Aplicar só com AUTORIZO.
-- ----------------------------------------------------------------------------
-- CONTEXTO: 0055 (REPASSE-STOP) tirou as cotas "REPASSE (CAPITAL DE GIRO)"
-- da vitrine com um filtro provisório em cima de `administradora_raw`/nome
-- resolvido ilike '%repasse%', direto na view. Esta migration substitui esse
-- critério textual por uma coluna própria (`cartas.categoria`), classificada
-- na INGESTÃO (não mais só na leitura), e abre a superfície pública desse
-- produto em `vw_repasse_viva` (consumida por /api/repasse e pela nova seção
-- de grid em public/repasse.html).
--
-- NOME: "REPASSE-CAPGIRO-01" para não colidir com a fatia 0017_repasse.sql
-- ("Repasse — Assunção de Dívida", já em produção em public/repasse.html).
-- São nomes parecidos mas o mesmo PRODUTO no fundo — cota de consórcio com
-- crédito já utilizado, saldo a pagar, terceiro assume mediante garantia e
-- anuência da administradora. A distinção é só a ORIGEM do estoque: 0017 é
-- o motor de precificação (cascata Bidcon/parceiro/notarial, Conta Notarial)
-- que já existe hoje só para uso manual (visitante digita os números); esta
-- fatia ALIMENTA esse mesmo simulador com cotas REAIS vindas do sync PIFFER/
-- 360prospere, sem tocar no motor de cálculo. Ver DIARIO-BORDO para o
-- registro completo dessa distinção.
--
-- CLASSIFICAÇÃO AGNÓSTICA DE FEED (pedido explícito): a categoria é derivada
-- só de `administradora_raw ilike '%repasse%'`, nunca de `p_origem`. Se
-- amanhã LANCE/CBC/CARTAS/SERVOPA/PLAYCONTEMPLADAS começarem a mandar linhas
-- com "repasse" no nome da administradora, elas caem em categoria='repasse'
-- sozinhas — nada hardcoded para PIFFER.
--
-- SALDO DEVEDOR: não existe (nem existirá aqui) uma coluna própria — segue a
-- MESMA convenção já usada no modal "Custos de transferência" da vitrine
-- principal (custosDe() em public/index.html): saldo = valor_parcela ×
-- qtd_parcelas, nominal, sem reajustes futuros. Calculado na VIEW, não
-- armazenado.
-- ============================================================================

-- 1) Coluna categoria em cartas — default 'contemplada' preserva 100% do
--    comportamento atual para todo o resto do sistema (vitrine, GPT, minha-
--    carta, /cartas etc.), sem qualquer migração de dado nesses fluxos.
alter table public.cartas
  add column if not exists categoria text not null default 'contemplada'
    check (categoria in ('contemplada', 'repasse'));

-- 2) Backfill — mesmo critério textual que 0055 já usa na view (idempotente:
--    rodar de novo não muda nada em linhas já corretas).
update public.cartas
   set categoria = 'repasse'
 where administradora_raw ilike '%repasse%'
   and categoria <> 'repasse';

-- Índice parcial — só o subconjunto pequeno que os dois grids/vitrine
-- realmente consultam (status='disponivel'), evita indexar as ~zero linhas
-- indisponíveis de categoria='repasse' que não aparecem em lugar nenhum.
create index if not exists idx_cartas_categoria_disponivel
  on public.cartas (categoria)
  where status = 'disponivel';

-- 3) sync_aplicar_cotas — mesma função (mesma lista de origens já ampliada
--    por 0053 com PLAYCONTEMPLADAS), só adiciona a classificação de
--    categoria nos 2 caminhos de INSERT e nos 2 de UPDATE. Nenhuma outra
--    linha muda — corpo é o pg_get_functiondef atual, verificado antes de
--    escrever esta migration.
create or replace function public.sync_aplicar_cotas(
  p_origem text,
  p_cotas jsonb,
  p_varrer boolean default true
)
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
  v_adm_incoming uuid;
  v_categoria text;
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

    -- CATEGORIA-01: agnóstica de origem — só olha o texto cru da
    -- administradora desta linha, nunca p_origem. Ver comentário no topo.
    v_categoria := case when r.adm_raw ilike '%repasse%' then 'repasse' else 'contemplada' end;

    select id, tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas,
           status, entrada_parceiro_raw, administradora_id
      into v_existe from cartas
     where administradora_origem = p_origem and numero_externo = r.numero;

    if not found then
      insert into cartas (
        tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas,
        status, numero_externo, fonte, criado_via, sincronizada_em,
        administradora_origem, administradora_id, fornecedor_id,
        entrada_parceiro_raw, administradora_raw, categoria
      ) values (
        r.tipo, r.valor_credito, r.valor_entrada, r.valor_parcela, r.qtd_parcelas,
        'disponivel', r.numero, '360prospere', 'sync', now(),
        p_origem, v_adm_incoming, v_forn_id,
        r.entrada_parceiro, r.adm_raw, v_categoria
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
      -- Nota: uma cota que muda de categoria (ex.: contemplada → repasse)
      -- quase sempre já muda administradora_id junto (repasse não resolve
      -- administradora — fica null), então já cai neste guard sem precisar
      -- de uma condição própria de categoria aqui.
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
          entrada_parceiro_raw, administradora_raw, categoria
        ) values (
          r.tipo, r.valor_credito, r.valor_entrada, r.valor_parcela, r.qtd_parcelas,
          'disponivel', r.numero, '360prospere', 'sync', now(),
          p_origem, v_adm_incoming, v_forn_id,
          r.entrada_parceiro, r.adm_raw, v_categoria
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
          fornecedor_id      = coalesce(fornecedor_id, v_forn_id),
          categoria          = v_categoria
        where administradora_origem = p_origem and numero_externo = r.numero;

        v_atu := v_atu + 1;
        insert into eventos_sync (tipo, numero_externo, carta_id, detalhe)
        values ('carta_atualizada', r.numero, v_existe.id, p_origem || ' valores/sync');
      else
        update cartas set
          sincronizada_em = now(),
          administradora_raw = coalesce(r.adm_raw, administradora_raw),
          administradora_id  = coalesce(v_adm_incoming, administradora_id),
          fornecedor_id      = coalesce(fornecedor_id, v_forn_id),
          categoria          = v_categoria
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

-- 4) vw_vitrine_viva — troca o filtro textual provisório da 0055 pela
--    coluna categoria (fonte única de verdade agora). Comportamento
--    idêntico ao de hoje (0 linhas repasse aparecem), só limpa a dívida
--    técnica documentada na 0055.
create or replace view public.vw_vitrine_viva as
 SELECT c.id,
    c.numero_externo AS ref,
    c.tipo,
    c.valor_credito AS credito,
    c.valor_entrada AS entrada,
    c.valor_parcela AS parcela,
    c.qtd_parcelas AS parcelas,
    c.bidcon_custo_am AS custo_am,
    c.bidcon_agio_120 AS agio_120,
    c.bidcon_agio_150 AS agio_150,
    COALESCE(a.nome, c.administradora_raw, ''::text) AS administradora,
    c.criado_em,
    c.sincronizada_em AS atualizado,
    carta_fingerprint((c.tipo)::text, c.valor_credito, c.valor_entrada, c.valor_parcela, c.qtd_parcelas, COALESCE(a.nome, c.administradora_raw, ''::text)) AS fingerprint,
    c.fonte,
    (c.fonte = 'cliente_direto'::text) AS exclusiva
   FROM (cartas c
     LEFT JOIN administradoras a ON ((a.id = c.administradora_id)))
  WHERE ((c.status = 'disponivel'::status_carta)
     AND (c.valor_credito > (0)::numeric)
     AND (c.categoria = 'contemplada'::text)
     AND (NOT (EXISTS ( SELECT 1
           FROM reservas r
          WHERE ((r.status = 'ativa'::text) AND (r.expira_em > now()) AND (r.fingerprint = carta_fingerprint((c.tipo)::text, c.valor_credito, c.valor_entrada, c.valor_parcela, c.qtd_parcelas, COALESCE(a.nome, c.administradora_raw, ''::text))))))))
  ORDER BY (c.fonte = 'cliente_direto'::text) DESC, c.bidcon_custo_am;

-- 5) vw_repasse_viva — mesma estrutura de base da vitrine, categoria='repasse',
--    + saldo_devedor calculado (convenção custosDe(), ver topo do arquivo).
--    Sem `exclusiva`/`fonte` (não fazem sentido pra repasse — sem ranking
--    Bidcon Price aqui) e sem `custo_am`/`agio_120`/`agio_150` (esses campos
--    são exclusivos do motor de custo da vitrine principal; repasse tem seu
--    próprio motor client-side em repasse.html).
create or replace view public.vw_repasse_viva as
 SELECT c.id,
    c.numero_externo AS ref,
    c.tipo,
    c.valor_credito AS credito,
    c.valor_entrada AS entrada,
    c.valor_parcela AS parcela,
    c.qtd_parcelas AS parcelas,
    round(c.valor_parcela * c.qtd_parcelas, 2) AS saldo_devedor,
    COALESCE(a.nome, c.administradora_raw, ''::text) AS administradora,
    c.criado_em,
    c.sincronizada_em AS atualizado,
    carta_fingerprint((c.tipo)::text, c.valor_credito, c.valor_entrada, c.valor_parcela, c.qtd_parcelas, COALESCE(a.nome, c.administradora_raw, ''::text)) AS fingerprint
   FROM (cartas c
     LEFT JOIN administradoras a ON ((a.id = c.administradora_id)))
  WHERE ((c.status = 'disponivel'::status_carta)
     AND (c.valor_credito > (0)::numeric)
     AND (c.categoria = 'repasse'::text)
     AND (NOT (EXISTS ( SELECT 1
           FROM reservas r
          WHERE ((r.status = 'ativa'::text) AND (r.expira_em > now()) AND (r.fingerprint = carta_fingerprint((c.tipo)::text, c.valor_credito, c.valor_entrada, c.valor_parcela, c.qtd_parcelas, COALESCE(a.nome, c.administradora_raw, ''::text))))))))
  ORDER BY c.valor_parcela;

-- Grants — mesmo padrão de vw_vitrine_viva (SELECT para anon+authenticated;
-- /api/repasse usa service_role de qualquer forma, isto é só paridade).
grant select on public.vw_repasse_viva to anon, authenticated;

-- Nota GPT-01 (fatia futura, não iniciada): quando a fonte de dados do GPT
-- for implementada, basta consumir vw_vitrine_viva (ou o /api/vitrine) como
-- as outras superfícies — já vem só categoria='contemplada' de graça, sem
-- nenhum código extra.
