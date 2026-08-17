-- ============================================================================
-- Bidcon — plataforma logada · Migration 0011 · Administradoras + Fornecedores
-- BANCO ALVO: nnv (aplicada lá; NÃO reproduzir contra xtv).
--
--   CORREÇÃO DE 17/08/2026 — este cabeçalho já disse "xtv E nnv — APLICADA NOS
--   DOIS", e estava ERRADO. A medição anterior perguntou se os NOMES existiam
--   nos dois bancos (existem) e chamou isso de aplicada. Re-medido por LINHAGEM,
--   isto é, por quem criou cada tabela e com que forma:
--
--   `administradoras` — no xtv NÃO nasceu aqui. Nasceu em
--     `0023_administradoras_v2` (nativa do xtv, aplicada 08/07/2026), que a cria
--     do zero com 3 colunas e depois acrescenta aliases/marca_logo/site_oficial/
--     aceita_assuncao/segmentos/ativo/exigencia_garantia_pct. O comentário da
--     própria 0023 diz "no xtv: no-op, tabela nasce vazia" — ela sabe que está
--     criando, não estendendo. Resultado: 9 dos 10 nomes de coluna coincidem com
--     os desta 0011, mas por CONVERGÊNCIA DELIBERADA (a 0023 se declara
--     convergindo o schema do motor de repasse), não por descendência.
--     É o homônimo mais traiçoeiro dos três, porque a forma quase idêntica
--     PARECE prova de linhagem e não é.
--
--   `fornecedores` — no xtv nasceu em `0037_fornecedores_importacoes` (nativa do
--     xtv, aplicada 09/07/2026), com `create table public.fornecedores` SEM
--     guard e com outra forma:
--       xtv (8 col.): id · nome · contato_nome · whatsapp · email ·
--                     observacoes · ativo · criado_em
--       nnv (9 col.): id · nome · portal_origem · canal_lance · resp_nome ·
--                     resp_contato · obs · ativo · criado_em
--     Coincidem 4 nomes — id, nome, ativo, criado_em —, todos genéricos. Nenhum
--     campo de negócio casa.
--
--   O QUE NÃO CONSIGO ATRIBUIR, e registro como não sabido: `cartas.
--   administradora_id` e `cartas.fornecedor_id` EXISTEM no xtv, e esta 0011 é o
--   único arquivo da pasta que as acrescenta — mas o ledger do xtv
--   (supabase_migrations.schema_migrations) COMEÇA em `0019_interesses`
--   (05/07/2026) e não tem entrada nenhuma para 0001–0018. Tudo anterior foi
--   aplicado à mão, fora do ledger. Então não dá para afirmar que foi este
--   arquivo: 0023 e 0037 apenas PRESSUPÕEM as colunas prontas. Fica em aberto.
--
--   NÃO mover: o arquivo vive na pasta do xtv por acidente de origem.
--
--   PERIGO — e este cabeçalho também errou aqui. A versão anterior dizia que
--   reproduzir contra banco vivo "aborta na primeira policy já existente".
--   NÃO ABORTA. Medido no xtv em 17/08/2026: `fornecedores` tem RLS ligado e
--   ZERO policies; `administradoras` tem só `administradoras_leitura_publica`
--   (da 0023). Nenhum dos 3 nomes de policy deste arquivo colide com nada.
--   Rodado contra o xtv, este arquivo vai do começo ao fim SEM UM ERRO:
--     - os 2 `create table if not exists` viram no-op SILENCIOSO contra as
--       tabelas de 0023/0037 — inclusive contra a `fornecedores` de FORMA
--       DIFERENTE, que ele não corrige e não denuncia;
--     - os 2 `add column if not exists` em `cartas` viram no-op;
--     - e os 3 `create policy` SÃO CRIADOS, enxertando regra de acesso em
--       tabelas que este arquivo não criou. `fornecedores_admin_all` é
--       `for all using (is_admin())` sobre uma tabela que hoje, no xtv, é
--       service-role-only por ausência DELIBERADA de policy: a 0037 fecha o
--       acesso justamente não escrevendo policy nenhuma. Reproduzir esta 0011
--       ABRE essa tabela para todo is_admin(), e o operador não vê um aviso.
--   Sucesso sem erro não é sinal de que rodou no lugar certo.
--
--   PERIGO na frase "Aplicar primeiro no DEV (fpgimirtiryivnrjdyxb)", logo
--   abaixo: aponta para o projeto prospere-360-dev, que hoje é o COFRE KYC
--   (ACERVO-360) e está declarado INTOCÁVEL no CLAUDE.md. NÃO rode nada deste
--   arquivo lá. O rótulo "DEV" envelheceu junto com o projeto.
--   A frase "NÃO rodar em PROD sem autorização do Emerson" fica como registro,
--   não como instrução: rodou no nnv, que é produção. O arquivo diz o que se
--   pretendia, só o ledger diz o que aconteceu.
--   Ver ident01/LEDGER-RECONCILIACAO-01_xtv.md, BLOCO 8 e BLOCO 9.
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
