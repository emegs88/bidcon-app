-- ============ 0019b_colunas_bidcon_price (originalmente referida como 0024b_colunas_bidcon_price) ============
-- APLICADA no xtv em 07/07/2026 (no-op: colunas já existiam). Guarda de
-- auto-suficiência da 0019 pra qualquer ambiente (pego no ensaio: szs não as tinha).
-- Renumerada para 0019b nesta migração (pasta real ia só até 0017_repasse.sql).
alter table public.cartas add column if not exists bidcon_custo_am numeric;
alter table public.cartas add column if not exists bidcon_agio_120 numeric;
alter table public.cartas add column if not exists bidcon_agio_150 numeric;
alter table public.cartas add column if not exists bidcon_price_em timestamptz;
