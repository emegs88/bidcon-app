-- ============================================================================
-- Bidcon Reserve — 0067: reservar_carta passa a criar a linha em `reservas`
-- (DRAFT, vinculada ao processo) atomicamente; neutraliza o fóssil 10-20% em
-- reserva_criar (função só-ops, sem call site no app, mas continua existindo
-- como ferramenta manual — precisa aceitar signal_amount=0 no caminho novo).
-- ----------------------------------------------------------------------------
-- Por quê: gerar_contrato (0066) já tem o gate reserva_inexistente/
-- termo_nao_assinado/docs_incompletas — mas nenhum caminho do app grava
-- processo_id em `reservas`. Sem isso o gate nunca abre. Decisão Emerson
-- (Option A-mínima): reservar_carta grava a reserva DRAFT na mesma transação
-- da criação do processo; assinatura (TERMS_SIGNED) continua manual via
-- reserva_transicionar (ops) — sem automação de assinatura nesta fatia.
--
-- price_total = valor_entrada (não valor_credito): preço da cessão é a
-- entrada — o crédito é poder de compra transferido, não preço pago; é a
-- entrada que o escrow (Conta Notarial) devolve em caso de negativa.
--
-- Guard novo (Emerson, achado em revisão pré-apply): cartas.valor_entrada é
-- nullable; reservas.price_total é NOT NULL. Entrada nula ou zero = cadastro
-- inválido; invariante do Reserve system é price_total > 0 (mesma regra do
-- reserva_criar). Falha nomeada > dado ruim silencioso. Backlog (fora desta
-- fatia): guard de qualidade upstream — carta só entra/permanece
-- 'disponivel' com valor_entrada > 0, na camada de sync/cadastro.
-- ============================================================================

begin;

create or replace function public.reservar_carta(p_carta_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid        uuid := auth.uid();
  v_kyc        kyc_status;
  v_carta      cartas%rowtype;
  v_processo   uuid;
  v_existente  uuid;
  v_conf       text;
begin
  -- 1) autenticação
  if v_uid is null then
    raise exception 'nao_autenticado' using errcode = '42501';
  end if;

  -- 2) gate de KYC: só cliente verificado reserva
  select status_kyc into v_kyc from kyc_perfis where user_id = v_uid;
  if v_kyc is distinct from 'verificado' then
    raise exception 'kyc_nao_verificado' using errcode = 'P0001';
  end if;

  -- 3) carta tem que existir e estar disponível (lock evita reserva dupla)
  select * into v_carta
    from cartas
   where id = p_carta_id
   for update;

  if not found then
    raise exception 'carta_inexistente' using errcode = 'P0002';
  end if;

  if v_carta.status <> 'disponivel' then
    raise exception 'carta_indisponivel' using errcode = 'P0001';
  end if;

  -- 3b) NOVO: guard de qualidade de cadastro — price_total (= valor_entrada)
  -- precisa ser > 0 para a linha em `reservas` (invariante do Reserve
  -- system). Falha nomeada, antes de qualquer escrita.
  if coalesce(v_carta.valor_entrada, 0) <= 0 then
    raise exception 'carta_sem_entrada' using errcode = 'P0006';
  end if;

  -- 4) evita processo ativo duplicado do mesmo cliente para a mesma carta
  select id into v_existente
    from processos
   where cliente_id = v_uid
     and carta_id   = p_carta_id
     and status <> 'cancelado'
   limit 1;
  if v_existente is not null then
    return v_existente;  -- idempotente
  end if;

  -- confirmação de parceiro: 'pendente' só quando a fonte-marca NÃO é LANCE.
  -- LANCE (ou carta sem origem, ex.: manual) => NULL, comportamento intocado.
  v_conf := case
              when v_carta.administradora_origem is not null
                   and v_carta.administradora_origem <> 'LANCE'
              then 'pendente'
              else null
            end;

  -- ----- escrita atômica -----------------------------------------------------
  insert into processos (cliente_id, parceiro_id, carta_id, status,
                         valor_carta, valor_entrada, status_confirmacao_parceiro)
  values (v_uid, v_carta.parceiro_id, p_carta_id, 'reservada',
          v_carta.valor_credito, v_carta.valor_entrada, v_conf)
  returning id into v_processo;

  update cartas set status = 'reservada' where id = p_carta_id;

  insert into processo_eventos (processo_id, de_status, para_status, nota)
  values (v_processo, null, 'reservada',
          case when v_conf = 'pendente'
               then 'Reserva iniciada pelo cliente. Confirmação com parceiro pendente.'
               else 'Reserva iniciada pelo cliente.' end);

  -- NOVO (0067): linha em `reservas` vinculada ao processo, estado DRAFT.
  -- Sem evento na hash-chain (reserva_append_evento exige is_admin; um DRAFT
  -- recém-criado sem eventos é ponto de partida válido da cadeia — ops
  -- registra TERMS_SIGNED depois via reserva_transicionar). valid_until é
  -- teto interno do Reserve system; o prazo visível ao cliente segue
  -- processos.prazo_em — dois relógios, não confundir.
  insert into reservas (carta_id, buyer_id, seller_id, price_total,
                        signal_amount, fee_plan, state, valid_until, processo_id)
  values (p_carta_id, v_uid, null, v_carta.valor_entrada,
          0, '{}'::jsonb, 'DRAFT', now() + interval '45 days', v_processo);

  return v_processo;
end;
$function$;

create or replace function public.reserva_criar(p_carta uuid, p_buyer uuid, p_seller uuid, p_sourcing uuid, p_selling uuid, p_price numeric, p_signal numeric, p_fee_plan jsonb, p_evento_hash text, p_processo uuid DEFAULT NULL::uuid)
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
  -- NEUTRALIZADO (0067): aceita signal_amount=0 (caminho novo, sem sinal
  -- pré-pago) além da faixa 10-20% original (uso manual/legado, ops).
  if not (p_signal = 0 or (p_signal >= p_price * 0.10 and p_signal <= p_price * 0.20)) then
    raise exception 'signal_amount deve ser 0 ou ficar entre 10%% e 20%% do price_total';
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

commit;

-- FIM 0067 · reservar_carta grava reserva DRAFT vinculada ao processo (mesma
-- transação), com guard carta_sem_entrada. reserva_criar aceita
-- signal_amount=0. Nenhuma tabela/coluna removida ou renomeada; nenhum
-- grant alterado.

-- ============================================================================
-- FIXTURES DE SMOKE (22/07/2026) — dados de TESTE, não-clientes.
-- Mantidos no nnv como evidência do smoke da 0067; o append-only de
-- reserva_eventos impede remoção (comportamento projetado, não bug).
-- carta:    22222222-2222-2222-2222-222222222222
-- processo: 0165d91a-329d-415f-8e0b-1fc738c5f4f8
-- reserva:  f87168fd-64c1-464a-a826-d3f2630a06af (TERMS_SIGNED — cobaia
--           oficial do smoke da 0068; parking CLOSED só depois dela)
-- kyc:      3b27a217-f81c-4ca2-9768-23759760ba88 ("Cliente Teste")
-- ============================================================================
