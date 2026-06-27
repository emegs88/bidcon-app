-- ============================================================================
-- Bidcon — plataforma logada · Migration 0001 · Schema base (Fase 0)
-- ----------------------------------------------------------------------------
-- Rascunho para revisão. NÃO foi aplicado em nenhum projeto Supabase.
-- Decisões desta rodada (ver docs/plataforma-arquitetura.md):
--   - RLS estrito em TODAS as tabelas (migration 0002).
--   - SEM dado bancário: a plataforma só rastreia status de comissão.
--   - Mudança de status de processo/comissão = server-side (service_role).
-- ============================================================================

-- ----- ENUMS -----------------------------------------------------------------
create type tipo_perfil     as enum ('cliente','parceiro','admin');
create type status_perfil   as enum ('ativo','pendente_aprovacao','suspenso');
create type status_processo as enum
  ('reservada','documentacao','analise_administradora','transferencia','concluido','cancelado');
create type tipo_bem        as enum ('imovel','veiculo');
create type status_carta    as enum ('disponivel','reservada','vendida');
create type status_comissao as enum ('prevista','liberada','paga','cancelada');

-- ----- PROFILES (1:1 com auth.users) ----------------------------------------
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nome       text,
  telefone   text,
  email      text,
  tipo       tipo_perfil   not null default 'cliente',
  -- parceiro nasce 'pendente_aprovacao' (set via trigger/servidor no cadastro)
  status     status_perfil not null default 'ativo',
  criado_em  timestamptz   not null default now()
);

-- ----- CARTAS (carteira do parceiro; estoque Bidcon quando parceiro_id null) -
create table cartas (
  id            uuid primary key default gen_random_uuid(),
  parceiro_id   uuid references profiles(id) on delete set null,
  tipo          tipo_bem      not null,
  valor_credito numeric(14,2) not null,
  valor_entrada numeric(14,2),
  status        status_carta  not null default 'disponivel',
  criado_em     timestamptz   not null default now()
);

-- ----- PROCESSOS (jornada de compra do cliente) -----------------------------
create table processos (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references profiles(id) on delete restrict,
  parceiro_id   uuid references profiles(id) on delete set null,  -- quem indicou/vendeu
  carta_id      uuid references cartas(id)   on delete set null,
  status        status_processo not null default 'reservada',
  valor_carta   numeric(14,2),
  valor_entrada numeric(14,2),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- ----- INDICACOES (rastreio de quem indicou) --------------------------------
create table indicacoes (
  id          uuid primary key default gen_random_uuid(),
  parceiro_id uuid not null references profiles(id) on delete cascade,
  cliente_id  uuid references profiles(id) on delete set null,
  origem      text,  -- link/código de indicação
  criado_em   timestamptz not null default now()
);

-- ----- COMISSOES (SEM dado bancário — plataforma só rastreia) ----------------
create table comissoes (
  id             uuid primary key default gen_random_uuid(),
  parceiro_id    uuid not null references profiles(id)  on delete restrict,
  processo_id    uuid not null references processos(id) on delete cascade,
  percentual     numeric(5,2),
  valor_base     numeric(14,2),
  valor_comissao numeric(14,2),
  status         status_comissao not null default 'prevista',
  liberada_em    timestamptz   -- preenchido quando o processo conclui (server-side)
);

-- ----- índices úteis ---------------------------------------------------------
create index idx_cartas_parceiro     on cartas(parceiro_id);
create index idx_processos_cliente   on processos(cliente_id);
create index idx_processos_parceiro  on processos(parceiro_id);
create index idx_indicacoes_parceiro on indicacoes(parceiro_id);
create index idx_comissoes_parceiro  on comissoes(parceiro_id);
create index idx_comissoes_processo  on comissoes(processo_id);

-- NOTA: a transição prevista→liberada (gatilho em processos.status='concluido')
-- fica para a Fase 3 — depende dos números de comissão (Emerson). Ver §7 do doc.
