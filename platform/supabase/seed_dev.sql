-- ============================================================================
-- Bidcon — plataforma logada · SEED DE DESENVOLVIMENTO (NÃO é migration)
-- ----------------------------------------------------------------------------
-- USO: SOMENTE num projeto Supabase de TESTE (DEV: prospere-360-dev), para
--   validar a BUSCA SEMÂNTICA com dados reais. NUNCA rodar em PRODUÇÃO.
--
-- Foco: validar `validacao-nivel3.md` (as 4 buscas). Por isso este seed insere
--   APENAS cartas de ESTOQUE (parceiro_id null) — que é o único universo que a
--   RPC `buscar_cartas_semantica` enxerga (status='disponivel' + embedding not
--   null). NÃO depende de auth.users / profiles (sem FK), então roda direto pelo
--   runner Node (`pg`), sem psql/\set.
--
-- Idempotente: chave de upsert = numero_externo (índice único quando preenchido).
--   Pode reexecutar à vontade. O backfill depois preenche `descricao`+`embedding`.
--
-- SEM compliance proibida: nenhum texto promete contemplação/prazo, nem usa
--   "investimento/desconto/garantido" — as descrições do embedding são geradas
--   pelo `descricaoDeCarta()` (determinístico e neutro), não por este SQL.
-- ============================================================================

-- Limpa só o estoque de teste deste seed (faixa 9000xx) para reexecução limpa.
delete from cartas
 where fonte = '360prospere'
   and numero_externo between 900001 and 900099;

-- ----------------------------------------------------------------------------
-- CARTAS DE ESTOQUE (parceiro_id null). Variadas de propósito:
--   • tipos: imóvel e veículo
--   • valores: baixos e altos, pra exercitar o filtro duro (valor_max) e o teto
--   • perfis de entrada/parcela distintos, pra o ranqueamento por similaridade
--     ter o que ordenar dentro do mesmo tipo (Busca 2).
-- ----------------------------------------------------------------------------
insert into cartas
  (parceiro_id, tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas,
   status, numero_externo, fonte, criado_via, sincronizada_em)
values
  -- ===== VEÍCULOS — exercitam a Busca 1 ("carro até 80 mil") =================
  -- Dois veículos ABAIXO de 80k (devem APARECER, ordenados por similaridade)
  -- e dois ACIMA (devem ser CORTADOS pelo filtro duro valor_max≈80000).
  (null, 'veiculo',  55000.00,  9000.00,  980.00,  60, 'disponivel', 900001, '360prospere', 'sync', now()),  -- carro popular, entrada baixa
  (null, 'veiculo',  78000.00, 15000.00, 1380.00,  60, 'disponivel', 900002, '360prospere', 'sync', now()),  -- carro médio, no limite de 80k
  (null, 'veiculo',  95000.00, 19000.00, 1650.00,  72, 'disponivel', 900003, '360prospere', 'sync', now()),  -- acima de 80k -> deve sair na Busca 1
  (null, 'veiculo', 140000.00, 28000.00, 2200.00,  80, 'disponivel', 900004, '360prospere', 'sync', now()),  -- utilitário/caro -> deve sair na Busca 1

  -- ===== IMÓVEIS — exercitam a Busca 2 (nuance, sem número) ==================
  -- Vários imóveis com perfis de entrada/parcela diferentes pra haver ordenação.
  (null, 'imovel',  180000.00, 30000.00, 1200.00, 180, 'disponivel', 900010, '360prospere', 'sync', now()),  -- 1º imóvel enxuto, entrada baixa
  (null, 'imovel',  250000.00, 45000.00, 1600.00, 180, 'disponivel', 900011, '360prospere', 'sync', now()),  -- família começando
  (null, 'imovel',  300000.00, 24000.00, 1850.00, 200, 'disponivel', 900012, '360prospere', 'sync', now()),  -- ~300k, ENTRADA BAIXA (Busca 3)
  (null, 'imovel',  420000.00, 84000.00, 2450.00, 200, 'disponivel', 900013, '360prospere', 'sync', now()),  -- imóvel maior, entrada alta
  (null, 'imovel',  650000.00, 130000.00, 3600.00, 220, 'disponivel', 900014, '360prospere', 'sync', now()), -- alto padrão

  -- ===== Controle: 1 carta NÃO-disponível (não pode aparecer em busca) =======
  (null, 'veiculo',  60000.00, 12000.00, 1100.00,  60, 'reservada',  900020, '360prospere', 'sync', now()),  -- reservada -> filtrada pela RPC
  (null, 'imovel',  280000.00, 50000.00, 1700.00, 180, 'indisponivel', 900021, '360prospere', 'sync', now()); -- indisponível -> filtrada

-- ----------------------------------------------------------------------------
-- Cobertura das 4 buscas de validacao-nivel3.md:
--   Busca 1  "carro até 80 mil pra trocar o meu"
--            -> tipo=veiculo, valor_max≈80000. Devem vir 900001 e 900002.
--               900003/900004 (>80k) CORTADAS. Nenhum imóvel. 900020 (reservada) fora.
--   Busca 2  "primeiro imóvel pra família crescer com tranquilidade"
--            -> tipo=imovel, sem teto. Lista de imóveis ordenada por similaridade
--               (900010/900011 tendem ao topo pelo perfil enxuto/familiar).
--   Busca 3  "apartamento de uns 300 mil com entrada baixa"
--            -> roda com OPENAI_API_KEY vazia => 503 (degradação). 900012 existe
--               como alvo natural caso queira comparar depois com a chave ativa.
--   Busca 4  "quero garantir que vou ser contemplado mês que vem"
--            -> teste de compliance: a frase de encaixe nunca cita data/prazo/
--               CCB/FIDC; cai no fallback neutro. Qualquer carta serve de pano de
--               fundo; o que se valida é o TEXTO da resposta, não o ranking.
-- ----------------------------------------------------------------------------

-- Conferência rápida (rode no SQL Editor depois do backfill):
--   select numero_externo, tipo, valor_credito, status,
--          (embedding is not null) as vetorizada
--   from cartas where numero_externo between 900001 and 900099
--   order by tipo, valor_credito;
--   -- esperado após backfill: todas 'disponivel' com vetorizada = true;
--   -- as 'reservada'/'indisponivel' podem ou não ter embedding, mas a RPC as ignora.
