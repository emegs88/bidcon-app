-- ============================================================================
-- 0087_sentinela_falhas_consecutivas — TENTATIVAS-01
-- AUTORIZADO: Emerson, 19/08/2026 ("coluna falhas_consecutivas (zera no sucesso,
-- incrementa na falha), teto proprio -> status erro_permanente com motivo.
-- File-first, ensaiada. Preserva 'falha nao gasta toque' E fecha o laco eterno").
--
-- NAO APLICADA. Este arquivo nasce antes do apply, e o apply e' da coordenacao,
-- sob ordem nominal.
--
-- Quem for aplicar precisa saber ANTES de rodar: Postgres recusa USAR um valor
-- de enum na mesma transacao em que ele e' criado ("unsafe use of new value of
-- enum type", 55P03). A SECAO 1 usa 'erro_permanente' no corpo da vigia. Se o
-- executor envolver o arquivo inteiro num BEGIN/COMMIT — que e' o que quase todo
-- cliente faz — estoura. Por isso o apply e' partido, igual 0081 e 0086:
--
--   0087a — so' a SECAO 0 (o `alter type ... add value`), commitada.
--   0087b — todo o resto: colunas, constraints, comments, funcoes, grants.
--
-- O arquivo continua unico no repo de proposito: partir em dois arquivos faria
-- a numeracao mentir sobre quantas migracoes existem.
-- ----------------------------------------------------------------------------
-- O DEFEITO QUE ESTA MIGRACAO FECHA
--
-- `sentinela_fila.tentativas` NAO conta tentativas. Conta SUCESSOS. Medido na
-- rota, em tres linhas que so' fazem sentido juntas:
--
--   varredura/route.ts:431   const toque = f.tentativas + 1;
--   varredura/route.ts:484     tentativas: toque,      <- so' no ramo `envio.ok`
--   varredura/route.ts:499   log(f.id, "envio_falha")  <- nao escreve tentativas
--
-- A prova de campo: em 19/08 as 09h a rota fez 15 chamadas reais a' Meta, todas
-- recusadas com #132001 (o template estava aprovado na WABA morta). As 15 linhas
-- terminaram o ciclo com tentativas = 0. Quinze conversas com a Meta, zero toques
-- contabilizados.
--
-- Isso e' METADE correto e por isso e' perigoso. A metade correta e' deliberada e
-- fica: falha nao pode gastar toque, senao um problema nosso (template errado,
-- WABA errada, rede) consome a paciencia do cliente. A metade quebrada e' o laco:
--
--   varredura/route.ts:309   f.tentativas >= tetoDe(f)
--
-- A saida da fila depende de um contador que a falha nunca move. Uma linha que
-- falha SEMPRE nunca chega ao teto, nunca sai, e volta em toda varredura ate' o
-- fim dos tempos — ocupando vaga na janela de 15 e empurrando para tras quem
-- podia ser atendido. Nao e' hipotese: e' o que as 15 de 09h fariam para sempre
-- se a WABA nao tivesse sido consertada as 11h45.
--
-- ----------------------------------------------------------------------------
-- POR QUE UM SEGUNDO CONTADOR, E NAO UM CONSERTO NO PRIMEIRO
--
-- Fazer `tentativas` contar falhas resolveria o laco e quebraria a regra boa:
-- falha voltaria a gastar toque. Os dois numeros medem coisas diferentes e
-- precisam de duas colunas:
--
--   tentativas ............ quantas vezes FALAMOS com a pessoa. Teto: max_toques.
--                           Governa a paciencia do cliente.
--   falhas_consecutivas ... quantas vezes tentamos e o canal recusou. Teto:
--                           max_falhas. Governa a saude do sistema.
--
-- CONSECUTIVAS, nao acumuladas: zera no sucesso. Uma linha que falha, falha,
-- funciona e falha de novo esta' viva — o canal oscila. Uma que falha tres vezes
-- seguidas tem defeito proprio, e insistir nela e' gastar janela sem entregar
-- nada. Contador acumulado condenaria a primeira junto com a segunda.
--
-- ----------------------------------------------------------------------------
-- POR QUE 'erro_permanente' E NAO O 'erro' QUE JA EXISTE
--
-- O enum ja' tem 'erro'. Medido: ZERO linhas o carregam e NENHUM ponto do codigo
-- o escreve (`grep` em app/api/sentinela retorna so' comentarios). E' valor morto,
-- herdado, e o nome nao diz nada — a mesma ambiguidade que fez 'esgotado' virar
-- 'encerrado_por_silencio' na 0081. 'erro_permanente' diz o que aconteceu (o
-- canal recusou N vezes seguidas) e o que deixa de acontecer (nao volta sozinho).
--
-- Esta migracao NAO remove 'erro'. Remover valor de enum em Postgres exige
-- recriar o tipo, e recriar tipo em producao para apagar um valor que ninguem
-- escreve e' risco sem premio. Fica registrado como morto — se alguem um dia
-- encontrar uma linha em 'erro', ela veio de fora deste codigo.
--
-- ----------------------------------------------------------------------------
-- O QUE ESTA MIGRACAO NAO FAZ, E POR QUE
--
-- 1. Nao move NENHUMA linha para 'erro_permanente'. Hoje a fila tem 33 linhas,
--    nenhuma com historico de falha consecutiva registrado — a coluna esta'
--    nascendo agora. Marcar alguem exigiria inventar o passado.
--
-- 2. Nao escreve o incremento nem o zeramento. Isso e' da rota, e vem na mesma
--    fatia, DEPOIS. O contrato que a rota tem de cumprir esta' no comment de
--    cada coluna, para que quem ler o banco sozinho saiba o que esperar.
--
-- 3. Nao mexe em `tentativas`, `max_toques`, nem no comportamento de "falha nao
--    gasta toque". Esse e' o ponto: a regra boa fica intacta.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECAO 0 — 0087a. So' isto, commitado, ANTES da secao 1.
-- IF NOT EXISTS porque migracao tem de poder rodar duas vezes sem quebrar (o
-- apply por MCP pode dar timeout com commit — CLAUDE.md, Regra 3).
-- ----------------------------------------------------------------------------
alter type sentinela_status add value if not exists 'erro_permanente';

-- ----------------------------------------------------------------------------
-- SECAO 1 — 0087b. Depende do commit da secao 0.
-- ----------------------------------------------------------------------------

-- 1. O contador de falhas.
alter table sentinela_fila
  add column if not exists falhas_consecutivas integer not null default 0;

alter table sentinela_fila
  drop constraint if exists sentinela_fila_falhas_nao_negativas;
alter table sentinela_fila
  add constraint sentinela_fila_falhas_nao_negativas
  check (falhas_consecutivas >= 0);

comment on column sentinela_fila.falhas_consecutivas is
  'TENTATIVAS-01: falhas de envio SEGUIDAS nesta linha. CONTRATO DA ROTA: zera (=0) em envio_ok, incrementa (+1) em envio_falha. NAO e'' irmao de tentativas — tentativas conta SUCESSOS e governa a paciencia do cliente; esta conta recusas do canal e governa a saude do sistema. Ao atingir max_falhas a linha vai para status erro_permanente.';

-- 2. O teto proprio, por linha — mesmo desenho de max_toques (0081): teto que
--    mora na linha, nao constante na rota, porque populacoes diferentes merecem
--    tratamento diferente e mudar isso nao pode exigir deploy.
--
--    3 e' o default porque duas falhas seguidas ainda podem ser oscilacao de rede
--    ou janela da Meta; a terceira ja' e' padrao. Zero seria condenar sem tentar.
--    Teto acima de 5 e' insistencia disfarcada de tolerancia.
alter table sentinela_fila
  add column if not exists max_falhas smallint not null default 3;

alter table sentinela_fila
  drop constraint if exists sentinela_fila_max_falhas_faixa;
alter table sentinela_fila
  add constraint sentinela_fila_max_falhas_faixa
  check (max_falhas between 1 and 5);

comment on column sentinela_fila.max_falhas is
  'TENTATIVAS-01: teto de falhas consecutivas DESTA linha. Default 3. Faixa 1..5. Irmao de max_toques em desenho e em motivo: teto que mora na linha nao exige deploy para mudar.';

-- 3. O motivo. Emerson pediu "status erro_permanente COM MOTIVO", e motivo que
--    so' vive no sentinela_log obriga quem le' a fila a fazer juncao para saber
--    por que a linha parou. Fica na linha, escrito a cada falha (nao so' na
--    ultima), porque o valor de diagnostico esta' em ver a ultima recusa mesmo
--    numa linha que ainda nao chegou ao teto.
alter table sentinela_fila
  add column if not exists ultimo_erro text;

comment on column sentinela_fila.ultimo_erro is
  'TENTATIVAS-01: texto da ULTIMA recusa de envio. CONTRATO DA ROTA: grava em envio_falha, limpa (NULL) em envio_ok. Quando status = erro_permanente, este e'' o motivo da parada. Nao substitui sentinela_log — o log guarda a serie, esta coluna guarda o estado.';

-- ----------------------------------------------------------------------------
-- 4. O TETO NOVO ENTRA NA SELECAO — desvio declarado, alem da ordem literal.
--
-- A ordem pedia coluna + teto + status. Nao pedia mexer nas duas RPC. Mexo, e o
-- motivo e' o mesmo que a 0081 escreveu quando tirou a selecao da rota: "com o
-- filtro no SQL, quem nao pode ser tocado nao ocupa vaga."
--
-- A transicao para 'erro_permanente' e' um UPDATE da rota. A rota MORRE — medido
-- hoje, 504 por timeout de 60s as 18:01 UTC, com o 14o envio gravando no mesmo
-- instante do kill. Se o kill cair entre o incremento e a mudanca de status, a
-- linha fica com falhas_consecutivas = max_falhas e status ainda elegivel: o
-- laco eterno que esta migracao veio fechar continuaria aberto, agora com um
-- contador que prova que devia estar fechado.
--
-- Com a clausula abaixo o teto vale mesmo que a escrita do status nunca tenha
-- acontecido. O status vira consequencia legivel, nao condicao de correcao.
--
-- IMPORTANTE — as duas funcoes sao reproduzidas INTEIRAS a partir da definicao
-- viva medida no xtv em 19/08 (dedup por telefone da 0083 incluida). A unica
-- diferenca em cada uma e' a linha `and f.falhas_consecutivas < f.max_falhas`.
-- 'erro_permanente' NAO aparece aqui: o `where` ja' e' lista branca de tres
-- status, entao o valor novo esta' excluido por construcao — e por isso estas
-- duas funcoes nao dependem do commit da secao 0, so' das colunas acima.
-- ----------------------------------------------------------------------------
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
      and f.falhas_consecutivas < f.max_falhas
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
  'SENTINELA-RADAR-01 + DEDUP-SENTINELA-01 + TENTATIVAS-01: linhas elegiveis a toque AGORA, com os DOIS tetos por linha aplicados no SQL (toques e falhas consecutivas) e dedup por telefone. Desempate por id porque as 21 de 04/08 tem criado_em identico.';

revoke all on function public.sentinela_a_tocar(int) from public, anon, authenticated;
grant execute on function public.sentinela_a_tocar(int) to service_role;

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
    and f.falhas_consecutivas < f.max_falhas
    and (f.proximo_toque_em is null or f.proximo_toque_em <= now());
$$;

comment on function sentinela_elegiveis_total() is
  'DEDUP-SENTINELA-01 + TENTATIVAS-01: POPULACAO elegivel agora (pessoas distintas por telefone), com os dois tetos aplicados. Medida separada da pagina: o array de sentinela_a_tocar responde "quantas couberam", nunca "quantas existem".';

revoke all on function public.sentinela_elegiveis_total() from public, anon, authenticated;
grant execute on function public.sentinela_elegiveis_total() to service_role;

-- ----------------------------------------------------------------------------
-- 5. A VIGIA — CLAUDE.md, Regra 9: todo zero afirmado precisa de um controle
--    que POSSA disparar.
--
-- Devolve as linhas que bateram no teto de falhas e NAO foram marcadas. Em
-- operacao normal isso e' zero, e o zero e' informativo: significa que a rota
-- esta' fechando o laco que abriu. Deixa de ser zero exatamente no caso que a
-- clausula do item 4 cobre — kill no meio do update.
--
-- ATENCAO A QUEM FOR LER O PRIMEIRO ZERO: no dia do apply esta funcao devolve 0
-- sobre uma coluna que acabou de nascer com todas as linhas em 0. Esse zero NAO
-- prova nada — e' "ninguem falhou ainda", nao "a rota esta' correta". O controle
-- que faz a vigia disparar esta' descrito no cabecalho do PR e depende de ordem
-- para rodar: subir falhas_consecutivas de UMA linha ate' max_falhas, conferir
-- que a vigia devolve 1, e desfazer.
--
-- Nao devolve telefone nem nome. Vigia de saude de sistema nao precisa de dado
-- pessoal para dizer que o sistema esta' doente, e o que nao e' devolvido nao
-- vaza.
-- ----------------------------------------------------------------------------
create or replace function sentinela_falha_sem_marca()
returns table (
  id                  uuid,
  status              text,
  falhas_consecutivas integer,
  max_falhas          smallint,
  ultimo_erro         text,
  ultimo_envio_em     timestamptz
)
language sql
stable
set search_path = public
as $$
  select f.id, f.status::text, f.falhas_consecutivas, f.max_falhas,
         f.ultimo_erro, f.ultimo_envio_em
  from sentinela_fila f
  where f.falhas_consecutivas >= f.max_falhas
    and f.status <> 'erro_permanente'
  order by f.falhas_consecutivas desc, f.ultimo_envio_em nulls last;
$$;

comment on function sentinela_falha_sem_marca() is
  'TENTATIVAS-01, vigia da Regra 9: linhas que atingiram max_falhas e NAO estao em erro_permanente. Zero e'' o esperado em operacao normal; nao-zero significa que a rota morreu entre o incremento e a marcacao. Nao devolve telefone nem nome de proposito.';

-- CLAUDE.md, Regra 1 — com o mesmo desvio mais apertado que a 0081 declarou:
-- o rodape da regra concede EXECUTE a `authenticated`, e aqui nao. Esta funcao
-- so' existe para o cron e para o console do Sentinela, que falam com o banco
-- pela service key.
revoke all on function public.sentinela_falha_sem_marca() from public, anon, authenticated;
grant execute on function public.sentinela_falha_sem_marca() to service_role;
