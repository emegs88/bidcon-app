-- ============================================================================
-- Bidcon — plataforma logada · Migration 0015 · Sync multi-fonte
-- ----------------------------------------------------------------------------
-- Rascunho para revisão. NÃO rodar em PROD sem autorização do Emerson.
-- Aplicar primeiro no DEV, DEPOIS de 0004→0011→0012→0013→0014.
--
-- CONTEXTO (decidido com o usuário, sessão de hoje):
--   Até aqui a plataforma logada só ingeria a Lance (lib/cotas-source.ts lia
--   contempladas.lanceconsorcio.com.br direto — o cabeçalho da 0004 dizia
--   "360prospere" mas o código nunca seguiu; esta migration alinha o dado ao
--   comentário). Agora o sync passa a consumir o feed multi-fonte do
--   prospere-360 (LANCE + CBC + PIFFER + CARTAS + SERVOPA), em modo ?admin=1,
--   para que "visível na vitrine" = "reservável na plataforma" de verdade.
--
-- DECISÕES QUE ESTA MIGRATION IMPLEMENTA (respostas nominais do usuário):
--   A) `fonte` NÃO muda de sentido: continua marcando "veio do sync"
--      (valor '360prospere'). sync_fonte_config, o carimbo do INSERT e a
--      cláusula "sumiram" continuam ancorados nela. A distinção por marca vive
--      em administradora_id/fornecedor_id (uuid reassociável pelo admin).
--   B) O sync busca cada fonte SEPARADAMENTE (5 guardas por endpoint, na rota).
--      A marcação de ausência ('indisponivel') só ocorre DENTRO da fonte que
--      veio íntegra — falha parcial numa fonte NUNCA apaga estoque de outra.
--   C) CBC/PIFFER/CARTAS/SERVOPA semeadas em administradoras + fornecedores +
--      sync_fonte_config, no MESMO padrão de sigilo já usado pra Lance (0011/
--      0012): administradora pública p/ logado, fornecedor SÓ ADMIN (RLS).
--   D1) Colisão de id entre fontes (cada endpoint numera id 1..N por conta):
--      chave de upsert = ÍNDICE ÚNICO COMPOSTO (administradora_origem,
--      numero_externo). `administradora_origem` é COLUNA NOVA, estável,
--      carimbada no sync — distinta de administradora_id (uuid reassociável).
--      numero_externo mantém o valor NATIVO de cada fonte, sem prefixo.
--
-- COMPLIANCE (inviolável): nenhum texto de administradora/taxa/fundo/comissão
--   da fonte é lido ou gravado aqui. administradora_id é público (logado);
--   fornecedor_id e entrada_parceiro_raw são admin-only (RLS/observação abaixo).
--   entrada_parceiro_raw só existe para fontes que somam 7% na origem (Opção B):
--   é o valor CRU do parceiro, usado só na confirmação interna, NUNCA no cliente.
-- ============================================================================

-- ============================================================================
-- 1) COLUNAS NOVAS EM `cartas` (aditivo, nada removido)
-- ----------------------------------------------------------------------------
--   administradora_origem : discriminador ESTÁVEL da fonte-marca (D1). NÃO é o
--     uuid administradora_id (que o admin pode reassociar à mão). É a string que
--     o sync grava e que compõe a chave de upsert. CHECK inclui 'manual' legado.
--   entrada_parceiro_raw  : valor CRU do parceiro (Opção B), admin-only. NULL
--     para LANCE (a Lance já embute os 7% na origem — não há valor cru separado)
--     e para cartas manuais. Preenchido só quando fonte-marca soma 7% (as demais).
-- ============================================================================
alter table cartas
  add column if not exists administradora_origem text,
  add column if not exists entrada_parceiro_raw  numeric(14,2);

-- administradora_origem: valores permitidos (as 5 marcas + 'manual' legado).
-- Constraint tolerante a null (cartas antigas sem carimbo continuam válidas).
alter table cartas drop constraint if exists chk_cartas_adm_origem;
alter table cartas
  add constraint chk_cartas_adm_origem
  check (
    administradora_origem is null
    or administradora_origem in ('LANCE','CBC','PIFFER','CARTAS','SERVOPA','manual')
  );

-- ----- D1: nova chave de upsert = (administradora_origem, numero_externo) -----
-- Substitui o índice único simples da 0004 (uniq_cartas_numero_externo), que
-- não distingue fontes e deixaria a carta CBC #1 sobrescrever a SERVOPA #1.
-- Único só quando AMBOS preenchidos: cartas manuais (numero_externo null)
-- continuam sem colidir entre si.
drop index if exists uniq_cartas_numero_externo;
create unique index if not exists uniq_cartas_origem_numero
  on cartas(administradora_origem, numero_externo)
  where numero_externo is not null and administradora_origem is not null;

create index if not exists idx_cartas_adm_origem on cartas(administradora_origem);

-- ============================================================================
-- 2) COLUNA NOVA EM `processos` : status_confirmacao_parceiro
-- ----------------------------------------------------------------------------
-- Só USADA quando a carta reservada NÃO é LANCE. Para essas fontes não há
-- fluxo de reserva automático fim-a-fim ainda: a reserva entra 'pendente' de
-- confirmação com o parceiro (processada manualmente pelo time — decisão de
-- hoje). Para LANCE fica NULL: comportamento intocado. SEM disparo automático
-- de notificação (decisão nominal: notificar o parceiro fica pra depois).
-- ============================================================================
alter table processos
  add column if not exists status_confirmacao_parceiro text;

alter table processos drop constraint if exists chk_proc_conf_parceiro;
alter table processos
  add constraint chk_proc_conf_parceiro
  check (
    status_confirmacao_parceiro is null
    or status_confirmacao_parceiro in ('pendente','confirmada','recusada')
  );

-- ============================================================================
-- 3) SEMEAR AS 4 FONTES NOVAS (C) — administradoras + fornecedores + config
-- ----------------------------------------------------------------------------
-- Mesmo padrão de 0011/0012: administradora pública p/ logado, fornecedor
-- SÓ ADMIN. Idempotente (só insere se não existir pelo nome). Os textos
-- (logo, site, contato do responsável, canal de lance) o admin ajusta depois
-- pelo painel — aqui vão só os mínimos factuais.
--
-- NOTA sobre nomes: `administradoras.nome` é a MARCA pública. Aqui usamos o
--   rótulo da fonte como semente; o admin renomeia para o nome comercial real
--   pelo painel se divergir. `administradora_origem` (o discriminador do sync)
--   permanece o rótulo estável, independente de renomear a marca.
-- ============================================================================

-- 3.1) administradoras (públicas p/ logado)
insert into administradoras (nome, segmentos, aceita_assuncao)
select v.nome, array['imovel','veiculo']::text[], false
from (values ('CBC'), ('PIFFER'), ('CARTAS'), ('SERVOPA')) as v(nome)
where not exists (select 1 from administradoras a where a.nome = v.nome);

-- 3.2) fornecedores (SÓ ADMIN — segredo operacional; portal fica p/ o admin
--      preencher, exceto Servopa que tem portal público conhecido)
insert into fornecedores (nome, portal_origem)
select v.nome, v.portal
from (values
  ('CBC',     null::text),
  ('PIFFER',  null::text),
  ('CARTAS',  null::text),
  ('SERVOPA', 'https://cartascontempladasservopa.com.br/')
) as v(nome, portal)
where not exists (select 1 from fornecedores f where f.nome = v.nome);

-- 3.3) sync_fonte_config: mapeia a administradora_origem -> uuids de default.
--      A PK de sync_fonte_config é `fonte` (0012). Como a fonte '360prospere'
--      já está ocupada pelo default LANCE/HS, adicionamos UMA linha por
--      administradora_origem, usando a PRÓPRIA administradora_origem como
--      chave. Assim o carimbo do INSERT resolve o uuid certo por fonte-marca.
--      (A linha '360prospere' legada continua existindo para compatibilidade,
--       mas o carimbo passa a usar administradora_origem — ver RPC abaixo.)
insert into sync_fonte_config (fonte, administradora_id, fornecedor_id)
select
  v.origem,
  (select id from administradoras where nome = v.origem),
  (select id from fornecedores   where nome = v.origem)
from (values ('CBC'), ('PIFFER'), ('CARTAS'), ('SERVOPA')) as v(origem)
on conflict (fonte) do update
  set administradora_id = excluded.administradora_id,
      fornecedor_id     = excluded.fornecedor_id,
      atualizado_em     = now();

-- 3.4) LANCE: garante uma linha de config chaveada por 'LANCE' também, apontando
--      para a administradora/fornecedor já semeados na 0012 (HS/Lance). Assim o
--      carimbo por administradora_origem funciona uniforme para TODAS as fontes.
insert into sync_fonte_config (fonte, administradora_id, fornecedor_id)
select
  'LANCE',
  (select id from administradoras where nome = 'HS Consórcios'),
  (select id from fornecedores   where nome = 'Lance Consórcio')
where exists (select 1 from administradoras where nome = 'HS Consórcios')
on conflict (fonte) do update
  set administradora_id = excluded.administradora_id,
      fornecedor_id     = excluded.fornecedor_id,
      atualizado_em     = now();

-- ============================================================================
-- 4) RECRIA `sync_aplicar_cotas` — POR-FONTE (A + B + D1)
-- ----------------------------------------------------------------------------
-- Mudanças vs. 0012 (que esta função SUBSTITUI):
--   - Recebe um 2º parâmetro `p_origem text`: a administradora_origem que ESTA
--     execução cobriu (ex.: 'SERVOPA'). A rota chama a RPC UMA VEZ POR FONTE,
--     só com as cotas daquela fonte que veio íntegra (B).
--   - Upsert casa por (administradora_origem, numero_externo) — a chave D1 —
--     em vez de só numero_externo. Isso impede que id nativo colidente entre
--     fontes sobrescreva a carta errada.
--   - A cláusula "sumiram" é escopada a `administradora_origem = p_origem`:
--     só marca 'indisponivel' as cartas DAQUELA fonte ausentes DESTA lista.
--     Falha/ausência de OUTRA fonte não toca este estoque (B).
--   - Carimba administradora_id/fornecedor_id lendo sync_fonte_config pela
--     PRÓPRIA p_origem (não mais fixo em '360prospere').
--   - Grava entrada_parceiro_raw quando vier no payload (fontes que somam 7%);
--     para LANCE o payload traz null e a coluna fica null (comportamento igual).
--   - `fonte` continua gravada como '360prospere' (A: sem migração de sentido).
--
-- Idempotente. Atômica (roda como service_role; RLS bypassa). Rodar 2x com a
-- mesma lista não duplica nem regride status.
--
-- Parâmetros:
--   p_origem : 'LANCE' | 'CBC' | 'PIFFER' | 'CARTAS' | 'SERVOPA'
--   p_cotas  : jsonb array. Cada item:
--     { "numero":123, "tipo":"imovel", "valor_credito":..., "valor_entrada":...,
--       "valor_parcela":..., "qtd_parcelas":..., "entrada_parceiro":... | null }
--     valor_entrada = entrada JÁ EXIBIDA ao cliente (com 7% nas fontes externas;
--       cru==correto na Lance). entrada_parceiro = valor cru (null p/ LANCE).
-- ============================================================================
create or replace function sync_aplicar_cotas(p_origem text, p_cotas jsonb)
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
  -- guarda de sanidade: origem tem que ser uma das marcas conhecidas
  if p_origem is null
     or p_origem not in ('LANCE','CBC','PIFFER','CARTAS','SERVOPA') then
    raise exception 'origem_invalida: %', coalesce(p_origem, '<null>')
      using errcode = 'P0001';
  end if;

  -- defaults de carimbo para ESTA fonte (uuid público + uuid admin-only).
  -- Se a config não existir, ficam null e o carimbo simplesmente não acontece.
  select administradora_id, fornecedor_id
    into v_admin_id, v_forn_id
    from sync_fonte_config where fonte = p_origem;

  -- conjunto de números presentes NESTA execução (para o "sumiu da lista"),
  -- escopado à fonte p_origem (a cláusula final compara dentro dela).
  create temporary table _presentes (numero integer primary key) on commit drop;
  insert into _presentes (numero)
    select distinct (c->>'numero')::int
    from jsonb_array_elements(p_cotas) c
    where (c->>'numero') is not null;

  -- 1) UPSERT das cotas presentes (casadas por (administradora_origem, numero))
  for r in
    select
      (c->>'numero')::int              as numero,
      (c->>'tipo')::tipo_bem            as tipo,
      (c->>'valor_credito')::numeric    as valor_credito,
      (c->>'valor_entrada')::numeric    as valor_entrada,
      (c->>'valor_parcela')::numeric    as valor_parcela,
      (c->>'qtd_parcelas')::int         as qtd_parcelas,
      nullif(c->>'entrada_parceiro','')::numeric as entrada_parceiro
    from jsonb_array_elements(p_cotas) c
  loop
    select id, valor_credito, valor_entrada, valor_parcela, qtd_parcelas,
           status, entrada_parceiro_raw
      into v_existe
      from cartas
     where administradora_origem = p_origem
       and numero_externo = r.numero;

    if not found then
      -- carta NOVA — carimba fonte '360prospere' (A), a marca-origem (D1) e os
      -- uuids default; grava entrada_parceiro_raw (null p/ LANCE).
      insert into cartas (
        tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas,
        status, numero_externo, fonte, criado_via, sincronizada_em,
        administradora_origem, administradora_id, fornecedor_id,
        entrada_parceiro_raw
      ) values (
        r.tipo, r.valor_credito, r.valor_entrada, r.valor_parcela, r.qtd_parcelas,
        'disponivel', r.numero, '360prospere', 'sync', now(),
        p_origem, v_admin_id, v_forn_id,
        r.entrada_parceiro
      )
      returning id into v_id;

      v_novas := v_novas + 1;
      insert into eventos_sync (tipo, numero_externo, carta_id, detalhe, push_pendente)
      values ('carta_nova', r.numero, v_id,
              p_origem || ' crédito ' || r.valor_credito::text, true);

    else
      -- já existe: reativa se estava indisponível, e atualiza se mudou algo.
      -- NÃO mexe em administradora_id/fornecedor_id (preserva ajuste manual).
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
          administradora_id = coalesce(administradora_id, v_admin_id),
          fornecedor_id     = coalesce(fornecedor_id,     v_forn_id)
        where administradora_origem = p_origem
          and numero_externo = r.numero;

        v_atu := v_atu + 1;
        insert into eventos_sync (tipo, numero_externo, carta_id, detalhe)
        values ('carta_atualizada', r.numero, v_existe.id, p_origem || ' valores/sync');
      else
        -- sem mudança de valores: toca o carimbo e completa uuids se faltarem
        update cartas set
          sincronizada_em = now(),
          administradora_id = coalesce(administradora_id, v_admin_id),
          fornecedor_id     = coalesce(fornecedor_id,     v_forn_id)
        where administradora_origem = p_origem
          and numero_externo = r.numero;
      end if;
    end if;
  end loop;

  -- 2) SUMIRAM da fonte p_origem: cartas DESTA fonte, ainda 'disponivel', que
  --    não vieram nesta lista => 'indisponivel'. ESCOPADO a p_origem (B):
  --    ausência/falha de outra fonte NUNCA entra aqui.
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
$$;

-- A assinatura antiga sync_aplicar_cotas(jsonb) fica órfã (a rota nova chama a
-- de 2 args). Removida para não haver duas versões conflitantes no schema.
drop function if exists sync_aplicar_cotas(jsonb);

-- ============================================================================
-- 5) RECRIA `reservar_carta` — confirmação de parceiro quando fonte != LANCE
-- ----------------------------------------------------------------------------
-- IDÊNTICA à 0009 em TODAS as travas (auth, KYC, lock FOR UPDATE, idempotência)
-- e no que copia para `processos`. ÚNICA diferença: após criar o processo, se a
-- carta NÃO for LANCE, seta processos.status_confirmacao_parceiro = 'pendente'
-- (marca de estado; SEM disparo automático — decisão nominal). Para LANCE o
-- campo fica NULL: comportamento 100% intocado (provado por fixture).
-- ============================================================================
create or replace function public.reservar_carta(p_carta_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_kyc        kyc_status;
  v_carta      cartas%rowtype;
  v_processo   uuid;
  v_existente  uuid;
  v_conf       text;
begin
  -- 1) autenticação
  if v_uid is null then
    raise exception 'nao_autenticado' using errcode = '42501';
  end if;

  -- 2) gate de KYC: só cliente verificado reserva
  select status_kyc into v_kyc from kyc_perfis where user_id = v_uid;
  if v_kyc is distinct from 'verificado' then
    raise exception 'kyc_nao_verificado' using errcode = 'P0001';
  end if;

  -- 3) carta tem que existir e estar disponível (lock evita reserva dupla)
  select * into v_carta
    from cartas
   where id = p_carta_id
   for update;

  if not found then
    raise exception 'carta_inexistente' using errcode = 'P0002';
  end if;

  if v_carta.status <> 'disponivel' then
    raise exception 'carta_indisponivel' using errcode = 'P0001';
  end if;

  -- 4) evita processo ativo duplicado do mesmo cliente para a mesma carta
  select id into v_existente
    from processos
   where cliente_id = v_uid
     and carta_id   = p_carta_id
     and status <> 'cancelado'
   limit 1;
  if v_existente is not null then
    return v_existente;  -- idempotente
  end if;

  -- confirmação de parceiro: 'pendente' só quando a fonte-marca NÃO é LANCE.
  -- LANCE (ou carta sem origem, ex.: manual) => NULL, comportamento intocado.
  v_conf := case
              when v_carta.administradora_origem is not null
                   and v_carta.administradora_origem <> 'LANCE'
              then 'pendente'
              else null
            end;

  -- ----- escrita atômica -----------------------------------------------------
  insert into processos (cliente_id, parceiro_id, carta_id, status,
                         valor_carta, valor_entrada, status_confirmacao_parceiro)
  values (v_uid, v_carta.parceiro_id, p_carta_id, 'reservada',
          v_carta.valor_credito, v_carta.valor_entrada, v_conf)
  returning id into v_processo;

  update cartas set status = 'reservada' where id = p_carta_id;

  insert into processo_eventos (processo_id, de_status, para_status, nota)
  values (v_processo, null, 'reservada',
          case when v_conf = 'pendente'
               then 'Reserva iniciada pelo cliente. Confirmação com parceiro pendente.'
               else 'Reserva iniciada pelo cliente.' end);

  return v_processo;
end;
$$;

revoke all on function public.reservar_carta(uuid) from public;
grant execute on function public.reservar_carta(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Verificação rápida (opcional, após aplicar, no DEV):
--   -- índice novo existe, o antigo não:
--   select indexname from pg_indexes where tablename='cartas'
--     and indexname in ('uniq_cartas_origem_numero','uniq_cartas_numero_externo');
--   -- as 4 fontes semeadas:
--   select nome from administradoras where nome in ('CBC','PIFFER','CARTAS','SERVOPA');
--   -- reserva Lance NÃO seta confirmação; reserva não-Lance seta 'pendente'
--   --   (validado por fixture antes do commit).
-- ----------------------------------------------------------------------------
