-- ============================================================================
-- POLITICA-PORTO-01 — as linhas da Porto Seguro em administradora_politica
-- DRAFT. NAO APLICAR. Nasce sem numero por CLAUDE.md Regra 5.
-- Alvo: xtv (xtvjpnyadcdeadhmzyff).
--
-- Este arquivo NAO cria nada. E so DADO: 7 apuracoes e 6 lacunas.
-- ============================================================================
--
-- DEPENDENCIA DECLARADA, E DECLARADA DE PROPOSITO
-- Este arquivo EXIGE que POLITICA-ADM-01 tenha sido aplicado ANTES. Depende de:
--   · public.administradora_politica          (tabela)
--   · public.administradora_politica_lacuna   (tabela)
--   · public.administradora_politica_campo    (vocabulario, 28 campos)
--   · public.administradoras                  (ja existe no banco)
--
-- A dependencia vai ESCRITA e vai CHECADA (bloco `do` la embaixo) porque a
-- versao anterior de POLITICA-ADM-01 pagou exatamente por esconder uma: a view
-- consumia `administradoras.cnpj_raiz`, coluna que so o draft ATLAS-BACEN-01
-- cria, e como a ordem de aplicacao dos drafts nao esta fixada, aplicar na
-- ordem errada abortaria a transacao inteira. Ali a saida foi remover o
-- acoplamento. Aqui nao ha como remover — linha de politica precisa da tabela
-- de politica —, entao a saida e a outra: declarar E FALHAR ALTO.
--
-- ============================================================================
-- FONTE
-- fonte_tipo: documento_oficial
-- fonte_ref:  Ficha de Transferencia de Grupo/Cota Contemplada, 3647-MAR/2020
--             (arquivo 09/2024), portal do corretor
-- fonte_data: 2020-03-01
-- apurado_em: 2026-08-17   apurado_por: coordenacao
--
-- POR QUE fonte_data = 2020-03-01 E NAO 2024-09
-- `3647-MAR/2020` e a VERSAO do documento; `09/2024` e a data do arquivo que
-- chegou. A ficha fala pela politica de marco de 2020, nao pela de setembro de
-- 2024 — quem republica um PDF nao reafirma o conteudo dele. Consequencia
-- medida e desejada: `least(apurado_em, fonte_data)` da 2020-03-01, que e mais
-- velho que 12 meses, logo AS SETE LINHAS SAEM COM `pede_reapuracao = true`.
-- Isso e a DECISAO 1 funcionando, nao um defeito: a tela vai dizer "apurado,
-- confere de novo" em vez de "apurado" em verde. Datar pelo arquivo faria as
-- sete linhas parecerem frescas de hoje, que e a mentira que a coluna
-- `fonte_data` existe para impedir.
--
-- ACENTO: os literais deste arquivo vao sem acento, como o resto do repo. Nada
-- se perde de rastreabilidade — o titulo do documento e o codigo `3647-MAR/2020`
-- continuam achaveis. O que NAO se abrevia e o codigo da versao.
--
-- ============================================================================
-- OS NOMES: SEIS ESCOLHAS QUE EU FIZ E QUE FICAM REGISTRADAS
-- A ordem da coordenacao usou 13 nomes de campo. Quatro deles nao existem no
-- vocabulario com aquela grafia, e usar a grafia da ordem criaria campo
-- duplicado para a mesma pergunta — que e pior do que o incomodo de renomear.
-- Foram resolvidos assim (todos com o vocabulario de POLITICA-ADM-01):
--   score_minimo          -> exige_score_minimo      (ja existia)
--   taxa_de_transferencia -> taxa_transferencia      (ja existia)
--   prazo_de_resposta     -> prazo_resposta_dias     (ja existia, numero)
--   comprovacao_documental_de_renda -> este e o CASO GRAVE: ja existia
--     `exige_comprovacao_renda`, que respondia AS DUAS perguntas de uma vez.
--     Ele foi RENOMEADO para `comprovacao_documental_de_renda` em
--     POLITICA-ADM-01 e ganhou o irmao `declara_renda`. Sem o split, dizer
--     "sim" mandaria o cliente juntar holerite que a Porto nao pediu.
-- E duas decisoes de conteudo:
--   · `analise_credito_propria` NAO e preenchido. A ficha prova que o credito
--     DO CESSIONARIO e analisado; nao diz se a analise e feita em casa ou
--     terceirizada. Preencher faria a fonte responder o que ela nao disse.
--   · o `10` de `max_cotas_por_formulario` vem da CONTAGEM DE LINHAS da tabela
--     de grupo/cota da ficha, nao da frase citada na ordem. Ver o `detalhe`.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- CONTROLE 1 — A ADMINISTRADORA EXISTE E E UMA SO.
--
-- `insert into ... select ... from administradoras where nome = 'Porto Seguro'`
-- com nome que nao casa insere ZERO LINHAS E DA SUCESSO. E o mesmo "verde
-- vazio" que `fonte_data` combate do outro lado: o apply passaria, a tela
-- ficaria sem nada, e ninguem saberia por que. Medido em 17/08/2026 no xtv:
-- exatamente 1 linha com nome = 'Porto Seguro'
-- (id f60d040a-47f0-41bc-84c1-5765e797f7e4, aliases PORTO / PORTOSEG /
-- PORTO SEGURO CONSORCIO / PORTO AF / PORTO SEGURO VP / PORTO VP / Porto VP).
-- O id NAO vai escrito nos inserts de proposito: uuid e por banco, e este
-- arquivo pode rodar em outro. Resolve-se por nome, mas com esta trava.
-- ----------------------------------------------------------------------------
do $ctrl1$
declare n int;
begin
  select count(*) into n from public.administradoras where nome = 'Porto Seguro';
  if n <> 1 then
    raise exception
      'POLITICA-PORTO-01: esperava exatamente 1 administradora com nome = '
      '''Porto Seguro'', encontrei %. Sem isso o insert entraria vazio em '
      'silencio. Conferir a grafia em public.administradoras antes de aplicar.', n;
  end if;
end $ctrl1$;

-- ----------------------------------------------------------------------------
-- CONTROLE 2 — O VOCABULARIO ESTA NO BANCO (a dependencia, executavel).
--
-- A FK de `campo` ja derrubaria o insert, mas com mensagem que nomeia a
-- constraint e nao o que falta. Este bloco diz QUAL campo falta e POR QUE,
-- o que transforma "erro de FK" em "POLITICA-ADM-01 nao foi aplicado".
-- ----------------------------------------------------------------------------
do $ctrl2$
declare faltando text;
begin
  select string_agg(c, ', ' order by c) into faltando
  from unnest(array[
    'analise_credito_do_cessionario',
    'cessionario_pj',
    'declara_renda',
    'exige_vinculo_empregaticio',
    'exige_dados_conjuge',
    'canal_de_envio',
    'max_cotas_por_formulario',
    'comprovacao_documental_de_renda',
    'consulta_biro',
    'aceita_nome_com_restricao',
    'exige_score_minimo',
    'taxa_transferencia',
    'prazo_resposta_dias'
  ]) as c
  where not exists (
    select 1 from public.administradora_politica_campo k where k.campo = c
  );

  if faltando is not null then
    raise exception
      'POLITICA-PORTO-01: campo(s) ausente(s) do vocabulario: %. '
      'Este arquivo DEPENDE de POLITICA-ADM-01 (que semeia 28 campos) ter sido '
      'aplicado antes. Aplicar POLITICA-ADM-01 primeiro.', faltando;
  end if;
end $ctrl2$;

-- ----------------------------------------------------------------------------
-- AS 7 APURACOES.
--
-- SEM `on conflict do nothing`, de proposito. Aqui um conflito nao e ruido: e
-- duas apuracoes discordando sobre a mesma administradora e o mesmo campo, e
-- isso tem de PARAR o apply para alguem decidir qual vale. `do nothing`
-- escolheria a linha velha em silencio, que e a pior das tres saidas.
--
-- `tipo_valor` vai escrito em cada linha e a FK composta (campo, tipo_valor)
-- confere contra o vocabulario: errar o tipo aqui e recusa, nao gravacao torta.
-- ----------------------------------------------------------------------------
insert into public.administradora_politica
  (administradora_id, campo, tipo_valor, valor, valor_lista, detalhe,
   fonte_tipo, fonte_ref, fonte_data, apurado_em, apurado_por)
select
  a.id, v.campo, v.tipo_valor, v.valor, null::jsonb, v.detalhe,
  'documento_oficial',
  'Ficha de Transferencia de Grupo/Cota Contemplada, 3647-MAR/2020 '
    '(arquivo 09/2024), portal do corretor',
  date '2020-03-01',
  date '2026-08-17',
  'coordenacao'
from public.administradoras a
cross join (values

  -- Canal literal no documento, e nao inferencia a partir do formato da ficha.
  ('analise_credito_do_cessionario', 'booleano', 'sim',
   'A ficha traz bloco "dados do comprador para analise" e manda enviar para '
   'tratativa.analisedecredito@portoseguro.com.br. O nome do canal e a propria '
   'prova. NAO diz se a analise e interna ou terceirizada, por isso '
   '`analise_credito_propria` fica NAO APURADO em vez de herdar este sim.'),

  -- Era a pergunta em aberto da apuracao anterior. Fechada por esta fonte.
  ('cessionario_pj', 'booleano', 'sim',
   'A ficha tem quadro societario proprio: nome, CPF, data de nascimento e '
   'percentual de participacao dos socios. Cabem 3 socios no formulario. '
   'ATENCAO AO QUE ISSO NAO DIZ: 3 e a CAPACIDADE DO IMPRESSO, nao uma recusa '
   'declarada de PJ com 4 socios. O documento nao escreve limite de socios. '
   'Tratar as 3 linhas como regra seria transformar falta de espaco em politica.'),

  -- O par que existe por causa desta fonte.
  ('declara_renda', 'booleano', 'sim',
   'Campo "Renda / Faturamento", presente tanto no bloco de PF quanto no de PJ. '
   'E o NUMERO da renda que se escreve. A ficha NAO pede holerite, imposto de '
   'renda nem extrato — ver a lacuna de `comprovacao_documental_de_renda`.'),

  ('exige_vinculo_empregaticio', 'booleano', 'sim',
   'A ficha pede empresa onde trabalha, cargo, data de admissao e telefone '
   'comercial. Sao quatro campos sobre o mesmo vinculo, o que descarta leitura '
   'de campo solto opcional.'),

  ('exige_dados_conjuge', 'booleano', 'sim',
   'A ficha pede nome e CPF do conjuge. Dado de terceiro que nao assina o '
   'negocio: e a origem do requisito de consentimento que foi para PRE-ANALISE-02.'),

  ('canal_de_envio', 'texto', 'e-mail',
   'A ficha manda baixar, preencher e ANEXAR — nao ha protocolo em portal nem '
   'formulario web. Destino: tratativa.analisedecredito@portoseguro.com.br. '
   'Consequencia operacional: e um canal sem recibo automatico, logo o prazo de '
   'resposta so pode ser medido pela propria casa (ver lacuna de '
   '`prazo_resposta_dias`).'),

  -- Ver o comentario do cabecalho: o numero e contagem de linhas do impresso.
  ('max_cotas_por_formulario', 'numero', '10',
   'A tabela de grupo/cota da ficha tem 10 linhas. O DOCUMENTO NAO ESCREVE '
   'ESTE NUMERO EM PALAVRAS: o 10 e contagem de linhas do impresso, e vai '
   'registrado assim para nao ser lido como limite publicado. A frase que a '
   'ficha traz e outra e diz outra coisa — "caso tenha mais de um grupo/cota '
   'preencher somente um formulario" —, ou seja, UM formulario serve VARIAS '
   'cotas. As duas coisas juntas e que dao o campo: um formulario, ate 10 '
   'linhas. Se a Porto publicar um maximo em palavras, esta linha se reapura.')

) as v(campo, tipo_valor, valor, detalhe)
where a.nome = 'Porto Seguro';

-- ----------------------------------------------------------------------------
-- AS 6 LACUNAS. "PROCUREI E NAO ESTAVA LA" — que nao e "nao".
--
-- Nenhuma destas seis satisfaz filtro nenhum. Elas existem para que a tela
-- diga "nao apurado" com onde e quando, em vez de omitir a linha e deixar o
-- operador achar que ninguem olhou.
--
-- A DIVISAO ENTRE ELAS E O QUE MAIS IMPORTA AQUI, e sao dois motivos distintos:
--   (a) FORMULARIO DE COLETA NAO PUBLICA CRITERIO DE DECISAO. A ficha COLHE o
--       dado (CPF para consulta, renda, restricao) e nao diz o que a Porto faz
--       com ele. Colher nao e criterio.
--   (b) AUSENTE NAS DUAS FONTES. Nem colhido, nem mencionado.
-- Sao motivos diferentes porque levam a acoes diferentes: (a) se resolve
-- perguntando a politica; (b) se resolve medindo a propria operacao da casa.
--
-- HONESTIDADE SOBRE "AS DUAS FONTES": a apuracao anterior da Porto Seguro
-- NUNCA FOI ARQUIVADA. Medido em 17/08/2026: `grep -ri porto ident01/ docs/`
-- nao acha nenhuma linha de politica dela — o que existe e mencao solta. Logo
-- "as duas fontes lidas" hoje e verificavel por terceiro em UMA so. Isso vai
-- escrito na observacao das duas linhas que dependem do plural, porque lacuna
-- que exagera o esforco de busca e pior que lacuna nenhuma.
-- ----------------------------------------------------------------------------
insert into public.administradora_politica_lacuna
  (administradora_id, campo, onde_procurou, observacao, procurado_em, procurado_por)
select
  a.id, v.campo, v.onde_procurou, v.observacao,
  date '2026-08-17', 'coordenacao'
from public.administradoras a
cross join (values

  ('comprovacao_documental_de_renda',
   'Ficha de Transferencia de Grupo/Cota Contemplada 3647-MAR/2020 (portal do '
   'corretor), bloco de renda de PF e de PJ; e a apuracao anterior da Porto '
   'Seguro (nao arquivada, ver observacao)',
   'As duas fontes lidas pedem RENDA DECLARADA; nenhuma menciona documento '
   'comprobatorio. Declarar renda e comprovar renda sao coisas diferentes, e '
   '`declara_renda = sim` na mesma administradora e a prova de que a distincao '
   'nao e teorica. RESSALVA: a apuracao anterior nunca foi arquivada em '
   'ident01/ nem em docs/, logo hoje so a ficha e conferivel por terceiro.'),

  ('consulta_biro',
   'Ficha de Transferencia de Grupo/Cota Contemplada 3647-MAR/2020 (portal do '
   'corretor), bloco de dados do comprador',
   'Formulario de coleta nao publica criterio de decisao. A ficha colhe CPF e '
   'manda para um canal chamado analisedecredito, o que torna a consulta '
   'PROVAVEL — e provavel nao entra nesta tabela. Fica lacuna, nao "sim".'),

  ('aceita_nome_com_restricao',
   'Ficha de Transferencia de Grupo/Cota Contemplada 3647-MAR/2020 (portal do '
   'corretor), documento inteiro',
   'Formulario de coleta nao publica criterio de decisao. O impresso nao tem '
   'campo nem clausula sobre restricao.'),

  ('exige_score_minimo',
   'Ficha de Transferencia de Grupo/Cota Contemplada 3647-MAR/2020 (portal do '
   'corretor), documento inteiro',
   'Formulario de coleta nao publica criterio de decisao. Nome do campo no '
   'vocabulario da casa e `exige_score_minimo`; a ordem chamou de score_minimo.'),

  ('taxa_transferencia',
   'Ficha de Transferencia de Grupo/Cota Contemplada 3647-MAR/2020 (portal do '
   'corretor), documento inteiro; e a apuracao anterior da Porto Seguro (nao '
   'arquivada, ver observacao)',
   'Ausente nas duas fontes: nem valor, nem percentual, nem mencao a cobranca. '
   'Resolve-se medindo a propria operacao da casa, nao relendo a ficha. '
   'RESSALVA: a apuracao anterior nunca foi arquivada, logo hoje so a ficha e '
   'conferivel por terceiro.'),

  ('prazo_resposta_dias',
   'Ficha de Transferencia de Grupo/Cota Contemplada 3647-MAR/2020 (portal do '
   'corretor), documento inteiro',
   'Ausente na fonte. E coerente com `canal_de_envio = e-mail`: canal sem '
   'recibo nao publica prazo. Resolve-se medindo os proprios envios da casa.')

) as v(campo, onde_procurou, observacao)
where a.nome = 'Porto Seguro';

commit;

-- ============================================================================
-- O QUE ESTE ARQUIVO DELIBERADAMENTE NAO FAZ
--
-- · NAO preenche `analise_credito_propria`. Ver cabecalho.
-- · NAO preenche `vendedor_pj` nem `comprador_pj`. A ficha e de TRANSFERENCIA,
--   e cessionario_pj responde por ela; as outras duas pontas sao outra pergunta
--   e nao aparecem no documento. Nem lacuna: nao foram procuradas nesta rodada,
--   e lacuna sem busca seria inventar esforco.
-- · NAO cria campo. Todo campo usado aqui vem do vocabulario de POLITICA-ADM-01.
-- · NAO guarda nenhum dado pessoal. Registra que a ficha PEDE CPF, RG, data de
--   nascimento, endereco, dados do conjuge e quadro societario — o dado em si
--   nunca entra nesta tabela.
--
-- LGPD — CONSEQUENCIA QUE NAO MORA NESTE ARQUIVO E TEM DONO
-- Se a Bidcon passar a preencher e enviar esta ficha pelo cliente, ela vira
-- OPERADORA desses dados. Requisito (nao observacao) de PRE-ANALISE-02:
--   · bucket PRIVADO, nunca comum; nunca WhatsApp;
--   · URL assinada por rota do servidor;
--   · registro de quem abriu;
--   · consentimento do cessionario registrado ANTES do preenchimento, e a tela
--     BLOQUEIA sem ele.
-- Fica escrito aqui porque foi ESTA ficha que gerou o requisito: `exige_dados_
-- conjuge = sim` significa dado de terceiro que nao assina o negocio.
--
-- POS-APPLY, obrigatorio:
--   · conferir que as 7 saem de vw_administradora_politica com
--     pede_reapuracao = true (e a consequencia declarada de fonte_data=2020).
--   · conferir que `comprovacao_documental_de_renda` aparece em
--     vw_administradora_politica_lacuna com ja_suprida = false ENQUANTO
--     `declara_renda` sai com vale_como_sim = true. As duas ao mesmo tempo na
--     tela e a unica prova de que o split de campo funcionou.
-- ============================================================================
