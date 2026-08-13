-- 0080_administradoras_grafias_orfas.sql — vincula as grafias orfas vivas
-- PROJETO: xtv (xtvjpnyadcdeadhmzyff). NAO rodar na nnv.
-- AUTORIZADO: PENDENTE. Escrita apos a pergunta de Emerson sobre o corte
--   73 -> 36 da vw_vitrine_viva (13/08/2026). NAO APLICAR sem ordem expressa:
--   esta migracao ESCREVE EM DADO VIVO, ao contrario da 0079.
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
-- 'BBRASIL' (6 cartas), 'ITAU - M' e 'ITAU - P' (1 carta cada).

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
-- Pela mesma razao 'REPASSE (CAPITAL DE GIRO)' (12 cartas) NAO vira
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
