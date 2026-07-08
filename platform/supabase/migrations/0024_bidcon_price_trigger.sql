-- ============ 0019_bidcon_price_trigger (originalmente referida como 0024_bidcon_price_trigger) ============
-- APLICADA no xtv em 07/07/2026. Ensaiada no szs (reproduziu card de referência ao centavo).
-- Renumerada para 0019 nesta migração (pasta real ia só até 0017_repasse.sql).
-- Bidcon Price automático e permanente: recalcula custo a.m. (TIR Newton-Raphson) e
-- ágios-alvo em todo INSERT/UPDATE dos campos-fonte. Sobrevive ao sync.
-- Parâmetros canônicos validados empiricamente contra o card de referência (REF 4282,
-- crédito 820.081 / entrada 393.639 / 191x5.305):
--   custo_am  = tir_mensal * 100            -> 1.09 (percentual)
--   agio_150  = agio_max(alvo 0.015)        -> 93400
--   agio_120  = agio_max(alvo 0.012)        -> 29600 (default da própria função)
-- TIR simples (sem INCC) para todos os tipos -- variante _incc divergiu do canônico.
--
-- BACKFILL: no xtv foi executado FORA da migração, em lotes de 15-35 cartas via
-- execute_sql (o update das 141 numa transação estourou statement timeout):
--   update cartas set valor_credito = valor_credito
--   where id in (select id from cartas
--                where status='disponivel' and bidcon_custo_am is null
--                order by id limit 35);
-- Resultado final: 141/141 precificadas em 07/07/2026.

create or replace function public.bidcon_price_calcular()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare v_tir numeric;
begin
  if new.valor_credito is null or new.valor_entrada is null
     or new.valor_parcela is null or new.qtd_parcelas is null
     or new.qtd_parcelas <= 0 then
    return new;
  end if;
  begin
    v_tir := public.bidcon_tir_mensal(new.valor_credito, new.valor_entrada, new.valor_parcela, new.qtd_parcelas);
    new.bidcon_custo_am := round(v_tir * 100, 2);
    new.bidcon_agio_150 := public.bidcon_agio_max(new.valor_credito, new.valor_entrada, new.valor_parcela, new.qtd_parcelas, 0.015);
    new.bidcon_agio_120 := public.bidcon_agio_max(new.valor_credito, new.valor_entrada, new.valor_parcela, new.qtd_parcelas, 0.012);
    new.bidcon_price_em := now();
  exception when others then
    -- linha problemática não derruba o sync inteiro
    new.bidcon_custo_am := null; new.bidcon_agio_120 := null;
    new.bidcon_agio_150 := null; new.bidcon_price_em := null;
  end;
  return new;
end$$;

drop trigger if exists trg_bidcon_price on public.cartas;
create trigger trg_bidcon_price
  before insert or update of valor_credito, valor_entrada, valor_parcela, qtd_parcelas, tipo
  on public.cartas
  for each row execute function public.bidcon_price_calcular();
