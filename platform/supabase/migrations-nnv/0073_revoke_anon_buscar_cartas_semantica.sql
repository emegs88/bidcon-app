-- ============================================================================
-- 0073 — REGRA-1-SEMANTICA: fecha anon/authenticated em buscar_cartas_semantica
-- ----------------------------------------------------------------------------
-- ALVO: nnv (auth/portal). Banco: nnvjeijsrwpzsggwqpcu.
-- Gemea desta: migrations/0090, mesmo revoke, alvo xtv. As duas existem porque a
-- funcao existe nos DOIS projetos, com assinatura e ACL IDENTICAS (medido).
--
-- Numeracao conferida (Regra 2) contra o ledger E o diretorio DESTE projeto
-- antes de criar o arquivo: ultimo aplicado 0072_assinatura_01_v3_delta, ultimo
-- arquivo 0072 — proximo 0073. (O arquivo 0070 nao existe neste repo; o buraco
-- e anterior a esta fatia e esta reportado, nao remendado aqui.)
--
-- Nao cria, nao altera e nao remove funcao nenhuma. Mexe SO em privilegio.
--
-- ----------------------------------------------------------------------------
-- O QUE FOI MEDIDO NESTE BANCO (28/08/2026, ACL crua de pg_proc)
-- ----------------------------------------------------------------------------
--   proname  : buscar_cartas_semantica
--   args     : p_embedding vector, p_tipo tipo_bem, p_valor_max numeric,
--              p_entrada_max numeric, p_limite integer
--   secdef   : true
--   acl      : {postgres=X/postgres,anon=X/postgres,
--               authenticated=X/postgres,service_role=X/postgres}
--   anon_pode=true  auth_pode=true  service_pode=true
--
-- SECURITY DEFINER + EXECUTE para anon: a funcao roda com privilegio do DONO,
-- por cima de RLS, e o anonimo pode chama-la.
--
-- ----------------------------------------------------------------------------
-- DE ONDE VEIO O `anon` — NAO FOI DESCUIDO DE MIGRATION
-- ----------------------------------------------------------------------------
-- A 0007 revogou de `public` e concedeu a `authenticated`, escrevendo no
-- comentario que "anon nao chama". O anon esta la assim mesmo, porque
-- pg_default_acl deste banco diz (medido):
--
--   dono=postgres tipo=f acl={postgres=X/postgres,anon=X/postgres,
--                             authenticated=X/postgres,service_role=X/postgres}
--
-- O Supabase concede EXECUTE a anon/authenticated em toda funcao nova criada por
-- `postgres` no schema public. `revoke ... from public` atinge o pseudo-papel
-- PUBLIC, nao o papel `anon`. A funcao nasceu aberta; a 0007 fechou outra porta.
-- Revogar aqui nao conserta a fabrica: a proxima funcao nasce igual.
--
-- ----------------------------------------------------------------------------
-- QUEM CHAMA A COPIA DESTE BANCO: NINGUEM. E isso foi medido, nao presumido.
-- ----------------------------------------------------------------------------
-- No repo inteiro ha UM chamador de codigo desta RPC:
--   platform/app/api/buscar-cartas/route.ts:110  ->  xtv.rpc(...)
-- e `xtv` vem de createXtvClient(), que aponta para o projeto xtv com
-- BIDCON_XTV_SERVICE_ROLE_KEY. Nenhuma linha do repo chama a copia do nnv.
--
-- O CATALOGO-UNIFICA-01 F2 e quem explica o orfao: a busca ANTES rodava aqui,
-- com a sessao do usuario (dai o grant a `authenticated` da 0007). Foi movida
-- para o xtv porque o estoque vive la — medido em 20/08: nnv.cartas = 2 linhas,
-- 0 disponiveis; xtv.cartas = 104.965 linhas, 2.308 disponiveis.
--
-- Consequencia honesta sobre o TAMANHO do vazamento aqui: com 0 cartas
-- disponiveis neste banco, a funcao ja devolveria lista vazia a quem a chamasse.
-- O risco real hoje e pequeno. O revoke entra do mesmo jeito por duas razoes:
-- custa nada, e "hoje esta vazio" nao e controle de acesso — basta uma carga de
-- dados neste banco para o pequeno virar grande sem ninguem reparar.
--
-- A 0065 deixou esta divida escrita (0065_hardening_anon_rpcs.sql:15):
--   "buscar_cartas_semantica: confirmar quem chama antes de mexer (vitrine de
--    producao roda no xtv; a copia do nnv pode ser legado das migrations
--    0004-0007 — se for, tambem perde o anon depois, em fatia propria)"
-- A conferencia foi feita e a hipotese dela se confirmou. Esta e a fatia propria.
--
-- ----------------------------------------------------------------------------
-- O MODO DE FALHAR QUE DESFAZ ISTO EM SILENCIO
-- ----------------------------------------------------------------------------
-- `create or replace` preserva o ACL; `drop` + `create` NAO — o ACL volta ao
-- privilegio-padrao, com anon dentro, sem erro e sem aviso. Precedente medido: a
-- 0084 (xtv) fez drop+create na funcao irma `buscar_cartas` e teve de reconceder
-- o grant na mao. Quem mexer nesta funcao com drop+create leva o revoke junto,
-- no mesmo arquivo, ou a porta reabre sozinha.
--
-- ----------------------------------------------------------------------------
-- CONTROLE (Regra 9) — E ELE DISPARA
-- ----------------------------------------------------------------------------
-- Fechar esta funcao nao e fechar o problema. Medido neste banco, SECURITY
-- DEFINER com EXECUTE para anon:
--   buscar_cartas_semantica(vector,tipo_bem,numeric,numeric,integer)  <- ESTA
--   handle_new_user()          FORA — trigger, a 0065 ja a declarou inocua
--   simulacao_publica(uuid)    FORA — o nome diz publica; exige medir chamador
--                                     antes, como se fez aqui, e nao de carona
-- No xtv o mesmo controle da 3: esta, buscar_saber(...) e is_admin().
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- GUARDA DE PRE-ESTADO. Sem ela, um banco que ja divergiu (funcao ausente ou
-- duplicada por sobrecarga) faria este arquivo terminar "com sucesso" sem ter
-- fechado nada.
-- ----------------------------------------------------------------------------
do $guarda$
declare
  n int;
  v_args text;
begin
  select count(*) into n
    from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname = 'buscar_cartas_semantica';

  if n = 0 then
    raise exception
      '0073 ABORTADA: public.buscar_cartas_semantica nao existe neste banco. '
      'Este arquivo so mexe em privilegio — nao cria funcao.';
  elsif n <> 1 then
    raise exception
      '0073 ABORTADA: esperava 1 funcao buscar_cartas_semantica, achei %. '
      'Sobrecarga tem de ser resolvida a mao: o revoke por assinatura fecharia '
      'so uma delas e o resto seguiria aberto.', n;
  end if;

  select pg_get_function_identity_arguments(oid) into v_args
    from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname = 'buscar_cartas_semantica';

  if v_args <> 'p_embedding vector, p_tipo tipo_bem, p_valor_max numeric, p_entrada_max numeric, p_limite integer' then
    raise exception
      '0073 ABORTADA: assinatura inesperada -> %. Esperava a medida em '
      '28/08/2026 nos dois projetos.', v_args;
  end if;
end $guarda$;

-- ----------------------------------------------------------------------------
-- O REVOKE. Reaplicar e inofensivo (Regra 3): revogar o que ja foi revogado nao
-- e erro em Postgres. `public` entra junto para deixar a Regra 1 inteira num
-- lugar so e cobrir um grant a public que tenha entrado no meio do caminho.
-- ----------------------------------------------------------------------------
revoke all on function
  public.buscar_cartas_semantica(vector, tipo_bem, numeric, numeric, int)
  from public, anon, authenticated;

-- service_role ja tinha EXECUTE pelo privilegio-padrao. O grant explicito nao e
-- redundancia: privilegio herdado some no proximo drop+create, e um grant escrito
-- e a unica forma de a intencao sobreviver a leitura de quem vier depois.
-- Aqui ele tambem e a porta de servico caso a busca volte a rodar neste banco.
grant execute on function
  public.buscar_cartas_semantica(vector, tipo_bem, numeric, numeric, int)
  to service_role;

-- ----------------------------------------------------------------------------
-- POS-CHECAGEM. Falha alto. Um revoke que "passou" sem fechar e pior que um que
-- quebrou: o relatorio diria fechado e a porta seguiria aberta.
-- ----------------------------------------------------------------------------
do $pos$
declare
  v_anon    boolean;
  v_auth    boolean;
  v_service boolean;
  v_sig     text := 'public.buscar_cartas_semantica(vector,tipo_bem,numeric,numeric,int)';
begin
  select has_function_privilege('anon',          v_sig, 'execute') into v_anon;
  select has_function_privilege('authenticated', v_sig, 'execute') into v_auth;
  select has_function_privilege('service_role',  v_sig, 'execute') into v_service;

  if v_anon then
    raise exception '0073 POS FALHOU: anon AINDA tem EXECUTE.';
  end if;
  if v_auth then
    raise exception '0073 POS FALHOU: authenticated AINDA tem EXECUTE.';
  end if;
  if not v_service then
    raise exception '0073 POS FALHOU: service_role PERDEU EXECUTE.';
  end if;

  raise notice '0073 OK: anon=nao authenticated=nao service_role=sim.';
end $pos$;

commit;

-- FIM 0073 · Revoke pontual em 1 RPC. Nenhuma funcao/tabela criada, alterada ou
-- removida. Fecha 1 das 3 SECURITY DEFINER com anon no nnv; as outras 2
-- (handle_new_user, simulacao_publica) seguem abertas e estao nomeadas acima.
