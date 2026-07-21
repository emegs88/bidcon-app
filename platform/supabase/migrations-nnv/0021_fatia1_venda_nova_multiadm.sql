-- 0021_fatia1_venda_nova_multiadm.sql — projeto nnv (app logado/auth).
-- JÁ APLICADA em produção (nnv) em 20/07/2026 via MCP — arquivo de registro,
-- NÃO reaplicar. Reconstruído por introspecção do schema real (pg_policies,
-- pg_constraint, pg_indexes, information_schema.triggers) porque o texto
-- original do pedido (Apêndice A) não estava disponível no momento em que
-- este arquivo de registro foi escrito — o SQL abaixo é fiel ao que existe
-- de fato no banco, não uma reconstrução aproximada.
--
-- FATIA 1 (venda nova): segundo motor de vendas do Time Prosperito — planos
-- novos Disal (consórcio não contemplado), multiadministradora por parâmetro
-- (administradora nunca é identidade de agente; Disal é a primeira, Porto
-- vem depois). Três tabelas novas + extensão de `comissoes` pra distinguir
-- comissão de cessão (repasse, xtv) de comissão de venda nova (aqui).
--
-- `if not exists`/`drop policy if exists` só por idempotência (permite
-- reaplicar este arquivo sem erro se, por algum motivo, rodar de novo).

-- ---------------------------------------------------------------------------
-- grupos_planos — catálogo de grupos/planos por administradora e segmento.
-- ---------------------------------------------------------------------------
create table if not exists public.grupos_planos (
  id uuid primary key default gen_random_uuid(),
  administradora_id uuid not null references public.administradoras(id),
  codigo text not null,
  segmento text not null check (segmento in ('imovel', 'veiculo')),
  faixa text,
  prazo_meses integer not null,
  taxa_adm numeric not null,
  indice text not null,
  dia_vencimento integer check (dia_vencimento >= 1 and dia_vencimento <= 31),
  -- bom_calendario: heurística de cobrança (vencimento até dia 20 facilita
  -- conciliação/fluxo) — coluna gerada, nunca escrita diretamente.
  bom_calendario boolean generated always as (dia_vencimento <= 20) stored,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (administradora_id, codigo)
);

create index if not exists grupos_planos_adm_idx
  on public.grupos_planos (administradora_id);

comment on table public.grupos_planos is
  'FATIA 1 (venda nova): catálogo de grupos/planos por administradora+segmento. Multiadministradora desde o início (Disal é a primeira linha real).';

alter table public.grupos_planos enable row level security;

drop policy if exists grupos_planos_admin_read on public.grupos_planos;

create policy grupos_planos_admin_read
  on public.grupos_planos
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.tipo = 'admin'::tipo_perfil
    )
  );

comment on policy grupos_planos_admin_read on public.grupos_planos is
  'FATIA 1: leitura só admin via profiles.tipo. Escrita/uso operacional é via service_role (createAdminClient(), tools buscar_planos/salvar_lead) — sem policy de insert/update/delete pra authenticated.';

-- ---------------------------------------------------------------------------
-- vendas_novas — funil de venda nova (LEAD → ... → ATIVA/CANCELADA).
-- ---------------------------------------------------------------------------
create table if not exists public.vendas_novas (
  id uuid primary key default gen_random_uuid(),
  lead_origem text,
  utm jsonb,
  nome text not null,
  whatsapp text not null,
  email text,
  cpf text,
  pais_residencia text not null default 'BR',
  administradora_id uuid references public.administradoras(id),
  grupo_id uuid references public.grupos_planos(id),
  cod_bem text,
  credito numeric,
  base text check (base in ('100', '75')),
  status text not null default 'LEAD' check (
    status in (
      'LEAD', 'QUALIFICADO', 'PROPOSTA', 'PIX_ENVIADO',
      'PAGO_1A', 'DOC_VALIDADA', 'ATIVA', 'CANCELADA'
    )
  ),
  doc_ok boolean not null default false,
  validado_por uuid references public.profiles(id),
  conversa_ref text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists vendas_novas_status_idx
  on public.vendas_novas (status);

create index if not exists vendas_novas_whatsapp_idx
  on public.vendas_novas (whatsapp);

comment on table public.vendas_novas is
  'FATIA 1 (venda nova): funil de venda de plano novo (não contemplado), separado do funil de cessão (interesses/reservas, xtv). Telefone (whatsapp) sempre vem de ctx confiável no agente, nunca de texto livre do modelo.';

-- Trigger de atualizado_em: reaproveita a function tg_set_atualizado_em()
-- já existente no projeto (mesmo padrão usado por outras tabelas do nnv).
drop trigger if exists vendas_novas_touch on public.vendas_novas;

create trigger vendas_novas_touch
  before update on public.vendas_novas
  for each row
  execute function public.tg_set_atualizado_em();

alter table public.vendas_novas enable row level security;

drop policy if exists vendas_novas_admin_read on public.vendas_novas;

create policy vendas_novas_admin_read
  on public.vendas_novas
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.tipo = 'admin'::tipo_perfil
    )
  );

comment on policy vendas_novas_admin_read on public.vendas_novas is
  'FATIA 1: leitura só admin via profiles.tipo (mesmo padrão de grupos_planos). Escrita é via service_role (tools salvar_lead/status_venda) — sem policy de insert/update/delete pra authenticated.';

-- ---------------------------------------------------------------------------
-- parcelas_clientes — régua de cobrança por venda.
-- ---------------------------------------------------------------------------
create table if not exists public.parcelas_clientes (
  id uuid primary key default gen_random_uuid(),
  venda_id uuid not null references public.vendas_novas(id) on delete cascade,
  numero integer not null,
  vencimento date not null,
  pago_em date,
  valor numeric,
  unique (venda_id, numero)
);

-- Índice parcial: só as parcelas ainda em aberto interessam pra régua de
-- cobrança (pago_em is null) — evita variar o custo de index scan com o
-- histórico acumulado de parcelas já pagas.
create index if not exists parcelas_clientes_regua_idx
  on public.parcelas_clientes (vencimento)
  where pago_em is null;

comment on table public.parcelas_clientes is
  'FATIA 1 (venda nova): régua de parcelas por venda (vendas_novas), pra cobrança/acompanhamento. Índice parcial cobre só parcelas em aberto.';

alter table public.parcelas_clientes enable row level security;

drop policy if exists parcelas_clientes_admin_read on public.parcelas_clientes;

create policy parcelas_clientes_admin_read
  on public.parcelas_clientes
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.tipo = 'admin'::tipo_perfil
    )
  );

comment on policy parcelas_clientes_admin_read on public.parcelas_clientes is
  'FATIA 1: leitura só admin via profiles.tipo. Escrita via service_role — sem policy de insert/update/delete pra authenticated.';

-- ---------------------------------------------------------------------------
-- comissoes — extensão pra distinguir cessão (repasse) de venda nova.
-- ---------------------------------------------------------------------------
alter table public.comissoes
  add column if not exists origem text not null default 'CESSAO'
    check (origem in ('CESSAO', 'VENDA_NOVA')),
  add column if not exists venda_id uuid references public.vendas_novas(id),
  add column if not exists parcela_ref integer,
  add column if not exists semana_nf date,
  add column if not exists status_pg text not null default 'PREVISTA'
    check (status_pg in ('PREVISTA', 'APURADA', 'NF_EMITIDA', 'PAGA', 'ESTORNADA'));

comment on column public.comissoes.origem is
  'FATIA 1: CESSAO (repasse de carta contemplada, fluxo pré-existente) ou VENDA_NOVA (plano novo Disal/multiadm). Default CESSAO preserva o comportamento de todas as linhas já existentes.';

comment on column public.comissoes.venda_id is
  'FATIA 1: vínculo com vendas_novas quando origem = VENDA_NOVA. Nulo pra comissões de cessão.';

comment on column public.comissoes.status_pg is
  'FATIA 1: ciclo de pagamento da comissão (PREVISTA→APURADA→NF_EMITIDA→PAGA, ou ESTORNADA). Default PREVISTA.';

-- ---------------------------------------------------------------------------
-- Seed de administradoras — Disal é a primeira administradora real da venda
-- nova (as demais linhas pré-existentes vêm do catálogo de cessão/repasse).
-- ---------------------------------------------------------------------------
insert into public.administradoras (nome, site_oficial, segmentos)
select 'Disal', 'https://www.disalconsorcio.com.br', array['imovel', 'veiculo']
where not exists (
  select 1 from public.administradoras where nome = 'Disal'
);
