-- ============================================================================
-- Bidcon — plataforma logada · Migration 0016 · Bidcon Reserve · Slice 1 (core)
-- ----------------------------------------------------------------------------
-- APLICADA EM PRODUÇÃO (nnv). Verificado por levantamento em 21/07/2026: as
-- tabelas/RPCs abaixo existem no banco `nnv` (nnvjeijsrwpzsggwqpcu). Único
-- registro em `reservas` é um smoke-test sintético da própria aplicação desta
-- migration — carta_id/buyer_id/seller_id nulos, settlement_rail 'NOTARIAL',
-- state 'DRAFT' (nunca avançou), actor 'validacao-0016', 2 eventos
-- (VERIFICATION_STARTED/VERIFICATION_COMPLETED, payload fonte:
-- "validacao-producao"). `reserva_legs`, `reserva_conditions`,
-- `pagamentos_sinal` e `contratos` estão vazias — zero operação real (de
-- qualquer trilho, incl. PAYMENT_INSTITUTION) processada por este schema até
-- o momento deste levantamento.
--
-- O que entrega (Build Order §10, Slice 1 — camada de dados do escrow):
--   - `reservas`        : reserva-mãe (pendura em carta + partes diretas).
--   - `reserva_legs`    : plano de payout multi-perna (recebedores; nunca ao cliente).
--   - `reserva_conditions`: condições OBJETIVAS de liberação (verificáveis).
--   - `reserva_eventos` : trilha imutável hash-chain (append-only) + verify_chain.
--   - colunas aditivas em `cartas`: passport / origem / commission_plan (admin-only).
--   - RPCs security definer de criação/transição (nenhuma move dinheiro).
--   - RLS estrito (party / partner / ops) + VIEW redigida p/ parceiro (sem banco).
--   - bucket privado `reserva-docs` (evidências; signed URL curto server-side).
--
-- DECISÕES Q1–Q4 (aprovadas — Emerson), refletidas neste schema:
--   Q1  Hash canônico computado no SERVIDOR (Node/edge, service role) e passado
--       PRONTO para a RPC. O Postgres só ENCADEIA e guarda. Evento carrega
--       `canon_version` (versionamento da canonicalização) para não invalidar
--       cadeias antigas se a regra mudar. `verify_chain` é LEITURA PURA.
--   Q2  `bank_details_enc` cifrado no app (KMS); banco nunca guarda a chave.
--       Toda descriptografia gera evento próprio `BANK_DETAILS_DECRYPTED`
--       (actor + reserva_id) — quem viu dado bancário fica registrado p/ sempre.
--   Q3  Parceiro NÃO lê a tabela `reserva_legs` (policy só p/ ops). Vê suas legs
--       por `reserva_legs_parceiro_v` (VIEW redigida, SEM `bank_details_enc`).
--   Q4  Bucket próprio `reserva-docs` (privado). Upload de evidência sempre gera
--       evento na cadeia com o hash do arquivo (feito na RPC/servidor, não aqui).
--
-- COMPLIANCE / LGPD (invioláveis):
--   - Nada de investimento/rendimento/retorno ao cliente. Sem contemplação/prazo.
--   - legs/split/fee/adapter/dado bancário NUNCA em payload de CLIENTE.
--   - `bank_details_enc` só é decifrado no servidor ao gerar o Release Request.
--
-- Reuso: is_admin() (0002), profiles/cartas (0001), padrão de storage/RPC de 0008/0014.
-- Aditivo puro: nenhuma coluna/tabela existente é alterada destrutivamente.
-- Idempotência: mesmos padrões do delta (if not exists, do-block, drop-then-create).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) COLUNAS ADITIVAS em `cartas` (passport / origem de suprimento / split)
-- ----------------------------------------------------------------------------
-- Nada disso vai a payload de cliente: RLS de `cartas` já é admin/parceiro (0002/0005).

alter table public.cartas
  add column if not exists passport jsonb;
-- passport: dossiê FACTUAL da cota. Ex.:
--   { administradora, grupo, cota, credito, saldo, status, gravames[],
--     extrato_doc_id, extrato_date, certidoes[] }  (admin/parceiro; nunca cliente)

alter table public.cartas
  add column if not exists origem text;
-- Trilha de SUPRIMENTO (dual-track §2/§6): como a carta chegou à Bidcon.
-- Distinta de `administradora_origem` (0015 = fonte de SYNC, quem administra).
alter table public.cartas
  drop constraint if exists cartas_origem_chk;
alter table public.cartas
  add constraint cartas_origem_chk
  check (origem is null or origem in ('fornecedor_legado','rede','propria'));

alter table public.cartas
  add column if not exists commission_plan jsonb;
-- null = split padrão 40/40/20. Fornecedores legados carregam termos próprios. ADMIN-ONLY.

-- ----------------------------------------------------------------------------
-- 1) `reservas` — a reserva-mãe (referencia carta + partes diretas)
-- ----------------------------------------------------------------------------
-- N reservas por carta é PERMITIDO (sem unique em carta_id): a mesma carta pode
-- passar por várias reservas ao longo da vida (expirada, anuência negada, novo
-- comprador). A invariante "no máx. 1 reserva ATIVA por carta" vive na RPC.

create table if not exists public.reservas (
  id                   uuid primary key default gen_random_uuid(),
  carta_id             uuid references public.cartas(id)   on delete set null,
  buyer_id             uuid references public.profiles(id) on delete set null,
  seller_id            uuid references public.profiles(id) on delete set null,
  sourcing_partner_id  uuid references public.profiles(id) on delete set null,
  selling_partner_id   uuid references public.profiles(id) on delete set null,
  price_total          numeric(14,2) not null,       -- ágio acordado
  signal_amount        numeric(14,2) not null,       -- 10–20% do ágio
  fee_plan             jsonb not null,               -- fee 10%/6%, min 2500, template legs
  settlement_rail      text not null default 'NOTARIAL',
  rail_ref             jsonb,                         -- id cartório / conta IF / ref cadeia
  state                text not null default 'DRAFT', -- string; validação na RPC (§6)
  valid_until          timestamptz,                   -- Termo: 45 dias
  deposit_expires_at   timestamptz,                   -- D+180 CNB → jobs D150/D170
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table public.reservas
  drop constraint if exists reservas_rail_chk;
alter table public.reservas
  add constraint reservas_rail_chk
  check (settlement_rail in ('NOTARIAL','PAYMENT_INSTITUTION','TOKENIZED'));

create index if not exists idx_reservas_carta on public.reservas(carta_id);
create index if not exists idx_reservas_buyer on public.reservas(buyer_id);
create index if not exists idx_reservas_state on public.reservas(state);

-- ----------------------------------------------------------------------------
-- 2) `reserva_legs` — plano de payout multi-perna (a parte nunca-vista)
-- ----------------------------------------------------------------------------
-- NOTA sobre NOTARY_COSTS: a leg registra o VALOR da tarifa notarial (payout ao
-- cartório). O RATEIO de quem custeia a tarifa (BUYER|SELLER|SPLIT 50/50 default)
-- é detalhe de funding e vive no snapshot `reservas.fee_plan` (campo notary_alloc
-- por leg, gerado no fee-plan.ts) — não vira leg separada. A tarifa é
-- NÃO-reembolsável em negócio desfeito (ver bloco ANUENCIA_DENIED na RPC).

create table if not exists public.reserva_legs (
  id               uuid primary key default gen_random_uuid(),
  reserva_id       uuid not null references public.reservas(id) on delete cascade,
  beneficiary_type text not null,
  beneficiary_id   uuid references public.profiles(id) on delete set null,
  amount           numeric(14,2) not null,
  bank_details_enc text,     -- CIFRADO no app (KMS). Só decifrado no servidor ao
                             -- gerar o Release Request. NUNCA em SELECT de tela.
  status           text not null default 'PLANNED',
  created_at       timestamptz not null default now()
);

alter table public.reserva_legs
  drop constraint if exists reserva_legs_benef_chk;
alter table public.reserva_legs
  add constraint reserva_legs_benef_chk
  check (beneficiary_type in
    ('SELLER','PLATFORM','SOURCING_PARTNER','SELLING_PARTNER',
     'OVERRIDE','CREDIT_PROVIDER','REFUND_BUYER','NOTARY_COSTS'));

alter table public.reserva_legs
  drop constraint if exists reserva_legs_status_chk;
alter table public.reserva_legs
  add constraint reserva_legs_status_chk
  check (status in ('PLANNED','INSTRUCTED','CONFIRMED'));

create index if not exists idx_legs_reserva on public.reserva_legs(reserva_id);

-- ----------------------------------------------------------------------------
-- 3) `reserva_conditions` — condições objetivas de liberação
-- ----------------------------------------------------------------------------

create table if not exists public.reserva_conditions (
  id              uuid primary key default gen_random_uuid(),
  reserva_id      uuid not null references public.reservas(id) on delete cascade,
  code            text not null,   -- ANUENCIA_ISSUED | TITLE_TRANSFERRED | FULLY_FUNDED | custom
  description     text not null,   -- rótulo factual (passa no filtro de léxico)
  evidence_doc_id uuid,            -- objeto no bucket reserva-docs (kind pode ser ENOT_PROVA)
  status          text not null default 'PENDING',
  verified_by     text,            -- 'AI' | id do operador (admin)
  verified_at     timestamptz,
  created_at      timestamptz not null default now()
);

alter table public.reserva_conditions
  drop constraint if exists reserva_conditions_status_chk;
alter table public.reserva_conditions
  add constraint reserva_conditions_status_chk
  check (status in ('PENDING','MET','FRUSTRATED'));

create index if not exists idx_cond_reserva on public.reserva_conditions(reserva_id);

-- ----------------------------------------------------------------------------
-- 4) `reserva_eventos` — trilha imutável hash-chain (append-only)
-- ----------------------------------------------------------------------------
-- Q1: hash é computado no SERVIDOR (canonical JSON completo) e chega PRONTO. O
-- banco só encadeia (prev_hash) e guarda. `canon_version` versiona a regra de
-- canonicalização para não invalidar cadeias antigas se a regra evoluir.

create table if not exists public.reserva_eventos (
  id           bigserial primary key,
  reserva_id   uuid not null references public.reservas(id) on delete cascade,
  type         text not null,
  payload      jsonb not null default '{}',
  actor        text not null,           -- id do admin | 'system' | 'AI'
  prev_hash    text,                    -- hash do evento anterior da MESMA reserva
  hash         text not null,           -- sha256 canônico, computado no servidor (Q1)
  canon_version int not null default 1, -- versão da canonicalização usada p/ este hash
  created_at   timestamptz not null default now()
);

create index if not exists idx_eventos_reserva on public.reserva_eventos(reserva_id, id);

-- IMUTABILIDADE (defense-in-depth, além da RLS): nenhum UPDATE/DELETE, nem admin.
-- Correção = novo evento. Trigger bloqueia mutação linha-a-linha.
create or replace function public.reserve_evt_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'reserva_eventos e append-only (correcao = novo evento)';
end; $$;

drop trigger if exists trg_reserva_eventos_noupd on public.reserva_eventos;
create trigger trg_reserva_eventos_noupd
  before update or delete on public.reserva_eventos
  for each row execute function public.reserve_evt_immutable();

-- ----------------------------------------------------------------------------
-- 5) RPCs de transição (security definer; NENHUMA move dinheiro)
-- ----------------------------------------------------------------------------
-- Padrão: gate por papel (is_admin), gravam evento hash-encadeado ANTES de
-- retornar. Corpo detalhado fica para a fatia de implementação; aqui as
-- assinaturas + guards essenciais para a proposta ser demoável/revisável.

-- 5.1) append de evento com hash JÁ CALCULADO no servidor (Q1).
--      O banco NÃO recomputa o hash: confia no servidor confiável e apenas
--      valida o encadeamento (prev_hash = último hash da reserva).
create or replace function public.reserva_append_evento(
  p_reserva uuid,
  p_type    text,
  p_payload jsonb,
  p_actor   text,
  p_hash    text,          -- sha256 canônico calculado no servidor
  p_canon_version int default 1
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_prev text;
begin
  if not public.is_admin() then
    raise exception 'apenas ops (admin) pode registrar eventos de reserva';
  end if;

  -- encadeia: pega o último hash desta reserva sob lock lógico da linha-mãe
  perform 1 from public.reservas where id = p_reserva for update;
  select hash into v_prev
    from public.reserva_eventos
   where reserva_id = p_reserva
   order by id desc
   limit 1;

  insert into public.reserva_eventos
    (reserva_id, type, payload, actor, prev_hash, hash, canon_version)
  values
    (p_reserva, p_type, coalesce(p_payload,'{}'::jsonb), p_actor, v_prev, p_hash, p_canon_version);

  return p_hash;
end; $$;

-- 5.2) criação da reserva (DRAFT) a partir de carta + partes + preço.
--      Guards: só admin; carta existe; SEM reserva ATIVA para a carta; price>0;
--      signal entre 10–20% de price. valid_until = now()+45d. Evento 'CRIADA'
--      (hash calculado no servidor e passado à 5.1). Retorna reserva_id.
create or replace function public.reserva_criar(
  p_carta uuid, p_buyer uuid, p_seller uuid,
  p_sourcing uuid, p_selling uuid,
  p_price numeric, p_signal numeric, p_fee_plan jsonb,
  p_evento_hash text            -- hash do evento CRIADA, calculado no servidor (Q1)
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'apenas ops (admin) pode criar reserva';
  end if;
  if not exists (select 1 from public.cartas where id = p_carta) then
    raise exception 'carta inexistente';
  end if;
  if exists (
    select 1 from public.reservas
     where carta_id = p_carta
       and state not in ('REFUNDED','SETTLED','CLOSED','ANUENCIA_DENIED')
  ) then
    raise exception 'ja existe reserva ATIVA para esta carta';
  end if;
  if not (p_price > 0) then
    raise exception 'price_total deve ser positivo';
  end if;
  if not (p_signal >= p_price * 0.10 and p_signal <= p_price * 0.20) then
    raise exception 'signal_amount deve ficar entre 10%% e 20%% do price_total';
  end if;

  insert into public.reservas
    (carta_id, buyer_id, seller_id, sourcing_partner_id, selling_partner_id,
     price_total, signal_amount, fee_plan, state, valid_until)
  values
    (p_carta, p_buyer, p_seller, p_sourcing, p_selling,
     p_price, p_signal, p_fee_plan, 'DRAFT', now() + interval '45 days')
  returning id into v_id;

  perform public.reserva_append_evento(
    v_id, 'CRIADA',
    jsonb_build_object('price_total', p_price, 'signal_amount', p_signal),
    coalesce(auth.uid()::text, 'system'), p_evento_hash, 1);

  return v_id;
end; $$;

-- 5.3) transição genérica com validação da máquina de estados (§5).
--      A validade das transições é ESPELHADA em lib/reserve/state-machine.ts
--      (fonte única lógica). Aqui aplicamos o guard de destino + gate humano
--      onde há dinheiro (§4.6). Grava evento 'TRANSICAO' {de,para,nota}.
create or replace function public.reserva_transicionar(
  p_reserva uuid, p_novo text, p_nota text,
  p_evento_hash text            -- hash do evento TRANSICAO, calculado no servidor
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_atual text;
begin
  if not public.is_admin() then
    raise exception 'apenas ops (admin) pode transicionar reserva';
  end if;
  select state into v_atual from public.reservas where id = p_reserva for update;
  if v_atual is null then
    raise exception 'reserva inexistente';
  end if;

  -- Guard de máquina de estados (conjunto mínimo; a tabela completa de
  -- transições vive no state-machine.ts e é reaplicada aqui na implementação).
  if not public.reserva_transicao_valida(v_atual, p_novo) then
    raise exception 'transicao invalida: %% -> %%', v_atual, p_novo;
  end if;

  update public.reservas
     set state = p_novo, updated_at = now()
   where id = p_reserva;

  -- ANUENCIA_DENIED: agenda refund integral do PRINCIPAL (sinal) ao comprador +
  -- carta volta à vitrine. A tarifa notarial (NOTARY_COSTS) já paga NÃO retorna
  -- (não-reembolsável — previsto no Termo): o refund usa signal_amount, nunca
  -- signal_amount + tarifa. Espelha legRefundBuyer() do fee-plan.ts.
  if p_novo = 'ANUENCIA_DENIED' then
    insert into public.reserva_legs (reserva_id, beneficiary_type, beneficiary_id, amount, status)
    select p_reserva, 'REFUND_BUYER', r.buyer_id, r.signal_amount, 'PLANNED'
      from public.reservas r where r.id = p_reserva;
    update public.cartas c
       set status = 'disponivel'
      from public.reservas r
     where r.id = p_reserva and c.id = r.carta_id;
  end if;

  perform public.reserva_append_evento(
    p_reserva, 'TRANSICAO',
    jsonb_build_object('de', v_atual, 'para', p_novo, 'nota', p_nota),
    coalesce(auth.uid()::text, 'system'), p_evento_hash, 1);
end; $$;

-- 5.4) tabela de transições válidas (§5) — guard consultado pela 5.3.
--      Espelha lib/reserve/state-machine.ts. Mantida como função pura p/ o guard
--      não depender de tabela e ser fácil de auditar.
create or replace function public.reserva_transicao_valida(p_de text, p_para text)
returns boolean language sql immutable as $$
  select (p_de, p_para) in (
    ('DRAFT','TERMS_SIGNED'),
    ('TERMS_SIGNED','SIGNAL_DEPOSITED'),
    ('SIGNAL_DEPOSITED','VERIFIED'),
    ('VERIFIED','ANUENCIA_REQUESTED'),
    ('ANUENCIA_REQUESTED','ANUENCIA_APPROVED'),
    ('ANUENCIA_REQUESTED','ANUENCIA_DENIED'),
    ('ANUENCIA_APPROVED','FULLY_FUNDED'),
    ('FULLY_FUNDED','SETTLED'),
    ('ANUENCIA_DENIED','REFUNDED'),
    ('SETTLED','CLOSED'),
    ('REFUNDED','CLOSED'),
    -- disputa pode nascer de qualquer estado ativo:
    ('TERMS_SIGNED','DISPUTED'),
    ('SIGNAL_DEPOSITED','DISPUTED'),
    ('VERIFIED','DISPUTED'),
    ('ANUENCIA_REQUESTED','DISPUTED'),
    ('ANUENCIA_APPROVED','DISPUTED'),
    ('FULLY_FUNDED','DISPUTED'),
    ('DISPUTED','REFUNDED'),
    ('DISPUTED','SETTLED'),
    ('DISPUTED','CLOSED')
  );
$$;

-- 5.5) gestão de condições e legs (admin/ops).
create or replace function public.reserva_add_condition(
  p_reserva uuid, p_code text, p_desc text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'apenas ops'; end if;
  if coalesce(btrim(p_code),'') = '' then
    raise exception 'condicao exige code objetivo (sem condicao subjetiva)';
  end if;
  insert into public.reserva_conditions (reserva_id, code, description)
  values (p_reserva, p_code, p_desc) returning id into v_id;
  return v_id;
end; $$;

create or replace function public.reserva_marcar_condition(
  p_cond uuid, p_status text, p_evidence uuid, p_by text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'apenas ops'; end if;
  if p_status not in ('PENDING','MET','FRUSTRATED') then
    raise exception 'status de condicao invalido';
  end if;
  update public.reserva_conditions
     set status = p_status, evidence_doc_id = p_evidence,
         verified_by = p_by, verified_at = now()
   where id = p_cond;
end; $$;

create or replace function public.reserva_add_leg(
  p_reserva uuid, p_type text, p_benef uuid, p_amount numeric
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'apenas ops'; end if;
  insert into public.reserva_legs (reserva_id, beneficiary_type, beneficiary_id, amount)
  values (p_reserva, p_type, p_benef, p_amount) returning id into v_id;
  return v_id;
end; $$;

-- Marcação de leg: gate HUMANO onde há dinheiro (§4.6). PLANNED→INSTRUCTED→CONFIRMED
-- é ação explícita de admin; a RPC só registra a INTENÇÃO (não move recurso).
create or replace function public.reserva_marcar_leg(p_leg uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'apenas ops'; end if;
  if p_status not in ('PLANNED','INSTRUCTED','CONFIRMED') then
    raise exception 'status de leg invalido';
  end if;
  update public.reserva_legs set status = p_status where id = p_leg;
end; $$;

-- 5.6) verify_chain — LEITURA PURA (Q1 / Definition of Done §11).
--      NÃO recomputa o sha256 (o servidor é a autoridade do hash). Valida o
--      ENCADEAMENTO: cada evento aponta para o hash do anterior, em ordem. O
--      recomputo criptográfico do conteúdo é feito pelo auditor Node externo.
create or replace function public.verify_chain(p_reserva uuid)
returns table (ok boolean, quebrou_em bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  r record;
  v_prev text := null;
begin
  for r in
    select id, prev_hash, hash
      from public.reserva_eventos
     where reserva_id = p_reserva
     order by id asc
  loop
    if v_prev is distinct from r.prev_hash then
      ok := false; quebrou_em := r.id; return next; return;
    end if;
    v_prev := r.hash;
  end loop;
  ok := true; quebrou_em := null; return next;
end; $$;

-- ----------------------------------------------------------------------------
-- 6) RLS (party / partner / ops) + VIEW redigida p/ parceiro (Q3)
-- ----------------------------------------------------------------------------

alter table public.reservas           enable row level security;
alter table public.reserva_legs       enable row level security;
alter table public.reserva_conditions enable row level security;
alter table public.reserva_eventos    enable row level security;

-- RESERVAS: party (buyer/seller) e partners veem a própria; ops (admin) vê tudo.
drop policy if exists reservas_select on public.reservas;
create policy reservas_select on public.reservas for select using (
  public.is_admin()
  or auth.uid() in (buyer_id, seller_id, sourcing_partner_id, selling_partner_id)
);
-- escrita só por RPC (security definer). Policy de escrita restrita a ops.
drop policy if exists reservas_admin_write on public.reservas;
create policy reservas_admin_write on public.reservas for all
  using (public.is_admin()) with check (public.is_admin());

-- LEGS: SÓ ops lê a tabela crua (contém bank_details_enc). Parceiro usa a VIEW.
drop policy if exists legs_ops_only on public.reserva_legs;
create policy legs_ops_only on public.reserva_legs for select using (public.is_admin());
drop policy if exists legs_admin_write on public.reserva_legs;
create policy legs_admin_write on public.reserva_legs for all
  using (public.is_admin()) with check (public.is_admin());

-- Q3: VIEW redigida — parceiro vê SUAS legs SEM bank_details_enc.
--     security_invoker: a view roda com o papel do chamador; para o parceiro
--     enxergar a própria leg apesar de a policy da tabela ser ops-only, a view
--     é security_definer e filtra por beneficiary_id = auth.uid(). Nunca projeta
--     bank_details_enc. (Teste de RLS na DoD: SELECT direto do parceiro na tabela
--     de legs = 0 linhas; via view = só as próprias, sem dado bancário.)
drop view if exists public.reserva_legs_parceiro_v;
create view public.reserva_legs_parceiro_v
  with (security_invoker = false) as
  select id, reserva_id, beneficiary_type, beneficiary_id, amount, status, created_at
    from public.reserva_legs
   where beneficiary_id = auth.uid();
-- (a view expõe apenas colunas não-sensíveis; bank_details_enc fica de fora)
grant select on public.reserva_legs_parceiro_v to authenticated;

-- CONDITIONS: party vê rótulo+status da própria reserva; evidence_doc_id só ops
-- (redigido via view p/ não-admin numa fatia de leitura — aqui a policy permite
-- SELECT da linha; a UI de cliente não renderiza evidence_doc_id).
drop policy if exists cond_select on public.reserva_conditions;
create policy cond_select on public.reserva_conditions for select using (
  public.is_admin()
  or reserva_id in (
    select id from public.reservas
     where auth.uid() in (buyer_id, seller_id, sourcing_partner_id, selling_partner_id))
);
drop policy if exists cond_admin_write on public.reserva_conditions;
create policy cond_admin_write on public.reserva_conditions for all
  using (public.is_admin()) with check (public.is_admin());

-- EVENTOS: ops/party leem; ninguém escreve/edita por policy (só RPC definer).
-- Sem policy de UPDATE/DELETE → RLS nega mutação; a trigger é a 2ª barreira.
drop policy if exists eventos_select on public.reserva_eventos;
create policy eventos_select on public.reserva_eventos for select using (
  public.is_admin()
  or reserva_id in (
    select id from public.reservas
     where auth.uid() in (buyer_id, seller_id, sourcing_partner_id, selling_partner_id))
);

-- ----------------------------------------------------------------------------
-- 7) Grants das RPCs (autorização fina é por is_admin() no corpo)
-- ----------------------------------------------------------------------------
revoke all on function public.reserva_append_evento(uuid,text,jsonb,text,text,int)  from public;
revoke all on function public.reserva_criar(uuid,uuid,uuid,uuid,uuid,numeric,numeric,jsonb,text) from public;
revoke all on function public.reserva_transicionar(uuid,text,text,text)             from public;
revoke all on function public.reserva_add_condition(uuid,text,text)                 from public;
revoke all on function public.reserva_marcar_condition(uuid,text,uuid,text)         from public;
revoke all on function public.reserva_add_leg(uuid,text,uuid,numeric)               from public;
revoke all on function public.reserva_marcar_leg(uuid,text)                         from public;
revoke all on function public.verify_chain(uuid)                                    from public;

grant execute on function public.reserva_append_evento(uuid,text,jsonb,text,text,int)  to authenticated;
grant execute on function public.reserva_criar(uuid,uuid,uuid,uuid,uuid,numeric,numeric,jsonb,text) to authenticated;
grant execute on function public.reserva_transicionar(uuid,text,text,text)             to authenticated;
grant execute on function public.reserva_add_condition(uuid,text,text)                 to authenticated;
grant execute on function public.reserva_marcar_condition(uuid,text,uuid,text)         to authenticated;
grant execute on function public.reserva_add_leg(uuid,text,uuid,numeric)               to authenticated;
grant execute on function public.reserva_marcar_leg(uuid,text)                         to authenticated;
grant execute on function public.verify_chain(uuid)                                    to authenticated;

-- ----------------------------------------------------------------------------
-- 8) Storage: bucket privado `reserva-docs` (Q4)
-- ----------------------------------------------------------------------------
-- Privado; acesso só por signed URL server-side (≤15 min) após checagem de papel.
-- Upload de evidência SEMPRE gera evento na cadeia com o hash do arquivo (feito
-- na RPC/servidor, não neste SQL). Espelha o padrão de 0008/0014.
insert into storage.buckets (id, name, public)
values ('reserva-docs', 'reserva-docs', false)
on conflict (id) do nothing;

-- Leitura/escrita do bucket só para ops (admin); party/partner recebem o
-- conteúdo via signed URL emitido pelo servidor após checagem de papel.
drop policy if exists reserva_docs_ops_read on storage.objects;
create policy reserva_docs_ops_read on storage.objects for select
  using (bucket_id = 'reserva-docs' and public.is_admin());
drop policy if exists reserva_docs_ops_write on storage.objects;
create policy reserva_docs_ops_write on storage.objects for insert
  with check (bucket_id = 'reserva-docs' and public.is_admin());

-- ============================================================================
-- FIM 0016 · Aditivo puro. Nada aplicado/commitado/pushado por este arquivo.
-- ============================================================================
