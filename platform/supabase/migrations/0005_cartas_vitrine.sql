-- ============================================================================
-- Bidcon — plataforma logada · Migration 0005 · Vitrine de cartas
-- ----------------------------------------------------------------------------
-- Problema: a policy cartas_parceiro_select (migration 0002) limita o SELECT a
--   parceiro_id = auth.uid() or is_admin(). O estoque Bidcon tem parceiro_id NULL,
--   então um CLIENTE comum não enxerga as cartas para montar a vitrine logada.
--
-- Solução: policy ADITIVA de leitura. No Postgres, múltiplas policies PERMISSIVE
--   de SELECT são combinadas por OR — esta apenas AMPLIA a leitura para cartas
--   'disponivel', sem afetar/afrouxar as policies de parceiro/admin existentes.
--
-- Escopo: somente SELECT, somente status='disponivel', somente authenticated.
--   Nenhum INSERT/UPDATE/DELETE é concedido aqui. Anônimos (role anon) continuam
--   sem acesso — a vitrine é da área logada.
--
-- Rodar no Supabase de PRODUÇÃO (SQL editor) — aplicado pelo Emerson.
-- ============================================================================

create policy cartas_vitrine_select on cartas
  for select
  to authenticated
  using (status = 'disponivel');

-- ----------------------------------------------------------------------------
-- Verificação rápida (opcional, após aplicar):
--   set role authenticated;  -- ou logar como um cliente comum
--   select id, tipo, valor_credito from cartas where status = 'disponivel';
-- Esperado: retorna o estoque disponível (parceiro_id NULL inclusive).
-- ----------------------------------------------------------------------------
