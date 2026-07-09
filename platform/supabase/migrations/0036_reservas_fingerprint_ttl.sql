-- aplicada via MCP 09/07 — fonte canônica: Supabase
-- (espelho documental; NÃO reexecutar — já aplicada em produção)

-- 0036: reserva real de carta via chat (fingerprint + TTL 48h sem cron)
create or replace function public.carta_fingerprint(
  p_tipo text, p_credito numeric, p_entrada numeric,
  p_parcela numeric, p_parcelas int, p_adm text
) returns text language sql immutable as $$
  select md5(
    lower(coalesce(trim(p_tipo),''))                    || '|' ||
    coalesce((round(p_credito*100))::bigint::text,'0')  || '|' ||
    coalesce((round(p_entrada*100))::bigint::text,'0')  || '|' ||
    coalesce((round(p_parcela*100))::bigint::text,'0')  || '|' ||
    coalesce(p_parcelas::text,'0')                      || '|' ||
    lower(coalesce(trim(p_adm),''))
  )
$$;

create table public.reservas (
  id uuid primary key default gen_random_uuid(),
  carta_id uuid references public.cartas(id) on delete set null,
  interesse_id uuid references public.interesses(id) on delete set null,
  fingerprint text not null,
  nome text,
  telefone text,
  origem text not null default 'chat',
  status text not null default 'ativa' check (status in ('ativa','convertida','cancelada')),
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '48 hours'
);
create index idx_reservas_fp_ativas on public.reservas(fingerprint) where status = 'ativa';
alter table public.reservas enable row level security; -- sem policies: só service role

drop view if exists public.vw_vitrine_viva;
create view public.vw_vitrine_viva
with (security_invoker = on) as
select
  c.id,
  c.numero_externo   as ref,
  c.tipo,
  c.valor_credito    as credito,
  c.valor_entrada    as entrada,
  c.valor_parcela    as parcela,
  c.qtd_parcelas     as parcelas,
  c.bidcon_custo_am  as custo_am,
  c.bidcon_agio_120  as agio_120,
  c.bidcon_agio_150  as agio_150,
  coalesce(a.nome, c.administradora_raw, '') as administradora,
  c.criado_em,
  c.sincronizada_em  as atualizado,
  public.carta_fingerprint(c.tipo::text, c.valor_credito, c.valor_entrada, c.valor_parcela, c.qtd_parcelas,
                           coalesce(a.nome, c.administradora_raw, '')) as fingerprint
from public.cartas c
left join public.administradoras a on a.id = c.administradora_id
where c.status = 'disponivel' and c.valor_credito > 0
  and not exists (
    select 1 from public.reservas r
    where r.status = 'ativa' and r.expira_em > now()
      and r.fingerprint = public.carta_fingerprint(c.tipo::text, c.valor_credito, c.valor_entrada, c.valor_parcela, c.qtd_parcelas,
                                                   coalesce(a.nome, c.administradora_raw, ''))
  );

comment on view public.vw_vitrine_viva is
  'Vitrine viva v2: cartas disponiveis SEM reserva ativa, com fingerprint canonico. Fonte de vitrine, feed e agentes.';
