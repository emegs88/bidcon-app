-- ============================================================================
-- 0083_sentinela_dedup_telefone — DEDUP-SENTINELA-01
-- AUTORIZADO: Emerson, 16/08/2026, junto com a decisão (c) ("toca as 27,
-- ninguém é retirado"). Declarado BLOQUEANTE na mesma ordem: "Nenhum disparo
-- antes dela."
--
-- ORDEM DE EXECUÇÃO — DOIS PASSOS, e isto não é preferência.
-- Postgres recusa USAR um valor de enum na mesma transação em que ele é criado
-- ("unsafe use of new value of enum type"). A 0081 já tropeçou nisso e o apply
-- teve de ser partido. Aqui o arquivo já nasce sabendo:
--
--   0083a — só o `alter type ... add value` da seção 1, commitado sozinho.
--   0083b — todo o resto: funções, backfill, grants.
--
-- Arquivo único de propósito: partir em dois arquivos faria a numeração mentir
-- sobre quantas migrações existem.
-- ----------------------------------------------------------------------------
-- O PROBLEMA, MEDIDO ANTES DE ESCREVER (16/08/2026, xtv)
--
-- A decisão (c) mandou tocar as 27 sem retirar ninguém. Isso transforma um
-- defeito latente em risco imediato: se duas linhas da fila têm o MESMO
-- telefone, a pessoa recebe a mesma mensagem duas vezes, no mesmo minuto, do
-- mesmo remetente — num template categoria MARKETING. Isso não é incômodo, é
-- denúncia.
--
-- Medição da fila inteira (31 linhas, todos os status):
--
--   telefones com mais de uma linha ....... 3
--   maior repetição ....................... 2   (nenhum com três)
--   linhas envolvidas ..................... 6
--
-- Mas o número que decide é outro, e é bem menor. Dos 3 telefones repetidos,
-- 2 são números de teste do próprio Emerson (19997561909, 19999999999) e as 4
-- linhas deles já estão em 'excluido' — fora da fila tocável. Sobra UM caso
-- real, que é exatamente o que a ordem nomeou:
--
--   81997194289  "Elvis Airon"  5b9fbfc1…  aguardando_template  ← vence
--   81997194289  "Elvis"        6340875e…  aguardando_template  ← perde
--
-- Efeito na fila viva: 27 elegíveis → 26. Uma linha, uma pessoa, uma mensagem.
--
-- O DESEMPATE É POR id, E SÓ PODE SER
-- As duas linhas têm criado_em IDÊNTICO (2026-08-04 22:27:20.820481+00) — são
-- do mesmo lote de captação. `order by criado_em` sozinho devolveria ordem
-- arbitrária do Postgres, e "arbitrária" aqui significa que a cada execução
-- poderia vencer uma linha diferente. O `, id` no fim não é enfeite: é o que
-- torna a escolha ESTÁVEL. Mesmo desempate que a 0081 já usa.
--
-- ----------------------------------------------------------------------------
-- POR QUE EM SQL, E NÃO EM JS
--
-- A mesma razão da 0081: a seleção é feita com LIMIT. Deduplicar depois, em
-- JavaScript, faria a linha descartada OCUPAR uma vaga da janela de 15 antes
-- de ser jogada fora. E como as duas linhas do Elvis têm criado_em idêntico e
-- vêm no começo da ordem, elas gastariam duas das quinze vagas toda execução.
-- Filtro que roda depois do LIMIT não é filtro, é desperdício com aparência de
-- cuidado.
--
-- ----------------------------------------------------------------------------
-- VALE PARA O FUTURO, NÃO SÓ PARA ESTE LOTE
--
-- A captação não impede duas linhas com o mesmo número: o upsert da FASE A usa
-- `onConflict: conversa_site_id`, que é a conversa, não a pessoa. Duas conversas
-- do mesmo telefone geram duas linhas, legitimamente. Por isso o dedup mora na
-- FUNÇÃO — roda em toda leitura, para sempre — e o backfill abaixo é só a
-- limpeza do que já existe.
-- ============================================================================


-- ============================================================================
-- 1. O VALOR NOVO DO ENUM  ← este bloco é o 0083a, commitado SOZINHO
-- ----------------------------------------------------------------------------
-- 'excluido' não serve: quer dizer opt-out / número inválido / número da casa,
-- e é lido como "essa pessoa não quer falar com a gente". Não é o caso — a
-- pessoa continua na fila, pela outra linha. Reaproveitar 'excluido' aqui
-- apagaria a diferença entre "não tocamos porque ela pediu" e "não tocamos
-- porque já estamos tocando ali do lado", que são coisas opostas.
--
-- IF NOT EXISTS porque migração tem de poder rodar duas vezes (CLAUDE.md,
-- Regra 3 — apply por MCP pode dar timeout já tendo commitado).
alter type sentinela_status add value if not exists 'duplicado_telefone';


-- ============================================================================
-- 2. NORMALIZAÇÃO DO TELEFONE  ← daqui em diante é o 0083b
-- ----------------------------------------------------------------------------
-- MEDIDO ANTES DE ESCREVER, e o resultado importa: hoje esta função é um no-op.
-- As 31 linhas de sentinela_fila têm telefone com 0 nulos, 0 caracteres não
-- numéricos, 0 começando com '55', e comprimento 11 em TODAS. Registro isso
-- porque afirmar "normalizei" sem medir seria promessa, não medição — e porque
-- quem ler daqui a seis meses precisa saber que a sujeira era hipótese, não
-- fato observado.
--
-- A ARMADILHA QUE ESTA FUNÇÃO DESVIA
-- O reflexo é "tira o 55 da frente". Isso CORROMPE número legítimo: DDD 55
-- existe (Santa Maria, Uruguaiana — Rio Grande do Sul). Um celular de lá é
-- 55 9xxxx-xxxx, ou seja, 11 dígitos começando com '55', e cortar o prefixo
-- transformaria a pessoa em outra.
--
-- O que separa os dois casos é o COMPRIMENTO, não o prefixo:
--   11 dígitos  = DDD + 9 dígitos          → doméstico, não mexe
--   10 dígitos  = DDD + 8 dígitos          → doméstico antigo, não mexe
--   13 dígitos  = 55 + DDD + 9 dígitos     → tem código de país, corta
--   12 dígitos  = 55 + DDD + 8 dígitos     → tem código de país, corta
-- Por isso o corte é guardado por `length(d) in (12, 13)`, e é essa guarda —
-- não o `left(d,2) = '55'` — que faz a função ser segura.
create or replace function sentinela_telefone_norm(bruto text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
           when d = ''                                     then null
           when length(d) in (12, 13) and left(d, 2) = '55' then substr(d, 3)
           else d
         end
  from (select regexp_replace(coalesce(bruto, ''), '\D', '', 'g') as d) x;
$$;

comment on function sentinela_telefone_norm(text) is
  'DEDUP-SENTINELA-01: telefone reduzido a digitos, com o codigo de pais 55 removido SO em 12/13 digitos. A guarda de comprimento existe porque DDD 55 (RS) e numero domestico legitimo de 11 digitos.';


-- ============================================================================
-- 3. A SELEÇÃO, AGORA DEDUPLICADA
-- ----------------------------------------------------------------------------
-- Muda uma coisa só em relação à 0081: entre linhas do mesmo telefone, sai a
-- mais antiga e as outras não aparecem. Todo o resto (teto por linha no SQL,
-- ordem com desempate por id, limite) é idêntico.
--
-- A CHAVE TEM UM coalesce, E ELE NÃO É DEFENSIVIDADE VAZIA
-- `coalesce(nullif(norm, ''), id::text)`. Se o telefone for nulo ou impossível
-- de normalizar, a chave vira o próprio id — logo a linha só é duplicata de si
-- mesma. Sem isso, TODAS as linhas sem telefone colapsariam numa só, e o
-- Sentinela engoliria pessoas diferentes em silêncio. Hoje isso não acontece
-- (0 nulos, medido), mas o custo de errar aqui é sumir com lead sem aviso, e o
-- custo de prevenir é uma linha.
create or replace function sentinela_a_tocar(limite int default 15)
returns table (
  id               uuid,
  conversa_site_id uuid,
  wa_conversa_id   uuid,
  nome             text,
  telefone         text,
  status           text,
  tentativas       int,
  max_toques       smallint,
  ultimo_envio_em  timestamptz,
  proximo_toque_em timestamptz
)
language sql
stable
set search_path = public
as $$
  with elegiveis as (
    select f.*,
           coalesce(nullif(sentinela_telefone_norm(f.telefone), ''), f.id::text) as chave
    from sentinela_fila f
    where f.status in ('pendente', 'aguardando_template', 'enviado')
      and f.tentativas < f.max_toques
      and (f.proximo_toque_em is null or f.proximo_toque_em <= now())
  ),
  vencedoras as (
    select distinct on (chave) *
    from elegiveis
    order by chave, criado_em, id
  )
  select v.id, v.conversa_site_id, v.wa_conversa_id, v.nome, v.telefone,
         v.status::text, v.tentativas, v.max_toques,
         v.ultimo_envio_em, v.proximo_toque_em
  from vencedoras v
  order by v.criado_em, v.id
  limit greatest(coalesce(limite, 0), 0);
$$;

comment on function sentinela_a_tocar(int) is
  'SENTINELA-RADAR-01 + DEDUP-SENTINELA-01: linhas elegiveis a toque AGORA, com teto por linha E deduplicacao por telefone normalizado, ambos no SQL. Entre linhas do mesmo telefone vence a mais antiga (criado_em, desempate por id). Deduplicar depois do LIMIT faria a linha descartada gastar vaga da janela.';


-- ============================================================================
-- 4. O TOTAL ELEGÍVEL — o conserto do log que mentia
-- ----------------------------------------------------------------------------
-- O log de `varredura_ok` gravava `aguardando_template: 15` enquanto a fila
-- tinha 21 vivas e 27 elegíveis. Não havia lead invisível: 15 é o LIMIT da
-- página, gravado como se fosse população. Foi lendo esse campo que o agente do
-- Console concluiu "situação normal" — diagnóstico errado nasce assim, de
-- número ambíguo em log, não de má-fé.
--
-- Esta função devolve a população REAL, já deduplicada, sem limite. A rota
-- passa a gravar dois campos NOMEADOS — `elegiveis_total` e
-- `tratados_nesta_pagina` — e nenhum número solto que precise de adivinhação
-- para ser lido.
--
-- Conta DISTINCT sobre a mesma chave da seção 3, de propósito: se contasse
-- linhas, diria 27 enquanto a seleção entregaria 26, e o log voltaria a mentir
-- por outro caminho.
create or replace function sentinela_elegiveis_total()
returns integer
language sql
stable
set search_path = public
as $$
  select count(distinct coalesce(nullif(sentinela_telefone_norm(f.telefone), ''),
                                 f.id::text))::int
  from sentinela_fila f
  where f.status in ('pendente', 'aguardando_template', 'enviado')
    and f.tentativas < f.max_toques
    and (f.proximo_toque_em is null or f.proximo_toque_em <= now());
$$;

comment on function sentinela_elegiveis_total() is
  'DEDUP-SENTINELA-01: quantas PESSOAS estao elegiveis a toque agora, ja deduplicadas. Existe para o log parar de gravar o LIMIT da pagina como se fosse a populacao.';


-- ============================================================================
-- 5. BACKFILL — fechar as perdedoras que já existem, com motivo nomeado
-- ----------------------------------------------------------------------------
-- Sem este passo a linha perdedora ficaria viva em 'aguardando_template' para
-- sempre, filtrada pela função e nunca tocada: um estado invisível, que é a
-- família de defeito que esta casa mais paga caro. Fechar com nome deixa a
-- decisão legível no banco.
--
-- POPULAÇÃO DIFERENTE DA SEÇÃO 3, DE PROPÓSITO: aqui NÃO entra a condição de
-- `proximo_toque_em`. Uma linha agendada para daqui a 72h continua sendo a
-- mesma pessoa da outra linha — o horário é porta de tempo, não de identidade.
-- Consequência, e ela é a desejada: quem vence a decisão PERMANENTE é sempre a
-- linha mais antiga, que é literalmente o que a ordem pediu.
--
-- Sem id fixo no corpo (CLAUDE.md — migração de dado não cita id gerado). O
-- recorte é a regra, não a linha; reaplicar em outro banco acerta o alvo de lá.
with ranqueadas as (
  select f.id,
         row_number() over (
           partition by coalesce(nullif(sentinela_telefone_norm(f.telefone), ''),
                                 f.id::text)
           order by f.criado_em, f.id
         ) as pos
  from sentinela_fila f
  where f.status in ('pendente', 'aguardando_template', 'enviado')
    and f.tentativas < f.max_toques
)
update sentinela_fila s
   set status = 'duplicado_telefone'
  from ranqueadas r
 where s.id = r.id
   and r.pos > 1;


-- ============================================================================
-- 6. GRANTS — CLAUDE.md, Regra 1, com o mesmo desvio declarado da 0081
-- ----------------------------------------------------------------------------
-- Mais apertado que o padrão: a regra concede EXECUTE a `authenticated`, e aqui
-- não. Estas funções leem telefone de lead parado e existem para o cron, que
-- fala com o banco pela service key. Nenhum usuário logado tem motivo para
-- chamá-las. Fechar também a porta de `authenticated` não contraria o objetivo
-- da Regra 1 (fechar o `anon` aberto por default privilege) — vai além dele.
revoke all on function public.sentinela_telefone_norm(text)  from public, anon, authenticated;
revoke all on function public.sentinela_a_tocar(int)         from public, anon, authenticated;
revoke all on function public.sentinela_elegiveis_total()    from public, anon, authenticated;

grant execute on function public.sentinela_telefone_norm(text) to service_role;
grant execute on function public.sentinela_a_tocar(int)        to service_role;
grant execute on function public.sentinela_elegiveis_total()   to service_role;
