-- ============================================================================
-- NÃO APLICAR — rascunho. IDENTIDADE-01 / CORRECAO-2, item 1 (view).
-- CONSTRUÍDO DO ZERO pós-incidente 02/08.
-- ----------------------------------------------------------------------------
-- Este arquivo NÃO é uma migration. Vive em ident01/ (CLAUDE.md, Regra 4).
-- Só vira arquivo de migration depois da frase
-- "AUTORIZO IDENTIDADE-01 CORRECAO-2". Projeto-alvo é o **xtv**, então a
-- pasta é `platform/supabase/migrations/` (CLAUDE.md, Regra 2) — NÃO
-- `migrations-nnv/`, que é do nnv. O número sai da ordem REAL de aplicação
-- (Regra 5), derivado de `list_migrations` no momento do apply — não é 0064
-- por decreto deste arquivo.
--
-- PROCEDÊNCIA: nada aqui foi herdado do relatório fictício de 02/08. Cada
-- afirmação abaixo tem a medição crua colada junto, feita ao vivo no xtv
-- (xtvjpnyadcdeadhmzyff) em 02/08 nesta sessão.
-- ============================================================================


-- ============================================================================
-- §1. ESTADO ATUAL MEDIDO (cru, colado)
-- ============================================================================
--
-- 1.1 — Colunas das views públicas
-- select c.relname, a.attnum, a.attname from pg_class c
--   join pg_namespace n on n.oid=c.relnamespace
--   join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
--  where n.nspname='public' and c.relname in ('vw_carousel_cartas','vw_cartas_publicas')
--  order by c.relname, a.attnum;
--
--   vw_carousel_cartas  1  id             <-- JÁ TEM id
--   vw_carousel_cartas  2  ref
--   vw_carousel_cartas  3  tipo
--   vw_carousel_cartas  4  credito
--   vw_carousel_cartas  5  entrada
--   vw_carousel_cartas  6  parcela
--   vw_carousel_cartas  7  parcelas
--   vw_carousel_cartas  8  custo_am
--   vw_carousel_cartas  9  administradora
--   vw_carousel_cartas 10  rank_tipo
--   vw_carousel_cartas 11  exclusiva
--   vw_carousel_cartas 12  agio_120
--   vw_cartas_publicas  1  ref            <-- NÃO tem id
--   vw_cartas_publicas  2  tipo
--   vw_cartas_publicas  3  credito
--   vw_cartas_publicas  4  entrada
--   vw_cartas_publicas  5  parcela
--   vw_cartas_publicas  6  parcelas
--   vw_cartas_publicas  7  custo_am
--   vw_cartas_publicas  8  administradora
--   vw_cartas_publicas  9  atualizado
--
-- 1.2 — Definição atual de vw_cartas_publicas (pg_get_viewdef, cru)
--
--    SELECT vw_vitrine_viva.ref,
--       vw_vitrine_viva.tipo,
--       vw_vitrine_viva.credito,
--       vw_vitrine_viva.entrada,
--       vw_vitrine_viva.parcela,
--       vw_vitrine_viva.parcelas,
--       vw_vitrine_viva.custo_am,
--       vw_vitrine_viva.administradora,
--       vw_vitrine_viva.atualizado
--      FROM vw_vitrine_viva;
--
-- 1.3 — Definição atual de vw_vitrine_viva (pg_get_viewdef, cru) — a origem
--       do dado. `c.id` já está lá, attnum 1. NADA a mudar nesta view.
--
--    SELECT c.id,
--       c.numero_externo AS ref,
--       c.tipo,
--       c.valor_credito AS credito,
--       c.valor_entrada AS entrada,
--       c.valor_parcela AS parcela,
--       c.qtd_parcelas AS parcelas,
--       c.bidcon_custo_am AS custo_am,
--       c.bidcon_agio_120 AS agio_120,
--       c.bidcon_agio_150 AS agio_150,
--       COALESCE(a.nome, c.administradora_raw, ''::text) AS administradora,
--       c.criado_em,
--       c.sincronizada_em AS atualizado,
--       c.fingerprint,
--       c.fonte,
--       c.fonte = 'cliente_direto'::text AS exclusiva
--      FROM cartas c
--        LEFT JOIN administradoras a ON a.id = c.administradora_id
--     WHERE c.status = 'disponivel'::status_carta
--       AND c.valor_credito > 0::numeric
--       AND c.categoria = 'contemplada'::text
--       AND NOT (EXISTS ( SELECT 1 FROM reservas r
--                WHERE r.status = 'ativa'::text AND r.expira_em > now()
--                  AND r.fingerprint = c.fingerprint))
--     ORDER BY (c.fonte = 'cliente_direto'::text) DESC, c.bidcon_custo_am;
--
-- 1.4 — Donos, reloptions e grants (cru)
-- select c.relname, c.relowner::regrole as dono, c.reloptions, <grants> ...
--
--   vw_carousel_cartas | postgres | null | anon:SELECT (+ INSERT/UPDATE/DELETE/... default Supabase)
--   vw_cartas_publicas | postgres | null | anon:SELECT, authenticated:SELECT
--   vw_repasse_viva    | postgres | null | anon:SELECT (+ ... default Supabase)
--   vw_vitrine_viva    | postgres | null | anon:SELECT, authenticated:SELECT
--
-- 1.5 — Função que depende do tipo da view (cru)
-- select p.oid::regprocedure, p.prosecdef, pg_get_function_result(p.oid) ...
--
--   buscar_cartas(text,numeric,numeric,text,integer) | prosecdef=false | SETOF vw_cartas_publicas
--
--   >>> DEPENDÊNCIA DURA: o tipo de retorno da RPC pública `buscar_cartas` É
--   >>> o rowtype de vw_cartas_publicas. Mexer nas colunas da view muda o
--   >>> contrato da RPC. Isto é o principal risco desta migration e é a razão
--   >>> do ensaio obrigatório no szs antes de qualquer aplicação.


-- ============================================================================
-- §2. O DEFEITO (derivado, não herdado)
-- ============================================================================
--
-- `ref` = `cartas.numero_externo` (vw_vitrine_viva, linha 2 da definição em
-- §1.3). Pela D1 da spec, `numero_externo` é POSIÇÃO na fonte, não
-- identidade: o sync realoca o número entre rodadas. Qualquer superfície que
-- faça LOOKUP por `ref` pode acertar OUTRA carta.
--
-- `vw_cartas_publicas` é a única view pública que não expõe `id`, e é
-- justamente a que alimenta a RPC `buscar_cartas` (§1.5) e, por ela, o
-- conector MCP (app/api/mcp/route.ts). Consequência medida: o MCP não tem
-- como oferecer nada além de `ref` — ver ident01/CORRECAO-2_diff_app.md, §MCP.
--
-- Correção mínima: expor `id` também em vw_cartas_publicas.
--
-- NÃO É EXPOSIÇÃO NOVA DE DADO: `vw_carousel_cartas` já expõe o MESMO uuid
-- (§1.1, attnum 1) com anon:SELECT (§1.4), e lib/buscar-cartas-tool.ts:125 já
-- o lê e o devolve ao modelo. Este arquivo não abre superfície nova; iguala
-- duas views que hoje divergem sem motivo declarado.


-- ============================================================================
-- §3. DDL PROPOSTA (uma única mudança)
-- ============================================================================
--
-- Coluna entra por ÚLTIMO. Duas razões:
--  (a) disciplina de append já usada na 0060 — ordem posicional das colunas
--      existentes não muda, então quem lê por nome não quebra;
--  (b) CREATE OR REPLACE VIEW no Postgres SÓ aceita acrescentar coluna no
--      fim; inserir `id` na frente exigiria DROP + CREATE, e o DROP cascatearia
--      na RPC buscar_cartas (§1.5).

create or replace view public.vw_cartas_publicas as
  select
    ref,
    tipo,
    credito,
    entrada,
    parcela,
    parcelas,
    custo_am,
    administradora,
    atualizado,
    id                     -- IDENTIDADE-01/CORRECAO-2: identidade estável.
                           -- `ref` (=numero_externo) é POSIÇÃO (D1) e serve
                           -- só de RÓTULO. Lookup é por `id`.
  from public.vw_vitrine_viva;

comment on view public.vw_cartas_publicas is
  'Vitrine pública (fatia contemplada). `id` é a identidade estável da carta; '
  '`ref` (= cartas.numero_externo) é POSIÇÃO na fonte, realocada pelo sync — '
  'usar SOMENTE como rótulo de exibição, nunca como chave de busca (IDENTIDADE-01, D1).';


-- ============================================================================
-- §4. security_invoker — MEDIDO, REAL, E **NÃO CORRIGIDO AQUI**
-- ============================================================================
--
-- Emerson pediu: re-medir ao vivo; se estiver definer de verdade, corrigir
-- junto; se não estiver, não fabricar defeito. Resultado da medição:
--
--   ESTÁ DEFINER DE VERDADE. `reloptions = null` nas quatro views (§1.4) —
--   security_invoker não está setado em nenhuma. Dono = postgres. Logo as
--   views rodam com os direitos do dono e ignoram a RLS do chamador.
--
-- MAS a correção óbvia (`alter view ... set (security_invoker = on)`) É
-- PERIGOSA HOJE, e a medição mostra por quê:
--
-- 4.1 — RLS/políticas das tabelas que vw_vitrine_viva toca (cru):
--
--   cartas          | rls=true  | policy cartas_vitrine_select_anon
--                   |           |   FOR SELECT TO anon USING (status='disponivel')
--   administradoras | rls=true  | policy de select USING (true)
--   reservas        | rls=true  | anon:SELECT concedido, **NENHUMA POLÍTICA**
--
-- 4.2 — Consequência derivada: com security_invoker=on, o subselect
--       `NOT EXISTS (select 1 from reservas r ...)` de §1.3 passa a rodar como
--       anon. Tabela com RLS ligada e ZERO políticas devolve ZERO linhas para
--       anon — então `NOT EXISTS` vira SEMPRE VERDADEIRO e a carta reservada
--       VOLTA a aparecer na vitrine. É a regressão exata que a RESERVA-01
--       existe para impedir.
--
-- 4.3 — Raio de explosão HOJE (cru):
--
--   select count(*) from reservas where status='ativa' and expira_em>now();
--     -> 0
--   -- contagem da view com e sem o NOT EXISTS: 2549 e 2549
--   -- cartas_que_vazariam: 0
--
--   Ou seja: o defeito é LATENTE, não ativo. Ninguém está vazando agora
--   porque não existe reserva ativa. Isso é PIOR, não melhor: virar o
--   security_invoker hoje passaria em qualquer teste e quebraria em silêncio
--   na primeira reserva real.
--
-- 4.4 — VEREDITO: **BLOQUEADOR NOMEADO**, fora desta migration.
--       Pré-requisito para virar security_invoker: criar política de SELECT
--       em `reservas` que permita ao papel chamador enxergar as reservas
--       ativas usadas pelo filtro (ou reescrever o filtro para não depender
--       de leitura direta de `reservas`). Enquanto isso não existir,
--       security_invoker FICA COMO ESTÁ. Não fabriquei o defeito e também
--       não vou "corrigir" com regressão embutida.


-- ============================================================================
-- §5. ENSAIO OBRIGATÓRIO NO szs — ANTES de qualquer aplicação no xtv
-- ============================================================================
-- (szsqdpwwxtmrtrhaikuh). Primeira medição de todo ensaio é PARIDADE do
-- harness com o xtv — se a view/RPC do szs não tiver a mesma forma do §1, o
-- ensaio não vale e PARA.
--
-- E1. Paridade: as colunas de vw_cartas_publicas no szs batem com §1.1?
-- E2. A RPC buscar_cartas existe no szs e retorna SETOF vw_cartas_publicas?
-- E3. Rodar a DDL do §3. Ela conclui sem erro de dependência?
--     (RISCO REAL: Postgres pode recusar a troca do rowtype por causa da
--      dependência da RPC. Se recusar, PARAR — não contornar com DROP
--      CASCADE. O contorno correto vira decisão de arquitetura, não hotfix.)
-- E4. Pós-DDL: select * from buscar_cartas(null,null,null,null,3) — a RPC
--     ainda executa e agora traz `id`?
-- E5. Contagem antes/depois da view é idêntica? (a DDL não muda o WHERE)
-- E6. Um cliente anon consegue select id, ref from vw_cartas_publicas limit 1?
--
-- Falha em qualquer item -> PARAR, não corrigir a quente.


-- ============================================================================
-- §6. VERIFICAÇÃO PÓS-APLICAÇÃO (colar CRU no relato — Regra 6)
-- ============================================================================
--
-- V1. Colunas (esperado: 10, com id em attnum 10)
-- select a.attnum, a.attname from pg_class c
--   join pg_namespace n on n.oid=c.relnamespace
--   join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
--  where n.nspname='public' and c.relname='vw_cartas_publicas' order by a.attnum;
--
-- V2. RPC intacta (esperado: SETOF vw_cartas_publicas, prosecdef=false)
-- select p.oid::regprocedure, p.prosecdef, pg_get_function_result(p.oid)
--   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--  where n.nspname='public' and p.proname='buscar_cartas';
--
-- V3. Grants preservados (esperado: anon:SELECT, authenticated:SELECT)
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_schema='public' and table_name='vw_cartas_publicas'
--    and grantee in ('anon','authenticated') order by 1,2;
--
-- V4. Contagem inalterada
-- select count(*) from public.vw_cartas_publicas;
--
-- V5. reloptions AINDA null (prova de que §4 não foi aplicado por engano)
-- select relname, reloptions from pg_class
--  where relname in ('vw_cartas_publicas','vw_vitrine_viva');


-- ============================================================================
-- §7. ROLLBACK
-- ============================================================================
-- Volta a view exatamente à definição de §1.2. Reversível e sem perda —
-- nenhum dado é escrito por este arquivo.
--
-- create or replace view public.vw_cartas_publicas as
--   select ref, tipo, credito, entrada, parcela, parcelas,
--          custo_am, administradora, atualizado
--     from public.vw_vitrine_viva;
--
-- ATENÇÃO: se a app já tiver sido publicada consumindo `id` (ver
-- CORRECAO-2_diff_app.md), o rollback da view tem de vir ANTES ou JUNTO com o
-- rollback da app — nunca depois.
-- ============================================================================
