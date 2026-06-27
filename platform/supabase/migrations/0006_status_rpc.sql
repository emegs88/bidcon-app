-- ============================================================================
-- Bidcon — plataforma logada · Migration 0006 · RPCs de mudança de status
-- ----------------------------------------------------------------------------
-- Rascunho para revisão. RODA EM PRODUÇÃO PELO EMERSON (SQL editor do Supabase).
-- O agente NÃO aplica nada em PROD — aqui só validamos a sintaxe localmente.
--
-- Por quê RPC `security definer` (e não UPDATE solto no client):
--   - As policies de 0002 NÃO concedem UPDATE de status para parceiro em
--     `processos`/`comissoes` (evita auto-liberação). Mudança de status é uma
--     OPERAÇÃO, não uma edição livre de linha.
--   - Estas funções rodam com os privilégios do dono (security definer), então
--     enxergam todas as linhas, MAS cada uma valida o papel do chamador
--     (auth.uid()) ANTES de escrever. A checagem de papel vive no servidor SQL,
--     não no client.
--   - `avancar_status_processo` grava a trilha em `processo_eventos` na MESMA
--     transação (função = atômica): status novo + evento de→para juntos.
--
-- Escopo desta migration: SOMENTE as 4 funções abaixo + grants de EXECUTE.
--   Nenhuma policy é criada/alterada aqui. Nenhum dado é tocado.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) avancar_status_processo — admin OU o parceiro do processo.
--    Valida transição (só "frente" na ordem, ou cancelar), grava evento.
-- ----------------------------------------------------------------------------
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
  v_ordem    constant status_processo[] := array[
    'reservada','documentacao','analise_administradora','transferencia','concluido'
  ]::status_processo[];
  v_i_atual int;
  v_i_novo  int;
begin
  -- carrega o processo (a função vê tudo; o filtro de papel é manual abaixo)
  select status, parceiro_id into v_atual, v_parceiro
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
end;
$$;

-- ----------------------------------------------------------------------------
-- 2) definir_status_carta — admin OU o dono da carta (parceiro_id).
--    Estoque Bidcon (parceiro_id null) é admin-only.
-- ----------------------------------------------------------------------------
create or replace function public.definir_status_carta(
  p_carta uuid,
  p_novo  status_carta
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dono uuid;
begin
  select parceiro_id into v_dono from cartas where id = p_carta;

  if not found then
    raise exception 'carta_inexistente' using errcode = 'P0002';
  end if;

  -- admin sempre; parceiro só na própria carta (estoque sem dono = admin-only)
  if not (is_admin() or (v_dono is not null and v_dono = auth.uid())) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;

  update cartas set status = p_novo where id = p_carta;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3) liberar_comissao — ADMIN-ONLY. Parceiro nunca libera a própria.
--    prevista -> liberada, carimba liberada_em.
-- ----------------------------------------------------------------------------
create or replace function public.liberar_comissao(p_comissao uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status status_comissao;
begin
  if not is_admin() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;

  select status into v_status from comissoes where id = p_comissao;
  if not found then
    raise exception 'comissao_inexistente' using errcode = 'P0002';
  end if;
  if v_status <> 'prevista' then
    raise exception 'transicao_invalida' using errcode = 'P0001';
  end if;

  update comissoes
     set status = 'liberada', liberada_em = now()
   where id = p_comissao;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) marcar_comissao_paga — ADMIN-ONLY. liberada -> paga.
-- ----------------------------------------------------------------------------
create or replace function public.marcar_comissao_paga(p_comissao uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status status_comissao;
begin
  if not is_admin() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;

  select status into v_status from comissoes where id = p_comissao;
  if not found then
    raise exception 'comissao_inexistente' using errcode = 'P0002';
  end if;
  if v_status <> 'liberada' then
    raise exception 'transicao_invalida' using errcode = 'P0001';
  end if;

  update comissoes set status = 'paga' where id = p_comissao;
end;
$$;

-- ----------------------------------------------------------------------------
-- Grants: o client autenticado pode CHAMAR as funções; a checagem de papel
-- vive DENTRO de cada uma. Anônimo (anon) não chama nada disto.
-- ----------------------------------------------------------------------------
revoke all on function public.avancar_status_processo(uuid, status_processo, text) from public;
revoke all on function public.definir_status_carta(uuid, status_carta)            from public;
revoke all on function public.liberar_comissao(uuid)                              from public;
revoke all on function public.marcar_comissao_paga(uuid)                          from public;

grant execute on function public.avancar_status_processo(uuid, status_processo, text) to authenticated;
grant execute on function public.definir_status_carta(uuid, status_carta)            to authenticated;
grant execute on function public.liberar_comissao(uuid)                              to authenticated;
grant execute on function public.marcar_comissao_paga(uuid)                          to authenticated;

-- ============================================================================
-- Verificação rápida (opcional, após aplicar, logado como cada papel):
--   -- como parceiro dono: avança o próprio processo
--   select avancar_status_processo('<processo>', 'documentacao', 'docs ok');
--   -- como parceiro NÃO-dono: deve falhar com 'sem_permissao'
--   -- como admin: libera/paga comissão
--   select liberar_comissao('<comissao>');
--   select marcar_comissao_paga('<comissao>');
-- ============================================================================
