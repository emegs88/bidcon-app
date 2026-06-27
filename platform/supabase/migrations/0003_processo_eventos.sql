-- ============================================================================
-- Bidcon — plataforma logada · Migration 0003 · Histórico de processo (Fase 1)
-- ----------------------------------------------------------------------------
-- Rascunho para revisão. Tabela de eventos da timeline do processo.
-- Decisões (docs/plataforma-fase1-plano.md §4, opção B):
--   - Cliente faz SELECT-only dos eventos dos PRÓPRIOS processos (via RLS).
--   - INSERT é server-side (admin muda status na Fase 2) — sem policy de insert
--     para o client. service_role bypassa RLS por padrão no Supabase.
-- ============================================================================

create table processo_eventos (
  id          uuid primary key default gen_random_uuid(),
  processo_id uuid not null references processos(id) on delete cascade,
  de_status   status_processo,                 -- null no evento de criação
  para_status status_processo not null,
  nota        text,                            -- observação opcional (sem dado sensível)
  em          timestamptz not null default now()
);

create index idx_processo_eventos_processo on processo_eventos(processo_id);
create index idx_processo_eventos_em        on processo_eventos(em);

-- ----- RLS -------------------------------------------------------------------
alter table processo_eventos enable row level security;

-- helper is_admin() já existe (migration 0002).

-- Cliente/parceiro envolvidos no processo veem os eventos; admin vê tudo.
-- O filtro espelha a policy de SELECT de `processos`.
create policy processo_eventos_select_envolvidos on processo_eventos
  for select using (
    exists (
      select 1 from processos p
      where p.id = processo_eventos.processo_id
        and (p.cliente_id = auth.uid() or p.parceiro_id = auth.uid())
    )
    or is_admin()
  );

-- Admin pode tudo (na prática, escrita também ocorre server-side via service_role).
create policy processo_eventos_admin_all on processo_eventos
  for all using (is_admin()) with check (is_admin());

-- NOTA: não há policy de INSERT/UPDATE para cliente/parceiro — a timeline só é
-- escrita pelo servidor quando o status muda (Fase 2). O cliente nunca edita.
