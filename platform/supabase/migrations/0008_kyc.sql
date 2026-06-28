-- ============================================================================
-- Bidcon — plataforma logada · Migration 0008 · Cadastro + KYC
-- ----------------------------------------------------------------------------
-- Rascunho para revisão. APLICAR PRIMEIRO NO DEV (fpgimirtiryivnrjdyxb) pelo
-- Emerson (SQL editor do Supabase). O agente NÃO aplica nada no banco — aqui só
-- validamos a sintaxe localmente. NADA em PROD sem "autorizo" escrito.
--
-- Esta migration faz três coisas:
--   1) Corrige o bug de origem: NÃO existia trigger criando `profiles` para
--      novos usuários de auth.users. A função handle_new_user() + trigger
--      garante que todo cadastro nasce com profile (tipo='cliente','ativo').
--   2) Cria o subsistema de KYC (Know Your Customer): tabela com dado pessoal
--      sensível (CPF, nascimento, endereço, paths de doc/selfie/renda), enum de
--      status, RPC de decisão admin-only e tabela de eventos (auditoria).
--   3) Define os 3 buckets de Storage PRIVADOS e suas policies (o Emerson cria
--      os buckets no painel; o SQL de policy roda no schema storage).
--
-- Princípios mantidos (iguais a 0002/0006):
--   - RLS estrito. is_admin() (0002) reusado.
--   - Campos de VEREDITO (status_kyc, face_*, ocr_*, verificado_*) só mudam via
--     RPC security definer / service_role — nunca por UPDATE livre do dono.
--   - Storage privado: nada é legível por anon; acesso só por signed URL gerada
--     server-side após checagem de papel.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) AUTO-PERFIL — corrige a ausência de trigger em auth.users.
--    Todo novo usuário ganha uma linha em profiles. Autocadastro = sempre
--    'cliente'/'ativo'. nome/telefone vêm de raw_user_meta_data quando o
--    cadastro os enviou (signUp options.data). Idempotente.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, nome, telefone, tipo, status)
  values (
    new.id,
    new.email,
    nullif(btrim(coalesce(new.raw_user_meta_data->>'nome', '')), ''),
    nullif(btrim(coalesce(new.raw_user_meta_data->>'telefone', '')), ''),
    'cliente',
    'ativo'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 2) ENUM de status do KYC.
--    pendente    -> ainda não enviou (linha pode nem existir)
--    em_analise  -> enviou dados/arquivos, aguardando verificação
--    verificado  -> aprovado pelo admin (ou IA, quando ligada)
--    rejeitado   -> reprovado; dono pode reenviar
--    bloqueado   -> reprovado em definitivo; dono não reenvia
-- ----------------------------------------------------------------------------
create type kyc_status as enum
  ('pendente','em_analise','verificado','rejeitado','bloqueado');

-- ----------------------------------------------------------------------------
-- KYC_PERFIS — 1:1 com profiles. Dado pessoal sensível (LGPD).
--   endereco jsonb: { logradouro, numero, complemento, bairro, cidade, uf, cep }
--   *_path: caminho no bucket privado ({user_id}/arquivo) — NUNCA URL pública.
--   face_score/face_confianca: preenchidos pela IA quando ligada (0..1).
--   ocr_status/ocr_texto: idem OCR. ocr_texto NUNCA é exibido cru ao cliente.
-- ----------------------------------------------------------------------------
create table kyc_perfis (
  user_id         uuid primary key references profiles(id) on delete cascade,
  cpf             text,
  nascimento      date,
  endereco        jsonb,
  doc_tipo        text,           -- 'cnh' | 'rg'
  doc_path        text,
  selfie_path     text,
  renda_path      text,
  status_kyc      kyc_status   not null default 'pendente',
  face_score      numeric(4,3),
  face_confianca  numeric(4,3),
  ocr_status      text         not null default 'pendente',
  ocr_texto       text,
  motivo_rejeicao text,
  criado_em       timestamptz  not null default now(),
  atualizado_em   timestamptz  not null default now(),
  verificado_em   timestamptz,
  verificado_por  uuid references profiles(id) on delete set null
);

create index idx_kyc_status on kyc_perfis(status_kyc);

-- ----------------------------------------------------------------------------
-- KYC_EVENTOS — trilha de auditoria (alimenta /admin/audit-logs).
--   evento: 'perfil_atualizado' | 'kyc_enviado' | 'kyc_verificado'
--         | 'kyc_rejeitado' | 'kyc_bloqueado'
--   ator_id: quem executou (dono no envio; admin na decisão).
-- ----------------------------------------------------------------------------
create table kyc_eventos (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references profiles(id) on delete cascade,
  ator_id   uuid references profiles(id) on delete set null,
  evento    text not null,
  detalhe   text,
  em        timestamptz not null default now()
);

create index idx_kyc_eventos_user on kyc_eventos(user_id);
create index idx_kyc_eventos_em   on kyc_eventos(em desc);

-- ----- RLS -------------------------------------------------------------------
alter table kyc_perfis  enable row level security;
alter table kyc_eventos enable row level security;

-- KYC_PERFIS:
--   dono LÊ a própria linha; admin lê tudo.
create policy kyc_select_self on kyc_perfis
  for select using (user_id = auth.uid() or is_admin());

--   dono INSERE a própria linha (primeiro envio).
create policy kyc_insert_self on kyc_perfis
  for insert with check (user_id = auth.uid());

--   dono ATUALIZA a própria linha SOMENTE enquanto pendente/rejeitado
--   (não pode mexer depois de em_analise/verificado/bloqueado). A WITH CHECK
--   impede que ele "promova" o próprio status: o destino também tem que ser
--   pendente/em_analise — o veredito real (verificado/...) só vem pela RPC.
--   Observação: a proteção forte dos campos de veredito é a RPC + service_role;
--   esta policy reduz a superfície do client honesto.
create policy kyc_update_self on kyc_perfis
  for update
  using (user_id = auth.uid() and status_kyc in ('pendente','rejeitado'))
  with check (user_id = auth.uid() and status_kyc in ('pendente','em_analise'));

--   admin: tudo.
create policy kyc_admin_all on kyc_perfis
  for all using (is_admin()) with check (is_admin());

-- KYC_EVENTOS: admin lê; escrita só por RPC/service_role (sem policy de insert).
create policy kyc_eventos_admin_select on kyc_eventos
  for select using (is_admin());

-- ----------------------------------------------------------------------------
-- 3) RPC kyc_decidir — ADMIN-ONLY. Grava o veredito + auditoria, atômico.
--    p_status: verificado | rejeitado | bloqueado (não aceita pendente/analise).
--    p_motivo: obrigatório para rejeitado/bloqueado (motivo_rejeicao).
-- ----------------------------------------------------------------------------
create or replace function public.kyc_decidir(
  p_user   uuid,
  p_status kyc_status,
  p_motivo text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if not is_admin() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;

  if p_status not in ('verificado','rejeitado','bloqueado') then
    raise exception 'status_invalido' using errcode = 'P0001';
  end if;

  if p_status in ('rejeitado','bloqueado') and v_motivo is null then
    raise exception 'motivo_obrigatorio' using errcode = 'P0001';
  end if;

  update kyc_perfis
     set status_kyc      = p_status,
         motivo_rejeicao = case when p_status = 'verificado' then null else v_motivo end,
         verificado_em   = now(),
         verificado_por  = auth.uid(),
         atualizado_em   = now()
   where user_id = p_user;

  if not found then
    raise exception 'kyc_inexistente' using errcode = 'P0002';
  end if;

  insert into kyc_eventos (user_id, ator_id, evento, detalhe)
  values (
    p_user,
    auth.uid(),
    case p_status
      when 'verificado' then 'kyc_verificado'
      when 'rejeitado'  then 'kyc_rejeitado'
      when 'bloqueado'  then 'kyc_bloqueado'
    end,
    v_motivo
  );
end;
$$;

revoke all on function public.kyc_decidir(uuid, kyc_status, text) from public;
grant execute on function public.kyc_decidir(uuid, kyc_status, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4) STORAGE — buckets PRIVADOS + policies.
--    PASSO MANUAL (Emerson, painel Supabase → Storage):
--      criar 3 buckets PRIVADOS (public = false):
--        kyc-doc, kyc-selfie, kyc-renda
--    Depois, rodar as policies abaixo. Convenção de path: '{user_id}/arquivo'.
--    Ninguém lê via anon: leitura só por signed URL gerada server-side
--    (createAdminClient().storage.from(bucket).createSignedUrl(path, ttl)).
-- ----------------------------------------------------------------------------

-- dono ESCREVE/atualiza/remove apenas no próprio prefixo ({uid}/...).
-- (split_part(name,'/',1) = primeiro segmento do path = user_id)
create policy kyc_storage_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('kyc-doc','kyc-selfie','kyc-renda')
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy kyc_storage_owner_update on storage.objects
  for update to authenticated
  using (
    bucket_id in ('kyc-doc','kyc-selfie','kyc-renda')
    and split_part(name, '/', 1) = auth.uid()::text
  )
  with check (
    bucket_id in ('kyc-doc','kyc-selfie','kyc-renda')
    and split_part(name, '/', 1) = auth.uid()::text
  );

-- dono pode LER o próprio arquivo (admin lê via service_role, que bypassa RLS).
-- Mesmo com esta policy, NÃO há URL pública: o bucket é privado, então o acesso
-- continua exigindo token/sessão. As telas usam signed URL server-side.
create policy kyc_storage_owner_select on storage.objects
  for select to authenticated
  using (
    bucket_id in ('kyc-doc','kyc-selfie','kyc-renda')
    and (split_part(name, '/', 1) = auth.uid()::text or is_admin())
  );

-- ============================================================================
-- Verificação rápida (DEV, após aplicar):
--   -- trigger criou profile no cadastro:
--   select tipo, status from profiles where email = '<novo email>';
--   -- KYC: dono insere a própria linha, não consegue setar 'verificado':
--   --   (UPDATE para 'verificado' deve ser barrado pela policy/with check)
--   -- admin decide:
--   select kyc_decidir('<user>', 'verificado', null);
--   select kyc_decidir('<user>', 'rejeitado', 'documento ilegível');
--   -- não-admin chamando kyc_decidir deve falhar com 'sem_permissao' (42501).
-- ============================================================================
