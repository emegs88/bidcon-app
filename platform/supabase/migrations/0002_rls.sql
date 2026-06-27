-- ============================================================================
-- Bidcon — plataforma logada · Migration 0002 · RLS (Fase 0)
-- ----------------------------------------------------------------------------
-- Rascunho para revisão. Implementa a matriz §4 de docs/plataforma-arquitetura.md.
-- Princípios:
--   - RLS habilitada em TODAS as tabelas.
--   - Parceiro NUNCA dá UPDATE em comissoes (evita auto-liberação) — só SELECT.
--   - Mudança de status (processos/comissoes) é feita server-side com service_role,
--     que bypassa RLS por padrão no Supabase; por isso aqui não há policy de UPDATE
--     liberando isso para o client.
-- ============================================================================

-- ----- helper: is_admin() (security definer p/ evitar recursão em policies) --
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.tipo = 'admin'
  );
$$;

-- ----- habilita RLS ----------------------------------------------------------
alter table profiles   enable row level security;
alter table cartas     enable row level security;
alter table processos  enable row level security;
alter table indicacoes enable row level security;
alter table comissoes  enable row level security;

-- ----- PROFILES --------------------------------------------------------------
-- cada um vê/edita apenas o próprio; admin tudo.
create policy profiles_select_self on profiles
  for select using (id = auth.uid() or is_admin());
create policy profiles_update_self on profiles
  for update using (id = auth.uid() or is_admin())
             with check (id = auth.uid() or is_admin());
-- INSERT do profile é feito server-side (no fluxo de cadastro). Admin pode tudo:
create policy profiles_admin_all on profiles
  for all using (is_admin()) with check (is_admin());

-- ----- CARTAS ----------------------------------------------------------------
-- parceiro CRUD nas próprias; cliente não vê; admin tudo.
create policy cartas_parceiro_select on cartas
  for select using (parceiro_id = auth.uid() or is_admin());
create policy cartas_parceiro_insert on cartas
  for insert with check (parceiro_id = auth.uid() or is_admin());
create policy cartas_parceiro_update on cartas
  for update using (parceiro_id = auth.uid() or is_admin())
             with check (parceiro_id = auth.uid() or is_admin());
create policy cartas_admin_delete on cartas
  for delete using (is_admin());

-- ----- PROCESSOS -------------------------------------------------------------
-- cliente vê os próprios; parceiro vê os que vendeu/indicou; admin tudo.
-- UPDATE de status = server-side (service_role) — sem policy de update p/ client.
create policy processos_select_envolvidos on processos
  for select using (
    cliente_id  = auth.uid()
    or parceiro_id = auth.uid()
    or is_admin()
  );
create policy processos_admin_all on processos
  for all using (is_admin()) with check (is_admin());

-- ----- INDICACOES ------------------------------------------------------------
-- parceiro vê as próprias; cliente não; admin tudo.
create policy indicacoes_parceiro_select on indicacoes
  for select using (parceiro_id = auth.uid() or is_admin());
create policy indicacoes_admin_all on indicacoes
  for all using (is_admin()) with check (is_admin());

-- ----- COMISSOES -------------------------------------------------------------
-- parceiro SELECT-only nas próprias; sem INSERT/UPDATE/DELETE p/ parceiro.
-- liberar/marcar paga = admin (ou server-side service_role).
create policy comissoes_parceiro_select on comissoes
  for select using (parceiro_id = auth.uid() or is_admin());
create policy comissoes_admin_all on comissoes
  for all using (is_admin()) with check (is_admin());

-- ============================================================================
-- Resumo da matriz aplicada:
--   profiles   : self SELECT/UPDATE            | admin: all
--   cartas     : parceiro SELECT/INSERT/UPDATE | admin: all (+delete)
--   processos  : cliente/parceiro SELECT       | admin: all (status server-side)
--   indicacoes : parceiro SELECT               | admin: all
--   comissoes  : parceiro SELECT-only          | admin: all (libera/paga)
-- ============================================================================
