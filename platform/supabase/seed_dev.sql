-- ============================================================================
-- Bidcon — plataforma logada · SEED DE DESENVOLVIMENTO (NÃO é migration)
-- ----------------------------------------------------------------------------
-- USO: SOMENTE num projeto Supabase de TESTE, para validar as telas com dados.
--   NUNCA rodar em PRODUÇÃO. O agente não aplica isto em lugar nenhum — é um
--   arquivo entregue ao Emerson para popular um ambiente de teste.
--
-- Pré-requisito: os usuários precisam existir em auth.users ANTES (profiles.id
--   é FK para auth.users). Crie-os no painel Authentication > Users (ou via
--   admin API) e cole os UUIDs nos \set abaixo. Sem isso, os INSERT de profiles
--   falham na FK — de propósito (não criamos contas pelo SQL).
--
-- Idempotente o suficiente para reexecutar: usa ON CONFLICT onde dá. As cartas
--   de estoque usam numero_externo (índice único) como chave.
-- ============================================================================

-- >>> COLE AQUI os UUIDs reais de auth.users (criados no painel Authentication):
\set admin_id     '00000000-0000-0000-0000-000000000001'
\set parceiro_id  '00000000-0000-0000-0000-000000000002'
\set pendente_id  '00000000-0000-0000-0000-000000000003'
\set cliente1_id  '00000000-0000-0000-0000-000000000004'
\set cliente2_id  '00000000-0000-0000-0000-000000000005'

-- ----- PERFIS ----------------------------------------------------------------
insert into profiles (id, nome, telefone, email, tipo, status) values
  (:'admin_id',    'Emerson (Admin)',   '+5519999990001', 'admin@bidcon.com.br',    'admin',    'ativo'),
  (:'parceiro_id', 'Parceiro Ativo',    '+5519999990002', 'parceiro@bidcon.com.br', 'parceiro', 'ativo'),
  (:'pendente_id', 'Parceiro Pendente', '+5519999990003', 'pendente@bidcon.com.br', 'parceiro', 'pendente_aprovacao'),
  (:'cliente1_id', 'Cliente Um',        '+5519999990004', 'cliente1@bidcon.com.br', 'cliente',  'ativo'),
  (:'cliente2_id', 'Cliente Dois',      '+5519999990005', 'cliente2@bidcon.com.br', 'cliente',  'ativo')
on conflict (id) do update
  set nome = excluded.nome, tipo = excluded.tipo, status = excluded.status;

-- ----- CARTAS ----------------------------------------------------------------
-- Estoque Bidcon (parceiro_id null, fonte de sync) — chave: numero_externo.
insert into cartas
  (parceiro_id, tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas,
   status, numero_externo, fonte, criado_via, sincronizada_em)
values
  (null, 'imovel',  350000.00, 70000.00, 2100.00, 180, 'disponivel', 900001, '360prospere', 'sync', now()),
  (null, 'imovel',  520000.00, 98000.00, 3050.00, 200, 'disponivel', 900002, '360prospere', 'sync', now()),
  (null, 'veiculo',  90000.00, 18000.00, 1450.00,  72, 'disponivel', 900003, '360prospere', 'sync', now()),
  (null, 'veiculo', 130000.00, 26000.00, 1980.00,  80, 'disponivel', 900004, '360prospere', 'sync', now())
on conflict (numero_externo) where (numero_externo is not null)
  do update set status = excluded.status, valor_credito = excluded.valor_credito;

-- Cartas do PARCEIRO (carteira própria, parceiro_id preenchido).
insert into cartas
  (parceiro_id, tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas,
   status, fonte, criado_via)
values
  (:'parceiro_id', 'imovel',  410000.00, 82000.00, 2400.00, 180, 'disponivel', 'manual', 'manual'),
  (:'parceiro_id', 'veiculo', 105000.00, 21000.00, 1600.00,  72, 'reservada',  'manual', 'manual');

-- ----- PROCESSOS (jornada de 2 clientes, status variados) --------------------
-- cliente1: em documentação, com o parceiro ativo, sobre uma carta de estoque.
insert into processos (id, cliente_id, parceiro_id, carta_id, status, valor_carta, valor_entrada)
select gen_random_uuid(), :'cliente1_id', :'parceiro_id', c.id, 'documentacao', c.valor_credito, c.valor_entrada
from cartas c where c.numero_externo = 900001;

-- cliente2: reservada, sem carta vinculada ainda.
insert into processos (id, cliente_id, parceiro_id, carta_id, status, valor_carta, valor_entrada)
values (gen_random_uuid(), :'cliente2_id', :'parceiro_id', null, 'reservada', null, null);

-- Trilha mínima da timeline (evento de criação) para cada processo recém-criado.
insert into processo_eventos (processo_id, de_status, para_status, nota)
select p.id, null, 'reservada', 'processo criado (seed)'
from processos p
where p.cliente_id in (:'cliente1_id', :'cliente2_id')
  and not exists (select 1 from processo_eventos e where e.processo_id = p.id);

-- Evento extra de avanço no processo do cliente1 (reservada -> documentacao).
insert into processo_eventos (processo_id, de_status, para_status, nota)
select p.id, 'reservada', 'documentacao', 'docs solicitados (seed)'
from processos p where p.cliente_id = :'cliente1_id' and p.status = 'documentacao';

-- ----- INDICAÇÃO -------------------------------------------------------------
insert into indicacoes (parceiro_id, cliente_id, origem)
values (:'parceiro_id', :'cliente1_id', 'link-seed-001');

-- ----- COMISSÃO (prevista; números são ilustrativos do ambiente de teste) ----
insert into comissoes (parceiro_id, processo_id, percentual, valor_base, valor_comissao, status)
select :'parceiro_id', p.id, 2.00, p.valor_carta, round(p.valor_carta * 0.02, 2), 'prevista'
from processos p where p.cliente_id = :'cliente1_id' and p.valor_carta is not null;

-- ============================================================================
-- Conferência rápida:
--   select tipo, count(*) from profiles group by tipo;
--   select status, count(*) from cartas group by status;
--   select status, count(*) from processos group by status;
--   select status, count(*) from comissoes group by status;
-- ============================================================================
