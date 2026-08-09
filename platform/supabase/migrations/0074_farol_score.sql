-- ============================================================================
-- 0074_farol_score — o score de outlier, o segmento e o índice interno
-- AUTORIZADO: Emerson Gomes dos Santos — FAROL-SCORE-01, 09/08/2026:
--   "Guardar em farol_videos: velocidade, outlier, score, base_incompleta,
--    calculado_em. (...) Guardar `segmento` e `origem_classificacao`
--    ('regra'|'ia'). (...) gravar em farol_metricas: retenção média (%),
--    alcance em não-seguidores (%), salvamentos, compartilhamentos,
--    comentários, e leads. (...) Migração file-first para as colunas novas e
--    farol_metricas."
-- ----------------------------------------------------------------------------
-- DEPENDÊNCIA DURA E DECLARADA. Esta migração ALTERA `farol_videos`, que nasce
-- na 0073_farol_olheiro.sql. A 0073 está ESCRITA MAS AINDA NÃO APLICADA no
-- Supabase xtv (medido em 09/08/2026). Aplicar esta antes daquela falha no
-- primeiro `alter table` — de propósito: `alter table` de tabela inexistente é
-- erro alto e imediato, e é melhor do que um `if not exists` silencioso que
-- deixaria o banco meio pronto sem ninguém saber.
--
-- ORDEM OBRIGATÓRIA:  0073  →  0074.
-- ----------------------------------------------------------------------------
-- PARA QUE ISTO EXISTE. A 0073 respondeu "o que o nicho publicou e a que
-- velocidade". Ela não responde "isso foi bom PARA AQUELE CANAL". 40 mil views
-- num canal de 2 milhões é rotina; 20 mil num canal de 2 mil é ruptura. As
-- colunas abaixo guardam essa diferença, que é a tese inteira da OS.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- PARTE A — farol_videos ganha o que o score precisa ler e o que ele produz
-- ----------------------------------------------------------------------------

-- comentarios: ACHADO 3 DA AUDITORIA. A fórmula do engajamento da OS é
-- (likes + comentarios) / views, e `comentarios` NÃO EXISTIA em lugar nenhum do
-- schema — a 0073 gravou views/likes/duracao_s e mais nada. Sem esta coluna a
-- fórmula autorizada é impossível de calcular.
--
-- CUSTO DE QUOTA: ZERO. `videos.list` já devolve `statistics.commentCount` na
-- MESMA chamada que traz viewCount e likeCount — a varredura diária não muda de
-- preço, só passa a guardar um campo que já vinha na resposta e era descartado.
--
-- NULO É PERMITIDO e significa "não medido" (canal com comentários desligados,
-- ou linha coletada antes desta migração). `lib/farol/score.ts` trata ausência
-- como zero: subestima o engajamento, nunca inventa número.
alter table farol_videos add column if not exists comentarios bigint;

-- --------------------------------------------------------------------------
-- A CLASSIFICAÇÃO (Parte 2 da OS)
-- --------------------------------------------------------------------------
-- text e não enum de propósito. O vocabulário dos 8 segmentos vai para revisão
-- do Emerson no READY, e enum em Postgres se altera com DDL — o que
-- transformaria "o Emerson quer renomear um segmento" numa migração. O
-- conjunto válido vive em `SEGMENTOS` (lib/farol/segmentos.ts) e é o que os
-- testes de unidade defendem; aqui é só onde ele pousa.
alter table farol_videos add column if not exists segmento text;

-- 'regra' | 'ia'. NÃO É ENFEITE: a OS manda "nunca reclassificar o que a
-- camada 1 resolveu", e é ESTA coluna que torna a regra executável — o lote
-- diário da IA seleciona `where segmento is null`, e quem já tem origem
-- 'regra' nunca mais é olhado. Sem ela, cada varredura pagaria de novo pela
-- classificação que o dicionário já tinha dado de graça.
alter table farol_videos add column if not exists origem_classificacao text;

-- --------------------------------------------------------------------------
-- O SCORE (Parte 1 da OS)
-- --------------------------------------------------------------------------
-- outlier = velocidade / base_canal. 1.0 = na média do próprio canal;
-- 3.0 = triplicou. É o coração da tese. NULO quando o canal tem menos de 5
-- vídeos coletados — e nulo aqui É INFORMAÇÃO: quer dizer "não sei", que é
-- diferente de "1.0". Nunca preencher com 1.0 por conveniência.
alter table farol_videos add column if not exists outlier numeric(14,4);

-- O composto z-ponderado × recência. Numeric com 4 casas porque é número de
-- ORDENAÇÃO: com 2 casas, empates falsos aparecem no topo da lista e o
-- desempate vira ordem de inserção, que é aleatória.
--
-- ESCALA DE SINAL, NÃO SÉRIE HISTÓRICA (ACHADO 8). O score é z-score dentro da
-- janela de 90 dias: ele é RELATIVO À COORTE do dia em que foi calculado.
-- Comparar o score de hoje com o de um mês atrás não significa nada — a coorte
-- mudou. É `calculado_em` que torna isso visível em vez de virar armadilha.
alter table farol_videos add column if not exists score numeric(14,4);

-- true = o canal deste vídeo não tinha as 5 amostras mínimas, e o score saiu
-- por um caminho DIFERENTE (pesos 0,60/0,40 sobre velocidade+engajamento, sem
-- o termo de outlier). ACHADO 4 DA AUDITORIA: são dois esquemas de peso
-- convivendo na mesma lista ordenada. A flag viaja até a saída de
-- `recomendarPauta()` e DERRUBA a confiança do segmento — é a única defesa
-- honesta contra comparar dois números que não medem a mesma coisa.
--
-- default false, not null: um vídeo sem score calculado tem `calculado_em`
-- nulo, e é isso que diz "não passou pelo score" — não esta coluna.
alter table farol_videos add column if not exists base_incompleta boolean not null default false;

-- Quando o score foi calculado. A OS: "Recalcular a cada coleta (as métricas
-- mudam; o score é derivado, não histórico)". Esta coluna é o que permite
-- verificar que o recálculo REALMENTE roda: `calculado_em` velho com
-- `coletado_em` novo = o score parou de ser recalculado e ninguém percebeu,
-- porque a falha é silenciosa (o ranking continua saindo, só que velho).
alter table farol_videos add column if not exists calculado_em timestamptz;

-- A consulta da Parte 4: "para cada segmento, os 5 vídeos de maior score na
-- janela de 30 dias". Índice parcial — vídeo sem segmento não entra em
-- recomendação nenhuma, e mantê-lo fora do índice deixa o índice do tamanho do
-- que é realmente consultado.
create index if not exists farol_videos_score_idx
  on farol_videos (segmento, score desc nulls last, publicado_em desc)
  where segmento is not null;

-- A fila da camada 2 (IA): "os não classificados vão em lote (máx 20/dia)".
-- Parcial também, e por isto ele encolhe até quase nada conforme a
-- classificação avança — que é exatamente o comportamento desejado.
create index if not exists farol_videos_sem_segmento_idx
  on farol_videos (publicado_em desc)
  where segmento is null;

comment on column farol_videos.outlier is
  'velocidade / mediana da velocidade do próprio canal. NULO = canal com menos de 5 vídeos coletados (não sei), nunca 1.0.';
comment on column farol_videos.score is
  'Composto z-ponderado × recência, RELATIVO à coorte de 90 dias do dia do cálculo. Não é série histórica — ver calculado_em.';
comment on column farol_videos.base_incompleta is
  'true = score saiu pelo esquema de pesos 0,60/0,40 (sem termo de outlier) por falta de base do canal. Derruba a confiança da recomendação.';


-- ----------------------------------------------------------------------------
-- PARTE B — farol_metricas: como as NOSSAS peças renderam
-- ----------------------------------------------------------------------------
-- ACHADO 7 DA AUDITORIA, DECLARADO EM VOZ ALTA: a Parte 3 da OS começa com
-- "depende de FAROL-METRICAS-01" — e FAROL-METRICAS-01 NUNCA FOI CONSTRUÍDA.
-- Não existe no repositório nenhuma rotina que fale com os Insights do IG ou
-- com o YouTube Analytics. Esta tabela nasce, portanto, VAZIA E SEM QUEM A
-- ALIMENTE. Ela é criada agora por dois motivos concretos:
--   1. `indices()` e `agregar()` em lib/farol/score.ts existem e estão
--      testados; sem a tabela eles não teriam onde pousar quando a coleta
--      existir.
--   2. Enquanto ela estiver vazia, a regra de partida a frio da OS dispara
--      100% das vezes — `confianca: 'baixa'`, o externo decide sozinho, e o
--      painel diz isso na cara em vez de fingir estatística com n=0.
--
-- O QUE FALTA PARA ELA VIVER: uma OS FAROL-METRICAS-01 que colete Insights do
-- IG (retenção e alcance em não-seguidores só saem por lá) e grave aqui.
-- ----------------------------------------------------------------------------
create table if not exists farol_metricas (
  id            uuid primary key default gen_random_uuid(),

  -- Identificador da peça publicada. TEXT e sem FK, de propósito e por
  -- medição: a peça pode ser um `farol_reels.post_id` (media id do IG), um
  -- video_id do YouTube, ou um post do feed — três domínios de id diferentes,
  -- nenhum deles uuid. Uma FK aqui obrigaria a escolher UMA origem e
  -- inviabilizaria as outras duas.
  peca_id       text not null,

  -- 'ig' | 'yt'. Sem esta coluna, dois ids iguais de plataformas diferentes
  -- colidiriam na UNIQUE abaixo.
  plataforma    text not null default 'ig',

  -- --------------------------------------------------------------------------
  -- OS TRÊS EIXOS DE AGREGAÇÃO — desnormalizados de propósito
  -- --------------------------------------------------------------------------
  -- A OS pede "agregar por fôrma, por persona e por segmento". Hoje NÃO EXISTE
  -- caminho de join para chegar neles: `farol_reels` guarda carta_id e post_id
  -- e NÃO guarda a fôrma que gerou o roteiro; `formula` só aparece em
  -- `farol_pauta`, que é a agenda do dia e não a peça publicada.
  -- Reconstruir a fôrma por data seria adivinhação. Copiar os três valores no
  -- momento da coleta é a única forma HONESTA de agregar — e tem a vantagem de
  -- congelar o que era verdade na publicação, mesmo que a fôrma mude depois.
  formula       text,          -- 'P1'..'P8' — ver FORMULAS em lib/farol/formulas.ts
  persona       text,          -- 'porta_voz' | 'valentina'
  segmento      text,          -- um dos 8 de lib/farol/segmentos.ts

  -- --------------------------------------------------------------------------
  -- AS MÉTRICAS DA OS
  -- --------------------------------------------------------------------------
  -- FRAÇÕES 0..1, NÃO PERCENTUAIS 0..100. A OS escreve "retenção média (%)" e
  -- "alcance em não-seguidores (%)", e a fórmula do índice usa
  -- 0.35*retencao + 0.35*pct_nao_seguidores — que só fecha com os outros
  -- termos se estes vierem em fração. Se aqui entrasse 41 em vez de 0,41, o
  -- índice sairia ~100x maior e a agregação viraria lixo silencioso. O CHECK
  -- abaixo existe para que esse erro estoure na escrita, e não no relatório.
  retencao            numeric(6,4),
  pct_nao_seguidores  numeric(6,4),

  salvamentos     integer,
  compartilhamentos integer,
  comentarios     integer,

  -- Leads = conversas novas com origem naquele dia (definição literal da OS).
  -- É a única métrica desta tabela que NÃO vem de API de rede social — sai do
  -- nosso próprio WhatsApp. Fica aqui mesmo assim porque a fórmula do índice a
  -- soma junto das outras, e separá-la em outra tabela obrigaria um join só
  -- para calcular uma linha.
  leads           integer,

  -- O índice calculado por lib/farol/score.ts. Guardado (e não só calculado na
  -- leitura) porque ele depende de z-scores da COORTE — recalculá-lo mais tarde
  -- com outra coorte daria outro número para a mesma peça, sem aviso.
  indice          numeric(14,4),

  medido_em     timestamptz not null default now(),
  criado_em     timestamptz not null default now(),

  -- Uma linha por peça por plataforma. A coleta é reexecutável: roda de novo,
  -- atualiza a mesma linha. Sem isto, um cron repetido no mesmo dia duplicaria
  -- a peça e a média por fôrma passaria a contar a mesma peça duas vezes — que
  -- é justamente o erro que a OS combate ao exigir "média + intervalo (n
  -- pequeno mostra o n, sempre)".
  unique (peca_id, plataforma),

  -- Frações são frações. Ver o bloco acima.
  constraint farol_metricas_retencao_fracao
    check (retencao is null or (retencao >= 0 and retencao <= 1)),
  constraint farol_metricas_nao_seguidores_fracao
    check (pct_nao_seguidores is null or (pct_nao_seguidores >= 0 and pct_nao_seguidores <= 1))
);

-- Os três eixos de agregação da OS, um índice cada. Parciais: linha sem o eixo
-- preenchido não participa daquela agregação e não precisa ocupar o índice.
create index if not exists farol_metricas_formula_idx
  on farol_metricas (formula, medido_em desc) where formula is not null;
create index if not exists farol_metricas_persona_idx
  on farol_metricas (persona, medido_em desc) where persona is not null;
create index if not exists farol_metricas_segmento_idx
  on farol_metricas (segmento, medido_em desc) where segmento is not null;

alter table farol_metricas enable row level security;

comment on table farol_metricas is
  'Desempenho das NOSSAS peças publicadas (Parte 3 do FAROL-SCORE-01). NASCE VAZIA: a coleta (FAROL-METRICAS-01) ainda não existe. Enquanto tiver menos de 10 linhas, a partida a frio da OS mantém confianca=baixa e o score externo recomenda sozinho.';
comment on column farol_metricas.retencao is
  'FRAÇÃO 0..1, não percentual 0..100. A fórmula do índice depende disso; há CHECK.';
comment on column farol_metricas.formula is
  'Fôrma que gerou a peça, COPIADA na coleta. Desnormalizado porque farol_reels não guarda a fôrma e não há caminho de join até ela.';
