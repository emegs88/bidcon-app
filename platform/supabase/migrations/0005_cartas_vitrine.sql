-- ============================================================================
-- Bidcon — plataforma logada · Migration 0005 · Vitrine de cartas
-- BANCO ALVO: xtv E nnv — APLICADA NOS DOIS. Medido em 17/08/2026: a policy
--   `cartas_vitrine_select` existe nos DOIS bancos (1/1 em cada). NÃO mover, e
--   NÃO pular numa reprodução do xtv: pular deixaria o cliente comum sem
--   enxergar o estoque Bidcon (parceiro_id NULL) — exatamente o problema que
--   este arquivo conserta.
--   O cabeçalho abaixo ("Rodar no Supabase de PRODUÇÃO — aplicado pelo
--   Emerson") CONFERE com o medido; é o único dos 17 cujo texto de status já
--   estava certo.
--   Aviso de reprodução: `create policy` não tem guard (o Postgres não oferece
--   `if not exists` para policy). Reproduzir contra banco vivo aborta aqui.
--   Ver ident01/LEDGER-RECONCILIACAO-01_xtv.md, BLOCO 8.
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
