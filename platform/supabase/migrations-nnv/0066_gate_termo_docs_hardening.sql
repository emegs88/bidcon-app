-- ============================================================================
-- Bidcon Reserve — 0066: fecha o elo reservas↔processos, troca o gate de
-- gerar_contrato(tipo='cota') do modelo morto serviço→PIX→cota pelo termo
-- assinado + docs completas, guard de custódia legada em
-- reserva_transicionar, e hardening NULL-safe/anon (Regra 1) nas funções
-- tocadas.
-- ----------------------------------------------------------------------------
-- REGISTRO CRIADO A POSTERIORI (22/07): esta migration já estava aplicada no
-- banco (confirmada via `list_migrations` do projeto nnv, version
-- 20260722153146) mas o script original da sessão de apply não foi salvo
-- localmente — violação da Regra 2 do CLAUDE.md (migrations-nnv/ +
-- list_migrations juntos são a fonte da verdade).
--
-- O corpo abaixo é o SQL VERBATIM recuperado de
-- `supabase_migrations.schema_migrations` (version 20260722153146) — não é
-- reconstrução via `pg_get_functiondef` nem por memória. Ver adendo à Regra 2
-- (CLAUDE.md, mesma leva da 0068): migration aplicada sem arquivo local se
-- recupera SEMPRE verbatim do schema_migrations.
--
-- O QUE ESTA MIGRATION FEZ (pelo SQL verbatim abaixo):
-- 1) `reservas.processo_id` (nullable, FK -> processos, on delete set null) +
--    índice; liga a reserva ao processo do lado app. reserva_criar troca de
--    assinatura (novo parâmetro p_processo ao final) — drop explícito da
--    assinatura antiga pra não deixar overload ambíguo.
-- 2) `docs_completas(p_processo)`: helper novo — resolve a carta do processo,
--    a administradora, o checklist_modelos ativo (tipo_pessoa 'pf') e conta
--    checklist_itens obrigatórios cujo último processo_documentos (por
--    enviado_em desc) não está 'aprovado'. Retorna false cedo se
--    carta/administradora/modelo não existir; true só se a contagem de
--    faltantes for zero.
-- 3) `gerar_contrato(p_processo, p_tipo, p_dados, p_versao)`: para
--    p_tipo='cota', passa a exigir (nesta ordem) reserva_inexistente (P0003),
--    termo_nao_assinado (P0004, reserva em DRAFT ou em
--    ANUENCIA_DENIED/REFUNDED/CLOSED/DISPUTED) e docs_incompletas (P0005).
--    Mantém tipo_invalido (P0001), processo_inexistente (P0002) e
--    sem_permissao (42501). O fluxo antigo (serviço->PIX->cota, gate por
--    pagamentos_sinal) foi removido por completo — PROIBIDO, não deprecado;
--    sem flag de retorno pro comportamento antigo.
-- 4) `checklist_do_processo`: mesma edição do predicado NULL-safe (sem
--    mudança de comportamento fora disso).
-- 5) `reserva_transicionar`: guard na perna REFUND_BUYER — só agenda
--    reserva_legs de devolução se houver custódia legada de fato
--    (signal_amount > 0); no fluxo novo (custódia notarial) fica inerte, a
--    devolução é rastreada via cartorio_status. Liberação da carta mantida
--    sem condição.
-- 6) `reserva_transicao_valida`: só rodapé Regra 1 (revoke/grant) — função
--    pura, sem mudança de comportamento.
--
-- FORA DESTA FATIA (não tocado por este registro):
-- - nenhuma migration nova é aplicada por este arquivo (zero DB write — as
--   funções abaixo já estão live; isto é documentação, não execução);
-- - o call site que grava `reservas.processo_id` no caminho do cliente veio
--   depois, na 0067 (reservar_carta passa a inserir a reserva DRAFT).
-- ============================================================================

-- NÃO EXECUTAR VIA apply_migration — arquivo file-only, para paridade de
-- histórico local. O SQL abaixo é exatamente o que já está live (verbatim de
-- schema_migrations, version 20260722153146).

-- ============================================================
-- 1. Elo reservas -> processos (nullable por ora)
-- ============================================================

alter table public.reservas
  add column processo_id uuid references public.processos(id) on delete set null;

comment on column public.reservas.processo_id is
  'Liga a reserva ao processo (app-side). Nullable por ora: a linha órfã de '
  'teste existente fica como está — nunca casa o gate de gerar_contrato '
  'porque não referencia nenhum processo. NOT NULL é candidato futuro '
  'quando reserva_criar sempre popular. 1 processo pode ter N reservas '
  '(junção multi-carta, 1 carta por reserva) — por isso o vínculo fica em '
  'reservas, não em processos.reserva_id.';

create index idx_reservas_processo on public.reservas (processo_id);

-- reserva_criar precisa receber e gravar processo_id. Assinatura muda
-- (novo parâmetro ao final) — drop explícito da assinatura antiga pra
-- não deixar overload ambíguo.
drop function if exists public.reserva_criar(
  uuid, uuid, uuid, uuid, uuid, numeric, numeric, jsonb, text
);

create or replace function public.reserva_criar(
  p_carta uuid, p_buyer uuid, p_seller uuid, p_sourcing uuid, p_selling uuid,
  p_price numeric, p_signal numeric, p_fee_plan jsonb, p_evento_hash text,
  p_processo uuid default null
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  -- processo_id é opcional por ora (nullable), mas se informado precisa existir.
  if p_processo is not null and not exists (
    select 1 from public.processos where id = p_processo
  ) then
    raise exception 'processo_inexistente' using errcode = 'P0002';
  end if;

  insert into public.reservas
    (carta_id, buyer_id, seller_id, sourcing_partner_id, selling_partner_id,
     price_total, signal_amount, fee_plan, state, valid_until, processo_id)
  values
    (p_carta, p_buyer, p_seller, p_sourcing, p_selling,
     p_price, p_signal, p_fee_plan, 'DRAFT', now() + interval '45 days', p_processo)
  returning id into v_id;

  perform public.reserva_append_evento(
    v_id, 'CRIADA',
    jsonb_build_object('price_total', p_price, 'signal_amount', p_signal),
    coalesce(auth.uid()::text, 'system'), p_evento_hash, 1);

  return v_id;
end;
$function$;

revoke all on function public.reserva_criar(
  uuid, uuid, uuid, uuid, uuid, numeric, numeric, jsonb, text, uuid
) from public, anon;
grant execute on function public.reserva_criar(
  uuid, uuid, uuid, uuid, uuid, numeric, numeric, jsonb, text, uuid
) to authenticated;

-- ============================================================
-- 2. docs_completas(p_processo) — helper reusado por gerar_contrato
--    e consumido diretamente pelo app-side via RPC.
-- ============================================================

create or replace function public.docs_completas(p_processo uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_cliente uuid;
  v_carta   uuid;
  v_adm     uuid;
  v_modelo  uuid;
  v_faltando int;
begin
  select cliente_id, carta_id into v_cliente, v_carta
    from processos where id = p_processo;
  if not found then
    raise exception 'processo_inexistente' using errcode = 'P0002';
  end if;

  if not (is_admin() or (auth.uid() is not null and v_cliente = auth.uid())) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;

  if v_carta is null then
    return false;
  end if;
  select administradora_id into v_adm from cartas where id = v_carta;
  if v_adm is null then
    return false;
  end if;

  select id into v_modelo
    from checklist_modelos
   where administradora_id = v_adm and tipo_pessoa = 'pf' and ativo = true
   limit 1;
  if v_modelo is null then
    return false;
  end if;

  -- mesmo padrão de checklist_do_processo: item obrigatório sem último
  -- processo_documentos aprovado conta como "faltando".
  select count(*) into v_faltando
    from checklist_itens ci
    left join lateral (
      select pd.status
        from processo_documentos pd
       where pd.processo_id = p_processo
         and pd.checklist_item_id = ci.id
       order by pd.enviado_em desc
       limit 1
    ) ultimo on true
   where ci.modelo_id = v_modelo
     and ci.obrigatorio = true
     and coalesce(ultimo.status, 'pendente') <> 'aprovado';

  return v_faltando = 0;
end;
$function$;

revoke all on function public.docs_completas(uuid) from public, anon;
grant execute on function public.docs_completas(uuid) to authenticated;

-- ============================================================
-- 3. gerar_contrato — remove gate do modelo morto (sinal_nao_pago),
--    novo gate (reserva existe -> termo assinado -> docs completas),
--    predicado NULL-safe.
-- ============================================================

create or replace function public.gerar_contrato(
  p_processo uuid, p_tipo text, p_dados jsonb default '{}'::jsonb, p_versao text default 'v1'::text
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_cliente uuid;
  v_id      uuid;
begin
  if p_tipo not in ('servico','cota') then
    raise exception 'tipo_invalido' using errcode = 'P0001';
  end if;

  select cliente_id into v_cliente from processos where id = p_processo;
  if not found then
    raise exception 'processo_inexistente' using errcode = 'P0002';
  end if;

  if not (is_admin() or (auth.uid() is not null and v_cliente = auth.uid())) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;

  -- contrato da COTA no fluxo novo (F7a): termo assinado + docs completas.
  -- fluxo antigo (serviço->PIX->cota, gate por pagamentos_sinal) é PROIBIDO,
  -- não deprecado — removido por completo, sem flag de retorno.
  if p_tipo = 'cota' then
    if not exists (
      select 1 from reservas where processo_id = p_processo
    ) then
      raise exception 'reserva_inexistente' using errcode = 'P0003';
    end if;

    if exists (
      select 1 from reservas
       where processo_id = p_processo
         and (state = 'DRAFT' or state in ('ANUENCIA_DENIED','REFUNDED','CLOSED','DISPUTED'))
    ) then
      raise exception 'termo_nao_assinado' using errcode = 'P0004';
    end if;

    if not docs_completas(p_processo) then
      raise exception 'docs_incompletas' using errcode = 'P0005';
    end if;
  end if;

  insert into contratos (processo_id, tipo, versao_modelo, dados, status)
  values (p_processo, p_tipo, coalesce(p_versao,'v1'), coalesce(p_dados,'{}'::jsonb), 'gerado')
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.gerar_contrato(uuid, text, jsonb, text) from public, anon;
grant execute on function public.gerar_contrato(uuid, text, jsonb, text) to authenticated;

-- ============================================================
-- 4. checklist_do_processo — só o predicado NULL-safe (mesma edição).
-- ============================================================

create or replace function public.checklist_do_processo(p_processo uuid)
 returns table(checklist_item_id uuid, rotulo text, obrigatorio boolean, ordem integer, doc_status text, doc_motivo text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_cliente uuid;
  v_carta   uuid;
  v_adm     uuid;
  v_modelo  uuid;
begin
  select cliente_id, carta_id into v_cliente, v_carta
    from processos where id = p_processo;
  if not found then
    raise exception 'processo_inexistente' using errcode = 'P0002';
  end if;
  if not (is_admin() or (auth.uid() is not null and v_cliente = auth.uid())) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;

  if v_carta is null then
    return;
  end if;
  select administradora_id into v_adm from cartas where id = v_carta;
  if v_adm is null then
    return;
  end if;

  select id into v_modelo
    from checklist_modelos
   where administradora_id = v_adm and tipo_pessoa = 'pf' and ativo = true
   limit 1;
  if v_modelo is null then
    return;
  end if;

  return query
    select
      ci.id, ci.rotulo, ci.obrigatorio, ci.ordem,
      ultimo.status, ultimo.motivo
    from checklist_itens ci
    left join lateral (
      select pd.status, pd.motivo
        from processo_documentos pd
       where pd.processo_id = p_processo
         and pd.checklist_item_id = ci.id
       order by pd.enviado_em desc
       limit 1
    ) ultimo on true
    where ci.modelo_id = v_modelo
    order by ci.ordem asc, ci.rotulo asc;
end;
$function$;

revoke all on function public.checklist_do_processo(uuid) from public, anon;
grant execute on function public.checklist_do_processo(uuid) to authenticated;

-- ============================================================
-- 5. reserva_transicionar — guard na perna REFUND_BUYER (custódia legada).
--    Liberação da carta mantida sem condição, como está hoje.
-- ============================================================

create or replace function public.reserva_transicionar(p_reserva uuid, p_novo text, p_nota text, p_evento_hash text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

  if not public.reserva_transicao_valida(v_atual, p_novo) then
    raise exception 'transicao invalida: % -> %', v_atual, p_novo;
  end if;

  update public.reservas
     set state = p_novo, updated_at = now()
   where id = p_reserva;

  if p_novo = 'ANUENCIA_DENIED' then
    -- guard: só agenda REFUND_BUYER se houver custódia legada de fato
    -- (signal_amount > 0). No fluxo novo (F7a/custódia notarial), fica
    -- inerte — devolução notarial é rastreada via cartorio_status
    -- ('devolvido'), RPC da 0063.
    insert into public.reserva_legs (reserva_id, beneficiary_type, beneficiary_id, amount, status)
    select p_reserva, 'REFUND_BUYER', r.buyer_id, r.signal_amount, 'PLANNED'
      from public.reservas r
     where r.id = p_reserva and r.signal_amount > 0;

    update public.cartas c
       set status = 'disponivel'
      from public.reservas r
     where r.id = p_reserva and c.id = r.carta_id;
  end if;

  perform public.reserva_append_evento(
    p_reserva, 'TRANSICAO',
    jsonb_build_object('de', v_atual, 'para', p_novo, 'nota', p_nota),
    coalesce(auth.uid()::text, 'system'), p_evento_hash, 1);
end;
$function$;

revoke all on function public.reserva_transicionar(uuid, text, text, text) from public, anon;
grant execute on function public.reserva_transicionar(uuid, text, text, text) to authenticated;

-- ============================================================
-- 6. reserva_transicao_valida — uniformidade Regra 1 (função pura,
--    risco zero; chamadas internas via SECURITY DEFINER não são afetadas).
-- ============================================================

revoke all on function public.reserva_transicao_valida(text, text) from public, anon;
grant execute on function public.reserva_transicao_valida(text, text) to authenticated;

-- FIM 0066 (registro) · SQL verbatim de schema_migrations (version
-- 20260722153146) — nenhuma execução por este arquivo; as funções acima já
-- estavam live antes deste arquivo existir; nada foi (re)aplicado no banco
-- por causa dele.
