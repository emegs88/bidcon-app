-- ============================================================================
-- Bidcon — plataforma logada · Migration 0007 · Busca semântica (pgvector)
-- ----------------------------------------------------------------------------
-- Rascunho para revisão. RODA EM PRODUÇÃO PELO EMERSON (SQL editor do Supabase).
-- O agente NÃO aplica nada em PROD — aqui só validamos a sintaxe localmente.
--
-- OBJETIVO (Nível 3 — "ser achado pela IA"): permitir que o cliente descreva o
--   que quer em linguagem natural ("apê de uns 300 mil com entrada baixa") e a
--   plataforma rankeie as cartas por SIGNIFICADO, não só por filtro exato.
--
-- ARQUITETURA HÍBRIDA (decisão de projeto — ver lib/ia.ts):
--   1) Um LLM no servidor extrai FILTROS DUROS do texto (tipo do bem, teto de
--      crédito, teto de entrada). Esses filtros viram WHERE em SQL — EXATOS.
--      Preço de produto financeiro NUNCA pode ser "aproximado": ninguém com
--      orçamento de R$ 80 mil quer ver carta de R$ 120 mil. O vetor não decide
--      preço; o SQL decide.
--   2) DENTRO do conjunto já filtrado, ordenamos por SIMILARIDADE de embedding
--      (distância de cosseno entre o vetor do desejo e o vetor da carta). É o
--      vetor que captura a nuance ("pra família crescer", "primeiro imóvel").
--   => Precisão financeira do SQL + nuance semântica do vetor.
--
-- POR QUE PRECISAMOS DE `descricao`:
--   Carta hoje é só número (crédito, entrada, parcela). Número não tem nuance
--   semântica útil para embeddings. Adicionamos um texto curto, COMPLIANCE-SAFE,
--   gerado pelo backfill (scripts/backfill-embeddings.ts) — é ELE que é
--   vetorizado. Sem isso, embedding não agrega nada sobre o SQL puro.
--
-- COMPLIANCE: nada aqui gera ou guarda promessa de contemplação/prazo. A
--   `descricao` é texto neutro de catálogo (poder de compra, planejamento
--   patrimonial); a checagem de termos proibidos vive na camada que ESCREVE o
--   texto (lib/ia.ts + backfill), não no SQL.
--
-- SEGURANÇA: a RPC de busca é SECURITY DEFINER e retorna SOMENTE campos públicos
--   de carta `disponivel`. Nunca expõe parceiro_id, dado de cliente ou processo.
--   Mantém a mesma fronteira da vitrine (0005): só estoque disponível.
--
-- Escopo desta migration: extensão vector + 3 colunas em `cartas` + 1 índice
--   HNSW + 1 função de busca + grant. Nenhuma policy é alterada. Nenhum dado é
--   tocado (as colunas novas nascem NULL; o backfill preenche depois).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Extensão pgvector. No Supabase ela vive no schema `extensions`; o
--    `create extension if not exists` é idempotente e seguro de re-rodar.
-- ----------------------------------------------------------------------------
create extension if not exists vector;

-- ----------------------------------------------------------------------------
-- 2) Colunas de busca em `cartas`.
--    - descricao:    texto curto e neutro do catálogo (gerado pelo backfill).
--    - embedding:    vetor 1536-d (OpenAI text-embedding-3-small) da descricao.
--    - embedding_em: carimbo de quando o vetor foi (re)gerado — permite
--                    reprocessar só o que mudou.
--    Tudo IF NOT EXISTS para a migration ser re-rodável sem erro.
-- ----------------------------------------------------------------------------
alter table cartas
  add column if not exists descricao    text,
  add column if not exists embedding    vector(1536),
  add column if not exists embedding_em  timestamptz;

-- ----------------------------------------------------------------------------
-- 3) Índice HNSW para vizinhança aproximada por cosseno.
--    `vector_cosine_ops` casa com o operador <=> usado na ordenação da RPC.
--    HNSW dá ótima recall/latência no volume de um catálogo de cartas. Índice
--    parcial: só indexa linhas que JÁ têm vetor (ignora o estoque sem embedding).
-- ----------------------------------------------------------------------------
create index if not exists idx_cartas_embedding_hnsw
  on cartas using hnsw (embedding vector_cosine_ops)
  where embedding is not null;

-- ----------------------------------------------------------------------------
-- 4) buscar_cartas_semantica — o coração da busca híbrida.
--    Entradas:
--      p_embedding   vetor do desejo do cliente (gerado no servidor).
--      p_tipo        filtro DURO de tipo do bem (NULL = qualquer).
--      p_valor_max   teto DURO de crédito (NULL = sem teto).
--      p_entrada_max teto DURO de entrada (NULL = sem teto).
--      p_limite      quantos resultados (default 3; clamp 1..12).
--    Regras:
--      - SECURITY DEFINER: roda com privilégio do dono p/ poder ler o estoque
--        (parceiro_id NULL) e ordenar pelo vetor, MAS só devolve carta pública.
--      - SEMPRE restringe a status='disponivel' (mesma fronteira da vitrine).
--      - SEMPRE exige embedding not null (sem vetor não há como rankear).
--      - Filtros duros são opcionais (coalesce → ignora quando NULL).
--      - Ordena por distância de cosseno (menor = mais parecido).
--      - Retorna `score` = 1 - distância (1.0 = idêntico, 0 = ortogonal) só para
--        a UI poder sinalizar relevância; nunca é "chance de contemplação".
--    NÃO retorna: parceiro_id, descricao crua, embedding, nada de cliente.
-- ----------------------------------------------------------------------------
create or replace function public.buscar_cartas_semantica(
  p_embedding   vector(1536),
  p_tipo        tipo_bem      default null,
  p_valor_max   numeric       default null,
  p_entrada_max numeric       default null,
  p_limite      int           default 3
)
returns table (
  id            uuid,
  tipo          tipo_bem,
  valor_credito numeric,
  valor_entrada numeric,
  valor_parcela numeric,
  qtd_parcelas  int,
  score         double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.tipo,
    c.valor_credito,
    c.valor_entrada,
    c.valor_parcela,
    c.qtd_parcelas,
    (1 - (c.embedding <=> p_embedding))::double precision as score
  from cartas c
  where c.status = 'disponivel'
    and c.embedding is not null
    and (p_tipo        is null or c.tipo          =  p_tipo)
    and (p_valor_max   is null or c.valor_credito <= p_valor_max)
    and (p_entrada_max is null or coalesce(c.valor_entrada, 0) <= p_entrada_max)
  order by c.embedding <=> p_embedding
  limit greatest(1, least(coalesce(p_limite, 3), 12));
$$;

-- ----------------------------------------------------------------------------
-- 5) Grant: o client autenticado pode CHAMAR a busca (a função já limita a
--    saída a estoque disponível). Anônimo (anon) não chama — busca é da área
--    logada, como a vitrine.
-- ----------------------------------------------------------------------------
revoke all on function
  public.buscar_cartas_semantica(vector, tipo_bem, numeric, numeric, int)
  from public;

grant execute on function
  public.buscar_cartas_semantica(vector, tipo_bem, numeric, numeric, int)
  to authenticated;

-- ============================================================================
-- Verificação rápida (opcional, após aplicar E depois de rodar o backfill):
--   -- 1) extensão e colunas existem:
--   select extname from pg_extension where extname = 'vector';
--   \d cartas   -- deve listar descricao / embedding / embedding_em
--   -- 2) índice existe:
--   select indexname from pg_indexes where indexname = 'idx_cartas_embedding_hnsw';
--   -- 3) busca (passe um vetor real do servidor; aqui só o shape importa):
--   --   select * from buscar_cartas_semantica('[...1536 nums...]'::vector,
--   --                                          'imovel', 400000, null, 3);
-- ============================================================================
