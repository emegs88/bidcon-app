-- ============================================================================
-- Bidcon — plataforma logada · Migration 0026 · CPF no profile (qualificação
-- do contrato)
-- ----------------------------------------------------------------------------
-- O contrato de serviço (lib/contratos.ts) precisa qualificar o CONTRATANTE
-- por completo (nome + CPF + e-mail) ANTES do aceite, independente do fluxo
-- de KYC (kyc_perfis), que segue verificando documento/selfie separadamente
-- e não é pré-requisito do contrato. Esta coluna guarda o CPF informado pelo
-- próprio cliente na tela de aceite (validado por dígito verificador no
-- servidor — lib/kyc.ts:cpfValido — antes de gravar).
-- Nullable/sem unique: não quebra linhas existentes; RLS de update já cobre
-- (profiles_update_self, migration 0002).
-- ============================================================================

alter table profiles add column if not exists cpf text;
