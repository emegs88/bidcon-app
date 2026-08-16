-- ============================================================================
-- 0082 — radar_alertas: a mesa onde o RADAR escreve
-- SENTINELA-RADAR-01, Parte 2. AUTORIZADO: Emerson, 15/08/2026.
-- Projeto: xtv (xtvjpnyadcdeadhmzyff) — mesma casa do sync, do estoque e do
-- Sentinela, que são as cinco coisas vigiadas.
-- ----------------------------------------------------------------------------
-- UM ALERTA POR CONDIÇÃO — E AQUI ISSO VIRA TRAVA, NÃO COMBINADO
--
-- A ordem disse "um alerta por CONDIÇÃO, não por ocorrência". Escrito só no
-- código, isso é um combinado: a primeira rota que esquecer de conferir antes
-- de inserir abre a segunda linha, e ninguém percebe até a tela ter 18 avisos
-- iguais. A medição de 15–16/08 mostra o tamanho: `sync_raw_ausente` apareceu
-- 18 VEZES em 48h, e são 3 condições (CARTAS, PIFFER, CBC batendo no mesmo
-- endpoint) ao longo de 6 ciclos.
--
-- Por isso a regra desce para o banco como ÍNDICE ÚNICO PARCIAL em
-- (tipo, chave) enquanto `resolvido_em is null`. Duas consequências, ambas
-- desejadas:
--   - inserir a segunda linha da mesma condição aberta é ERRO, não descuido;
--   - resolver libera a chave, então a condição pode voltar a acontecer amanhã
--     e abrir um episódio NOVO, com a sua própria contagem.
--
-- `ocorrencias` é a contagem DENTRO do episódio. As 18 viram 3 linhas com
-- ocorrencias = 6.
--
-- ----------------------------------------------------------------------------
-- POR QUE DUAS FUNÇÕES, E NÃO UM UPSERT
--
-- PostgREST monta `on conflict (tipo, chave)` sem a cláusula WHERE do índice,
-- e o Postgres não consegue inferir um índice PARCIAL a partir disso — o
-- upsert falharia com "no unique or exclusion constraint matching". A escolha
-- é entre afrouxar o índice (perdendo a trava) ou mover a decisão para uma
-- função. A trava é o ponto; a função fica.
--
-- ----------------------------------------------------------------------------
-- SEVERIDADE SÓ SOBE ENQUANTO O ALERTA ESTÁ ABERTO
--
-- Se uma condição foi 'grave' uma vez neste episódio, ela permanece 'grave'
-- até alguém resolver. Rebaixar sozinha esconderia o pior momento de quem
-- chegou depois — e é justamente o pior momento que explica o que aconteceu.
-- O estado ATUAL continua legível em `detalhe`, que é reescrito a cada toque.
-- ============================================================================

create table if not exists radar_alertas (
  id            uuid primary key default gen_random_uuid(),
  -- Qual vigia. Ver TIPOS_RADAR em lib/radar/vigias.ts.
  tipo          text        not null,
  -- A condição específica dentro do vigia: a fonte, 'nivel', 'sem_movimento',
  -- 'sem_publicar', 'envelhecendo'.
  chave         text        not null,
  severidade    text        not null,
  titulo        text        not null,
  -- Os números que sustentam o título, do último toque.
  detalhe       jsonb       not null default '{}'::jsonb,
  -- Quantas vezes a condição foi vista NESTE episódio.
  ocorrencias   int         not null default 1,
  primeira_vez  timestamptz not null default now(),
  ultima_vez    timestamptz not null default now(),
  resolvido_em  timestamptz,
  -- 'radar' quando a própria varredura fechou (a condição parou de valer);
  -- o e-mail de quem clicou, quando foi gente.
  resolvido_por text,
  constraint radar_alertas_severidade_valida
    check (severidade in ('aviso', 'grave')),
  constraint radar_alertas_chave_nao_vazia
    check (length(btrim(tipo)) > 0 and length(btrim(chave)) > 0),
  constraint radar_alertas_ocorrencias_positiva
    check (ocorrencias >= 1),
  -- Resolver é um gesto com autor. Data sem autor é alerta que sumiu sozinho.
  constraint radar_alertas_resolucao_completa
    check ((resolvido_em is null) = (resolvido_por is null))
);

-- A TRAVA. Ver o cabeçalho.
create unique index if not exists radar_alertas_condicao_aberta
  on radar_alertas (tipo, chave)
  where resolvido_em is null;

-- O painel lê "o que está aberto, pior primeiro". Sem este índice ele varre a
-- tabela inteira, que cresce para sempre porque nada é apagado.
create index if not exists radar_alertas_abertos
  on radar_alertas (severidade, ultima_vez desc)
  where resolvido_em is null;

-- O histórico é lido por período quando alguém pergunta "isso já tinha
-- acontecido antes?".
create index if not exists radar_alertas_historico
  on radar_alertas (tipo, chave, primeira_vez desc);

comment on table radar_alertas is
  'SENTINELA-RADAR-01: uma linha por CONDICAO aberta. O indice unico parcial em (tipo, chave) e a regra, nao o combinado.';

alter table radar_alertas enable row level security;
-- Sem policy nenhuma, de propósito: só service_role entra. O painel lê pelo
-- servidor, como todo o resto do /admin.

-- ---------------------------------------------------------------------------
-- Abrir ou reforçar uma condição.
-- ---------------------------------------------------------------------------
create or replace function radar_registrar(
  p_tipo       text,
  p_chave      text,
  p_severidade text,
  p_titulo     text,
  p_detalhe    jsonb default '{}'::jsonb
)
returns table (id uuid, novo boolean, ocorrencias int)
language plpgsql
volatile
set search_path = public
as $$
declare
  v_id  uuid;
  v_occ int;
begin
  update radar_alertas a
     set ultima_vez  = now(),
         ocorrencias = a.ocorrencias + 1,
         titulo      = p_titulo,
         detalhe     = coalesce(p_detalhe, '{}'::jsonb),
         -- Só sobe. Ver o cabeçalho.
         severidade  = case
                         when a.severidade = 'grave' then 'grave'
                         else p_severidade
                       end
   where a.tipo = p_tipo
     and a.chave = p_chave
     and a.resolvido_em is null
  returning a.id, a.ocorrencias into v_id, v_occ;

  if v_id is not null then
    return query select v_id, false, v_occ;
    return;
  end if;

  insert into radar_alertas (tipo, chave, severidade, titulo, detalhe)
  values (p_tipo, p_chave, p_severidade, p_titulo, coalesce(p_detalhe, '{}'::jsonb))
  returning radar_alertas.id, radar_alertas.ocorrencias into v_id, v_occ;

  return query select v_id, true, v_occ;
end;
$$;

comment on function radar_registrar(text, text, text, text, jsonb) is
  'SENTINELA-RADAR-01: abre a condicao ou reforca a que ja esta aberta. Severidade so sobe enquanto aberta.';

-- ---------------------------------------------------------------------------
-- Fechar. Devolve quantas fechou — 0 é resposta legítima (não havia nada
-- aberto), e quem chama precisa distinguir isso de "fechei".
-- ---------------------------------------------------------------------------
create or replace function radar_resolver(
  p_tipo  text,
  p_chave text,
  p_por   text default 'radar'
)
returns int
language plpgsql
volatile
set search_path = public
as $$
declare
  v_n int;
begin
  update radar_alertas a
     set resolvido_em  = now(),
         resolvido_por = coalesce(nullif(btrim(p_por), ''), 'radar')
   where a.tipo = p_tipo
     and a.chave = p_chave
     and a.resolvido_em is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function radar_resolver(text, text, text) is
  'SENTINELA-RADAR-01: fecha a condicao aberta e libera a chave para um episodio futuro. Devolve quantas linhas fechou.';

-- ---------------------------------------------------------------------------
-- CLAUDE.md, Regra 1 — com o mesmo desvio declarado da 0081, e pelo mesmo
-- motivo: quem escreve no RADAR é o cron, pelo service_role. Nenhuma tela
-- chama estas funções direto, então `authenticated` também sai. Afrouxar
-- depois é um `grant`; apertar depois de vazar não é nada.
-- ---------------------------------------------------------------------------
revoke all on function public.radar_registrar(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.radar_registrar(text, text, text, text, jsonb) to service_role;

revoke all on function public.radar_resolver(text, text, text) from public, anon, authenticated;
grant execute on function public.radar_resolver(text, text, text) to service_role;
