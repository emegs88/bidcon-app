-- ============================================================================
-- 0088_captacoes — CAPTACAO-OFERTA-01, item (e)
-- AUTORIZADO: Emerson, 21/08/2026 — "Sobre a migration (e): AUTORIZADO:
-- migration da tabela de captação (e), só ela — nada além disso escreve sem eu
-- autorizar fatia a fatia."
-- Projeto: xtv (xtvjpnyadcdeadhmzyff) — mesma casa de `wa_conversas`,
-- `interesses` e `cartas`. A captação é o lado ESPELHO de `interesses`: lá
-- entra quem quer COMPRAR, aqui entra quem quer VENDER.
--
-- ESTE ARQUIVO CRIA UMA TABELA QUE NUNCA EXISTIU. NÃO É DELTA, NÃO É
-- RECONCILIAÇÃO. Um passo só, uma transação só — ver "PASSO ÚNICO" abaixo.
--
-- ============================================================================
-- O QUE FOI MEDIDO ANTES DE ESCREVER (FASE 1, 21/08/2026)
-- ============================================================================
--
--   44 tabelas base no xtv ......... NENHUMA de captação
--                                    (sem `cedentes`, sem `captacao`,
--                                     sem `leads_venda`)
--   interesses ..................... 49 linhas, TODAS de compra
--                                    intencao ∈ {interesse, reserva_pretendida}
--                                    origem   ∈ {chat}
--                                    interesses_venda = 0
--   wa_conversas com tag 'cedente' .. 5 de 82
--   public/vender-consorcio-…html ... form #leadForm SEM `fetch`, SEM `action=`,
--                                    SEM endpoint. O submit monta uma URL wa.me
--                                    e abre o WhatsApp. O lead só existe se a
--                                    pessoa apertar enviar do outro lado.
--
-- Ou seja: hoje quem quer vender uma carta para a casa NÃO DEIXA RASTRO
-- NENHUM no banco. Esta tabela é o primeiro lugar onde esse lead pode morar.
--
-- ============================================================================
-- PREMISSA DECLARADA — NÃO É MEDIÇÃO. LEIA ANTES DE CITAR O NÚMERO.
-- ============================================================================
--
-- A ordem CAPTACAO-OFERTA-01 falava numa faixa de 28–37% do crédito como
-- "entradas da vitrine hoje". Medi a vitrine e o número NÃO ESTÁ LÁ. Levei ao
-- Emerson, e a resposta dele, textual, 21/08/2026:
--
--   "O 28–37% é premissa comercial minha, de negociação de mercado — não veio
--    de coluna nenhuma do sistema, e tua medição confirma que nunca houve
--    captação registrada. Então: entra na spec como premissa declarada, não
--    como medição."
--
-- Fica registrado assim, e é para ficar: 28–37% é PREMISSA DE NEGOCIAÇÃO. Não
-- foi extraída de coluna alguma, não é média de nada, e nenhuma tela pode
-- apresentá-la como se fosse. Nenhuma coluna desta tabela guarda esse número.
--
-- SANITY CHECK, ditado pelo Emerson na mesma mensagem, para conviver com a
-- premissa sem virar promessa:
--
--   "entrada mediana da vitrine = 50,7% do crédito (p25 47,9 / p75 56,0), com
--    a intermediação de 7% já dentro. Premissa de 28–37 ao cedente ⇒ margem de
--    ~7 a 16 p.p. na mediana, ~20 no p75. O 15–20% só fecha na metade de cima
--    do estoque — mais um motivo pra 'conforme análise da cota'."
--
-- Medição de apoio (vw_vitrine_viva, entrada/credito, 2414 cartas, sem_base 0):
--   geral ..... p25 47,9 · mediana 50,7 · p75 56,0 · min 7,5 · max 92,3
--   imovel .... 1524 · med 50,5 · 25 cartas dentro de 28–37%
--   veiculo ...  890 · med 51,4 · 47 cartas dentro de 28–37%
--   total dentro de 28–37%: 72 de 2414 = 3,0%. Ou seja, 97% do estoque FORA.
--   agio_120 e agio_150: medianas 0,0 — também não são a origem do número.
--
-- ATENÇÃO ao que `entrada/credito` NÃO é: ele NÃO é o spread da captação.
-- `entrada` é o que o COMPRADOR paga, e o comprador ainda assume o saldo
-- devedor. O spread da captação fica entre o que a casa paga ao cedente e o
-- que arrecada do comprador — e NÃO EXISTE UM ÚNICO VALOR PAGO A CEDENTE
-- REGISTRADO NO BANCO. Enquanto esta tabela não tiver linhas com desfecho,
-- ninguém consegue medir esse spread. É exatamente por isso que ela existe.
--
-- NÃO EXISTE ARQUIVO DE SPEC: `docs/` não tem nada sobre captação/cedente
-- (medido: grep vazio). Enquanto não houver, ESTE CABEÇALHO é o único lugar
-- onde a premissa e o sanity check estão escritos. Criar o doc não estava
-- autorizado nesta fatia.
--
-- ============================================================================
-- PASSO ÚNICO — e isto foi verificado, não presumido
-- ============================================================================
-- A 0083 e a 0086 tiveram que nascer partidas em a/b porque usavam um valor
-- NOVO de um enum EXISTENTE na mesma transação ("unsafe use of new value of
-- enum type"). Aqui não há enum nenhum: `status`, `origem` e `tipo_bem` são
-- `text` com check nomeado. Logo, um arquivo, uma transação, um apply.
--
-- DESVIO DECLARADO — por que text+check e não enum, ao contrário de
-- `agenda_status`: o vocabulário de status de uma captação vai crescer com o
-- negócio (hoje mal existe o negócio). Um check nomeado se troca com
-- `drop constraint if exists` + `add constraint` numa linha, re-executável;
-- um enum obriga a partir o arquivo em dois toda vez que ganhar um valor. Onde
-- o vocabulário é estável (agenda), enum; onde vai mexer, check.
--
-- ============================================================================
-- ARMADILHA JÁ MEDIDA, PARA QUEM ESCREVER A FATIA (d) / A ROTA DE INGESTÃO
-- ============================================================================
-- O form de public/vender-consorcio-contemplado.html emite, literalmente:
--     <option value="Imóvel">   <option value="Veículo">
-- e o banco fala `imovel` / `veiculo` (minúsculo, sem acento — é assim que
-- vw_vitrine_viva agrupa). O check `captacoes_tipo_bem_sano` VAI RECUSAR
-- "Imóvel". Normalizar é obrigação de quem ingere, e é de propósito: preferir
-- a recusa barulhenta a duas grafias convivendo na mesma coluna, que é como
-- `administradoras_grafias_orfas` (0085) nasceu.
--
-- ============================================================================
-- O QUE ESTA MIGRATION NÃO FAZ
-- ============================================================================
-- Não cria rota, não toca `public/`, não toca `lib/tools-por-agente.ts` (itens
-- d e f, não autorizados nesta fatia — e o (f) ainda depende de alinhar ordem
-- de deploy com a frente que está pondo `buscar_planos` na Valentina/Caetano).
-- Não escreve uma linha de dado. Tabela nasce vazia.
-- ============================================================================


-- ############################################################################
-- A MESA
-- ############################################################################

create table if not exists captacoes (
  id                uuid primary key default gen_random_uuid(),

  -- QUEM. `telefone` é not null porque o WhatsApp é o único canal desta casa:
  -- lead sem telefone não é lead, é anotação. `nome` fica nulo de propósito —
  -- no fluxo do cérebro o telefone chega antes do nome, e um lead com telefone
  -- e mais nada vale mais que lead nenhum.
  nome              text,
  telefone          text        not null,

  -- OS QUATRO DADOS DA COTA, nomeados na ordem do Emerson: "administradora,
  -- crédito, saldo devedor, parcelas pagas".
  -- TODOS NULÁVEIS, e isto é o desenho: o item (f) coleta em conversa, um dado
  -- por vez. Exigir os quatro no insert obrigaria o cérebro a segurar tudo na
  -- cabeça até o fim e perder o lead inteiro se a pessoa sumisse no meio.
  administradora    text,
  credito           numeric(14,2),
  saldo_devedor     numeric(14,2),
  parcelas_pagas    integer,
  tipo_bem          text,

  -- DE ONDE VEIO e EM QUE PÉ ESTÁ.
  origem            text        not null default 'site',
  status            text        not null default 'novo',

  -- LIGAÇÃO COM A CONVERSA. `on delete set null` e não `cascade`: apagar uma
  -- thread do WhatsApp não pode apagar a captação — o lead sobrevive ao canal.
  wa_conversa_id    uuid references wa_conversas(id) on delete set null,

  -- Chave de idempotência da origem, mesma doutrina de `agendamentos.origem_chave`:
  -- um retry do cérebro ou um duplo-clique no site não pode virar dois cedentes.
  origem_chave      text,

  -- LGPD. O form já tem o checkbox de consentimento; guardar QUANDO ele foi
  -- dado é o que torna o registro defensável. Nulo é permitido porque em lead
  -- que chega pelo WhatsApp a base é outra (a pessoa iniciou o contato), e
  -- carimbar consentimento que ninguém deu seria pior que não ter coluna.
  consentimento_em  timestamptz,

  -- O VALOR PROPOSTO — preenchido SÓ DEPOIS da análise da cota, nunca previsto.
  -- Não existe coluna para "faixa estimada" e isso é deliberado: valor sem
  -- análise é promessa, e promessa está proibida na ordem.
  proposta_valor    numeric(14,2),
  proposta_em       timestamptz,

  observacao        text,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),

  constraint captacoes_status_sano
    check (status in ('novo', 'em_analise', 'proposta_enviada',
                      'aceita', 'recusada', 'perdida')),

  constraint captacoes_origem_sana
    check (origem in ('site', 'whatsapp', 'painel', 'indicacao')),

  -- Ver "ARMADILHA JÁ MEDIDA" no cabeçalho: é minúsculo e sem acento.
  constraint captacoes_tipo_bem_sano
    check (tipo_bem is null or tipo_bem in ('imovel', 'veiculo')),

  constraint captacoes_credito_positivo
    check (credito is null or credito > 0),
  constraint captacoes_saldo_nao_negativo
    check (saldo_devedor is null or saldo_devedor >= 0),
  constraint captacoes_parcelas_nao_negativas
    check (parcelas_pagas is null or parcelas_pagas >= 0),

  -- Trava de honestidade, irmã de `agendamentos_confirmado_tem_meet`:
  -- proposta enviada sem valor registrado é impossível. Se o status diz que a
  -- casa fez uma oferta, tem que existir o número que foi ofertado.
  constraint captacoes_proposta_tem_valor
    check (status <> 'proposta_enviada' or proposta_valor is not null)
);

-- NÃO existe check `saldo_devedor <= credito`, e a ausência é decidida, não
-- esquecida: com taxa de administração e fundo de reserva o saldo devedor PODE
-- superar o crédito em cota nova. Um check assim recusaria cota real.


-- ############################################################################
-- ÍNDICES
-- ############################################################################

-- A fila de trabalho do operador: o que está em aberto, mais novo primeiro.
create index if not exists captacoes_status_criado_idx
  on captacoes (status, criado_em desc);

-- Reencontrar o cedente quando ele responde por outro caminho.
create index if not exists captacoes_telefone_idx
  on captacoes (telefone);

create index if not exists captacoes_wa_conversa_idx
  on captacoes (wa_conversa_id) where wa_conversa_id is not null;

-- Idempotência: parcial, porque uma captação PERDIDA não deve bloquear a
-- pessoa de voltar meses depois com a mesma cota.
create unique index if not exists captacoes_origem_chave_key
  on captacoes (origem_chave)
  where origem_chave is not null
    and status in ('novo', 'em_analise', 'proposta_enviada', 'aceita');


-- ############################################################################
-- TOUCH
-- ############################################################################

create or replace function tg_captacoes_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

create or replace trigger captacoes_touch
  before update on captacoes
  for each row execute function tg_captacoes_touch();


-- ############################################################################
-- FECHADURA
-- ############################################################################

-- Zero POLICIES com RLS ligada é o desenho, não esquecimento — mesma doutrina
-- da 0082 e da 0086: RLS sem policy nega para todo mundo, e service_role passa
-- por cima. A mesa é fechada para anon e para usuário logado por CONSTRUÇÃO.
alter table captacoes enable row level security;

-- Cinto além do suspensório, e aqui com motivo mais forte que na 0086: esta
-- tabela guarda nome + telefone de pessoa física (PII) e nasce num schema onde
-- o Supabase concede `anon`/`authenticated` por padrão. RLS já barraria; o
-- revoke garante que um `create policy` distraído amanhã não abra a porta
-- inteira de uma vez. Afrouxar depois é um `grant`; apertar depois de vazar
-- não é nada.
revoke all on table public.captacoes from anon, authenticated;

comment on table captacoes is
  'CAPTACAO-OFERTA-01: uma linha por cota oferecida a venda pelo cedente. Espelho de vendedor da tabela interesses (que e de comprador). Os quatro dados da cota sao NULAVEIS de proposito: o item (f) coleta em conversa, um por vez. NENHUMA coluna guarda a premissa de 28-37% - ela e premissa comercial declarada, nao medicao (ver cabecalho da 0088).';
comment on column captacoes.telefone is
  'Unico campo de contato obrigatorio: o WhatsApp e o unico canal da casa. Guardado como veio; normalizacao e de quem ingere.';
comment on column captacoes.tipo_bem is
  'imovel | veiculo - minusculo e sem acento, como vw_vitrine_viva agrupa. O form do site emite "Imovel"/"Veiculo": quem ingere normaliza, senao o check recusa.';
comment on column captacoes.proposta_valor is
  'Valor efetivamente proposto ao cedente, preenchido APOS a analise da cota. Nunca previsto, nunca estimado: valor sem analise e promessa, e promessa esta proibida na ordem.';
comment on column captacoes.origem_chave is
  'Chave de idempotencia da origem, igual agendamentos.origem_chave: retry do cerebro ou duplo-clique no site nao vira dois cedentes. Unico parcial - captacao perdida nao bloqueia a pessoa de voltar.';
comment on column captacoes.consentimento_em is
  'Quando o consentimento LGPD foi dado (checkbox do form). Nulo em lead que chegou pelo WhatsApp, onde a base legal e outra - carimbar consentimento que ninguem deu seria pior que nao ter coluna.';
