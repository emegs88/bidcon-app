-- ============================================================================
-- Migration 0051 · FATIA SYNC-ID (parte 2) — vitrine pública de /cartas/[id]
-- ----------------------------------------------------------------------------
-- Projeto: xtv (xtvjpnyadcdeadhmzyff). Aplicada com AUTORIZO em 16/07/2026.
--
-- NOTA DE NUMERAÇÃO: aplicada via MCP originalmente como "0048_cartas_vitrine_
-- publica" (nome no histórico de migrations do projeto — imutável, tracking
-- por timestamp). "0047"/"0048" já estavam ocupados em produção por outras
-- duas migrations sem arquivo local (ver nota em 0050_sync_identidade_
-- estavel.sql). Arquivo local renomeado pra 0051 (próximo número livre);
-- conteúdo abaixo é exatamente o que foi aplicado.
--
-- A migration 0005 (cartas_vitrine_select) deixou explícito, por decisão da
-- época: "Anônimos (role anon) continuam sem acesso — a vitrine é da área
-- logada." Esta migration REVERTE essa decisão, escopada ao mínimo: SELECT
-- anônimo, só de cartas 'disponivel' — a mesma condição já válida para
-- authenticated, apenas estendida ao anon.
--
-- Motivo: o botão "Ver carta" do carrossel de marketing do WhatsApp e o gap
-- chat→cadastro (auditoria 2026-07) levam a /cartas/[id] antes do login —
-- hoje isso bate um redirect pra /login e perde a pessoa. Nenhum dado além
-- do que a vitrine logada já mostra é exposto (mesmas colunas, mesmo filtro
-- de status). A ação de reservar continua exigindo login (/reservar mantém
-- seu próprio redirect) — só a VISUALIZAÇÃO da carta fica pública.
--
-- NOTA (achado ao aplicar): a policy `cartas_vitrine_select_anon` já existia
-- em produção (xtv), idêntica à definição abaixo, aplicada em algum momento
-- anterior sem migration local correspondente — mesmo padrão de "aplicada
-- via MCP/janela, sem arquivo" já visto em outras partes do histórico deste
-- repo. Ou seja: a RLS NUNCA foi de fato o bloqueio para a vitrine pública —
-- só o `redirect("/login")` em app/cartas/[id]/page.tsx é. Este arquivo fica
-- só para que o histórico de migrations passe a refletir o estado real do
-- banco (idempotente: drop+create, seguro pra rodar de novo ou numa branch
-- nova que ainda não tenha essa policy).
-- ============================================================================

drop policy if exists cartas_vitrine_select_anon on cartas;
create policy cartas_vitrine_select_anon on cartas
  for select
  to anon
  using (status = 'disponivel');

-- ----------------------------------------------------------------------------
-- Verificação rápida (opcional, após aplicar):
--   set role anon;
--   select id, tipo, valor_credito from cartas where status = 'disponivel';
-- Esperado: retorna o estoque disponível, igual ao que authenticated já via.
-- ----------------------------------------------------------------------------
