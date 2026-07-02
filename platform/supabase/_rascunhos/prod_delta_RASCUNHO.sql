-- ============================================================================
-- RASCUNHO — NÃO RODAR / NÃO COMMITAR / NÃO PUSHAR
-- ----------------------------------------------------------------------------
-- Delta idempotente para alinhar o projeto PROD (xtvjpnyadcdeadhmzyff,
-- "bidcon-plataforma-prod") ao estado das migrations 0005–0015 do repo.
--
-- ESTE ARQUIVO É SÓ PARA REVISÃO HUMANA. Ele:
--   • NÃO é uma migration numerada (fica fora de supabase/migrations/ para
--     não ser pego por `supabase db push`).
--   • NÃO deve ser executado em PROD antes de: (1) backup/PITR confirmado e
--     (2) decisão explícita de método pelo Emerson ("autorizo").
--   • É reconstruído a partir do ESTADO REAL AUDITADO de PROD — não é cópia
--     cega das migrations. Onde a migration original não era idempotente
--     (ex.: `create policy` sem guarda, `create type` sem guarda), aqui
--     envolvemos com `drop ... if exists` ou bloco `do $$ ... duplicate_object`.
--
-- ESTADO REAL AUDITADO DE PROD (base para este delta):
--   schema_migrations : NÃO EXISTE (supabase_migrations.schema_migrations 42P01)
--   tabelas presentes : cartas, comissoes, eventos_sync, indicacoes,
--                       processo_eventos, processos, profiles
--   cartas (16 cols)  : id, parceiro_id, tipo(enum), valor_credito,
--                       valor_entrada, status(enum), criado_em, numero_externo,
--                       fonte, valor_parcela, qtd_parcelas, sincronizada_em,
--                       criado_via, descricao, embedding(vector), embedding_em
--                       -> logo: 0001, 0004 e 0007 (embedding) JÁ presentes.
--   processos (9 cols): id, cliente_id, parceiro_id, carta_id, status(enum),
--                       valor_carta, valor_entrada, criado_em, atualizado_em
--   AUSENTES (tabelas): administradoras, fornecedores, sync_fonte_config,
--                       kyc_perfis, kyc_eventos, ancora_tabela, checklist_modelos,
--                       checklist_itens, processo_documentos, contratos,
--                       pagamentos_sinal, reservas(*)
--   AUSENTES (colunas): cartas.administradora_origem, cartas.entrada_parceiro_raw,
--                       cartas.administradora_id, cartas.fornecedor_id,
--                       cartas.comissao_percentual, processos.subetapa,
--                       processos.prazo_em, processos.status_confirmacao_parceiro
--   funcs             : só sync_aplicar_cotas(p_cotas jsonb) [1-arg, ANTIGA];
--                       SEM reservar_carta; SEM sync_aplicar_cotas 2-arg
--   dados             : cartas=175 (sync real), processos=0
--
-- NÃO VERIFICADO EM PROD (ainda) — este delta é DEFENSIVO quanto a:
--   • is_admin()  (0002)  -> incluímos como `create or replace` (seguro re-rodar).
--   • enums 0001 (tipo_bem, status_carta, status_processo, status_comissao,
--     tipo_perfil, status_perfil) -> inferidos presentes (colunas tipadas em
--     cartas/processos já existem), então NÃO recriamos aqui.
--   • policies base 0002 -> NÃO recriadas aqui (fora de escopo do delta 0005+);
--     se faltarem em PROD, tratar num passo à parte. VER "CHECAGENS ANTES".
--
-- ORDEM: segue a ordem lógica das migrations 0005→0015. Cada bloco anota a
--        origem. Rode em UMA transação só se o Emerson decidir (BEGIN/COMMIT no
--        fim, comentados — decisão dele).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- CHECAGENS ANTES (rodar SÓ SELECTs, read-only, e conferir o resultado):
--   -- is_admin existe?
--   select to_regprocedure('public.is_admin()');
--   -- policies base 0002 existem? (esperado: várias linhas)
--   select policyname, tablename from pg_policies
--     where schemaname='public'
--       and tablename in ('profiles','cartas','processos','indicacoes','comissoes')
--     order by tablename, policyname;
--   -- enums 0001 existem?
--   select typname from pg_type
--     where typname in ('tipo_bem','status_carta','status_processo',
--                       'status_comissao','tipo_perfil','status_perfil');
-- Se is_admin() ou as policies 0002 faltarem, PARE e trate 0002 primeiro:
-- este delta assume is_admin() e o RLS base já existentes.
-- ----------------------------------------------------------------------------


-- ############################################################################
-- 0) SALVAGUARDA: is_admin() (de 0002). create or replace = idempotente.
--    Incluído por segurança porque TUDO abaixo depende dele nas policies.
-- ############################################################################
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.tipo = 'admin'
  );
$$;


-- ############################################################################
-- 0005 — cartas_vitrine (policy). Original SEM guarda -> drop-then-create.
-- ############################################################################
drop policy if exists cartas_vitrine_select on cartas;
create policy cartas_vitrine_select on cartas
  for select to authenticated using (status = 'disponivel');


-- ############################################################################
-- 0006 — status_rpc (4 RPCs). Todas create or replace (idempotentes).
--        Reincluídas com revoke/grant. Observação: 0010 REDEFINE
--        avancar_status_processo; aqui ponho a versão 0010 (a final) para não
--        aplicar a intermediária. As outras três seguem iguais a 0006.
-- ############################################################################

-- definir_status_carta (0006)
create or replace function public.definir_status_carta(
  p_carta  uuid,
  p_status status_carta
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  update cartas set status = p_status where id = p_carta;
  if not found then
    raise exception 'carta_inexistente' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.definir_status_carta(uuid, status_carta) from public;
grant execute on function public.definir_status_carta(uuid, status_carta) to authenticated;

-- liberar_comissao (0006)
create or replace function public.liberar_comissao(p_comissao uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  update comissoes
     set status = 'liberada', liberada_em = now()
   where id = p_comissao and status = 'prevista';
  if not found then
    raise exception 'comissao_invalida' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public.liberar_comissao(uuid) from public;
grant execute on function public.liberar_comissao(uuid) to authenticated;

-- marcar_comissao_paga (0006)
create or replace function public.marcar_comissao_paga(p_comissao uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  update comissoes
     set status = 'paga'
   where id = p_comissao and status = 'liberada';
  if not found then
    raise exception 'comissao_invalida' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public.marcar_comissao_paga(uuid) from public;
grant execute on function public.marcar_comissao_paga(uuid) to authenticated;

-- >>> NOTA: avancar_status_processo é definida na seção 0010 (versão final).
--     NÃO duplicar aqui a versão 0006.


-- ############################################################################
-- 0008 — cadastro + KYC.
--   • handle_new_user() + trigger (idempotente: drop trigger if exists).
--   • enum kyc_status: original SEM guarda -> bloco do/duplicate_object.
--   • tabelas kyc_perfis/kyc_eventos: original SEM if not exists -> adicionado.
--   • índices: original SEM guarda -> if not exists.
--   • policies (5): original SEM guarda -> drop-then-create.
--   • storage.objects policies (3): idem.
--   OBS storage: buckets kyc-doc/kyc-selfie/kyc-renda são PASSO MANUAL do
--   Emerson (painel Storage, privados). As policies abaixo assumem que existem.
-- ############################################################################

-- auto-perfil
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

-- enum kyc_status (guarda idempotente)
do $$
begin
  create type kyc_status as enum
    ('pendente','em_analise','verificado','rejeitado','bloqueado');
exception
  when duplicate_object then null;
end $$;

-- tabelas KYC (+ if not exists)
create table if not exists kyc_perfis (
  user_id         uuid primary key references profiles(id) on delete cascade,
  cpf             text,
  nascimento      date,
  endereco        jsonb,
  doc_tipo        text,
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
create index if not exists idx_kyc_status on kyc_perfis(status_kyc);

create table if not exists kyc_eventos (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references profiles(id) on delete cascade,
  ator_id   uuid references profiles(id) on delete set null,
  evento    text not null,
  detalhe   text,
  em        timestamptz not null default now()
);
create index if not exists idx_kyc_eventos_user on kyc_eventos(user_id);
create index if not exists idx_kyc_eventos_em   on kyc_eventos(em desc);

alter table kyc_perfis  enable row level security;
alter table kyc_eventos enable row level security;

drop policy if exists kyc_select_self on kyc_perfis;
create policy kyc_select_self on kyc_perfis
  for select using (user_id = auth.uid() or is_admin());

drop policy if exists kyc_insert_self on kyc_perfis;
create policy kyc_insert_self on kyc_perfis
  for insert with check (user_id = auth.uid());

drop policy if exists kyc_update_self on kyc_perfis;
create policy kyc_update_self on kyc_perfis
  for update
  using (user_id = auth.uid() and status_kyc in ('pendente','rejeitado'))
  with check (user_id = auth.uid() and status_kyc in ('pendente','em_analise'));

drop policy if exists kyc_admin_all on kyc_perfis;
create policy kyc_admin_all on kyc_perfis
  for all using (is_admin()) with check (is_admin());

drop policy if exists kyc_eventos_admin_select on kyc_eventos;
create policy kyc_eventos_admin_select on kyc_eventos
  for select using (is_admin());

-- RPC kyc_decidir (create or replace)
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
    p_user, auth.uid(),
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

-- storage policies (drop-then-create). Requer buckets já criados (manual).
drop policy if exists kyc_storage_owner_insert on storage.objects;
create policy kyc_storage_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('kyc-doc','kyc-selfie','kyc-renda')
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists kyc_storage_owner_update on storage.objects;
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

drop policy if exists kyc_storage_owner_select on storage.objects;
create policy kyc_storage_owner_select on storage.objects
  for select to authenticated
  using (
    bucket_id in ('kyc-doc','kyc-selfie','kyc-renda')
    and (split_part(name, '/', 1) = auth.uid()::text or is_admin())
  );


-- ############################################################################
-- 0009 + 0015 — reservar_carta.
--   0009 cria reservar_carta(uuid); 0015 REDEFINE (seta
--   status_confirmacao_parceiro='pendente' p/ não-LANCE). Uso a versão FINAL
--   (0015) — mas ela depende de cartas.administradora_origem e
--   processos.status_confirmacao_parceiro, que são criados na seção 0011/0015
--   abaixo. => Esta função vai DEPOIS da seção 0015 (ver ordem no fim).
--   Placeholder aqui só para marcar a dependência.
-- ############################################################################
-- (definida na seção "0015 · RPCs finais", ao fim do arquivo)


-- ############################################################################
-- 0010 — avancar_status_processo (versão FINAL, com propagação p/ carta).
--        create or replace = idempotente. Corpo TRANSCRITO VERBATIM de
--        0010_status_carta_propagacao.sql (não reconstruído):
--          - papel: admin OU parceiro dono do processo;
--          - guarda de estado terminal (cancelado/concluido não reabrem);
--          - escada de 1 passo p/ frente; 'cancelado' a partir de não-terminal;
--          - processo_eventos usa (de_status, para_status, nota) — NÃO ator_id;
--          - propagação: concluido->vendida, cancelado->disponivel.
-- ############################################################################
create or replace function public.avancar_status_processo(
  p_processo uuid,
  p_novo     status_processo,
  p_nota     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_atual    status_processo;
  v_parceiro uuid;
  v_carta    uuid;
  v_ordem    constant status_processo[] := array[
    'reservada','documentacao','analise_administradora','transferencia','concluido'
  ]::status_processo[];
  v_i_atual int;
  v_i_novo  int;
begin
  -- carrega o processo (a função vê tudo; o filtro de papel é manual abaixo)
  select status, parceiro_id, carta_id into v_atual, v_parceiro, v_carta
  from processos where id = p_processo;

  if not found then
    raise exception 'processo_inexistente' using errcode = 'P0002';
  end if;

  -- papel: admin sempre; parceiro só se for o dono do processo
  if not (is_admin() or v_parceiro = auth.uid()) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;

  -- já está cancelado/concluído? não reabre
  if v_atual in ('cancelado','concluido') then
    raise exception 'status_terminal' using errcode = 'P0001';
  end if;

  -- cancelar é permitido a partir de qualquer estado não-terminal
  if p_novo <> 'cancelado' then
    v_i_atual := array_position(v_ordem, v_atual);
    v_i_novo  := array_position(v_ordem, p_novo);
    -- só avança um passo de cada vez, sempre para frente
    if v_i_novo is null or v_i_atual is null or v_i_novo <> v_i_atual + 1 then
      raise exception 'transicao_invalida' using errcode = 'P0001';
    end if;
  end if;

  update processos
     set status = p_novo, atualizado_em = now()
   where id = p_processo;

  insert into processo_eventos (processo_id, de_status, para_status, nota)
  values (p_processo, v_atual, p_novo, nullif(btrim(coalesce(p_nota,'')), ''));

  -- ---- propagação do status da carta (mesma transação) --------------------
  if v_carta is not null then
    if p_novo = 'concluido' then
      update cartas set status = 'vendida'     where id = v_carta;
    elsif p_novo = 'cancelado' then
      update cartas set status = 'disponivel'  where id = v_carta;
    end if;
  end if;
end;
$$;
-- 0010 preserva os grants de 0006 (create or replace mantém privilégios). Os
-- revoke/grant abaixo são idempotentes e garantem o estado final desejado.
revoke all on function public.avancar_status_processo(uuid, status_processo, text) from public;
grant execute on function public.avancar_status_processo(uuid, status_processo, text) to authenticated;


-- ############################################################################
-- 0011 — administradoras + fornecedores + FKs em cartas.
--        Tabelas/colunas/índices já eram idempotentes na origem.
--        As 3+ policies eram SEM guarda -> drop-then-create.
-- ############################################################################
create table if not exists administradoras (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  marca_logo     text,
  site_oficial   text,
  aceita_assuncao boolean not null default false,
  segmentos      text[] not null default '{}',
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now()
);
create index if not exists idx_administradoras_ativo on administradoras(ativo);

create table if not exists fornecedores (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  portal_origem text,
  canal_lance   text,
  resp_nome     text,
  resp_contato  text,
  obs           text,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now()
);
create index if not exists idx_fornecedores_ativo on fornecedores(ativo);

alter table cartas add column if not exists administradora_id uuid references administradoras(id) on delete set null;
alter table cartas add column if not exists fornecedor_id     uuid references fornecedores(id)   on delete set null;

create index if not exists idx_cartas_administradora on cartas(administradora_id);
create index if not exists idx_cartas_fornecedor     on cartas(fornecedor_id);

alter table administradoras enable row level security;
alter table fornecedores    enable row level security;

drop policy if exists administradoras_select_logado on administradoras;
create policy administradoras_select_logado on administradoras
  for select to authenticated using (ativo = true or is_admin());

drop policy if exists administradoras_admin_all on administradoras;
create policy administradoras_admin_all on administradoras
  for all using (is_admin()) with check (is_admin());

drop policy if exists fornecedores_admin_all on fornecedores;
create policy fornecedores_admin_all on fornecedores
  for all using (is_admin()) with check (is_admin());


-- ############################################################################
-- 0012 — sync por administradora: sync_fonte_config + seeds + sync_aplicar_cotas(jsonb).
--   Seeds via insert...where not exists / on conflict (idempotentes).
--   policy sync_fonte_config_admin_all: SEM guarda -> drop-then-create.
--   sync_aplicar_cotas(jsonb) 1-arg: JÁ EXISTE em PROD. 0015 dropa e cria a
--   2-arg. => aqui NÃO recrio a 1-arg; o drop da 1-arg fica na seção 0015.
-- ############################################################################
create table if not exists sync_fonte_config (
  fonte             text primary key,
  administradora_id uuid references administradoras(id) on delete set null,
  fornecedor_id     uuid references fornecedores(id)   on delete set null,
  atualizado_em     timestamptz not null default now()
);
alter table sync_fonte_config enable row level security;

drop policy if exists sync_fonte_config_admin_all on sync_fonte_config;
create policy sync_fonte_config_admin_all on sync_fonte_config
  for all using (is_admin()) with check (is_admin());

-- Seeds 0012 (insert...where not exists -> idempotentes):
insert into administradoras (nome, segmentos, aceita_assuncao)
select 'HS Consórcios', array['imovel','veiculo'], false
where not exists (select 1 from administradoras where nome = 'HS Consórcios');

insert into fornecedores (nome, portal_origem)
select 'Lance Consórcio', 'https://contempladas.lanceconsorcio.com.br/'
where not exists (select 1 from fornecedores where nome = 'Lance Consórcio');

-- Config da fonte '360prospere' -> HS + Lance (on conflict do update):
insert into sync_fonte_config (fonte, administradora_id, fornecedor_id)
select '360prospere',
       (select id from administradoras where nome = 'HS Consórcios'),
       (select id from fornecedores   where nome = 'Lance Consórcio')
on conflict (fonte) do update
  set administradora_id = excluded.administradora_id,
      fornecedor_id     = excluded.fornecedor_id,
      atualizado_em     = now();

-- Backfill: carimba FKs em cartas já existentes da fonte '360prospere'.
update cartas c
   set administradora_id = sfc.administradora_id,
       fornecedor_id     = sfc.fornecedor_id
  from sync_fonte_config sfc
 where sfc.fonte = '360prospere'
   and c.fonte = '360prospere'
   and (c.administradora_id is null or c.fornecedor_id is null);

-- sync_aplicar_cotas(jsonb) 1-arg (0012): JÁ EXISTE em PROD e será DROPADA na
-- seção 0015 (substituída pela 2-arg). NÃO recrio a 1-arg aqui.


-- ############################################################################
-- 0013 — ancora_tabela (ferramenta interna @prospere.com.br).
--   Tabela/índices idempotentes na origem; 2 policies SEM guarda.
-- ############################################################################
create table if not exists ancora_tabela (
  id                    uuid primary key default gen_random_uuid(),
  produto               text not null,
  bem_codigo            text not null,
  bem_nome              text,
  valor_do_bem          numeric(14,2),
  grupo                 text not null,
  plano                 text not null,
  prazo_grupo           integer,
  prazo_comercializacao integer,
  taxa_administracao    numeric(6,4),
  fundo_reserva         numeric(6,4),
  pf_com_seguro         numeric(14,2),
  pf_sem_seguro         numeric(14,2),
  pj_com_seguro         numeric(14,2),
  pj_sem_seguro         numeric(14,2),
  assembleia            text,
  cotas_ativas          integer,
  cotas_vagas           integer,
  status                text,
  importado_em          timestamptz not null default now(),
  unique (produto, bem_codigo, grupo, plano)
);
create index if not exists idx_ancora_produto on ancora_tabela(produto);
create index if not exists idx_ancora_grupo   on ancora_tabela(grupo);

alter table ancora_tabela enable row level security;

-- Acesso restrito à equipe interna (@prospere.com.br). Original SEM guarda.
drop policy if exists ancora_tabela_equipe_select on ancora_tabela;
create policy ancora_tabela_equipe_select on ancora_tabela
  for select to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) like '%@prospere.com.br');

drop policy if exists ancora_tabela_equipe_write on ancora_tabela;
create policy ancora_tabela_equipe_write on ancora_tabela
  for all to authenticated
  using      (lower(coalesce(auth.jwt() ->> 'email', '')) like '%@prospere.com.br')
  with check (lower(coalesce(auth.jwt() ->> 'email', '')) like '%@prospere.com.br');


-- ############################################################################
-- 0014 — pós-reserva (subetapa, checklist, documentos, contratos, pagamentos).
--   Origem já altamente idempotente. Aqui: enum via do/duplicate_object,
--   tabelas if not exists, índices if not exists, RPCs create or replace, e
--   CADA policy convertida para drop-then-create.
--   Buckets processo-docs / contratos = PASSO MANUAL (Emerson, privados).
-- ############################################################################

-- 0) colunas aditivas + enum de sub-etapa
do $$ begin
  create type processo_subetapa as enum (
    'docs_enviados',      -- 2  Documentação enviada p/ pré-análise
    'pre_analise',        -- 3  Parecer da documentação
    'sinal_pix',          -- 4  Reserva das cotas (sinal 2%, validade 3 dias úteis)
    'contrato_cota',      -- 5  Assinatura do contrato de compra e venda
    'entrada',            -- 6  Pagamento da entrada (residual, menos o sinal)
    'formulario',         -- 7  Envio do formulário (ficha cadastral)
    'link_transferencia', -- 8  Link de assinatura de transferência (e-mail)
    'efetivacao',         -- 9  Análise/efetivação da transferência
    'faturamento'         -- 10 Processo de faturamento
  );
exception when duplicate_object then null; end $$;

alter table public.processos
  add column if not exists subetapa processo_subetapa,
  add column if not exists prazo_em timestamptz;

alter table public.cartas
  add column if not exists comissao_percentual numeric(5,2);

-- 1) CHECK-LIST DE DOCUMENTOS por administradora
create table if not exists public.checklist_modelos (
  id               uuid primary key default gen_random_uuid(),
  administradora_id uuid not null references public.administradoras(id) on delete cascade,
  tipo_pessoa      text not null check (tipo_pessoa in ('pf','pj')),
  ativo            boolean not null default true,
  criado_em        timestamptz not null default now(),
  unique (administradora_id, tipo_pessoa)
);

create table if not exists public.checklist_itens (
  id           uuid primary key default gen_random_uuid(),
  modelo_id    uuid not null references public.checklist_modelos(id) on delete cascade,
  ordem        int  not null default 0,
  rotulo       text not null,
  obrigatorio  boolean not null default true,
  aceita_multi boolean not null default false,
  criado_em    timestamptz not null default now()
);

create index if not exists idx_checklist_itens_modelo on public.checklist_itens(modelo_id);

alter table public.checklist_modelos enable row level security;
alter table public.checklist_itens   enable row level security;

drop policy if exists checklist_modelos_read on public.checklist_modelos;
create policy checklist_modelos_read on public.checklist_modelos
  for select to authenticated using (true);
drop policy if exists checklist_itens_read on public.checklist_itens;
create policy checklist_itens_read on public.checklist_itens
  for select to authenticated using (true);

drop policy if exists checklist_modelos_admin on public.checklist_modelos;
create policy checklist_modelos_admin on public.checklist_modelos
  for all using (is_admin()) with check (is_admin());
drop policy if exists checklist_itens_admin on public.checklist_itens;
create policy checklist_itens_admin on public.checklist_itens
  for all using (is_admin()) with check (is_admin());

-- 2) DOCUMENTOS DO PROCESSO (bucket privado processo-docs)
create table if not exists public.processo_documentos (
  id               uuid primary key default gen_random_uuid(),
  processo_id      uuid not null references public.processos(id) on delete cascade,
  checklist_item_id uuid references public.checklist_itens(id) on delete set null,
  path             text not null,
  enviado_em       timestamptz not null default now(),
  status           text not null default 'pendente'
                     check (status in ('pendente','aprovado','reprovado')),
  motivo           text,
  decidido_em      timestamptz,
  decidido_por     uuid references public.profiles(id) on delete set null
);

create index if not exists idx_processo_documentos_proc on public.processo_documentos(processo_id);

alter table public.processo_documentos enable row level security;

drop policy if exists proc_docs_select on public.processo_documentos;
create policy proc_docs_select on public.processo_documentos
  for select using (
    is_admin()
    or exists (
      select 1 from public.processos p
      where p.id = processo_id and p.cliente_id = auth.uid()
    )
  );

drop policy if exists proc_docs_insert on public.processo_documentos;
create policy proc_docs_insert on public.processo_documentos
  for insert with check (
    status = 'pendente'
    and exists (
      select 1 from public.processos p
      where p.id = processo_id and p.cliente_id = auth.uid()
    )
  );

drop policy if exists proc_docs_admin on public.processo_documentos;
create policy proc_docs_admin on public.processo_documentos
  for all using (is_admin()) with check (is_admin());

-- 3) CONTRATOS (serviço/cota) — snapshot factual em jsonb
create table if not exists public.contratos (
  id            uuid primary key default gen_random_uuid(),
  processo_id   uuid not null references public.processos(id) on delete cascade,
  tipo          text not null check (tipo in ('servico','cota')),
  versao_modelo text not null default 'v1',
  dados         jsonb not null default '{}'::jsonb,
  status        text not null default 'gerado'
                  check (status in ('gerado','enviado','assinado','cancelado')),
  pdf_path      text,
  provedor_ref  text,
  criado_em     timestamptz not null default now(),
  assinado_em   timestamptz
);

create index if not exists idx_contratos_proc on public.contratos(processo_id);

alter table public.contratos enable row level security;

drop policy if exists contratos_select on public.contratos;
create policy contratos_select on public.contratos
  for select using (
    is_admin()
    or exists (
      select 1 from public.processos p
      where p.id = processo_id and p.cliente_id = auth.uid()
    )
  );

drop policy if exists contratos_admin on public.contratos;
create policy contratos_admin on public.contratos
  for all using (is_admin()) with check (is_admin());

-- 4) PAGAMENTO DO SINAL (PIX) — rastreio sem dado bancário
create table if not exists public.pagamentos_sinal (
  id               uuid primary key default gen_random_uuid(),
  processo_id      uuid not null references public.processos(id) on delete cascade,
  valor            numeric(14,2) not null,
  metodo           text not null default 'pix',
  provedor_ref     text,
  qr_payload       text,
  status           text not null default 'pendente'
                     check (status in ('pendente','pago','expirado','manual')),
  comprovante_path text,
  criado_em        timestamptz not null default now(),
  confirmado_em    timestamptz,
  confirmado_por   uuid references public.profiles(id) on delete set null
);

create index if not exists idx_pagamentos_sinal_proc on public.pagamentos_sinal(processo_id);

alter table public.pagamentos_sinal enable row level security;

drop policy if exists sinal_select on public.pagamentos_sinal;
create policy sinal_select on public.pagamentos_sinal
  for select using (
    is_admin()
    or exists (
      select 1 from public.processos p
      where p.id = processo_id and p.cliente_id = auth.uid()
    )
  );

drop policy if exists sinal_insert_dono on public.pagamentos_sinal;
create policy sinal_insert_dono on public.pagamentos_sinal
  for insert with check (
    status in ('pendente','manual')
    and exists (
      select 1 from public.processos p
      where p.id = processo_id and p.cliente_id = auth.uid()
    )
  );

drop policy if exists sinal_admin on public.pagamentos_sinal;
create policy sinal_admin on public.pagamentos_sinal
  for all using (is_admin()) with check (is_admin());

-- 5) RPCs security definer (create or replace)

create or replace function public.processo_avancar_subetapa(
  p_processo uuid,
  p_subetapa processo_subetapa,
  p_nota     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status   status_processo;
  v_parceiro uuid;
begin
  select status, parceiro_id into v_status, v_parceiro
  from processos where id = p_processo;

  if not found then
    raise exception 'processo_inexistente' using errcode = 'P0002';
  end if;

  if not (is_admin() or v_parceiro = auth.uid()) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;

  if v_status in ('cancelado','concluido') then
    raise exception 'status_terminal' using errcode = 'P0001';
  end if;

  update processos
     set subetapa = p_subetapa, atualizado_em = now()
   where id = p_processo;

  insert into processo_eventos (processo_id, de_status, para_status, nota)
  values (
    p_processo, v_status, v_status,
    nullif(btrim(coalesce(p_nota, 'sub-etapa: ' || p_subetapa::text)), '')
  );
end;
$$;

create or replace function public.registrar_pagamento_sinal(
  p_processo    uuid,
  p_valor       numeric,
  p_provedor_ref text default null,
  p_qr_payload  text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente uuid;
  v_id      uuid;
begin
  select cliente_id into v_cliente from processos where id = p_processo;
  if not found then
    raise exception 'processo_inexistente' using errcode = 'P0002';
  end if;

  if not (is_admin() or v_cliente = auth.uid()) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;

  if p_valor is null or p_valor <= 0 then
    raise exception 'valor_invalido' using errcode = 'P0001';
  end if;

  insert into pagamentos_sinal (processo_id, valor, provedor_ref, qr_payload, status)
  values (p_processo, p_valor, p_provedor_ref, p_qr_payload, 'pendente')
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.confirmar_pagamento_sinal(
  p_pagamento uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not is_admin() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;

  select status into v_status from pagamentos_sinal where id = p_pagamento;
  if not found then
    raise exception 'pagamento_inexistente' using errcode = 'P0002';
  end if;
  if v_status = 'pago' then
    return;  -- idempotente
  end if;

  update pagamentos_sinal
     set status = 'pago', confirmado_em = now(), confirmado_por = auth.uid()
   where id = p_pagamento;
end;
$$;

create or replace function public.gerar_contrato(
  p_processo uuid,
  p_tipo     text,
  p_dados    jsonb default '{}'::jsonb,
  p_versao   text  default 'v1'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente uuid;
  v_pago    boolean;
  v_id      uuid;
begin
  if p_tipo not in ('servico','cota') then
    raise exception 'tipo_invalido' using errcode = 'P0001';
  end if;

  select cliente_id into v_cliente from processos where id = p_processo;
  if not found then
    raise exception 'processo_inexistente' using errcode = 'P0002';
  end if;

  if not (is_admin() or v_cliente = auth.uid()) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;

  if p_tipo = 'cota' then
    select exists (
      select 1 from pagamentos_sinal
      where processo_id = p_processo and status = 'pago'
    ) into v_pago;
    if not v_pago then
      raise exception 'sinal_nao_pago' using errcode = 'P0001';
    end if;
  end if;

  insert into contratos (processo_id, tipo, versao_modelo, dados, status)
  values (p_processo, p_tipo, coalesce(p_versao,'v1'), coalesce(p_dados,'{}'::jsonb), 'gerado')
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.decidir_documento(
  p_doc    uuid,
  p_status text,
  p_motivo text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if p_status not in ('aprovado','reprovado') then
    raise exception 'status_invalido' using errcode = 'P0001';
  end if;

  update processo_documentos
     set status      = p_status,
         motivo      = nullif(btrim(coalesce(p_motivo,'')), ''),
         decidido_em = now(),
         decidido_por = auth.uid()
   where id = p_doc;

  if not found then
    raise exception 'documento_inexistente' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.checklist_do_processo(p_processo uuid)
returns table (
  checklist_item_id uuid,
  rotulo            text,
  obrigatorio       boolean,
  ordem             int,
  doc_status        text,
  doc_motivo        text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente uuid;
  v_carta   uuid;
  v_adm     uuid;
  v_modelo  uuid;
begin
  select cliente_id, carta_id into v_cliente, v_carta
    from processos where id = p_processo;
  if not found then
    raise exception 'processo_inexistente' using errcode = 'P0002';
  end if;
  if not (is_admin() or v_cliente = auth.uid()) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;

  if v_carta is null then
    return;
  end if;
  select administradora_id into v_adm from cartas where id = v_carta;
  if v_adm is null then
    return;
  end if;

  select id into v_modelo
    from checklist_modelos
   where administradora_id = v_adm and tipo_pessoa = 'pf' and ativo = true
   limit 1;
  if v_modelo is null then
    return;
  end if;

  return query
    select
      ci.id                          as checklist_item_id,
      ci.rotulo                      as rotulo,
      ci.obrigatorio                 as obrigatorio,
      ci.ordem                       as ordem,
      ultimo.status                  as doc_status,
      ultimo.motivo                  as doc_motivo
    from checklist_itens ci
    left join lateral (
      select pd.status, pd.motivo
        from processo_documentos pd
       where pd.processo_id = p_processo
         and pd.checklist_item_id = ci.id
       order by pd.enviado_em desc
       limit 1
    ) ultimo on true
    where ci.modelo_id = v_modelo
    order by ci.ordem asc, ci.rotulo asc;
end;
$$;

revoke all on function public.processo_avancar_subetapa(uuid, processo_subetapa, text) from public;
revoke all on function public.registrar_pagamento_sinal(uuid, numeric, text, text)     from public;
revoke all on function public.confirmar_pagamento_sinal(uuid)                          from public;
revoke all on function public.gerar_contrato(uuid, text, jsonb, text)                  from public;
revoke all on function public.decidir_documento(uuid, text, text)                      from public;
revoke all on function public.checklist_do_processo(uuid)                              from public;

grant execute on function public.processo_avancar_subetapa(uuid, processo_subetapa, text) to authenticated;
grant execute on function public.registrar_pagamento_sinal(uuid, numeric, text, text)     to authenticated;
grant execute on function public.confirmar_pagamento_sinal(uuid)                          to authenticated;
grant execute on function public.gerar_contrato(uuid, text, jsonb, text)                  to authenticated;
grant execute on function public.decidir_documento(uuid, text, text)                      to authenticated;
grant execute on function public.checklist_do_processo(uuid)                              to authenticated;

-- 6) STORAGE — buckets processo-docs / contratos (drop-then-create nas policies)
drop policy if exists proc_storage_owner_insert on storage.objects;
create policy proc_storage_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('processo-docs','contratos')
    and exists (
      select 1 from public.processos p
      where p.id::text = split_part(name, '/', 1)
        and p.cliente_id = auth.uid()
    )
  );

drop policy if exists proc_storage_owner_update on storage.objects;
create policy proc_storage_owner_update on storage.objects
  for update to authenticated
  using (
    bucket_id in ('processo-docs','contratos')
    and exists (
      select 1 from public.processos p
      where p.id::text = split_part(name, '/', 1)
        and p.cliente_id = auth.uid()
    )
  )
  with check (
    bucket_id in ('processo-docs','contratos')
    and exists (
      select 1 from public.processos p
      where p.id::text = split_part(name, '/', 1)
        and p.cliente_id = auth.uid()
    )
  );

drop policy if exists proc_storage_owner_select on storage.objects;
create policy proc_storage_owner_select on storage.objects
  for select to authenticated
  using (
    bucket_id in ('processo-docs','contratos')
    and (
      is_admin()
      or exists (
        select 1 from public.processos p
        where p.id::text = split_part(name, '/', 1)
          and p.cliente_id = auth.uid()
      )
    )
  );

-- 7) SEED do check-list Lance (PF/PJ): PENDENTE lista oficial do Emerson.
--    Deixado FORA do delta de propósito (nenhum rótulo inventado).


-- ############################################################################
-- 0015 — multifonte (colunas de origem, constraints, índice único, seeds,
--        sync_aplicar_cotas 2-arg, drop da 1-arg, reservar_carta final).
--   Origem já idempotente (add column if not exists, drop constraint/index if
--   exists, on conflict/where not exists). Reproduzir fiel.
-- ############################################################################
alter table cartas add column if not exists administradora_origem text;
alter table cartas add column if not exists entrada_parceiro_raw  numeric(14,2);

alter table cartas drop constraint if exists chk_cartas_adm_origem;
alter table cartas add  constraint chk_cartas_adm_origem
  check (administradora_origem in ('LANCE','CBC','PIFFER','CARTAS','SERVOPA','manual')
         or administradora_origem is null);

drop index if exists uniq_cartas_numero_externo;
create unique index if not exists uniq_cartas_origem_numero
  on cartas(administradora_origem, numero_externo)
  where administradora_origem is not null and numero_externo is not null;
create index if not exists idx_cartas_adm_origem on cartas(administradora_origem);

alter table processos add column if not exists status_confirmacao_parceiro text;
alter table processos drop constraint if exists chk_proc_conf_parceiro;
alter table processos add  constraint chk_proc_conf_parceiro
  check (status_confirmacao_parceiro is null
         or status_confirmacao_parceiro in ('pendente','confirmada','recusada'));

-- ----- Seeds das 4 fontes novas (C) — insert...where not exists / on conflict.
-- 3.1) administradoras públicas p/ logado
insert into administradoras (nome, segmentos, aceita_assuncao)
select v.nome, array['imovel','veiculo']::text[], false
from (values ('CBC'), ('PIFFER'), ('CARTAS'), ('SERVOPA')) as v(nome)
where not exists (select 1 from administradoras a where a.nome = v.nome);

-- 3.2) fornecedores (SÓ ADMIN); portal só o público conhecido (Servopa)
insert into fornecedores (nome, portal_origem)
select v.nome, v.portal
from (values
  ('CBC',     null::text),
  ('PIFFER',  null::text),
  ('CARTAS',  null::text),
  ('SERVOPA', 'https://cartascontempladasservopa.com.br/')
) as v(nome, portal)
where not exists (select 1 from fornecedores f where f.nome = v.nome);

-- 3.3) sync_fonte_config por administradora_origem (chave = a própria origem)
insert into sync_fonte_config (fonte, administradora_id, fornecedor_id)
select
  v.origem,
  (select id from administradoras where nome = v.origem),
  (select id from fornecedores   where nome = v.origem)
from (values ('CBC'), ('PIFFER'), ('CARTAS'), ('SERVOPA')) as v(origem)
on conflict (fonte) do update
  set administradora_id = excluded.administradora_id,
      fornecedor_id     = excluded.fornecedor_id,
      atualizado_em     = now();

-- 3.4) LANCE: linha de config chaveada por 'LANCE' -> HS/Lace (semeados na 0012)
insert into sync_fonte_config (fonte, administradora_id, fornecedor_id)
select
  'LANCE',
  (select id from administradoras where nome = 'HS Consórcios'),
  (select id from fornecedores   where nome = 'Lance Consórcio')
where exists (select 1 from administradoras where nome = 'HS Consórcios')
on conflict (fonte) do update
  set administradora_id = excluded.administradora_id,
      fornecedor_id     = excluded.fornecedor_id,
      atualizado_em     = now();

-- ----- sync_aplicar_cotas 2-arg (create or replace) — corpo EXATO de 0015 -----
create or replace function sync_aplicar_cotas(p_origem text, p_cotas jsonb)
returns table (novas int, atualizadas int, indisponibilizadas int)
language plpgsql
as $$
declare
  v_novas int := 0;
  v_atu   int := 0;
  v_ind   int := 0;
  r record;
  v_id uuid;
  v_existe record;
  v_admin_id uuid;
  v_forn_id  uuid;
begin
  -- guarda de sanidade: origem tem que ser uma das marcas conhecidas
  if p_origem is null
     or p_origem not in ('LANCE','CBC','PIFFER','CARTAS','SERVOPA') then
    raise exception 'origem_invalida: %', coalesce(p_origem, '<null>')
      using errcode = 'P0001';
  end if;

  -- defaults de carimbo para ESTA fonte (uuid público + uuid admin-only).
  select administradora_id, fornecedor_id
    into v_admin_id, v_forn_id
    from sync_fonte_config where fonte = p_origem;

  -- conjunto de números presentes NESTA execução (para o "sumiu da lista")
  create temporary table _presentes (numero integer primary key) on commit drop;
  insert into _presentes (numero)
    select distinct (c->>'numero')::int
    from jsonb_array_elements(p_cotas) c
    where (c->>'numero') is not null;

  -- 1) UPSERT das cotas presentes (casadas por (administradora_origem, numero))
  for r in
    select
      (c->>'numero')::int              as numero,
      (c->>'tipo')::tipo_bem            as tipo,
      (c->>'valor_credito')::numeric    as valor_credito,
      (c->>'valor_entrada')::numeric    as valor_entrada,
      (c->>'valor_parcela')::numeric    as valor_parcela,
      (c->>'qtd_parcelas')::int         as qtd_parcelas,
      nullif(c->>'entrada_parceiro','')::numeric as entrada_parceiro
    from jsonb_array_elements(p_cotas) c
  loop
    select id, valor_credito, valor_entrada, valor_parcela, qtd_parcelas,
           status, entrada_parceiro_raw
      into v_existe
      from cartas
     where administradora_origem = p_origem
       and numero_externo = r.numero;

    if not found then
      insert into cartas (
        tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas,
        status, numero_externo, fonte, criado_via, sincronizada_em,
        administradora_origem, administradora_id, fornecedor_id,
        entrada_parceiro_raw
      ) values (
        r.tipo, r.valor_credito, r.valor_entrada, r.valor_parcela, r.qtd_parcelas,
        'disponivel', r.numero, '360prospere', 'sync', now(),
        p_origem, v_admin_id, v_forn_id,
        r.entrada_parceiro
      )
      returning id into v_id;

      v_novas := v_novas + 1;
      insert into eventos_sync (tipo, numero_externo, carta_id, detalhe, push_pendente)
      values ('carta_nova', r.numero, v_id,
              p_origem || ' crédito ' || r.valor_credito::text, true);

    else
      if v_existe.status = 'indisponivel'
         or v_existe.valor_credito is distinct from r.valor_credito
         or v_existe.valor_entrada is distinct from r.valor_entrada
         or v_existe.valor_parcela is distinct from r.valor_parcela
         or v_existe.qtd_parcelas  is distinct from r.qtd_parcelas
         or v_existe.entrada_parceiro_raw is distinct from r.entrada_parceiro
      then
        update cartas set
          tipo = r.tipo,
          valor_credito = r.valor_credito,
          valor_entrada = r.valor_entrada,
          valor_parcela = r.valor_parcela,
          qtd_parcelas  = r.qtd_parcelas,
          entrada_parceiro_raw = r.entrada_parceiro,
          status = case when v_existe.status = 'indisponivel'
                        then 'disponivel' else v_existe.status end,
          sincronizada_em = now(),
          administradora_id = coalesce(administradora_id, v_admin_id),
          fornecedor_id     = coalesce(fornecedor_id,     v_forn_id)
        where administradora_origem = p_origem
          and numero_externo = r.numero;

        v_atu := v_atu + 1;
        insert into eventos_sync (tipo, numero_externo, carta_id, detalhe)
        values ('carta_atualizada', r.numero, v_existe.id, p_origem || ' valores/sync');
      else
        update cartas set
          sincronizada_em = now(),
          administradora_id = coalesce(administradora_id, v_admin_id),
          fornecedor_id     = coalesce(fornecedor_id,     v_forn_id)
        where administradora_origem = p_origem
          and numero_externo = r.numero;
      end if;
    end if;
  end loop;

  -- 2) SUMIRAM da fonte p_origem (escopado a p_origem — falha de outra fonte
  --    NUNCA apaga estoque desta).
  with sumidas as (
    update cartas set status = 'indisponivel', sincronizada_em = now()
    where administradora_origem = p_origem
      and fonte = '360prospere'
      and status = 'disponivel'
      and numero_externo is not null
      and numero_externo not in (select numero from _presentes)
    returning numero_externo, id
  )
  insert into eventos_sync (tipo, numero_externo, carta_id, detalhe)
  select 'carta_indisponivel', numero_externo, id, p_origem || ' ausente na fonte'
  from sumidas;

  get diagnostics v_ind = row_count;

  novas := v_novas; atualizadas := v_atu; indisponibilizadas := v_ind;
  return next;
end;
$$;

-- Remove a assinatura antiga 1-arg (a 2-arg a substitui). Idempotente.
drop function if exists sync_aplicar_cotas(jsonb);

-- ----- reservar_carta final (0015, create or replace) — corpo EXATO de 0015 --
create or replace function public.reservar_carta(p_carta_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_kyc        kyc_status;
  v_carta      cartas%rowtype;
  v_processo   uuid;
  v_existente  uuid;
  v_conf       text;
begin
  -- 1) autenticação
  if v_uid is null then
    raise exception 'nao_autenticado' using errcode = '42501';
  end if;

  -- 2) gate de KYC: só cliente verificado reserva
  select status_kyc into v_kyc from kyc_perfis where user_id = v_uid;
  if v_kyc is distinct from 'verificado' then
    raise exception 'kyc_nao_verificado' using errcode = 'P0001';
  end if;

  -- 3) carta tem que existir e estar disponível (lock evita reserva dupla)
  select * into v_carta
    from cartas
   where id = p_carta_id
   for update;

  if not found then
    raise exception 'carta_inexistente' using errcode = 'P0002';
  end if;

  if v_carta.status <> 'disponivel' then
    raise exception 'carta_indisponivel' using errcode = 'P0001';
  end if;

  -- 4) evita processo ativo duplicado do mesmo cliente para a mesma carta
  select id into v_existente
    from processos
   where cliente_id = v_uid
     and carta_id   = p_carta_id
     and status <> 'cancelado'
   limit 1;
  if v_existente is not null then
    return v_existente;  -- idempotente
  end if;

  -- confirmação de parceiro: 'pendente' só quando a fonte-marca NÃO é LANCE.
  v_conf := case
              when v_carta.administradora_origem is not null
                   and v_carta.administradora_origem <> 'LANCE'
              then 'pendente'
              else null
            end;

  -- ----- escrita atômica -----------------------------------------------------
  insert into processos (cliente_id, parceiro_id, carta_id, status,
                         valor_carta, valor_entrada, status_confirmacao_parceiro)
  values (v_uid, v_carta.parceiro_id, p_carta_id, 'reservada',
          v_carta.valor_credito, v_carta.valor_entrada, v_conf)
  returning id into v_processo;

  update cartas set status = 'reservada' where id = p_carta_id;

  insert into processo_eventos (processo_id, de_status, para_status, nota)
  values (v_processo, null, 'reservada',
          case when v_conf = 'pendente'
               then 'Reserva iniciada pelo cliente. Confirmação com parceiro pendente.'
               else 'Reserva iniciada pelo cliente.' end);

  return v_processo;
end;
$$;

revoke all on function public.reservar_carta(uuid) from public;
grant execute on function public.reservar_carta(uuid) to authenticated;


-- ============================================================================
-- FIM DO RASCUNHO.
--
-- ✅ BLOCOS 0005–0015 AGORA COMPLETOS (0013/0014/0015 transcritos verbatim das
--    migrations; 0010 reconciliado com 0010_status_carta_propagacao.sql — o
--    corpo anterior estava reconstruído e divergia nas colunas de
--    processo_eventos e na escada de status). PADRÕES DE IDEMPOTÊNCIA aplicados:
--      1) create policy  -> drop policy if exists + create policy
--      2) create type    -> do $$ ... exception when duplicate_object $$
--      3) create table   -> create table if not exists
--      4) create index   -> create index if not exists
--      5) add column      -> add column if not exists
--      6) constraint      -> drop constraint if exists + add constraint
--      7) function        -> create or replace (já idempotente)
--
-- ⚠️ RISCOS RESIDUAIS A CONFERIR ANTES DE EXECUTAR (não bloqueiam a revisão,
--    mas exigem checagem no schema real de PROD):
--    • processo_eventos: este delta assume as colunas (processo_id, de_status,
--      para_status, nota). Se PROD tiver esquema diferente dessa tabela,
--      avancar_status_processo / reservar_carta / processo_avancar_subetapa
--      falham no INSERT. Confirmar \d processo_eventos antes.
--    • eventos_sync: idem — assume (tipo, numero_externo, carta_id, detalhe,
--      push_pendente). Conferir \d eventos_sync.
--    • cartas.criado_via / cartas.numero_externo / cartas.fonte: usados no
--      INSERT do sync — já auditados como presentes (0004/0007), mas reconfira.
--    • processos: colunas cliente_id, parceiro_id, carta_id, valor_carta,
--      valor_entrada — auditadas presentes (9 cols). subetapa/prazo_em/
--      status_confirmacao_parceiro são adicionadas por este delta.
--    • Ordem de dependência OK: 0011 (administradoras/fornecedores) vem antes
--      de 0012 (seeds/config) e de 0015 (que referencia HS/Lance). reservar_carta
--      final (0015) depende de kyc_perfis (0008) e das colunas de origem (0015),
--      todas criadas acima antes dela.
--
-- ⚠️ NÃO CRIA schema_migrations. Se o Emerson quiser que `db push` futuro
--    reconheça o estado, é preciso popular supabase_migrations.schema_migrations
--    manualmente com as versões 0001..0015 DEPOIS — decisão à parte.
--
-- ⚠️ PRÉ-REQUISITOS ANTES DE QUALQUER EXECUÇÃO EM PROD:
--    (1) Backup/PITR confirmado no painel (Database → Backups).
--    (2) Rodar as CHECAGENS ANTES (topo) e confirmar is_admin()/RLS 0002.
--    (3) Buckets de Storage kyc-* / processo-docs / contratos criados (manual).
--    (4) "Autorizo" explícito do Emerson para o método escolhido.
-- ============================================================================
