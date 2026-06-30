-- ============================================================================
-- Bidcon — plataforma logada · Migration 0011 · Administradoras + Fornecedores
-- ----------------------------------------------------------------------------
-- Rascunho para revisão. NÃO rodar em PROD sem autorização do Emerson.
-- Aplicar primeiro no DEV (fpgimirtiryivnrjdyxb), via SQL Editor do Supabase.
--
-- MODELO (decidido com o usuário): separar DUAS entidades que hoje não existem,
-- com NÍVEIS DE SIGILO DISTINTOS:
--
--   administradora  = a MARCA do bem/consórcio (ex.: "HS Consórcios").
--                     É o nome do produto que o cliente compra. PÚBLICO para
--                     quem está logado (cliente e parceiro podem ver).
--
--   fornecedor      = de QUEM a Bidcon compra a carta (ex.: "Lance Consórcio"),
--                     o PORTAL de origem de onde puxamos o estoque, o CANAL de
--                     lance e o CONTATO do responsável. Isso é segredo
--                     OPERACIONAL — SÓ ADMIN. Nunca chega a cliente nem parceiro.
--
-- Por que separar: hoje o estoque vem de um único fornecedor (Lance Consórcio),
-- cujas cartas são todas de uma única administradora (HS). Amanhã pode haver
-- outro fornecedor revendendo a MESMA administradora, ou a mesma administradora
-- vindo por canais diferentes. A relação fornecedor↔administradora é N:N na vida
-- real, então cada carta aponta para AMBOS, de forma independente.
--
-- COMPLIANCE / LGPD:
--   - O sigilo do fornecedor/portal/lance/contato é garantido por RLS (abaixo),
--     não por CSS. Os dados sensíveis NÃO podem sair do servidor num payload de
--     cliente/parceiro: a policy de SELECT bloqueia a leitura na origem.
--   - administradora.nome é público (logado). fornecedor.* é admin-only.
-- ============================================================================

-- ----- ADMINISTRADORAS (público p/ logado) ----------------------------------
-- Marca do bem. Campos factuais e verificáveis apenas — nada de promessa de
-- desempenho. `aceita_assuncao` e `segmentos` alimentam o ranking público por
-- ATRIBUTO FACTUAL (não por "rapidez", que é promessa).
create table if not exists administradoras (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,                 -- "HS Consórcios"
  marca_logo    text,                          -- path/URL do logo (opcional)
  site_oficial  text,                          -- site da administradora (factual)
  aceita_assuncao boolean not null default false, -- permite assunção de dívida?
  segmentos     text[] not null default '{}',  -- {'imovel','veiculo','agro',...}
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now()
);

create index if not exists idx_administradoras_ativo on administradoras(ativo);

-- ----- FORNECEDORES (SÓ ADMIN — segredo operacional) -------------------------
-- De quem compramos, por onde puxamos o estoque, canal de lance e o contato do
-- responsável que atende a Bidcon. NADA disto pode vazar para cliente/parceiro.
create table if not exists fornecedores (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,                 -- "Lance Consórcio"
  portal_origem text,                          -- URL/site replicado de onde puxamos
  canal_lance   text,                          -- onde acionar o lance
  resp_nome     text,                          -- nome do responsável que atende
  resp_contato  text,                          -- contato (tel/e-mail) do responsável
  obs           text,                          -- observações operacionais internas
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now()
);

create index if not exists idx_fornecedores_ativo on fornecedores(ativo);

-- ----- FK nas cartas (aditivo; nada removido) --------------------------------
-- on delete set null: apagar uma administradora/fornecedor NÃO apaga a carta.
alter table cartas
  add column if not exists administradora_id uuid references administradoras(id) on delete set null,
  add column if not exists fornecedor_id     uuid references fornecedores(id)     on delete set null;

create index if not exists idx_cartas_administradora on cartas(administradora_id);
create index if not exists idx_cartas_fornecedor     on cartas(fornecedor_id);

-- ============================================================================
-- RLS — a garantia REAL do sigilo (não é CSS)
-- ============================================================================

alter table administradoras enable row level security;
alter table fornecedores    enable row level security;

-- ----- ADMINISTRADORAS: leitura PÚBLICA p/ logado; escrita só admin ----------
-- Cliente e parceiro podem LER (é a marca do bem). Só admin escreve.
create policy administradoras_select_logado on administradoras
  for select
  to authenticated
  using (ativo = true or is_admin());

create policy administradoras_admin_all on administradoras
  for all using (is_admin()) with check (is_admin());

-- ----- FORNECEDORES: SÓ ADMIN, em tudo (inclusive SELECT) --------------------
-- Esta é a trava de sigilo. Um cliente/parceiro logado NÃO consegue ler nenhuma
-- linha desta tabela: o SELECT já é negado na origem. service_role (sync) bypassa.
create policy fornecedores_admin_all on fornecedores
  for all using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- ATENÇÃO sobre cartas.fornecedor_id (vazamento por join):
--   A coluna cartas.fornecedor_id é só um uuid — não revela o fornecedor por si.
--   Mas o cliente/parceiro NÃO deve nem receber esse uuid em payloads. Por isso,
--   nas QUERIES de cliente/parceiro, NUNCA selecione cartas.fornecedor_id nem
--   faça join em fornecedores. Selecione fornecedor_id apenas em rotas admin
--   (após exigirPapel("admin")). administradora_id pode ir no payload logado.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- Verificação rápida (opcional, após aplicar, no DEV):
--   -- como admin: vê fornecedores
--   select count(*) from fornecedores;
--   -- como cliente comum (set role / login cliente): deve dar 0 / acesso negado
--   --   select * from fornecedores;   -> 0 linhas (RLS bloqueia)
--   --   select * from administradoras where ativo; -> retorna as marcas
-- ----------------------------------------------------------------------------
