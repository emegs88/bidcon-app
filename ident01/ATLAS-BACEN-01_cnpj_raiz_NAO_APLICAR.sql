-- ============================================================================
-- ATLAS-BACEN-01 — chave de juncao com o Banco Central
-- DRAFT. NAO APLICAR. Nasce sem numero por CLAUDE.md Regra 5; recebe o
-- proximo livre no momento do apply autorizado (hoje 0084, medido por dois
-- caminhos: pasta migrations/ e list_migrations remoto, que bate em 0083b).
-- Alvo: xtv (xtvjpnyadcdeadhmzyff). Ao aplicar, move para
-- platform/supabase/migrations/ com o numero do momento (Regra 2 e 4).
-- ============================================================================
--
-- POR QUE ESTA COLUNA EXISTE
-- A ordem manda casar Bacen x vitrine por CNPJ, "nunca por nome" — porque
-- 'Itau' e 'ITAU - M' ja provaram que nome nao e chave. Medido em 16/08/2026:
-- `administradoras` NAO TEM coluna de CNPJ. A chave que a regra manda usar
-- nao existe. O join por CNPJ era impossivel, e nao por divergencia de dado:
-- por ausencia de campo.
--
-- Fallback medido, para dimensionar o preenchimento inicial:
--   administradoras da casa 37  |  cadastro Bacen (SedesConsorcios) 131
--   casaram por nome normalizado 33  |  nao casaram 4
--   cartas cobertas 2350  |  cartas orfas 73
--   ausentes do cadastro Bacen: Racon (36 cartas) e Caoa (0 cartas)
--   presentes sob outra razao social: Volkswagen, Gazin (conserto de alias)
--
-- O CNPJ do Bacen e a RAIZ de 8 digitos, nao o CNPJ de 14. Medido nas duas
-- fontes (SedesConsorcios e Filiais) e no CSV do ranking de reclamacoes.
--
-- POR QUE char(8) E POR QUE O CHECK NAO E ENFEITE
-- Medido em 16/08/2026 no proprio xtv:
--   '02010478'::char(8) = '02010478'::text   -> true   (join limpo)
--   length(('0201047'::char(8))::text)       -> 7      (padding some no cast)
--   '0201047'::char(8) ~ '^[0-9]{8}$'        -> false  (o check pega)
-- Sem o check, um valor de 7 digitos entra em silencio, perde o padding no
-- cast e NUNCA casa no join — falha muda, da familia do "verde vazio".
-- O check e o que torna o tipo sao.
-- ============================================================================

begin;

alter table public.administradoras
  add column if not exists cnpj_raiz char(8);

comment on column public.administradoras.cnpj_raiz is
  'CNPJ raiz (8 digitos) da administradora no cadastro do Banco Central. '
  'Chave unica de juncao com as fontes Bacen (SedesConsorcios, Filiais, '
  'ranking de reclamacoes), que publicam a raiz e nao o CNPJ de 14. '
  'Preenchimento inicial derivado de casamento por nome normalizado, UMA VEZ, '
  'revisado pelo Emerson linha a linha. Depois disso todo join e por CNPJ: '
  'o nome e usado uma vez, sob revisao humana, para nunca mais ser usado.';

-- Unicidade so onde ha valor: nulo e estado legitimo (administradora ainda
-- nao conciliada, ou ausente do cadastro Bacen, como Racon e Caoa hoje).
create unique index if not exists administradoras_cnpj_raiz_uniq
  on public.administradoras (cnpj_raiz)
  where cnpj_raiz is not null;

-- Formato: exatamente 8 digitos. Ver a medicao no cabecalho — sem isto,
-- valor curto entra calado e o join morre em silencio.
alter table public.administradoras
  drop constraint if exists administradoras_cnpj_raiz_formato;

alter table public.administradoras
  add constraint administradoras_cnpj_raiz_formato
  check (cnpj_raiz is null or cnpj_raiz ~ '^[0-9]{8}$');

commit;

-- ============================================================================
-- NAO FAZ PARTE DESTA MIGRATION, e e proposital:
--   · o preenchimento das 33 linhas casadas. E ato de dado, revisado
--     linha a linha, e nao pode viajar dentro de um DDL que roda sozinho.
--   · qualquer backfill automatico por nome. O casamento por nome e insumo
--     de revisao humana, nunca gatilho.
-- Regra 1 do CLAUDE.md (rodape de revoke/grant) nao se aplica: esta migration
-- nao cria funcao nem RPC.
-- Pos-apply obrigatorio: get_advisors (security) no xtv.
-- ============================================================================
