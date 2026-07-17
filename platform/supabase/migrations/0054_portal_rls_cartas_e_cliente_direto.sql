-- 0054_portal_rls_cartas_e_cliente_direto.sql
-- PORTAL-01: fecha o gap de RLS que impedia o cliente de ler a própria carta
-- (o /meu-processo já existe e já trata a ausência com segurança — ver
-- app/meu-processo/page.tsx — mas hoje `carta` sempre vem null pro cliente
-- porque não existe policy de SELECT ligando cartas -> processos.cliente_id).
--
-- ADENDO (mesma fatia, pedido explícito): destaque "cliente direto" —
-- cartas captadas diretamente pela Bidcon (fonte='cliente_direto') ganham
-- prioridade de ordenação na vitrine e aparecem primeiro no carrossel, com
-- um campo booleano `exclusiva` exposto nas views públicas.
--
-- cartas.fonte é `text` livre (sem CHECK/enum) — confirmado via
-- information_schema antes de escrever esta migration; 'cliente_direto' é só
-- mais um valor possível, não precisa de ALTER TYPE nem de novo CHECK.
--
-- Ensaiada em staging (szs): a policy (parte 1) foi testada de ponta a ponta
-- com dados descartáveis (2 clientes, JWT simulado via set_config +
-- SET LOCAL ROLE authenticated, tudo dentro de BEGIN...ROLLBACK) — cliente
-- dono do processo vê a própria carta mesmo em status != 'disponivel';
-- outro cliente sem processo não vê. As partes 2/3 (views) não puderam ser
-- ensaiadas no szs porque esse projeto não tem vw_vitrine_viva/
-- vw_carousel_cartas/carta_fingerprint (drift pré-existente, registrado em
-- docs/DIARIO-BORDO.md) — validadas por leitura da definição viva em
-- produção antes de escrever esta migration (mesmas colunas + 2 novas).
--
-- Transação explícita com auto-verificação: se qualquer sanity check falhar
-- (ex.: coluna esperada ausente), a exceção aborta a transação inteira —
-- nada fica meio-aplicado, produção intocada.

begin;

-- ── 1) RLS: cliente lê a carta do próprio processo, em qualquer status ─────
-- Só SELECT; sem insert/update/delete pro cliente (regra do prompt).
-- Cobre reservada/vendida/indisponivel também (não só as visíveis na
-- vitrine pública), pois o vínculo é via processos.cliente_id = auth.uid(),
-- não via status da carta.
create policy cartas_cliente_processo_select
  on public.cartas
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.processos p
      where p.carta_id = cartas.id
        and p.cliente_id = auth.uid()
    )
  );

comment on policy cartas_cliente_processo_select on public.cartas is
  'PORTAL-01: cliente enxerga a carta vinculada ao próprio processo (qualquer status), via processos.cliente_id = auth.uid(). Só leitura.';

-- ── 2) vw_vitrine_viva: expõe fonte + campo `exclusiva`, 2 tiers de ordenação
-- Recriada com CREATE OR REPLACE (mesma lista de colunas + 2 novas no fim,
-- compatível com quem já faz SELECT * ou seleciona por nome).
-- "TIR"/custo efetivo ao mês = bidcon_custo_am (custo_am) — é a coluna real
-- usada hoje pro ranking em vw_carousel_cartas; não existe coluna tir_am.
create or replace view public.vw_vitrine_viva as
select
  c.id,
  c.numero_externo as ref,
  c.tipo,
  c.valor_credito as credito,
  c.valor_entrada as entrada,
  c.valor_parcela as parcela,
  c.qtd_parcelas as parcelas,
  c.bidcon_custo_am as custo_am,
  c.bidcon_agio_120 as agio_120,
  c.bidcon_agio_150 as agio_150,
  coalesce(a.nome, c.administradora_raw, '') as administradora,
  c.criado_em,
  c.sincronizada_em as atualizado,
  carta_fingerprint(
    c.tipo::text, c.valor_credito, c.valor_entrada, c.valor_parcela,
    c.qtd_parcelas, coalesce(a.nome, c.administradora_raw, '')
  ) as fingerprint,
  c.fonte,
  (c.fonte = 'cliente_direto') as exclusiva
from cartas c
left join administradoras a on a.id = c.administradora_id
where c.status = 'disponivel'::status_carta
  and c.valor_credito > 0::numeric
  and not exists (
    select 1
    from reservas r
    where r.status = 'ativa'::text
      and r.expira_em > now()
      and r.fingerprint = carta_fingerprint(
        c.tipo::text, c.valor_credito, c.valor_entrada, c.valor_parcela,
        c.qtd_parcelas, coalesce(a.nome, c.administradora_raw, '')
      )
  )
order by (c.fonte = 'cliente_direto') desc, c.bidcon_custo_am asc nulls last;

comment on view public.vw_vitrine_viva is
  'Vitrine viva (RESERVA-01) + PORTAL-01 ADENDO: expõe fonte/exclusiva e ordena cliente_direto primeiro. Consumidores com .order() próprio (ex.: /api/vitrine) precisam somar exclusiva desc na própria query — o ORDER BY daqui não é garantido em consultas com ORDER BY externo.';

-- ── 3) vw_carousel_cartas: exclusivas primeiro, completando com o ranking
-- normal ──────────────────────────────────────────────────────────────────
-- Ajuste pedido: NÃO restringe mais o carrossel só às exclusivas quando
-- existe alguma (isso podia deixar a home com carrossel de 1 item). Agora,
-- dentro de cada partição por tipo, as cartas cliente_direto vêm primeiro
-- (ordenadas por custo_am/TIR entre si), e o resto do ranking normal
-- (custo_am asc, credito desc) completa a lista a partir daí — o limite de
-- exibição continua sendo decidido por quem consome (filtro por
-- rank_tipo), sem mudança de contrato.
-- Atenção: CREATE OR REPLACE VIEW não deixa renomear/mover colunas já
-- existentes na view (só apêndice no fim) — a view original (migration
-- 0049, aplicada direto em produção) já tem `rank_tipo` na posição 10;
-- por isso `exclusiva` entra por último, depois de rank_tipo, mantendo a
-- ordem/posição de todas as colunas antigas intacta.
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
  f.exclusiva
from public.vw_vitrine_viva f
where f.custo_am is not null
  and f.custo_am > 0::numeric
  and f.entrada > 0::numeric
  and f.parcela > 0::numeric;

comment on view public.vw_carousel_cartas is
  'PORTAL-01 ADENDO: cartas cliente_direto (exclusiva=true) ficam nas primeiras posições de cada partição por tipo, ordenadas por custo_am entre si; o restante completa o ranking normal (custo_am asc, credito desc) — o carrossel nunca fica restrito só às exclusivas.';

-- ── 4) Sanity check: aborta a transação inteira se algo não bateu ─────────
-- Confirma que as duas views ficaram consultáveis e com as colunas novas
-- (fonte/exclusiva/rank_tipo) de fato presentes. Erro aqui = exceção =
-- ROLLBACK automático de tudo acima (policy + views), produção intocada.
do $$
begin
  perform fonte, exclusiva from public.vw_vitrine_viva limit 1;
  perform exclusiva, rank_tipo from public.vw_carousel_cartas limit 1;
end $$;

commit;
