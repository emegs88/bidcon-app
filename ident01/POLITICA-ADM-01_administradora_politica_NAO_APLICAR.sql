-- ============================================================================
-- POLITICA-ADM-01 — politica de credito por administradora
-- DRAFT. NAO APLICAR. Nasce sem numero por CLAUDE.md Regra 5.
-- Alvo: xtv (xtvjpnyadcdeadhmzyff). Ao aplicar, move para
-- platform/supabase/migrations/ com o proximo numero livre no momento.
-- Dois drafts esperando gate: o primeiro autorizado leva o numero menor.
-- ============================================================================
--
-- UMA TABELA, DUAS ORDENS (decisao da coordenacao, 16/08/2026)
-- `administradora_politica` era simultaneamente Entrega 1 da POLITICA-ADM-01 e
-- Entrega 1 da PRE-ANALISE-01 — mesma familia dos dois Radares. Decidido: UMA
-- tabela so, servindo as duas. Enquanto nada existe, custa zero.
--
-- O QUE NAO NASCE AQUI, POR JA EXISTIR EM `administradoras`
--   · "permite cessao a terceiro"  JA E  administradoras.aceita_assuncao
--   · "exige garantia do bem"      JA E  administradoras.exigencia_garantia_pct
-- Recriar qualquer um dos dois seria fabricar duas verdades sobre o mesmo fato.
--
-- FORMA ESTREITA (uma linha por administradora x campo), e o argumento e um so:
-- `nao apurado` e a AUSENCIA DE LINHA. Isso torna impossivel confundir
-- "nao apurado" com "nao" — que e exatamente o erro que a ordem manda evitar.
-- Na forma larga os dois virariam NULL e a distincao morreria no schema.
--
-- POR QUE O VOCABULARIO DE `campo` E TABELA E NAO ENUM
-- O beneficio declarado da forma estreita e "campo novo deixa de ser migration".
-- Com enum isso seria FALSO: acrescentar valor de enum e migration, e ainda
-- esbarra na trava conhecida da casa (Postgres recusa USAR valor de enum novo
-- na mesma transacao que o cria) — trava que ja custou a divisao 0083a/0083b
-- no historico aplicado deste banco. Tabela de dominio entrega o beneficio de
-- verdade; enum entregaria so a aparencia dele.
--
-- POR QUE `fonte_tipo` E CHECK E NAO ENUM
-- Aqui o inverso e desejado: a taxonomia de fonte NAO deve crescer sozinha —
-- ela e a ordem de confiabilidade que a ordem fixou. Check com lista literal
-- trava do mesmo jeito e nao paga o pedagio da transacao.
--
-- LIMITE CONHECIDO, medido e nao contornado
-- "apurado_em nao pode ser futuro" NAO cabe em CHECK: medido em pg_proc,
-- now() e STABLE (nao IMMUTABLE), e CHECK so aceita IMMUTABLE. A guarda fica
-- na aplicacao. Esta escrito aqui para nao ser redescoberto como surpresa.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) O vocabulario. Dominio fechado: campo fora daqui nao entra na tabela.
-- ----------------------------------------------------------------------------
create table if not exists public.administradora_politica_campo (
  campo       text primary key,
  tipo_valor  text not null check (tipo_valor in ('booleano','texto','numero','lista')),
  grupo       text not null check (grupo in ('quem_pode_assumir','o_que_analisa','documentos','uso_do_credito','operacional')),
  rotulo      text not null,
  ordem       int  not null default 0,
  -- Existe para ser alvo da FK composta la embaixo, que e o que garante
  -- que `tipo_valor` da linha nunca diverge do tipo declarado do campo.
  unique (campo, tipo_valor)
);

comment on table public.administradora_politica_campo is
  'Vocabulario fechado dos campos de politica de credito. Campo novo e INSERT '
  'aqui, nao migration — que e a razao de ser tabela e nao enum.';

-- ----------------------------------------------------------------------------
-- 2) A apuracao. Uma linha por administradora x campo.
--    Linha inexistente = "nao apurado". Nunca NULL para dizer isso.
-- ----------------------------------------------------------------------------
create table if not exists public.administradora_politica (
  administradora_id uuid not null
    references public.administradoras(id) on delete cascade,
  campo             text not null,
  tipo_valor        text not null,
  valor             text not null,
  detalhe           text,

  -- Proveniencia. Sem os dois, a linha nao entra — check no BANCO, nao na
  -- aplicacao, porque aplicacao se contorna e banco nao.
  fonte_tipo        text not null
    check (fonte_tipo in ('regulamento','pagina_oficial','operacao_bidcon','contato_comercial')),
  fonte_ref         text not null
    check (length(btrim(fonte_ref)) > 0),
  apurado_em        date not null,
  apurado_por       text not null
    check (length(btrim(apurado_por)) > 0),

  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),

  primary key (administradora_id, campo),

  -- FK composta: amarra o par (campo, tipo_valor) ao dominio. Sem ela,
  -- `tipo_valor` seria copia solta e poderia divergir em silencio.
  foreign key (campo, tipo_valor)
    references public.administradora_politica_campo (campo, tipo_valor),

  -- O valor tem de bater com o tipo declarado do campo. Como `tipo_valor`
  -- e coluna da propria linha (e a FK acima garante que confere), da para
  -- validar de forma declarativa, sem trigger.
  constraint administradora_politica_valor_bate_tipo check (
    case tipo_valor
      when 'booleano' then valor in ('sim','nao')
      when 'numero'   then valor ~ '^[0-9]+([.,][0-9]+)?$'
      else length(btrim(valor)) > 0
    end
  )
);

comment on table public.administradora_politica is
  'Politica de credito por administradora, uma linha por campo apurado. '
  'AUSENCIA DE LINHA = "nao apurado", que e resposta legitima; '
  '"provavelmente nao consulta" nao e. Nenhuma linha entra sem fonte_tipo, '
  'fonte_ref, apurado_em e apurado_por. Nada aqui e inferido.';

comment on column public.administradora_politica.fonte_tipo is
  'Ordem de confiabilidade fixada pela ordem: regulamento > pagina_oficial > '
  'operacao_bidcon > contato_comercial. Medido em 16/08/2026: a casa NAO tem '
  'PDF de regulamento em bucket nenhum (xtv: wa-extratos, farol-videos, '
  'farol-artes; nnv: processo-docs com 0 PDFs, reserva-docs vazio), logo a '
  'apuracao comeca por operacao_bidcon — historico proprio, nao opiniao.';

comment on column public.administradora_politica.fonte_ref is
  'Referencia especifica do tipo: caminho do PDF no bucket; URL completa; '
  'id do processo; ou nome de quem respondeu. Vazio nao passa no check.';

create index if not exists administradora_politica_campo_idx
  on public.administradora_politica (campo);

-- ----------------------------------------------------------------------------
-- 3) RLS. Molde de tabela interna do xtv: ligada, SEM policy — so service_role.
--    Mesmo desenho de radar_alertas (medido: rls_ligado=true, sem policy).
--    A pagina publica e servida por rota Next com createXtvClient(); leitura
--    anon so entra em migration futura, depois do Emerson revisar as
--    oito primeiras administradoras. Kill-switch POLITICA_ADM, desarmado.
-- ----------------------------------------------------------------------------
alter table public.administradora_politica        enable row level security;
alter table public.administradora_politica_campo  enable row level security;

-- ----------------------------------------------------------------------------
-- 4) A visao que a tela consome. security_invoker para NAO furar a RLS
--    (a casa ja pagou por isso em 0064_correcao2_view_id_invoker).
--    `desatualizada` implementa a decisao 6: apurado_em acima de 12 meses
--    acende aviso na tela, porque politica muda.
-- ----------------------------------------------------------------------------
create or replace view public.vw_administradora_politica
with (security_invoker = true) as
select
  p.administradora_id,
  a.nome                    as administradora,
  a.cnpj_raiz,
  d.grupo,
  d.rotulo,
  p.campo,
  p.tipo_valor,
  p.valor,
  p.detalhe,
  p.fonte_tipo,
  p.fonte_ref,
  p.apurado_em,
  p.apurado_por,
  (p.apurado_em < (current_date - interval '12 months')) as desatualizada,
  d.ordem
from public.administradora_politica p
join public.administradoras a               on a.id = p.administradora_id
join public.administradora_politica_campo d on d.campo = p.campo;

comment on view public.vw_administradora_politica is
  'Politica por administradora ja com rotulo e com o aviso de desatualizacao. '
  'Nao inventa linha: o que nao foi apurado simplesmente nao aparece, e cabe a '
  'tela renderizar "nao apurado" a partir da ausencia.';

-- ----------------------------------------------------------------------------
-- 5) Semente do vocabulario. Isto e o molde que a primeira administradora
--    preenche junto com o Emerson; as outras seguem.
-- ----------------------------------------------------------------------------
insert into public.administradora_politica_campo (campo, tipo_valor, grupo, rotulo, ordem) values
  ('exige_comprovacao_renda',        'booleano','quem_pode_assumir','Exige comprovacao de renda',                10),
  ('aceita_nome_com_restricao',      'booleano','quem_pode_assumir','Aceita nome com restricao',                 20),
  ('exige_score_minimo',             'booleano','quem_pode_assumir','Exige score minimo',                        30),
  ('aceita_pj',                      'booleano','quem_pode_assumir','Aceita pessoa juridica',                    40),
  ('aceita_estrangeiro',             'booleano','quem_pode_assumir','Aceita estrangeiro',                        50),

  ('analise_credito_propria',        'booleano','o_que_analisa',    'Faz analise de credito propria',           110),
  ('consulta_biro',                  'booleano','o_que_analisa',    'Consulta biro de credito',                 120),

  ('documentos_cessionario',         'lista',   'documentos',       'Documentos exigidos do cessionario',       210),

  ('uso_imovel_usado',               'booleano','uso_do_credito',   'Permite imovel usado',                     310),
  ('uso_terreno',                    'booleano','uso_do_credito',   'Permite terreno',                          320),
  ('uso_construcao',                 'booleano','uso_do_credito',   'Permite construcao',                       330),
  ('uso_reforma',                    'booleano','uso_do_credito',   'Permite reforma',                          340),
  ('uso_quitar_financiamento',       'booleano','uso_do_credito',   'Permite quitar financiamento existente',   350),
  ('uso_troca_veiculo',              'booleano','uso_do_credito',   'Permite troca de veiculo',                 360),
  ('uso_compra_entre_pf',            'booleano','uso_do_credito',   'Permite compra entre pessoas fisicas',     370),

  ('taxa_transferencia',             'texto',   'operacional',      'Taxa de transferencia',                    410),
  ('taxa_transferencia_quem_paga',   'texto',   'operacional',      'Quem paga a taxa de transferencia',        420),
  ('prazo_resposta_dias',            'numero',  'operacional',      'Prazo de resposta observado (dias)',       430),
  ('prazo_uso_credito_dias',         'numero',  'operacional',      'Prazo para usar o credito apos contemplar',440),
  ('consequencia_estouro_prazo',     'texto',   'operacional',      'O que acontece se estourar o prazo',       450)
on conflict (campo) do nothing;

commit;

-- ============================================================================
-- NAO FAZ PARTE DESTA MIGRATION, e e proposital:
--   · qualquer linha de politica de administradora real. A primeira e
--     preenchida junto com o Emerson; nenhuma nasce de inferencia.
--   · policy de leitura anon. Entra depois da revisao das oito primeiras.
--   · a pagina publica (Entrega 2) e o consumo pela PRE-ANALISE (Entrega 3).
-- Regra 1 do CLAUDE.md (rodape revoke/grant) nao se aplica: nao ha funcao
-- nem RPC aqui. View nao e funcao — e por isso leva security_invoker.
-- Pos-apply obrigatorio: get_advisors (security) no xtv.
-- ============================================================================
