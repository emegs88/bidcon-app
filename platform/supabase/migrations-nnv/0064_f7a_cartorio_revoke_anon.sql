-- ============================================================================
-- Bidcon Reserve — F7a: fecha gap de anon EXECUTE em reserva_atualizar_cartorio.
-- ----------------------------------------------------------------------------
-- Advisor de segurança (get_advisors) pós-0063 mostrou reserva_atualizar_cartorio
-- em anon_security_definer_function_executable — diferente de todas as RPCs
-- irmãs de reservas (reserva_transicionar, reserva_criar, reserva_add_condition,
-- reserva_add_leg, reserva_marcar_condition, reserva_marcar_leg, verify_chain),
-- que aparecem só em authenticated_security_definer_function_executable.
-- Confirmado por query direta (Emerson): cartorio é a única com anon EXECUTE;
-- public já estava limpo (revoke ... from public da 0063).
--
-- Não altera nada além do grant. Nenhum DROP/CREATE OR REPLACE de função,
-- nenhuma mudança de assinatura, nenhum DROP TABLE/COLUMN/DELETE/TRUNCATE.
--
-- FORA DESTA FATIA (não tocado): checklist_do_processo, verify_chain,
-- buscar_cartas_semantica, handle_new_user — anon-executable pré-existentes,
-- escopo separado.
--
-- APLICADA EM PRODUÇÃO (nnv) em 22/07/2026.
--
-- Numeração saltou 0022 → 0063/0064 por engano (derivada da pasta do xtv).
-- Mantida idêntica ao name no histórico aplicado do nnv. Ordenação real = timestamp
-- version (Supabase); o gap é só cosmético. PRÓXIMA migration nnv = 0065 (monotônico).
-- ============================================================================

begin;

revoke all on function public.reserva_atualizar_cartorio(uuid, text, text, text) from anon;

commit;

-- FIM 0064 · Revoke pontual de anon. Nenhuma RPC/tabela removida ou alterada.
