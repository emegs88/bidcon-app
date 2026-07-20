-- 0060_vw_carousel_cartas_agio120 — projeto xtv (xtvjpnyadcdeadhmzyff).
-- Aguarda AUTORIZO antes de aplicar.
--
-- FATIA TOM-02 (restaura card rico no site, recibo intocado no WhatsApp).
-- A tool `buscar_cartas` (lib/buscar-cartas-tool.ts) é a ÚNICA fonte de
-- dados pro card [[CARTA]] do site a partir desta fatia — ela consulta
-- vw_carousel_cartas, que hoje NÃO expõe bidcon_agio_120 (necessário pra
-- decidir o selo "Custo excelente" com a MESMA regra já usada em produção
-- por components/CartaCard.tsx: agio_120 > 0). Sem essa coluna, o selo do
-- card do site ficaria sempre ausente/errado.
--
-- Decisão: expor agio_120 aqui (dado já público — vw_vitrine_viva, a view
-- de origem, já o expõe) em vez de trocar a fonte da tool pra
-- vw_vitrine_viva direto — mantém a tool consultando a MESMA view pública
-- já usada pelo carrossel/vitrine (contrato existente, sem duplicar
-- filtro/ranking em dois lugares). A camada de aplicação (buscar-cartas-
-- tool.ts) NUNCA repassa este número cru pro modelo/JSON da tool — só
-- deriva um booleano (seloCustoExcelente) a partir dele. O valor cru
-- também não é exposto no card do site (prosperito-widget.js) — só o
-- selo textual, mesma regra que já valia pro WhatsApp (recibo já omite
-- "ágio" desde a TOM-01).
--
-- CREATE OR REPLACE VIEW não deixa reordenar colunas já existentes — mesma
-- disciplina da 0054: agio_120 entra por último, depois de `exclusiva`,
-- sem tocar a posição de nenhuma coluna existente (SELECT * de quem já
-- consome continua compatível).
create or replace view public.vw_carousel_cartas as
select
  f.id,
  f.ref,
  f.tipo,
  f.credito,
  f.entrada,
  f.parcela,
  f.parcelas,
  f.custo_am,
  f.administradora,
  row_number() over (
    partition by f.tipo
    order by f.exclusiva desc, f.custo_am asc, f.credito desc
  ) as rank_tipo,
  f.exclusiva,
  f.agio_120
from public.vw_vitrine_viva f
where f.custo_am is not null
  and f.custo_am > 0::numeric
  and f.entrada > 0::numeric
  and f.parcela > 0::numeric;

comment on view public.vw_carousel_cartas is
  'PORTAL-01 ADENDO + TOM-02: cartas cliente_direto (exclusiva=true) ficam nas primeiras posições de cada partição por tipo, ordenadas por custo_am entre si; o restante completa o ranking normal (custo_am asc, credito desc). agio_120 exposto só pra permitir cálculo de selo "Custo excelente" (agio_120 > 0) na camada de aplicação — nunca deve ser repassado cru ao cliente/modelo.';
