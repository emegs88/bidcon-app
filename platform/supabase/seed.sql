-- ============================================================================
-- Bidcon — plataforma logada · SEED de TESTE (Fase 1)
-- ----------------------------------------------------------------------------
-- DADOS 100% FICTÍCIOS — nenhum dado real de cliente (LGPD).
-- Objetivo: popular o banco para testar as telas /meu-processo sem cadastro
-- manual. Rode em ambiente de DESENVOLVIMENTO, nunca em produção com dados reais.
--
-- Como usar (você, no Supabase do projeto de dev):
--   1) aplique 0001, 0002, 0003;
--   2) crie os usuários de auth (abaixo) e rode este seed no SQL Editor.
--
-- IMPORTANTE sobre auth: profiles.id referencia auth.users(id). Para login real
-- por magic link, crie os usuários pelo painel Supabase (Authentication > Users
-- > Add user) com estes e-mails/UUIDs OU via API admin. Os INSERTs em auth.users
-- abaixo funcionam no SQL Editor do Supabase (que roda como superusuário) para
-- ambiente de dev; se preferir, pule-os e crie pelo painel usando os mesmos UUIDs.
-- ============================================================================

-- UUIDs fixos fictícios (fáceis de reconhecer)
-- cliente A : aaaaaaaa-...   cliente B : bbbbbbbb-...   parceiro : cccccccc-...

-- ----- (opcional) usuários de auth para dev -------------------------------
insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at, aud, role)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cliente.a@exemplo.test', '{}', now(), now(), 'authenticated', 'authenticated'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'cliente.b@exemplo.test', '{}', now(), now(), 'authenticated', 'authenticated'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'parceiro@exemplo.test',  '{}', now(), now(), 'authenticated', 'authenticated')
on conflict (id) do nothing;

-- ----- profiles --------------------------------------------------------------
insert into profiles (id, nome, telefone, email, tipo, status) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Ana (teste)',   '+5519000000001', 'cliente.a@exemplo.test', 'cliente',  'ativo'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Bruno (teste)', '+5519000000002', 'cliente.b@exemplo.test', 'cliente',  'ativo'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Parceiro (teste)', '+5519000000003', 'parceiro@exemplo.test', 'parceiro', 'ativo')
on conflict (id) do nothing;

-- ----- cartas (estoque fictício) --------------------------------------------
insert into cartas (id, parceiro_id, tipo, valor_credito, valor_entrada, status) values
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'imovel',  250000.00, 60000.00, 'reservada'),
  ('22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'veiculo',  90000.00, 22000.00, 'disponivel')
on conflict (id) do nothing;

-- ----- processos -------------------------------------------------------------
-- Ana: processo em "análise na administradora" (estado intermediário p/ testar timeline)
insert into processos (id, cliente_id, parceiro_id, carta_id, status, valor_carta, valor_entrada) values
  ('33333333-3333-3333-3333-333333333333',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111',
   'analise_administradora', 250000.00, 60000.00)
on conflict (id) do nothing;
-- Bruno: sem processo (para testar o estado vazio da tela).

-- ----- processo_eventos (timeline do processo da Ana) -----------------------
insert into processo_eventos (processo_id, de_status, para_status, nota, em) values
  ('33333333-3333-3333-3333-333333333333', null,                       'reservada',              'Carta reservada para o cliente.', now() - interval '6 days'),
  ('33333333-3333-3333-3333-333333333333', 'reservada',                'documentacao',           'Documentos solicitados.',         now() - interval '4 days'),
  ('33333333-3333-3333-3333-333333333333', 'documentacao',             'analise_administradora', 'Enviado à administradora.',       now() - interval '1 day');

-- Resultado esperado na tela /meu-processo (logado como Ana):
--   timeline com Reservada e Documentação concluídas, "Em análise na
--   administradora" como estado atual, Transferência e Concluído pendentes.
-- Logado como Bruno: estado vazio (sem processo).
