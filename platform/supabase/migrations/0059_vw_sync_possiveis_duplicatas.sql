-- 0059_vw_sync_possiveis_duplicatas — projeto xtv (xtvjpnyadcdeadhmzyff).
-- Aguarda AUTORIZO antes de aplicar.
--
-- Origem: revisão da fatia PLAYCONTEMPLADAS-01. Checagem em produção antes
-- de escrever esta migration: 0053_playcontempladas_fonte JÁ está aplicada
-- (version 20260717111805, commit 0397ce6, 17/07) e o número 0053 não foi
-- reaproveitado por nenhuma fatia depois (0054–0058 vieram na sequência
-- normal) — ou seja, não existe conflito de numeração pra corrigir, e as
-- duas RPCs (sync_aplicar_cotas/sync_varrer_ausentes) já estão no ar com
-- 'PLAYCONTEMPLADAS' liberado no IN-list. Nenhuma renumeração necessária.
--
-- O que ficou de fato pendente da revisão: "risco de duplicata entre
-- fontes" — a PLAYCONTEMPLADAS agrega 29 administradoras num só feed; o
-- mesmo bem físico pode estar listado nela E em outra fonte (LANCE/CBC/
-- PIFFER/CARTAS/SERVOPA), já que a identidade hoje é
-- (administradora_origem, numero_externo) — não deduplica ENTRE origens
-- (mesmo comportamento das 5 fontes atuais entre si; não é regressão desta
-- fatia, mas o risco sobe com a Play citando 29 administradoras).
--
-- IMPORTANTE — o schema real de `cartas` NÃO tem grupo/cota da
-- administradora (só a tabela `extratos_cotas`, não relacionada a sync,
-- tem essas colunas — conferido ao vivo antes de escrever isto). Não dá
-- pra agrupar por (administradora_id, grupo, cota) ao pé da letra. Proxy
-- usado: fingerprint de campos ESTÁVEIS e comparáveis entre fontes —
-- (administradora_id, tipo, valor_credito, valor_parcela, qtd_parcelas) —
-- mesmo raciocínio já escopado (e ainda NÃO implementado) na fatia
-- SYNC-CHURN-02 (ver docs/DIARIO-BORDO.md, incidente 17/07) pra resolver a
-- instabilidade de numero_externo como identidade nessas fontes HTML. Essa
-- view é um paliativo de VISIBILIDADE pro admin enquanto SYNC-CHURN-02 não
-- entra — sinaliza grupos suspeitos, não decide/mescla/apaga nada sozinha.
-- Falso-positivo (duas cotas distintas coincidindo nos 5 campos) é
-- aceitável aqui por ser leitura de revisão manual, não trava automática.
create or replace view public.vw_sync_possiveis_duplicatas
with (security_invoker = on) as
with fingerprint as (
  select
    c.id,
    c.administradora_id,
    c.tipo,
    c.valor_credito,
    c.valor_parcela,
    c.qtd_parcelas,
    c.numero_externo,
    c.administradora_origem,
    c.sincronizada_em
  from public.cartas c
  where c.status = 'disponivel'
    and c.administradora_id is not null
    and c.valor_credito > 0
)
select
  f.administradora_id,
  a.nome as administradora,
  f.tipo,
  f.valor_credito,
  f.valor_parcela,
  f.qtd_parcelas,
  count(*) as ocorrencias,
  count(distinct f.administradora_origem) as fontes_distintas,
  array_agg(distinct f.administradora_origem order by f.administradora_origem) as fontes,
  array_agg(f.id order by f.sincronizada_em desc nulls last) as carta_ids,
  array_agg(f.numero_externo order by f.sincronizada_em desc nulls last) as numeros_externos
from fingerprint f
left join public.administradoras a on a.id = f.administradora_id
group by f.administradora_id, a.nome, f.tipo, f.valor_credito, f.valor_parcela, f.qtd_parcelas
having count(distinct f.administradora_origem) > 1
order by ocorrencias desc;

comment on view public.vw_sync_possiveis_duplicatas is
  'Revisão manual (admin): grupos de cartas disponíveis com o mesmo fingerprint (administradora+tipo+crédito+parcela+parcelas) aparecendo em mais de uma fonte de sync (administradora_origem) — possível mesmo bem físico duplicado entre origens (ex.: PLAYCONTEMPLADAS + outra). Sinaliza pra revisão humana; não decide, mescla nem apaga nada. Paliativo enquanto SYNC-CHURN-02 (identidade por fingerprint estável) não é implementada.';
