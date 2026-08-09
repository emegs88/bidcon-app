-- ============================================================================
-- FAROL-SABER-01 · farol_saber — a base de conhecimento da casa
-- AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-SABER-01", 08/08/2026:
-- "base de conhecimento + vídeo-resposta".
-- ----------------------------------------------------------------------------
-- FILE-FIRST: este arquivo é rascunho revisável. QUEM APLICA EM PRODUÇÃO É O
-- EMERSON, pelo SQL editor do Supabase. O agente não aplica nada em PROD.
--
-- ****************************************************************************
-- APLICAR NO PROJETO **xtv** — bidcon-vitrine-operacao (xtvjpnyadcdeadhmzyff).
-- NÃO é o nnv. Esta pasta de migrações serve aos DOIS projetos, e aplicar no
-- errado NÃO dá erro: dá uma base de conhecimento que existe e que ninguém
-- consegue enxergar. Medido em 08/08/2026, direto nos dois bancos:
--
--                       nnv (bidcon-portal-auth)   xtv (vitrine-operacao)
--   wa_mensagens ...... NÃO EXISTE                 sim (158 msgs de cliente)
--   farol_* ........... 0 tabelas                  5 tabelas
--   pgvector .......... instalada                  instalada
--
-- O FAQ VIVO lê `wa_mensagens`, e as outras cinco tabelas do FAROL são as
-- vizinhas naturais desta — ambas só existem no xtv. Todo o código do FAROL e
-- todo o código que toca `wa_mensagens` usa `createXtvClient`, inclusive a
-- rota POST /api/farol/saber.
-- ****************************************************************************
--
-- ---------------------------------------------------------------------------
-- A REGRA Nº 1 DA OS FOI CUMPRIDA ANTES DE UMA LINHA DESTE ARQUIVO EXISTIR.
-- A ordem mandou MEDIR o cron `backfill-embeddings` e REUSAR, só criando coisa
-- nova se a medição provasse incompatibilidade. Medido:
--
--   tabela hoje vetorizada .... `cartas` (0007_busca_semantica.sql)
--   colunas ................... descricao / embedding vector(1536) / embedding_em
--   modelo .................... OpenAI text-embedding-3-small
--   dimensão .................. 1536 (EMBEDDING_DIMENSOES, lib/ia.ts)
--   índice .................... HNSW, vector_cosine_ops, PARCIAL (embedding not null)
--   operador de distância ..... <=>  (cosseno)
--   busca ..................... RPC buscar_cartas_semantica(), SECURITY DEFINER
--   cron ...................... /api/backfill-embeddings, 30 * * * *, guard CRON_SECRET,
--                               lote 25, idempotente, falha unitária não derruba o lote
--
-- O QUE FOI REUSADO, LITERAL: `gerarEmbedding()` e `embeddingParaSQL()` de
-- lib/ia.ts. Elas recebem QUALQUER texto — não são específicas de carta — então
-- não há motivo para uma segunda camada de embedding no projeto. Por
-- consequência, `vector(1536)` e `vector_cosine_ops` aqui NÃO são escolha
-- minha: são obrigação. Um vetor de 1536 gerado pelo text-embedding-3-small só
-- é comparável com outro do mesmo modelo. Mudar o modelo depois exige
-- revetorizar as duas tabelas juntas.
--
-- O QUE **NÃO** DEU PARA REUSAR, E POR QUÊ (a incompatibilidade que a OS pediu
-- para eu declarar se existisse): a RPC `buscar_cartas_semantica()`. Ela devolve
-- colunas de `cartas` (valor_credito, valor_entrada, qtd_parcelas) e filtra
-- `status = 'disponivel'`. Não é uma busca genérica com nome infeliz — é a
-- vitrine. Conhecimento não tem preço nem status de estoque. Por isso nasce
-- `buscar_saber()` abaixo, com a MESMA mecânica (HNSW + <=> + SECURITY DEFINER)
-- e outra saída. Duas tabelas, duas RPCs, UMA camada de embedding.
--
-- ---------------------------------------------------------------------------
-- POR QUE `unique (fonte, titulo)`. As sementes são semeadas por uma rota que o
-- Emerson vai chamar mais de uma vez (ao corrigir um texto, ao acrescentar um
-- verbete). Sem chave natural, cada chamada duplicaria a base inteira e a busca
-- passaria a devolver o mesmo trecho três vezes nos 5 resultados — que é como
-- uma base de conhecimento morre em silêncio. Com o unique, semear vira upsert.
--
-- POR QUE `ocorrencias`. É o FAQ VIVO: a mesma dúvida chega de dez clientes com
-- dez redações diferentes. Guardar as dez seria dez linhas quase idênticas
-- competindo entre si na busca. Guardamos UMA e contamos. O número também é o
-- que responde "qual a pergunta que mais chega?" — insumo direto da série
-- "Responde, Porta-voz" e da pauta.
--
-- DADO PESSOAL NÃO ENTRA AQUI. REGRA DURA, E ELA VIVE NO CÓDIGO, NÃO NO PROMPT.
-- O FAQ VIVO lê `wa_mensagens` (papel='cliente'), que é conversa real de gente
-- real. O que é gravado nesta tabela passa antes por `anonimizar()`
-- (lib/farol/saber.ts), que remove telefone, e-mail, CPF/CNPJ, @ e sequências
-- longas de dígitos. Não há coluna aqui para telefone, nome ou conversa_id de
-- propósito: o que não tem onde ser guardado não vaza. Esta tabela responde
-- "o que perguntam", nunca "quem perguntou".
--
-- SEM FK PARA `wa_mensagens`. Mesma razão das outras tabelas do FAROL: a origem
-- pode ser apagada (direito do titular, expurgo) e o conhecimento destilado é
-- registro agregado que não pode sumir em cascata por causa disso. E uma FK
-- aqui seria, ela própria, um ponteiro para a pessoa — exatamente o que o
-- parágrafo acima proíbe.
--
-- RLS LIGADA, ZERO POLICY. Padrão das tabelas do FAROL (0068/0069/0070/0071):
-- o service_role ignora RLS e é ele quem lê e escreve; ligar sem policy é o que
-- fecha a porta para a chave anônima do navegador. Tabela sem RLS ligada é
-- tabela pública.
--
-- ESCOPO: 1 extensão (já existente, idempotente), 1 tabela, 2 índices, 1 função,
-- 1 grant. Nenhuma policy existente é alterada. Nenhum dado existente é tocado.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) pgvector. Já foi criada pela 0007; repetida aqui porque uma migração deve
--    poder ser lida e aplicada sozinha. `if not exists` é idempotente.
-- ----------------------------------------------------------------------------
create extension if not exists vector;

-- ----------------------------------------------------------------------------
-- 2) A tabela.
--    fonte  — de onde o verbete veio. CHECK e não ENUM pelo mesmo motivo da
--             0071: enum exige migração para ganhar um valor; esta lista vai
--             crescer. Os sete valores são os da OS, literais.
--    tags   — text[] para peneirar sem precisar de outra tabela. A busca é por
--             vetor; as tags são para o humano e para relatório.
--    vigencia — data até quando o verbete vale (uma norma revogada, uma regra
--             de administradora que mudou). NULL = sem prazo. A busca NÃO filtra
--             por ela hoje de propósito: filtrar silenciosamente esconderia a
--             existência do verbete de quem for auditar. Quem consome decide.
-- ----------------------------------------------------------------------------
create table if not exists farol_saber (
  id           uuid primary key default gen_random_uuid(),
  fonte        text not null
                 check (fonte in ('lei','abac','administradora','processo','faq','glossario','caso')),
  titulo       text not null,
  conteudo     text not null,
  embedding    vector(1536),
  tags         text[],
  vigencia     date,
  ocorrencias  int  not null default 1,
  criado_em    timestamptz not null default now(),
  unique (fonte, titulo)
);

-- ----------------------------------------------------------------------------
-- 3) Índices.
--    (a) HNSW parcial — cópia fiel do padrão da 0007. `vector_cosine_ops` casa
--        com o `<=>` da RPC abaixo; parcial porque verbete recém-inserido pode
--        passar alguns instantes sem vetor e não há por que indexá-lo.
--    (b) ocorrencias desc — o "top de dúvidas" é a consulta do relatório e da
--        série Responde. Parcial em 'faq' porque é o único fonte que acumula.
-- ----------------------------------------------------------------------------
create index if not exists farol_saber_embedding_hnsw
  on farol_saber using hnsw (embedding vector_cosine_ops)
  where embedding is not null;

create index if not exists farol_saber_faq_top_idx
  on farol_saber (ocorrencias desc)
  where fonte = 'faq';

-- ----------------------------------------------------------------------------
-- 4) buscar_saber — vizinhança por cosseno dentro do conhecimento.
--    Existe porque ordenar por `<=>` NÃO é expressável pelo PostgREST: sem uma
--    função, o servidor teria de baixar a tabela inteira e ordenar em
--    JavaScript. Uma RPC é a única forma de a ordenação acontecer no banco.
--
--    p_fontes  — peneira opcional por origem (ex.: só 'lei' e 'processo' quando
--                o assunto é segurança). NULL = todas.
--    score     — 1 - distância. É PARECENÇA DE TEXTO, e nada mais. Nunca é
--                confiança jurídica e jamais pode ser mostrada ao cliente como
--                se fosse — o consumidor usa o trecho, não o número.
--
--    GRANT SÓ PARA service_role, e aqui está a diferença deliberada para a
--    0007: aquela busca serve o NAVEGADOR do cliente logado, então concede a
--    `authenticated`. Esta serve o cérebro do WhatsApp e os crons do FAROL, que
--    rodam no servidor com service_role. Conceder a `authenticated` abriria a
--    base interna (regra de administradora, processo) para qualquer conta
--    logada. Não abre.
-- ----------------------------------------------------------------------------
create or replace function public.buscar_saber(
  p_embedding vector(1536),
  p_limite    int      default 5,
  p_fontes    text[]   default null
)
returns table (
  id       uuid,
  fonte    text,
  titulo   text,
  conteudo text,
  score    double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.fonte,
    s.titulo,
    s.conteudo,
    (1 - (s.embedding <=> p_embedding))::double precision as score
  from farol_saber s
  where s.embedding is not null
    and (p_fontes is null or s.fonte = any(p_fontes))
  order by s.embedding <=> p_embedding
  limit greatest(1, least(coalesce(p_limite, 5), 20));
$$;

revoke all on function public.buscar_saber(vector, int, text[]) from public;
grant execute on function public.buscar_saber(vector, int, text[]) to service_role;

-- ----------------------------------------------------------------------------
-- 5) RLS.
-- ----------------------------------------------------------------------------
alter table farol_saber enable row level security;

comment on table farol_saber is
  'Base de conhecimento do FAROL (FAROL-SABER-01). Vetorizada com o MESMO modelo das cartas (text-embedding-3-small, 1536-d) para haver uma só camada de embedding no projeto. fonte=faq é alimentada pelo FAQ VIVO a partir de wa_mensagens, SEMPRE anonimizada (lib/farol/saber.ts) — esta tabela responde "o que perguntam", nunca "quem perguntou". Busca pela RPC buscar_saber(), concedida só a service_role.';

-- ============================================================================
-- Verificação rápida (após aplicar):
--   select fonte, count(*) from farol_saber group by fonte order by 2 desc;
--   select indexname from pg_indexes where tablename = 'farol_saber';
--   -- a busca precisa de um vetor real, gerado pelo servidor:
--   --   POST /api/farol/saber  (semeia e vetoriza)
-- ============================================================================
