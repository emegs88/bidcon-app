-- 0057_whatsapp_extratos — projeto xtv (xtvjpnyadcdeadhmzyff).
-- FATIA WHATSAPP-EXTRATO-01 — ingestão e leitura de extratos de cota
-- (PDF/imagem) recebidos via WhatsApp. AUTORIZO pendente — NÃO aplicar
-- sem confirmação explícita do usuário (mesmo ritual das fatias
-- anteriores). Ver lib/whatsapp/media.ts, lib/whatsapp/extrato.ts e
-- app/api/whatsapp/route.ts.
--
-- wa_mensagens ganha:
--   media_id     : id da mídia na Graph API (Meta), quando a mensagem é um
--                  anexo (document/image). Nulo pra mensagens de texto.
--   storage_path : caminho no bucket privado `wa-extratos`
--                  ('{conversa_id}/{media_id}.{ext}'), preenchido depois
--                  do upload bem-sucedido. Nulo se o download/upload
--                  falhou (a mensagem em si já foi gravada antes — o
--                  registro nunca se perde por falha do lado do anexo).
--
-- extratos_cotas (nova tabela) — resultado da extração por IA de um
-- extrato anexado. NUNCA escreve em `cartas` — é sempre um registro
-- separado, pendente de revisão humana:
--   status default 'pendente_revisao' — texto livre (não enum), mesmo
--   padrão de wa_mensagens.status_envio (migration 0052) — a equipe evolui
--   pra 'confirmado'/'descartado'/etc. depois, sem precisar de migration
--   pra cada novo valor.
--   dados jsonb — o JSON bruto retornado pela IA (lib/whatsapp/extrato.ts),
--   preservado por completo mesmo que os campos tipados abaixo dele sejam
--   nulos/parciais — nunca se perde o que a IA efetivamente devolveu.
--
-- RLS: "ligado + zero policies" — mesmo padrão já usado em wa_conversas/
-- wa_mensagens/fornecedores/importacoes (migrations 0037/0046) nesse
-- projeto. O projeto xtv não tem auth.users nem is_admin() — todo acesso
-- é via service_role (createXtvClient), sem sessão de usuário. O "RLS: só
-- admin lê" do pedido original é reforçado na CAMADA DE APLICAÇÃO (rota
-- admin usaria checarAdminConsoleApi() antes de chamar createXtvClient(),
-- mesmo padrão de /api/admin/* — ver lib/admin-console.ts), não por
-- policy de Postgres referenciando auth.uid() — não existe usuário
-- autenticado nesse projeto pra uma policy checar.
--
-- Bucket `wa-extratos` (Supabase Storage): PRIVADO, criado MANUALMENTE no
-- painel (mesmo padrão de kyc-doc/processo-docs — ver migrations 0008 e
-- 0014 no projeto nnv: "o agente não cria bucket via SQL"). Acesso é
-- 100% via service_role (upload em lib/whatsapp/media.ts) — sem policy de
-- storage.objects necessária, já que RLS de storage não afeta
-- service_role.

alter table public.wa_mensagens
  add column if not exists media_id text,
  add column if not exists storage_path text;

create table if not exists public.extratos_cotas (
  id                 uuid primary key default gen_random_uuid(),
  conversa_id        uuid not null references public.wa_conversas(id) on delete cascade,
  mensagem_id        bigint not null references public.wa_mensagens(id) on delete cascade,
  storage_path       text not null,
  dados              jsonb not null default '{}'::jsonb,
  administradora     text,
  grupo              text,
  cota               text,
  valor_credito      numeric,
  saldo_devedor      numeric,
  parcelas_pagas     integer,
  parcelas_restantes integer,
  valor_parcela      numeric,
  contemplada        boolean,
  confianca          numeric,
  status             text not null default 'pendente_revisao',
  criado_em          timestamptz not null default now()
);

create index if not exists idx_extratos_cotas_conversa on public.extratos_cotas(conversa_id);
create index if not exists idx_extratos_cotas_status on public.extratos_cotas(status);

alter table public.extratos_cotas enable row level security;
-- zero policies de propósito — ver nota de RLS acima.
