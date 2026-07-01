-- ============================================================================
-- Bidcon — Migration 0013 · PROSPERE byAncora (simulador interno da equipe)
-- ----------------------------------------------------------------------------
-- Rascunho para revisão. NÃO rodar em PROD. Aplicar primeiro no DEV
-- (fpgimirtiryivnrjdyxb) via SQL Editor do Supabase, DEPOIS de 0010→0011→0012.
--
-- O QUE É (decidido com o usuário):
--   Uma ferramenta SÓ DA EQUIPE PROSPERE — separada por completo do produto de
--   cartas contempladas. Espelha a TABELA DE VENDA de cotas NOVAS do portal da
--   Âncora (newcon.ancoraconsorcios.com.br), onde a Prospere entra como
--   "PROSPERE INVESTIMENTOS E CONSORCIO LTDA". Serve para a equipe simular preço
--   de entrada (1ª parcela, taxa, fundo) por produto/bem/grupo/plano.
--
-- POR QUE É ISOLADO DO CLIENTE:
--   taxa de administração, fundo de reserva e o plano "INVESTIDOR" são termos
--   que NUNCA podem aparecer numa tela de cliente (compliance). Esta tabela é
--   de uso INTERNO da equipe; o sigilo é garantido por RLS (abaixo), restrita ao
--   domínio @prospere.com.br. Nada aqui alimenta a vitrine pública de cartas.
--
-- CONTRATO DE DADO (decidido):
--   1ª parcela e taxas são ARMAZENADAS COMO VALORES REAIS vindos do importador
--   (lidos do portal). NUNCA são recalculadas pela aplicação. A 1ª parcela já
--   embute taxa + fundo + seguro + antecipações do portal; guardamos o número
--   pronto (PF/PJ, com/sem seguro), não a fórmula.
--
-- DADOS: esta migration NÃO insere nenhuma linha de tabela. O estoque é populado
--   exclusivamente pela rota /api/prospere-ancora/importar, com JSON real e
--   anonimizado que o usuário capturar do portal autenticado. Zero seed.
-- ============================================================================

-- ----- ancora_tabela (tabela de venda de cotas NOVAS — só equipe) -----------
-- Chave de upsert idempotente: (produto, bem_codigo, grupo, plano). Reimportar
-- ATUALIZA a linha no lugar (preço/assembleia/cotas), nunca duplica.
create table if not exists ancora_tabela (
  id                        uuid primary key default gen_random_uuid(),

  -- identificação do produto/bem (do portal)
  produto                   text not null,          -- ex.: "IMÓVEL", "VEÍCULO"
  bem_codigo                text not null,           -- ex.: "I100"
  bem_nome                  text,                    -- descrição do bem
  valor_do_bem              numeric(14,2),           -- crédito-base do bem

  -- grupo/plano e prazos
  grupo                     text not null,           -- ex.: "000704"
  plano                     text not null,           -- ex.: "NORMAL", "50%", "INVESTIDOR"
  prazo_grupo               integer,                 -- meses do grupo
  prazo_comercializacao     integer,                 -- meses ofertados na venda

  -- taxas REAIS do portal (fração: 0.18 = 18%). NÃO recalcular.
  taxa_administracao        numeric(6,4),
  fundo_reserva             numeric(6,4),

  -- 1ª parcela REAL, pronta do portal (NÃO recalcular). Pode faltar => null.
  pf_com_seguro             numeric(14,2),           -- pessoa física, com seguro
  pf_sem_seguro             numeric(14,2),
  pj_com_seguro             numeric(14,2),           -- pessoa jurídica, com seguro
  pj_sem_seguro             numeric(14,2),

  -- estado do grupo no portal (fotografia do momento do importar)
  assembleia                text,                    -- nº/identificação da assembleia
  cotas_ativas              integer,
  cotas_vagas               integer,
  status                    text,                    -- status textual do portal

  importado_em              timestamptz not null default now(),

  unique (produto, bem_codigo, grupo, plano)
);

create index if not exists idx_ancora_produto on ancora_tabela(produto);
create index if not exists idx_ancora_grupo   on ancora_tabela(grupo);

-- ----------------------------------------------------------------------------
-- RLS — a trava de acesso da equipe (não é CSS)
-- ----------------------------------------------------------------------------
-- Só usuários cujo e-mail confirmado termina em @prospere.com.br leem/escrevem.
-- Cliente e parceiro comuns NÃO enxergam nenhuma linha: o SELECT é negado na
-- origem. service_role (importador) bypassa RLS, mas a rota confere o domínio
-- ANTES de escrever (defesa em duas camadas).
alter table ancora_tabela enable row level security;

create policy ancora_tabela_equipe_select on ancora_tabela
  for select
  to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) like '%@prospere.com.br');

-- Escrita também restrita à equipe (além do service_role do importador).
create policy ancora_tabela_equipe_write on ancora_tabela
  for all
  to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) like '%@prospere.com.br')
  with check (lower(coalesce(auth.jwt() ->> 'email', '')) like '%@prospere.com.br');

-- ----------------------------------------------------------------------------
-- Verificação rápida (opcional, após aplicar, no DEV):
--   -- como usuário @prospere.com.br: deve ler (0 linhas até importar)
--   select count(*) from ancora_tabela;
--   -- como cliente comum: deve dar acesso negado / 0 linhas (RLS bloqueia)
-- ----------------------------------------------------------------------------
