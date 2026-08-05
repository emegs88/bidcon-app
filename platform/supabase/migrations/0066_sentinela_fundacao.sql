-- ============================================================================
-- 0066_sentinela_fundacao — FATIA SENTINELA-01
-- AUTORIZADO: fatia SENTINELA-01 por Emerson em 04/08/2026.
-- JÁ APLICADA em produção (xtv) em 04/08/2026 via MCP. Este arquivo existe
-- para o histórico do repo espelhar o banco.
-- ----------------------------------------------------------------------------
-- Reativação de leads parados. Escopo desta migração: fila + log de auditoria
-- + função de captação (canal site). NADA aqui envia mensagem — envio é da
-- rota /api/sentinela/varredura, e só com template Meta aprovado configurado
-- em SENTINELA_TEMPLATE. DDL 100% aditivo: nenhuma tabela existente alterada.
-- RLS ligado sem policies = leitura/escrita só service role (padrão da casa,
-- mesmo espírito de cedente_cartas e farol_log).
-- ============================================================================

create type sentinela_status as enum (
  'pendente',            -- captado, nunca tocado
  'aguardando_template', -- elegível, mas SENTINELA_TEMPLATE não configurado
  'enviado',             -- >=1 toque feito, aguardando resposta/próximo toque
  'respondeu',           -- cliente voltou (site ou WhatsApp) — PARADA
  'esgotado',            -- máximo de toques atingido sem resposta — PARADA
  'excluido',            -- opt_out / número excluído — PARADA
  'erro'                 -- falha de envio registrada no log
);

create table sentinela_fila (
  id               uuid primary key default gen_random_uuid(),
  conversa_site_id uuid unique references conversas(id) on delete cascade,
  wa_conversa_id   uuid references wa_conversas(id) on delete set null,
  interesse_id     uuid references interesses(id) on delete set null,
  nome             text,
  telefone         text not null,
  motivo           text not null default 'silencio_pos_pergunta',
  status           sentinela_status not null default 'pendente',
  tentativas       int not null default 0,
  ultimo_envio_em  timestamptz,
  proximo_toque_em timestamptz,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

comment on table sentinela_fila is
  'SENTINELA-01: fila de reativação de leads parados. Uma linha por conversa de origem. Escrita só service role (RLS sem policies).';

create index sentinela_fila_status_idx on sentinela_fila (status);
create index sentinela_fila_proximo_toque_idx on sentinela_fila (proximo_toque_em);

create table sentinela_log (
  id        uuid primary key default gen_random_uuid(),
  fila_id   uuid references sentinela_fila(id) on delete set null,
  acao      text not null,   -- captado | envio_ok | envio_falha | parada_respondeu | parada_opt_out | parada_esgotado | aguardando_template | fora_horario | dry_run
  detalhe   jsonb,
  criado_em timestamptz not null default now()
);

comment on table sentinela_log is
  'SENTINELA-01: auditoria de toda ação do Sentinela (mesmo papel do farol_log para o FAROL).';

create index sentinela_log_fila_idx on sentinela_log (fila_id);

-- Trigger de atualizado_em (mesmo padrão de wa_touch_atualizado_em)
create or replace function sentinela_touch_atualizado_em()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

create trigger trg_sentinela_fila_touch
before update on sentinela_fila
for each row execute function sentinela_touch_atualizado_em();

-- Captação (canal site): conversas onde a ÚLTIMA mensagem é do agente
-- (cliente ficou devendo resposta), mais velha que idade_minima, com telefone
-- no interesse e ainda fora da fila. Última atividade derivada de
-- max(mensagens.criado_em) — NUNCA de conversas.atualizado_em, que não é
-- confiável (lição do PAINEL-WA-01, confirmada no caso Romullo: atualizado_em
-- congelado em 23:37 com mensagens até 23:42).
create or replace function sentinela_candidatas_site(idade_minima interval default interval '24 hours')
returns table (
  conversa_id   uuid,
  interesse_id  uuid,
  nome          text,
  telefone      text,
  ultima_msg_em timestamptz
)
language sql
stable
set search_path = public
as $$
  select c.id, i.id, i.nome, i.telefone, um.criado_em
  from conversas c
  join interesses i on i.id = c.interesse_id
  join lateral (
    select m.papel, m.criado_em
    from mensagens m
    where m.conversa_id = c.id
    order by m.criado_em desc
    limit 1
  ) um on true
  where coalesce(i.telefone, '') <> ''
    and um.papel = 'agente'
    and um.criado_em < now() - idade_minima
    and not exists (
      select 1 from sentinela_fila f where f.conversa_site_id = c.id
    );
$$;

alter table sentinela_fila enable row level security;
alter table sentinela_log enable row level security;
