-- 0058_whatsapp_debounce_lock — projeto xtv (xtvjpnyadcdeadhmzyff).
-- FATIA EXTRATO-01-FIX + DEBOUNCE. AUTORIZO pré-registrado pelo Emerson
-- nesta sessão para esta migration pequena e específica (coluna de lock
-- de debounce em wa_conversas) — aplicada junto com o resto da fatia.
--
-- respondendo_desde: timestamp de quando o webhook começou a gerar uma
-- resposta do agente (Time Prosperito) para esta conversa — usado como
-- lock via UPDATE...WHERE atômico (ver app/api/whatsapp/route.ts) pra
-- impedir duas gerações simultâneas na mesma conversa quando o cliente
-- manda uma rajada de mensagens rápidas. NULL = ninguém gerando agora.
-- Setado no início da geração, limpo (NULL) no fim (sucesso ou falha) —
-- ver bloco try/finally no webhook. Não tem relação com RLS/policy —
-- é só um campo de coordenação de aplicação, mesmo padrão de zero
-- policies das outras colunas/tabelas do xtv (RLS ligado, acesso só via
-- service_role).
alter table public.wa_conversas
  add column if not exists respondendo_desde timestamptz;
