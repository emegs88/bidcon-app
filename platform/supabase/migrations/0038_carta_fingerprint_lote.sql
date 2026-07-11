-- aplicada via MCP 09/07 — fonte canônica: Supabase
-- (espelho documental; NÃO reexecutar — já aplicada em produção)

-- 0038: fingerprint em lote para o preview do importador (F1)
-- Uma chamada por preview em vez de N; delega ao carta_fingerprint canonico.
-- Entrada: jsonb array de objetos {tipo, credito, entrada, parcela, parcelas, adm}
-- Saida: (idx da linha na ordem recebida, fingerprint)
create or replace function public.carta_fingerprint_lote(p_linhas jsonb)
returns table(idx int, fingerprint text)
language sql immutable as $$
  select (o.ord - 1)::int as idx,
         public.carta_fingerprint(
           o.l->>'tipo',
           nullif(o.l->>'credito','')::numeric,
           nullif(o.l->>'entrada','')::numeric,
           nullif(o.l->>'parcela','')::numeric,
           nullif(o.l->>'parcelas','')::int,
           coalesce(o.l->>'adm','')
         ) as fingerprint
  from jsonb_array_elements(p_linhas) with ordinality as o(l, ord)
$$;
