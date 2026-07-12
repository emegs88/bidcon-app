-- 0045_sync_fonte_config_ativo — aplicada via MCP (janela de chat) em
-- 12/07/2026 12:10:02 UTC; espelho documental; NÃO reexecutar.
alter table public.sync_fonte_config
  add column ativo boolean not null default true;

update public.sync_fonte_config
   set ativo = false
 where fonte = 'SERVOPA';
