-- 0055_repasse_stop — projeto xtv. REPASSE-STOP (fatia-relâmpago).
--
-- Cotas com administradora_raw "REPASSE (CAPITAL DE GIRO)" são outro
-- produto (crédito já usado como capital de giro, não uma carta de
-- consórcio contemplada) e hoje aparecem na vitrine pública rotuladas
-- "CRÉDITO CONTEMPLADO" — rótulo incorreto. Esta migration NÃO apaga
-- dados: só remove essas linhas das views públicas (vw_vitrine_viva e,
-- por herança, vw_carousel_cartas, que já faz SELECT a partir dela).
-- Critério provisório até existir a coluna `categoria` (fatia REPASSE-01).

create or replace view public.vw_vitrine_viva as
 SELECT c.id,
    c.numero_externo AS ref,
    c.tipo,
    c.valor_credito AS credito,
    c.valor_entrada AS entrada,
    c.valor_parcela AS parcela,
    c.qtd_parcelas AS parcelas,
    c.bidcon_custo_am AS custo_am,
    c.bidcon_agio_120 AS agio_120,
    c.bidcon_agio_150 AS agio_150,
    COALESCE(a.nome, c.administradora_raw, ''::text) AS administradora,
    c.criado_em,
    c.sincronizada_em AS atualizado,
    carta_fingerprint((c.tipo)::text, c.valor_credito, c.valor_entrada, c.valor_parcela, c.qtd_parcelas, COALESCE(a.nome, c.administradora_raw, ''::text)) AS fingerprint,
    c.fonte,
    (c.fonte = 'cliente_direto'::text) AS exclusiva
   FROM (cartas c
     LEFT JOIN administradoras a ON ((a.id = c.administradora_id)))
  WHERE ((c.status = 'disponivel'::status_carta)
     AND (c.valor_credito > (0)::numeric)
     AND (c.administradora_raw IS NULL OR c.administradora_raw NOT ILIKE '%repasse%')
     AND (a.nome IS NULL OR a.nome NOT ILIKE '%repasse%')
     AND (NOT (EXISTS ( SELECT 1
           FROM reservas r
          WHERE ((r.status = 'ativa'::text) AND (r.expira_em > now()) AND (r.fingerprint = carta_fingerprint((c.tipo)::text, c.valor_credito, c.valor_entrada, c.valor_parcela, c.qtd_parcelas, COALESCE(a.nome, c.administradora_raw, ''::text))))))))
  ORDER BY (c.fonte = 'cliente_direto'::text) DESC, c.bidcon_custo_am;
