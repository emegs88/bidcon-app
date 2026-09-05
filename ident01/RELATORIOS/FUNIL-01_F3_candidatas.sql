-- CONSULTA DE LEITURA. Roda pela porta (execute_sql). Nunca migration, nunca DDL, nunca escreve. Saida = o .md ao lado.
--
-- =============================================================================
-- FUNIL-01 F3.1 - as candidatas a virar captacao pela ponte WhatsApp
-- =============================================================================
-- Alvo: xtv (xtvjpnyadcdeadhmzyff). Escrita: NENHUMA. Nem insert, nem update,
-- nem create. Se algum dia esta consulta precisar escrever, ela deixa de morar
-- aqui e vira outra coisa, com outro nome e outro gate.
--
-- -----------------------------------------------------------------------------
-- A ANCORA, E POR QUE ESTE ARQUIVO E O .md AO LADO CONTAM COISAS DIFERENTES
-- -----------------------------------------------------------------------------
-- ANCORA = 2026-09-03T01:51:12Z, a data do commit 706ef122, que gravou o .md
-- aprovado. Esta consulta NAO e ancorada: ela e regua viva e conta o banco de
-- HOJE. O .md e uma foto, e foto tem data. Os dois nao se contradizem - contam
-- coisas diferentes, e aqui esta escrito qual e qual:
--
--   com ancora (criado_em < 2026-09-03T01:51:12Z) -> 15 inserir / 1 ligar /
--       2 revisar / 10 excluir / 3 duplicados. E a lista do .md, e ela se
--       reproduz exatamente. Medido em 05/09/2026.
--   sem ancora (o banco de hoje, 05/09/2026 14:09Z) -> 15 / 2 / 3 / 11 / 3.
--       A diferenca e TODA por adicao: tres conversas novas (0b1efc86 ligar,
--       57bae87d revisar, dc20bb1e excluir). NENHUMA linha aprovada mudou de
--       classe. O detalhe esta em FUNIL-01_F3_candidatas_deriva.md.
--
-- A ancora foi RECONSTRUIDA, e isso e uma falha desta consulta admitida por
-- escrito: a versao de 706ef122 nao imprimia o proprio contexto - sem
-- `current_database()`, sem `now()`. Furo de Regra 7 no artefato. Esta versao
-- imprime (bloco `(contexto)` na uniao la embaixo), para que a proxima ancora
-- seja LIDA e nao deduzida.
-- A reconstrucao bate em TRES tabelas independentes: ate a ancora ha 104
-- conversas, 34 extratos e 2 captacoes - os tres numeros do .md. E ela nao esta
-- no fio da navalha: a 104a conversa nasceu 2026-09-02T22:10:49Z e a 105a so
-- 2026-09-03T12:03:29Z, uma janela vazia de quase catorze horas.
-- Data redonda NAO serviria: `criado_em < '2026-09-03'` cortaria conversas do
-- proprio dia 3 que ja estavam nas 104. Regua torta acerta por acaso.
--
-- QUEM ANCORA E O BACKFILL, NAO ESTA CONSULTA. A rodada 1 da F3.4 leva a ancora
-- no `where` e morde so as 104; a rodada 2 e varredura, sem ancora, tratando as
-- novas como o gatilho ao vivo trataria.
--
-- O QUE ELA RESPONDE. Quais das 104 conversas de WhatsApp sao cedentes que
-- deviam existir como linha em `captacoes`, quais ja existem, quais nao sao
-- cedente nenhum, e quais a regua NAO consegue decidir. A saida vai para o
-- Emerson conferir. Ela nao decide nada sozinha: e uma lista para leitura
-- humana, e a palavra dele vale sobre ela.
--
-- -----------------------------------------------------------------------------
-- A CHAVE DE TELEFONE, E POR QUE ELA ESTA INLINADA AQUI
-- -----------------------------------------------------------------------------
-- Comparar telefone nesta casa e comparar duas reguas que discordam na forma:
-- `normalizarTelefoneBR` (platform/lib/telefone.ts) ACRESCENTA o 55;
-- `sentinela_telefone_norm` (0083:107) CORTA o 55. E nenhuma das duas resolve o
-- caso real: o mesmo cedente aparece como 82981131987 numa ponta e
-- 558281131987 na outra, e o que separa as duas linhas e o NONO DIGITO.
--
-- A chave e  DDD (2 digitos) || ultimos 8 digitos , composta sobre a regua que
-- ja existe, nunca persistida, so para `=`. Os ultimos 8 sao a parte que
-- sobrevive a migracao do nono digito.
--
-- Ela existe como funcao, `telefone_chave(text)`, em
-- `ident01/FUNIL-01_F3_telefone_chave_NAO_APLICAR.sql` - que e DDL de verdade e
-- espera gate. Enquanto a funcao nao estiver aplicada no banco, esta consulta
-- INLINA a expressao:
--     left(sentinela_telefone_norm(x), 2) || right(sentinela_telefone_norm(x), 8)
-- com a mesma guarda de comprimento (10 ou 11 digitos, senao nulo). Quando a
-- funcao entrar, troque as ocorrencias por `telefone_chave(x)` e o resultado tem
-- de ser identico - se nao for, a funcao divergiu do gemeo em TS e o teste
-- `platform/lib/telefone.test.ts` e quem manda.
--
-- RISCO DECLARADO da chave: dois numeros do mesmo DDD que difiram SO no nono
-- digito colapsam. Por isso a lista mostra o telefone BRUTO de cada conversa e
-- o da captacao ao lado da chave - se houver colisao, ela fica visivel. Medido
-- em 03/09/2026: a chave achou TRES pares assim, e os tres sao a mesma pessoa
-- duas vezes, nao duas pessoas.
--
-- -----------------------------------------------------------------------------
-- AS DUAS REGUAS DE "ISTO E UM CEDENTE"
-- -----------------------------------------------------------------------------
-- (1) TAG. `wa_conversas.tags @> {cedente}`. Medido: 94 das 104 conversas nao
--     tem tag nenhuma; `cedente` aparece em 9 e `negociacao_particular` em 1.
--     Tag sozinha perde a maioria.
-- (2) AGENTE. `wa_conversas.agente_ativo`. Medido por dois caminhos
--     independentes, com o mesmo numero em cada celula:
--       caetano   14 conversas (8 com extrato)  - agente de captacao
--       tobias     8 conversas (5 com extrato)  - atende os dois lados
--       vendanova  3 (1) | prosperito 40 (0) | valentina 30 (0)
--       serena 7 | bento 1 | aurora 1  (todos 0 com extrato)
--     `caetano` e `tobias` concentram as candidatas. `valentina` e compra:
--     nunca cedente.
-- (3) INTENCAO por texto, terceira regua, a mais ruidosa. Le SO mensagens de
--     `papel = 'cliente'` (540 das 1195) - ler as nossas proprias mensagens
--     acharia "vender consorcio" em quase toda conversa, porque e o que o
--     agente da casa fala o dia inteiro. Serve para levantar suspeita fora de
--     caetano/tobias, e nessa faixa a linha vai para `revisar`, nunca para
--     `inserir`.
--
-- MEDIDO EM 03/09/2026, e vale registrar porque foi a divergencia da primeira
-- rodada: as reguas (1) e (2) devolvem 22 conversas, exatamente as 22 que a
-- coordenacao previu. A regua (3) arrasta mais 6, e nao 3: alem de vendanova x2
-- e prosperito x1, ela levanta aurora, bento e valentina. As tres a mais caem
-- em `excluir` pela regra de agente de compra, entao a divergencia e de
-- LISTAGEM, nao de resultado - nenhuma linha a mais desce para `captacoes`.
--
-- -----------------------------------------------------------------------------
-- OPT-OUT: A REGRA DE COMPLIANCE, E POR QUE ELA VEM ANTES DE TUDO
-- -----------------------------------------------------------------------------
-- `wa_conversas.opt_out = true` -> `excluir`, sempre. Uma captacao nasce com
-- `status = 'novo'`, vira card na mesa com proxima acao, e alguem liga. Ligar
-- para quem pediu para nao ser procurado nao e um erro de gosto: e o unico erro
-- desta lista que sai da casa e chega no cliente.
--
-- ORDEM DECLARADA, E ELA E UMA ESCOLHA: o opt-out vem ANTES das decisoes
-- nominais. Uma palavra que manda inserir nao vence um pedido do proprio
-- cliente para nao receber. HOJE ISSO E INERTE - nenhuma das decisoes nominais
-- cai sobre uma conversa com opt_out. A ordem esta escrita agora para nao ser
-- decidida no susto no dia em que as duas se cruzarem.
--
-- MEDIDO EM 03/09/2026: SEIS das 104 conversas tem `opt_out = true`. Uma delas
-- esta nesta lista (a unica que era candidata); as outras cinco nao aparecem
-- aqui porque nao sao candidatas por regua nenhuma.
--
-- ESTA LINHA JA ESTEVE ERRADA, e o registro do erro fica. A versao anterior
-- deste cabecalho dizia "uma unica conversa das 104 tem opt_out". Eu herdei uma
-- frase da coordenacao que falava da LISTA - "e a unica linha da lista com
-- opt_out" - e a reescrevi como se falasse do BANCO, sem medir. Erro de escopo
-- de leitura, e a terceira vez do mesmo defeito: construir a regua com pressa
-- quando o resultado esperado parece obvio. Quem pegou foi o controle
-- `conversas com opt_out em TODO o banco`, que esta na uniao la embaixo - o
-- unico dos dez cujo resultado eu nao sabia prever antes de rodar. Um controle
-- que so confirma o que voce ja espera nao e controle.
--
-- -----------------------------------------------------------------------------
-- COTA CANCELADA: A REGRA QUE FALTAVA, E ONDE ELA ENTRA
-- -----------------------------------------------------------------------------
-- "A Bidcon nao compra cota cancelada" e palavra do Emerson, e a PENTE-MUDAS-01
-- ja a executou uma vez - encerrou a `fc14bc83` em 29/08 por esse motivo. So que
-- o motivo ficou escrito em PROSA, numa mensagem de papel `sistema`, e regua nao
-- le conversa. Medido em 05/09/2026, aquela conversa tem `tags {}`,
-- `contemplada null` e extrato com `confianca 0,6`. Ela estava fora do funil
-- porque 0,6 < 0,7 e porque ninguem a etiquetou - COINCIDENCIA, nao regra. Um
-- extrato novo com 0,71 a poria na mesa como negocio, calada.
--
-- Agora existe braco: `s.cota_cancelada`, espelho exato do braco 4b de
-- `decidir()` em platform/lib/funil/ponte.ts, na MESMA posicao.
--
-- A POSICAO E ESCOLHA, e vale escrita:
--   - DEPOIS de opt_out e das decisoes nominais - compliance vence tudo, e
--     palavra de gente vence regua;
--   - ANTES de contemplada, do agente de compra e da etiqueta `cedente`.
--     Cancelada e fato sobre a COTA e vence o que vem depois. Uma conversa com
--     as DUAS etiquetas (`cedente` e `cota_cancelada`) e cancelada, nao cedente:
--     ela quer vender, e a casa nao compra. Sem o braco aqui em cima, a etiqueta
--     `cedente` a mandaria para `inserir`.
--
-- A ETIQUETA NAO E DEDUZIDA DE TEXTO, e isso e o ponto todo. Quem a escreve e
-- gente, ou a rotina de encerramento da COTA-CANCELADA-01, sobre fato apurado -
-- nunca o casamento de palavra-chave. Errar aqui nao custa um lead: custa dizer
-- que a casa nao opera um negocio que ela opera.
--
-- HOJE O BRACO E INERTE, e esta medido: ZERO conversas tem a etiqueta
-- `cota_cancelada` (controle positivo na mesma medicao: 10 tem `cedente`, entao
-- a leitura de tags funciona). Nenhuma linha muda de classe por causa dele. Por
-- isso as contagens seguem 15 / 1 / 2 / 10, e por isso a decisao nominal da
-- `fc14bc83` CONTINUA no bloco `palavra_do_emerson` - ver a nota la, e a isca
-- que a aposenta no fim do relatorio.
--
-- -----------------------------------------------------------------------------
-- O EXTRATO ESCOLHIDO
-- -----------------------------------------------------------------------------
-- Extrato por conversa e MULTIPLO e vem com lixo: 14 conversas concentram os 34
-- extratos, e uma delas tem tres - um com confianca 0.7 e dois com confianca 0
-- e todos os campos nulos. Entao:
--   - considera-se so extrato com `confianca >= 0.7`;
--   - entre os validos, o escolhido e o de MAIOR confianca;
--   - `contemplada` e lida do extrato ESCOLHIDO: `false` exclui, `null` NAO
--     exclui. Ausencia de dado nao se pune como se fosse dado.
-- Extrato com confianca 0 e tudo nulo nao conta nem como "tem extrato".
--
-- MEDIDO: o limiar corta metade. 18 dos 34 extratos passam em 0.7, e eles se
-- concentram em 12 conversas. Duas conversas tem extrato bruto e nenhum valido.
-- 12 + 2 = 14, que fecha com a medicao anterior das 14 conversas com extrato.
--
-- OS CAMPOS QUE A PONTE DESCERIA, e por que metade das linhas vem vazia. As dez
-- chaves do jsonb `dados` estao presentes nos 34 extratos; o que varia e o
-- VALOR ser nulo. Medido: confianca 34 nao-nulos, valor_credito 22,
-- contemplada 21, parcelas_restantes 20, parcelas_pagas 18, cota 17, grupo 17,
-- saldo_devedor 17, administradora 16, valor_parcela 15. `tipo_bem` nao existe
-- em nenhum dos 34 - a ponte NAO escreve tipo_bem, fica nulo.
-- Por isso o teste e `dados->>'x' is not null`, NUNCA `dados ? 'x'`: a chave
-- esta sempre la; o dado, nao.
--
-- -----------------------------------------------------------------------------
-- N:1 - UMA CAPTACAO, VARIAS CONVERSAS
-- -----------------------------------------------------------------------------
-- A chave achou duplicados reais entre conversas: a mesma pessoa em duas
-- linhas, uma com e outra sem o nono digito, que nenhuma das reguas antigas
-- igualava. Entao a ponte e N:1, e `captacoes.wa_conversa_id` guarda UMA
-- conversa. A ordem de escolha, nesta ordem:
--     SER CANDIDATA > EXTRATO VALIDO > TAG cedente > MAIS RECENTE
-- A coluna `principal_da_chave` diz quem ganhou. As outras conversas da mesma
-- chave aparecem na lista com classe `(mesma chave)`, para o duplicado ficar
-- visivel a quem confere - e nao escondido atras de um `distinct`. Elas nunca
-- descem para `captacoes`.
--
-- POR QUE "SER CANDIDATA" ENTROU NA FRENTE, medido em 03/09/2026: sem esse
-- criterio, na chave 6392463588 o `principal_da_chave = SIM` caiu sobre uma
-- conversa de classe `(mesma chave)`, que por definicao nao desce para
-- `captacoes`, enquanto a candidata de verdade aparecia como "posto 2". O
-- principal nao pode apontar para quem nao concorre. Nao mudava resultado
-- nenhum hoje - as duas eram exclusao - mas um desempate que aponta para fora
-- da corrida e uma regra errada esperando a hora de custar caro.
--
-- CUSTO DE IMPLEMENTACAO DESSE CRITERIO: a candidatura passou a ser calculada
-- ANTES do desempate. Sao tres CTEs em fila - `base` (sinais), `marcada`
-- (candidatura), `posto` (desempate) - e nao duas, porque uma janela nao
-- enxerga um alias criado no mesmo SELECT. A alternativa era repetir a
-- expressao de candidatura dentro do `order by` da janela, criando duas copias
-- da mesma regra para divergirem em silencio depois. Nao foi feito.
--
-- -----------------------------------------------------------------------------
-- A ULTIMA PALAVRA DO CLIENTE
-- -----------------------------------------------------------------------------
-- Coluna nova, e ela e o que faz a conferencia caber em segundos em vez de
-- vinte conversas abertas. E a ultima mensagem de `papel = 'cliente'`, cortada
-- em 140 caracteres. A coluna nao decide nada sozinha - ela mostra.
--
-- ELA JA PAGOU O PROPRIO CUSTO QUATRO VEZES, e nenhuma regua teria pago por
-- ela. Duas linhas mudaram de CLASSE: a que pediu para nao receber e a que se
-- declarou compradora residente em Portugal. Duas mudaram de MOTIVO: um que a
-- regua chamou de comprador e que na propria frase pede para ser parceiro, e
-- outro cujo texto usa `repasse` - palavra que nesta casa significa venda de
-- cota e que aqui podia significar o contrario.
--
-- MEDIDO: 26 das 104 conversas nao tem NENHUMA mensagem de cliente, e nessas a
-- coluna sai "(o cliente nunca escreveu)". Isso nao e defeito da consulta, e o
-- controle logo abaixo existe para provar que o vazio e do banco e nao do
-- `left join lateral`.
--
-- -----------------------------------------------------------------------------
-- AS QUATRO CLASSES
-- -----------------------------------------------------------------------------
--   inserir  - vira linha nova em `captacoes`, origem 'whatsapp', status 'novo'
--   ligar    - ja existe captacao com a mesma chave; a ponte LIGA, nao insere
--   revisar  - a regua nao decide. Vai ao Emerson com o motivo escrito
--   excluir  - nao e captacao, com o motivo escrito
-- Mais `(mesma chave)`, que nao e classe de destino: e o duplicado exibido.
--
-- -----------------------------------------------------------------------------
-- OS BLOCOS NOMINAIS, E POR QUE SAO MAIS DE UM
-- -----------------------------------------------------------------------------
-- FORMA DA CASA (firmada em 03/09/2026): decisao que veio de pessoa fica fora
-- da regra, sempre com a data, e MORA NUM BLOCO CUJO NOME E QUEM DECIDIU. Hoje
-- sao dois blocos porque sao duas bocas:
--   `palavra_do_emerson`        - o dono do negocio
--   `decisao_da_coordenacao`    - leitura da propria mensagem do cliente, e
--                                 leitura de outras tabelas do banco
-- Se amanha uma terceira boca decidir, nasce um terceiro bloco com o nome dela.
-- Juntar tudo num bloco so apagaria quem decidiu, que e justamente o que estes
-- blocos existem para preservar. Quando duas caem na mesma conversa, a do
-- Emerson vence - e o `coalesce` la embaixo e onde isso esta escrito.
--
-- NEM TODA DECISAO NOMINAL MUDA A CLASSE. Duas delas mudam so o MOTIVO: a
-- classe que a regua deu ja estava certa, mas pela razao errada, e o motivo e
-- o que o Emerson le. Ficar com um motivo errado porque o destino coincidiu
-- seria comprar a resposta certa com a conta errada.
--
-- Tres decisoes nao teriam como sair de regra nenhuma: a cota cancelada nao tem
-- sinal medivel em `wa_conversas` nem em `extratos_cotas`; o negocio que nao
-- fechou so a pessoa sabe; e querer ser parceiro nao tem coluna.
--
-- -----------------------------------------------------------------------------
-- POR QUE A UNIAO ESTA DENTRO DE UMA CTE `tudo`
-- -----------------------------------------------------------------------------
-- Nao e estilo. Postgres recusa `order by <expressao>` sobre UNION:
--   ERROR 0A000: invalid UNION/INTERSECT/EXCEPT ORDER BY clause
--   DETAIL: Only result column names can be used, not expressions or functions.
-- A ordem daqui e por `case`, para as classes sairem na ordem de leitura
-- (inserir, ligar, revisar, excluir, mesma chave) e os controles no fim. Entao
-- a uniao vira CTE e o `order by` mora fora dela.
--
-- =============================================================================

with
-- Os dois numeros da casa (palavra do Emerson, 02/09/2026). Lista provisoria:
-- o destino e a tabela da TELEFONES-CASA-01. Espelho de `TELEFONES_DA_CASA` em
-- platform/lib/telefone.ts.
casa(telefone) as (
  values ('5519997561909'), ('5511973202967')
),
chave_casa as (
  select distinct
         left(sentinela_telefone_norm(telefone), 2) || right(sentinela_telefone_norm(telefone), 8) as chave
  from casa
),

-- Decisoes que vieram do dono do negocio. `id8` = 8 primeiros do uuid.
palavra_do_emerson(id8, classe, motivo) as (
  values
    ('3e98b925', 'inserir', 'palavra do Emerson 02/09/2026: inserir, e o topo da fila - documentos do contrato entregues em 20/08 e sem resposta desde entao'),
    ('cda21b11', 'excluir', 'palavra do Emerson 02/09/2026: e corretor, nao cedente - vai para o funil de parceria, que ainda nao existe'),
    ('b3372777', 'excluir', 'palavra do Emerson 02/09/2026: cota nao contemplada nao e captacao - candidata a um funil proprio'),
    -- ESTA LINHA E PROVISORIA, E O QUE A APOSENTA JA ESTA ESCRITO ABAIXO.
    -- A regra existe agora: o braco `s.cota_cancelada` (espelho do braco 4b de
    -- `decidir()` em platform/lib/funil/ponte.ts). Medido em 05/09/2026, porem,
    -- NENHUMA conversa no banco tem a etiqueta `cota_cancelada` - zero linhas -,
    -- e esta em particular tem `tags {}` e `agente_ativo caetano`. Apagar a linha
    -- HOJE nao promoveria a conversa de "excluir (nominal)" para "excluir
    -- (regra)": ela cairia ate o braco do agente de captacao e viraria INSERIR.
    -- A casa poria uma cota cancelada na mesa como negocio, calada - exatamente
    -- o defeito que o braco 4b foi escrito para fechar.
    -- A linha morre quando a etiqueta nascer (terceira escrita nominal da F3.4).
    -- Nao e memoria de ninguem: o controle "ISCA DA LINHA VENCIDA" no fim deste
    -- relatorio conta quem tem a etiqueta e manda apagar quando passar de 0.
    ('fc14bc83', 'excluir', 'palavra do Emerson 02/09/2026: cota cancelada. Motivo PROVISORIO - a regra ja existe (braco cota_cancelada), falta a etiqueta na linha; quando ela nascer, esta decisao nominal sai e a classe passa a vir da regua'),
    ('ee6271c4', 'excluir', 'palavra do Emerson 03/09/2026: negocio nao fechou. A captacao 6d4f46ea (Tamires, site) recebe status perdida como excecao nominal no backfill da F3.4; esta conversa nao vira captacao nem liga em nada')
),

-- Decisoes da coordenacao, tomadas lendo a propria mensagem do cliente e as
-- outras tabelas do banco. Ficam separadas das do Emerson para que quem le a
-- lista saiba de que boca saiu. As duas ultimas MUDAM SO O MOTIVO: a classe
-- `excluir` que a regua ja dava esta certa, a razao escrita e que nao estava.
decisao_da_coordenacao(id8, classe, motivo) as (
  values
    ('e13b7227', 'excluir', 'decisao da coordenacao 03/09/2026, lendo a propria mensagem dela: declarou-se compradora e residente fiscal em Portugal. E lead do lado de quem COMPRA, nao cedente - o regex a pegou so pela palavra vender. Sai de revisar'),
    ('054c72f6', 'excluir', 'decisao da coordenacao 03/09/2026, lendo a propria mensagem dele: "vendo consorcio e quero ser parceiro Bidcon". Quer ser PARCEIRO, mesmo caso do Bruce (cda21b11) - vai para o funil de parceria, que ainda nao existe e agora ja tem duas pessoas com nome. A regua o excluia como comprador, o que dava a classe certa pela razao errada'),
    ('b9365734', 'excluir', 'decisao da coordenacao 03/09/2026, medida em interesses e nao pelo agente: esta chave (6392463588) JA E INTERESSE desde 25/08, origem chat, status novo, e recebeu o toque 2 da Sentinela em 31/08 - o banco ja registrou de que lado ele entrou, o de comprador. A palavra "repasse" na mensagem dele e ambigua nesta casa e nao basta para virar o lado. Se ele declarar venda, o atendimento cria a captacao pelo gatilho ao vivo da F3.3. Nao e "revisar": nao e a regua que deixa de decidir, e o banco que ja decidiu')
),

conv as (
  select z.id, z.nome, z.telefone, z.tags, z.agente_ativo, z.canal, z.status,
         z.criado_em, z.opt_out,
         case when length(z.d) in (10, 11) then left(z.d, 2) || right(z.d, 8) end as chave
  from (select w.*, sentinela_telefone_norm(w.telefone) as d from wa_conversas w) z
),

cap as (
  select z.id, z.nome, z.telefone, z.origem, z.status, z.credito, z.wa_conversa_id,
         case when length(z.d) in (10, 11) then left(z.d, 2) || right(z.d, 8) end as chave
  from (select c.*, sentinela_telefone_norm(c.telefone) as d from captacoes c) z
),

-- So extrato que se sustenta. Confianca abaixo de 0.7 nao entra nem na conta.
ext_valido as (
  select e.conversa_id, e.dados, e.confianca, e.contemplada,
         row_number() over (partition by e.conversa_id
                            order by e.confianca desc nulls last, e.id) as rn
  from extratos_cotas e
  where e.confianca >= 0.7
),
ext_escolhido as (select * from ext_valido where rn = 1),

-- Terceira regua, a ruidosa. So o que o CLIENTE escreveu.
intencao as (
  select m.conversa_id, count(*) as n
  from wa_mensagens m
  where m.papel::text = 'cliente'
    and m.conteudo ~* '(vender|vendo|venda|repassar|repasse|transferir|transferencia|transferência)'
    and m.conteudo ~* '(cota|consorcio|consórcio|carta|credito|crédito|contemplad)'
  group by m.conversa_id
),

base as (
  select
    c.id, c.nome, c.telefone, c.tags, c.agente_ativo, c.canal, c.status,
    c.criado_em, c.chave,
    coalesce(c.opt_out, false)                               as opt_out,
    substr(c.id::text, 1, 8) as id8,
    ('cedente' = any(c.tags))                                as tem_tag,
    -- Espelho de `TAG_COTA_CANCELADA` em platform/lib/farol/cedente.ts. Estado da
    -- COTA, nao da pessoa: a Bidcon nao opera cota cancelada (palavra do Emerson).
    ('cota_cancelada' = any(c.tags))                         as cota_cancelada,
    (c.chave is not null and c.chave in (select chave from chave_casa)) as eh_casa,
    (x.conversa_id is not null)                              as tem_extrato,
    x.confianca                                              as ext_confianca,
    x.contemplada                                            as ext_contemplada,
    x.dados                                                  as ext_dados,
    (select count(*) from extratos_cotas e2 where e2.conversa_id = c.id) as n_extratos_brutos,
    coalesce(i.n, 0)                                         as n_intencao,
    -- Quando as duas bocas falam da mesma conversa, a do Emerson vence.
    coalesce(pe.classe, dc.classe)                           as classe_forcada,
    coalesce(pe.motivo, dc.motivo)                           as motivo_forcado,
    u.conteudo                                               as ultima_cliente,
    u.criado_em                                              as ultima_cliente_em,
    cp.id                                                    as cap_id,
    cp.nome                                                  as cap_nome,
    cp.telefone                                              as cap_telefone,
    cp.origem                                                as cap_origem,
    cp.status                                                as cap_status,
    cp.credito                                               as cap_credito
  from conv c
  left join ext_escolhido x on x.conversa_id = c.id
  left join intencao i      on i.conversa_id = c.id
  left join palavra_do_emerson pe     on pe.id8 = substr(c.id::text, 1, 8)
  left join decisao_da_coordenacao dc on dc.id8 = substr(c.id::text, 1, 8)
  left join cap cp on cp.chave = c.chave and c.chave is not null
  left join lateral (
    select m.conteudo, m.criado_em
    from wa_mensagens m
    where m.conversa_id = c.id and m.papel::text = 'cliente'
    order by m.criado_em desc, m.id desc
    limit 1
  ) u on true
),

marcada as (
  select b.*,
         (b.agente_ativo in ('caetano', 'tobias')
          or b.tem_tag
          or b.tem_extrato
          or b.n_intencao > 0
          or b.classe_forcada is not null) as candidata
  from base b
),

-- O desempate da chave. CTE separada da `marcada` porque uma janela nao enxerga
-- um alias criado no mesmo SELECT: `candidata` precisa ja existir para poder ser
-- o primeiro criterio. Repetir a expressao dentro do `order by` da janela faria
-- duas copias da mesma regra, e elas divergiriam em silencio.
posto as (
  select m.*,
         row_number() over (partition by m.chave
                            order by m.candidata desc,
                                     m.tem_extrato desc,
                                     m.tem_tag desc,
                                     m.criado_em desc) as posto_na_chave
  from marcada m
),

saida as (
  select p.*
  from posto p
  where p.candidata
     or (p.chave is not null
         and p.chave in (select chave from posto where candidata and chave is not null))
),

classificada as (
  select s.*,
    case
      when not s.candidata                                   then '(mesma chave)'
      when s.opt_out                                         then 'excluir'
      when s.classe_forcada is not null                      then s.classe_forcada
      when s.eh_casa                                         then 'excluir'
      when s.cota_cancelada                                  then 'excluir'
      when s.ext_contemplada is false                        then 'excluir'
      when s.agente_ativo in ('valentina','serena','bento','aurora')
           and not s.tem_tag and not s.tem_extrato           then 'excluir'
      when s.chave is null                                   then 'revisar'
      when s.cap_id is not null                              then 'ligar'
      when s.agente_ativo = 'caetano' or s.tem_tag or s.tem_extrato then 'inserir'
      else 'revisar'
    end as classe,
    case
      when not s.candidata                                   then 'nao e candidata por si; aparece porque divide a chave de telefone com uma candidata - e o duplicado que a chave achou. Nao desce para captacoes'
      when s.opt_out                                         then 'PEDIU PARA NAO RECEBER (opt_out): uma captacao viraria card com proxima acao e alguem ligaria. Compliance vence regra e vence palavra'
      when s.classe_forcada is not null                      then s.motivo_forcado
      when s.eh_casa                                         then 'telefone da casa: e a nossa propria linha conversando, nao um cedente'
      when s.cota_cancelada                                  then 'cota cancelada - a Bidcon nao opera cota cancelada (palavra do Emerson). O estado esta na etiqueta, nao numa mensagem: e regua, nao coincidencia'
      when s.ext_contemplada is false                        then 'o extrato escolhido diz que a cota NAO esta contemplada - nao e captacao; candidata a um funil proprio'
      when s.agente_ativo in ('valentina','serena','bento','aurora')
           and not s.tem_tag and not s.tem_extrato           then 'agente de compra, sem tag de cedente e sem extrato valido: e comprador, nao vendedor'
      when s.chave is null                                   then 'nao tem telefone brasileiro utilizavel (identificador de rede social ou numero estrangeiro): nao da para ligar nem inserir'
      when s.cap_id is not null                              then 'ja existe captacao com a mesma chave de telefone: a ponte LIGA a conversa a linha que ja existe, nunca cria uma segunda'
      when s.agente_ativo = 'caetano'                        then 'agente de captacao, e nenhuma exclusao se aplica'
      when s.tem_tag                                         then 'marcada como cedente por quem atendeu, e nenhuma exclusao se aplica'
      when s.tem_extrato                                     then 'mandou extrato de cota que se sustenta (confianca alta), e nenhuma exclusao se aplica'
      else 'a regua nao decide: agente que atende os dois lados, ou suspeita levantada so pelo texto, sem tag e sem extrato. Precisa de olho humano'
    end as motivo
  from saida s
),

tudo as (
  select
    'candidata'                                                   as bloco,
    c.classe,
    coalesce(c.chave, '(sem chave)')                              as chave,
    c.id8 || ' | ' || coalesce(c.nome, '(sem nome)')              as conversa,
    c.telefone                                                    as tel_bruto_conversa,
    coalesce(c.cap_telefone, '-')                                 as tel_bruto_captacao,
    case when c.cap_id is null then '-'
         else substr(c.cap_id::text, 1, 8) || ' | ' || coalesce(c.cap_nome, '(sem nome)')
              || ' | origem ' || c.cap_origem || ' | status ' || c.cap_status
              || ' | credito ' || coalesce(c.cap_credito::text, '(nulo)')
    end                                                           as captacao_existente,
    c.agente_ativo
      || ' | tags ' || coalesce(nullif(array_to_string(c.tags, ','), ''), '(nenhuma)')
      || ' | ' || c.canal || ' | ' || c.status::text
      || ' | intencao ' || c.n_intencao::text                     as sinais,
    case when c.opt_out then 'OPT-OUT' else 'nao' end             as opt_out,
    case when not c.tem_extrato
         then 'nenhum valido (brutos: ' || c.n_extratos_brutos::text || ')'
         else 'confianca ' || c.ext_confianca::text
              || ' | contemplada ' || coalesce(c.ext_contemplada::text, '(nulo)')
              || ' | brutos ' || c.n_extratos_brutos::text
    end                                                           as extrato_escolhido,
    case when not c.tem_extrato then '-'
         else 'credito ' || coalesce(c.ext_dados->>'valor_credito', '(nulo)')
              || ' | saldo ' || coalesce(c.ext_dados->>'saldo_devedor', '(nulo)')
              || ' | pagas ' || coalesce(c.ext_dados->>'parcelas_pagas', '(nulo)')
              || ' | adm ' || coalesce(c.ext_dados->>'administradora', '(nulo)')
    end                                                           as desceria_para_captacoes,
    case when c.chave is null then '-'
         when c.posto_na_chave = 1 then 'SIM'
         else 'nao (posto ' || c.posto_na_chave::text || ')' end  as principal_da_chave,
    case when c.ultima_cliente is null then '(o cliente nunca escreveu)'
         else to_char(c.ultima_cliente_em, 'DD/MM') || ': '
              || left(regexp_replace(c.ultima_cliente, '\s+', ' ', 'g'), 140)
    end                                                           as ultima_palavra_do_cliente,
    c.motivo
  from classificada c

  -- A LINHA QUE FALTAVA. Sem ela, a ancora da proxima lista tera de ser
  -- reconstruida como esta foi. Regra 7: medicao que nao prova o proprio
  -- contexto nao conta.
  union all
  select '(contexto)', '-', '-', 'banco e instante desta leitura',
         current_database() || ' @ ' || now()::text,
         '-', '-', '-', '-', '-', '-', '-', '-',
         'ANOTE ESTE INSTANTE: ele e a ancora da lista que sair desta rodada'
  union all
  select '(controle)', '-', '-', 'conversas ATE A ANCORA 2026-09-03T01:51:12Z', count(*)::text, '-', '-', '-', '-', '-', '-', '-', '-', 'tem de ser 104 - e a foto do .md aprovado. Se mudar, alguem apagou ou reescreveu conversa antiga'
  from wa_conversas where criado_em < timestamptz '2026-09-03 01:51:12+00'
  union all
  select '(controle)', '-', '-', 'conversas DEPOIS da ancora', count(*)::text, '-', '-', '-', '-', '-', '-', '-', '-', 'a deriva. Nao entram na rodada 1 do backfill; entram na varredura. Ver FUNIL-01_F3_candidatas_deriva.md'
  from wa_conversas where criado_em >= timestamptz '2026-09-03 01:51:12+00'
  union all
  select '(controle)', '-', '-', 'total de conversas no banco', count(*)::text, '-', '-', '-', '-', '-', '-', '-', '-', 'CRESCE POR DESENHO - era 104 na ancora, 115 em 05/09. Quem carrega a expectativa fixa e a linha da ANCORA acima; esta aqui so mostra o tamanho de hoje. A nota antiga dizia "deve ser 104" e foi ela que pegou a deriva - cumpriu o papel e agora seria alarme perpetuo'
  from wa_conversas
  union all
  select '(controle)', '-', '-', 'conversas sem chave utilizavel', count(*)::text, '-', '-', '-', '-', '-', '-', '-', '-', 'IGSID do instagram e numeros estrangeiros'
  from conv where chave is null
  union all
  select '(controle)', '-', '-', 'extratos brutos ATE A ANCORA 2026-09-03T01:51:12Z', count(*)::text, '-', '-', '-', '-', '-', '-', '-', '-', 'tem de ser 34 - a ancora nao segura so conversas: extrato novo em conversa VELHA mudaria a classe dela sem conversa nova nenhuma. Se este numero mudar, foi reescrita de linha antiga'
  from extratos_cotas where criado_em < timestamptz '2026-09-03 01:51:12+00'
  union all
  select '(controle)', '-', '-', 'extratos brutos hoje', count(*)::text, '-', '-', '-', '-', '-', '-', '-', '-', 'CRESCE POR DESENHO - era 34 na ancora, 36 em 05/09. A expectativa fixa mora na linha de cima'
  from extratos_cotas
  union all
  select '(controle)', '-', '-', 'extratos que passam no limiar 0.7', count(*)::text, '-', '-', '-', '-', '-', '-', '-', '-', 'o resto e lixo de leitura'
  from ext_valido
  union all
  select '(controle)', '-', '-', 'captacoes ATE A ANCORA 2026-09-03T01:51:12Z', count(*)::text, '-', '-', '-', '-', '-', '-', '-', '-', 'tem de ser 2, ambas origem site. Captacao nova numa conversa VELHA a moveria de inserir para ligar - e a hipotese que a coordenacao levantou. Medida em 05/09: falsa, a captacao nova (15e35e30) e de conversa nova'
  from captacoes where criado_em < timestamptz '2026-09-03 01:51:12+00'
  union all
  select '(controle)', '-', '-', 'captacoes hoje', count(*)::text, '-', '-', '-', '-', '-', '-', '-', '-', 'CRESCE POR DESENHO - era 2 na ancora, 3 em 05/09, todas origem site. A expectativa fixa mora na linha de cima'
  from captacoes
  union all
  select '(controle)', '-', '-', 'conversas com opt_out em TODO o banco', count(*)::text, '-', '-', '-', '-', '-', '-', '-', '-', 'se este numero crescer, a regra de compliance passa a morder mais linhas'
  from wa_conversas where opt_out
  union all
  select '(controle)', '-', '-', 'conversas SEM mensagem de cliente', count(*)::text, '-', '-', '-', '-', '-', '-', '-', '-', 'a coluna da ultima palavra vem vazia nestas - nao e defeito da consulta'
  from wa_conversas w
  where not exists (select 1 from wa_mensagens m where m.conversa_id = w.id and m.papel::text = 'cliente')
  union all
  select '(controle)', '-', '-', 'ISCA: conversas com agente inexistente', count(*)::text, '-', '-', '-', '-', '-', '-', '-', '-', 'TEM DE SER 0 - se nao for, a regua de agente esta quebrada'
  from conv where agente_ativo = 'zzz_agente_que_nao_existe'
  union all
  select '(controle)', '-', '-', 'ISCA: decisoes nominais que nao acharam conversa', count(*)::text, '-', '-', '-', '-', '-', '-', '-', '-', 'TEM DE SER 0 - se nao for, um id nominal esta errado ou mora em outra tabela'
  from (select id8 from palavra_do_emerson union all select id8 from decisao_da_coordenacao) n
  where not exists (select 1 from wa_conversas w where substr(w.id::text, 1, 8) = n.id8)
  union all
  select '(controle)', '-', '-', 'ISCA DA LINHA VENCIDA: conversas com etiqueta cota_cancelada', count(*)::text, '-', '-', '-', '-', '-', '-', '-', '-', 'era 0 em 05/09/2026, e por isso a decisao nominal da fc14bc83 continua no bloco palavra_do_emerson. QUANDO PASSAR DE 0: apague aquela linha - a regua ja decide, e mante-la faria a decisao nominal esconder a regra que a substituiu'
  from wa_conversas where 'cota_cancelada' = any(tags)
  union all
  select '(controle)', '-', '-', 'CONTROLE POSITIVO da isca acima: conversas com etiqueta cedente', count(*)::text, '-', '-', '-', '-', '-', '-', '-', '-', 'era 10 em 05/09/2026 - se ISTO vier 0, a leitura de tags esta quebrada e o 0 da linha de cima nao quer dizer nada'
  from wa_conversas where 'cedente' = any(tags)
  union all
  select '(controle)', '-', '-', 'CONTROLE POSITIVO: telefones da casa achados', count(*)::text, '-', '-', '-', '-', '-', '-', '-', '-', 'deve ser 2 - se for 0, a chave da casa nao esta batendo com nada'
  from conv where chave in (select chave from chave_casa)
)

select * from tudo
order by
  -- O contexto vem PRIMEIRO de proposito: quem le a saida tem de saber em que
  -- banco e em que instante ela foi medida ANTES de ler qualquer numero. Foi a
  -- falta disto que obrigou a reconstruir a ancora do .md aprovado pelo git.
  case bloco when '(contexto)' then 0 when 'candidata' then 1 else 9 end,
  case classe
    when 'inserir' then 1 when 'ligar' then 2 when 'revisar' then 3
    when 'excluir' then 4 when '(mesma chave)' then 5 else 8 end,
  chave,
  conversa;
