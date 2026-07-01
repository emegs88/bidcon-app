-- ============================================================================
-- Bidcon — plataforma logada · Migration 0014 · Fluxo pós-reserva do cliente
-- ----------------------------------------------------------------------------
-- Rascunho para revisão. RODA NO DEV PELO EMERSON (SQL editor do Supabase).
-- O agente NÃO aplica nada — aqui só validamos a sintaxe localmente.
--
-- O que entrega (modelo Lance, 10 etapas → SUB-ETAPAS dentro dos 5 status):
--   - Sub-etapas do processo (não novos status de topo: a régua de 0006 continua
--     avançando 1 passo por vez; as etapas finas vivem em `processos.subetapa`).
--   - Check-list de documentos POR ADMINISTRADORA (Lance PF/PJ agora; outras
--     administradoras entram como dados depois, sem código novo).
--   - Upload de documentos do processo (bucket privado, LGPD, signed URL).
--   - Contratos (serviço e cota) com snapshot factual em jsonb.
--   - Rastreio do sinal PIX (sem dado bancário do cliente).
--   - Metadado admin da carta: comissão daquela carta (fonte já existe em 0004).
--
-- COMPLIANCE / LGPD (invioláveis):
--   - Nada de contemplação/prazo/renda/rendimento/investimento ao cliente.
--   - administradora/taxa/fundo/comissão NUNCA no payload do cliente.
--   - Documentos, comprovantes e contratos = dado sensível → bucket PRIVADO,
--     acesso só por signed URL server-side após checagem de papel. Nada público.
--   - Veredito de documento e confirmação de sinal só por RPC (não UPDATE solto).
--
-- Reuso: is_admin() (0002), avancar_status_processo (0006), processos/
--   processo_eventos (0001/0003), administradoras (0011). Padrão de storage e de
--   RPC admin-only espelham 0008 (KYC).
--
-- Escopo: enums + colunas aditivas + tabelas novas + RPCs security definer +
--   policies de storage. Nenhum dado existente é tocado.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) COLUNAS ADITIVAS
-- ----------------------------------------------------------------------------

-- Sub-etapa fina do processo (mapa Lance). NULL = ainda na etapa implícita do
-- status de topo (ex.: 'reservada' recém-criada). A régua de topo é a de 0006.
do $$ begin
  create type processo_subetapa as enum (
    'docs_enviados',      -- 2  Documentação enviada p/ pré-análise
    'pre_analise',        -- 3  Parecer da documentação
    'sinal_pix',          -- 4  Reserva das cotas (sinal 2%, validade 3 dias úteis)
    'contrato_cota',      -- 5  Assinatura do contrato de compra e venda
    'entrada',            -- 6  Pagamento da entrada (residual, menos o sinal)
    'formulario',         -- 7  Envio do formulário (ficha cadastral)
    'link_transferencia', -- 8  Link de assinatura de transferência (e-mail)
    'efetivacao',         -- 9  Análise/efetivação da transferência
    'faturamento'         -- 10 Processo de faturamento
  );
exception when duplicate_object then null; end $$;

alter table public.processos
  add column if not exists subetapa processo_subetapa,
  add column if not exists prazo_em timestamptz;  -- validade da reserva (ex.: 3 dias úteis)

-- Comissão DAQUELA carta (admin-only; nunca sai em query de cliente/parceiro).
-- `fonte` (site de origem) já existe desde 0004 — não recriar aqui.
alter table public.cartas
  add column if not exists comissao_percentual numeric(5,2);

-- ----------------------------------------------------------------------------
-- 1) CHECK-LIST DE DOCUMENTOS — POR ADMINISTRADORA (configurável, sem código)
--    checklist_modelos(administradora, tipo_pessoa) → checklist_itens(rótulos)
--    Regra factual do bem: leitura para logado; escrita só admin.
-- ----------------------------------------------------------------------------
create table if not exists public.checklist_modelos (
  id               uuid primary key default gen_random_uuid(),
  administradora_id uuid not null references public.administradoras(id) on delete cascade,
  tipo_pessoa      text not null check (tipo_pessoa in ('pf','pj')),
  ativo            boolean not null default true,
  criado_em        timestamptz not null default now(),
  unique (administradora_id, tipo_pessoa)
);

create table if not exists public.checklist_itens (
  id           uuid primary key default gen_random_uuid(),
  modelo_id    uuid not null references public.checklist_modelos(id) on delete cascade,
  ordem        int  not null default 0,
  rotulo       text not null,               -- rótulo do documento (visível ao cliente)
  obrigatorio  boolean not null default true,
  aceita_multi boolean not null default false,
  criado_em    timestamptz not null default now()
);

create index if not exists idx_checklist_itens_modelo on public.checklist_itens(modelo_id);

alter table public.checklist_modelos enable row level security;
alter table public.checklist_itens   enable row level security;

-- leitura: qualquer usuário autenticado (é regra factual, sem segredo).
create policy checklist_modelos_read on public.checklist_modelos
  for select to authenticated using (true);
create policy checklist_itens_read on public.checklist_itens
  for select to authenticated using (true);

-- escrita: só admin.
create policy checklist_modelos_admin on public.checklist_modelos
  for all using (is_admin()) with check (is_admin());
create policy checklist_itens_admin on public.checklist_itens
  for all using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- 2) DOCUMENTOS DO PROCESSO — upload por item de check-list (LGPD)
--    Arquivo no bucket privado `processo-docs`, prefixo '{processo_id}/...'.
--    Veredito (aprovado/reprovado) só via RPC decidir_documento (admin).
-- ----------------------------------------------------------------------------
create table if not exists public.processo_documentos (
  id               uuid primary key default gen_random_uuid(),
  processo_id      uuid not null references public.processos(id) on delete cascade,
  checklist_item_id uuid references public.checklist_itens(id) on delete set null,
  path             text not null,   -- '{processo_id}/arquivo' no bucket processo-docs
  enviado_em       timestamptz not null default now(),
  status           text not null default 'pendente'
                     check (status in ('pendente','aprovado','reprovado')),
  motivo           text,
  decidido_em      timestamptz,
  decidido_por     uuid references public.profiles(id) on delete set null
);

create index if not exists idx_processo_documentos_proc on public.processo_documentos(processo_id);

alter table public.processo_documentos enable row level security;

-- dono do processo (cliente) lê os próprios; admin lê tudo.
create policy proc_docs_select on public.processo_documentos
  for select using (
    is_admin()
    or exists (
      select 1 from public.processos p
      where p.id = processo_id and p.cliente_id = auth.uid()
    )
  );

-- dono do processo insere os próprios (sempre como 'pendente'; veredito é RPC).
create policy proc_docs_insert on public.processo_documentos
  for insert with check (
    status = 'pendente'
    and exists (
      select 1 from public.processos p
      where p.id = processo_id and p.cliente_id = auth.uid()
    )
  );

-- admin faz o resto (o veredito propriamente dito passa pela RPC abaixo).
create policy proc_docs_admin on public.processo_documentos
  for all using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- 3) CONTRATOS — serviço (intermediação) e cota (compra e venda)
--    `dados` jsonb = snapshot factual (nome, CPF, valores, descrição do bem).
--    NUNCA administradora/taxa/comissão no contrato do CLIENTE.
--    PDF (se houver) no bucket privado `contratos`.
-- ----------------------------------------------------------------------------
create table if not exists public.contratos (
  id            uuid primary key default gen_random_uuid(),
  processo_id   uuid not null references public.processos(id) on delete cascade,
  tipo          text not null check (tipo in ('servico','cota')),
  versao_modelo text not null default 'v1',
  dados         jsonb not null default '{}'::jsonb,
  status        text not null default 'gerado'
                  check (status in ('gerado','enviado','assinado','cancelado')),
  pdf_path      text,             -- '{processo_id}/...' no bucket contratos (opcional)
  provedor_ref  text,             -- id da assinatura no provedor (quando houver)
  criado_em     timestamptz not null default now(),
  assinado_em   timestamptz
);

create index if not exists idx_contratos_proc on public.contratos(processo_id);

alter table public.contratos enable row level security;

-- dono do processo lê os próprios contratos; admin lê tudo.
create policy contratos_select on public.contratos
  for select using (
    is_admin()
    or exists (
      select 1 from public.processos p
      where p.id = processo_id and p.cliente_id = auth.uid()
    )
  );

-- criação/alteração via RPC (security definer) ou admin. Cliente não escreve solto.
create policy contratos_admin on public.contratos
  for all using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- 4) PAGAMENTO DO SINAL (PIX) — rastreio SEM dado bancário do cliente
--    provedor_ref = txid/charge id do gateway (ex.: cob do PIX).
--    Confirmação manual = admin-only (fallback). Webhook do gateway confirma
--    via service_role (bypassa RLS), server-side.
-- ----------------------------------------------------------------------------
create table if not exists public.pagamentos_sinal (
  id               uuid primary key default gen_random_uuid(),
  processo_id      uuid not null references public.processos(id) on delete cascade,
  valor            numeric(14,2) not null,
  metodo           text not null default 'pix',
  provedor_ref     text,        -- txid / charge id (nunca dado bancário do cliente)
  qr_payload       text,        -- copia-e-cola / payload do QR (quando gerado)
  status           text not null default 'pendente'
                     check (status in ('pendente','pago','expirado','manual')),
  comprovante_path text,        -- '{processo_id}/...' no bucket processo-docs
  criado_em        timestamptz not null default now(),
  confirmado_em    timestamptz,
  confirmado_por   uuid references public.profiles(id) on delete set null
);

create index if not exists idx_pagamentos_sinal_proc on public.pagamentos_sinal(processo_id);

alter table public.pagamentos_sinal enable row level security;

-- dono do processo lê o próprio; admin lê tudo.
create policy sinal_select on public.pagamentos_sinal
  for select using (
    is_admin()
    or exists (
      select 1 from public.processos p
      where p.id = processo_id and p.cliente_id = auth.uid()
    )
  );

-- dono pode ANEXAR comprovante (insert de intenção manual); status/valor factual.
create policy sinal_insert_dono on public.pagamentos_sinal
  for insert with check (
    status in ('pendente','manual')
    and exists (
      select 1 from public.processos p
      where p.id = processo_id and p.cliente_id = auth.uid()
    )
  );

-- confirmação/expiração via RPC ou admin.
create policy sinal_admin on public.pagamentos_sinal
  for all using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- 5) RPCs security definer (checagem de papel DENTRO de cada uma)
-- ----------------------------------------------------------------------------

-- 5.1 processo_avancar_subetapa — admin OU parceiro dono. Grava evento.
--     Só grava a sub-etapa; o avanço de status de topo continua sendo
--     avancar_status_processo (0006), chamado à parte pela camada admin.
create or replace function public.processo_avancar_subetapa(
  p_processo uuid,
  p_subetapa processo_subetapa,
  p_nota     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status   status_processo;
  v_parceiro uuid;
begin
  select status, parceiro_id into v_status, v_parceiro
  from processos where id = p_processo;

  if not found then
    raise exception 'processo_inexistente' using errcode = 'P0002';
  end if;

  if not (is_admin() or v_parceiro = auth.uid()) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;

  if v_status in ('cancelado','concluido') then
    raise exception 'status_terminal' using errcode = 'P0001';
  end if;

  update processos
     set subetapa = p_subetapa, atualizado_em = now()
   where id = p_processo;

  insert into processo_eventos (processo_id, de_status, para_status, nota)
  values (
    p_processo, v_status, v_status,
    nullif(btrim(coalesce(p_nota, 'sub-etapa: ' || p_subetapa::text)), '')
  );
end;
$$;

-- 5.2 registrar_pagamento_sinal — cria/atualiza a linha de sinal do processo.
--     Admin OU o próprio cliente (que abre a intenção de pagamento). Sempre
--     nasce 'pendente'; a confirmação é passo à parte.
create or replace function public.registrar_pagamento_sinal(
  p_processo    uuid,
  p_valor       numeric,
  p_provedor_ref text default null,
  p_qr_payload  text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente uuid;
  v_id      uuid;
begin
  select cliente_id into v_cliente from processos where id = p_processo;
  if not found then
    raise exception 'processo_inexistente' using errcode = 'P0002';
  end if;

  if not (is_admin() or v_cliente = auth.uid()) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;

  if p_valor is null or p_valor <= 0 then
    raise exception 'valor_invalido' using errcode = 'P0001';
  end if;

  insert into pagamentos_sinal (processo_id, valor, provedor_ref, qr_payload, status)
  values (p_processo, p_valor, p_provedor_ref, p_qr_payload, 'pendente')
  returning id into v_id;

  return v_id;
end;
$$;

-- 5.3 confirmar_pagamento_sinal — marca 'pago'. ADMIN-ONLY (fallback manual).
--     O webhook do gateway confirma por service_role (bypassa RLS), sem RPC.
create or replace function public.confirmar_pagamento_sinal(
  p_pagamento uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not is_admin() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;

  select status into v_status from pagamentos_sinal where id = p_pagamento;
  if not found then
    raise exception 'pagamento_inexistente' using errcode = 'P0002';
  end if;
  if v_status = 'pago' then
    return;  -- idempotente
  end if;

  update pagamentos_sinal
     set status = 'pago', confirmado_em = now(), confirmado_por = auth.uid()
   where id = p_pagamento;
end;
$$;

-- 5.4 gerar_contrato — cria a linha de contrato (snapshot vem da app em jsonb).
--     GATE: contrato 'cota' exige sinal 'pago' no processo. Admin OU cliente dono
--     (o cliente dispara o de serviço; o de cota é habilitado após o sinal).
create or replace function public.gerar_contrato(
  p_processo uuid,
  p_tipo     text,
  p_dados    jsonb default '{}'::jsonb,
  p_versao   text  default 'v1'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente uuid;
  v_pago    boolean;
  v_id      uuid;
begin
  if p_tipo not in ('servico','cota') then
    raise exception 'tipo_invalido' using errcode = 'P0001';
  end if;

  select cliente_id into v_cliente from processos where id = p_processo;
  if not found then
    raise exception 'processo_inexistente' using errcode = 'P0002';
  end if;

  if not (is_admin() or v_cliente = auth.uid()) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;

  -- contrato da COTA só depois do sinal pago (regra jurídica: serviço→PIX→cota).
  if p_tipo = 'cota' then
    select exists (
      select 1 from pagamentos_sinal
      where processo_id = p_processo and status = 'pago'
    ) into v_pago;
    if not v_pago then
      raise exception 'sinal_nao_pago' using errcode = 'P0001';
    end if;
  end if;

  insert into contratos (processo_id, tipo, versao_modelo, dados, status)
  values (p_processo, p_tipo, coalesce(p_versao,'v1'), coalesce(p_dados,'{}'::jsonb), 'gerado')
  returning id into v_id;

  return v_id;
end;
$$;

-- 5.5 decidir_documento — aprova/reprova item do check-list. ADMIN-ONLY.
create or replace function public.decidir_documento(
  p_doc    uuid,
  p_status text,
  p_motivo text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if p_status not in ('aprovado','reprovado') then
    raise exception 'status_invalido' using errcode = 'P0001';
  end if;

  update processo_documentos
     set status      = p_status,
         motivo      = nullif(btrim(coalesce(p_motivo,'')), ''),
         decidido_em = now(),
         decidido_por = auth.uid()
   where id = p_doc;

  if not found then
    raise exception 'documento_inexistente' using errcode = 'P0002';
  end if;
end;
$$;

-- 5.6 checklist_do_processo — resolve o check-list do processo JÁ com o status
--     de cada documento enviado, devolvendo SÓ colunas seguras ao cliente.
--
--     COMPLIANCE (crítico): o nome da administradora é usado APENAS internamente
--     para achar o modelo — NUNCA sai desta função. O cliente recebe só o rótulo
--     do documento e o status do envio. Sem administradora vinculada ⇒ 0 linhas
--     (o cliente vê a mensagem de "check-list ainda não disponível").
--
--     tipo_pessoa: o KYC só guarda CPF ⇒ modelamos como 'pf' por ora. Quando
--     houver PJ no KYC, trocar este literal por uma coluna de pessoa.
--
--     security definer: precisa ler `cartas.administradora_id` (RLS de cartas é
--     restrita a admin/parceiro), mas só expõe rótulos — nada sensível vaza.
create or replace function public.checklist_do_processo(p_processo uuid)
returns table (
  checklist_item_id uuid,
  rotulo            text,
  obrigatorio       boolean,
  ordem             int,
  doc_status        text,
  doc_motivo        text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente uuid;
  v_carta   uuid;
  v_adm     uuid;
  v_modelo  uuid;
begin
  -- 1) só o dono do processo (ou admin) enxerga o próprio check-list.
  select cliente_id, carta_id into v_cliente, v_carta
    from processos where id = p_processo;
  if not found then
    raise exception 'processo_inexistente' using errcode = 'P0002';
  end if;
  if not (is_admin() or v_cliente = auth.uid()) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;

  -- 2) administradora da carta → modelo ativo (pf). Uso interno; não é retornado.
  if v_carta is null then
    return;  -- sem carta vinculada ⇒ sem check-list
  end if;
  select administradora_id into v_adm from cartas where id = v_carta;
  if v_adm is null then
    return;  -- carta sem administradora ⇒ sem check-list (equipe vincula depois)
  end if;

  select id into v_modelo
    from checklist_modelos
   where administradora_id = v_adm and tipo_pessoa = 'pf' and ativo = true
   limit 1;
  if v_modelo is null then
    return;  -- administradora sem modelo cadastrado ⇒ sem check-list
  end if;

  -- 3) itens do modelo + status do último documento enviado por item (se houver).
  return query
    select
      ci.id                          as checklist_item_id,
      ci.rotulo                      as rotulo,
      ci.obrigatorio                 as obrigatorio,
      ci.ordem                       as ordem,
      ultimo.status                  as doc_status,
      ultimo.motivo                  as doc_motivo
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
$$;

-- grants: client autenticado CHAMA; papel é checado DENTRO. anon não chama nada.
revoke all on function public.processo_avancar_subetapa(uuid, processo_subetapa, text) from public;
revoke all on function public.registrar_pagamento_sinal(uuid, numeric, text, text)     from public;
revoke all on function public.confirmar_pagamento_sinal(uuid)                          from public;
revoke all on function public.gerar_contrato(uuid, text, jsonb, text)                  from public;
revoke all on function public.decidir_documento(uuid, text, text)                      from public;
revoke all on function public.checklist_do_processo(uuid)                              from public;

grant execute on function public.processo_avancar_subetapa(uuid, processo_subetapa, text) to authenticated;
grant execute on function public.registrar_pagamento_sinal(uuid, numeric, text, text)     to authenticated;
grant execute on function public.confirmar_pagamento_sinal(uuid)                          to authenticated;
grant execute on function public.gerar_contrato(uuid, text, jsonb, text)                  to authenticated;
grant execute on function public.decidir_documento(uuid, text, text)                      to authenticated;
grant execute on function public.checklist_do_processo(uuid)                              to authenticated;

-- ----------------------------------------------------------------------------
-- 6) STORAGE — buckets PRIVADOS + policies.
--    PASSO MANUAL (Emerson, painel Supabase → Storage):
--      criar 2 buckets PRIVADOS (public = false): processo-docs, contratos
--    Convenção de path: '{processo_id}/arquivo'. Leitura só por signed URL
--    server-side (createAdminClient().storage.from(bucket).createSignedUrl).
--
--    Owner do arquivo = o CLIENTE do processo cujo id abre o path. Por isso a
--    checagem não é split_part = auth.uid() (como no KYC), e sim um join a
--    `processos` pelo primeiro segmento do path.
-- ----------------------------------------------------------------------------

-- dono do processo ESCREVE no prefixo '{processo_id}/...' do seu processo.
create policy proc_storage_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('processo-docs','contratos')
    and exists (
      select 1 from public.processos p
      where p.id::text = split_part(name, '/', 1)
        and p.cliente_id = auth.uid()
    )
  );

create policy proc_storage_owner_update on storage.objects
  for update to authenticated
  using (
    bucket_id in ('processo-docs','contratos')
    and exists (
      select 1 from public.processos p
      where p.id::text = split_part(name, '/', 1)
        and p.cliente_id = auth.uid()
    )
  )
  with check (
    bucket_id in ('processo-docs','contratos')
    and exists (
      select 1 from public.processos p
      where p.id::text = split_part(name, '/', 1)
        and p.cliente_id = auth.uid()
    )
  );

-- dono LÊ o próprio arquivo; admin lê tudo (service_role bypassa via signed URL).
create policy proc_storage_owner_select on storage.objects
  for select to authenticated
  using (
    bucket_id in ('processo-docs','contratos')
    and (
      is_admin()
      or exists (
        select 1 from public.processos p
        where p.id::text = split_part(name, '/', 1)
          and p.cliente_id = auth.uid()
      )
    )
  );

-- ----------------------------------------------------------------------------
-- 7) SEED do check-list Lance (PF/PJ)
--    PENDENTE: o Emerson fornecerá a lista oficial da Lance. Enquanto isso,
--    deixamos o ESQUELETO comentado — basta descomentar e preencher os rótulos.
--    Nenhum item é inventado aqui (evita divergência do check-list real).
--
--    Modelo do seed (rodar quando a lista chegar):
--
--    with adm as (
--      select id from administradoras where nome ilike '%lance%' limit 1
--    ),
--    m_pf as (
--      insert into checklist_modelos (administradora_id, tipo_pessoa)
--      select id, 'pf' from adm
--      on conflict (administradora_id, tipo_pessoa) do update set ativo = true
--      returning id
--    )
--    insert into checklist_itens (modelo_id, ordem, rotulo, obrigatorio) values
--      ((select id from m_pf), 1, '<documento 1>', true),
--      ((select id from m_pf), 2, '<documento 2>', true);
--    -- repetir bloco análogo para tipo_pessoa = 'pj'.
-- ----------------------------------------------------------------------------

-- ============================================================================
-- Verificação rápida (DEV, após aplicar + criar buckets):
--   -- sub-etapa (como admin/parceiro dono):
--   select processo_avancar_subetapa('<processo>', 'docs_enviados', null);
--   -- sinal (cliente abre; admin confirma):
--   select registrar_pagamento_sinal('<processo>', 1234.56, null, null);
--   select confirmar_pagamento_sinal('<pagamento>');   -- admin-only
--   -- contrato da cota antes do sinal pago deve falhar 'sinal_nao_pago':
--   select gerar_contrato('<processo>', 'cota', '{}'::jsonb, 'v1');
--   -- documento (admin decide):
--   select decidir_documento('<doc>', 'aprovado', null);
--   -- não-admin chamando confirmar/decidir deve falhar 'sem_permissao' (42501).
-- ============================================================================
