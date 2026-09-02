-- ============================================================================
-- 0093_funil_01.sql — FUNIL-01, F2 (nove itens)
-- AUTORIZADO: coordenação — OS FUNIL-01, "F2 consolidada", 31/08/2026.
--             Item (i) por palavra do Emerson, 31/08/2026.
-- ----------------------------------------------------------------------------
-- ESCOPO: xtv-only (xtvjpnyadcdeadhmzyff). O irmão `platform/supabase/
-- migrations-nnv/` NÃO recebe nada desta fatia, e isso é medição, não estilo:
-- `to_regclass('public.captacoes')` e `to_regclass('public.interesses')`
-- devolvem NULO no nnv (medido 31/08/2026, com régua positiva em
-- `public.processos` e isca em `zzz_tabela_que_nao_existe`). As duas mesas do
-- funil só existem aqui.
--
-- O NÚMERO 0093 SAIU DO LEDGER, NÃO DO DIRETÓRIO — a mesma doutrina que a 0092
-- escreveu no próprio cabeçalho. Medido em supabase_migrations.schema_migrations
-- do xtv: a última é `20260829014619 · 0092_radar_conteudo_vazio`. E medido em
-- `origin/main` pelo número: 0088, 0089, 0091 e 0092 têm arquivo aqui; 0090 tem
-- N=0 (está APLICADA nos dois bancos e o arquivo vive só no ramo aberto
-- `regra1-semantica-01`); 0093 tem N=0 nos dois — ledger e diretório concordam
-- que está livre.
--
-- ============================================================================
-- O QUE FOI MEDIDO ANTES DE ESCREVER (31/08/2026, 22h)
-- ============================================================================
--
--   captacoes ...... 18 colunas · RLS ON · 0 policies · SEM grant a
--                    anon/authenticated (padrão 0088) · 2 linhas, ambas 'novo'
--   interesses ..... 14 colunas · RLS ON · 3 policies · grants a
--                    anon/authenticated · 57 linhas, TODAS 'novo',
--                    `atendido_por` não-nulo em ZERO delas
--                    `status` é `text not null default 'novo'::text`
--   status ......... text + CHECK NOMEADO nos dois lados. NÃO há enum de funil
--                    (48 labels no xtv, nenhum deles é disto). Logo: um arquivo,
--                    uma transação, e o ensaio `begin/rollback` cobre o arquivo
--                    INTEIRO — não existe aqui o `alter type add value` que
--                    obrigou a 0083 e a 0086 a nascerem partidas.
--   fechamento ..... NENHUMA linha em status de fechamento nos dois lados. Por
--                    isso as constraints do item (g) entram SEM `not valid`:
--                    não há passado para perdoar.
--   funil_operadores  `to_regclass` NULO. Tabela nova.
--
-- ============================================================================
-- OS DOIS LADOS SÃO A MESMA CARTA, E ISSO NÃO É DETALHE
-- ============================================================================
-- `captacoes.aceita` e `interesses.convertido` NÃO são dois nomes do mesmo
-- evento. São as DUAS PERNAS da mesma carta: `aceita` = a casa comprou do
-- cedente; `convertido` = um comprador comprou da casa. Um funil que os
-- fundisse mostraria metade do negócio e chamaria de tudo.
--
-- ============================================================================
-- POR QUE (g) E (h) ANDAM JUNTOS — e nenhum dos dois fecha sozinho
-- ============================================================================
-- (g) sozinho impede que exista venda sem valor e sem data, mas não impede que
--     alguém de fora escreva a linha já fechada.
-- (h) sozinho impede que quem entra pela porta pública nasça fechado, mas não
--     impede que uma linha fique 'convertido' sem número nenhum ao lado.
-- Juntos, a única forma de existir uma venda no banco é alguém de dentro
--     carimbar valor e data — que é exatamente o que o painel do fundo vai ler.
-- Nenhum dos dois é a fechadura: a fechadura são os dois.
--
-- MEDIÇÃO QUE SUSTENTA (h) — e ela desmente uma medição minha mais velha:
-- ninguém insere em `interesses` por `anon`. Os DOIS escritores do repositório
-- (`app/api/interesse/route.ts:72` e `app/api/atende/route.ts:429`) usam
-- `createXtvClient()`, que é service_role e passa por cima de RLS. A policy
-- `interesses_insert_publico WITH CHECK (true)` é porta aberta SEM CONSUMIDOR.
-- Apertá-la não quebra caminho vivo nenhum — e fecha a porta antes de alguém
-- resolver usá-la.
--
-- ============================================================================
-- DESVIOS DECLARADOS EM RELAÇÃO À ORDEM — precedente escrito vence
-- ============================================================================
-- 1. A ordem pede `fechado_valor numeric`. Aqui é `numeric(14,2)`, porque é
--    assim que `captacoes.credito`, `captacoes.saldo_devedor` e
--    `captacoes.proposta_valor` já são na 0088. Dinheiro nesta casa tem escala.
-- 2. A ordem pede `grant all` a `service_role` em `funil_operadores`. A 0088
--    NÃO concede nada a service_role (ele já passa por cima de RLS), e a própria
--    ordem manda seguir o padrão 0088 nos grants. Fica só o `revoke`.
-- 3. Os itens estão na ordem de DEPENDÊNCIA, não na ordem alfabética: (a), (i)
--    e (g) mexem no vocabulário e nas colunas que (c) lê e que (h) exige. Os
--    nove rótulos `-- ITEM (x)` estão todos aqui; só a sequência muda.
--
-- ============================================================================
-- O QUE ESTA MIGRATION NÃO FAZ
-- ============================================================================
-- Não cria rota, não cria tela, não escreve uma linha de dado, não faz backfill
-- (Regra 19). Não toca os grants de DELETE/UPDATE/TRUNCATE que `interesses` tem
-- para anon/authenticated — eles são inertes hoje e viram fatia própria
-- (INTERESSES-GRANTS-01). Não toca `captacoes_wa_conversa_idx`, que continua
-- existindo ao lado do índice novo. Não mexe em `fidc_*` nem em `/fundo`.
-- A 0093 toca a policy de insert, e só ela.
-- ============================================================================


-- ############################################################################
-- ITEM (a) — AS TRÊS COLUNAS DE OPERAÇÃO, NOS DOIS LADOS
-- ############################################################################
-- `dono` é gente DA CASA, nunca o cliente. Nulo = ninguém pegou ainda, e nulo é
-- o estado normal de um lead recém-chegado — por isso sem default.
-- `ultimo_contato_em` é o relógio do abandono: é dele que sai `parado_horas`.

alter table captacoes
  add column if not exists dono              text,
  add column if not exists proxima_acao      text,
  add column if not exists ultimo_contato_em timestamptz;

alter table interesses
  add column if not exists dono              text,
  add column if not exists proxima_acao      text,
  add column if not exists ultimo_contato_em timestamptz;


-- ############################################################################
-- ITEM (i) — A ESCADA DO COMPRADOR GANHA DOIS DEGRAUS
-- ############################################################################
-- Palavra do Emerson, 31/08/2026, em resposta à pergunta que a medição levantou:
-- o comprador saltava de "qualificado" direto para "comprou", e o nnv mostra o
-- contrário (2 reservadas e 1 em análise na administradora, agora mesmo).
--
-- Espelho RESUMIDO de `nnv.processos`, e o resumo é declarado:
--     reservada                                        -> reservado
--     documentacao | analise_administradora | transferencia -> em_processo
-- Dois degraus, não quatro: o funil da mesa não é o rastreador do processo. Quem
-- quiser o grau fino olha o nnv.
--
-- Mesma mecânica re-executável do (g): check nomeado se troca com duas linhas.
-- As 57 linhas de hoje são todas 'novo' — nada viola, e por isso sem `not valid`.

alter table interesses drop constraint if exists interesses_status_check;
alter table interesses add  constraint interesses_status_check
  check (status in ('novo', 'em_atendimento', 'reservado',
                    'em_processo', 'convertido', 'descartado'));


-- ############################################################################
-- ITEM (g) — FECHAR COM VALOR, OU NÃO FECHAR
-- ############################################################################
-- Gêmeo declarado de `captacoes_proposta_tem_valor` (0088): "se o status diz que
-- aconteceu, tem que existir o número". Aqui com uma trava a mais que lá — a
-- data — porque um painel de "o que vendemos" sem QUANDO não responde nada.
--
-- SEM `not valid`, e isto foi medido: zero linhas em 'aceita' e zero em
-- 'convertido' nos dois lados. Constraint que nasce `not valid` é constraint que
-- promete e não cumpre até alguém lembrar de validar.

alter table captacoes
  add column if not exists fechado_em    timestamptz,
  add column if not exists fechado_valor numeric(14,2);

alter table interesses
  add column if not exists fechado_em    timestamptz,
  add column if not exists fechado_valor numeric(14,2);

-- Check nomeado é trocável com duas linhas re-executáveis — a razão que a 0088
-- deu para preferir check a enum vale aqui também.
alter table captacoes drop constraint if exists captacoes_fechado_valor_positivo;
alter table captacoes add  constraint captacoes_fechado_valor_positivo
  check (fechado_valor is null or fechado_valor > 0);

alter table interesses drop constraint if exists interesses_fechado_valor_positivo;
alter table interesses add  constraint interesses_fechado_valor_positivo
  check (fechado_valor is null or fechado_valor > 0);

-- A casa COMPROU do cedente.
alter table captacoes drop constraint if exists captacoes_aceita_tem_fechamento;
alter table captacoes add  constraint captacoes_aceita_tem_fechamento
  check (status <> 'aceita'
         or (fechado_em is not null and fechado_valor is not null));

-- Um comprador COMPROU da casa.
alter table interesses drop constraint if exists interesses_convertido_tem_fechamento;
alter table interesses add  constraint interesses_convertido_tem_fechamento
  check (status <> 'convertido'
         or (fechado_em is not null and fechado_valor is not null));


-- ############################################################################
-- ITEM (b) — UM CEDENTE VIVO POR CONVERSA
-- ############################################################################
-- Parcial, e a parcialidade é copiada de `captacoes_origem_chave_key` (0088):
-- uma captação PERDIDA ou RECUSADA não pode bloquear a mesma pessoa de voltar
-- meses depois pela mesma conversa. Só os status vivos disputam a chave.
--
-- `captacoes_wa_conversa_idx` (não-único, parcial) CONTINUA existindo: ele serve
-- a busca, este serve a unicidade. Não são o mesmo índice com nomes diferentes.

create unique index if not exists captacoes_wa_conversa_viva_key
  on captacoes (wa_conversa_id)
  where wa_conversa_id is not null
    and status in ('novo', 'em_analise', 'proposta_enviada', 'aceita');


-- ############################################################################
-- ITEM (f) — QUEM SENTA NA MESA
-- ############################################################################
-- Espelha `fidc_fundos` na forma (cadastro simples com suspensão auditável) e
-- diverge dela em QUATRO coisas, todas declaradas com o motivo:
--
--   1. UMA LINHA POR PESSOA, e não `emails_autorizados text[]` como em
--      `fidc_fundos`. Com array não se suspende UM vendedor — só o grupo
--      inteiro. `status='suspenso'` por linha faz a promessa valer.
--   2. SEM `observacao`, pela regra de coluna curta: texto livre é PII até prova
--      em contrário, e `suspenso_motivo` já cobre a única prosa necessária.
--   3. GRANTS pelo padrão 0088. `fidc_fundos` tem grants sobrando para
--      anon/authenticated (herança do default ACL do Supabase). Aqui: RLS
--      ligada, zero policies, revoke explícito. Afrouxar depois é um grant;
--      apertar depois de vazar não é nada.
--   4. CHAVE NATURAL por endereço de contato em minúsculas, e não por CNPJ:
--      operador é pessoa, e pessoa não tem CNPJ.
--
-- Suspender NÃO apaga: a linha fica, com data, autor e motivo. Operador apagado
-- é histórico de negociação sem responsável.

create table if not exists funil_operadores (
  id              uuid        primary key default gen_random_uuid(),

  email           text        not null,
  nome            text,

  status          text        not null default 'ativo',

  criado_em       timestamptz not null default now(),
  criado_por      text,

  suspenso_em     timestamptz,
  suspenso_por    text,
  suspenso_motivo text,

  constraint funil_operadores_status_sano
    check (status in ('ativo', 'suspenso')),

  -- Irmã das travas do item (g): se o status diz suspenso, tem que existir
  -- QUANDO. Suspensão sem data não é auditoria, é boato.
  constraint funil_operadores_suspenso_tem_data
    check (status <> 'suspenso' or suspenso_em is not null)
);

-- `lower()` no índice e não na coluna: guarda como a pessoa digitou, compara
-- sem diferença de caixa. Duas grafias do mesmo operador é como
-- `administradoras_grafias_orfas` (0085) nasceu.
create unique index if not exists funil_operadores_email_key
  on funil_operadores (lower(email));

create index if not exists funil_operadores_ativo_idx
  on funil_operadores (criado_em desc) where status = 'ativo';

alter table funil_operadores enable row level security;
revoke all on table public.funil_operadores from anon, authenticated;


-- ############################################################################
-- ITEM (c) — A VISTA · ITEM (d) — O MAPA DE ETAPAS · ITEM (e) — A FECHADURA
-- ############################################################################
-- ITEM (c): ALLOWLIST POSITIVA DE 19 COLUNAS. Não é `select *` com exclusões:
-- é lista fechada, escrita à mão. Coluna nova nas mesas de baixo NÃO aparece
-- aqui sozinha — tem que ser posta, de propósito, por alguém.
-- FICAM DE FORA SEMPRE, e nenhuma delas é acidente: `observacao` e `mensagem`
-- (texto livre onde já se sabe que cabe qualquer coisa), `snapshot` (retrato
-- inteiro da carta), o endereço de contato eletrônico, `origem_chave` (chave de
-- idempotência, não é dado de negócio) e qualquer conteúdo de `wa_mensagens`.
-- A TRAVA de "só estas 19, e nem uma a mais" é da F5, trava 4, no mecanismo
-- `TIPOS_RADAR` — um teste que quebra se alguém acrescentar coluna. Aqui a
-- lista é escrita à mão e mais nada; o verificador de hoje prova que as 19
-- ESTÃO, não que são só elas.
--
-- ITEM (d): O MAPA SAIU DOS CHECKS MEDIDOS, não de uma lista desejada. E a
-- ETAPA É CHAVE ASCII, não rótulo de tela: a view devolve DADO, e chave
-- acentuada é frágil em `where`, em `order by` e em teste. Quem põe acento é a
-- F4, na hora de desenhar. Mesma regra do `comment on`, estendida ao valor.
--
--   cedente (captacoes, 6 status)      comprador (interesses, 6 status)
--     novo             -> entrada        novo            -> entrada
--     em_analise       -> documentacao   em_atendimento  -> qualificacao
--     proposta_enviada -> proposta       reservado       -> documentacao
--     aceita           -> fechado_compra em_processo     -> minuta
--     recusada         -> fechado_sem    convertido      -> fechado_venda
--     perdida          -> fechado_sem    descartado      -> fechado_sem
--
--   A etapa `proposta` fica VAZIA para o comprador, e isto é honesto: comprador
--   não recebe proposta, ele reserva. Degrau inventado para preencher coluna de
--   painel é exatamente a promessa que esta casa não faz.
--
--   O `else` existe para o dia em que alguém acrescentar um status ao check e
--   esquecer desta vista: em vez de sumir do painel em silêncio, a linha aparece
--   gritando o status que não está no mapa. Barulho vale mais que buraco.
--
-- ITEM (e): `security_invoker` (padrão da 0064) para a vista não virar porta dos
-- fundos com os poderes de quem a criou.

drop view if exists public.vw_funil;

create or replace view public.vw_funil
with (security_invoker = true) as

  select
    'captacoes'::text as origem_tabela,
    c.id as id,
    'cedente'::text as lado,
    c.nome as nome,
    c.telefone as telefone,
    case c.status
      when 'novo'             then 'entrada'
      when 'em_analise'       then 'documentacao'
      when 'proposta_enviada' then 'proposta'
      when 'aceita'           then 'fechado_compra'
      when 'recusada'         then 'fechado_sem'
      when 'perdida'          then 'fechado_sem'
      else 'fora_do_mapa:' || c.status
    end as etapa,
    c.administradora as administradora,
    c.credito as credito,
    c.saldo_devedor as saldo_devedor,
    c.parcelas_pagas as parcelas_pagas,
    c.dono as dono,
    c.proxima_acao as proxima_acao,
    c.ultimo_contato_em as ultimo_contato_em,
    c.fechado_em as fechado_em,
    c.fechado_valor as fechado_valor,
    c.wa_conversa_id as wa_conversa_id,
    c.criado_em as criado_em,
    c.atualizado_em as atualizado_em,
    -- Negócio fechado não está parado. Sem este nulo, o filtro "o que está
    -- esperando" teria que descontar o histórico inteiro toda vez.
    case when c.status in ('aceita', 'recusada', 'perdida') then null::int
         else (extract(epoch from (now() - coalesce(c.ultimo_contato_em, c.criado_em)))
                 / 3600)::int
    end as parado_horas
  from public.captacoes c

  union all

  -- O lado do comprador não tem as quatro colunas da cota nem conversa de
  -- WhatsApp ligada. Entram NULAS e TIPADAS: `union all` sem tipo explícito
  -- resolve para `text` e o painel passaria a comparar dinheiro como string.
  select
    'interesses'::text,
    i.id,
    'comprador'::text,
    i.nome,
    i.telefone,
    case i.status
      when 'novo'           then 'entrada'
      when 'em_atendimento' then 'qualificacao'
      when 'reservado'      then 'documentacao'
      when 'em_processo'    then 'minuta'
      when 'convertido'     then 'fechado_venda'
      when 'descartado'     then 'fechado_sem'
      else 'fora_do_mapa:' || i.status
    end,
    null::text,
    null::numeric(14,2),
    null::numeric(14,2),
    null::integer,
    i.dono,
    i.proxima_acao,
    i.ultimo_contato_em,
    i.fechado_em,
    i.fechado_valor,
    null::uuid,
    i.criado_em,
    i.atualizado_em,
    case when i.status in ('convertido', 'descartado') then null::int
         else (extract(epoch from (now() - coalesce(i.ultimo_contato_em, i.criado_em)))
                 / 3600)::int
    end
  from public.interesses i
;

-- Cinto além do suspensório, e com motivo forte: a vista junta nome e telefone
-- de pessoa física dos DOIS lados numa consulta só. `security_invoker` já barra;
-- o revoke garante que uma policy distraída amanhã não abra a mesa inteira.
revoke all on public.vw_funil from anon, authenticated;
grant select on public.vw_funil to service_role;


-- ############################################################################
-- ITEM (h) — A PORTA PÚBLICA PARA DE ACEITAR QUALQUER COISA
-- ############################################################################
-- ANTES:  interesses_insert_publico · INSERT · anon, authenticated · CHECK (true)
-- DEPOIS: a mesma porta, mas quem entra por ela nasce CRU — 'novo', sem dono,
--         sem próxima ação, sem contato registrado, sem fechamento e sem
--         atendente. Tudo que vale dinheiro ou responsabilidade passa a exigir
--         mão de dentro.
--
-- Isto NÃO quebra caminho vivo: medido, os dois escritores desta mesa usam
-- service_role e não passam por policy nenhuma. É uma porta aberta que ninguém
-- usa sendo fechada antes de alguém achar a maçaneta.
--
-- E o `status = 'novo'` não recusa quem omite a coluna: medido, `interesses`
-- tem `status text not null default 'novo'::text`, e o default é aplicado ANTES
-- do WITH CHECK. A rota ainda manda 'novo' explícito por cima disso.

drop policy if exists interesses_insert_publico on public.interesses;

create policy interesses_insert_publico
  on public.interesses
  for insert
  to anon, authenticated
  with check (
    status            =  'novo'
    and dono              is null
    and proxima_acao      is null
    and ultimo_contato_em is null
    and fechado_em        is null
    and fechado_valor     is null
    and atendido_por      is null
  );


-- ############################################################################
-- COMENTÁRIOS (ASCII puro, como a 0088 e a 0092)
-- ############################################################################

comment on view public.vw_funil is
  'FUNIL-01 (c): as duas pernas do funil numa mesa so. Allowlist POSITIVA de 19 colunas escrita a mao - coluna nova nas tabelas de baixo NAO aparece aqui sozinha. Ficam de fora sempre: texto livre, retrato da carta, contato eletronico, chave de idempotencia e conteudo de conversa. A etapa e CHAVE ASCII, nao rotulo de tela: quem poe acento e a tela. security_invoker ligado.';

comment on table funil_operadores is
  'FUNIL-01 (f): quem da casa pode sentar na mesa do funil. Uma linha por pessoa (e nao array) para poder suspender UM sem suspender o grupo. Suspender nao apaga - fica data, autor e motivo. RLS ligada com zero policies e revoke explicito (padrao 0088).';

comment on column captacoes.dono is
  'FUNIL-01 (a): pessoa DA CASA responsavel por esta linha. Nunca o cliente. Nulo = ninguem pegou ainda.';

comment on column captacoes.ultimo_contato_em is
  'FUNIL-01 (a): relogio do abandono. E dele que sai parado_horas na vw_funil - que fica NULO quando o negocio ja fechou.';

comment on column captacoes.fechado_valor is
  'FUNIL-01 (g): quanto a casa efetivamente pagou ao cedente. Obrigatorio junto com fechado_em quando status = aceita. Sem backfill: linha antiga fica nula.';

comment on column interesses.fechado_valor is
  'FUNIL-01 (g): quanto o comprador efetivamente pagou a casa. Obrigatorio junto com fechado_em quando status = convertido. E a unica origem honesta de um painel de vendas.';

comment on column interesses.status is
  'FUNIL-01 (i): seis degraus. reservado e em_processo entraram por palavra do Emerson 31/08/2026 - espelho resumido de nnv.processos (reservada; documentacao/analise_administradora/transferencia). O comprador nao passa por proposta: ele reserva.';
