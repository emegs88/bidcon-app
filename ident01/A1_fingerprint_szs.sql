-- =====================================================================
-- IDENTIDADE-01 / A1 — carta_fingerprint: DDL vigente + VETOR-OURO
-- v2 — original perdido com sandbox efêmero; vetor agora documentado
-- =====================================================================
-- Projeto de captura: szs (szsqdpwwxtmrtrhaikuh), schema public.
-- Fonte: pg_get_functiondef() lido AO VIVO — mais autoritativo que dump.
-- Data da recaptura: sessão de execução IDENTIDADE-01, FASE A.
--
-- MOTIVO DA v2
-- O A1 original (e o A3) morreram com o sandbox efêmero da sessão
-- anterior. O artefato original ancorava D1 no hash 00a95361cf1b0535bbf3
-- efbf44c88b25, mas NÃO documentava o vetor de entrada que o produzia —
-- logo o número era irreproduzível e o fio de D1 ficou solto.
-- A v2 corrige a causa raiz: o vetor passa a ser DOCUMENTADO aqui.
--
-- ANCORAGEM DE D1 NA v2 (dupla, ambas validadas ao vivo)
--   (i)  md5(prosrc) idêntico em xtv e szs = 2b59bc5723f6ad9856ea4958f4ad0450
--        (385 bytes, IMMUTABLE nos dois projetos) → corpo byte-idêntico.
--   (ii) VETOR-OURO V2a/V2b abaixo → saída idêntica nos dois projetos.
-- O hash 00a95361cf1b0535bbf3efbf44c88b25 fica registrado como
-- SUBSTITUÍDO POR V2 — vetor original não documentado, perdido.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. DDL VIGENTE (verbatim de pg_get_functiondef, szs)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.carta_fingerprint(p_tipo text, p_credito numeric, p_entrada numeric, p_parcela numeric, p_parcelas integer, p_adm text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select md5(
    lower(coalesce(trim(p_tipo),''))                    || '|' ||
    coalesce((round(p_credito*100))::bigint::text,'0')  || '|' ||
    coalesce((round(p_entrada*100))::bigint::text,'0')  || '|' ||
    coalesce((round(p_parcela*100))::bigint::text,'0')  || '|' ||
    coalesce(p_parcelas::text,'0')                      || '|' ||
    lower(coalesce(trim(p_adm),''))
  )
$function$
;


-- ---------------------------------------------------------------------
-- 2. VETOR-OURO V2 — resultados esperados
-- ---------------------------------------------------------------------
-- V2a — caso cheio, todos os componentes presentes, acento no nome da adm:
--   carta_fingerprint('imovel', 100000, 35000, 1250.75, 120, 'Racon Consórcios')
--   ESPERADO: 5ef4288e130be905b964849517505cdd
--
-- V2b — caso com NULLs (entrada/parcela/parcelas) + espaços de borda + acento:
--   carta_fingerprint('veiculo', 80000, null, null, null, '  ITAÚ - P ')
--   ESPERADO: 14c81ca6ca94dfb4d145e9c7e2ff1d1e
--
-- V2b exercita de propósito: coalesce dos três NULLs para '0' e o trim das
-- bordas. Note que carta_fingerprint NÃO remove acento — 'ITAÚ - P' e
-- 'ITAU - P' produzem fingerprints DIFERENTES nesta função. A convergência
-- exigida por D2/passe (c) acontece um nível acima, em
-- adm_fingerprint_input(), que aplica unaccent antes de chamar esta função.
-- Por isso o passe (c) é "validado no nível do helper", como diz a spec.

-- Consulta de verificação (deve retornar t, t nos DOIS projetos):
select
  carta_fingerprint('imovel', 100000, 35000, 1250.75, 120, 'Racon Consórcios')
    = '5ef4288e130be905b964849517505cdd' as v2a_ok,
  carta_fingerprint('veiculo', 80000, null, null, null, '  ITAÚ - P ')
    = '14c81ca6ca94dfb4d145e9c7e2ff1d1e' as v2b_ok;

-- Verificação do corpo (deve retornar 2b59bc5723f6ad9856ea4958f4ad0450
-- nos DOIS projetos):
select md5(p.prosrc)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'carta_fingerprint';


-- ---------------------------------------------------------------------
-- 3. RESULTADO DA VALIDAÇÃO AO VIVO (FASE A)
-- ---------------------------------------------------------------------
-- szs (szsqdpwwxtmrtrhaikuh):
--   V2a = 5ef4288e130be905b964849517505cdd
--   V2b = 14c81ca6ca94dfb4d145e9c7e2ff1d1e
--   md5(prosrc) = 2b59bc5723f6ad9856ea4958f4ad0450
-- xtv (xtvjpnyadcdeadhmzyff):
--   V2a = 5ef4288e130be905b964849517505cdd
--   V2b = 14c81ca6ca94dfb4d145e9c7e2ff1d1e
--   md5(prosrc) = 2b59bc5723f6ad9856ea4958f4ad0450
-- VEREDITO: IDÊNTICO nos dois projetos. D1 reatado.
-- =====================================================================
