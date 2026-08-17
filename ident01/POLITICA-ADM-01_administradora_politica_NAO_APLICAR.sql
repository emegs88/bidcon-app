-- ============================================================================
-- POLITICA-ADM-01 — politica de credito por administradora
-- DRAFT. NAO APLICAR. Nasce sem numero por CLAUDE.md Regra 5.
-- Alvo: xtv (xtvjpnyadcdeadhmzyff). Ao aplicar, move para
-- platform/supabase/migrations/ com o proximo numero livre no momento.
-- Dois drafts esperando gate: o primeiro autorizado leva o numero menor.
--
-- REESCRITO em 17/08/2026 pelas 8 decisoes da coordenacao. REESCRITA, e nao
-- remendo, porque duas delas mudam o DDL em vez de somar a ele: `lista` deixa
-- de ser texto e passa a ser jsonb validado (o que obriga `valor` a ficar
-- anulavel), e `grupo` deixa de ser CHECK e passa a ser tabela. Remendar
-- deixaria a forma antiga visivel no arquivo como se ainda valesse.
-- O draft NUNCA foi aplicado, logo isto nao e ALTER de nada: e o nascimento
-- na forma correta. Se um dia tivesse sido aplicado, cada uma destas mudancas
-- seria migration propria — vai escrito para nao ser confundido depois.
-- ============================================================================
--
-- UMA TABELA, DUAS ORDENS (decisao da coordenacao, 16/08/2026)
-- `administradora_politica` era simultaneamente Entrega 1 da POLITICA-ADM-01 e
-- Entrega 1 da PRE-ANALISE-01 — mesma familia dos dois Radares. Decidido: UMA
-- tabela so, servindo as duas. Enquanto nada existe, custa zero.
--
-- O QUE NAO NASCE AQUI, POR JA EXISTIR EM `administradoras`
--   · "permite cessao a terceiro"  JA E  administradoras.aceita_assuncao
--   · "exige garantia do bem"      JA E  administradoras.exigencia_garantia_pct
-- Recriar qualquer um dos dois seria fabricar duas verdades sobre o mesmo fato.
--
-- FORMA ESTREITA (uma linha por administradora x campo), e o argumento e um so:
-- `nao apurado` e a AUSENCIA DE LINHA. Isso torna impossivel confundir
-- "nao apurado" com "nao" — que e exatamente o erro que a ordem manda evitar.
-- Na forma larga os dois virariam NULL e a distincao morreria no schema.
--
-- POR QUE O VOCABULARIO DE `campo` E TABELA E NAO ENUM
-- O beneficio declarado da forma estreita e "campo novo deixa de ser migration".
-- Com enum isso seria FALSO: acrescentar valor de enum e migration, e ainda
-- esbarra na trava conhecida da casa (Postgres recusa USAR valor de enum novo
-- na mesma transacao que o cria) — trava que ja custou a divisao 0083a/0083b
-- no historico aplicado deste banco. Tabela de dominio entrega o beneficio de
-- verdade; enum entregaria so a aparencia dele.
--
-- ----------------------------------------------------------------------------
-- AS 8 DECISOES DA COORDENACAO, e onde cada uma mora neste arquivo
--
--  1. `fonte_data` ENTRA (secao 3). `apurado_em` diz QUANDO A CASA OLHOU;
--     `fonte_data` diz QUAO VELHO E O QUE ELA OLHOU. Sao perguntas diferentes
--     e a segunda nunca tinha sido feita: uma linha apurada hoje contra um
--     regulamento de 2019 parecia fresca. O aviso passa a nascer do MAIS VELHO
--     dos dois.
--  2. `condicional` e o QUARTO ESTADO de campo booleano (secao 3), e `detalhe`
--     vira OBRIGATORIO nesse caso, por CHECK. Os quatro estados sao:
--     sim · nao · condicional · nao-apurado (ausencia de linha).
--     `condicional` NAO satisfaz filtro de "sim" — ver `vale_como_sim`.
--  3. LACUNAS ganham tabela irma (secao 5): registra o que JA FOI PROCURADO e
--     nao estava la, que e diferente de nunca ter sido procurado.
--  4. `fonte_tipo` ganha o degrau `documento_oficial` (secao 3).
--  5. `apurado_por` das linhas da casa e 'coordenacao' (secao 3, comentario).
--  6. `grupo` deixa de ser CHECK e vira TABELA (secao 1). A assimetria era
--     minha: fiz a folha barata (campo novo = INSERT) e o galho caro (grupo
--     novo = migration).
--  7. `lista` deixa de ser texto livre e vira ARRAY VALIDADO em jsonb
--     (secao 3). Texto livre nao se conta com honestidade.
--  8. `aceita_pj` se parte em tres (secao 6): vendedor, comprador e
--     cessionario. Um "sim" unico escondia tres politicas diferentes.
-- ----------------------------------------------------------------------------
--
-- ----------------------------------------------------------------------------
-- HIERARQUIA DE FONTES DA CASA (decisao da coordenacao, 16/08/2026)
-- Escrita aqui, no cabecalho da tabela de fontes, porque a pergunta que ela
-- responde nao e "de onde veio este dado" — e "que TIPO de pergunta esta fonte
-- tem direito de responder". Fonte boa para uma pergunta e invencao para outra.
--
--   REPUTACAO ......... Banco Central, ranking de reclamacoes
--                       (www3.bcb.gov.br/rdrweb). Medido: 85 instituicoes,
--                       2026-S1. Fonte OFICIAL, e a UNICA que vai a pagina com
--                       numero. Livre para republicar com atribuicao.
--   MERCADO ........... ABAC. Volume de vendas, adesoes, contemplacoes e
--                       tiquete por segmento, sempre com mes e link. Da tamanho
--                       e contexto ao indice; NAO e fonte de reputacao e nao
--                       vira nota de administradora. Usa-se o que a ABAC
--                       publica abertamente, citando pagina e data. Nunca
--                       raspada em volume.
--   POLITICA .......... documento da PROPRIA administradora — regulamento,
--                       formulario de pre-analise, portal do corretor.
--   COMPORTAMENTO ..... historico de transferencias da Bidcon. E o unico lugar
--     REAL            onde se ve o que a administradora FAZ, e nao o que ela
--                       declara. A Porto Seguro ja provou a diferenca.
--
-- RECLAME AQUI: PROIBIDO raspar, republicar nota ou exibir selo de TERCEIRO
-- SOBRE ADMINISTRADORA. O selo da PROPRIA Bidcon e contratado e PERMANECE.
--
-- A distincao nao e detalhe, e o eixo inteiro da regra: exibir a reputacao da
-- propria casa, num selo que ela contrata e paga, e o OPOSTO de republicar a
-- reputacao de outro. O que se proibe e usar nota alheia como se fosse fato
-- apurado — os dados e o score do RA sao produto proprietario com termos que
-- vedam reuso comercial, e o Bacen ja cobre reputacao com fonte oficial. Se um
-- dia interessar, e licenca comercial com eles — nunca coleta.
--
-- Medido em 16/08/2026, e por isso a regra ficou mal escrita na primeira volta:
--   · selo RA Verificada instalado em 16 paginas de public/, com os dominios
--     api/verificada.reclameaqui.com.br liberados em connect-src (vercel.json).
--     E a reputacao DA BIDCON. Fica, e a CSP fica como esta.
--   · `bidcon reclame aqui` em <meta name="keywords"> de seguranca.html, ao
--     lado de "bidcon golpe": palavra-chave DEFENSIVA, para quem busca por nos.
--     E SEO, nao coleta. Fica.
--   · raspagem de RA, nota de terceiro republicada, score de administradora
--     vindo do RA: ZERO ocorrencias. A regra ja e o estado do codigo.
--
-- CONSEQUENCIA DIRETA PARA ESTA TABELA, e e por isso que a hierarquia mora
-- aqui: `administradora_politica` e alimentada por DUAS das quatro faixas —
-- POLITICA e COMPORTAMENTO REAL. Bacen e ABAC NAO entram nela. Numero de
-- reclamacao nao e regra de credito, e volume de mercado nao e politica de
-- cessao. Colocar qualquer um dos dois numa celula daqui seria dar a uma fonte
-- verdadeira uma pergunta que ela nunca respondeu — que e a forma educada de
-- inventar. Por isso `fonte_tipo` nao tem, e nao deve ganhar, valor 'bacen'
-- nem 'abac': os fatos do Bacen tem casa propria (ATLAS-BACEN-01) e a ABAC
-- entra como pauta e contexto, nao como celula de politica.
-- ----------------------------------------------------------------------------
--
-- POR QUE `fonte_tipo` E CHECK E NAO ENUM
-- Aqui o inverso e desejado: a taxonomia de fonte NAO deve crescer sozinha —
-- ela e a ordem de confiabilidade que a ordem fixou. Check com lista literal
-- trava do mesmo jeito e nao paga o pedagio da transacao.
--
-- ----------------------------------------------------------------------------
-- COMO A VALIDACAO DE `lista` FOI DESCOBERTA, com o que ela pega e o que NAO
-- pega. Medido no xtv em 17/08/2026, e o registro fica porque a primeira
-- versao do meu proprio CHECK tinha DOIS FUROS que so os controles negativos
-- revelaram.
--
-- A pergunta de partida: como validar CADA ELEMENTO de um jsonb dentro de um
-- CHECK? `jsonb_array_elements` e SET-RETURNING e CHECK nao aceita SRF, do
-- mesmo jeito que nao aceita subquery. A saida e `jsonb_path_exists`, medido
-- IMMUTABLE (o irmao `jsonb_path_exists_tz` e STABLE — mesma familia da
-- armadilha do now(), que ja impediu "apurado_em nao pode ser futuro").
--
-- FURO 1 — MODO LAX DESEMBRULHA ARRAY ANINHADO. `$[*]` em modo lax (o padrao)
-- achata sozinho: `["RG",["CNH"]]` rendia os elementos "RG" e "CNH", ambos
-- string, e o array aninhado PASSAVA. Corrigido com `strict`.
--
-- FURO 2 — `\s` NAO PEGOU ESPACO em like_regex. `["RG","   "]` passava.
-- Corrigido com a classe POSIX `[[:space:]]`, que tambem pega tab.
--
-- FURO 3, o pior, e este e do Postgres e nao da minha regex: em modo `strict`
-- aplicar `$[*]` a nao-array LEVANTA erro; com `silent => true` o erro e
-- suprimido e a funcao devolve NULL. E CHECK COM RESULTADO NULL ACEITA A
-- LINHA. Sem `coalesce(..., false)` um objeto `{"a":1}` ou uma string solta
-- `"RG"` entrariam caladas. Medido: `bruto_tipo = null` exatamente nessas duas
-- linhas. Todo predicado de jsonpath aqui vai envolvido em coalesce por isso.
--
-- Prova de que o CHECK DISCRIMINA (Regra 9): 3 casos bons passam, 10 casos
-- ruins caem — array vazio, objeto, string solta, elemento numero, elemento
-- null, elemento objeto, string vazia, string so espaco, string so tab e array
-- aninhado.
--
-- LIMITE DECLARADO E NAO CONTORNADO: DUPLICATA PASSA. `["RG","RG"]` entra,
-- medido. Deduplicar sem SRF nao ha em CHECK, e inventar regex sobre a forma
-- textual do jsonb seria fragil e mentiria sobre o que garante. Como a razao
-- de ser da decisao 7 e poder CONTAR a lista, a contagem exposta na view e de
-- elementos, nao de itens distintos, e esta escrito la. A guarda contra
-- duplicata e a revisao do INSERT, que e manual e unico.
-- ----------------------------------------------------------------------------
--
-- LIMITES CONHECIDOS, medidos e nao contornados
--  · "apurado_em nao pode ser futuro" NAO cabe em CHECK: medido em pg_proc,
--    now() e STABLE (nao IMMUTABLE), e CHECK so aceita IMMUTABLE. A guarda
--    fica na aplicacao. O mesmo vale para `fonte_data`.
--  · `atualizado_em` tem default e NADA o atualiza: nao ha trigger nesta
--    migration. Hoje ele significa "criado_em novamente", nao "mexido em".
--    Fica escrito para nao ser lido como data de revisao — coluna que parece
--    dizer algo e nao diz e a mesma familia do verde vazio.
--  · uma administradora pode ter, ao mesmo tempo, linha em
--    `administradora_politica` e em `administradora_politica_lacuna` para o
--    mesmo campo. Unicidade entre tabelas diferentes nao existe em constraint
--    no Postgres. E proposital: a lacuna registra uma BUSCA que aconteceu e
--    falhou, e apagar isso quando o dado depois aparece seria apagar historia.
--    A view de politica ignora lacuna; a de lacuna diz se ja foi suprida.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) DECISAO 6 — o grupo vira tabela.
--    Antes era `check (grupo in (...))` na tabela de campos, o que fazia grupo
--    novo custar migration enquanto campo novo custava INSERT. Assimetria sem
--    motivo: as duas coisas sao vocabulario.
-- ----------------------------------------------------------------------------
create table if not exists public.administradora_politica_grupo (
  grupo   text primary key,
  rotulo  text not null check (length(btrim(rotulo)) > 0),
  ordem   int  not null default 0
);

comment on table public.administradora_politica_grupo is
  'Grupos de exibicao da politica de credito. Grupo novo e INSERT aqui, nao '
  'migration — simetrico ao vocabulario de campos, que era o ponto da decisao.';

insert into public.administradora_politica_grupo (grupo, rotulo, ordem) values
  ('quem_pode_assumir', 'Quem pode assumir',   10),
  ('o_que_analisa',     'O que a administradora analisa', 20),
  ('documentos',        'Documentos exigidos',  30),
  ('uso_do_credito',    'Uso do credito',       40),
  ('operacional',       'Operacional',          50)
on conflict (grupo) do nothing;

-- ----------------------------------------------------------------------------
-- 2) O vocabulario de campos. Dominio fechado: campo fora daqui nao entra.
-- ----------------------------------------------------------------------------
create table if not exists public.administradora_politica_campo (
  campo       text primary key,
  tipo_valor  text not null check (tipo_valor in ('booleano','texto','numero','lista')),
  grupo       text not null
    references public.administradora_politica_grupo (grupo),
  rotulo      text not null check (length(btrim(rotulo)) > 0),
  ordem       int  not null default 0,
  -- Existe para ser alvo da FK composta la embaixo, que e o que garante
  -- que `tipo_valor` da linha nunca diverge do tipo declarado do campo.
  unique (campo, tipo_valor)
);

comment on table public.administradora_politica_campo is
  'Vocabulario fechado dos campos de politica de credito. Campo novo e INSERT '
  'aqui, nao migration — que e a razao de ser tabela e nao enum.';

-- ----------------------------------------------------------------------------
-- 3) A apuracao. Uma linha por administradora x campo.
--    Linha inexistente = "nao apurado". Nunca NULL para dizer isso.
-- ----------------------------------------------------------------------------
create table if not exists public.administradora_politica (
  administradora_id uuid not null
    references public.administradoras(id) on delete cascade,
  campo             text not null,
  tipo_valor        text not null,

  -- DECISAO 7: o valor mora em UMA das duas colunas, nunca nas duas.
  -- `valor` serve booleano, texto e numero; `valor_lista` serve so `lista`.
  -- `valor` passou a ser anulavel POR ISSO, e nao por relaxamento: o CHECK
  -- abaixo exige que ele exista em todo tipo que nao seja lista.
  valor             text,
  valor_lista       jsonb,
  detalhe           text,

  -- Proveniencia. Sem os obrigatorios, a linha nao entra — check no BANCO, nao
  -- na aplicacao, porque aplicacao se contorna e banco nao.
  fonte_tipo        text not null
    check (fonte_tipo in ('regulamento','documento_oficial','pagina_oficial',
                          'operacao_bidcon','contato_comercial')),
  fonte_ref         text not null
    check (length(btrim(fonte_ref)) > 0),

  -- DECISAO 1: as duas datas medem coisas diferentes.
  fonte_data        date,
  apurado_em        date not null,
  apurado_por       text not null
    check (length(btrim(apurado_por)) > 0),

  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),

  primary key (administradora_id, campo),

  -- FK composta: amarra o par (campo, tipo_valor) ao dominio. Sem ela,
  -- `tipo_valor` seria copia solta e poderia divergir em silencio.
  foreign key (campo, tipo_valor)
    references public.administradora_politica_campo (campo, tipo_valor),

  -- O valor tem de bater com o tipo declarado do campo.
  -- CADA RAMO comeca exigindo que a coluna certa esteja preenchida e a outra
  -- vazia. `valor in ('sim','nao')` com valor NULL devolveria NULL, e CHECK
  -- com NULL ACEITA — por isso o `valor is not null` explicito em cada ramo.
  -- O `else false` fecha a porta do mesmo jeito: `case` sem else devolve NULL
  -- para tipo desconhecido, e NULL passaria.
  constraint administradora_politica_valor_bate_tipo check (
    case tipo_valor
      when 'lista' then
        valor is null
        and valor_lista is not null
        and jsonb_typeof(valor_lista) = 'array'
        and coalesce(jsonb_array_length(valor_lista), 0) > 0
        -- todo elemento e string (strict: sem desembrulhar aninhado)
        and coalesce(not jsonb_path_exists(
              valor_lista, 'strict $[*] ? (@.type() != "string")',
              '{}'::jsonb, true), false)
        -- nenhum elemento e vazio ou so espaco/tab
        and coalesce(not jsonb_path_exists(
              valor_lista, 'strict $[*] ? (@ like_regex "^[[:space:]]*$")',
              '{}'::jsonb, true), false)
      when 'booleano' then
        valor_lista is null and valor is not null
        and valor in ('sim','nao','condicional')
      when 'numero' then
        valor_lista is null and valor is not null
        and valor ~ '^[0-9]+([.,][0-9]+)?$'
      when 'texto' then
        valor_lista is null and valor is not null
        and length(btrim(valor)) > 0
      else false
    end
  ),

  -- DECISAO 2: `condicional` SEM a condicao escrita e pior que nao apurado,
  -- porque PARECE informacao. `is distinct from` e deliberado: com valor NULL
  -- um `<>` devolveria NULL e o CHECK aceitaria.
  constraint administradora_politica_condicional_tem_detalhe check (
    valor is distinct from 'condicional'
    or length(btrim(coalesce(detalhe, ''))) > 0
  )
);

comment on table public.administradora_politica is
  'Politica de credito por administradora, uma linha por campo apurado. '
  'AUSENCIA DE LINHA = "nao apurado", que e resposta legitima; '
  '"provavelmente nao consulta" nao e. Nenhuma linha entra sem fonte_tipo, '
  'fonte_ref, apurado_em e apurado_por. Nada aqui e inferido.';

comment on column public.administradora_politica.valor is
  'Valor de campo booleano, texto ou numero. NULO em campo de tipo `lista` — '
  'nesse caso o valor mora em `valor_lista`. Booleano tem TRES literais: '
  'sim, nao e condicional; o quarto estado, `nao apurado`, e a ausencia da '
  'linha e por isso nao cabe nesta coluna.';

comment on column public.administradora_politica.valor_lista is
  'Array jsonb de strings nao vazias, usado SO por campo de tipo `lista`. '
  'Substituiu texto livre porque texto livre nao se conta com honestidade. '
  'O CHECK garante: e array, tem ao menos um item, todo item e string e '
  'nenhum item e vazio ou so espaco. NAO garante ausencia de duplicata — '
  'medido, ["RG","RG"] passa, e deduplicar sem funcao set-returning nao ha '
  'em CHECK. Por isso a contagem na view e de elementos, nao de distintos.';

comment on column public.administradora_politica.detalhe is
  'Texto livre de qualificacao. OBRIGATORIO quando valor = condicional: '
  'condicional sem a condicao escrita parece informacao e nao e.';

comment on column public.administradora_politica.fonte_tipo is
  'Ordem de confiabilidade fixada pela ordem: regulamento > documento_oficial '
  '> pagina_oficial > operacao_bidcon > contato_comercial. `documento_oficial` '
  'e o degrau do formulario de pre-analise e do portal do corretor: documento '
  'da administradora que nao e o regulamento. A hierarquia so serve se cada '
  'degrau existir. NAO ha degrau para Bacen nem ABAC — ver o cabecalho: '
  'reputacao e mercado nao respondem pergunta de politica. '
  'Medido em 16/08/2026: a casa NAO tem '
  'PDF de regulamento em bucket nenhum (xtv: wa-extratos, farol-videos, '
  'farol-artes; nnv: processo-docs com 0 PDFs, reserva-docs vazio), logo a '
  'apuracao comeca por operacao_bidcon — historico proprio, nao opiniao.';

comment on column public.administradora_politica.fonte_ref is
  'Referencia especifica do tipo: caminho do PDF no bucket; URL completa; '
  'id do processo; ou nome de quem respondeu. Vazio nao passa no check.';

comment on column public.administradora_politica.fonte_data is
  'Data DO DOCUMENTO consultado — versao do regulamento, data da pagina, mes '
  'do processo. Responde "quao velho e o que a casa olhou", pergunta que '
  '`apurado_em` NAO responde: linha apurada hoje sobre regulamento de 2019 '
  'parecia fresca antes desta coluna existir. NULA quando a fonte nao traz '
  'data — o que NAO e o mesmo que fonte recente, e a view separa os dois.';

comment on column public.administradora_politica.apurado_em is
  'Data em que A CASA OLHOU. Nao se confunde com fonte_data.';

comment on column public.administradora_politica.apurado_por is
  'Quem apurou. Para as linhas levantadas pela propria casa o valor e '
  '`coordenacao`. Quando a fonte for contato_comercial, aqui vai o nome de '
  'quem respondeu, que e o que torna a linha rastreavel.';

create index if not exists administradora_politica_campo_idx
  on public.administradora_politica (campo);

-- ----------------------------------------------------------------------------
-- 4) RLS. Molde de tabela interna do xtv: ligada, SEM policy — so service_role.
--    Mesmo desenho de radar_alertas (medido: rls_ligado=true, sem policy).
--    A pagina publica e servida por rota Next com createXtvClient(); leitura
--    anon so entra em migration futura, depois do Emerson revisar as
--    oito primeiras administradoras. Kill-switch POLITICA_ADM, desarmado.
-- ----------------------------------------------------------------------------
alter table public.administradora_politica        enable row level security;
alter table public.administradora_politica_campo  enable row level security;
alter table public.administradora_politica_grupo  enable row level security;

-- ----------------------------------------------------------------------------
-- 5) DECISAO 3 — a tabela de LACUNAS.
--    "Nunca procurei" e "procurei e nao estava la" nao sao a mesma coisa, e
--    ate agora as duas se pareciam com ausencia de linha. Esta tabela e o que
--    separa: ela registra uma BUSCA que aconteceu, com onde e quando.
--    Ela NAO e um "nao": nao vira valor, nao entra na view de politica e nao
--    responde filtro nenhum. E o registro de um esforco.
-- ----------------------------------------------------------------------------
create table if not exists public.administradora_politica_lacuna (
  administradora_id uuid not null
    references public.administradoras(id) on delete cascade,
  campo             text not null
    references public.administradora_politica_campo (campo),

  -- Onde se procurou. Sem isto a linha diria so "nao achei", que e opiniao.
  onde_procurou     text not null check (length(btrim(onde_procurou)) > 0),
  observacao        text,

  procurado_em      date not null,
  procurado_por     text not null check (length(btrim(procurado_por)) > 0),
  criado_em         timestamptz not null default now(),

  -- Uma lacuna por par: a linha e a ULTIMA busca feita, nao um historico.
  primary key (administradora_id, campo)
);

comment on table public.administradora_politica_lacuna is
  'Buscas que aconteceram e nao acharam o dado. Existe para separar '
  '"nunca procurei" de "procurei e nao estava la" — que na ausencia de linha '
  'se pareciam. NAO e um "nao" e NAO satisfaz filtro nenhum: e o registro de '
  'um esforco, com onde e quando. Pode coexistir com uma linha de politica do '
  'mesmo campo, e isso e proposital: quando o dado aparece depois, apagar a '
  'busca falha seria apagar historia.';

comment on column public.administradora_politica_lacuna.onde_procurou is
  'Onde se olhou: URL, nome do documento, canal do contato. Sem isto a linha '
  'seria so "nao achei", que e opiniao e nao medicao.';

-- RLS DESTA TABELA MORA AQUI, e nao na secao 4, porque na secao 4 ela AINDA NAO
-- EXISTE. A primeira versao deste arquivo ligava RLS em tres tabelas na secao 4
-- e criava a quarta depois: medido no xtv em 17/08/2026, a lacuna nascia com
-- `rls=false, policies=0` — ABERTA ao PostgREST enquanto as irmas estavam
-- fechadas. Uma tabela com o historico de onde a casa procurou politica de
-- concorrente nao e dado publico. O erro nao aparecia lendo o arquivo, porque
-- as duas secoes estao a 30 linhas de distancia e cada uma parecia certa
-- sozinha; apareceu ao CONFERIR relrowsecurity de todas as quatro juntas.
alter table public.administradora_politica_lacuna enable row level security;

-- ----------------------------------------------------------------------------
-- 6) A visao que a tela consome. security_invoker para NAO furar a RLS
--    (a casa ja pagou por isso em 0064_correcao2_view_id_invoker).
--
--    A COLUNA `desatualizada` DA VERSAO ANTERIOR FOI REMOVIDA DE PROPOSITO, e
--    o nome nao volta. Ela olhava so `apurado_em`. Com `fonte_data` no jogo,
--    `least(apurado_em, fonte_data)` seria a conta obvia e seria uma
--    ARMADILHA: medido no xtv em 17/08/2026,
--        least(date '2026-08-01', null::date) = 2026-08-01
--    ou seja, least() IGNORA o NULL em vez de propagar. Fonte SEM data sairia
--    verde — o mesmo verde vazio que a decisao 1 existe para matar.
--    Por isso `data_efetiva` e NULA quando a fonte nao tem data, e quem a tela
--    deve renderizar e `pede_reapuracao`, que soma os dois motivos. Trocar o
--    nome obriga quem for escrever a tela a ler esta secao.
-- ----------------------------------------------------------------------------
create or replace view public.vw_administradora_politica
with (security_invoker = true) as
select
  p.administradora_id,
  a.nome                    as administradora,
  -- NAO expor `a.cnpj_raiz` aqui. A primeira versao desta view o trazia e ela
  -- NAO CRIAVA: medido no xtv em 17/08/2026, `administradoras` tem 10 colunas e
  -- `cnpj_raiz` nao e uma delas — quem a cria e o OUTRO draft (ATLAS-BACEN-01,
  -- `add column if not exists cnpj_raiz`). Como o cabecalho deste arquivo diz
  -- que "o primeiro autorizado leva o numero menor", a ordem NAO esta fixada:
  -- aplicar este primeiro abortaria a transacao inteira em `create view`.
  -- A coluna saiu em vez de a dependencia ser declarada, porque tela de
  -- POLITICA nao tem uso para CNPJ raiz — ela identifica pelo id e pelo nome.
  -- Quem precisar do numero junta com `vw_administradora_cnpj`, que e a casa
  -- dele. Acoplar esta view a coluna de outro draft para exibir um dado que
  -- ninguem pediu seria pagar dependencia oculta por nada.
  d.grupo,
  g.rotulo                  as grupo_rotulo,
  g.ordem                   as grupo_ordem,
  d.rotulo,
  p.campo,
  p.tipo_valor,
  p.valor,
  p.valor_lista,
  -- Contagem de ELEMENTOS, nao de distintos: o CHECK nao barra duplicata.
  case when p.tipo_valor = 'lista'
       then jsonb_array_length(p.valor_lista) end          as itens_na_lista,
  p.detalhe,

  -- DECISAO 2: `condicional` nao satisfaz filtro de "sim". Sai pronto da view
  -- para que a tela nao seja tentada a escrever `valor <> 'nao'`, que
  -- transformaria condicional em sim por descuido.
  -- AS DUAS PRECISAM SER NULL-SAFE, e a primeira versao deste arquivo so tinha
  -- a de cima. `vale_como_sim` comeca por `tipo_valor = 'booleano'`, entao em
  -- linha de lista ela devolve FALSE. `e_condicional` era so `valor =
  -- 'condicional'`, e em linha de lista `valor` e NULL POR CONSTRUCAO (o CHECK
  -- exige `valor is null` quando tipo_valor = 'lista'): comparar NULL devolve
  -- NULL. Medido no xtv em 17/08/2026, a linha `documentos_cessionario` saia da
  -- view com `sim?=false` e `cond?=NULO` — as duas irmas discordando sobre a
  -- mesma linha. Uma tela que filtrasse `where e_condicional = false` para
  -- listar "o que nao tem condicao" DERRUBARIA TODA LINHA DE LISTA em silencio,
  -- porque `NULL = false` nao e false, e NULO. O `coalesce` nao e defensivo por
  -- habito: e a diferenca entre "nao e condicional" e "nao sei", e neste caso a
  -- casa SABE — lista nunca e condicional, porque condicional so existe em
  -- booleano. O mesmo defeito do CHECK que aceita a linha quando a expressao da
  -- NULL, agora do outro lado, na leitura.
  (p.tipo_valor = 'booleano' and p.valor = 'sim')          as vale_como_sim,
  coalesce(p.valor = 'condicional', false)                as e_condicional,

  p.fonte_tipo,
  p.fonte_ref,
  p.fonte_data,
  p.apurado_em,
  p.apurado_por,
  (p.fonte_data is null)                                  as fonte_sem_data,
  -- NULA de proposito quando a fonte nao tem data: ver o bloco acima.
  case when p.fonte_data is null then null
       else least(p.apurado_em, p.fonte_data) end          as data_efetiva,
  -- O UNICO sinal que a tela deve renderizar.
  (p.fonte_data is null
   or least(p.apurado_em, p.fonte_data)
        < (current_date - interval '12 months'))           as pede_reapuracao,
  d.ordem
from public.administradora_politica p
join public.administradoras a                on a.id = p.administradora_id
join public.administradora_politica_campo d  on d.campo = p.campo
join public.administradora_politica_grupo g  on g.grupo = d.grupo;

comment on view public.vw_administradora_politica is
  'Politica por administradora ja com rotulo de campo e de grupo. '
  'Nao inventa linha: o que nao foi apurado simplesmente nao aparece, e cabe a '
  'tela renderizar "nao apurado" a partir da ausencia. '
  'RENDERIZAR `pede_reapuracao`, nunca uma conta propria sobre as datas: '
  'least() ignora NULL e fonte sem data sairia verde. '
  'Usar `vale_como_sim` para filtro de "sim" — `valor <> nao` contaria '
  'condicional como sim. `vale_como_sim` e `e_condicional` sao as duas NULL-'
  'safe de proposito: elas devolvem false, nunca NULO, para que filtro por '
  '= false nao derrube linha de lista, onde `valor` e nulo por construcao.';

create or replace view public.vw_administradora_politica_lacuna
with (security_invoker = true) as
select
  l.administradora_id,
  a.nome            as administradora,
  d.grupo,
  g.rotulo          as grupo_rotulo,
  d.rotulo,
  l.campo,
  l.onde_procurou,
  l.observacao,
  l.procurado_em,
  l.procurado_por,
  -- A busca falhou naquele dia; o dado pode ter aparecido depois.
  exists (
    select 1 from public.administradora_politica p
     where p.administradora_id = l.administradora_id
       and p.campo = l.campo
  )                 as ja_suprida
from public.administradora_politica_lacuna l
join public.administradoras a                on a.id = l.administradora_id
join public.administradora_politica_campo d  on d.campo = l.campo
join public.administradora_politica_grupo g  on g.grupo = d.grupo;

comment on view public.vw_administradora_politica_lacuna is
  'Buscas registradas que nao acharam o dado. `ja_suprida` diz que o campo foi '
  'apurado DEPOIS: a lacuna continua valida como historia da busca, e some da '
  'fila de pendencia. Nada aqui e um "nao".';

-- ----------------------------------------------------------------------------
-- 7) Semente do vocabulario. Isto e o molde que a primeira administradora
--    preenche junto com o Emerson; as outras seguem.
--
--    DECISAO 8: `aceita_pj` NAO existe mais. Um "sim" unico escondia tres
--    politicas diferentes — quem VENDE a cota, quem COMPRA, e quem entra como
--    cessionario na transferencia sao tres autorizacoes distintas, e ha
--    administradora que aceita PJ numa ponta e recusa na outra.
--    Como o draft nunca foi aplicado, isto e apenas a semente correta. Se
--    tivesse sido aplicado, o `on conflict do nothing` abaixo NAO removeria a
--    linha antiga: seria migration propria, com delete explicito e com o
--    cuidado de nao orfanar linha de politica ja apurada.
-- ----------------------------------------------------------------------------
-- ----------------------------------------------------------------------------
-- DECLARAR RENDA E COMPROVAR RENDA SAO DOIS CAMPOS, NAO UM.
-- A primeira versao desta semente tinha um campo so: `exige_comprovacao_renda`,
-- rotulo "Exige comprovacao de renda". Ele foi RENOMEADO para
-- `comprovacao_documental_de_renda` e ganhou um irmao, `declara_renda`, porque
-- a ficha da Porto Seguro (17/08/2026) provou que a pergunta era DUAS:
-- a ficha PEDE O NUMERO da renda ("Renda / Faturamento", PF e PJ) e NAO pede
-- holerite, imposto de renda nem extrato. Com um campo unico, "sim" significaria
-- as duas coisas ao mesmo tempo — e a tela diria ao cliente que ele precisa
-- juntar documento que ninguem pediu, ou o contrario, que basta declarar quando
-- talvez nao baste. Ficam VIZINHOS na ordem (8 e 10) de proposito: a distincao
-- so serve se as duas linhas aparecerem lado a lado na tela.
-- O rename e licito AGORA e nao seria depois: medido em 17/08/2026, nenhuma das
-- tabelas desta migration existe no xtv, logo nao ha linha apurada para orfanar.
-- ----------------------------------------------------------------------------
insert into public.administradora_politica_campo (campo, tipo_valor, grupo, rotulo, ordem) values
  ('declara_renda',                  'booleano','quem_pode_assumir','Pede a renda declarada',                     8),
  ('comprovacao_documental_de_renda','booleano','quem_pode_assumir','Exige comprovacao DOCUMENTAL de renda',     10),
  ('aceita_nome_com_restricao',      'booleano','quem_pode_assumir','Aceita nome com restricao',                 20),
  ('exige_score_minimo',             'booleano','quem_pode_assumir','Exige score minimo',                        30),
  ('vendedor_pj',                    'booleano','quem_pode_assumir','Aceita PJ como vendedor da cota',           40),
  ('comprador_pj',                   'booleano','quem_pode_assumir','Aceita PJ como comprador da cota',          41),
  ('cessionario_pj',                 'booleano','quem_pode_assumir','Aceita PJ como cessionario na transferencia',42),
  ('aceita_estrangeiro',             'booleano','quem_pode_assumir','Aceita estrangeiro',                        50),
  ('exige_vinculo_empregaticio',     'booleano','quem_pode_assumir','Exige vinculo empregaticio',                60),
  ('exige_dados_conjuge',            'booleano','quem_pode_assumir','Exige dados do conjuge',                    70),

  -- DUAS PERGUNTAS DIFERENTES, e a ficha da Porto so responde a primeira:
  -- "analisa o credito DE QUEM ENTRA" nao diz se a analise e feita em casa ou
  -- terceirizada. Juntar as duas faria a fonte responder o que ela nao disse.
  ('analise_credito_do_cessionario', 'booleano','o_que_analisa',    'Analisa o credito do cessionario',         105),
  ('analise_credito_propria',        'booleano','o_que_analisa',    'Faz a analise de credito em casa',         110),
  ('consulta_biro',                  'booleano','o_que_analisa',    'Consulta biro de credito',                 120),

  ('documentos_cessionario',         'lista',   'documentos',       'Documentos exigidos do cessionario',       210),

  ('uso_imovel_usado',               'booleano','uso_do_credito',   'Permite imovel usado',                     310),
  ('uso_terreno',                    'booleano','uso_do_credito',   'Permite terreno',                          320),
  ('uso_construcao',                 'booleano','uso_do_credito',   'Permite construcao',                       330),
  ('uso_reforma',                    'booleano','uso_do_credito',   'Permite reforma',                          340),
  ('uso_quitar_financiamento',       'booleano','uso_do_credito',   'Permite quitar financiamento existente',   350),
  ('uso_troca_veiculo',              'booleano','uso_do_credito',   'Permite troca de veiculo',                 360),
  ('uso_compra_entre_pf',            'booleano','uso_do_credito',   'Permite compra entre pessoas fisicas',     370),

  ('canal_de_envio',                 'texto',   'operacional',      'Como se envia o pedido de transferencia',  405),
  -- NUMERO, e nao booleano: a pergunta da tela e "quantas cabem", nao "tem
  -- limite". `detalhe` diz DE ONDE o numero saiu — ver a linha da Porto.
  ('max_cotas_por_formulario',       'numero',  'operacional',      'Cotas por formulario',                     407),
  ('taxa_transferencia',             'texto',   'operacional',      'Taxa de transferencia',                    410),
  ('taxa_transferencia_quem_paga',   'texto',   'operacional',      'Quem paga a taxa de transferencia',        420),
  ('prazo_resposta_dias',            'numero',  'operacional',      'Prazo de resposta observado (dias)',       430),
  ('prazo_uso_credito_dias',         'numero',  'operacional',      'Prazo para usar o credito apos contemplar',440),
  ('consequencia_estouro_prazo',     'texto',   'operacional',      'O que acontece se estourar o prazo',       450)
on conflict (campo) do nothing;

commit;

-- ============================================================================
-- CONFERENCIA — JA FOI FEITA, ANTES DE APLICAR. 17/08/2026, no xtv.
--
-- Este bloco pedia para rodar quatro insercoes DEPOIS do apply e ver se
-- falhavam. Foi feito melhor: o DDL inteiro deste arquivo foi executado no xtv
-- dentro de `begin; ... raise exception; rollback;` — a excecao no fim garante
-- que uma transacao de DDL em banco vivo NAO PODE comitar. Medido antes:
-- nenhuma das quatro tabelas nem das duas views existia no xtv, logo o
-- `create table if not exists` de fato criou e o ensaio nao foi encenacao.
-- Depois: `(nada)` sobrou. Nada foi aplicado.
--
-- O QUE FOI VISTO RECUSAR — 21 insercoes ruins, 21 recusadas, cada uma
-- atribuida ao CHECK culpado por `get stacked diagnostics constraint_name`
-- (sem isso `sqlerrm` truncava e nao se sabia QUAL regra derrubou):
--   lista:      {"a":1} · "RG" · [] · ["RG",""] · ["RG","   "] · ["RG","\t"] ·
--               ["RG",["CNH"]] · ["RG",1] · ["RG",null] · ["RG",{"a":1}]
--               -> todas por administradora_politica_valor_bate_tipo
--   condicional sem detalhe -> administradora_politica_condicional_tem_detalhe
--   campo fora do vocabulario -> administradora_politica_campo_tipo_valor_fkey
--   fonte_tipo invalido -> ..._fonte_tipo_check | fonte_ref vazio -> ..._fonte_ref_check
-- E o controle que impede "o CHECK recusa tudo": duas PASSARAM, incluindo
-- ["RG ou CNH","Comprovante de renda"].
-- ARMADILHA MEDIDA: o tab literal (chr(9)) e recusado pelo PARSER de json
-- (22P02), nao pelo CHECK. So o escape "\t" testa esta regra de verdade.
--
-- SEGUNDA ARMADILHA DA MESMA FAMILIA, medida em 17/08/2026 e achada num ensaio
-- MEU que tinha passado por verde. Para testar a FK composta (campo,tipo_valor)
-- eu usei um campo QUE JA TINHA LINHA da administradora. Resultado real:
--   canal_de_envio como 'numero'          -> administradora_politica_pkey / 23505
--   taxa_transferencia_quem_paga idem     -> ..._campo_tipo_valor_fkey  / 23503
-- A primeira linha foi relatada como se fosse prova da FK composta e nao era:
-- a PK disparou ANTES, e a regra sob teste nunca foi exercida. Um probe de FK
-- composta EXIGE campo sem linha previa para aquela administradora — e exige o
-- controle que o acompanha: o mesmo campo com o tipo CERTO tem de ENTRAR
-- (medido: entrou), senao a recusa poderia ser do campo e nao do tipo.
-- REGRA GERAL: recusa vinda de camada mais rasa nao prova a regra que se quis
-- testar. `constraint_name` e o que denuncia; sem ele isto passaria batido.
--
-- TRES DEFEITOS QUE A CONFERENCIA ACHOU e o arquivo, lido, escondia:
--   1. a view consumia `administradoras.cnpj_raiz`, coluna que so o OUTRO draft
--      cria — abortaria a migration inteira. Removida.
--   2. `administradora_politica_lacuna` nascia com rls=false enquanto as tres
--      irmas nasciam true, porque era criada DEPOIS do bloco de RLS. Corrigido.
--      Reconferido: as quatro em rls=t.
--   3. `e_condicional` devolvia NULO em linha de lista. Corrigido com coalesce.
--      Medido o dano: o filtro "o que NAO e condicional" devolvia 4 de 6 linhas
--      ANTES e devolve 5 DEPOIS — a linha de lista era descartada em silencio.
--      E capaz dos dois valores (true=1, false=5, nulo=0), nao virou constante.
--
-- POS-APPLY, o que continua obrigatorio porque nao se pode medir sem aplicar:
--   · get_advisors (security) no xtv — nascem tabelas com RLS ligada e sem policy.
--   · reconferir relrowsecurity DAS QUATRO JUNTAS. Foi conferindo juntas, e nao
--     lendo o arquivo, que o defeito 2 apareceu.
-- ============================================================================
--
-- NAO FAZ PARTE DESTA MIGRATION, e e proposital:
--   · qualquer linha de politica de administradora real. A primeira e
--     preenchida junto com o Emerson; nenhuma nasce de inferencia.
--   · policy de leitura anon. Entra depois da revisao das oito primeiras.
--   · a pagina publica (Entrega 2) e o consumo pela PRE-ANALISE (Entrega 3).
--   · trigger de `atualizado_em`. Ver o bloco de limites: hoje a coluna repete
--     `criado_em`, e isso esta declarado em vez de disfarcado.
-- Regra 1 do CLAUDE.md (rodape revoke/grant) nao se aplica: nao ha funcao
-- nem RPC aqui. View nao e funcao — e por isso leva security_invoker.
-- ============================================================================
