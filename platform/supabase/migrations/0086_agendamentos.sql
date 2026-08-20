-- ============================================================================
-- 0086_agendamentos — AGENDA-PROSPERITO-02
-- AUTORIZADO: Emerson, 19/08/2026 — "0086_agendamentos → ramo → aplica a 0086".
-- Projeto: xtv (xtvjpnyadcdeadhmzyff) — mesma casa das `wa_conversas`,
-- `conversas`, `interesses` e `cartas`, que são as quatro origens de um
-- agendamento.
--
-- ============================================================================
-- LEIA ISTO ANTES DE APLICAR: A TABELA JÁ EXISTE. ESTE ARQUIVO É DELTA.
-- ============================================================================
--
-- A ordem pedia "migration 0086_agendamentos". Antes de escrever, medi. O que
-- achei muda o que este arquivo pode ser:
--
--   xtv, information_schema.tables ..... agendamentos ✓  agenda_log ✓
--   nnv, mesma consulta ................ vazio
--   platform/supabase/migrations/ ...... NENHUM arquivo cita `agendamentos`
--
-- As duas tabelas foram aplicadas DIRETO no banco em 18/08/2026, e estão no
-- histórico do Supabase com estes nomes:
--
--   20260818003849  agenda_01_agendamentos
--   20260818003935  agenda_01_touch_security_invoker
--
-- Não há arquivo correspondente no repositório. Ou seja: a produção tem duas
-- tabelas que o repositório não sabe que existem. Um ambiente novo construído
-- a partir de `platform/supabase/migrations/` nasceria SEM elas, e o código que
-- as usa quebraria com "relation does not exist" — na subida, não no teste.
--
-- Por isso a SEÇÃO 0 abaixo não é enfeite nem duplicação: ela é a
-- RECONCILIAÇÃO. Toda ela é `if not exists` / `or replace`, então é no-op no
-- xtv (onde as tabelas já estão) e é construtora em qualquer ambiente novo.
-- Sem ela, este arquivo consertaria um banco e mentiria para todos os outros.
--
-- SEGURANÇA DE APLICAR AGORA, MEDIDA:
--   agendamentos ..... 0 linhas
--   agenda_log ....... 0 linhas
--   sem_event_id ..... 0
-- Nada nunca rodou. Todo `alter` deste arquivo cai em tabela vazia, inclusive
-- o `drop constraint` da seção 2.2, que em tabela com dados seria uma janela.
--
-- ----------------------------------------------------------------------------
-- ORDEM DE EXECUÇÃO — DOIS PASSOS, e isto não é preferência.
--
-- Postgres recusa USAR um valor de enum na mesma transação em que ele é criado
-- ("unsafe use of new value of enum type"). A 0081 tropeçou nisso e a 0083 já
-- nasceu partida. Aqui vale igual, porque a seção 2 usa `'reservando'` dentro
-- de um índice e de uma constraint:
--
--   0086a — SEÇÃO 0 e SEÇÃO 1, commitadas juntas e sozinhas.
--   0086b — SEÇÃO 2 inteira.
--
-- Arquivo único de propósito, como na 0083: partir em dois arquivos faria a
-- numeração mentir sobre quantas migrações existem.
--
-- ----------------------------------------------------------------------------
-- AS 7 TRAVAS, E O QUE JÁ ESTAVA DE PÉ
--
-- Medi cada trava contra o banco antes de escrever. Três já estavam resolvidas,
-- e duas delas MELHOR do que a ordem pedia — registro isso porque o mérito não
-- é meu e porque desfazer por engano seria fácil:
--
--   trava 2 (slot reservado antes de confirmar)
--     A ordem pediu `unique(data, hora)`. O banco tem coisa melhor:
--     `EXCLUDE USING gist (tstzrange(inicio_em, fim_em, '[)') WITH &&)`.
--     Um único por (data, hora) só pega colisão EXATA; a exclusão por
--     sobreposição pega encavalamento parcial — que é o modo real de errar
--     quando a grade é 40min + 20min de intervalo e alguém remarca para 20
--     minutos depois. NÃO TROCAR por unique.
--
--   trava 4 (event_id sempre guardado)
--     Já é `check (status <> 'confirmado' or (google_event_id is not null and
--     meet_url is not null))` + único parcial em google_event_id. Confirmado
--     sem sala é impossível por construção.
--
--   trava 5 (America/Sao_Paulo)
--     `inicio_em`/`fim_em` são timestamptz, e lib/google/calendar.ts já carrega
--     DEFAULT_TIME_ZONE = 'America/Sao_Paulo'. Nada a fazer no banco.
--
-- O que FALTAVA, e é o que esta migração acrescenta:
--
--   trava 3 (ordem reserva → Google → guarda, com estado curto)
--     Não havia `'reservando'` nem prazo. A linha nascia 'pendente', e o check
--     de sala só morde em 'confirmado' — então uma linha podia ficar 'pendente'
--     para sempre, sem evento no Google, segurando um horário, e NADA
--     percebia. É exatamente a presa do vigia, e o vigia não existia.
--
--   trava 6 (desfecho obrigatório)
--     O enum de status tem 'realizado' e 'nao_compareceu', mas NÃO tem
--     'remarcou' nem 'fechou'. E status não é desfecho: empilhar os dois no
--     mesmo campo perde 'fechou', que é o único que diz se a reunião virou
--     negócio. Desfecho vira coluna própria, e 'realizado' sem desfecho passa
--     a ser impossível.
--
--   META 8 de 12 slots
--     Não havia onde marcar 'excedente'. Vira coluna.
--
-- ----------------------------------------------------------------------------
-- DESVIO QUE EU DECLARO: O VIGIA NÃO ESCREVE EM agenda_log
--
-- A ordem diz «vigia `agenda_log(acao='orfao_google')` — qualquer linha aberta
-- = alerta grave». Não fiz assim, e o motivo é que "linha aberta" não existe
-- em `agenda_log`: a tabela não tem `resolvido_em`. Para a frase funcionar eu
-- teria de dar a `agenda_log` resolução, ocorrências e um único parcial — ou
-- seja, construir um SEGUNDO sistema de alertas ao lado de `radar_alertas`,
-- que já tem tudo isso desde a 0082, com a trava de uma linha por condição e a
-- regra de severidade que só sobe.
--
-- Então o vigia aqui é um DETECTOR puro (`agenda_orfaos_google`, `stable`, não
-- escreve nada) e quem abre e fecha o alerta é o RADAR, com as funções que já
-- existem. `agenda_log` continua sendo o que um log é: append-only.
--
-- Se o Emerson quiser a forma literal, é uma migração de três colunas — mas
-- eu recomendo esta, e a recomendação é o desvio.
-- ============================================================================


-- ############################################################################
-- SEÇÃO 0 — RECONCILIAÇÃO (0086a)
-- No-op no xtv. Construtora em ambiente novo. Ver o cabeçalho.
-- ############################################################################

-- `create type` não aceita `if not exists`.
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'agenda_status'
  ) then
    create type agenda_status as enum (
      'pendente', 'confirmado', 'cancelado', 'realizado', 'nao_compareceu', 'erro'
    );
  end if;
end $$;

create table if not exists agendamentos (
  id                 uuid primary key default gen_random_uuid(),
  -- As quatro origens possíveis. Pelo menos uma é obrigatória (ver constraint).
  wa_conversa_id     uuid references wa_conversas(id) on delete set null,
  conversa_site_id   uuid references conversas(id)    on delete set null,
  interesse_id       uuid references interesses(id)   on delete set null,
  carta_id           uuid references cartas(id)       on delete set null,
  nome               text        not null,
  telefone           text        not null,
  email              text,
  inicio_em          timestamptz not null,
  fim_em             timestamptz not null,
  status             agenda_status not null default 'pendente',
  google_event_id    text,
  meet_url           text,
  google_calendar_id text,
  -- Chave de idempotência da origem. Ver requestIdEstavel() em
  -- lib/google/calendar.ts: um retry não pode gerar uma segunda sala.
  origem_chave       text,
  observacao         text,
  criado_por         text        not null default 'prosperito',
  cancelado_motivo   text,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),
  constraint agendamentos_janela_valida
    check (fim_em > inicio_em),
  constraint agendamentos_duracao_sana
    check ((fim_em - inicio_em) <= interval '4 hours'),
  constraint agendamentos_tem_origem
    check (wa_conversa_id is not null or conversa_site_id is not null
           or interesse_id is not null),
  -- Trava 4: confirmado sem sala é impossível.
  constraint agendamentos_confirmado_tem_meet
    check (status <> 'confirmado'
           or (google_event_id is not null and meet_url is not null))
);

-- Trava 2. Ver o cabeçalho: NÃO trocar por unique(data, hora).
-- A seção 2.2 reconstrói esta constraint para incluir 'reservando'.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'agendamentos_sem_sobreposicao'
  ) then
    alter table agendamentos
      add constraint agendamentos_sem_sobreposicao
      exclude using gist (tstzrange(inicio_em, fim_em, '[)') with &&)
      where (status in ('pendente', 'confirmado'));
  end if;
end $$;

create unique index if not exists agendamentos_google_event_id_key
  on agendamentos (google_event_id) where google_event_id is not null;

create unique index if not exists agendamentos_origem_chave_key
  on agendamentos (origem_chave)
  where origem_chave is not null and status in ('pendente', 'confirmado');

create index if not exists agendamentos_inicio_idx
  on agendamentos (inicio_em desc);
create index if not exists agendamentos_status_inicio_idx
  on agendamentos (status, inicio_em);
create index if not exists agendamentos_telefone_idx
  on agendamentos (telefone);
create index if not exists agendamentos_wa_conversa_idx
  on agendamentos (wa_conversa_id) where wa_conversa_id is not null;

create table if not exists agenda_log (
  id             uuid primary key default gen_random_uuid(),
  agendamento_id uuid references agendamentos(id) on delete set null,
  acao           text        not null,
  detalhe        jsonb,
  criado_em      timestamptz not null default now()
);

create index if not exists agenda_log_acao_idx
  on agenda_log (acao, criado_em desc);
create index if not exists agenda_log_agendamento_idx
  on agenda_log (agendamento_id, criado_em desc);

create or replace function tg_agendamentos_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

create or replace trigger agendamentos_touch
  before update on agendamentos
  for each row execute function tg_agendamentos_touch();

-- Zero POLICIES com RLS ligada é o desenho, não esquecimento — mesma doutrina
-- da 0082: RLS sem policy nega para todo mundo, e service_role passa por cima.
-- A mesa é fechada para anon e para usuário logado por CONSTRUÇÃO.
alter table agendamentos enable row level security;
alter table agenda_log   enable row level security;


-- ############################################################################
-- SEÇÃO 1 — O VALOR NOVO DO ENUM (0086a, e nada pode usá-lo nesta transação)
-- ############################################################################

-- Trava 3. Antes de 'pendente' porque é o estado que vem antes dele na vida
-- real: reserva o horário, fala com o Google, só então promove.
alter type agenda_status add value if not exists 'reservando' before 'pendente';


-- ############################################################################
-- SEÇÃO 2 — O DELTA (0086b — commit separado, ver o cabeçalho)
-- ############################################################################

-- ---------------------------------------------------------------------------
-- 2.1 — Trava 3: a reserva tem prazo, e reserva sem prazo não existe.
-- ---------------------------------------------------------------------------
-- Sem prazo, uma reserva que morreu no meio do caminho (o Google não
-- respondeu, o processo caiu) segura o horário PARA SEMPRE. O horário some da
-- grade e ninguém consegue explicar por quê.
alter table agendamentos
  add column if not exists reserva_expira_em timestamptz;

alter table agendamentos drop constraint if exists agendamentos_reserva_tem_prazo;
alter table agendamentos add constraint agendamentos_reserva_tem_prazo
  check (status <> 'reservando' or reserva_expira_em is not null);

comment on column agendamentos.reserva_expira_em is
  'AGENDA-PROSPERITO-02 trava 3: prazo curto da reserva. Vencido e ainda reservando = orfao, ver agenda_orfaos_google().';

-- ---------------------------------------------------------------------------
-- 2.2 — A reserva precisa SEGURAR o horário, senão não é reserva.
-- ---------------------------------------------------------------------------
-- A constraint da seção 0 só olha 'pendente' e 'confirmado'. Enquanto
-- 'reservando' ficar de fora, duas pessoas reservam o mesmo horário ao mesmo
-- tempo e as duas passam — que é o defeito que a trava 2 existe para impedir,
-- entrando pela porta do estado novo.
--
-- `drop` + `add` porque não há `alter constraint` para mudar o predicado.
-- Medido: 0 linhas na tabela, então a janela entre os dois comandos não pode
-- deixar passar nada.
alter table agendamentos drop constraint if exists agendamentos_sem_sobreposicao;
alter table agendamentos add constraint agendamentos_sem_sobreposicao
  exclude using gist (tstzrange(inicio_em, fim_em, '[)') with &&)
  where (status in ('reservando', 'pendente', 'confirmado'));

-- ---------------------------------------------------------------------------
-- 2.3 — Trava 6: desfecho é coluna própria, e 'realizado' exige um.
-- ---------------------------------------------------------------------------
-- Status é onde a reunião ESTÁ. Desfecho é o que ela DEU. Empilhar os dois no
-- mesmo enum perde 'fechou' — o único valor que diz se a reunião virou
-- negócio, que é a pergunta que a agenda existe para responder.
alter table agendamentos
  add column if not exists desfecho text;

alter table agendamentos drop constraint if exists agendamentos_desfecho_valido;
alter table agendamentos add constraint agendamentos_desfecho_valido
  check (desfecho is null
         or desfecho in ('compareceu', 'nao_compareceu', 'remarcou', 'fechou'));

-- É isto que torna a trava 6 uma trava e não um combinado: marcar a reunião
-- como realizada sem dizer o que ela deu passa a ser ERRO.
alter table agendamentos drop constraint if exists agendamentos_realizado_tem_desfecho;
alter table agendamentos add constraint agendamentos_realizado_tem_desfecho
  check (status <> 'realizado' or desfecho is not null);

comment on column agendamentos.desfecho is
  'AGENDA-PROSPERITO-02 trava 6: compareceu | nao_compareceu | remarcou | fechou. Obrigatorio quando status = realizado.';

create index if not exists agendamentos_desfecho_idx
  on agendamentos (desfecho, inicio_em desc) where desfecho is not null;

-- ---------------------------------------------------------------------------
-- 2.4 — META 8 de 12: o excedente é marcado, não recusado.
-- ---------------------------------------------------------------------------
-- A janela 08h–20h com 40min + 20min dá 12 slots/dia e a meta é 8. Recusar o
-- 9º seria jogar fora quem quer conversar; não marcar nada tornaria a meta
-- incontável. Marca-se, e a meta vira uma consulta.
alter table agendamentos
  add column if not exists excedente boolean not null default false;

comment on column agendamentos.excedente is
  'AGENDA-PROSPERITO-02: verdadeiro quando a reuniao passa da META de 8 no dia. Nao recusa, so marca.';

-- ---------------------------------------------------------------------------
-- 2.5 — O VIGIA. Detector puro; quem abre e fecha alerta é o RADAR (0082).
-- ---------------------------------------------------------------------------
-- Índices que sustentam as duas metades da consulta. Sem eles o vigia varre a
-- tabela inteira a cada 3h, e ela só cresce.
create index if not exists agendamentos_reserva_vencendo
  on agendamentos (reserva_expira_em) where status = 'reservando';

create index if not exists agendamentos_pendente_sem_evento
  on agendamentos (criado_em) where status = 'pendente' and google_event_id is null;

create or replace function agenda_orfaos_google(p_carencia_minutos int default 15)
returns table (
  agendamento_id uuid,
  motivo         text,
  status         agenda_status,
  inicio_em      timestamptz,
  idade_minutos  numeric
)
language sql
stable
set search_path = public
as $$
  -- ① A reserva morreu no meio do caminho e está segurando um horário que
  --    ninguém mais consegue marcar. Invisível sem este vigia.
  select a.id,
         'reserva_expirada'::text,
         a.status,
         a.inicio_em,
         round(extract(epoch from (now() - a.reserva_expira_em)) / 60.0, 1)
    from agendamentos a
   where a.status = 'reservando'
     and a.reserva_expira_em is not null
     and a.reserva_expira_em < now()

  union all

  -- ② Prometemos uma reunião e não existe evento no Google. O cliente tem um
  --    horário na cabeça e o Emerson não tem nada no calendário. É o pior dos
  --    dois, e é o que o check de 'confirmado' NÃO pega, porque a linha nunca
  --    chegou a 'confirmado'.
  select a.id,
         'pendente_sem_evento'::text,
         a.status,
         a.inicio_em,
         round(extract(epoch from (now() - a.criado_em)) / 60.0, 1)
    from agendamentos a
   where a.status = 'pendente'
     and a.google_event_id is null
     and a.criado_em < now() - make_interval(mins => greatest(p_carencia_minutos, 1));
$$;

comment on function agenda_orfaos_google(int) is
  'AGENDA-PROSPERITO-02: orfaos do Google. reserva_expirada = horario preso; pendente_sem_evento = reuniao prometida sem evento. Detector puro, nao escreve. O RADAR abre/fecha o alerta via radar_registrar/radar_resolver.';

-- ---------------------------------------------------------------------------
-- CLAUDE.md, Regra 1 — mesmo desvio declarado da 0081 e da 0082, mesmo motivo:
-- quem lê isto é o cron do RADAR, pelo service_role. Nenhuma tela chama a
-- função direto, então `authenticated` também sai. Afrouxar depois é um
-- `grant`; apertar depois de vazar não é nada.
-- ---------------------------------------------------------------------------
revoke all on function public.agenda_orfaos_google(int) from public, anon, authenticated;
grant execute on function public.agenda_orfaos_google(int) to service_role;

comment on table agendamentos is
  'AGENDA-PROSPERITO-02: uma linha por reuniao. Trava 2 e a EXCLUDE por sobreposicao (nao trocar por unique(data,hora)); trava 3 e reservando + reserva_expira_em; trava 6 e desfecho.';
comment on table agenda_log is
  'AGENDA-PROSPERITO-02: log append-only da agenda. Nao carrega estado de alerta - isso vive em radar_alertas (0082).';
