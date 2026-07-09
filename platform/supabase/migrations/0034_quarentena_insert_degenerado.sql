-- aplicada via MCP 09/07 — fonte canônica: Supabase
-- (espelho documental; NÃO reexecutar — já aplicada em produção)

-- 0034: quarentena automatica no INSERT
-- Carta nova com dados completos mas TIR abaixo do piso (ou calculo com erro)
-- nasce 'indisponivel' em vez de 'disponivel'. Fila de revisao = query:
--   select * from cartas where bidcon_price_em is not null and bidcon_custo_am is null;
-- UPDATEs nao mudam status (nao briga com operacao manual).
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
      if TG_OP = 'INSERT' and new.status = 'disponivel' then
        new.status := 'indisponivel'; -- quarentena: dado degenerado nao estreia na vitrine
      end if;
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
    if TG_OP = 'INSERT' and new.status = 'disponivel' then
      new.status := 'indisponivel';
    end if;
  end;
  return new;
end$function$;
