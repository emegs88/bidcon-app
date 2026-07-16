-- ============================================================================
-- Migration 0050 · FATIA SYNC-ID — identidade estável de cartas no sync
-- ----------------------------------------------------------------------------
-- Projeto: xtv (xtvjpnyadcdeadhmzyff). Aplicada com AUTORIZO em 16/07/2026.
--
-- NOTA DE NUMERAÇÃO: aplicada via MCP originalmente como "0047_sync_identidade_
-- estavel" (é esse o nome que aparece no histórico de migrations do projeto —
-- imutável, tracking por timestamp). Só depois de aplicar percebi que "0047" e
-- "0048" já estavam ocupados em produção por outras duas migrations
-- (0047_whatsapp_envio, 0048_whatsapp_f3 — aplicadas 12/07, também sem arquivo
-- local, mesmo padrão de drift já visto no repo). Sem conflito funcional
-- (Supabase rastreia por timestamp, não pelo prefixo), mas renomeei o ARQUIVO
-- local pra 0050 (próximo número livre) só para não duplicar prefixo na pasta.
-- O conteúdo abaixo é exatamente o que foi aplicado.
--
-- BUG: entre dois syncs, um mesmo UUID em `cartas` trocou de
--   veículo/Zema/R$244.100 para imóvel/Santander/R$235.000, sem a carta
--   antiga nunca ter sido marcada indisponível — a linha foi silenciosamente
--   reaproveitada para outro bem.
--
-- CAUSA RAIZ (investigada no repo-irmão prospere-360, NÃO neste repo):
--   a chave de upsert hoje é (administradora_origem, numero_externo). Para
--   LANCE, `numero_externo` é o `id` nativo e real do grupo de consórcio no
--   site de origem — estável. Mas para CBC (planilha Google Sheets), PIFFER
--   e CARTAS (scraping HTML), o prospere-360 NÃO tem nenhum identificador
--   nativo nessas 3 fontes (confirmado lendo os parsers: parseCBC extrai só
--   [tipo, adm, credito, entrada, prazo, parcela, status]; parsePiffer e
--   parseCartas idem — nenhuma coluna de contrato/grupo/cota) — o `id` é
--   simplesmente a POSIÇÃO (`i + 1`) do item na lista lida naquele instante.
--   Quando a planilha/página de origem reordena (ex.: uma cota é vendida e
--   sai da lista), tudo que vem depois desliza uma posição, e o
--   `numero_externo` de ontem passa a apontar para uma carta REAL diferente
--   hoje — o upsert então "atualiza" o UUID errado com os dados errados.
--
-- Não existe, hoje, nenhuma chave natural estável (grupo/cota/contrato) para
-- CBC/PIFFER/CARTAS em lugar nenhum do pipeline — nem o site/planilha de
-- origem expõe isso ao scraper do prospere-360. Trocar a chave de upsert
-- para algo "estável" não é possível como pedido originalmente; a correção
-- viável é uma GUARDA: antes de fazer UPDATE numa linha já existente,
-- confirmar que ela ainda representa o MESMO bem. Se tipo/administradora
-- divergirem, ou o crédito mudar de forma implausível (>50%, mesmo padrão de
-- MAX_QUEDA já usado em lib/cotas-source.ts), a posição é tratada como
-- ocupada por OUTRO bem:
--   - a linha antiga vira status='indisponivel', numero_externo=NULL
--     (órfã, sai da varredura de posição, mas o UUID e o histórico —
--     interesses/reservas que apontem pra ela — são PRESERVADOS);
--   - uma linha NOVA é inserida com UUID novo para o item que agora ocupa
--     aquela posição na fonte.
-- Isso vale para as 5 fontes (não só as 3 problemáticas): é uma proteção de
-- identidade, não uma mudança de chave por fonte — em LANCE/SERVOPA, onde a
-- posição já é estável, a guarda simplesmente nunca deve disparar em uso
-- normal (e se disparar, é sinal de algo genuinamente anômalo, vale saber).
--
-- Nenhuma migração de schema/índice é necessária: uniq_cartas_origem_numero
-- (administradora_origem, numero_externo) continua válida — a linha órfã
-- libera a posição ao zerar numero_externo antes do INSERT da nova.
-- ============================================================================

create or replace function public.sync_aplicar_cotas(
  p_origem text,
  p_cotas jsonb,
  p_varrer boolean default true
)
 returns table(novas integer, atualizadas integer, indisponibilizadas integer)
 language plpgsql security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_novas int := 0; v_atu int := 0; v_ind int := 0;
  r record; v_id uuid; v_existe record;
  v_admin_id uuid; v_forn_id uuid;
  v_adm_cota uuid;
  v_adm_fallback uuid;
  v_adm_incoming uuid;
  v_diverge boolean;
begin
  if p_origem is null
     or p_origem not in ('LANCE','CBC','PIFFER','CARTAS','SERVOPA') then
    raise exception 'origem_invalida: %', coalesce(p_origem, '<null>')
      using errcode = 'P0001';
  end if;

  select administradora_id, fornecedor_id into v_admin_id, v_forn_id
    from sync_fonte_config where fonte = p_origem;

  v_adm_fallback := case when p_origem = 'SERVOPA' then v_admin_id else null end;

  create temporary table _presentes (numero integer primary key) on commit drop;
  insert into _presentes (numero)
    select distinct (c->>'numero')::int
    from jsonb_array_elements(p_cotas) c
    where (c->>'numero') is not null;

  for r in
    select
      (c->>'numero')::int               as numero,
      (c->>'tipo')::tipo_bem            as tipo,
      (c->>'valor_credito')::numeric    as valor_credito,
      (c->>'valor_entrada')::numeric    as valor_entrada,
      (c->>'valor_parcela')::numeric    as valor_parcela,
      (c->>'qtd_parcelas')::int         as qtd_parcelas,
      nullif(c->>'entrada_parceiro','')::numeric as entrada_parceiro,
      nullif(trim(c->>'administradora'),'')      as adm_raw
    from jsonb_array_elements(p_cotas) c
  loop
    v_adm_cota := public.resolver_administradora(r.adm_raw);
    v_adm_incoming := coalesce(v_adm_cota, v_adm_fallback);

    select id, tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas,
           status, entrada_parceiro_raw, administradora_id
      into v_existe from cartas
     where administradora_origem = p_origem and numero_externo = r.numero;

    if not found then
      insert into cartas (
        tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas,
        status, numero_externo, fonte, criado_via, sincronizada_em,
        administradora_origem, administradora_id, fornecedor_id,
        entrada_parceiro_raw, administradora_raw
      ) values (
        r.tipo, r.valor_credito, r.valor_entrada, r.valor_parcela, r.qtd_parcelas,
        'disponivel', r.numero, '360prospere', 'sync', now(),
        p_origem, v_adm_incoming, v_forn_id,
        r.entrada_parceiro, r.adm_raw
      ) returning id into v_id;

      v_novas := v_novas + 1;
      insert into eventos_sync (tipo, numero_externo, carta_id, detalhe, push_pendente)
      values ('carta_nova', r.numero, v_id,
              p_origem || ' crédito ' || r.valor_credito::text, true);

    else
      -- GUARDA DE IDENTIDADE: a posição (administradora_origem, numero_externo)
      -- já existia, mas o tipo ou a administradora divergem, ou o crédito mudou
      -- de forma implausível (>50%) — não é mais o mesmo bem. NUNCA sobrescreve;
      -- orfaniza a linha antiga (preserva UUID/histórico) e insere uma nova.
      v_diverge :=
        v_existe.tipo is distinct from r.tipo
        or v_existe.administradora_id is distinct from v_adm_incoming
        or (
          v_existe.valor_credito > 0
          and abs(r.valor_credito - v_existe.valor_credito) / v_existe.valor_credito > 0.5
        );

      if v_diverge then
        update cartas
           set status = 'indisponivel', numero_externo = null, sincronizada_em = now()
         where id = v_existe.id;

        insert into eventos_sync (tipo, numero_externo, carta_id, detalhe)
        values ('carta_indisponivel', r.numero, v_existe.id,
                p_origem || ' posição reocupada por outro bem (identidade divergente)');

        insert into cartas (
          tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas,
          status, numero_externo, fonte, criado_via, sincronizada_em,
          administradora_origem, administradora_id, fornecedor_id,
          entrada_parceiro_raw, administradora_raw
        ) values (
          r.tipo, r.valor_credito, r.valor_entrada, r.valor_parcela, r.qtd_parcelas,
          'disponivel', r.numero, '360prospere', 'sync', now(),
          p_origem, v_adm_incoming, v_forn_id,
          r.entrada_parceiro, r.adm_raw
        ) returning id into v_id;

        v_novas := v_novas + 1;
        insert into eventos_sync (tipo, numero_externo, carta_id, detalhe, push_pendente)
        values ('carta_nova', r.numero, v_id,
                p_origem || ' crédito ' || r.valor_credito::text || ' (posição reciclada)', true);

      elsif v_existe.status = 'indisponivel'
         or v_existe.valor_credito is distinct from r.valor_credito
         or v_existe.valor_entrada is distinct from r.valor_entrada
         or v_existe.valor_parcela is distinct from r.valor_parcela
         or v_existe.qtd_parcelas  is distinct from r.qtd_parcelas
         or v_existe.entrada_parceiro_raw is distinct from r.entrada_parceiro
      then
        update cartas set
          tipo = r.tipo,
          valor_credito = r.valor_credito,
          valor_entrada = r.valor_entrada,
          valor_parcela = r.valor_parcela,
          qtd_parcelas  = r.qtd_parcelas,
          entrada_parceiro_raw = r.entrada_parceiro,
          status = case when v_existe.status = 'indisponivel'
                        then 'disponivel' else v_existe.status end,
          sincronizada_em = now(),
          administradora_raw = coalesce(r.adm_raw, administradora_raw),
          administradora_id  = coalesce(v_adm_incoming, administradora_id),
          fornecedor_id      = coalesce(fornecedor_id, v_forn_id)
        where administradora_origem = p_origem and numero_externo = r.numero;

        v_atu := v_atu + 1;
        insert into eventos_sync (tipo, numero_externo, carta_id, detalhe)
        values ('carta_atualizada', r.numero, v_existe.id, p_origem || ' valores/sync');
      else
        update cartas set
          sincronizada_em = now(),
          administradora_raw = coalesce(r.adm_raw, administradora_raw),
          administradora_id  = coalesce(v_adm_incoming, administradora_id),
          fornecedor_id      = coalesce(fornecedor_id, v_forn_id)
        where administradora_origem = p_origem and numero_externo = r.numero;
      end if;
    end if;
  end loop;

  if p_varrer then
    with sumidas as (
      update cartas set status = 'indisponivel', sincronizada_em = now()
      where administradora_origem = p_origem
        and fonte = '360prospere'
        and status = 'disponivel'
        and numero_externo is not null
        and numero_externo not in (select numero from _presentes)
      returning numero_externo, id
    )
    insert into eventos_sync (tipo, numero_externo, carta_id, detalhe)
    select 'carta_indisponivel', numero_externo, id, p_origem || ' ausente na fonte'
    from sumidas;

    get diagnostics v_ind = row_count;
  else
    v_ind := 0;
  end if;

  novas := v_novas; atualizadas := v_atu; indisponibilizadas := v_ind;
  return next;
end;
$function$;

-- sync_varrer_ausentes (chamada em lote único ao final, ver route.ts) já
-- filtra numero_externo is not null — linhas órfãs (recém-zeradas acima)
-- ficam automaticamente fora da varredura por posição. Sem mudança nela.
