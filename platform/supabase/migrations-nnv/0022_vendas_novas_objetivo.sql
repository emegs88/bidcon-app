-- 0022_vendas_novas_objetivo.sql — projeto nnv (app logado/auth).
-- JÁ APLICADA em produção (nnv) em 20/07/2026 via MCP — arquivo de registro,
-- NÃO reaplicar.
--
-- FATIA 1 (venda nova): coluna `objetivo` em vendas_novas, pra registrar o
-- que o cliente quer comprar (texto livre vindo da tool salvar_lead — ex.:
-- "imovel", "veiculo", descrição curta do bem). Distinta de `cod_bem`
-- (código/tipo do bem já definido na negociação, fora do escopo desta
-- fatia) — não reaproveita essa coluna pra não misturar os dois conceitos.

alter table public.vendas_novas
  add column if not exists objetivo text;

comment on column public.vendas_novas.objetivo is
  'FATIA 1 (venda nova): o que o cliente quer comprar, texto livre capturado pela tool salvar_lead. Nullable — nem todo lead chega com esse dado no primeiro contato.';
