// ============================================================================
// Equipe Prospere — gate de acesso ao simulador interno "PROSPERE byAncora".
// ----------------------------------------------------------------------------
// O simulador da Âncora é uso EXCLUSIVO da equipe, não do cliente/parceiro. O
// critério é o DOMÍNIO do e-mail corporativo (@prospere.com.br). Esta é a camada
// de aplicação (Next); a camada real de sigilo é a RLS da migration 0013, que
// repete o mesmo predicado no banco. Defesa em profundidade: as duas precisam
// concordar, e a RLS sozinha já barra a leitura na origem.
// ============================================================================

const DOMINIO_EQUIPE = "@prospere.com.br";

/**
 * True somente para e-mails corporativos da Prospere. Case-insensitive, tolera
 * null/undefined (retorna false). Não confia em nada além do e-mail confirmado
 * da sessão — quem chama deve passar o e-mail vindo de supabase.auth.getUser().
 */
export function ehEquipeProspere(email: string | null | undefined): boolean {
  if (typeof email !== "string") return false;
  return email.trim().toLowerCase().endsWith(DOMINIO_EQUIPE);
}
