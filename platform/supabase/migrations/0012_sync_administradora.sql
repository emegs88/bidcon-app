-- ============================================================================
-- Bidcon — plataforma logada · Migration 0012 · Sync carimba administradora
-- ----------------------------------------------------------------------------
-- Rascunho para revisão. Depende de 0011 (tabelas + cartas.administradora_id /
-- cartas.fornecedor_id). NÃO rodar em PROD sem autorização. DEV primeiro.
--
-- OBJETIVO (pedido do usuário: "quando puxar já muda a administradora,
-- colocado no painel"):
--   Hoje o estoque vem de UM fornecedor (Lance Consórcio), cujas cotas são todas
--   de UMA administradora (HS). Então, no momento do sync, podemos CARIMBAR a
--   administradora e o fornecedor padrão da fonte — SEM reintroduzir os campos
--   administradora/taxa/fundo que o parser descarta por compliance.
--
--   A administradora NÃO é lida do JSON da fonte (continua descartada lá). Ela é
--   um DEFAULT DA FONTE, configurado uma vez no banco e aplicado pelo sync. Assim:
--     - o parser de lib/cotas-source.ts NÃO muda (segue descartando os sigilos);
--     - o sync associa o uuid da administradora pública e do fornecedor admin-only;
--     - o painel admin pode REASSOCIAR manualmente quando entrar outra fonte.
--
-- COMPLIANCE: administradora_id é público (logado); fornecedor_id é só admin
--   (ver RLS/observação em 0011). Aqui só gravamos uuids — nenhum texto de
--   administradora/taxa/fundo da fonte é lido ou persistido.
-- ============================================================================

-- ----- 1) Semente: a administradora e o fornecedor padrão da fonte atual ------
-- Idempotente: só insere se ainda não existir pelo nome. Ajuste os textos pelo
-- painel admin depois (logo, site, contato do responsável, canal de lance).
insert into administradoras (nome, segmentos, aceita_assuncao)
select 'HS Consórcios', array['imovel','veiculo'], false
where not exists (select 1 from administradoras where nome = 'HS Consórcios');

insert into fornecedores (nome, portal_origem)
select 'Lance Consórcio', 'https://contempladas.lanceconsorcio.com.br/'
where not exists (select 1 from fornecedores where nome = 'Lance Consórcio');

-- ----- 2) Tabela de configuração do sync (qual default carimbar) -------------
-- Mapeia a `fonte` (string já gravada nas cartas, ex.: '360prospere') para a
-- administradora e o fornecedor padrão. Permite, no futuro, ter mais de uma
-- fonte com defaults distintos sem mexer no código.
create table if not exists sync_fonte_config (
  fonte             text primary key,
  administradora_id uuid references administradoras(id) on delete set null,
  fornecedor_id     uuid references fornecedores(id)     on delete set null,
  atualizado_em     timestamptz not null default now()
);

alter table sync_fonte_config enable row level security;
create policy sync_fonte_config_admin_all on sync_fonte_config
  for all using (is_admin()) with check (is_admin());

-- vincula a fonte '360prospere' (a que o 0004 já grava) aos defaults semeados
insert into sync_fonte_config (fonte, administradora_id, fornecedor_id)
select
  '360prospere',
  (select id from administradoras where nome = 'HS Consórcios'),
  (select id from fornecedores   where nome = 'Lance Consórcio')
on conflict (fonte) do update
  set administradora_id = excluded.administradora_id,
      fornecedor_id     = excluded.fornecedor_id,
      atualizado_em     = now();

-- ----- 3) Backfill: cartas já sincronizadas que ainda não têm os uuids -------
-- Só toca cartas da própria fonte que estão sem administradora/fornecedor.
-- NÃO sobrescreve associação manual já feita pelo admin (where ... is null).
update cartas c
set administradora_id = cfg.administradora_id,
    fornecedor_id     = cfg.fornecedor_id
from sync_fonte_config cfg
where c.fonte = cfg.fonte
  and (c.administradora_id is null or c.fornecedor_id is null)
  and (cfg.administradora_id is not null or cfg.fornecedor_id is not null)
  and ( (c.administradora_id is null and cfg.administradora_id is not null)
     or (c.fornecedor_id     is null and cfg.fornecedor_id     is not null) );

-- ============================================================================
-- 4) sync_aplicar_cotas: carimba os defaults da fonte NO INSERT da carta nova
-- ----------------------------------------------------------------------------
-- Substitui a função do 0004. Única diferença funcional: ao inserir uma carta
-- NOVA, lê os defaults de sync_fonte_config para a fonte '360prospere' e grava
-- administradora_id / fornecedor_id. O UPDATE de cartas existentes NÃO mexe
-- nesses campos (preserva qualquer reassociação manual do admin).
-- Tudo o mais é idêntico ao 0004 (mesmas guardas, mesmos eventos, idempotente).
-- ============================================================================
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
  v_admin_id uuid;
  v_forn_id  uuid;
begin
  -- defaults da fonte '360prospere' (a mesma fonte gravada nas cartas do sync).
  -- Se a config não existir, ficam null e o carimbo simplesmente não acontece
  -- (a carta entra sem administradora; o admin associa pelo painel).
  select administradora_id, fornecedor_id
    into v_admin_id, v_forn_id
    from sync_fonte_config where fonte = '360prospere';

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
      -- carta NOVA — carimba administradora/fornecedor padrão da fonte
      insert into cartas (
        tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas,
        status, numero_externo, fonte, criado_via, sincronizada_em,
        administradora_id, fornecedor_id
      ) values (
        r.tipo, r.valor_credito, r.valor_entrada, r.valor_parcela, r.qtd_parcelas,
        'disponivel', r.numero, '360prospere', 'sync', now(),
        v_admin_id, v_forn_id
      )
      returning id into v_id;

      v_novas := v_novas + 1;
      insert into eventos_sync (tipo, numero_externo, carta_id, detalhe, push_pendente)
      values ('carta_nova', r.numero, v_id,
              'crédito ' || r.valor_credito::text, true);

    else
      -- já existe: reativa se estava indisponível, e atualiza se mudou algo.
      -- NÃO mexe em administradora_id/fornecedor_id (preserva ajuste manual).
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
          status = case when v_existe.status = 'indisponivel'
                        then 'disponivel' else v_existe.status end,
          sincronizada_em = now(),
          -- preenche os uuids só se ainda estiverem vazios (1ª vez pós-0011):
          administradora_id = coalesce(administradora_id, v_admin_id),
          fornecedor_id     = coalesce(fornecedor_id,     v_forn_id)
        where numero_externo = r.numero;

        v_atu := v_atu + 1;
        insert into eventos_sync (tipo, numero_externo, carta_id, detalhe)
        values ('carta_atualizada', r.numero, v_existe.id, 'valores/sync');
      else
        -- sem mudança de valores: toca o carimbo e completa uuids se faltarem
        update cartas set
          sincronizada_em = now(),
          administradora_id = coalesce(administradora_id, v_admin_id),
          fornecedor_id     = coalesce(fornecedor_id,     v_forn_id)
        where numero_externo = r.numero;
      end if;
    end if;
  end loop;

  -- 2) SUMIRAM da API: idêntico ao 0004
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

-- ----------------------------------------------------------------------------
-- Verificação rápida (opcional, após aplicar, no DEV):
--   select c.numero_externo, a.nome as administradora
--     from cartas c left join administradoras a on a.id = c.administradora_id
--    where c.fonte = '360prospere' limit 10;
--   -- Esperado: administradora = 'HS Consórcios' nas cartas do sync.
--   -- fornecedor_id preenchido, mas só admin consegue resolver o nome.
-- ----------------------------------------------------------------------------
