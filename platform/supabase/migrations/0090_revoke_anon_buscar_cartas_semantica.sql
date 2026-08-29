-- ============================================================================
-- 0090 — REGRA-1-SEMANTICA: fecha anon/authenticated em buscar_cartas_semantica
-- ----------------------------------------------------------------------------
-- ALVO: xtv (vitrine/atendimento PROD). Banco: xtvjpnyadcdeadhmzyff.
-- Gemea desta: migrations-nnv/0073, mesmo conteudo, alvo nnv. As duas existem
-- porque a funcao existe nos DOIS projetos, com assinatura e ACL IDENTICAS
-- (medido, nao suposto — saida crua no bloco seguinte).
--
-- Nao cria, nao altera e nao remove funcao nenhuma. Mexe SO em privilegio.
-- Nenhum DROP/CREATE OR REPLACE, nenhuma mudanca de assinatura, nenhum
-- DROP TABLE/COLUMN/DELETE/TRUNCATE.
--
-- ----------------------------------------------------------------------------
-- O QUE FOI MEDIDO (28/08/2026, os dois projetos, ACL crua de pg_proc)
-- ----------------------------------------------------------------------------
--   proname  : buscar_cartas_semantica
--   args     : p_embedding vector, p_tipo tipo_bem, p_valor_max numeric,
--              p_entrada_max numeric, p_limite integer
--   secdef   : true
--   acl      : {postgres=X/postgres,anon=X/postgres,
--               authenticated=X/postgres,service_role=X/postgres}
--   anon_pode=true  auth_pode=true  service_pode=true      <- xtv
--   anon_pode=true  auth_pode=true  service_pode=true      <- nnv (identico)
--
-- A combinacao e a que importa: SECURITY DEFINER + EXECUTE para anon. A funcao
-- roda com privilegio do DONO, por cima de RLS, e o anonimo pode chama-la.
--
-- ----------------------------------------------------------------------------
-- DE ONDE VEIO O `anon` — NAO FOI DESCUIDO DE MIGRATION
-- ----------------------------------------------------------------------------
-- A 0007, que criou a funcao, fez exatamente o certo:
--     revoke all ... from public;
--     grant execute ... to authenticated;
-- e o comentario dela diz, com todas as letras: "Anonimo (anon) nao chama".
-- Mesmo assim o anon esta la. O motivo esta em pg_default_acl (medido nos dois):
--
--   dono=postgres tipo=f acl={postgres=X/postgres,anon=X/postgres,
--                             authenticated=X/postgres,service_role=X/postgres}
--
-- O Supabase mantem PRIVILEGIO-PADRAO que concede EXECUTE a anon e authenticated
-- em TODA funcao nova criada por `postgres` no schema public. O `revoke ... from
-- public` da 0007 atinge o pseudo-papel PUBLIC — nao atinge o papel `anon`, que
-- recebeu grant proprio no instante do create. Ou seja: a 0007 nao deixou a porta
-- aberta, ela nasceu aberta e a 0007 fechou a porta errada.
--
-- Isso importa para quem ler depois: revogar aqui NAO conserta a fabrica. A
-- proxima funcao criada nasce igual.
--
-- ----------------------------------------------------------------------------
-- O MODO DE FALHAR QUE DESFAZ ISTO EM SILENCIO — E O PRECEDENTE MEDIDO
-- ----------------------------------------------------------------------------
-- `create or replace` PRESERVA o ACL, entao este revoke sobrevive a ele.
-- `drop` + `create` NAO preserva: o ACL volta ao privilegio-padrao acima, com
-- anon dentro, sem erro nenhum e sem aviso nenhum.
--
-- Nao e hipotese. A 0084 fez drop+create na funcao IRMA (`buscar_cartas`) e
-- precisou re-conceder na mao (linha 210), justamente porque tinha medido que o
-- grant nao sobrevive. Ela reconcedeu a anon de proposito — aquela RPC atende o
-- conector /api/mcp. Esta aqui nao atende ninguem anonimo, e por isso a
-- pos-checagem no fim deste arquivo falha ALTO se o anon reaparecer.
--
-- QUEM MEXER NESTA FUNCAO COM drop+create: o revoke tem de vir junto, no mesmo
-- arquivo, ou a porta reabre sozinha.
--
-- ----------------------------------------------------------------------------
-- QUEM CHAMA — MEDIDO NO REPO INTEIRO ANTES DE REVOGAR
-- ----------------------------------------------------------------------------
-- Um unico chamador de codigo:
--   platform/app/api/buscar-cartas/route.ts:110
--     const xtv = createXtvClient();
--     await xtv.rpc("buscar_cartas_semantica", { ... })
--
-- E `createXtvClient()` (platform/lib/supabase-xtv.ts:16) monta o client com
-- BIDCON_XTV_SERVICE_ROLE_KEY — ou seja, papel `service_role`, que este arquivo
-- MANTEM e ainda torna explicito. Varredura de `.rpc(` no platform inteiro: 39
-- ocorrencias, nenhuma outra desta funcao, nenhuma em componente de navegador.
--
-- POR QUE `authenticated` TAMBEM SAI, e nao so o anon: o grant a authenticated
-- da 0007 era correto NA EPOCA — a busca rodava no nnv com a sessao do usuario.
-- O CATALOGO-UNIFICA-01 F2 mudou isso: a rota passou a autenticar no nnv e
-- BUSCAR no xtv com service_role (o cabecalho da rota documenta a troca, e o
-- porque: nnv.cartas tinha 2 linhas / 0 disponiveis contra 104.965 / 2.308 no
-- xtv). Desde entao o grant a authenticated e superficie sem chamador. A Regra 1
-- pede public+anon+authenticated fora, service_role dentro; e o que se faz aqui.
--
-- ----------------------------------------------------------------------------
-- CONTROLE (Regra 9) — E ELE DISPARA
-- ----------------------------------------------------------------------------
-- "Fechei a funcao" nao pode ser lido como "fechei o problema". Medido no xtv:
--
--   funcoes em public ............................... 167
--   dessas, SECURITY DEFINER ........................  17
--   dessas, com EXECUTE para anon ...................   3   <- dispara
--
-- As tres, nomeadas para nao virarem descoberta de outra pessoa:
--   buscar_cartas_semantica(vector,tipo_bem,numeric,numeric,integer)  <- ESTA
--   buscar_saber(vector,integer,text[])                    FORA desta fatia
--   is_admin()                                             FORA desta fatia
--
-- No nnv o mesmo controle da 3: esta, `handle_new_user()` (trigger, ja declarada
-- inocua pela 0065) e `simulacao_publica(uuid)`.
--
-- Este arquivo fecha UMA de tres. As outras duas exigem medir chamador antes,
-- exatamente como se fez aqui, e nao entram de carona.
--
-- ----------------------------------------------------------------------------
-- DIVIDA QUE A 0065 (nnv) DEIXOU ESCRITA, E QUE ESTE ARQUIVO PAGA
-- ----------------------------------------------------------------------------
-- 0065_hardening_anon_rpcs.sql:15 —
--   "buscar_cartas_semantica: confirmar quem chama antes de mexer (vitrine de
--    producao roda no xtv; a copia do nnv pode ser legado das migrations
--    0004-0007 — se for, tambem perde o anon depois, em fatia propria)"
-- A conferencia foi feita (secao "QUEM CHAMA" acima) e a fatia propria e esta.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- GUARDA DE PRE-ESTADO. Se a funcao nao estiver la, ou estiver duplicada por
-- sobrecarga, o revoke por assinatura acertaria a errada (ou nenhuma) e o
-- arquivo terminaria "com sucesso" sem ter fechado nada.
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
      '0090 ABORTADA: public.buscar_cartas_semantica nao existe neste banco. '
      'Este arquivo so mexe em privilegio — nao cria funcao.';
  elsif n <> 1 then
    raise exception
      '0090 ABORTADA: esperava 1 funcao buscar_cartas_semantica, achei %. '
      'Sobrecarga tem de ser resolvida a mao: o revoke por assinatura fecharia '
      'so uma delas e o resto seguiria aberto.', n;
  end if;

  select pg_get_function_identity_arguments(oid) into v_args
    from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname = 'buscar_cartas_semantica';

  if v_args <> 'p_embedding vector, p_tipo tipo_bem, p_valor_max numeric, p_entrada_max numeric, p_limite integer' then
    raise exception
      '0090 ABORTADA: assinatura inesperada -> %. Esperava a medida em '
      '28/08/2026 nos dois projetos.', v_args;
  end if;
end $guarda$;

-- ----------------------------------------------------------------------------
-- O REVOKE. Idempotente por natureza (Regra 3): revogar o que ja foi revogado
-- nao e erro em Postgres, entao reaplicar este arquivo e inofensivo.
-- `public` entra na lista junto com anon/authenticated de proposito — a 0007 ja
-- o havia revogado, mas repetir aqui deixa a Regra 1 inteira num lugar so, e
-- protege contra um grant a public que tenha entrado no meio do caminho.
-- ----------------------------------------------------------------------------
revoke all on function
  public.buscar_cartas_semantica(vector, tipo_bem, numeric, numeric, int)
  from public, anon, authenticated;

-- service_role ja tinha EXECUTE pelo privilegio-padrao. O grant explicito nao e
-- redundancia: privilegio herdado some no proximo drop+create, e um grant escrito
-- e a unica forma de a intencao sobreviver a leitura de quem vier depois.
grant execute on function
  public.buscar_cartas_semantica(vector, tipo_bem, numeric, numeric, int)
  to service_role;

-- ----------------------------------------------------------------------------
-- POS-CHECAGEM. Falha alto — nao devolve aviso. Um revoke que "passou" mas nao
-- fechou e pior que um que quebrou: o relatorio diria fechado e a porta seguiria
-- aberta.
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
    raise exception '0090 POS FALHOU: anon AINDA tem EXECUTE.';
  end if;
  if v_auth then
    raise exception '0090 POS FALHOU: authenticated AINDA tem EXECUTE.';
  end if;
  -- Este e o controle do outro lado: fechar demais derruba /api/buscar-cartas,
  -- que chama a RPC como service_role.
  if not v_service then
    raise exception
      '0090 POS FALHOU: service_role PERDEU EXECUTE — /api/buscar-cartas cairia.';
  end if;

  raise notice '0090 OK: anon=nao authenticated=nao service_role=sim.';
end $pos$;

commit;

-- FIM 0090 · Revoke pontual em 1 RPC. Nenhuma funcao/tabela criada, alterada ou
-- removida. Fecha 1 das 3 SECURITY DEFINER com anon no xtv; as outras 2
-- (buscar_saber, is_admin) seguem abertas e estao nomeadas no cabecalho.
