-- 0085_administradoras_grafias_orfas.sql — vincula as grafias orfas vivas
-- PROJETO: xtv (xtvjpnyadcdeadhmzyff). NAO rodar na nnv.
-- APLICADA em 13/08/2026 20:02:50 sob o numero 0080 (ledger do xtv, version
--   20260813200250). Renumerada para 0085 no repo porque 0080 ja estava
--   ocupado. NAO reaplicar.
--   Escrita apos a pergunta de Emerson sobre o corte 73 -> 36 da
--   vw_vitrine_viva (13/08/2026). Ela ESCREVE EM DADO VIVO, ao contrario da
--   0079 — e por isso o "nao reaplicar" acima nao e formalidade.
--
-- ESTE CABECALHO DIZIA "AUTORIZADO: PENDENTE. NAO APLICAR" ATE 17/08/2026.
-- Era falso, e ficou falso por quatro dias. Corrigido por ordem de Emerson
-- depois que a coordenacao conferiu o ledger: 2.474 cartas disponiveis
-- vinculadas, 13 sem vinculo, aliases das grafias no lugar. A instrucao
-- anterior ("aplica depois do merge") esta RETRATADA na origem.
-- COMO O ERRO ACONTECEU, para nao repetir: em 17/08 eu renumerei este arquivo
-- de 0080 para 0085 e escrevi na mensagem de commit que ele seguia pendente.
-- Eu havia lido o arquivo inteiro e nao havia lido o ledger. Vale como regra
-- da casa: O ARQUIVO DIZ O QUE SE PRETENDIA; SO O LEDGER DIZ O QUE ACONTECEU.
-- Reaplicar seria no-op pelos guards. Conferido comando a comando em 17/08,
-- porque a primeira redacao desta frase estava errada em tres pontos e nao
-- vale trocar um cabecalho falso por outro:
--   1 insert  (administradoras/Groscon) guardado por "on conflict do nothing";
--   4 updates (os quatro array_append de alias) guardados por
--     not (<alias> = any(aliases)) — e NAO por administradora_id is null,
--     como eu havia escrito;
--   1 update  (cartas) guardado por administradora_id is null;
--   0 delete.
-- Citado por CONTEUDO e nao por numero de linha de proposito: as duas
-- primeiras versoes deste paragrafo traziam l.107 e l.115, e as duas estavam
-- erradas — escrever o paragrafo empurra o corpo para baixo e invalida o
-- numero no mesmo ato. Referencia que se quebra sozinha nao e referencia.
-- "if not exists" nao aparece neste arquivo: eu o citei de cabeca, do
-- vocabulario generico de migracao. Mas no-op por sorte de guard nao e o
-- mesmo que nao rodar.
--
-- RENUMERADA DE 0080 PARA 0085 EM 17/08/2026, por decisao de Emerson.
-- Este arquivo nasceu 0080 e ficou parado no ramo enquanto a main andava 44
-- commits. Nesse meio tempo a serie seguiu sem ele e o numero 0080 foi
-- ocupado por 0080_fidc_comissao_decidida.sql, ja na main. Mesclar como
-- estava poria DOIS arquivos 0080 no repositorio — e o ledger do xtv ja
-- carrega numero repetido, que e justamente o defeito que torna impossivel
-- ler a ordem em que as coisas foram aplicadas.
-- O conteudo NAO mudou nesta renumeracao: so o nome do arquivo e este
-- paragrafo. 0085 e o proximo livre depois da 0084 (buscar_cartas
-- p_entrada_max), que entra pelo ramo atlas-bacen-01 antes deste.
--
-- POR QUE ELA EXISTE
-- A view nao corta administradora nenhuma: o LEFT JOIN normaliza grafias.
-- Medido em 13/08/2026 sobre status='disponivel':
--   73 grafias distintas em administradora_raw
--   37 nomes distintos depois do join (Porto Seguro sozinha tem 7 grafias)
--   36 na view (o corte de categoria='contemplada' tira REPASSE (CAPITAL DE GIRO))
-- Mas 36 ainda MENTE PARA MAIS. Cinco grafias estao com administradora_id
-- nulo e caem no COALESCE como se fossem administradoras proprias; tres delas
-- duplicam quem ja esta contado. Itau aparece TRES vezes na lista e Banco do
-- Brasil DUAS. O numero real de administradoras distintas e 33.
--
-- POR QUE MEXER EM aliases[] E NAO SO EM administradora_id
-- resolver_administradora(p_raw) (0023) casa por lower(nome) OU lower(alias).
-- Gravar o id na mao consertaria a tela de hoje e seria desfeito na proxima
-- sincronizacao, que reexecuta o resolvedor sobre o raw. O alias e o conserto
-- que sobrevive ao sync; o update no fim so aplica aos que ja estao no banco.
--
-- Mesmo padrao da 0053, que ja fez isso para 'BB Consorcios', 'Caixa',
-- 'Itau Motos', 'Porto VP'. Itau ja carrega 'ITAU - A' e 'ITAU - A' com
-- acento: os sufixos - M e - P sao a MESMA familia, so nao entraram na epoca.
--
-- IDEMPOTENTE: todo append e guardado por `not (... = any(aliases))`, o insert
-- e guardado por `on conflict do nothing`, e o update final so toca linha com
-- administradora_id nulo. Rodar duas vezes nao muda nada na segunda.

begin;

-- 1) Grafias que pertencem a administradoras JA CADASTRADAS ------------------
-- CONTAGEM CORRIGIDA (13/08/2026), sobre TODOS os status e nao so disponivel:
--   BBRASIL     141 cartas (6 disponiveis)
--   ITAU - M     47 cartas (1 disponivel)   [com acento]
--   ITAU - P     46 cartas (0 disponiveis)  [com acento]
--   ITAU - P      6 cartas (1 disponivel)   [sem acento]
--   GROSCON       2 cartas (2 disponiveis)
--   = 242 linhas no update do passo 4.
--
-- A primeira versao dizia "11 cartas". Era a contagem da fatia disponivel, e
-- como DESCRICAO do que o update faz estava errada por uma ordem de grandeza,
-- porque o update nao tem escopo de status. Fica registrado: medir na fatia
-- que a tela mostra e depois escrever na tabela inteira e um jeito confiavel
-- de subestimar o proprio raio de acao.

update public.administradoras
   set aliases = array_append(aliases, 'BBRASIL')
 where nome = 'Banco do Brasil'
   and not ('BBRASIL' = any(aliases));

update public.administradoras
   set aliases = array_append(aliases, 'ITAÚ - M')
 where nome = 'Itaú'
   and not ('ITAÚ - M' = any(aliases));

update public.administradoras
   set aliases = array_append(aliases, 'ITAU - P')
 where nome = 'Itaú'
   and not ('ITAU - P' = any(aliases));

-- E a MESMA grafia COM acento, que e outra chave. resolver_administradora casa
-- por lower(), e lower() nao remove acento: 'itaú - p' e 'itau - p' sao
-- diferentes. A primeira versao desta migracao so tinha a sem acento, porque a
-- fatia de disponiveis so continha ela — e teria deixado 46 cartas orfas
-- enquanto eu declarava o assunto resolvido.

update public.administradoras
   set aliases = array_append(aliases, 'ITAÚ - P')
 where nome = 'Itaú'
   and not ('ITAÚ - P' = any(aliases));

-- 2) Administradora REAL que faltava no cadastro -----------------------------
-- 'GROSCON' (2 cartas). Groscon e administradora de consorcio de verdade; nao
-- e grafia de ninguem que ja esteja aqui. Entra com o nome por extenso e a
-- grafia da fonte como alias.

insert into public.administradoras (nome, aliases)
values ('Groscon', array['GROSCON'])
on conflict do nothing;

-- 3) NAO cadastramos 'KASINSK' -----------------------------------------------
-- Uma carta. A string tem 7 caracteres e termina em consoante onde a marca
-- termina em vogal ('Kasinski'), o que tem cara de corte de largura de coluna
-- na origem, nao de nome. Cadastrar administradora com nome truncado e pior do
-- que deixar a grafia crua aparecendo: o nome errado vira canonico e passa a
-- atrair as proximas cartas para dentro do erro. Fica para Emerson confirmar a
-- grafia com a fonte. NAO afeta a contagem: com ou sem cadastro, 'KASINSK' e
-- uma entidade so na view, e o total continua 33.
--
-- TRES GRAFIAS QUE APARECERAM NA MEDICAO E FICAM DE FORA DESTA MIGRACAO
-- Todas com ZERO cartas disponiveis, entao nenhuma mexe no numero da vitrine:
--   'PORTOAF'  201 cartas, todas indisponiveis. Porto Seguro ja tem o alias
--              'PORTO AF' COM espaco; esta e a mesma coisa sem o espaco, e
--              quase certamente dela. Fica de fora porque 201 linhas nao e
--              detalhe e Emerson nao aprovou esta grafia — ele aprovou uma
--              lista de cinco que eu apresentei, e esta nao estava nela.
--   'DAF'        6 cartas, todas indisponiveis. DAF e marca de caminhao;
--              pode ser administradora, pode ser o bem no campo errado.
--              Adivinhar aqui e criar administradora falsa.
--   (vazio)     54 cartas com administradora_raw em branco. Nao ha o que
--              resolver: falta o dado na origem, nao o vinculo.
--
-- Pela mesma razao 'REPASSE (CAPITAL DE GIRO)' (842 cartas no total, 12 delas
-- disponiveis — e a maior grafia orfa do banco) NAO vira
-- administradora aqui: nao e administradora, e uma CATEGORIA que vazou para o
-- campo errado na origem. A view ja a esconde por categoria='repasse'. Limpar
-- a origem e outro assunto, e e assunto de quem manda no importador.

-- 4) Reaplica o resolvedor nas cartas que ficaram sem vinculo -----------------
-- Sem escopo de status nem de categoria de proposito: uma carta vendida ontem
-- com o vinculo errado suja relatorio historico do mesmo jeito. So toca linha
-- com administradora_id nulo, e so quando o resolvedor devolve alguem.

update public.cartas c
   set administradora_id = public.resolver_administradora(c.administradora_raw)
 where c.administradora_id is null
   and public.resolver_administradora(c.administradora_raw) is not null;

commit;

-- CONFERENCIA (rodar DEPOIS, fora da transacao; nao muda nada)
--
-- Esperado: 33 administradoras na vitrine viva, contra 36 antes.
--   select count(distinct administradora) from public.vw_vitrine_viva;
--
-- Esperado: Itau uma vez so, Banco do Brasil uma vez so.
--   select administradora, count(*) from public.vw_vitrine_viva
--    group by administradora order by count(*) desc;
--
-- Esperado: sobra 'KASINSK' (1 carta) e 'REPASSE (CAPITAL DE GIRO)' (12).
--   select administradora_raw, count(*) from public.cartas
--    where administradora_id is null and status='disponivel'
--    group by administradora_raw order by count(*) desc;
--
-- Esperado: o total em dinheiro NAO muda. Nenhuma carta entra ou sai da
-- vitrine — so o nome que a linha exibe muda. Se este numero mexer, a
-- migracao fez algo que nao devia:
--   select count(*), sum(credito)::numeric(18,2) from public.vw_vitrine_viva;
--   -- em 13/08/2026, antes: 2425 cartas, R$ 420.493.818,53
