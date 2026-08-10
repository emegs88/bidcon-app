-- ============================================================================
-- 0076_farol_arte — o acervo de fundos gerados, e a curadoria que os libera
-- AUTORIZADO: Emerson Gomes dos Santos — FAROL-ARTE-01, 09/08/2026:
--   "modelo generativo NUNCA renderiza número, valor, percentual ou nome de
--    administradora — ele pinta fundo, textura e luz; os números continuam
--    saindo do gerador determinístico, com véu navy 78% por cima da arte e
--    fallback para o card atual se qualquer coisa falhar."
--   E, na decisão de 09/08: "UMA ARTE servindo os dois formatos: gerar em
--    1152×2048 (o único 9:16 legal que reduz para 1080×1920 sem upscale nem
--    recorte) e recortar o centro para o quadrado. (...) QUALIDADE MEDIUM,
--    pelo seu argumento do véu. Registre no código a condição de reabertura."
-- ----------------------------------------------------------------------------
-- PARA QUE ISTO EXISTE. O card de hoje é navy chapado. Ele é legível e é
-- honesto, mas é igual ao de todo mundo — no grid do Instagram ele desaparece.
-- Esta tabela guarda um ACERVO de fundos abstratos (textura, luz, profundidade)
-- gerados uma vez e reaproveitados, para que a arte do dia tenha matéria sem
-- que nenhum número passe por um modelo generativo.
--
-- A SEPARAÇÃO É A TESE DA FATIA: o modelo pinta o FUNDO; o gerador
-- determinístico (satori, em /api/card-image) escreve os NÚMEROS por cima. Um
-- modelo de imagem alucina dígito — ele desenha "R$ 361.5OO" e "0,4B7% a.m." sem
-- nenhum aviso, e essas duas peças iriam para um perfil público exibindo valor
-- errado de carta real. Por isso a regra é inegociável e está gravada aqui, no
-- schema, e não só no prompt: prompt se reescreve sem revisão; migração não.
--
-- ----------------------------------------------------------------------------
-- POR QUE UMA TABELA E NÃO SÓ O BUCKET
-- ----------------------------------------------------------------------------
-- Arquivo no storage responde "existe um png". Ele não responde as três coisas
-- que a fatia precisa saber: (a) esta arte foi APROVADA por um humano?, (b)
-- quanto ela custou de verdade?, (c) que dimensão ela tem — que é o que torna o
-- recorte central calculável em vez de chutado. Sem a tabela, "aprovada" viraria
-- convenção de nome de arquivo, que é a forma mais barata de publicar por
-- engano.
--
-- ----------------------------------------------------------------------------
-- A RESTRIÇÃO DE TAMANHO, MEDIDA — o próximo vai tropeçar nela
-- ----------------------------------------------------------------------------
-- Medido no guia oficial de geração de imagem da OpenAI, 09/08/2026. Só o
-- `gpt-image-2` aceita tamanho livre, e o tamanho livre tem três regras:
--   1. CADA ARESTA precisa ser MÚLTIPLA DE 16;
--   2. o total de pixels fica entre 655.360 e 8.294.400;
--   3. a razão lado maior : lado menor não passa de 3:1.
--
-- CONSEQUÊNCIA QUE CUSTOU A GEOMETRIA DA FATIA: 1080 ÷ 16 = 67,5. Portanto
-- NEM 1080×1080 NEM 1080×1920 — os dois formatos que o card já entrega — são
-- tamanhos legais de geração. Pedir qualquer um dos dois é erro de API, não
-- arredondamento silencioso.
--
-- Os 9:16 exatos e legais seguem a família  w = 144k , h = 256k :
--   864×1536 · 1008×1792 · 1152×2048 · 1296×2304 · … · 2160×3840 (= o teto)
-- 1152×2048 é o escolhido porque reduz para 1080×1920 por fator 0,9375 — uma
-- REDUÇÃO, sem upscale e sem recorte. Para o quadrado, o mesmo arquivo é
-- recortado no centro. Ver `largura`/`altura` abaixo: o recorte é aritmética
-- sobre esses dois números, não constante cravada no componente.
--
-- POR QUE NÃO O `gpt-image-1-mini`: ele só aceita três presets
-- (1024×1024, 1024×1536, 1536×1024) e NENHUM é 9:16. Ele obrigaria recorte de
-- 864×1536 mais upscale de 25% no story, e upscale em arte com estrutura é
-- perda visível. A diferença de custo em `medium` não paga isso.
--
-- ----------------------------------------------------------------------------
-- CONDIÇÃO DE REABERTURA DA QUALIDADE — registrada por ordem expressa
-- ----------------------------------------------------------------------------
-- A qualidade escolhida é `medium`, e ela se sustenta EM UM ÚNICO ARGUMENTO: o
-- card cobre a arte com um véu navy #0A0E1A a 78%, sobrando 22% de contraste.
-- `high` compra detalhe fino e nitidez de borda — exatamente o que um véu de
-- 78% aniquila. Pagar 4× por detalhe que o próprio layout apaga é desperdício
-- medido, não opinião.
--
-- LOGO: SE ALGUM USO FUTURO EXIBIR A ARTE SEM VÉU (capa de carrossel, thumb de
-- YouTube, banner), A DECISÃO DE QUALIDADE SE REABRE PARA AQUELE USO. O véu é o
-- que sustenta a escolha; sem véu, o argumento cai junto. A coluna `qualidade`
-- existe para que artes de qualidades diferentes convivam no mesmo acervo
-- quando isso acontecer.
--
-- ----------------------------------------------------------------------------
-- farol_arte — uma linha por imagem gerada
-- ----------------------------------------------------------------------------
create table if not exists farol_arte (
  id            uuid primary key default gen_random_uuid(),

  -- Caminho DENTRO do bucket `farol-artes` (ex.: '2026/08/abc123.png'). UNIQUE
  -- porque duas linhas apontando para o mesmo arquivo tornariam impossível
  -- responder "esta arte já foi aprovada?" — a curadoria aprovaria uma linha e a
  -- outra continuaria pendente, servindo o mesmo png por um caminho não curado.
  caminho       text not null unique,

  -- Dimensão REAL do arquivo, em pixels. NÃO É REDUNDANTE COM O PADRÃO DA CASA:
  -- é a entrada do recorte central. O card calcula
  --   escala = max(largura_canvas/largura, altura_canvas/altura)
  -- e centraliza o excedente. Com 1152×2048 numa tela de 1080×1080 isso dá
  -- escala 0,9375, imagem de 1080×1920 e deslocamento vertical de −420px. Se um
  -- dia entrar arte de outra proporção no acervo, o recorte continua correto
  -- sozinho — o que uma constante cravada no componente não faria.
  largura       integer not null,
  altura        integer not null,

  -- --------------------------------------------------------------------------
  -- O QUE A ARTE MOSTRA — e por que só UMA destas três colunas é escrita
  -- --------------------------------------------------------------------------
  -- AUTORIZADO: Emerson — FAROL-ARTE-02, 09/08/2026: "a seleção da arte passa a
  -- ser por tipo da carta + faixa do crédito, com fallback para arte abstrata e
  -- depois para o card de hoje".
  --
  -- `categoria` é a ÚNICA coisa que um humano escreve aqui. 'abstrata' é o
  -- acervo da ARTE-01 (textura e luz, sem objeto): ela serve QUALQUER carta, e
  -- por isso é o primeiro degrau do fallback.
  categoria     text not null default 'abstrata'
                check (categoria in (
                  'abstrata',
                  'veiculo_popular','veiculo_medio','veiculo_alto',
                  'imovel_compacto','imovel_medio','imovel_alto'
                )),

  -- `tipo` e `faixa` são DERIVADAS, e isso é decisão contra um defeito concreto.
  -- As duas são função da categoria — 'imovel_alto' já diz imóvel e já diz alta.
  -- Guardá-las como colunas comuns criaria o estado impossível de detectar:
  -- categoria='imovel_alto' com faixa='baixa', uma linha que mente sobre si
  -- mesma e serve a arte errada sem erro nenhum no caminho. `generated always`
  -- torna a discordância inexprimível em vez de improvável.
  --
  -- NULO EM AMBAS quando a categoria é 'abstrata', e nulo aqui quer dizer
  -- "serve a todos", não "não sei" — é o que faz a consulta do fallback ser um
  -- `or tipo is null` em vez de uma lista de exceções.
  -- Listas explícitas em vez de `like 'veiculo\_%'`: o LIKE aqui dependeria do
  -- backslash escapando o underscore, que é curinga em LIKE — e `standard_
  -- conforming_strings` é o tipo de ajuste de sessão que ninguém confere antes
  -- de rodar uma migração. A lista é mais longa e não tem como sair errada.
  tipo          text generated always as (
                  case
                    when categoria in ('veiculo_popular','veiculo_medio','veiculo_alto')
                      then 'veiculo'
                    when categoria in ('imovel_compacto','imovel_medio','imovel_alto')
                      then 'imovel'
                  end
                ) stored,
  faixa         text generated always as (
                  case
                    when categoria in ('veiculo_popular','imovel_compacto') then 'baixa'
                    when categoria in ('veiculo_medio','imovel_medio')      then 'media'
                    when categoria in ('veiculo_alto','imovel_alto')        then 'alta'
                  end
                ) stored,

  -- O prompt LITERAL que produziu esta imagem. Guardado porque o acervo é
  -- curado: quando uma arte for aprovada e três forem rejeitadas, é este texto
  -- que diz o que diferenciava a aprovada. Sem ele, a curadoria vira gosto sem
  -- memória e o acervo seguinte repete os mesmos erros.
  prompt        text,

  modelo        text,
  -- 'low' | 'medium' | 'high'. Ver a condição de reabertura acima.
  qualidade     text,

  -- --------------------------------------------------------------------------
  -- CUSTO — o `usage` literal, não a extrapolação
  -- --------------------------------------------------------------------------
  -- `uso` recebe o objeto `usage` COMO A API O DEVOLVEU, sem paráfrase. Isto é
  -- método da casa e não zelo: a tabela de preços publicada cobre três presets
  -- (1024×1024, 1024×1536, 1536×1024) e NÃO cobre tamanho livre — qualquer
  -- número que se calcule para 1152×2048 é extrapolação. Guardar o `usage` cru
  -- é o que permite trocar a extrapolação por medição depois, inclusive
  -- retroativamente, se a OpenAI mudar a conta.
  --
  -- ANOMALIA REGISTRADA na tabela publicada: para o gpt-image-2 o retrato custa
  -- MENOS que o quadrado ($0,165 contra $0,211) apesar de ter 50% mais pixels, e
  -- para o mini a relação se inverte. Preço não é proporcional a pixel. Mais uma
  -- razão para esta coluna existir.
  uso           jsonb,
  -- Preenchido só quando houver número MEDIDO. Nulo significa "não medido" e
  -- nunca "de graça".
  custo_usd     numeric(10,4),

  -- --------------------------------------------------------------------------
  -- CURADORIA — nenhuma arte vai a público sem um humano dizer o nome dela
  -- --------------------------------------------------------------------------
  -- 'pendente' é o default DE PROPÓSITO: a rota de geração insere sempre como
  -- pendente e NADA no código escreve 'aprovada'. Só o painel escreve, e só
  -- depois da confirmação nominal. Uma arte recém-gerada não pode ser sorteada
  -- para um post por acidente de ordenação.
  status        text not null default 'pendente'
                check (status in ('pendente','aprovada','rejeitada')),
  aprovado_por  text,
  aprovado_em   timestamptz,
  -- Por que foi rejeitada. Vale tanto quanto o prompt para o acervo seguinte:
  -- "saiu com algo parecido com texto no canto" é a rejeição que mais importa
  -- registrar, porque é a que testa a regra inegociável.
  motivo        text,

  -- Quantas vezes esta arte já foi servida, e quando foi a última. Serve à
  -- mesma doutrina da JANELA ANTI-REPETIÇÃO das cartas: o perfil não pode
  -- exibir o mesmo fundo dois dias seguidos. Contador barato agora; a janela em
  -- si é decisão de quem consumir, não desta migração.
  usos          integer not null default 0,
  usado_em      timestamptz,

  criado_em     timestamptz not null default now()
);

-- A fila da curadoria: pendentes primeiro, mais antigas na frente.
create index if not exists farol_arte_curadoria_idx
  on farol_arte (status, criado_em asc);

-- O sorteio do dia: só aprovadas, e a menos usada / mais antiga na frente.
-- `nulls first` é deliberado — arte aprovada e nunca usada tem usado_em nulo e é
-- exatamente a que deve sair primeiro.
--
-- `tipo` e `faixa` ENTRAM NA FRENTE porque a consulta do card filtra por eles
-- antes de ordenar: a busca é "aprovadas, deste tipo, desta faixa, a menos
-- usada". Índice em (status, usos, usado_em) atenderia a ordenação e obrigaria
-- o filtro a rodar depois — que num acervo de dezenas não dói, e é justamente
-- por isso que o erro sobreviveria até o acervo crescer.
create index if not exists farol_arte_sorteio_idx
  on farol_arte (status, tipo, faixa, usos asc, usado_em asc nulls first);

alter table farol_arte enable row level security;

comment on table farol_arte is
  'Acervo de fundos do FAROL. O modelo generativo pinta APENAS fundo, textura e luz — nunca número, valor, percentual ou nome de administradora, que continuam saindo do gerador determinístico por cima do véu navy 78%. status=aprovada é escrito só pelo painel de curadoria, com confirmação nominal; nada no código automatiza essa transição. largura/altura alimentam o recorte central. `uso` guarda o usage literal da API porque o preço de tamanho livre não é publicado. categoria é a única coluna de conteúdo escrita por humano; tipo e faixa são generated always a partir dela, para que nenhuma linha possa dizer imovel_alto e faixa baixa ao mesmo tempo. Arte FIGURATIVA (categoria <> abstrata) obriga o card a exibir "Imagem ilustrativa": a carta é crédito, não o bem da foto.';
