-- ============================================================================
-- Bidcon — plataforma logada · Migration 0010 · Propagação de status da carta
-- ----------------------------------------------------------------------------
-- Rascunho para revisão. RODA EM PRODUÇÃO PELO EMERSON (SQL editor do Supabase).
-- O agente NÃO aplica nada em PROD — aqui só validamos a sintaxe localmente.
--
-- Motivação:
--   Hoje `avancar_status_processo` (0006) move APENAS o status do processo. O
--   status da `carta` é independente (definir_status_carta). Isso deixou cartas
--   "presas" em 'reservada' mesmo após o processo concluir, e voltaria a sobrar
--   carta reservada em processos cancelados. Decisão de produto (Emerson):
--     - processo -> 'concluido'  => carta -> 'vendida'
--     - processo -> 'cancelado'  => carta -> 'disponivel' (reentra na vitrine)
--   Tudo na MESMA transação da mudança de status do processo (atômico).
--
-- Escopo: SOMENTE substitui a função `avancar_status_processo`. Nenhuma policy,
--   nenhum enum, nenhum outro objeto é tocado. Os grants de 0006 permanecem
--   (CREATE OR REPLACE preserva os privilégios já concedidos).
--
-- status_carta válido (enum): disponivel | reservada | vendida | indisponivel
-- ============================================================================

create or replace function public.avancar_status_processo(
  p_processo uuid,
  p_novo     status_processo,
  p_nota     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_atual    status_processo;
  v_parceiro uuid;
  v_carta    uuid;
  v_ordem    constant status_processo[] := array[
    'reservada','documentacao','analise_administradora','transferencia','concluido'
  ]::status_processo[];
  v_i_atual int;
  v_i_novo  int;
begin
  -- carrega o processo (a função vê tudo; o filtro de papel é manual abaixo)
  select status, parceiro_id, carta_id into v_atual, v_parceiro, v_carta
  from processos where id = p_processo;

  if not found then
    raise exception 'processo_inexistente' using errcode = 'P0002';
  end if;

  -- papel: admin sempre; parceiro só se for o dono do processo
  if not (is_admin() or v_parceiro = auth.uid()) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;

  -- já está cancelado/concluído? não reabre
  if v_atual in ('cancelado','concluido') then
    raise exception 'status_terminal' using errcode = 'P0001';
  end if;

  -- cancelar é permitido a partir de qualquer estado não-terminal
  if p_novo <> 'cancelado' then
    v_i_atual := array_position(v_ordem, v_atual);
    v_i_novo  := array_position(v_ordem, p_novo);
    -- só avança um passo de cada vez, sempre para frente
    if v_i_novo is null or v_i_atual is null or v_i_novo <> v_i_atual + 1 then
      raise exception 'transicao_invalida' using errcode = 'P0001';
    end if;
  end if;

  update processos
     set status = p_novo, atualizado_em = now()
   where id = p_processo;

  insert into processo_eventos (processo_id, de_status, para_status, nota)
  values (p_processo, v_atual, p_novo, nullif(btrim(coalesce(p_nota,'')), ''));

  -- ---- propagação do status da carta (mesma transação) --------------------
  -- Só age quando o processo tem carta vinculada (carta_id pode ser null por
  -- 'on delete set null'). Concluir => vendida; cancelar => volta à vitrine.
  if v_carta is not null then
    if p_novo = 'concluido' then
      update cartas set status = 'vendida'     where id = v_carta;
    elsif p_novo = 'cancelado' then
      update cartas set status = 'disponivel'  where id = v_carta;
    end if;
  end if;
end;
$$;

-- ============================================================================
-- Verificação (opcional, após aplicar):
--   -- avançar até concluir e conferir a carta:
--   select avancar_status_processo('<processo>', 'documentacao');
--   select avancar_status_processo('<processo>', 'analise_administradora');
--   select avancar_status_processo('<processo>', 'transferencia');
--   select avancar_status_processo('<processo>', 'concluido');
--   select status from cartas where id = (select carta_id from processos where id='<processo>');
--   -- esperado: 'vendida'
--
--   -- cancelar e conferir reentrada na vitrine:
--   select avancar_status_processo('<outro_processo>', 'cancelado');
--   -- carta do processo cancelado deve voltar para 'disponivel'
-- ============================================================================
