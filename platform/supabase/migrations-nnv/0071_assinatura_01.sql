-- =============================================================
-- 0071_assinatura_01 — BIDCON-ASSINATURA-01 (v3)
-- Projeto: nnv (bidcon-portal-auth, nnvjeijsrwpzsggwqpcu)
-- Autorização nominal: "autorizo ASSINATURA-01" (Emerson, 13/08/2026)
--
-- v3 = v2 + dois ajustes não bloqueantes, validados contra o nnv
-- real em 13/08/2026 (via MCP, leitura):
--  (i)  tg_ass_env_touch com SET search_path = public;
--  (ii) criado_por → on delete set null.
-- Mantido igual ao v2 (decisão em aberto, não bloqueante):
--  link_assinatura legível pelo cliente do processo.
--
-- Medições reconfirmadas:
--  (a) contratos.tipo tinha CHECK ('servico','cota')  → estendido;
--  (b) NÃO existia unique(processo_id,tipo)           → criado
--      (contratos com 0 linhas — seguro);
--  (c) policies no padrão da casa: is_admin() + cliente do
--      processo (espelha contratos_select: parceiro NÃO lê).
--  Rotas: usar status 'enviado' — CHECK de status intacto.
-- =============================================================
begin;
-- 1) Envelope: agrupa os documentos enviados juntos (cessão +
--    requerimento da conta notarial) num único link de assinatura.
create table if not exists public.assinatura_envelopes (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.processos(id) on delete cascade,
  provedor text not null default 'zapsign'
    check (provedor in ('zapsign','clicksign','docusign')),
  provedor_envelope_id text unique,
  status text not null default 'rascunho'
    check (status in ('rascunho','enviado','parcial','assinado','recusado','expirado','cancelado')),
  criado_por uuid references auth.users(id) on delete set null,
  enviado_em timestamptz,
  concluido_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
comment on table public.assinatura_envelopes is
  'BIDCON-ASSINATURA-01: envelope de assinatura eletrônica por processo (link único: cessão + requerimento da conta notarial).';
-- 2) contratos: estender tipos, criar unicidade e colunas novas.
alter table public.contratos drop constraint if exists contratos_tipo_check;
alter table public.contratos add constraint contratos_tipo_check
  check (tipo = any (array['servico'::text,'cota'::text,'cessao'::text,'requerimento_conta'::text]));
alter table public.contratos
  add constraint contratos_processo_tipo_uniq unique (processo_id, tipo);
alter table public.contratos
  add column if not exists envelope_id uuid references public.assinatura_envelopes(id) on delete set null,
  add column if not exists pdf_assinado_path text;
comment on column public.contratos.envelope_id is
  'BIDCON-ASSINATURA-01: envelope de assinatura que contém este documento.';
comment on column public.contratos.pdf_assinado_path is
  'BIDCON-ASSINATURA-01: path/URL do PDF assinado devolvido pelo provedor.';
-- 3) Signatários (papéis da operação Bidcon).
create table if not exists public.assinatura_signatarios (
  id uuid primary key default gen_random_uuid(),
  envelope_id uuid not null references public.assinatura_envelopes(id) on delete cascade,
  papel text not null check (papel in
    ('cedente','cessionario','pagadora','comissionada','bidcon','testemunha')),
  nome text not null,
  cpf_cnpj text,
  email text,
  whatsapp text,                       -- E.164 sem "+", ex.: 5519988303000
  provedor_signer_id text,
  link_assinatura text,
  status text not null default 'pendente'
    check (status in ('pendente','visualizou','assinado','recusado')),
  assinado_em timestamptz,
  ordem int not null default 1,
  criado_em timestamptz not null default now()
);
create index if not exists idx_ass_sig_envelope on public.assinatura_signatarios(envelope_id);
-- 4) Log de eventos/webhooks (auditoria interna).
create table if not exists public.assinatura_eventos (
  id bigint generated always as identity primary key,
  envelope_id uuid references public.assinatura_envelopes(id) on delete cascade,
  tipo text not null,
  payload jsonb,
  criado_em timestamptz not null default now()
);
create index if not exists idx_ass_evt_envelope on public.assinatura_eventos(envelope_id);
-- 5) RLS no padrão da casa (is_admin(); leitura do cliente do processo;
--    parceiro não lê — espelha contratos_select; escrita via service_role).
alter table public.assinatura_envelopes   enable row level security;
alter table public.assinatura_signatarios enable row level security;
alter table public.assinatura_eventos     enable row level security;
create policy ass_env_admin on public.assinatura_envelopes
  for all using (is_admin());
create policy ass_env_select_cliente on public.assinatura_envelopes
  for select to authenticated using (
    is_admin() or exists (
      select 1 from public.processos p
      where p.id = assinatura_envelopes.processo_id
        and p.cliente_id = auth.uid()
    )
  );
create policy ass_sig_admin on public.assinatura_signatarios
  for all using (is_admin());
create policy ass_sig_select_cliente on public.assinatura_signatarios
  for select to authenticated using (
    is_admin() or exists (
      select 1 from public.assinatura_envelopes e
      join public.processos p on p.id = e.processo_id
      where e.id = assinatura_signatarios.envelope_id
        and p.cliente_id = auth.uid()
    )
  );
create policy ass_evt_admin on public.assinatura_eventos
  for all using (is_admin());
-- eventos: sem select para authenticated (auditoria interna).
-- 6) Trigger de atualizado_em.
create or replace function public.tg_ass_env_touch() returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.atualizado_em := now();
  return new;
end $$;
create trigger tg_ass_env_touch before update on public.assinatura_envelopes
  for each row execute function public.tg_ass_env_touch();
commit;
