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

-- ----------------------------------------------------------------------------
-- MARCA COM MAIS DE UM CNPJ VIVO
--
-- A ordem de 16/08/2026: "marca comercial pode abranger mais de um CNPJ, e o
-- Bacen mede por CNPJ. Uma linha da casa com dois CNPJs no cadastro nao pode
-- ter um cnpj_raiz so sem declarar o que ficou de fora."
--
-- DESVIO DECLARADO — a ordem pediu `cnpj_raiz_secundarios text[]`. Nao e o que
-- nasce aqui, por DOIS motivos medidos, nao por preferencia:
--
--  1) A ordem exige que os secundarios sejam NOMEADOS. Um text[] de CNPJs nao
--     carrega nome nenhum. Guardar "42421776 — Itau Unibanco Veiculos" como
--     string livre repetiria exatamente o erro que a decisao 7 da POLITICA-ADM
--     mandou desfazer quando trocou `lista` de texto livre por array validado.
--
--  2) O array nao consegue validar os proprios elementos. Medido em pg_proc no
--     xtv em 16/08/2026:
--        array_to_string(anyarray, text)  -> STABLE
--        array_length / cardinality       -> IMMUTABLE
--     CHECK so aceita IMMUTABLE — a mesma trava que ja impediu
--     "apurado_em nao pode ser futuro" na POLITICA-ADM. Sem array_to_string nao
--     ha regex elemento a elemento, e um CNPJ de 7 digitos entraria calado
--     dentro do array: o mesmo "verde vazio" que o check do cnpj_raiz existe
--     para impedir. Em tabela, cada linha e um char(8) com o check ja provado.
--
-- CASO REAL MEDIDO (unico entre as 37, em 16/08/2026):
--   Itau -> 00000776 ITAU ADMINISTRADORA DE CONSORCIOS LTDA.
--        -> 42421776 ITAU UNIBANCO VEICULOS ADMINISTRADORA DE CONSORCIOS LTDA.
--   Os dois VIVOS, os dois em SP, e — importante — com o MESMO site
--   (WWW.ITAU.COM.BR) e o MESMO e-mail. O comparador de dominio, que foi o
--   unico capaz de achar a Caoa (CONVEF <-> CAOACONSORCIOS.COM.BR), aqui
--   COLAPSA os dois. Dominio acha marca; nao separa CNPJ dentro da marca.
--
-- ATRIBUICAO DECIDIDA (coordenacao 16/08/2026; palavra final do Emerson no
-- momento do apply):
--   PRINCIPAL  = 00000776  ITAU ADMINISTRADORA DE CONSORCIOS LTDA.
--   SECUNDARIO = 42421776  ITAU UNIBANCO VEICULOS ADM. DE CONSORCIOS LTDA.
--
-- O criterio e SEGMENTO, e nao grafia — e a distincao e o que sustenta a
-- escolha. Medido sobre as 330 cartas VIVAS: 103 sao de IMOVEL e 227 de
-- VEICULO. Imovel nao cabe numa administradora cujo objeto e veiculos, logo as
-- 103 SO podem ser 00000776. As 227 sao ambiguas entre os dois. Principal tem
-- de ser quem cobre os dois segmentos: eleger 42421776 deixaria 103 cartas sob
-- um CNPJ que nao as comporta.
--
-- POR QUE A GRAFIA NAO PODE SER O CRITERIO, medido e nao suposto: as 330 se
-- espalham por 12 combinacoes de grafia x fornecedor x tipo, e NENHUMA grafia
-- nomeia pessoa juridica. "ITAU - A/M/P" e Automovel/Moto/Pesado — segmento,
-- vindo do fornecedor PIFFER. Nenhuma carta do estoque diz "Unibanco" nem
-- "Veiculos". Quem casasse por grafia estaria lendo o catalogo do fornecedor e
-- chamando de razao social. Isso vai escrito no `fonte_ref` da linha.
--
-- NAO E CASO: Ademicon. ADEMILAR nao tem CNPJ vivo no cadastro (ausente do
-- nome, do e-mail e do site das 131). Razao social incorporada e memoria de
-- alias, nao segundo CNPJ.
-- ----------------------------------------------------------------------------
create table if not exists public.administradora_cnpj_secundario (
  administradora_id uuid not null
    references public.administradoras(id) on delete cascade,
  cnpj_raiz         char(8) not null,
  razao_social      text not null
    check (length(btrim(razao_social)) > 0),
  observacao        text,

  -- Mesma disciplina de proveniencia da POLITICA-ADM: linha sem origem nao
  -- entra. "Sao a mesma marca" e afirmacao, e afirmacao pede fonte.
  fonte_ref         text not null check (length(btrim(fonte_ref)) > 0),
  apurado_em        date not null,
  apurado_por       text not null check (length(btrim(apurado_por)) > 0),
  criado_em         timestamptz not null default now(),

  primary key (administradora_id, cnpj_raiz),
  constraint administradora_cnpj_secundario_formato
    check (cnpj_raiz ~ '^[0-9]{8}$')
);

comment on table public.administradora_cnpj_secundario is
  'Outros CNPJs VIVOS da mesma marca comercial, nomeados. Existe porque o '
  'Bacen mede por CNPJ e a marca pode abranger mais de um: sem declarar o que '
  'ficou de fora, as reclamacoes e as estatisticas de contemplacao de um CNPJ '
  'apareceriam como se fossem do outro. A pagina exibe o dado do PRINCIPAL e '
  'declara em nota os secundarios. NUNCA soma e NUNCA mistura em silencio. '
  'Nao serve para razao social incorporada (caso Ademilar): isso e alias.';

-- Um CNPJ nao pode ser secundario de duas marcas ao mesmo tempo.
create unique index if not exists administradora_cnpj_secundario_uniq
  on public.administradora_cnpj_secundario (cnpj_raiz);

alter table public.administradora_cnpj_secundario enable row level security;

-- LIMITE CONHECIDO, medido e NAO contornado: nada declarativo impede que um
-- cnpj_raiz PRINCIPAL de uma administradora apareca como SECUNDARIO de outra —
-- unicidade entre tabelas diferentes nao existe em constraint no Postgres.
-- A guarda fica na revisao humana do preenchimento (que e unico e manual) e na
-- consulta de conferencia abaixo. Escrito aqui para nao virar surpresa.

create or replace view public.vw_administradora_cnpj
with (security_invoker = true) as
select
  a.id                        as administradora_id,
  a.nome                      as administradora,
  a.cnpj_raiz                 as cnpj_principal,
  count(s.cnpj_raiz)          as qtd_secundarios,
  (count(s.cnpj_raiz) > 0)    as marca_multi_cnpj,
  coalesce(
    array_agg(s.cnpj_raiz || ' - ' || s.razao_social order by s.cnpj_raiz)
      filter (where s.cnpj_raiz is not null),
    '{}'
  )                           as secundarios
from public.administradoras a
left join public.administradora_cnpj_secundario s
       on s.administradora_id = a.id
group by a.id, a.nome, a.cnpj_raiz;

comment on view public.vw_administradora_cnpj is
  'Uma linha por administradora com o CNPJ principal e os secundarios ja '
  'nomeados. `marca_multi_cnpj` e o gatilho da nota obrigatoria na tela: '
  'quando true, o numero exibido e de UM CNPJ e a pagina tem de dizer quais '
  'outros existem. Agregacao aqui e de TEXTO, nunca de metrica do Bacen.';

commit;

-- ============================================================================
-- NAO FAZ PARTE DESTA MIGRATION, e e proposital:
--   · o preenchimento das 33 linhas casadas. E ato de dado, revisado
--     linha a linha, e nao pode viajar dentro de um DDL que roda sozinho.
--   · qualquer backfill automatico por nome. O casamento por nome e insumo
--     de revisao humana, nunca gatilho.
--   · a linha secundaria do Itau, JA DECIDIDA (principal 00000776, secundario
--     42421776 — ver o bloco MARCA COM MAIS DE UM CNPJ VIVO). Continua fora
--     do DDL pelo mesmo motivo das 33: e ato de DADO, e ato de dado nao viaja
--     dentro de migration que roda sozinha. Segue abaixo pronto, para ser
--     executado a parte e sob revisao, no mesmo momento do apply.
--
-- ATO DE DADO — executar SEPARADAMENTE, depois do apply:
--
--   update public.administradoras
--      set cnpj_raiz = '00000776'
--    where id = '066c9326-718d-4fb2-93bc-b7f734676e81';   -- Itau
--
--   insert into public.administradora_cnpj_secundario
--     (administradora_id, cnpj_raiz, razao_social, observacao,
--      fonte_ref, apurado_em, apurado_por)
--   values (
--     '066c9326-718d-4fb2-93bc-b7f734676e81',
--     '42421776',
--     'ITAU UNIBANCO VEICULOS ADMINISTRADORA DE CONSORCIOS LTDA.',
--     'Mesma marca comercial, mesmo site (WWW.ITAU.COM.BR) e mesmo e-mail '
--     'institucional que o principal. Metricas do Bacen sao POR CNPJ: a '
--     'pagina exibe as de 00000776 e declara este em nota. Nunca soma.',
--     'Bacen SedesConsorcios, consultado em 16/08/2026 (131 instituicoes). '
--     'ATRIBUICAO POR SEGMENTO, NAO POR GRAFIA: das 330 cartas vivas do Itau, '
--     '103 sao de imovel e nao cabem em administradora de objeto veicular, '
--     'logo o principal e 00000776; as 227 de veiculo sao ambiguas entre os '
--     'dois e NAO foram atribuidas. A grafia foi medida e REPROVADA como '
--     'criterio: "ITAU - A/M/P" e Automovel/Moto/Pesado, vem do fornecedor '
--     'PIFFER e nao nomeia pessoa juridica; nenhuma carta diz "Unibanco" nem '
--     '"Veiculos".',
--     date '2026-08-16',
--     'coordenacao'
--   );
--
-- POR QUE A ESCOLHA NAO SAIU DA GRAFIA
-- Medido em 16/08/2026 sobre as 330 cartas VIVAS do Itau: elas estao divididas
-- em 12 combinacoes de grafia x fornecedor x tipo de bem — mas NENHUMA grafia
-- nomeia o CNPJ. "ITAU - A/M/P" e Automovel/Moto/Pesado (segmento, vindo do
-- fornecedor PIFFER), nao pessoa juridica. Nenhuma carta do estoque diz
-- "Unibanco" ou "Veiculos".
-- O unico corte com evidencia foi o SEGMENTO: 103 das 330 vivas sao de IMOVEL,
-- e imovel nao cabe numa administradora cujo objeto e veiculos — essas so
-- podem ser 00000776, e e por isso que ele e o principal. As 227 de veiculo
-- seguem ambiguas e NAO sao atribuidas a ninguem: atribui-las a 42421776 seria
-- inferencia, e inferencia nao entra nesta casa.
-- Regra 1 do CLAUDE.md (rodape de revoke/grant) nao se aplica: esta migration
-- nao cria funcao nem RPC. View nao e funcao — por isso leva security_invoker.
-- Pos-apply obrigatorio: get_advisors (security) no xtv, porque nasce tabela
-- nova com RLS ligada e sem policy.
-- ============================================================================
