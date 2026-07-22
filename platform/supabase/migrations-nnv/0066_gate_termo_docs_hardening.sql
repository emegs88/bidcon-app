-- ============================================================================
-- Bidcon Reserve — 0066: gate de termo assinado + docs completas em
-- gerar_contrato(tipo='cota'), com docs_completas(processo) como helper.
-- ----------------------------------------------------------------------------
-- REGISTRO CRIADO A POSTERIORI (22/07): esta migration já está aplicada no
-- banco (confirmado via `list_migrations` do projeto nnv) mas o script
-- original da sessão de apply não foi salvo localmente — violação da Regra 2
-- do CLAUDE.md (migrations-nnv/ + list_migrations juntos são a fonte da
-- verdade). Corpo abaixo reconstruído via `pg_get_functiondef` do estado atual
-- das duas funções + intenção re-documentada do bloco de decisão da época.
-- Não é o script literal original; é uma reconstrução fiel do resultado.
-- Histórico remoto (`list_migrations`) continua sendo a fonte de ordenação —
-- este arquivo existe só para dar paridade ao repo local.
--
-- O QUE MUDOU (pelo estado atual das funções):
-- - gerar_contrato(p_processo, p_tipo, p_dados, p_versao): para p_tipo='cota',
--   passa a exigir (nesta ordem):
--     1) reserva_inexistente  (P0003) — nenhuma linha em `reservas` com
--        processo_id = p_processo;
--     2) termo_nao_assinado   (P0004) — reserva existe mas state='DRAFT' ou
--        state em ('ANUENCIA_DENIED','REFUNDED','CLOSED','DISPUTED');
--     3) docs_incompletas     (P0005) — docs_completas(p_processo) = false.
--   Mantém tipo_invalido (P0001), processo_inexistente (P0002) e sem_permissao
--   (42501) já existentes. O fluxo antigo (serviço->PIX->cota, gate por
--   pagamentos_sinal) foi removido por completo nesta função — PROIBIDO, não
--   deprecado; sem flag de retorno para o comportamento antigo.
-- - docs_completas(p_processo): helper novo (ou endurecido) que resolve a
--   carta do processo, a administradora, o checklist_modelos ativo (tipo_pessoa
--   'pf') e conta checklist_itens obrigatórios cujo último processo_documentos
--   (por enviado_em desc) não está 'aprovado' — mesmo padrão de
--   checklist_do_processo. Retorna false cedo se carta/administradora/modelo
--   não existir; true apenas se a contagem de faltantes for zero.
--
-- FORA DESTA FATIA (não tocado por esta reconstrução):
-- - nenhuma migration nova é aplicada por este arquivo (zero DB write — as
--   funções abaixo já estão live; isto é documentação, não execução);
-- - o call site que grava `reservas.processo_id` no caminho do cliente veio
--   depois, na 0067 (reservar_carta passa a inserir a reserva DRAFT).
-- ============================================================================

-- NÃO EXECUTAR VIA apply_migration — arquivo file-only, para paridade de
-- histórico local. As definições abaixo são exatamente o que já está live.

CREATE OR REPLACE FUNCTION public.docs_completas(p_processo uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

CREATE OR REPLACE FUNCTION public.gerar_contrato(p_processo uuid, p_tipo text, p_dados jsonb DEFAULT '{}'::jsonb, p_versao text DEFAULT 'v1'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

-- FIM 0066 (registro) · Nenhuma execução — arquivo criado só para paridade de
-- histórico local. As duas funções acima já estavam live antes deste arquivo
-- existir; nada foi (re)aplicado no banco por causa dele.
