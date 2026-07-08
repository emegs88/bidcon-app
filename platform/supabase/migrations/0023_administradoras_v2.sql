-- ============ 0018_administradoras_v2 (originalmente referida como 0023_administradoras_v2) ============
-- APLICADA no xtv em 07/07/2026 via janela do banco (MCP). Ensaiada no szs.
-- Renumerada para 0018 nesta migração (pasta real ia só até 0017_repasse.sql).
-- Estende/cria a tabela administradoras convergindo o schema rico do motor de
-- repasse + aliases; resolver case-insensitive; raw preservado; FKs; sync v2.

create table if not exists public.administradoras (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  criado_em timestamptz not null default now()
);

alter table public.administradoras add column if not exists aliases text[] not null default '{}';
alter table public.administradoras add column if not exists marca_logo text;
alter table public.administradoras add column if not exists site_oficial text;
alter table public.administradoras add column if not exists aceita_assuncao boolean not null default false;
alter table public.administradoras add column if not exists segmentos text[];
alter table public.administradoras add column if not exists ativo boolean not null default true;
alter table public.administradoras add column if not exists exigencia_garantia_pct numeric not null default 100.00;

-- Higiene (no xtv: no-op, tabela nasce vazia)
delete from public.administradoras where nome in ('CARTAS','CBC','PIFFER');
update public.administradoras set nome = 'Servopa' where nome = 'SERVOPA';

create unique index if not exists administradoras_nome_uidx on public.administradoras (nome);

alter table public.administradoras enable row level security;
drop policy if exists administradoras_leitura_publica on public.administradoras;
create policy administradoras_leitura_publica on public.administradoras
  for select to anon, authenticated using (true);

insert into public.administradoras (nome, aliases) values
  ('Âncora',          array['ANCORA','ANCORA ADM','ANCORA ADMINISTRADORA']),
  ('Servopa',         array['SERVOPA','CONSORCIO SERVOPA']),
  ('Porto Seguro',    array['PORTO','PORTOSEG','PORTO SEGURO CONSORCIO']),
  ('Remaza',          array['REMAZA NOVATERRA','REMAZA ADM']),
  ('Embracon',        array['EMBRACON ADM']),
  ('Rodobens',        array['RODOBENS CONSORCIO']),
  ('Itaú',            array['ITAU','CONSORCIO ITAU']),
  ('Bradesco',        array['BRADESCO CONSORCIOS']),
  ('Santander',       array['SANTANDER CONSORCIO']),
  ('Banco do Brasil', array['BB','BB CONSORCIOS']),
  ('CNP (Caixa)',     array['CAIXA','CNP','CAIXA CONSORCIOS']),
  ('Magalu',          array['LUIZA','MAGAZINE LUIZA','CONSORCIO MAGALU']),
  ('Canopus',         array['CANOPUS ADM']),
  ('Racon',           array['RACON CONSORCIOS']),
  ('Honda',           array['CNH','CONSORCIO NACIONAL HONDA']),
  ('Yamaha',          array['CONSORCIO YAMAHA']),
  ('Volkswagen',      array['VW','CONSORCIO VOLKSWAGEN']),
  ('Ademicon',        array['ADEMILAR']),
  ('HS Consórcios',   array['HS','HS CONSORCIOS'])
on conflict (nome) do update
  set aliases = case when public.administradoras.aliases = '{}'::text[]
                     then excluded.aliases else public.administradoras.aliases end;

create or replace function public.resolver_administradora(p_raw text)
returns uuid language sql stable
set search_path to 'public', 'pg_temp'
as $$
  select a.id from public.administradoras a
  where p_raw is not null and (
    lower(a.nome) = lower(trim(p_raw))
    or exists (select 1 from unnest(a.aliases) al where lower(al) = lower(trim(p_raw)))
  )
  limit 1
$$;
revoke execute on function public.resolver_administradora(text) from public, anon;
grant execute on function public.resolver_administradora(text) to service_role;

alter table public.cartas add column if not exists administradora_raw text;

alter table public.cartas drop constraint if exists cartas_administradora_fk;
alter table public.cartas add constraint cartas_administradora_fk
  foreign key (administradora_id) references public.administradoras(id);
create index if not exists cartas_administradora_idx on public.cartas (administradora_id);

alter table public.sync_fonte_config drop constraint if exists sync_fonte_config_administradora_fk;
alter table public.sync_fonte_config add constraint sync_fonte_config_administradora_fk
  foreign key (administradora_id) references public.administradoras(id);

update public.sync_fonte_config
   set administradora_id = public.resolver_administradora('Servopa'), atualizado_em = now()
 where fonte = 'SERVOPA' and administradora_id is null;

-- NOTA: a versão da sync_aplicar_cotas desta migração foi SUBSTITUÍDA pela 0018b
-- (fallback restrito a fonte mono). Ver 0018b_fallback_so_fonte_mono.sql -- é a vigente.
