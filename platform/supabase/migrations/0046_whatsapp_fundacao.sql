-- 0046_whatsapp_fundacao — projeto xtv (xtvjpnyadcdeadhmzyff). F1 (Fundação)
-- da fatia WHATSAPP-01 (ver docs/WHATSAPP-01-SPEC.md). Aguarda AUTORIZO —
-- NÃO aplicar em produção sem a palavra explícita do Emerson.
--
-- Correção de arquitetura (2026-07-12): a spec original apontava estas
-- tabelas pro projeto "nnv" (nnvjeijsrwpzsggwqpcu). Investigação read-only
-- (list_tables via MCP) mostrou que nnv é uma cópia vazia do schema
-- (cartas=1, eventos_sync=0, sem interesses/conversas/mensagens) — não é
-- onde a plataforma vive de fato. O banco real, usado por TODAS as rotas
-- ativas (/api/atende, /api/mcp, /api/sync-cotas, /api/admin/*) via
-- createXtvClient(), é o xtv (cartas=1.878, eventos_sync=11.927,
-- interesses/conversas/mensagens com uso real). wa_conversas/wa_mensagens
-- seguem o mesmo padrão de interesses/conversas/mensagens: vivem no xtv.

create type wa_status as enum ('ativo', 'humano', 'encerrado');
create type wa_papel  as enum ('cliente', 'prosperito', 'humano', 'sistema');

create table public.wa_conversas (
  id uuid primary key default gen_random_uuid(),
  telefone text unique not null,          -- E.164, dado pessoal (LGPD)
  nome text,
  status wa_status not null default 'ativo',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.wa_mensagens (
  id bigint generated always as identity primary key,
  conversa_id uuid not null references public.wa_conversas(id) on delete cascade,
  papel wa_papel not null,
  conteudo text not null,
  wa_message_id text unique,              -- dedup (Meta reenvia eventos)
  criado_em timestamptz not null default now()
);
create index on public.wa_mensagens (conversa_id, criado_em desc);

-- RLS: service-only, mesmo padrão de fornecedores/importacoes (migration
-- 0037) — RLS ligado, ZERO policies (nem admin): só service_role
-- (createXtvClient, server-only) passa. Dado pessoal (LGPD); nenhum
-- client-side nem painel admin lê isto no v1 (handoff v1 = notificação,
-- não painel — ver spec §9). Retenção de 180 dias fica registrada como
-- decisão pendente (job de expurgo é fatia posterior — ver PLANO_MESTRE §4).
alter table public.wa_conversas enable row level security;
alter table public.wa_mensagens enable row level security;
