-- ============================================================================
-- 0073_farol_olheiro — o que o nicho está publicando, e a que velocidade
-- AUTORIZADO: Emerson Gomes dos Santos — coordenação de 09/08/2026:
--   "LISTA DE CANAIS: não é sua nem minha — é da API. Rotina semanal usa
--    search.list (máx 10 buscas/semana) só para DESCOBRIR canais do nicho e
--    popular uma tabela farol_canais (id, channel_id, nome, descoberto_em,
--    ativo). O DIÁRIO roda por canal: channels.list + playlistItems.list +
--    videos.list (~2 unidades/canal), zero search. (...) Gravar por vídeo:
--    canal, video_id, título, publicado_em, views, likes, duração, VELOCIDADE
--    (views/dia desde a publicação) e coletado_em; UNIQUE por video_id
--    atualizando métricas (a evolução é sinal)."
-- ----------------------------------------------------------------------------
-- PARA QUE ISTO EXISTE. A ESCUTA hoje escolhe pauta por dentro: o que a casa
-- acha que interessa. O olheiro traz a evidência de FORA — "este assunto rendeu
-- 40 mil views em 3 dias no canal X" — para que o "por que agora" de uma pauta
-- seja um número medido e não uma impressão.
--
-- ----------------------------------------------------------------------------
-- POR QUE DUAS TABELAS E NÃO UMA
-- ----------------------------------------------------------------------------
-- Canal e vídeo têm CICLOS DE VIDA opostos. Canal é caro de descobrir (custa
-- busca, e são 100 buscas/dia no balde inteiro) e muda de ano em ano. Vídeo é
-- barato de listar e muda todo dia. Numa tabela só, cada varredura diária
-- reescreveria a linha do canal — e `descoberto_em`, que é o único registro de
-- COMO aquele canal entrou na lista, seria perdido na primeira coleta.
--
-- ----------------------------------------------------------------------------
-- farol_canais — a lista de vigiados
-- ----------------------------------------------------------------------------
create table if not exists farol_canais (
  id             uuid primary key default gen_random_uuid(),
  -- channelId do YouTube (texto do Google, "UC..."). UNIQUE porque a descoberta
  -- semanal roda com termos que se sobrepõem de propósito: "consórcio" e "carta
  -- contemplada" devolvem os mesmos canais grandes. A UNIQUE é o que deixa a
  -- rotina ser burra e reexecutável — ela insere tudo e o banco recusa o
  -- repetido, em vez de a aplicação ter que lembrar o que já viu.
  channel_id     text not null unique,
  nome           text,

  -- ID da playlist "uploads" do canal, de channels.list
  -- (contentDetails.relatedPlaylists.uploads). CACHEADO AQUI DE PROPÓSITO: é o
  -- que permite a varredura diária pular o channels.list e ir direto ao
  -- playlistItems.list. Um canal cacheado custa 1 unidade/dia em vez de 2 — pela
  -- metade, e sem nunca ficar obsoleto: o id da playlist de uploads é derivado
  -- do channelId e não muda enquanto o canal existir.
  uploads_playlist text,

  -- Termo de busca que TROUXE este canal. Não é enfeite: quando a lista tiver
  -- 80 canais e metade for irrelevante, é esta coluna que diz QUAL termo está
  -- sujando a lista, e permite corrigir o termo em vez de desativar 40 canais
  -- na mão.
  termo          text,
  descoberto_em  timestamptz not null default now(),

  -- Última vez que a varredura diária passou por aqui. Serve para dois usos:
  -- ordenar a fila (varre primeiro quem está mais atrasado) e diagnosticar
  -- canal que some (visto_em velho + ativo = algo quebrou, e é silencioso).
  visto_em       timestamptz,

  -- Desligar é do Emerson, pelo painel (ordem literal: "Emerson pode marcar
  -- canal como inativo pelo painel depois"). A varredura diária só lê `ativo`;
  -- NADA no código escreve false aqui. Curadoria é decisão humana — um canal
  -- que passou 30 dias sem publicar pode ser o mais importante do nicho.
  ativo          boolean not null default true
);

-- A fila da varredura diária: ativos primeiro, mais atrasados na frente.
-- `nulls first` é deliberado — canal recém-descoberto tem visto_em nulo e é
-- justamente o que ninguém coletou ainda.
create index if not exists farol_canais_fila_idx
  on farol_canais (ativo, visto_em asc nulls first);

alter table farol_canais enable row level security;

comment on table farol_canais is
  'Canais do nicho vigiados pelo FAROL-OLHEIRO. Descobertos por search.list semanal (<=10 buscas/semana); a varredura diária lê daqui e nunca busca. ativo=false é curadoria humana pelo painel.';

-- ----------------------------------------------------------------------------
-- farol_videos — o que eles publicaram, e a que velocidade rende
-- ----------------------------------------------------------------------------
create table if not exists farol_videos (
  id            uuid primary key default gen_random_uuid(),
  -- channelId, texto do Google. SEM FK para farol_canais de propósito: o vídeo
  -- é fato observado do YouTube e não deve sumir nem travar porque alguém
  -- reorganizou a lista de vigiados. Mesma razão de farol_yt_comentarios não
  -- ter FK para nada.
  canal         text not null,
  -- A trava de idempotência inteira desta fatia. Ver "UPSERT" no bloco abaixo.
  video_id      text not null unique,
  titulo        text,
  publicado_em  timestamptz,

  views         bigint,
  likes         bigint,
  duracao_s     integer,

  -- views/dia desde a PUBLICAÇÃO. É a métrica que a OS pediu, e ela responde
  -- "este vídeo rendeu?". Numeric e não float: é número que vai para relatório
  -- e para comparação, e float acumula sujeira em ordenação.
  velocidade    numeric(14,2),

  -- --------------------------------------------------------------------------
  -- ADIÇÃO DECLARADA — as duas colunas de EVOLUÇÃO
  -- --------------------------------------------------------------------------
  -- A ordem foi "UNIQUE por video_id atualizando métricas (a evolução é
  -- sinal)". O upsert cumpre a primeira metade, mas sozinho ele DESTRÓI a
  -- segunda: sobrescrever `views` a cada coleta apaga a leitura anterior, e sem
  -- duas leituras não existe evolução para observar. A tabela ficaria dizendo
  -- que a evolução é sinal e guardando só fotografias.
  --
  -- Guardar histórico completo pedia uma terceira tabela crescendo sem teto.
  -- Guardar a leitura ANTERIOR — duas colunas — dá a derivada com custo fixo,
  -- que é o que a ESCUTA precisa.
  --
  -- E ELA É MELHOR QUE `velocidade` PARA O "POR QUE AGORA". `velocidade` é
  -- média de vida inteira: um vídeo que explodiu há 60 dias e morreu continua
  -- exibindo média alta para sempre. `velocidade_recente` é o que aconteceu
  -- ENTRE AS DUAS ÚLTIMAS coletas — é ela que distingue "está bombando agora"
  -- de "bombou uma vez". Pauta se faz com a segunda pergunta.
  views_anterior      bigint,
  coletado_anterior_em timestamptz,
  velocidade_recente  numeric(14,2),

  coletado_em   timestamptz not null default now()
);

-- O relatório semanal ordena por velocidade dentro de uma janela de publicação.
-- Índice composto porque as duas colunas entram na MESMA consulta.
create index if not exists farol_videos_ranking_idx
  on farol_videos (publicado_em desc, velocidade desc);

-- A ESCUTA pergunta "o que rendeu AGORA", que é ordenar pela derivada.
create index if not exists farol_videos_recente_idx
  on farol_videos (velocidade_recente desc nulls last);

create index if not exists farol_videos_canal_idx
  on farol_videos (canal, publicado_em desc);

alter table farol_videos enable row level security;

comment on table farol_videos is
  'Vídeos observados no nicho pelo FAROL-OLHEIRO. video_id UNIQUE com upsert: as métricas são atualizadas a cada varredura e a leitura anterior fica em views_anterior/coletado_anterior_em, que é o que torna velocidade_recente calculável.';
