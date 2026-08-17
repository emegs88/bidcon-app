# AUDITORIA-PAINEL-01 — o mapa honesto do que existe

**Autorizado:** Emerson Gomes dos Santos — 13/08/2026
> "quero analisar o painel de conversas, o admin do app, todas as funções, até
> alerta de confirmação com parceiros, e mostrar o que é o painel do parceiro"

**Natureza:** LEITURA. Nenhum comportamento foi alterado. Nenhuma migração foi
aplicada. As consultas ao banco foram todas `SELECT`. O único arquivo novo é
este documento.

**Regra de ouro aplicada:** para cada item, três colunas — **existe** (arquivo no
disco) · **funciona** (medido: rota no manifesto do build, tabela com linhas,
dado de produção) · **quem enxerga** (qual guarda, e quem passa por ela).

**Base de medição:** ramo `fidc-ofertas-02`, árvore limpa. Manifesto do último
`next build` (`/tmp/build4.txt`, 13/08 17:24). Bancos `xtv`
(`xtvjpnyadcdeadhmzyff`) e `nnv` (`nnvjeijsrwpzsggwqpcu`), lidos em 13/08/2026.

---

## NOTA DE MÉTODO — cinco falhas minhas, antes dos achados

Registro isto primeiro porque um leitor precisa saber o quanto confiar no resto.

Ao mapear as guardas por `grep`, eu produzi **cinco medições erradas seguidas**,
todas do mesmo tipo: o padrão não achava a guarda, e a ausência de resultado
parecia um achado.

1. **Padrão incompleto.** Procurei `ehAdminConsole`, `exigirPapel`,
   `checarFundo`. Faltava `exigirAdminConsolePagina` — 10 páginas de `/admin`
   apareceram como desprotegidas. Não estão.
2. **Maiúsculas.** O padrão de segredo usava `authorization` minúsculo.
3. **A pior.** Ia registrar que `/api/farol/story`, `/carrossel`,
   `/reel-publicar`, `/yt-comenta`, `/pauta` e `/responde` eram chamáveis da
   internet — quatro delas publicam no Instagram ou gastam dinheiro. **São
   guardadas.** A checagem é `autorizadoFarol(req)`, primeira linha de cada
   handler, importada de `lib/farol/selecao`. Meu padrão procurava o segredo
   dentro do arquivo da rota; ele mora no helper.
4. **Vocabulário de segredo incompleto.** `/api/hooks/novo-cadastro` é guardada
   por `HOOK_SECRET`, que não estava na minha lista.
5. **O shell comendo o glob.** `grep --include="*.ts"` sem aspas no zsh devolveu
   **vazio** para um padrão que a ferramenta de busca encontrou em **88
   arquivos**. Vazio que confirmava a hipótese.

**O que fiz:** a partir da terceira, parei de decidir guarda por `grep` e passei
a **abrir cada arquivo**. O mapa do Bloco 1 abaixo foi construído lendo, não
buscando. Os dois sub-agentes que rodaram os Blocos 3 e 4 relataram
independentemente a mesma falha nº 5 — o que a torna um risco do método, não um
descuido isolado.

**O que isso significa para este documento:** onde escrevo "não existe", eu li os
arquivos. Onde não consegui medir, escrevo "não medido" e por quê.

---

## BLOCO 1 — INVENTÁRIO

### Contagem

| | quantidade |
|---|---|
| Páginas (`page.tsx`) | **42** |
| Arquivos de rota | **87** — 86 `route.ts` + 1 `route.tsx` |
| … sob `/api` | 85 |
| … fora de `/api` | 2 (`/auth/callback`, `/auth/signout`) |
| Entradas no manifesto do build | 130 |

**Manifesto × disco: bate.** Toda rota do disco foi construída. O manifesto tem
duas entradas a mais: `/_not-found` (interna do Next) e `/api/card-image/[id]` —
esta última eu tinha perdido no inventário inicial porque o arquivo é
`route.tsx`, não `route.ts`. **Não há tela fantasma e não há tela órfã.**

### As guardas — são QUATRO portas, não duas

A ordem falava em "as duas portas de admin". A medição achou quatro mecanismos
distintos de autorização de pessoa, mais dois de máquina:

| # | Mecanismo | Onde mora | Critério | Fonte da verdade |
|---|---|---|---|---|
| 1 | `exigirPapel(...tipos)` | `lib/auth.ts:57` | `profiles.tipo` | banco **nnv** |
| 2 | `exigirAdminConsolePagina()` · `checarAdminConsoleApi()` | `lib/admin-console.ts` | e-mail na allowlist | **env** `BIDCON_ADMIN_EMAILS` |
| 3 | `exigirFundoPagina()` · `checarFundoApi()` | `lib/fidc-fundos.ts` | vínculo com fundo | banco |
| 4 | `ehEquipeProspere(email)` | `lib/equipe.ts` | e-mail termina em `@prospere.com.br` | **domínio do e-mail** |
| — | sessão simples | inline (`getUser` + `redirect("/login")`) | estar logado | sessão |
| M | `autorizadoFarol(req)` | `lib/farol/selecao` | segredo Bearer | env |
| M | segredo por rota | inline | `DISPARO_SECRET`, `HOOK_SECRET`, `CRON_SECRET` | env |

**`middleware.ts` NÃO é guarda.** Ele só chama `atualizarSessao(request)` para
renovar o cookie do Supabase. O `matcher` cobre quase tudo, o que dá a impressão
de proteção global. Não protege nada.

**Só existem 2 layouts.** `app/layout.tsx` (raiz, sem guarda) e
`app/interno/layout.tsx`, que carrega `exigirPapel("admin")` — é por isso que
`/interno/simulador-disal` e `/interno/simulador-porto` não mostram guarda no
próprio arquivo e ainda assim estão protegidas.

### Mapa por página

| Página | Guarda | Quem enxerga |
|---|---|---|
| `/admin` · `/admin/audit-logs` · `/admin/cartas` · `/admin/comissoes` · `/admin/parceiros` · `/admin/perfis` · `/admin/perfis/[id]` · `/admin/processos` · `/admin/processos/[id]` | `exigirPapel("admin")` | quem tem `profiles.tipo='admin'` no nnv |
| `/admin/conversas` · `/conversas/leads` · `/conversas/extratos` · `/conversas/site/[id]` · `/conversas/whatsapp/[id]` · `/admin/farol` · `/farol/arte` · `/farol/dashboard` · `/admin/importar` · `/admin/revisao` | `exigirAdminConsolePagina()` | quem está em `BIDCON_ADMIN_EMAILS` |
| `/fundo` · `/fundo/ofertas` | `exigirFundoPagina()` | usuário vinculado a fundo |
| `/prospere-ancora` · `/prospere-ancora/importar` | `ehEquipeProspere()` | e-mail `@prospere.com.br` |
| `/interno/simulador-disal` · `/interno/simulador-porto` | `exigirPapel("admin")` **via layout** | admin no nnv |
| `/parceiro` · `/carteira` · `/carteira/[id]` · `/carteira/nova` · `/comissoes` · `/indicacoes` · `/simulador` | `exigirPapel("parceiro","admin")` | parceiro ou admin |
| `/kyc` · `/meu-processo` · `/minha-carta` | sessão simples + RLS | qualquer logado (RLS limita ao próprio) |
| `/` · `/buscar` · `/cartas` · `/cartas/[id]` · `/cadastro` · `/login` · `/reservar` | nenhuma | público |

**Nenhuma rota sem guarda que devesse ter** — com uma ressalva medida:

- `/api/mcp` é **pública por desenho** (o conector MCP da Bidcon). O único
  `Authorization` do arquivo é numa chamada **de saída**, linha 134. Está
  documentado como público; registro para que ninguém o descubra por acidente.
- `/api/processo/esign/webhook` e `/api/processo/sinal/webhook` conferem a
  **presença** da assinatura (401 se faltar), mas a validação contra o segredo é
  um **TODO explícito**, aguardando o provedor. Isto é: hoje qualquer corpo com
  um cabeçalho de assinatura qualquer passa.

---

## BLOCO 2 — AS PORTAS DE ADMIN, E O VÃO ENTRE ELAS

### O vão, descrito com precisão

As duas portas de admin não se cobrem. Elas dividem `/admin` ao meio:

| Alguém com… | chega em | é barrado de |
|---|---|---|
| `profiles.tipo='admin'` **mas fora** da env | `/admin`, cartas, comissões, parceiros, perfis, processos, audit-logs, `/interno/*` | **conversas, farol, importar, revisão** |
| na env **mas sem** `tipo='admin'` | conversas, farol, importar, revisão | **`/admin` e tudo que pende dele** |

**O detalhe que faz isso ser um defeito e não um desenho:** `/admin/page.tsx` — a
página-índice, o menu — é `exigirPapel`. Quem está na allowlist mas não é admin
no nnv **é jogado para `/`** ao abrir `/admin`, e ainda assim alcança
`/admin/conversas` digitando a URL. A porta da frente está fechada e a lateral,
aberta. O inverso também vale: o admin do nnv vê o menu e cada link de
conversas/farol o devolve para `/`.

### Isso está acontecendo hoje?

**Não.** Medido no nnv:

| `tipo` | `status` | quantidade |
|---|---|---|
| cliente | ativo | 30 |
| admin | ativo | **1** |
| parceiro | — | **0** |

Existe **um** admin. É quase certo que seja o mesmo e-mail da allowlist — logo o
vão é **latente**, não vivo. Ele cobra no dia em que entrar a segunda pessoa:
alguém promovido a `admin` no banco não verá o painel de conversas, e ninguém vai
entender por quê, porque a mensagem é um redirecionamento mudo para `/`.

**Não medi o conteúdo de `BIDCON_ADMIN_EMAILS`** — é configuração de ambiente e
eu não leio nem imprimo env em auditoria.

### Por que a divisão existe (e é defensável)

`lib/admin-console.ts` documenta a razão, e ela é boa:

> "Sem RLS reforçando isso no banco … porque os dados que este console maneja
> (cartas/fornecedores/importações) vivem no xtv e são acessados via
> `service_role` (`createXtvClient`) — a única barreira real é esta, na
> aplicação."

Ou seja: onde o banco não pode defender, a lista de e-mails defende. O problema
não é haver duas portas — é elas **não saberem uma da outra**.

### As 8 rotas que refazem a guarda à mão

Oito rotas sob `/api/admin/*` não chamam `exigirPapel` nem
`checarAdminConsoleApi`: fazem `getUser()` e conferem `profiles.tipo !== "admin"`
**inline**, devolvendo 401/403. O resultado é correto hoje. É lógica de
autorização copiada em oito arquivos — oito lugares para esquecer de mudar.

---

## BLOCO 3 — SALA DE CONVERSAS (`/admin/conversas`)

### O achado prioritário do Emerson — medido, e o diagnóstico mudou

**O que o Emerson viu:** a métrica "mediana até a 1ª resposta" mostra `<1 min`
enquanto conversas estão paradas há 5 e 7 dias.

**O que eu esperava achar:** que a mediana escondia essas conversas por
excluí-las.

**O que a medição mostrou** (xtv, 13/08/2026, conversas cuja última mensagem é do
cliente e que não estão encerradas):

| canal | status | agente | espera | já teve 1ª resposta? |
|---|---|---|---|---|
| WhatsApp | `ativo` (bot) | valentina | **7,1 dias** | **sim** |
| WhatsApp | `ativo` (bot) | valentina | **5,5 dias** | **sim** |
| WhatsApp | `humano` | serena (assumida) | 1,9 h | sim |
| Site | — | — | **nenhuma** | — |

Os números do Emerson estão **exatos**. Mas a causa é outra, e é pior.

**As três conversas FORAM respondidas.** `nunca_respondida = false` nas três. Elas
**entram** na mediana — e entram com um tempo pequeno, porque o bot respondeu
rápido à *primeira* mensagem. **Elas puxam a mediana para baixo enquanto estão
abandonadas.**

O defeito não é exclusão. É que **a métrica responde outra pergunta**:

> A mediana mede o reflexo do robô na PRIMEIRA mensagem.
> Ninguém mede a atenção da casa na ÚLTIMA.

A exclusão do `null` (`app/admin/conversas/page.tsx:278`,
`.filter((n): n is number => n !== null)`) existe e é real, mas **não é o que
produziu o `<1 min`** desta vez. E a tela é honesta sobre ela: imprime em
`:363-367` "últimos 7 dias · quem ainda não foi respondido não entra", e
`duracaoCurta(null)` devolve "sem dados" — nunca "0 min".

**Portanto a proposta (a) do Emerson está certa, e por um motivo ainda mais forte
do que o enunciado:** o "pior caso em aberto" não é um complemento da mediana. É
o número que **falta inteiro** — hoje nada na tela diz há quanto tempo a espera
mais antiga está aberta. A métrica 2 ("aguardando resposta") conta **3**, mas é
uma **contagem**, não um **tempo**, e não tem janela nenhuma — é vitalícia.

### (b) Existe alerta quando passa de X horas? — **NÃO**

Varri o repositório. **Não existe alerta, job, e-mail ou notificação que dispare
por tempo de espera.** Nomeio os três quase-acertos para que ninguém os confunda
com o que falta:

| candidato | o que é de verdade |
|---|---|
| `ESPERA_RETENTATIVA_MS` | atraso de retentativa do Instagram |
| `alertarAdminAntiLoop` | dispara quando o bot respondeu **mal** duas vezes — condição oposta |
| `sentinela/varredura` | reengaja **o cliente**; não avisa ninguém interno |
| `lib/notificar.ts` | stub declarado, **zero chamadores** |

O que existe é **sinalização visual passiva**: `ordenarSala` põe a espera mais
longa no topo, `esperaMs` renderiza a duração, o CSS fica âmbar. Tudo isso exige
**alguém já olhando a tela**. Uma conversa com bot ativo fica 7 dias parada
porque nada, em lugar nenhum, puxa a manga de um humano.

**Confirmado: a fatia ALERTA-ESPERA-01 é real e não tem nada pronto.**

### O handoff: três colunas escritas, zero lidas

Medido: **7 conversas** têm `assumido_em` e `atendente_nome` preenchidos.
**`atendente_id` é NULL em todas as 7.**

Por quê: `assumir/route.ts:50-65` só preenche o id se o perfil existir em
`profiles` **consultado pelo `createXtvClient()`** — isto é, no xtv. O xtv tem
**1 linha** em `profiles`; o login acontece no nnv. O `id` nunca casa. O código é
honesto sobre o fallback (o comentário em `:43-47` prevê exatamente isso, e o
e-mail cai em `atendente_nome`) — mas o efeito é que **a identidade pretendida
nunca foi gravada uma única vez em produção**.

Pior: `atendente_nome`, `atendente_id` e `assumido_em` são **escritos num lugar
só e lidos em lugar nenhum**. Nenhuma tela mostra quem assumiu.

`devolver` também não limpa `atendente_nome` nem `assumido_em` — 3 das 7
conversas voltaram para `ativo` (bot) carregando o nome de quem assumiu.
**Isso hoje não mente na tela** justamente porque nada lê esses campos. É
resíduo inerte, não defeito visível. Vira defeito no dia em que alguém exibir a
coluna.

### As 4 métricas do topo

| # | métrica | o que conta | janela |
|---|---|---|---|
| 1 | conversas hoje | criadas desde 00:00 | dia corrente |
| 2 | aguardando resposta | `esperandoHumano()` = último papel é `cliente` e status não é encerrado/fechada | **nenhuma — vitalícia** |
| 3 | cedentes na semana | `l.cedente` no período | 7 dias |
| 4 | mediana até a 1ª resposta | `msPrimeiraResposta` não-nulo | 7 dias (desvio declarado em `:267-271`) |

`esperandoHumano` (`sala.ts:340-346`) **não implementa a segunda condição que o
próprio comentário promete** em `:330` (`status === 'humano'`). O comentário
descreve um filtro mais estreito do que o código aplica.

### Botões: o que faz, e o que não existe

| ação | escreve | pausa o bot | reversível | confirmação | registra na thread |
|---|---|---|---|---|---|
| Assumir (WA) | `status='humano'` + 3 campos | **sim** | sim (Devolver) | 2 passos, nominal | sim |
| Devolver (WA) | `status='ativo'`, zera `respondendo_desde` | volta | sim | 2 passos, nominal | sim |
| Encerrar (WA) | `status='encerrado'` | — | sim | 2 passos, nominal | sim |
| **Responder (WA)** | **envia mensagem pela Meta** | — | **NÃO** | **nenhuma** | sim |
| Assumir/Devolver (site) | idem | — | sim | idem | — |

**O que NÃO existe** (e o operador pode esperar):

- **Responder no canal site.** Só o WhatsApp tem `/responder`. O site tem
  `assumir` e `devolver` e mais nada.
- **Encerrar no canal site.** Não há rota.
- **Marcar como resolvido** — não existe; "encerrado" é o mais próximo.
- **Atribuir a outra pessoa** — não existe. Só "eu assumo".
- **Nota interna** — não existe.
- **Anexos no canal site** — não existem.
- `cedente: false` está **cravado no código** para o canal site
  (`page.tsx:233`) — a métrica 3 é cega a esse canal por construção.
- Os dois canais usam **vocabulários diferentes de status**: `wa_conversas` é um
  enum (`ativo|humano|encerrado`); `conversas` é texto livre
  (`aberta|humano|fechada`). *(Foi exatamente isso que quebrou a minha primeira
  consulta.)*

### O que está bem-feito, e merece registro

- A porta de anexos **audita ANTES de servir** e **nega se o log falhar**
  (`anexo/route.ts:83-92`) — escolha deliberada e documentada.
- `assumir`/`devolver` usam `.neq` no próprio `UPDATE`: clicar duas vezes não
  escreve o handoff duas vezes, e dois operadores clicando juntos não geram
  registro duplo.
- Falha ao registrar na thread **não derruba** a requisição — a pausa é real e o
  operador não é induzido a clicar de novo.

### Volume medido (xtv)

| | |
|---|---|
| `wa_conversas` | 38 — 28 ativo · 4 humano · 6 encerrado |
| `wa_mensagens` | 495 (18 com anexo) |
| `conversas` (site) | 32 |
| `mensagens` (site) | 441 |
| `interesses` | 45 |

---

## BLOCO 4 — O PAINEL DO PARCEIRO

### A pergunta do Emerson, respondida com uma palavra: **NÃO**

> "Existe alguma notificação ou alerta ao parceiro hoje — e-mail, WhatsApp, no
> painel?"

**Não existe nenhuma, em nenhum canal.** Medido:

- `lib/mail.ts` exporta uma função (`enviarEmail`, `:36`) e tem **exatamente 2
  chamadores reais** — `app/api/hooks/novo-cadastro/route.ts:108` e
  `lib/whatsapp/cerebro.ts:357`. **Os dois enviam para `MAIL_ADMIN`.**
- `lib/notificar.ts` é um stub declarado, com **zero chamadores**.
- Não há superfície de notificação no painel.

A ironia que resume o estado: **quando um parceiro se cadastra, quem recebe
e-mail é o admin.** Quando o admin aprova o parceiro, ou vincula uma carta a ele,
**o parceiro não é avisado de nada.**

### "Existe" sem "funciona" — a área inteira

Este é o achado que a regra de ouro procura. Medido em produção (nnv):

| tabela | linhas |
|---|---|
| `profiles` com `tipo='parceiro'` | **0** |
| `comissoes` | **0** |
| `indicacoes` | **0** |
| `cartas` com `parceiro_id` | **0** |
| `cartas` (total, nnv) | 2 |
| `processos` | 3 |

**As 7 telas de `/parceiro` existem, foram construídas, estão protegidas — e
renderizam vazio para todo mundo, porque não há um único parceiro.** Reconcilia
a medição anterior: as cartas da vitrine vêm de `fornecedores` no **xtv**;
`parceiro_id` é do **nnv** e nunca foi preenchido. São dois cadastros diferentes
que o vocabulário do painel trata como um.

### O parceiro vê suas cartas ou todas?

Vê as dele — **mas não pela razão que o código afirma.**

`app/parceiro/page.tsx:33` diz: *"RLS filtra para o próprio parceiro"*. **Isso é
falso para `cartas`.** As policies são PERMISSIVE e somam por **OR**:
`cartas_vitrine_select` (`status='disponivel'`, papel `{authenticated}`) soma com
`cartas_parceiro_select`. Qualquer autenticado enxerga toda carta disponível.

Quem confina de verdade é o `.eq("parceiro_id", uid)` da aplicação (`:41`).
Funciona. Mas o comentário **descreve uma defesa que não está lá** — e é
exatamente o tipo de frase que faz alguém remover o `.eq` achando que a RLS
cobre.

Em `/parceiro/carteira/[id]` a consulta filtra **só por id** (`:37`); a única
defesa é `if (!ehDono && !ehAdmin) notFound()` (`:45`). Correto, e é a única
camada.

### `exigirPapel` ignora `status`

`getSessao` **seleciona** `status` (`lib/auth.ts:41`), e `exigirPapel`
(`:57-63`) confere **apenas `tipo`**. Um parceiro `suspenso` ou
`pendente_aprovacao` tem acesso idêntico ao de um parceiro ativo. Os botões de
`/admin/parceiros` que suspendem a conta **escrevem um campo que nenhuma guarda
lê**.

### O parceiro vê o custo ao mês e a entrada final?

**Não vê nem um nem outro.**

- O `bidcon_custo_am` canônico (TIR por Newton-Raphson) **não existe no nnv** —
  mora no xtv, e nenhuma página de `/parceiro` lê o xtv.
- O "Custo efetivo" mostrado vem de `lib/custo-efetivo.ts`, uma **bisseção sobre
  o valor presente da Price**. É outro número, com a mesma aparência.
- `entrada_parceiro_raw`, `comissao_percentual` e `commission_plan` **existem** na
  tabela e **nunca são selecionados** por tela alguma.
- A comissão calculada e o extrato do que já ganhou: as telas existem
  (`/parceiro/comissoes`), a tabela tem **0 linhas**.

### Navegação

Só **4 das 6** páginas de parceiro aparecem no menu (`ShellNav.tsx:21-26`). As
outras duas só por URL.

---

## BLOCO 5 — CONFIRMAÇÕES E AÇÕES IRREVERSÍVEIS

Existem **quatro vocabulários de confirmação diferentes** no mesmo produto:

| ação | painel | confirmação | nominal? | reversível | quem fez fica registrado |
|---|---|---|---|---|---|
| Disparar publicação | `/admin/farol` | digitar **PUBLICAR** | sim | não | log |
| Destravar reel | `/admin/farol` | digitar **PUBLICAR** | sim | — | log |
| Aprovar arte | `/farol/arte` | digitar **APROVAR** | sim | sim | log |
| Reprovar arte | `/farol/arte` | botão "Confirmar reprovação" | não | sim | log |
| Assumir · Devolver · Encerrar | `/admin/conversas` | **diálogo de 2 passos nomeando a pessoa** | sim (por nome) | **sim** | thread + colunas |
| **Responder no WhatsApp** | `/admin/conversas` | **NENHUMA** | — | **NÃO** | thread |
| Descartar carta | `/admin/revisao` | `window.confirm("Descartar…?")` | **não — genérico** | **NÃO** | log |
| Republicar carta | `/admin/revisao` | botão "Confirmar e republicar" | não | sim | log |
| Habilitar/Suspender parceiro | `/admin/parceiros` | **NENHUMA** | — | sim | — |
| Vincular fornecedor à carta | `/admin/cartas` | **NENHUMA** | — | sim | — |
| Avançar sub-etapa · Confirmar sinal | `/admin/processos/[id]` | **NENHUMA** | — | depende | log |

### Os três achados

**1. A única ação irreversível da sala é a única sem confirmação.**
Assumir, Devolver e Encerrar são todas reversíveis e todas pedem um diálogo de
dois passos que **nomeia a pessoa**. Enviar mensagem pela Meta é **irreversível**
— sai do servidor da Meta para o telefone de um cliente — e vai com um clique.

*Em defesa do que existe:* o desvio da confirmação nominal está **declarado** em
`ConversaAcoes.tsx:21-50`. Com 27 cartões quase idênticos na tela, o risco real
não é clicar sem pensar — é clicar **na linha errada**, e uma palavra digitada
não protege disso. Nomear a pessoa no segundo passo protege. O raciocínio é bom;
ele só não foi estendido ao botão que manda a mensagem.

**2. O "tem certeza?" genérico que a ordem mandou marcar.**
`RevisaoCartaAcoes.tsx:68` — `window.confirm("Descartar esta carta
permanentemente?...")`. É a ação **mais irreversível** de todo o admin ("sai da
fila e não volta a aparecer na vitrine") e usa o diálogo mais fraco disponível:
nativo do navegador, sem nomear a carta, com "OK" como padrão.

**3. Ações que escrevem sem confirmação nenhuma:** suspender a conta de um
parceiro, vincular fornecedor a uma carta, avançar sub-etapa de processo e
confirmar sinal manualmente.

### O que está bem-feito

`lib/farol/confirmacao.ts` é exemplar e explica o próprio desenho:
`PALAVRA_PUBLICAR` e `PALAVRA_APROVAR` são **deliberadamente diferentes**, "para
que o reflexo treinado numa tela não sirva na outra". E o arquivo é lido pelos
dois lados (rota e client) para que a palavra não possa divergir.

---

## BLOCO 6 — O QUE FALTA (8 itens, por prejuízo)

| # | falta | prejuízo | fatia |
|---|---|---|---|
| 1 | **Alerta de espera.** Nada avisa ninguém quando um cliente espera. Medido hoje: 7,1 e 5,5 dias, ambos com bot ativo. | cliente abandonado sem ninguém saber | **ALERTA-ESPERA-01** |
| 2 | **O pior caso em aberto na tela.** A mediana mede o reflexo do bot na 1ª mensagem; ninguém mede a atenção na última. | o painel diz "<1 min" com gente parada há uma semana | **SALA-PIOR-CASO-01** |
| 3 | **Confirmação no envio de WhatsApp.** Única ação irreversível da sala, zero confirmação. | mensagem errada no telefone do cliente | **SALA-CONFIRMA-ENVIO-01** |
| 4 | **Notificação ao parceiro.** Zero em todos os canais; o admin recebe o e-mail do cadastro do parceiro. | parceiro não sabe que foi aprovado nem que vendeu | **ALERTA-PARCEIRO-01** |
| 5 | **`exigirPapel` ignorar `status`.** Suspender a conta não bloqueia nada. | acesso mantido a quem foi suspenso | **GUARDA-STATUS-01** |
| 6 | **As duas portas de admin não se cobrem.** `/admin` (índice) é `exigirPapel`; conversas/farol são a env. | latente hoje (1 admin); cobra na 2ª pessoa | **GUARDA-UNIFICAR-01** |
| 7 | **Descartar carta com `window.confirm`.** A ação mais irreversível do admin, no diálogo mais fraco. | carta some da vitrine por um clique | **REVISAO-CONFIRMA-01** |
| 8 | **Validação de assinatura dos webhooks** de `esign` e `sinal` é TODO. | corpo forjado aceito | **WEBHOOK-ASSINATURA-01** |

**Fora da lista, registrado:** o canal site é um painel pela metade (sem
responder, sem encerrar, sem anexos, `cedente:false` cravado); `atendente_id`
nunca gravado e as três colunas de handoff lidas em lugar nenhum; o comentário
falso sobre RLS em `parceiro/page.tsx:33`; as 8 rotas que refazem `exigirPapel`
à mão; `esperandoHumano` não implementar a condição que o próprio comentário
promete.

---

## O QUE NÃO FOI MEDIDO, E POR QUÊ

- **Conteúdo de `BIDCON_ADMIN_EMAILS`** — configuração de ambiente; não leio nem
  imprimo env em auditoria. O vão do Bloco 2 foi deduzido do código e da
  contagem de admins no nnv, não da lista.
- **Comportamento em tempo de execução das telas** — não subi ambiente nem tirei
  screenshot. Onde escrevo "a tela mostra", é leitura do JSX.
- **Se o único admin do nnv é o mesmo e-mail da allowlist** — depende do item 1.
  Por isso o Bloco 2 diz "quase certo", e não "certo".
- **Logs de uso real das telas** — não há telemetria de navegação no produto.
  "Funciona" foi medido por manifesto de build e por linhas em tabela.
