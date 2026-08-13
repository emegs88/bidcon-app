-- ============================================================================
-- 0078_fidc_ofertas.sql — FIDC-OFERTAS-01, Entrega 1 (o modelo)
-- PROJETO: xtv (xtvjpnyadcdeadhmzyff). NAO rodar na nnv.
-- AUTORIZADO: Emerson Gomes dos Santos — OS "FIDC-OFERTAS-01" (12/08/2026):
--   "painel para fundo fazer ofertas nas cartas ... em lote ... FIDC oferece
--    desagio; ofertas validas 24 horas"
-- E pela DECISAO de coordenacao do mesmo dia:
--   "fidc_fundos, fidc_ofertas e fidc_oferta_itens nascem no XTV, junto das
--    cartas. Motivo: a integridade que NAO pode ser por convencao e a da oferta
--    com a carta — aceite e dinheiro dependem de FK real para cartas(id), e FK
--    entre bancos nao existe. ... Nenhuma tabela FIDC no nnv."
--
-- EMENDA de 12/08/2026, ANTES DE APLICAR — Emerson fechou as decisoes (1) e (3):
--   "a oferta e SEMPRE entre 20% (piso) e 35% (teto) DO VALOR DO CREDITO."
--
-- Isto nao e um CHECK mais apertado sobre a coluna que existia: e outra conta.
-- Desagio respondia "quanto se tira da base" — valor = base x (1 - pct/100), com
-- a base ainda por nomear. A regra nova responde "quanto se paga do credito" —
-- valor = valor_credito x pct/100. O sinal e a referencia mudaram, entao a
-- coluna mudou de nome junto: `desagio_pct` e `desagio_base` NAO existem nesta
-- migracao. Existe `oferta_pct_credito`, e a base deixou de ser coluna porque
-- deixou de ser escolha — e sempre o valor do credito.
--
-- A faixa 20–35 esta em DOIS lugares, de proposito e sem redundancia burra:
-- `lib/fidc-ofertas.ts` valida ANTES do insert e devolve erro NOMEADO (a pessoa
-- precisa saber que errou e por que); o CHECK abaixo e a rede — pega o que
-- passar por rota nova, script ou console. Guarda que so existe na aplicacao
-- some no dia em que alguem escreve direto no banco.
-- ----------------------------------------------------------------------------
-- POR QUE ESTAS TRES TABELAS VIVEM AQUI, E NAO NA nnv.
--
-- A casa tem dois bancos, e a medicao de 12/08 mostrou o tamanho da diferenca:
--   nnv  — 29 auth.users, 29 profiles, 55 policies, 2 cartas.  E onde se loga.
--   xtv  — 4 auth.users, 27 policies, 38 tabelas com RLS, 101.156 cartas
--          (2.437 disponiveis).  E onde a vitrine existe de verdade.
--
-- O login mora num banco e a carta mora no outro. Uma oferta e uma promessa de
-- dinheiro sobre UMA carta especifica; se `carta_id` fosse um uuid solto,
-- apontando para outro banco, a unica coisa segurando o aceite seria a boa
-- vontade do codigo. Aqui ele e uma FK de verdade, e o banco recusa a oferta
-- orfa antes de qualquer rota ter chance de errar.
--
-- O PRECO DISSO, DITO NA CARA: nao ha `auth.users` no xtv, entao nao ha como
-- amarrar o fundo a uma sessao por RLS. A autorizacao do fundo e por lista de
-- e-mails em `fidc_fundos.emails_autorizados`, checada na aplicacao, com os
-- dados lidos por service_role em rota de servidor — o mesmo padrao que a casa
-- ja usa em wa_* e farol_*. Foi a troca escolhida pela coordenacao: FK real no
-- que move dinheiro, guarda na aplicacao no que controla acesso.
--
-- RLS: padrao do projeto xtv — `enable row level security` com ZERO policies.
-- Nao e esquecimento e nao e teatro: e a trava de fundo. Todo acesso legitimo
-- vem de service_role, que ignora RLS. Se algum dia uma chave anon vazar para
-- estas tabelas, ela le zero linhas — inclusive as ofertas, que carregam
-- valores comerciais que ninguem de fora tem por que ver.
--
-- ----------------------------------------------------------------------------
-- DUAS DECISOES AINDA ABERTAS — carregadas como PLACEHOLDER NOMEADO.
--
-- Eram quatro. A emenda de 12/08 fechou (1) e (3) de uma vez: a base do desagio
-- deixou de existir como pergunta (e sempre o valor do credito) e o piso de
-- protecao virou a faixa 20–35, com nome de constraint proprio. Sobram:
--
--   (2) COMISSAO DA BIDCON — `fidc_ofertas.comissao_valor` / `comissao_base`.
--       As colunas guardam o RESULTADO; o MODELO que o produz e codigo, e por
--       isso nao esta petrificado aqui. Modelo B, percentual proprio ou embutido
--       cabem todos nestas duas colunas sem nova migracao.
--   (4) QUAL FUNDO ESTREIA — esta migracao NAO insere fundo nenhum. Zero linhas.
--       O primeiro fundo nasce pela mao do Emerson, no painel admin (Entrega 4).
--
-- Enquanto (2) estiver aberta, as duas colunas de comissao aceitam null. Isso e
-- deliberado e tem prazo: no dia em que o modelo for nomeado, elas viram NOT
-- NULL por ALTER, e o ALTER carrega a data da decisao.
--
-- ----------------------------------------------------------------------------
-- DESVIOS QUE EU DECLARO, com o motivo.
--
-- (a) NAO EXISTE COLUNA `carta_ids[]` EM `fidc_ofertas`.
--     A ordem cita "`filtro_lote` jsonb ... ou `carta_ids[]`". Guardar as duas
--     coisas seria manter DUAS listas do mesmo fato: o array na oferta e as
--     linhas em `fidc_oferta_itens`. Duas listas com o mesmo nome divergem na
--     primeira vez que alguem edita uma so — defeito que ja custou uma manha
--     nesta casa (DIAG-CONTAINER-02). Aqui a lista de cartas de uma oferta E a
--     tabela de itens, ponto. `filtro_lote` fica, mas com outro papel: registrar
--     COMO o fundo escolheu (auditoria), nao O QUE foi ofertado.
--
-- (b) `expira_em` NAO E COLUNA GERADA.
--     Eu queria `generated always as (criado_em + interval '24 hours')`, que
--     tornaria as 24 horas uma lei do banco em vez de uma promessa do codigo.
--     Medi antes de escrever: `timestamptz_pl_interval` e STABLE, nao IMMUTABLE
--     (`select provolatile from pg_proc where proname='timestamptz_pl_interval'`
--     devolve 's'), e coluna gerada exige expressao imutavel. A migracao seria
--     recusada no momento de aplicar. Entao: a janela exata vive numa constante
--     unica e nomeada na aplicacao, e o banco garante apenas o que consegue
--     garantir de verdade — que nada expira antes de existir.
--
-- (c) STATUS COMO `text` + CHECK, e nao como ENUM novo.
--     A xtv tem enums antigos (status_carta, tipo_bem), mas as migracoes
--     recentes (0068, 0077) padronizaram `text not null check (... in (...))`.
--     Motivo pratico: acrescentar um estado a um enum em producao e cirurgia;
--     num CHECK e um ALTER de uma linha. Estes tres fluxos vao ganhar estado.
--
-- (d) `emails_autorizados` E UM ARRAY, e nao uma tabela filha.
--     A pergunta que o sistema faz a cada requisicao e "de qual fundo e este
--     e-mail?" — uma leitura, respondida por indice GIN, sem join. A forma
--     normalizada existiria para suportar atributos por e-mail que a ordem nao
--     pede. Custo assumido e declarado: a normalizacao para minusculas e
--     responsabilidade da aplicacao (o CHECK que a imporia precisaria de
--     subconsulta, que CHECK nao aceita). O painel admin grava em minusculas.
--
-- (e) RENOMEEI `fidc_oferta_itens.valor_base` PARA `valor_credito`.
--     A emenda so me mandou matar `desagio_base` em `fidc_ofertas`. Mas o nome
--     "valor_base" existia para apontar PARA aquela coluna — era o retrato da
--     base que o fundo tinha escolhido. Sem escolha de base, "base" nao quer
--     dizer mais nada, e um nome vago no lugar onde se guarda dinheiro e um
--     convite a alguem preencher com o numero errado. Agora o nome diz a coisa:
--     e o valor do credito, fotografado. Custo zero — a migracao nao foi
--     aplicada, entao nao ha ALTER nem dado para migrar. Se a coordenacao
--     preferir o nome antigo, e uma linha.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. fidc_fundos — quem tem permissao de ofertar.
-- ----------------------------------------------------------------------------
-- Fundo NUNCA se auto-cadastra. Nasce pela mao do Emerson, no painel admin.
create table if not exists public.fidc_fundos (
  id                  uuid primary key default gen_random_uuid(),
  nome                text not null,
  cnpj                text not null unique,
  contato_nome        text,
  contato_email       text,
  contato_telefone    text,
  emails_autorizados  text[] not null default '{}',
  status              text not null default 'ativo'
                      check (status in ('ativo', 'suspenso')),
  observacao          text,
  criado_em           timestamptz not null default now(),
  criado_por          text,
  suspenso_em         timestamptz,
  suspenso_por        text,
  suspenso_motivo     text
);

comment on table public.fidc_fundos is
  'FIDC-OFERTAS-01. Fundos habilitados a ofertar sobre cartas da vitrine. Cadastro exclusivamente manual, pelo painel admin — nao ha auto-cadastro em lugar nenhum do fluxo.';
comment on column public.fidc_fundos.cnpj is
  'Somente digitos, normalizado pela aplicacao. UNIQUE: um CNPJ e um fundo. Duas linhas para o mesmo fundo dariam duas listas de e-mail autorizadas e nenhuma delas seria a verdadeira.';
comment on column public.fidc_fundos.emails_autorizados is
  'Lista de e-mails que podem entrar em /fidc como este fundo. Comparacao case-insensitive; a aplicacao grava em minusculas (ver desvio (d) no cabecalho). Vazio = fundo cadastrado que ainda nao pode entrar — estado legitimo e proposital.';
comment on column public.fidc_fundos.status is
  'ativo | suspenso. Suspenso nao apaga historico: as ofertas passadas continuam de pe e auditaveis; o que para e a entrada e a criacao de oferta nova.';
comment on column public.fidc_fundos.criado_por is
  'E-mail da sessao admin (BIDCON_ADMIN_EMAILS) que cadastrou. Nunca vem do cliente. Nulo tolerado para linhas nascidas antes de a rota existir.';
comment on column public.fidc_fundos.suspenso_motivo is
  'Por que foi suspenso, em texto livre. Suspender sem dizer por que e uma decisao que ninguem consegue revisar depois.';

create index if not exists fidc_fundos_emails_idx
  on public.fidc_fundos using gin (emails_autorizados);
-- Responde a unica pergunta quente do login do fundo: "de qual fundo e este
-- e-mail?" — `where lower($1) = any(emails_autorizados)`.

create index if not exists fidc_fundos_status_idx
  on public.fidc_fundos (status) where status = 'ativo';

alter table public.fidc_fundos enable row level security;
-- zero policies de proposito — ver cabecalho.


-- ----------------------------------------------------------------------------
-- 2. fidc_ofertas — a proposta, com prazo.
-- ----------------------------------------------------------------------------
create table if not exists public.fidc_ofertas (
  id                    uuid primary key default gen_random_uuid(),
  fundo_id              uuid not null
                        references public.fidc_fundos(id) on delete restrict,
  escopo                text not null check (escopo in ('carta', 'lote')),
  filtro_lote           jsonb,
  oferta_pct_credito    numeric not null,
  valor_total_calculado numeric not null check (valor_total_calculado >= 0),
  comissao_base         text,
  comissao_valor        numeric check (comissao_valor >= 0),
  expira_em             timestamptz not null,
  status                text not null default 'ativa'
                        check (status in ('ativa', 'aceita_parcial', 'aceita',
                                          'expirada', 'retirada')),
  criado_em             timestamptz not null default now(),
  criado_por_email      text not null,
  retirada_em           timestamptz,
  retirada_por          text,
  retirada_motivo       text,
  constraint fidc_ofertas_prazo_coerente check (expira_em > criado_em),
  -- Emerson, 12/08/2026: "a oferta e SEMPRE entre 20% (piso) e 35% (teto) DO
  -- VALOR DO CREDITO." A constraint tem nome proprio para que a violacao chegue
  -- nomeada ao log: quem ler `fidc_ofertas_faixa_20_35_do_credito` no erro sabe
  -- na hora qual regra da casa foi tocada, sem abrir o schema.
  constraint fidc_ofertas_faixa_20_35_do_credito
    check (oferta_pct_credito >= 20 and oferta_pct_credito <= 35)
);

comment on table public.fidc_ofertas is
  'FIDC-OFERTAS-01. Uma proposta do fundo, com prazo. A lista de cartas de uma oferta e fidc_oferta_itens — esta tabela nao guarda carta_ids (ver desvio (a) no cabecalho).';
comment on column public.fidc_ofertas.escopo is
  'carta | lote. Distincao de intencao, nao de estrutura: as duas formas geram linhas em fidc_oferta_itens. Serve para a tela dizer a verdade sobre o que o fundo fez.';
comment on column public.fidc_ofertas.filtro_lote is
  'AUDITORIA, nao conteudo. Registra COMO o fundo selecionou (tipo, faixa de credito, administradoras) para que seja possivel reconstruir a intencao depois. O QUE foi ofertado esta em fidc_oferta_itens, e so la.';
comment on column public.fidc_ofertas.oferta_pct_credito is
  'Quanto o fundo paga, em percentual DO VALOR DO CREDITO da carta. Emerson, 12/08/2026: "a oferta e SEMPRE entre 20% (piso) e 35% (teto) DO VALOR DO CREDITO." A BASE NAO E COLUNA porque nao e escolha: e sempre cartas.valor_credito. Guardar uma base configuravel aqui seria oferecer uma opcao que a regra da casa nao da, e a primeira pessoa a escolher errado nao teria como saber. A faixa e imposta em dois lugares: lib/fidc-ofertas.ts (erro nomeado, antes do insert) e a constraint fidc_ofertas_faixa_20_35_do_credito (a rede).';
comment on column public.fidc_ofertas.valor_total_calculado is
  'Soma de valor_ofertado dos itens no instante do envio. Redundante com a soma dos itens, e de proposito: e o numero que o fundo VIU e aprovou. Se um item for retirado depois, este total continua contando a historia certa.';
comment on column public.fidc_ofertas.comissao_base is
  'PLACEHOLDER — decisao 2, em aberto. Nome do modelo que produziu comissao_valor (ex.: agio_10_piso_2500). Guardar o nome junto do numero e o que permite auditar uma oferta antiga sob um modelo que ja mudou.';
comment on column public.fidc_ofertas.comissao_valor is
  'PLACEHOLDER — decisao 2, em aberto. Resultado em reais, calculado no envio. O modelo e codigo; aqui fica so o que ele produziu.';
comment on column public.fidc_ofertas.expira_em is
  'Fim da janela. NAO e coluna gerada — `timestamptz + interval` e STABLE e coluna gerada exige IMMUTABLE (medido; ver desvio (b)). A janela de 24h vive numa constante unica na aplicacao. Leitura apos este instante trata a oferta como expirada, sem depender de cron.';
comment on column public.fidc_ofertas.status is
  'ativa | aceita_parcial | aceita | expirada | retirada. aceita_parcial existe porque num lote de 40 o dono pode aceitar 12 — e um lote meio aceito nao e um lote recusado.';
comment on column public.fidc_ofertas.criado_por_email is
  'Qual e-mail do fundo enviou. O fundo e uma empresa; a oferta e de uma pessoa. Sem isto, "quem ofereceu" nao tem resposta.';
comment on column public.fidc_ofertas.retirada_motivo is
  'Por que a oferta foi retirada. Retirar sem dizer por que deixa o vendedor sem explicacao — e ele viu a oferta.';

create index if not exists fidc_ofertas_fundo_idx
  on public.fidc_ofertas (fundo_id, criado_em desc);

create index if not exists fidc_ofertas_ativas_idx
  on public.fidc_ofertas (expira_em) where status = 'ativa';
-- Parcial de proposito: a varredura diaria e a tela do fundo so perguntam por
-- ofertas ativas. Um indice cheio carregaria anos de oferta morta para
-- responder uma pergunta que so olha para as vivas.

alter table public.fidc_ofertas enable row level security;
-- zero policies de proposito — ver cabecalho.


-- ----------------------------------------------------------------------------
-- 3. fidc_oferta_itens — a oferta carta a carta, e o aceite.
-- ----------------------------------------------------------------------------
-- Aqui esta a FK que motivou a decisao de coordenacao. `on delete restrict`
-- porque um aceite nao pode virar orfao. Medido em 12/08/2026 antes de escolher
-- a clausula: NENHUM caminho do codigo apaga carta. Quatorze arquivos tocam a
-- tabela `cartas` e nenhum chama delete; `admin/cartas/[id]/descartar` — o mais
-- proximo pelo nome — e um `update status = 'indisponivel'`. Ou seja: restrict
-- protege o dinheiro sem travar nenhuma rotina que exista hoje.
create table if not exists public.fidc_oferta_itens (
  id              uuid primary key default gen_random_uuid(),
  oferta_id       uuid not null
                  references public.fidc_ofertas(id) on delete cascade,
  carta_id        uuid not null
                  references public.cartas(id) on delete restrict,
  valor_credito   numeric not null check (valor_credito >= 0),
  valor_ofertado  numeric not null check (valor_ofertado >= 0),
  status          text not null default 'pendente'
                  check (status in ('pendente', 'aceito', 'recusado', 'expirado')),
  aceite_palavra  text,
  aceite_por      text,
  aceite_canal    text check (aceite_canal in ('painel', 'whatsapp', 'email')),
  aceite_em       timestamptz,
  recusa_por      text,
  recusa_em       timestamptz,
  criado_em       timestamptz not null default now(),
  constraint fidc_oferta_itens_unico unique (oferta_id, carta_id)
);

comment on table public.fidc_oferta_itens is
  'FIDC-OFERTAS-01. A oferta carta a carta. E a lista de verdade do que foi ofertado, e o lugar onde o aceite fica registrado. Um item por carta por oferta.';
comment on column public.fidc_oferta_itens.oferta_id is
  'on delete cascade: item sem oferta nao significa nada. Apagar a oferta e apagar a proposta inteira, e isso e coerente.';
comment on column public.fidc_oferta_itens.carta_id is
  'FK REAL para cartas(id) — o motivo pelo qual estas tabelas nascem no xtv. on delete restrict: nada apaga carta hoje (medido), e se um dia alguem tentar, o banco vai lembrar que existe um aceite pendurado nela.';
comment on column public.fidc_oferta_itens.valor_credito is
  'Retrato de cartas.valor_credito NO INSTANTE da oferta. A carta pode ser corrigida, reimportada ou ter o credito atualizado; a proposta que o fundo enviou, nao. Sem este retrato, uma oferta de ontem seria recalculada com o numero de hoje e ninguem saberia dizer qual dos dois foi combinado.';
comment on column public.fidc_oferta_itens.valor_ofertado is
  'FOTOGRAFIA: valor_credito x oferta_pct_credito / 100, no momento da escrita. Gravado, nunca reconstruido na leitura — e o numero que a pessoa do outro lado viu antes de aceitar. Reconstruir na leitura significaria que a resposta a "quanto me ofereceram?" muda conforme o dia em que se pergunta.';
comment on column public.fidc_oferta_itens.status is
  'pendente | aceito | recusado | expirado. Por ITEM, nao por oferta — num lote de 40 o dono pode aceitar 12.';
comment on column public.fidc_oferta_itens.aceite_palavra is
  'Palavra combinada que a pessoa digitou para aceitar (padrao CAPTACAO-TERMO). Aceite e ato, nao clique: guardamos o que foi digitado, nao um booleano que ninguem consegue contestar depois.';
comment on column public.fidc_oferta_itens.aceite_por is
  'Quem aceitou — e-mail ou telefone, conforme o canal. Nunca preenchido pelo sistema em nome de alguem: nada e aceito automaticamente.';
comment on column public.fidc_oferta_itens.aceite_canal is
  'painel | whatsapp | email. Por onde o aceite entrou. Muda o que se pode provar depois.';

create index if not exists fidc_oferta_itens_oferta_idx
  on public.fidc_oferta_itens (oferta_id, status);

create index if not exists fidc_oferta_itens_carta_idx
  on public.fidc_oferta_itens (carta_id, criado_em desc);
-- Responde a pergunta do lado do vendedor: "existe oferta ativa para a MINHA
-- carta?" — a pergunta que faz a Entrega 3 existir.

alter table public.fidc_oferta_itens enable row level security;
-- zero policies de proposito — ver cabecalho.


-- ----------------------------------------------------------------------------
-- CONFERENCIA (rodar depois de aplicar; nenhuma destas escreve)
-- ----------------------------------------------------------------------------
--   select table_name from information_schema.tables
--    where table_schema = 'public' and table_name like 'fidc_%'
--    order by table_name;
--   -- esperado: fidc_fundos, fidc_oferta_itens, fidc_ofertas  (3 linhas)
--
--   select count(*) from public.fidc_fundos;         -- esperado: 0
--   select count(*) from public.fidc_ofertas;        -- esperado: 0
--   select count(*) from public.fidc_oferta_itens;   -- esperado: 0
--
--   -- RLS ligada nas tres, e ZERO policies nas tres:
--   select relname, relrowsecurity from pg_class
--    where relname like 'fidc_%' and relkind = 'r' order by relname;
--   -- esperado: relrowsecurity = true nas 3
--
--   select count(*) from pg_policies
--    where schemaname = 'public' and tablename like 'fidc_%';
--   -- esperado: 0
--
--   -- A FK que motivou tudo isto existe e aponta para cartas:
--   select tc.constraint_name, kcu.column_name,
--          ccu.table_name as referencia, rc.delete_rule
--     from information_schema.table_constraints tc
--     join information_schema.key_column_usage kcu
--       on kcu.constraint_name = tc.constraint_name
--     join information_schema.constraint_column_usage ccu
--       on ccu.constraint_name = tc.constraint_name
--     join information_schema.referential_constraints rc
--       on rc.constraint_name = tc.constraint_name
--    where tc.table_name = 'fidc_oferta_itens' and tc.constraint_type = 'FOREIGN KEY';
--   -- esperado: carta_id -> cartas, delete_rule = RESTRICT
--   --           oferta_id -> fidc_ofertas, delete_rule = CASCADE
--
--   -- A faixa 20–35 existe COM O NOME que a emenda pediu:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'fidc_ofertas_faixa_20_35_do_credito';
--   -- esperado: 1 linha, CHECK (oferta_pct_credito >= 20 AND
--   --                            oferta_pct_credito <= 35)
--
--   -- E a rede pega de verdade. As duas linhas abaixo DEVEM falhar; rodar uma
--   -- de cada vez e conferir que o erro cita a constraint pelo nome. Ficam em
--   -- transacao abortada de proposito — nada e gravado:
--   -- begin;
--   --   insert into public.fidc_ofertas
--   --     (fundo_id, escopo, oferta_pct_credito, valor_total_calculado,
--   --      expira_em, criado_por_email)
--   --   values (gen_random_uuid(), 'carta', 19.99, 0, now() + interval '1 h',
--   --           'conferencia@bidcon.com.br');
--   --   -- esperado: ERRO citando fidc_ofertas_faixa_20_35_do_credito
--   --   -- (se passar da faixa, cai antes na FK de fundo_id — que tambem
--   --   --  e um erro, mas NAO e o que este teste queria provar; para provar
--   --   --  a faixa, usar o id de um fundo real depois do cadastro)
--   -- rollback;
-- ============================================================================
