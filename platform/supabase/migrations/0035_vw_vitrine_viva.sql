-- aplicada via MCP 09/07 — fonte canônica: Supabase
-- (espelho documental; NÃO reexecutar — já aplicada em produção)

-- 0035: vw_vitrine_viva — fonte unica para feeds de catalogo (Meta Advantage+ / Google Merchant Center)
-- Somente cartas disponiveis, sem campos internos (parceiro/fornecedor/raw de entrada).
-- Copy e formatacao de feed ficam na camada de entrega (edge function 'feed').
create or replace view public.vw_vitrine_viva
with (security_invoker = on) as
select
  c.id,
  c.numero_externo   as ref,
  c.tipo,
  c.valor_credito    as credito,
  c.valor_entrada    as entrada,
  c.valor_parcela    as parcela,
  c.qtd_parcelas     as parcelas,
  c.bidcon_custo_am  as custo_am,
  c.bidcon_agio_120  as agio_120,
  c.bidcon_agio_150  as agio_150,
  coalesce(a.nome, c.administradora_raw, '') as administradora,
  c.sincronizada_em  as atualizado
from public.cartas c
left join public.administradoras a on a.id = c.administradora_id
where c.status = 'disponivel' and c.valor_credito > 0;

comment on view public.vw_vitrine_viva is
  'Vitrine viva: cartas disponiveis para feeds de catalogo (Meta/Google) e consumo dos agentes. Sem dados internos.';
