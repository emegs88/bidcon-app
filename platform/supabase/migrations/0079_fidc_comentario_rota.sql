-- ============================================================================
-- 0079_fidc_comentario_rota.sql — FIDC-OFERTAS-01, Entrega 2 (so comentario)
-- PROJETO: xtv (xtvjpnyadcdeadhmzyff). NAO rodar na nnv.
-- AUTORIZADO: Emerson Gomes dos Santos — OS "FIDC-OFERTAS-01" (12/08/2026), na
-- parte do endereco: "a sigla nao mora em URL — mesmo motivo do linter".
--
-- O QUE ESTA MIGRACAO CORRIGE, e por que ela existe sozinha.
--
-- A 0078 foi escrita antes de a rota ser decidida e gravou, no comentario da
-- coluna fidc_fundos.emails_autorizados, que o fundo entra em "/fidc". A rota
-- nasceu /fundo. A 0078 JA FOI APLICADA no xtv (3 tabelas, 0 linhas, RLS
-- ligada), entao editar o arquivo dela nao mudaria nada no banco: o comentario
-- errado ja esta gravado no catalogo, e e ele que a proxima pessoa le quando
-- abrir a tabela no console procurando onde esse e-mail e usado.
--
-- ESTA MIGRACAO NAO TOCA EM DADO NEM EM ESTRUTURA. Nenhuma tabela, coluna,
-- constraint, indice ou policy muda. `comment on` e idempotente — reescreve o
-- texto, nao acumula —, o que a torna segura de rodar sobre uma migracao ja
-- aplicada e segura de rodar duas vezes.
--
-- POR QUE ISSO MERECE UMA MIGRACAO, e nao um "depois a gente arruma": porque um
-- comentario de catalogo e documentacao que viaja COM o banco. Ele sobrevive a
-- qualquer README e e o unico texto que aparece para quem esta olhando a tabela
-- no momento em que precisa da resposta. Documentacao que aponta para uma porta
-- que nao existe e pior que documentacao nenhuma: a primeira custa uma busca
-- vazia por uma rota /fidc que nunca foi escrita, a segunda custa uma pergunta.
-- ============================================================================

comment on column public.fidc_fundos.emails_autorizados is
  'Lista de e-mails que podem entrar em /fundo como este fundo (a rota e /fundo: a sigla nao mora em URL). Comparacao case-insensitive; a aplicacao grava em minusculas (ver desvio (d) no cabecalho da 0078). Vazio = fundo cadastrado que ainda nao pode entrar — estado legitimo e proposital. Esta lista e a allowlist VIVA: suspender um fundo ou tirar um e-mail tem efeito na proxima leitura, sem redeploy, que e a razao de ela morar no banco e nao em env.';
