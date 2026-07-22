-- ============================================================================
-- Bidcon Reserve — F7a: status de cartório (aditivo puro).
-- ----------------------------------------------------------------------------
-- Acrescenta reservas.cartorio_status (nullable, CHECK) + a RPC
-- reserva_atualizar_cartorio, no MESMO padrão de reserva_transicionar (0016):
-- security definer, search_path fixo, gate is_admin(), lock da linha, evento
-- com hash-chain via reserva_append_evento, updated_at = now().
--
-- Não altera nem remove nada de 0001-0062. Nenhum DROP TABLE/COLUMN/DELETE/
-- TRUNCATE. Não usa execute_sql avulso.
--
-- APLICADA EM PRODUÇÃO (nnv) em 22/07/2026.
--
-- Numeração saltou 0022 → 0063 por engano (derivada da pasta do xtv).
-- Mantida idêntica ao name no histórico aplicado do nnv. Ordenação real = timestamp
-- version (Supabase); o gap é só cosmético. PRÓXIMA migration nnv = 0065 (monotônico).
-- ============================================================================

begin;

-- 1) Coluna cartorio_status (aditiva, nullable — reservas fora do fluxo de
--    cartório simplesmente não usam este campo).
alter table public.reservas
  add column if not exists cartorio_status text;

alter table public.reservas
  drop constraint if exists reservas_cartorio_status_check;

alter table public.reservas
  add constraint reservas_cartorio_status_check
  check (
    cartorio_status is null or cartorio_status in (
      'boleto_emitido_cartorio',
      'pagamento_confirmado_cartorio',
      'aguardando_administradora',
      'liberado',
      'devolvido'
    )
  );

-- 2) RPC reserva_atualizar_cartorio.
create or replace function public.reserva_atualizar_cartorio(
  p_reserva uuid,
  p_novo_status text,
  p_nota text,
  p_evento_hash text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_atual text;
begin
  if not public.is_admin() then
    raise exception 'apenas ops (admin) pode atualizar status de cartorio';
  end if;

  select cartorio_status into v_atual
    from public.reservas
   where id = p_reserva
     for update;

  if not found then
    raise exception 'reserva inexistente';
  end if;

  if p_novo_status not in (
    'boleto_emitido_cartorio',
    'pagamento_confirmado_cartorio',
    'aguardando_administradora',
    'liberado',
    'devolvido'
  ) then
    raise exception 'cartorio_status invalido: %', p_novo_status;
  end if;

  update public.reservas
     set cartorio_status = p_novo_status,
         updated_at = now()
   where id = p_reserva;

  perform public.reserva_append_evento(
    p_reserva,
    'CARTORIO_STATUS',
    jsonb_build_object('de', v_atual, 'para', p_novo_status, 'nota', p_nota),
    coalesce(auth.uid()::text, 'system'),
    p_evento_hash,
    1
  );
end;
$$;

revoke all on function public.reserva_atualizar_cartorio(uuid, text, text, text) from public;
grant execute on function public.reserva_atualizar_cartorio(uuid, text, text, text) to authenticated;

commit;

-- FIM 0063 · Aditivo puro sobre reservas (0016). Nenhuma RPC/tabela removida.
