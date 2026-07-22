-- ============================================================================
-- Bidcon Reserve — hardening: fecha anon EXECUTE em checklist_do_processo e
-- verify_chain.
-- ----------------------------------------------------------------------------
-- Achado real (Emerson): o gate de checklist_do_processo falha ABERTO pra
-- anon — auth.uid() vem NULL, a condição de comparação vira NULL, o IF não
-- dispara, e um anon com o uuid de um processo consegue ler o checklist +
-- status + motivo dos documentos. verify_chain não tem gate nenhum (vaza só
-- ok/quebrou_em — severidade baixa, mas superfície desnecessária pro anon).
--
-- Não altera nada além do grant. Nenhum DROP/CREATE OR REPLACE de função,
-- nenhuma mudança de assinatura, nenhum DROP TABLE/COLUMN/DELETE/TRUNCATE.
--
-- FORA DESTA FATIA (não tocado):
-- - buscar_cartas_semantica: confirmar quem chama antes de mexer (vitrine de
--   produção roda no xtv; a cópia do nnv pode ser legado das migrations
--   0004-0007 — se for, também perde o anon depois, em fatia própria);
-- - handle_new_user: trigger, inócuo, fica;
-- - 0066 opcional (não incluído aqui): predicado NULL-safe no checklist
--   (coalesce(v_cliente = auth.uid(), false)) — o revoke já fecha o vetor;
--   o patch seria só proteção contra re-grant futuro.
--
-- Primeira aplicação real da Regra 2 do CLAUDE.md (pasta/numeração sempre do
-- projeto-alvo): confirmado via list_migrations (nnv) que o próximo número é
-- 0065 antes de criar este arquivo.
-- ============================================================================

begin;

revoke all on function public.checklist_do_processo(uuid) from anon;
revoke all on function public.verify_chain(uuid) from anon;

commit;

-- FIM 0065 · Revoke pontual de anon em 2 RPCs. Nenhuma RPC/tabela removida ou alterada.
