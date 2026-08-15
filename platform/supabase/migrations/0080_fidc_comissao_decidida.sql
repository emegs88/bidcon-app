-- ============================================================================
-- 0080_fidc_comissao_decidida.sql — fecha a decisao (2) que a 0078 deixou aberta
-- PROJETO: xtv (xtvjpnyadcdeadhmzyff). NAO rodar na nnv.
-- AUTORIZADO: Emerson Gomes dos Santos — DECISAO 2 (15/08/2026):
--   "a comissao da Bidcon no fluxo do fundo e 7% DO VALOR DO CREDITO da carta,
--    paga PELO FUNDO, somada por cima da oferta. Mesma regra da vitrine (7% do
--    credito somado a entrada, pago pelo comprador) — um so modelo de comissao
--    do lado do comprador, seja ele pessoa ou fundo."
--
-- ----------------------------------------------------------------------------
-- O QUE A 0078 PROMETEU, NA LETRA DELA (linhas 70–72):
--
--   "Enquanto (2) estiver aberta, as duas colunas de comissao aceitam null.
--    Isso e deliberado e TEM PRAZO: no dia em que o modelo for nomeado, elas
--    viram NOT NULL por ALTER, e o ALTER carrega a data da decisao."
--
-- O modelo foi nomeado hoje. Esta e a migracao que a 0078 marcou, e a data que
-- ela mandou carregar e 15/08/2026. Nao ha decisao nova aqui: ha o cumprimento
-- de uma condicao escrita, com a condicao satisfeita.
--
-- ----------------------------------------------------------------------------
-- O MODELO NAO ESTA PETRIFICADO AQUI, e continua nao estando.
--
-- A 0078 foi explicita: "as colunas guardam o RESULTADO; o MODELO que o produz
-- e codigo". Isso segue valendo. Nenhum CHECK amarra `comissao_base` ao texto
-- 'credito_7pct', e e de proposito: o dia em que o percentual mudar, quem muda
-- e `COMISSAO_FUNDO_PCT` em lib/fidc-ofertas.ts (com o nome do modelo junto,
-- que ha teste prendendo o par), e as ofertas ANTIGAS continuam carregando o
-- nome do modelo sob o qual foram enviadas. Um CHECK aqui transformaria cada
-- mudanca de preco numa migracao — e, pior, tornaria impossivel guardar a
-- verdade historica de uma oferta feita sob a regra antiga.
--
-- ----------------------------------------------------------------------------
-- MEDIDO ANTES DE ESCREVER, porque `set not null` varre a tabela inteira e
-- falha inteiro se uma linha desobedecer:
--
--   fidc_ofertas ....... 0 linhas   (comissao_base nula: 0, comissao_valor: 0)
--   fidc_oferta_itens .. 0 linhas
--   fidc_fundos ........ 0 linhas
--
-- Zero linhas: o ALTER nao tem o que validar, nao tem o que reescrever e nao
-- tem custo de lock relevante. E o unico INSERT em fidc_ofertas em toda a
-- aplicacao e app/api/fundo/ofertas/route.ts:215, que a partir desta fatia
-- grava as duas colunas SEMPRE. Nao existe caminho de escrita que o NOT NULL
-- possa surpreender.
--
-- POR QUE O NOT NULL IMPORTA, e nao e formalidade: a comissao e FOTOGRAFIA. A
-- palavra do Emerson foi "gravado como fotografia no envio da oferta (nunca
-- recalculado na leitura)". Uma coluna anulavel deixa a fotografia OPCIONAL —
-- basta alguem escrever um segundo caminho de insercao e esquecer as duas
-- colunas para nascer uma oferta cuja comissao ninguem sabe qual foi. O NOT
-- NULL faz esse esquecimento virar erro na hora do INSERT, em vez de virar
-- pergunta sem resposta seis meses depois.
--
-- ----------------------------------------------------------------------------
-- O QUE ESTA MIGRACAO NAO FAZ:
--
--  - NAO mexe em `fidc_ofertas_faixa_20_35_do_credito`. A faixa governa a
--    OFERTA (`oferta_pct_credito`), nao o desembolso do fundo. Com a comissao
--    entrando por cima, o fundo desembolsa 27% do credito no piso e 42% no
--    teto — e isso e legitimo, porque o que a faixa protege e o que o CEDENTE
--    RECEBE. Palavra do Emerson: "a constraint de 20–35% continua governando a
--    OFERTA, nao o desembolso. Nada muda no banco."
--  - NAO cria coluna de desembolso. `valor_total_calculado + comissao_valor` e
--    o desembolso, e fato derivavel nao se grava: uma terceira coluna e uma
--    terceira chance de as tres divergirem.
--  - NAO toca em `fidc_oferta_itens`. A comissao por carta e
--    `valor_credito * 0,07` sob o modelo nomeado no cabecalho da oferta —
--    derivavel, pelo mesmo motivo.
--  - NAO insere fundo nenhum. A decisao (4) da 0078 — qual fundo estreia —
--    continua aberta, e continua sendo da mao do Emerson no painel admin.
-- ============================================================================

alter table public.fidc_ofertas
  alter column comissao_base  set not null,
  alter column comissao_valor set not null;

comment on column public.fidc_ofertas.comissao_base is
  'Nome do MODELO que produziu comissao_valor. Hoje: credito_7pct (7% do valor do credito da carta, pagos pelo fundo, somados POR CIMA da oferta) — decisao 2 de 15/08/2026, o mesmo modelo do caminho da vitrine. Sem CHECK de proposito: o modelo e codigo (COMISSAO_FUNDO_BASE em lib/fidc-ofertas.ts), e ofertas antigas precisam continuar carregando o nome do modelo sob o qual foram enviadas. Guardar o nome junto do numero e o que permite auditar uma oferta antiga sob um modelo que ja mudou.';
comment on column public.fidc_ofertas.comissao_valor is
  'Resultado em reais no instante do envio: soma de valor_credito * 0,07 dos itens, sob o modelo nomeado em comissao_base. FOTOGRAFIA — nunca recalculado na leitura. NAO sai de valor_total_calculado: entra POR CIMA dele. O cedente recebe valor_total_calculado cheio; o fundo desembolsa valor_total_calculado + comissao_valor.';
comment on column public.fidc_ofertas.valor_total_calculado is
  'Soma de valor_ofertado dos itens no instante do envio, e O QUE OS CEDENTES RECEBEM — cheio, sem a comissao descontada no meio (decisao 2, 15/08/2026). NAO e o custo do fundo: o custo e esta coluna mais comissao_valor. Redundante com a soma dos itens, e de proposito: e o numero que o fundo VIU e aprovou. Se um item for retirado depois, este total continua contando a historia certa.';
