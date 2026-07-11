-- aplicada via MCP 09/07 — fonte canônica: Supabase
-- (espelho documental; NÃO reexecutar — já aplicada em produção)

-- 0037: fundacao do importador (F1) — fornecedor obrigatorio por lote
create table public.fornecedores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  contato_nome text,
  whatsapp text,
  email text,
  observacoes text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table public.importacoes (
  id uuid primary key default gen_random_uuid(),
  fornecedor_id uuid not null references public.fornecedores(id),
  origem text not null default 'console',
  arquivo_nome text,
  status text not null default 'previa' check (status in ('previa','publicada','descartada')),
  total_linhas int, novas int, alteradas int, rejeitadas int,
  criado_por text,
  criado_em timestamptz not null default now(),
  publicada_em timestamptz
);

alter table public.cartas
  add column if not exists importacao_id uuid references public.importacoes(id);
alter table public.cartas
  add constraint cartas_fornecedor_fk foreign key (fornecedor_id) references public.fornecedores(id);

-- seed: fornecedor agregado do legado + backfill de todo o estoque atual
with legado as (
  insert into public.fornecedores (nome, observacoes)
  values ('360prospere (legado)',
          'Fornecedor agregado do sync legado. Estoque pre-console; substituir por fornecedores reais via importador (F1).')
  returning id
)
update public.cartas set fornecedor_id = (select id from legado)
where fornecedor_id is null;

-- dado de contato/comercial: acesso somente via service role
alter table public.fornecedores enable row level security;
alter table public.importacoes enable row level security;
