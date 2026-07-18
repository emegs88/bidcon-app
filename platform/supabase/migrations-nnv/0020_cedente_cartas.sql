-- 0020_cedente_cartas.sql — projeto nnv (app logado/auth).
-- CEDENTE-01: ponte entre auth/portal (nnv) e o catálogo de cartas (xtv).
--
-- A carta em si mora no xtv (tabela cartas, sincronizada pelo motor de sync +
-- capturas cliente_direto/manual). O portal logado (auth, profiles, sessão)
-- mora no nnv. Não há FK entre projetos Supabase distintos, então esta tabela
-- guarda só o vínculo (profile_id do nnv -> carta_xtv_id, um uuid solto, sem
-- FK) — a página /minha-carta resolve os dados da carta em runtime, no
-- servidor, via createXtvClient() (service_role, nunca exposto ao client).
--
-- Sem policy de insert/update/delete pra authenticated: o vínculo só é criado
-- por admin/service (hoje, manualmente, via AUTORIZO explícito — não existe
-- fluxo de auto-cadastro de cedente nesta fatia).
--
-- `drop policy if exists`/`create table if not exists` só por idempotência
-- (permite reaplicar este arquivo sem erro se já rodou uma vez).

create table if not exists public.cedente_cartas (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id),
  carta_xtv_id uuid not null,
  criado_em timestamptz not null default now(),
  unique (profile_id, carta_xtv_id)
);

comment on table public.cedente_cartas is
  'CEDENTE-01: vínculo entre um profile (nnv) e uma carta (xtv, carta_xtv_id sem FK — projetos distintos). Alimenta /minha-carta. Escrita só admin/service.';

alter table public.cedente_cartas enable row level security;

drop policy if exists cedente_cartas_select_own on public.cedente_cartas;

create policy cedente_cartas_select_own
  on public.cedente_cartas
  for select
  to authenticated
  using (
    profile_id = auth.uid()
    or public.is_admin()
  );

comment on policy cedente_cartas_select_own on public.cedente_cartas is
  'CEDENTE-01: cedente vê o próprio vínculo (profile_id = auth.uid()); admin vê todos. Sem policy de insert/update/delete pra authenticated — gestão só admin/service.';
