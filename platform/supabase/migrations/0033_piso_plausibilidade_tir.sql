-- aplicada via MCP 09/07 — fonte canônica: Supabase
-- (espelho documental; NÃO reexecutar — já aplicada em produção)

-- 0033: piso de plausibilidade da TIR (0,30% a.m.)
-- TIR abaixo do piso = dado degenerado da origem (parcela/prazo/entrada errados):
-- carta continua visivel e vendavel, mas sem custo publicado, sem selo e fora do ranking,
-- ate a origem corrigir os numeros. Piso parametrizado na constante v_piso (muda com 1 migracao).
create or replace function public.bidcon_price_calcular()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_tir numeric;
  v_piso constant numeric := 0.003; -- 0,30% a.m.
begin
  if new.valor_credito is null or new.valor_entrada is null
     or new.valor_parcela is null or new.qtd_parcelas is null
     or new.qtd_parcelas <= 0 then
    return new;
  end if;
  begin
    v_tir := public.bidcon_tir_mensal(new.valor_credito, new.valor_entrada, new.valor_parcela, new.qtd_parcelas);
    if v_tir is null or v_tir < v_piso then
      new.bidcon_custo_am := null;
      new.bidcon_agio_120 := null;
      new.bidcon_agio_150 := null;
      new.bidcon_price_em := now();
    else
      new.bidcon_custo_am := round(v_tir * 100, 2);
      new.bidcon_agio_150 := public.bidcon_agio_max(new.valor_credito, new.valor_entrada, new.valor_parcela, new.qtd_parcelas, 0.015);
      new.bidcon_agio_120 := public.bidcon_agio_max(new.valor_credito, new.valor_entrada, new.valor_parcela, new.qtd_parcelas, 0.012);
      new.bidcon_price_em := now();
    end if;
  exception when others then
    -- linha problematica nao derruba o sync inteiro
    new.bidcon_custo_am := null; new.bidcon_agio_120 := null;
    new.bidcon_agio_150 := null; new.bidcon_price_em := null;
  end;
  return new;
end$function$;

-- normaliza registros existentes abaixo do piso (touch re-dispara o trigger com o piso novo)
update public.cartas
   set valor_parcela = valor_parcela
 where bidcon_custo_am is not null and bidcon_custo_am < 0.30;
