-- ============================================================================
-- 0017_repasse.sql — Fatia 1 do produto REPASSE (Assunção de Dívida)
-- ----------------------------------------------------------------------------
-- ADITIVA E IDEMPOTENTE. A 0016 (reserve_core) NÃO é tocada: nada é dropado,
-- nenhuma coluna/tabela existente é removida, nenhum dado é alterado. Só:
--   (1) amplia o CHECK de `reserva_legs.beneficiary_type` (8 → 11 valores),
--       preservando TODOS os 8 originais e somando os 3 do motor de repasse;
--   (2) adiciona colunas de repasse em `reservas` (todas `add ... if not exists`,
--       nullable, sem default destrutivo);
--   (3) adiciona `exigencia_garantia_pct` em `administradoras` (reusa
--       `aceita_assuncao` da 0011, que já existe);
--   (4) amplia o CHECK de tipo de listagem de `reservas` para aceitar 'REPASSE'.
--
-- Espelha 1:1 o motor canônico `platform/lib/reserve/repasse-pricing.ts`:
--   - RepasseBeneficiaryType (5 tipos; PLATFORM/NOTARY_COSTS já vinham da 0016;
--     PARTNER_CAPTATION/REPASSANTE_DEPOSITO/CAPTADOR_NET são os 3 aditivos aqui);
--   - EXIGENCIA_GARANTIA_PCT_DEFAULT = 100  → default da coluna;
--   - CET_ALVO_DEFAULT = 0.02               → sem default no banco (o motor aplica;
--     a coluna guarda o valor efetivo da operação, pode divergir do default);
--   - Segmento 'AUTOMOVEL' | 'IMOVEL'       → CHECK da coluna `segmento`.
--
-- COMPLIANCE: só descreve o passo factual da operação de custódia. Nada aqui
-- promete contemplação/prazo/rendimento. Rótulos neutros ("custo efetivo").
--
-- Aplicação (sob autorizo próprio, NÃO nesta rodada): `supabase db push`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) reserva_legs.beneficiary_type — ampliar o CHECK (8 → 11), sem perder nada
-- ----------------------------------------------------------------------------
-- A 0016 definiu 8 beneficiários (§2). O motor de repasse reusa PLATFORM e
-- NOTARY_COSTS e antecipa 3 novos (comentário repasse-pricing.ts §"Beneficiários
-- das legs de repasse", linhas 107-118). Recriamos o CHECK com os 8 originais
-- INTACTOS + os 3 novos. `drop constraint if exists` deixa idempotente e não
-- remove dado (constraint de validação, não de dado).
alter table public.reserva_legs
  drop constraint if exists reserva_legs_benef_chk;
alter table public.reserva_legs
  add constraint reserva_legs_benef_chk
  check (beneficiary_type in
    -- 8 originais da 0016 (preservados verbatim):
    ('SELLER','PLATFORM','SOURCING_PARTNER','SELLING_PARTNER',
     'OVERRIDE','CREDIT_PROVIDER','REFUND_BUYER','NOTARY_COSTS',
    -- 3 aditivos do repasse (espelham RepasseBeneficiaryType do motor):
     'PARTNER_CAPTATION','REPASSANTE_DEPOSITO','CAPTADOR_NET'));

-- ----------------------------------------------------------------------------
-- 2) reservas — campos do REPASSE (todos aditivos, nullable)
-- ----------------------------------------------------------------------------
-- Reservas de venda de crédito (fluxo 0016) deixam estes campos NULL. Só as
-- reservas de REPASSE os preenchem. Nenhum default força valor em linha antiga.

-- Tipo de listagem: distingue a reserva de VENDA (default) da de REPASSE.
alter table public.reservas
  add column if not exists tipo text not null default 'VENDA';
alter table public.reservas
  drop constraint if exists reservas_tipo_chk;
alter table public.reservas
  add constraint reservas_tipo_chk
  check (tipo in ('VENDA','REPASSE'));

-- Snapshot da dívida assumida (fonte: extrato do consórcio, ≤7 dias).
alter table public.reservas
  add column if not exists saldo_devedor       numeric(14,2);  -- saldo a assumir
alter table public.reservas
  add column if not exists parcela             numeric(14,2);  -- valor da parcela atual
alter table public.reservas
  add column if not exists parcelas_restantes  int;            -- n de parcelas
alter table public.reservas
  add column if not exists reajuste_anual      numeric(6,4);   -- g (degrau anual do fluxo)

-- Segmento comanda o fluxo (DELTA-2): vem do campo Produto/Bem do extrato.
alter table public.reservas
  add column if not exists segmento            text;
alter table public.reservas
  drop constraint if exists reservas_segmento_chk;
alter table public.reservas
  add constraint reservas_segmento_chk
  check (segmento is null or segmento in ('AUTOMOVEL','IMOVEL'));

-- CET-alvo efetivo da operação (o motor aplica default 0.02; a coluna guarda o
-- valor efetivo — editável nas 2 superfícies, pode divergir do default).
alter table public.reservas
  add column if not exists cet_alvo            numeric(6,4);

-- Exigência de garantia efetiva aplicada nesta operação (copiada da
-- administradora no momento da reserva; congela a regra vigente).
alter table public.reservas
  add column if not exists exigencia_garantia_pct  numeric(6,2);

-- Valor de avaliação do bem do captador (laudo) — lastro da garantia (DELTA-3).
alter table public.reservas
  add column if not exists avaliacao_laudo     numeric(14,2);

-- ----------------------------------------------------------------------------
-- 3) administradoras — exigência mínima de garantia (reusa aceita_assuncao/0011)
-- ----------------------------------------------------------------------------
-- `aceita_assuncao boolean` já veio na 0011. Adicionamos só o piso de garantia
-- por marca (DELTA-3). Default 100 = bem próprio cobre 100% da avaliação.
-- GUARD (DELTA-8 ③): `administradoras` hoje é atributo do dado (passport/extrato),
-- não entidade própria do banco — nasce só quando a fatia de exportação real for
-- aplicada. A 0016 NÃO depende de `administradoras`; bloco condicional evita quebra
-- em bancos onde a tabela ainda não existe.
do $$
begin
  if to_regclass('public.administradoras') is not null then
    alter table public.administradoras
      add column if not exists exigencia_garantia_pct  numeric(6,2) not null default 100;
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- NÃO INCLUÍDO nesta migration (anotado como fatia futura, sob autorizo próprio):
-- ----------------------------------------------------------------------------
--  - Evento VERIFICATION_* na cadeia `reserva_eventos`: o route.ts do Verificador
--    (linhas 6-8) declara que os eventos VERIFICATION_* "entram quando a 0016
--    rodar". Hoje o verificador só faz log estruturado (console.info, sem
--    conteúdo de documento). A gravação via `reserva_append_evento` com type
--    'VERIFICATION_EXTRACAO'/'VERIFICATION_VALIDACAO' é ENXERTO da Fatia 5, não
--    faz parte da 0017. Fica registrado aqui para rastreio.
--  - RPCs de repasse (precificação/legs no banco): o motor `repasse-pricing.ts`
--    é a fonte única de cálculo (client + server, paridade centavo a centavo). A
--    0017 só prepara o SCHEMA; a orquestração de gravação é fatia posterior.
--
-- FIM 0017 — puramente aditivo. Rode `verify` da cadeia após aplicar (a 0016
-- traz `verify_chain`) só por higiene; nenhuma linha existente foi alterada.
