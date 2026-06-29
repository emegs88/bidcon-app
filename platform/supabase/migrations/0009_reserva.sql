-- ============================================================================
-- Bidcon — plataforma logada · Migration 0009 · Reserva de carta pelo cliente
-- ----------------------------------------------------------------------------
-- Rascunho para revisão. RODA NO DEV (e, com "autorizo", em PROD pelo Emerson).
--
-- O QUE FAZ
--   Permite que o CLIENTE inicie uma reserva de uma carta disponível. Hoje o
--   `processos` não tem policy de INSERT para o client (migration 0002): a
--   escrita é server-side. Em vez de abrir um INSERT direto (que exigiria
--   replicar várias travas em RLS), expomos UMA função controlada:
--
--     public.reservar_carta(p_carta_id uuid) returns uuid  (= processo_id)
--
--   `security definer`, atômica, com TODAS as travas no servidor:
--     1) chamador autenticado;
--     2) KYC do chamador = 'verificado' (gate de identidade);
--     3) carta existe e está 'disponivel' (lock FOR UPDATE evita corrida);
--     4) chamador ainda não tem processo ATIVO para essa carta;
--   então:
--     - cria `processos` (cliente_id = auth.uid(), status 'reservada',
--       valores COPIADOS da carta — sem administradora/taxa/fundo);
--     - marca a carta como 'reservada' (sai da vitrine);
--     - grava o evento inicial em `processo_eventos` (de_status null).
--
-- COMPLIANCE / LGPD
--   Nada aqui promete contemplação. Não há dado bancário. A função só copia
--   valor_credito/valor_entrada da carta para o processo (mesmos campos que o
--   cliente já vê na vitrine). parceiro_id é herdado da carta quando houver,
--   apenas para rastreio interno — não é exibido ao cliente.
-- ============================================================================

create or replace function public.reservar_carta(p_carta_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_kyc        kyc_status;
  v_carta      cartas%rowtype;
  v_processo   uuid;
  v_existente  uuid;
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

  -- 4) evita processo ativo duplicado do mesmo cliente para a mesma carta
  select id into v_existente
    from processos
   where cliente_id = v_uid
     and carta_id   = p_carta_id
     and status <> 'cancelado'
   limit 1;
  if v_existente is not null then
    return v_existente;  -- idempotente: devolve a reserva já existente
  end if;

  -- ----- escrita atômica -----------------------------------------------------
  insert into processos (cliente_id, parceiro_id, carta_id, status,
                         valor_carta, valor_entrada)
  values (v_uid, v_carta.parceiro_id, p_carta_id, 'reservada',
          v_carta.valor_credito, v_carta.valor_entrada)
  returning id into v_processo;

  -- carta sai da vitrine
  update cartas set status = 'reservada' where id = p_carta_id;

  -- evento inicial da timeline (de_status null = criação)
  insert into processo_eventos (processo_id, de_status, para_status, nota)
  values (v_processo, null, 'reservada', 'Reserva iniciada pelo cliente.');

  return v_processo;
end;
$$;

revoke all on function public.reservar_carta(uuid) from public;
grant execute on function public.reservar_carta(uuid) to authenticated;
