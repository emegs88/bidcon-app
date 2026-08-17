-- ============================================================================
-- 0084 — buscar_cartas ganha p_entrada_max (FILTRO-RENDA-01, decisao 4)
-- ----------------------------------------------------------------------------
-- ALVO: xtv (vitrine PROD). Banco: xtvjpnyadcdeadhmzyff.
-- Fecha UMA das tres assimetrias medidas entre `buscar_cartas` e
-- `buscar_cartas_semantica`. As outras duas ficam DECLARADAS aqui embaixo, por
-- ordem expressa: divida declarada nao vira surpresa.
--
-- ANTES (medido, nao suposto):
--   buscar_cartas           (p_tipo text, p_credito_min numeric,
--                            p_credito_max numeric, p_administradora text,
--                            p_limite integer)          -> SETOF vw_cartas_publicas
--   buscar_cartas_semantica (p_embedding vector, p_tipo tipo_bem,
--                            p_valor_max numeric, p_entrada_max numeric,
--                            p_limite integer)
--
-- ASSIMETRIA (1) — ENTRADA. FECHADA POR ESTA MIGRATION.
--   Somente a semantica filtrava por entrada. Passa a existir p_entrada_max
--   tambem aqui.
--
-- ASSIMETRIA (2) — TIPO: text vs enum. **NAO FECHADA. DIVIDA DECLARADA.**
--   Aqui p_tipo e `text`, normalizado a mao com `lower(trim(...))` e comparado
--   contra `tipo::text`. Na semantica p_tipo e o enum `tipo_bem`, entao o
--   proprio Postgres recusa valor invalido. Consequencia viva: um p_tipo
--   escrito errado ('imoveis', 'IMOVEL ') nao da erro nesta funcao — ele
--   simplesmente casa com nada e devolve LISTA VAZIA, indistinguivel de
--   "nao ha estoque nessa faixa". O chamador nao consegue separar os dois.
--   Fechar isso e mudanca de contrato da RPC publica (anon tem EXECUTE) e
--   exige decisao propria.
--
-- ASSIMETRIA (3) — FAIXA: min+max vs so max. **NAO FECHADA. DIVIDA DECLARADA.**
--   Esta funcao tem p_credito_min E p_credito_max; a semantica tem so
--   p_valor_max. Nao ha p_entrada_min aqui, e nao passa a haver: nao foi
--   pedido. Fica escrito para que a proxima pessoa nao descubra sozinha.
--
-- ----------------------------------------------------------------------------
-- POR QUE `drop` + `create` E NAO `create or replace` — MODO DE FALHAR MEDIDO
-- ----------------------------------------------------------------------------
-- Em Postgres a identidade de uma funcao e (nome, tipos dos argumentos).
-- Mudar a LISTA de parametros nao substitui: DUPLICA por sobrecarga.
-- Aqui isso e pior do que coexistencia inofensiva, e foi MEDIDO no ensaio:
-- como os cinco parametros atuais TODOS tem DEFAULT, a nova de 6 tambem
-- aceita ser chamada com 5, e a chamada que a producao faz hoje fica
-- AMBIGUA. O ensaio criou a sobrecarga de proposito e mediu a consequencia:
--
--   RUIM1 apos create-or-replace com lista diferente: 2 funcoes
--          -> DUPLICOU, nao substituiu
--   RUIM1 chamada da producao QUEBROU -> sqlstate=42725
--          | function public.buscar_cartas(p_tipo => unknown, p_credito_min =>
--            unknown, p_credito_max => unknown, p_administradora => unknown,
--            p_limite => integer) is not unique
--
-- 42725 = ambiguous_function. Via PostgREST isso chega como PGRST203. Ou seja:
-- `create or replace` nesta funcao nao degrada em silencio, DERRUBA o
-- /api/mcp. Por isso o drop explicito vem antes, e por isso existe a guarda
-- de pre-estado abaixo.
--
-- POSICAO DO NOVO PARAMETRO: p_entrada_max entra POR ULTIMO, depois de
-- p_limite. Nao e estetica. Se entrasse antes de p_limite, uma chamada
-- POSICIONAL existente do tipo buscar_cartas('imovel',null,null,null,20)
-- passaria o 20 para p_entrada_max em vez de p_limite — teto de entrada de
-- R$ 20, zero linhas, em silencio, sem erro nenhum. Varredura feita: nao ha
-- chamador posicional no repo hoje (o unico chamador usa argumentos
-- nomeados), mas a ordem segura nao custa nada e remove a armadilha.
--
-- ----------------------------------------------------------------------------
-- O RAMO "DADO AUSENTE" (decisao 6) — EXISTE COM ZERO CASOS HOJE
-- ----------------------------------------------------------------------------
-- O predicado e:
--     (p_entrada_max is null or entrada is null or entrada <= p_entrada_max)
--
-- O `entrada is null` no meio nao e decoracao. Sem ele, `entrada <=
-- p_entrada_max` com entrada NULA avalia NULL, o `where` descarta a linha, e a
-- carta desaparece da tela SEM MOTIVO NOMEADO — o defeito que a casa mais
-- persegue (Regra 12: CHECK com NULL aceita, filtro de leitura com NULL
-- descarta). Medido nas duas superficies hoje:
--     vw_cartas_publicas  2486 linhas, entrada nula = 0
--     vw_carousel_cartas  2485 linhas, entrada nula = 0
-- Zero casos hoje. O ramo existe de todo modo — zero hoje nao e zero amanha.
-- Provado no ensaio sem depender de dado, contra tripla sintetica:
--     RAMO-AUSENTE predicado ESCRITO mantem 2 de 3 (null + 1000);
--                  predicado NAIVE manteria 1 (perde a null em silencio)
-- QUEM DEVE A CONTRAPARTE: a tela. Carta com entrada nula passa o filtro, e
-- por isso precisa aparecer com rotulo proprio ("entrada a confirmar"), do
-- mesmo jeito que a escalonada sai com "parcela variavel — consulte". Passar
-- o filtro e nao ter rotulo troca um defeito por outro.
--
-- ----------------------------------------------------------------------------
-- ALCANCE REAL DESTA MIGRATION — E O QUE ELA NAO E
-- ----------------------------------------------------------------------------
-- Quem chama esta RPC: SO `platform/app/api/mcp/route.ts` (linha ~130, via
-- POST /rest/v1/rpc/buscar_cartas). Ou seja: o conector MCP, consumido de
-- fora da casa.
--
-- CORRECAO DE UM RELATORIO ANTERIOR MEU, registrada aqui porque a versao
-- errada circulou: eu afirmei que "a tool do agente nao filtra por entrada, e
-- por isso o cliente que diz ter R$ 30 mil recebe carta que nao pode pagar
-- pelo caminho mais visivel da casa". ISSO ESTAVA ERRADO. A tool Anthropic
-- chamada `buscar_cartas` NAO e esta RPC — e `platform/lib/buscar-cartas-tool.ts`,
-- que consulta `vw_carousel_cartas` e JA tem entrada_max no input_schema e JA
-- aplica `.lte("entrada", entradaMax)`. O caminho do WhatsApp/atende nunca foi
-- cego a entrada. A lacuna era so a desta RPC, e o alcance e o conector MCP —
-- real, mas estreito. Duas coisas diferentes com o mesmo nome.
--
-- NAO HA coluna nova, tabela nova, nem migration de dado. O tipo de retorno
-- (SETOF vw_cartas_publicas) nao muda, entao nao mexe na dependencia dura que
-- a CORRECAO-2 documentou. Nenhum parametro de PARCELA entra aqui: esta
-- migration NAO entrega o eixo de renda do FILTRO-RENDA-01, e nao deve ser
-- lida como se entregasse. A vw_cartas_publicas ja devolve `parcela` e
-- `entrada` no `select *`, logo a Entrega 1 (filtro no navegador) tem o dado
-- de que precisa sem RPC nova.
--
-- ENSAIO (Regra 10) rodado contra o xtv em bloco atomico terminado em
-- `raise exception` — tudo desfeito, pos-estado reconferido (1 funcao, 5
-- parametros, chamada viva). Resultado integral:
--   C1 funcoes chamadas buscar_cartas ANTES: 1 (esperado 1)
--   C1 identidade: p_tipo text, p_credito_min numeric, p_credito_max numeric,
--                  p_administradora text, p_limite integer
--   C1 OK: e a de 5 parametros, uma so
--   C2 baseline limite=100: 100 linhas
--   RUIM1 -> 2 funcoes; chamada da producao QUEBROU sqlstate=42725
--   RUIM1 sobrecarga acidental removida
--   CERTO drop+create: 1 funcao, identidade=...,  p_entrada_max numeric
--   BOM1 chamada NOMEADA de 5 args (a do /api/mcp) volta a funcionar:
--        100 linhas (baseline 100)
--   BOM2 entrada_max=30000: 100 linhas, das quais ACIMA do teto: 0 (esperado 0)
--   BOM3 entrada_max=3000 (abaixo da minima medida 3342): 0 linhas
--        (esperado 0 - prova que o filtro morde)
--   RAMO-AUSENTE 2 de 3 mantidas; predicado naive manteria 1
-- Distribuicao medida da entrada na view no dia: min 3.342,00 /
-- max 1.044.273,00 / <=30k 496 / <=50k 1.049 / <=100k 1.772.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- GUARDA DE PRE-ESTADO. Sem ela, aplicar isto sobre um banco que ja divergiu
-- e o caminho para a sobrecarga 42725 descrita acima.
-- ----------------------------------------------------------------------------
do $guarda$
declare
  n int;
  v_args text;
begin
  select count(*) into n
    from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname = 'buscar_cartas';

  if n <> 1 then
    raise exception
      '0084 ABORTADA: esperava exatamente 1 funcao public.buscar_cartas, achei %. '
      'Sobrecarga pre-existente tem de ser resolvida a mao antes desta migration.', n;
  end if;

  select pg_get_function_identity_arguments(oid) into v_args
    from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname = 'buscar_cartas';

  if v_args = 'p_tipo text, p_credito_min numeric, p_credito_max numeric, p_administradora text, p_limite integer, p_entrada_max numeric' then
    raise notice '0084: p_entrada_max ja presente — nada a fazer.';
  elsif v_args <> 'p_tipo text, p_credito_min numeric, p_credito_max numeric, p_administradora text, p_limite integer' then
    raise exception
      '0084 ABORTADA: assinatura inesperada de public.buscar_cartas -> %. '
      'Esperava a de 5 parametros medida em 17/08/2026.', v_args;
  end if;
end $guarda$;

-- Drop explicito da assinatura ANTIGA, nomeada por inteiro. `create or replace`
-- aqui duplicaria e derrubaria o /api/mcp com 42725 (ver cabecalho).
drop function if exists public.buscar_cartas(text, numeric, numeric, text, integer);

create or replace function public.buscar_cartas(
  p_tipo           text    default null,
  p_credito_min    numeric default null,
  p_credito_max    numeric default null,
  p_administradora text    default null,
  p_limite         integer default 20,
  -- POR ULTIMO de proposito: ver "POSICAO DO NOVO PARAMETRO" no cabecalho.
  p_entrada_max    numeric default null
)
returns setof public.vw_cartas_publicas
language sql
stable
set search_path to 'public'
as $function$
  select * from public.vw_cartas_publicas
  where (p_tipo is null or tipo::text = lower(trim(p_tipo)))
    and (p_credito_min is null or credito >= p_credito_min)
    and (p_credito_max is null or credito <= p_credito_max)
    and (p_administradora is null or administradora ilike '%' || p_administradora || '%')
    -- `entrada is null` no meio e o ramo "dado ausente" da decisao 6: sem ele a
    -- carta sem entrada conhecida desapareceria em silencio. Zero casos hoje.
    and (p_entrada_max is null or entrada is null or entrada <= p_entrada_max)
  order by custo_am asc nulls last, credito asc
  limit greatest(least(coalesce(p_limite, 20), 100), 1);
$function$;

comment on function public.buscar_cartas(text, numeric, numeric, text, integer, numeric) is
  'Busca publica da vitrine (SETOF vw_cartas_publicas). 0084 acrescentou '
  'p_entrada_max, por ultimo na lista para nao capturar o argumento posicional '
  'de p_limite. Dividas declaradas: p_tipo segue text (nao o enum tipo_bem), '
  'logo grafia invalida devolve lista vazia em vez de erro; e nao existe '
  'p_entrada_min. Entrada NULA passa o filtro de proposito — a tela deve '
  'rotular como "entrada a confirmar".';

-- O grant nao e herdado por assinatura nova: a antiga tinha EXECUTE para anon,
-- authenticated e service_role (ACL medida
-- {postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres}).
-- Sem esta linha a RPC publica passa a recusar o conector MCP.
grant execute on function
  public.buscar_cartas(text, numeric, numeric, text, integer, numeric)
  to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- POS-CHECAGEM. Falha alto se o resultado nao for exatamente UMA funcao com a
-- assinatura de 6 parametros e com o grant de volta.
-- ----------------------------------------------------------------------------
do $pos$
declare
  n int;
  v_args text;
  v_anon boolean;
begin
  select count(*) into n
    from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname = 'buscar_cartas';
  if n <> 1 then
    raise exception '0084 POS FALHOU: % funcoes buscar_cartas (esperado 1) — sobrecarga!', n;
  end if;

  select pg_get_function_identity_arguments(oid) into v_args
    from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname = 'buscar_cartas';
  if v_args <> 'p_tipo text, p_credito_min numeric, p_credito_max numeric, p_administradora text, p_limite integer, p_entrada_max numeric' then
    raise exception '0084 POS FALHOU: assinatura final inesperada -> %', v_args;
  end if;

  select has_function_privilege('anon',
           'public.buscar_cartas(text,numeric,numeric,text,integer,numeric)', 'execute')
    into v_anon;
  if not v_anon then
    raise exception '0084 POS FALHOU: anon perdeu EXECUTE — o /api/mcp cairia.';
  end if;

  raise notice '0084 OK: 1 funcao, 6 parametros, anon com EXECUTE.';
end $pos$;
