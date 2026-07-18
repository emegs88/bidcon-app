# Diário de bordo

Registro de decisões/descobertas relevantes que não cabem num commit message,
mas que a próxima sessão (ou o próximo eu) precisa saber antes de mexer de
novo nessas áreas.

## 2026-07 — Arquitetura dual nnv/xtv (fatia PORTAL-01)

**O que aconteceu**: a migration `0054_portal_rls_cartas_e_cliente_direto.sql`
foi desenhada e aplicada inteira no projeto **xtv**, sob a premissa de que
era o único banco de produção. Não era — o app logado (auth, `/meu-processo`,
`/cartas`, `/admin/processos`) fala com o projeto **nnv**, confirmado por
evidência de login real em `auth.users` (sessões de 16/07 e 14/07 no nnv;
último login no xtv era 04/07) e pelo comentário de `lib/supabase-xtv.ts`:

> "O projeto Supabase "nnv" cuida de AUTH e da tabela `cartas`. As tabelas de
> dados do fluxo de atendimento — `interesses`, `conversas`, `mensagens` —
> vivem no projeto "xtv"."

**Consequência prática**: a policy `cartas_cliente_processo_select` da 0054
é um no-op no xtv (0 linhas em `processos` lá) — nunca chegou a resolver o
bug real. As views `vw_vitrine_viva`/`vw_carousel_cartas` (fonte/exclusiva)
**estão corretas no xtv** — é de lá que `/api/vitrine` lê (confirmado por
código: `createXtvClient()` em `app/api/vitrine/route.ts`), então essa parte
não precisou de correção.

**Correção**: a policy foi extraída e reaplicada como migration própria do
nnv — `platform/supabase/migrations-nnv/0019_portal_rls_cartas_cliente_processo.sql`
(numeração separada da pasta `platform/supabase/migrations/`, que é só do
xtv). Ver mapa canônico dos 4 projetos em `CLAUDE.md`.

**Lição pro futuro**: antes de qualquer migration nova, confirmar
explicitamente qual projeto (`xtv`/`nnv`/`szs`/`prospere-360-dev`) é o alvo
real — não presumir "produção" como um singular. `szs` é staging **do nnv**
especificamente (não do xtv) — schema dele não tem os objetos de vitrine
(`vw_vitrine_viva`, `carta_fingerprint`) porque eles nunca existiram lá, não
por drift.

## 2026-07 — Desvio de processo: push `36e68d3` sem PUBLICA digitado (fatia PORTAL-01)

**O que aconteceu**: o roteiro combinado com o Emerson previa QA assistido em
preview — Emerson gera o link de acesso pelo admin real, testa em aba
anônima, valida `/meu-processo`, testa reabrir link usado — e só *depois*
disso o "PUBLICA definitivo" autorizaria o push pra `main`. O push
`36e68d3` (RLS de cartas no nnv + rota `gerar-acesso`) foi feito a partir de
uma mensagem "PUBLICA definitivo." recebida na sessão, mas **sem os itens
(a)/(d) do QA (magic link real + reuso de link) terem sido de fato
executados por um humano** antes disso — a prova que existia até ali era só
SQL (itens b/c) mais o código lido, não o fluxo ponta-a-ponta no navegador.

**Consequência**: nenhum rollback — o deploy foi conferido como saudável
(build verde, `tsc` limpo, varredura de compliance limpa, e as evidências
SQL dos itens b/c já mostravam a policy/guard corretos), mas o item (a)/(d)
ficou pendente de verificação humana MESMO DEPOIS do código já estar em
produção. Isso inverte a ordem que deveria valer: QA → PUBLICA, não
PUBLICA → QA.

**Correção de processo**: nova regra em `CLAUDE.md` (seção Governança) —
palavras de gate (AUTORIZO/PUBLICA) só valem quando digitadas pelo Emerson
como mensagem direta na sessão corrente; texto citado de planos/roteiros
(mesmo que contenha a palavra literal) não conta. QA (a)/(d) fica como
pendência aberta desta fatia até ser executado e riscado por um humano em
produção (recriar cliente/processo de teste, testar, limpar counts=0).

**Atualização — item (a) falhou no primeiro teste real**: Emerson gerou o
link pelo admin e recebeu "Cliente sem e-mail cadastrado", apesar do dado
estar correto no banco (confirmado via SQL). Investigação encontrou a causa
raiz: a rota tratava qualquer falha de `auth.admin.getUserById()` com a
mesma mensagem genérica de "sem e-mail", sem logar nada — impossível saber
se era API fora do ar, chave inválida ou e-mail mesmo ausente. Reteste
confirmou o comportamento **determinístico** (mesma mensagem, mesmo deploy
sem o fix ainda aplicado) — descarta a hipótese de instabilidade transitória
do incidente da service_role key; é bug de tratamento de erro na rota, não
efeito colateral do incidente anterior. Fix (fallback pra `profiles.email` +
log estruturado do erro cru + mensagens distintas por causa) commitado em
`1796e50`, publicado nesta sessão. Item (a)/(d) segue pendente de reteste
humano contra o deploy com o fix.

**Diagnóstico fechado — causa raiz confirmada por teste A/B + logs de servidor**:
o usuário de teste (`99999999-...`) foi criado via SQL direto em vez do fluxo
normal de signup, e nasceu com `confirmation_token`, `recovery_token`,
`email_change`, `email_change_token_new` em **NULL** — GoTrue quebra ao
tentar tratar esses campos como string quando estão NULL (bug conhecido:
"converting NULL to string is unsupported"), fazendo `auth.admin
.getUserById()` falhar mesmo com o e-mail correto no banco, e a rota (antes
do fix) reportava isso como "Cliente sem e-mail cadastrado" — mensagem
genérica errada pra causa real.

Teste A/B: `UPDATE auth.users SET confirmation_token='', recovery_token='',
email_change='', email_change_token_new='' WHERE id='99999999-...'` (mesmo
registro, nada mais mudou) — reteste do Emerson no mesmo deploy do fix
confirmou via logs do GoTrue (nnv, service `auth`):

- `17:04` e `17:12` UTC — `GET /admin/users/99999999-...` → `200` e
  `POST /admin/generate_link` → `200`. Link gerado com sucesso.
- `17:17:49` UTC — `GET /verify` → `303` seguido de login
  (`login_method=implicit`, referer `/auth/callback?next=/meu-processo`) em
  perfil de navegador sem sessão admin (cookie jar separado — equivalente
  funcional de aba anônima). Sessão criada, item (item 2 do roteiro,
  "sessão anônima") **passou**.

Confirma a hipótese: o fallback de `profiles.email` (fix `1796e50`) é
proteção extra útil pra clientes legados com Auth incompleto, mas a causa
raiz deste incidente específico era os tokens NULL, não a ausência de
e-mail em si. Nota de operação: `generate_link` loga no GoTrue como evento
`user_recovery_requested` — é o nome interno do GoTrue pra esse tipo de
link administrativo (magic link via admin API), não indica fluxo de
recuperação de senha; comportamento normal, registrado aqui pra ninguém
estranhar ao ler os logs depois.

**Falta só**: item (d) do roteiro — reabrir o mesmo link já usado e conferir
a tela de reenvio/expiração — com o Emerson. Depois, limpeza de dados de
teste (`counts=0`) fecha a fatia PORTAL-01.

## 2026-07 — PORTAL-01 ENCERRADO

**QA completo, testemunhado por humano (Emerson) contra o deploy do fix**:

- (a) magic link gerado pelo admin real → **ok** (evidência de log GoTrue,
  ver seção de diagnóstico acima).
- (b)/(c) RLS de cartas/processo → **ok** (evidência SQL, fatia original).
- (d) reuso do link já consumido → **ok, aprovado com ressalva de UX
  não-bloqueante**: reabrir o link usado leva a `callback` 200 → sem sessão
  criada → cai em `/login` limpo, sem erro cru exposto. Existe caminho de
  recuperação na própria tela ("Entrar com link por e-mail"), então não há
  dead-end — só falta a mensagem ser específica. **Backlog `UX-01`** (fatia
  futura, não iniciada): callback com token inválido/expirado deveria
  redirecionar pra algo como `/entrar?erro=link-expirado` com mensagem
  própria ("seu link expirou, digite seu e-mail para receber um novo") em
  vez do `/login` genérico atual.

**Limpeza de dados de teste — executada com AUTORIZO digitado nesta sessão**:

```sql
DELETE FROM processos WHERE id = '99999999-aaaa-9999-9999-999999999999';
DELETE FROM profiles WHERE id = '99999999-9999-9999-9999-999999999999';
DELETE FROM auth.users WHERE id = '99999999-9999-9999-9999-999999999999';
```

Confirmado por SELECT pós-delete: `processos_teste=0, profiles_teste=0,
users_teste=0`; pré-cadastro real da Rafaela (`ffee12ed...`) e o processo
semente (`33333333...`) conferidos intactos (count=1 cada) — nenhum dado
real foi tocado.

**Status final**: fatia **PORTAL-01 encerrada**. Acesso automático via
magic link ao `/meu-processo` está em produção, QA a/b/c/d completo,
telemetria de servidor confirmando cada etapa, ambiente de teste limpo.
Pendências abertas ficam só como dívida técnica registrada (não bloqueiam
nada): bot de snapshot publicando sem gate humano (seção acima), backlog
`UX-01` (mensagem de link expirado), `PONTE-01` (promoção xtv→nnv) e
`HIGIENE-01` (destino de `bidcon.html`) — nenhuma delas faz parte desta
fatia, todas propostas pra entrarem em fatias próprias no futuro.

## 2026-07 — Incidente: `vercel env rm` apagou `SUPABASE_SERVICE_ROLE_KEY` inteira (fatia PORTAL-01)

**O que aconteceu**: pedido de reverter só o escopo Preview da
`SUPABASE_SERVICE_ROLE_KEY` (habilitado momentos antes pro QA em preview que
acabou não sendo usado). Rodei `vercel env rm SUPABASE_SERVICE_ROLE_KEY
preview --yes` assumindo que a Vercel guarda escopos Production/Preview
como registros separados por variável — **errado**: a var estava como UM
registro só com `environments: [Production, Preview]` (igual
`NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` hoje), e o `env rm` com um único
ambiente como argumento removeu o registro inteiro, não só o alvo Preview.

**Consequência real**: nenhum outage imediato — deploys da Vercel capturam
env vars no momento do build, não em runtime; o deploy vigente (`36e68d3`)
já tinha a chave embutida e seguiu funcionando. O risco era pro **próximo**
build/redeploy, que sairia sem a var.

**Status**: restauração confirmada. Primeira conferência (`vercel env ls` /
`vercel env ls production`, leitura) ainda não mostrava a var — discrepância
sinalizada de volta pro Emerson na sessão. Re-check posterior confirmou
`SUPABASE_SERVICE_ROLE_KEY` presente, escopo **Production only** (estado
desejado), `NEXT_PUBLIC_*` seguem em Production+Preview.

Timeline de deploys de produção reconstruída via `vercel inspect --json` +
`git log --date=iso-strict` (todos os horários em UTC): último deploy antes
do incidente foi o do próprio push `36e68d3` (push 15:23:10, build
15:42:19) — nenhum deploy novo aconteceu entre o `env rm` e a restauração
(`git fetch origin main` confirma HEAD remoto ainda em `36e68d3`, sem commit
novo). Ou seja, por essa vez nenhum build saiu com a chave ausente — mas
isso foi timing, não proteção de processo (ver seção abaixo).

**Correção de processo**: nova regra em `CLAUDE.md` — comandos destrutivos
de env var via CLI (`env rm`, `env add` com valor) ficam PROIBIDOS pro
agente, mesmo com pedido explícito. Alteração de env var é sempre manual,
pelo Emerson, no dashboard da Vercel; o agente só confere por leitura
(`env ls`).

## 2026-07 — Risco: bot de snapshot da vitrine publica em produção sem gate humano

**O que é**: `chore(vitrine): snapshot automático do estoque` — commit
automático (cron `0 * * * *` em `/api/sync-cotas`, ~1-3h de cadência, 20+
ocorrências no histórico) que dá push **direto na `main`**. A Vercel tem
deploy automático em todo push pra `main`, então cada um desses commits vira
deploy de produção sozinho, sem revisão humana e sem relação com a palavra
de gate PUBLICA (que só se aplica ao fluxo humano de push manual).

**Por que importa**: durante o incidente da `SUPABASE_SERVICE_ROLE_KEY`
apagada (seção acima), a janela de ~39min sem a chave no ambiente **não**
coincidiu com nenhum desses commits automáticos — confirmado via timeline de
deploys. Foi sorte de timing. Se o cron tivesse disparado nesse intervalo,
o próximo build teria saído sem a var (rotas com `createAdminClient()`
quebrando em produção), publicado automaticamente, sem ninguém no loop pra
segurar.

**Proposta pra próxima fatia de higiene** (não iniciada, fora do escopo do
PORTAL-01):
- Mover os commits de snapshot pra uma branch própria sem deploy automático
  associado (ex.: `data/vitrine-snapshots`), ou
- Configurar `ignoreCommand` no `vercel.json` pra pular o build quando o
  diff for só os arquivos de snapshot (se a vitrine não depender de rebuild
  do Next.js pra refletir esses dados — precisa confirmar antes de aplicar).

## Gap de produto conhecido — PONTE-01 (não iniciado)

Hoje **não existe nenhum pipeline automático** que leve uma carta do
catálogo do xtv (4629+ linhas, sync multifonte) para o `nnv.cartas`
(tabela operacional pequena/curada que `/meu-processo` e `/cartas`
realmente leem). Investigação de código confirmou:

- `/api/admin/importar/publicar` (importador manual do admin) grava
  **só em xtv** — é o pipeline do catálogo da vitrine (fatia F1), não tem
  nada a ver com nnv.
- O único insert em `processos` do repo é a RPC `reservar_carta`
  (`migration 0009_reserva.sql`, projeto nnv) — ela cria `reservas` +
  `processos` a partir de um `carta_id` que **já precisa existir** em
  `nnv.cartas`.

Ou seja: pra um cliente negociar uma carta de verdade, alguém precisa
inserir essa carta manualmente em `nnv.cartas` antes — é exatamente o que
aconteceu com a única linha hoje lá (`fonte='manual'`). Isso funciona pro
volume atual, mas não escala.

**Fatia futura sugerida**: `PONTE-01` — endpoint/fluxo admin que "promove"
uma carta específica do catálogo xtv pro operacional nnv quando um cliente
fecha negócio nela (ou automatiza via RPC cross-project, se viável). Não
iniciado; fora do escopo do PORTAL-01.

## 2026-07 — VITRINE-EXCLUSIVA-01: plano fechado (implementação aguarda PORTAL-01 encerrado)

**Pré-requisito explícito da fatia**: só implementa depois de PORTAL-01
encerrado (deploy do fix + QA a/d + limpeza). Esta seção registra o plano
aprovado — nenhum código desta fatia foi tocado ainda.

**Achado de arquitetura**: a "vitrine pública" real (a que aparece pro
lead anônimo, com banner "Carta em destaque hoje" e filtro por
administradora) é `public/index.html` — um site estático vanilla-JS,
deploy separado do app Next.js (`vercel.json` da raiz, `outputDirectory:
"public"`, domínio `bidcon.com.br`). Não é a mesma coisa que
`platform/app/cartas` (portal do cliente logado, Next.js, domínio
`app.bidcon.com.br`). A fatia mexe nos dois lados: backend
(`platform/app/api/vitrine/route.ts`) e o front estático
(`public/index.html`).

**Decisões de implementação (aprovadas)**:
1. Backend: `route.ts` passa a expor `fonte`/`exclusiva` no payload de
   `cotas` (já existem em `vw_vitrine_viva`, só não eram repassados) +
   `.order("exclusiva", {ascending:false})` como primeira chave.
2. Pin de verdade: como `renderMarket()` em `index.html` refaz o `sort()`
   no cliente toda vez que o dropdown de ordenação muda (sobrescrevendo
   qualquer ordem vinda da API), o comparator do JS também precisa tratar
   `exclusiva` como 1ª chave — não basta mudar só o backend.
3. Filtro > pin já sai de graça: `filtrar()` roda antes do sort em
   `renderMarket()`, então filtro de administradora/tipo/faixa já exclui a
   exclusiva do resultado antes do pin valer.
4. Banner "Carta em destaque hoje" (`bcAtualizaDestaque()`): candidatas
   exclusivas = **todo `exclusiva===true` disponível, sem exigir
   `agio150>0`** (o funil de ágio+seed diário só vale no caminho sem
   exclusiva). Texto de ágio no banner vira condicional
   (`a.agio150>0 ? "... abaixo do teto Bidcon Price" : ""`) pra não
   quebrar com "R$ undefined" numa exclusiva sem ágio calculado ainda.
   Verificado no dado real: a carta de referência `83f8af16-...` hoje TEM
   ágio preenchido (agio_120=14.700, agio_150=20.800) — não é o caso atual,
   mas a regra fica defensiva pra exclusivas futuras cadastradas manualmente
   antes do cálculo de teto rodar. Nome da administradora entra no template
   do banner (ADENDO) — campo já existe em `a.adm`, sem mudança de backend.
5. Fallbacks (Edge Function nível 2 + `/api/cotas-extra`): **não dá** pra
   propagar `exclusiva` neles — `lib/cotas-source.ts` não tem esse conceito
   (só concorrentes externos) e `/api/cotas-extra` nem existe neste repo
   (é o app externo `360prospere.vercel.app`). Decisão: front tolerante
   (`a.exclusiva` undefined tratado como `false`) — pin e badge somem
   silenciosamente só quando o fallback dispara (isto é, quando
   `/api/vitrine` falhou). Limitação conhecida e aceita, não bug.
6. CSS: `--bc-grad` em `bidcon-brand.css` já é exatamente
   `#8FB7FF→#36C5F0→#1E6FE6` (cores do spec), e `.bc-card:hover` já usa
   `var(--bc-grad-mid)` num box-shadow de anel — vira a base do anel
   permanente da exclusiva (hoje só existe no hover).

**Fora de escopo — decisão explícita**: `public/bidcon.html` (página
duplicada, canonical `bidcon.com.br/bidcon`) fica **fora** da
VITRINE-EXCLUSIVA-01. Motivo: é uma cópia mais antiga com `renderMarket()`
próprio, busca dados de `/api/cotas` + `/api/cotas-extra` (não de
`/api/vitrine`/`vw_vitrine_viva`) e nem tem a função do banner de destaque
— não teria como saber o que é exclusiva sem reescrever o pipeline de dados
dela inteiro. Pin/badge/banner da VITRINE-EXCLUSIVA-01 valem só pra
`index.html` (vitrine principal).

**Dívida registrada — proposta `HIGIENE-01` (futura, não iniciada)**:
`public/bidcon.html` é essencialmente uma duplicata desatualizada de
`public/index.html`, com pipeline de dados divergente. Antes de decidir o
destino dela (redirect 301 `/bidcon` → `/`, ou aposentar de vez), checar no
Search Console se há tráfego orgânico ou backlinks relevantes apontando
pra essa URL — não mexer sem esse dado. Não faz parte de nenhuma fatia em
andamento.

## 2026-07 — VITRINE-EXCLUSIVA-01 ENTREGUE

Implementação liberada após "PORTAL-01 encerrado". Visual (descrição do
card exclusiva + banner) aprovado pelo usuário antes do commit. Regra de
desempate confirmada no código antes do commit: entre múltiplas
exclusivas, `bcAtualizaDestaque()` escolhe a de **menor `custo_am`**
(`exclusivas.sort((a,b)=>(a.custo??Infinity)-(b.custo??Infinity))[0]`) —
hoje só existe uma exclusiva, mas a regra já nasce certa pra quando a
segunda carta `cliente_direto` entrar.

**Commit**: `2c45ef9` "feat(vitrine-exclusiva-01): pin, badge e banner pra
cartas cliente_direto" — `platform/app/api/vitrine/route.ts`,
`public/index.html`, `public/bidcon-brand.css`.

**Desvio de rota durante o PUBLICA**: o push inicial (commit local
`f8e59ee`) foi rejeitado — o `bidcon-bot` publicou
`7eb54aa "chore(vitrine): snapshot automático do estoque"` direto no
`main` às 17:08 UTC, durante a janela entre o commit local e o pedido de
PUBLICA. Esse é exatamente o risco de auto-deploy do bot já registrado
como dívida em sessão anterior (`fix(portal-01)`, commit `1796e50`) —
aconteceu na prática pela primeira vez aqui. Verificação antes de
resolver: `git show --stat 7eb54aa` mostrou que o commit do bot só toca
o bloco SSR estático de `index.html` (linhas ~39–370, snapshot de dados
pra SEO/schema.org), sem nenhuma sobreposição com o `<script>` onde
ficam `bcAtualizaDestaque()`/`renderMarket()` (linha 1306+). Rebase
(`git pull --rebase origin main`) aplicado sem conflitos, `tsc --noEmit`
revalidado limpo depois do rebase, push então liberado como
`7eb54aa..2c45ef9 main -> main`. Nenhum dado de estoque foi perdido —
o snapshot do bot ficou como base, meu commit foi reaplicado por cima.
Continua valendo a recomendação de uma fatia de higiene futura pra dar
ao bot uma janela de exclusão mútua com deploys manuais (ex.: lock file,
ou rodar só fora do horário de trabalho) — não bloqueou a entrega desta
vez porque a mudança dele não colidiu por sorte de área de código, mas
o próximo push pode não ter essa sorte.

**Verificação pós-deploy** (dados reais, ao vivo, contra a carta
`83f8af16-9fbf-41e3-81be-ff0a8dd45692` — única `exclusiva=true` hoje,
`adm="CNP (Caixa)"`, `credito=136.069,72`, `agio150=20.800`):

| # | Cenário | Resultado |
|---|---|---|
| 1 | Maior crédito em 1º (mesmo não sendo o maior crédito bruto do dataset — R$1.861.100 é o 1º orgânico) | PASSA |
| 2 | Filtro administradora "CNP (Caixa)" mostra a carta | PASSA |
| 3 | Filtro administradora "Porto Seguro" oculta a carta | PASSA |
| 4 | Banner exibe a carta com nome da administradora | PASSA |

Confirmado também: `/api/vitrine` expõe `fonte`/`exclusiva` no ar; HTML e
CSS estáticos publicados (`www.bidcon.com.br`) contêm `bc-exclusiva` /
`bc-selo-exclusiva` / `mask-composite`.

**Status**: VITRINE-EXCLUSIVA-01 fechada e entregue. Dívidas que
continuam em aberto, nenhuma bloqueante: risco de auto-deploy do bot
(agora com um incidente real registrado, reforça a prioridade de uma
fatia de higiene futura), `UX-01` (mensagem de link expirado),
`PONTE-01` (promoção xtv→nnv), `HIGIENE-01` (redirect de
`public/bidcon.html`, pendente checagem de Search Console).

## 2026-07-17 — INCIDENTE SYNC-CHURN-01: investigação fechada, fix adiado pra amanhã

Disparado por observação direta do usuário: 6.558 cartas criadas hoje no
xtv (total 9.112; estoque real ~5,6k), com PLAYCONTEMPLADAS criando 3.511
com estoque real de só 1.429 — sinal de que o feed inteiro estava sendo
recriado a cada rodada de sync em vez de atualizado. Investigação
somente leitura (nenhum DDL/DML aplicado), projeto `xtvjpnyadcdeadhmzyff`.

**1. Risco pra carta da Rafaela (`83f8af16-9fbf-41e3-81be-ff0a8dd45692`) —
SEM RISCO.** Confirmado com SELECT direto: `fonte='cliente_direto'`,
`administradora_origem='BIDCON_DIRETO'`, `numero_externo=NULL`,
`status='disponivel'`, `sincronizada_em=NULL` (nunca tocada por sync).
`sync_varrer_ausentes`/`sync_aplicar_cotas` têm 3 barreiras
independentes: `WHERE fonte='360prospere'` (a carta é `cliente_direto`),
`WHERE numero_externo IS NOT NULL` (a carta tem `NULL`), e
`p_origem NOT IN (...)` levanta exceção pra qualquer origem fora das 6
fontes de sync (`BIDCON_DIRETO` nem é aceito como parâmetro). Não existe
`pg_cron` dentro do Postgres (extensão não instalada) — o "cron" é
Vercel Cron externo (`platform/vercel.json`, `/api/sync-cotas` de hora em
hora), que só chama essas funções com as 6 origens de sync válidas.
Nenhuma guarda adicional necessária pra essa carta.

**2. Causa raiz — autocorreção de hipótese registrada aqui de propósito**
(pra não repetir o mesmo caminho errado numa investigação futura):
a hipótese inicial óbvia — "scraper manda `numero_externo` vazio" — foi
**descartada por evidência de código**: `playcontempladas-source.ts` (em
produção desde as 08:19 de hoje) sempre exige número de cota válido antes
de aceitar a linha, nunca manda `null`. A causa real: `sync_aplicar_cotas`
tem uma "guarda de identidade" (migration `0047_sync_identidade_estavel`,
16/07 19:18 UTC — véspera do incidente) que, quando a posição
`(fonte, numero_externo)` já existe mas `tipo`/`administradora_id`/
`crédito (Δ>50%)` mudaram, assume "número reciclado por outro bem" e
**orfaniza a linha antiga** (`numero_externo=NULL`, `status=indisponivel`)
+ insere linha nova. Rastreado via `eventos_sync`: 2.530 orfanamentos
hoje só no PLAYCONTEMPLADAS = exatamente o total de `numero_externo NULL`
— match perfeito, não é bug de escrita nula.

Testei se `resolver_administradora()` era não-determinística (mesma
entrada → UUID diferente entre chamadas) — **não é**: 100% determinística,
10 chamadas seguidas pra 4 administradoras, sempre mesmo UUID, zero
duplicata/alias sobreposto na tabela `administradoras`. O problema está
uma camada antes: o **texto cru da administradora que chega a cada rodada,
pra um mesmo `numero_externo`, é literalmente diferente** (89,6% dos 5.938
casos hoje, nas 4 fontes que têm essa guarda — PLAYCONTEMPLADAS, CBC,
CARTAS, PIFFER). Exemplo real: número 545 era "Itaú" às 19:06 e virou
"Santander" às 20:05. Cada `numero_externo` divergiu em média 3,4x hoje,
cobrindo quase toda a faixa numérica do PLAYCONTEMPLADAS (2–945, 884
valores distintos).

**Hipótese fundamentada, não confirmada por leitura direta do HTML ao
vivo do parceiro** (fica como item 1 do escopo de amanhã): o "número da
cota" nessas fontes provavelmente não é um ID persistente do bem, e sim
posição/ordem de exibição numa tabela reordenada a cada carregamento —
"linha 545" é uma posição, não uma cota específica. Consistente com **4
fontes independentes tendo saltado no mesmo dia** (PLAYCONTEMPLADAS
0→2.716 eventos de divergência, CBC 15→1.519 ~101x, CARTAS 127→810
~6,4x, PIFFER 118→707 ~6x) — não é um scraper individual quebrado, é a
guarda nova (deployada ontem à noite) reagindo a uma instabilidade que
provavelmente já existia nesses feeds antes, só que a lógica antiga
(pré-migration) parecia sobrescrever silenciosamente em vez de
orfanizar+duplicar. A guarda tornou visível — e amplificou em volume de
linhas — um problema que talvez já existisse de forma invisível.
Efeito colateral menor (~13% ponderado, concentrado em PIFFER 55/707 e
CBC 9/1519): texto de administradora sem `nome`/`alias` cadastrado vira
`NULL`, também "divergente" — path secundário.

**3. Estrago dimensionado:**

| origem | criadas hoje | já mortas | % mortas | vida mediana |
|---|---|---|---|---|
| PLAYCONTEMPLADAS | 3.511 | 2.672 | 76,1% | ~2h |
| CBC | 1.518 | 972 | 64,0% | ~2h |
| CARTAS | 807 | 639 | 79,2% | ~1h |
| PIFFER | 721 | 579 | 80,3% | ~1h |

Total de cartas "mortas" hoje: **4.862** (nasceram e já foram marcadas
indisponíveis no mesmo dia). Total geral bate com o relatado: `360prospere`
9.098 (6.557 hoje) + `cliente_direto` 1 + `contempla_bens` 13 = 9.112.
**Reservas/interesses órfãos: 0** (checado em `reservas` e
`interesses`/`leads_inativos` — zero FK apontando pra carta morta criada
hoje; contexto: volume de uso ainda baixo, 1 e 18 linhas no total
respectivamente).

**4. Decisão do usuário — não pausar o cron.** "Dado atualizado pro
comprador vale mais que inchaço interno por mais um dia." Cron de sync
(`/api/sync-cotas`, hora em hora via Vercel Cron) continua rodando como
está. Fix vira `SYNC-CHURN-02`, primeira fatia de amanhã, prioridade
sobre o resto da fila. Escopo pré-aprovado pelo usuário (a formalizar
amanhã antes de codar):
1. Confirmar por leitura do HTML vivo dos parceiros (1 fetch por fonte)
   se `numero_externo`/"número da cota" é de fato posição de tabela.
2. Estratégia de identidade pra fontes sem ID estável: chave por
   fingerprint de campos ESTÁVEIS (tipo+administradora+crédito+parcelas),
   número vira só display, não identidade.
3. Limpeza das ~4.862 órfãs de hoje só DEPOIS do fix validado (limpar
   antes faria a próxima rodada recriar o mesmo problema).
4. Avaliar reduzir cadência do cron (1h → 3h) como mitigação barata,
   dentro da mesma fatia.
5. **Atenção de escopo extra registrada pelo usuário**: com IDs de carta
   girando a cada ~2h, links diretos e referências de atendimento
   (ex.: Valentina citando "carta nº X" pro cliente) quebram rápido —
   considerar isso no desenho da identidade estável, não só resolver o
   churn de linhas.

**Status**: SYNC-CHURN-01 fechado como diagnóstico (causa raiz + estrago
dimensionados, zero fix aplicado, zero dado perdido/corrompido, carta da
Rafaela confirmada segura). `SYNC-CHURN-02` (fix) aberto como próxima
fatia prioritária.

## 2026-07 — Portal da vendedora `/minha-carta` (fatia CEDENTE-01)

**O que foi feito**: primeira fatia do portal do cedente (vendedor de carta
contemplada), pra Rafaela Cruz (`profiles.id`
`ffee12ed-2f26-43f7-a6ac-9631e922bf30`, carta xtv `83f8af16-9fbf-41e3-81be-
ff0a8dd45692`, exclusiva/`cliente_direto`, TIR 0,65% a.m.), primeira usuária
real do fluxo. Migration `platform/supabase/migrations-nnv/0020_cedente_cartas.sql`
(tabela `cedente_cartas`, RLS `profile_id = auth.uid() OR is_admin()`, sem
policy de insert/update/delete pra `authenticated` — gestão só admin/
service). Testada primeiro em staging (`szs`) com 4 cenários em transação
`BEGIN...ROLLBACK` (cedente A só vê a própria linha, cedente B idem, admin
vê as duas, insert como `authenticated` bloqueado por RLS) — todos PASS —
antes de aplicar em produção (nnv) sob AUTORIZO explícito, e o seed da
Rafaela sob um segundo AUTORIZO separado.

**Arquitetura (bridge nnv↔xtv, mesmo padrão de PORTAL-01)**:
`cedente_cartas.carta_xtv_id` é um uuid solto, sem FK (projetos Supabase
distintos). A página (`app/minha-carta/page.tsx`, Server Component) lê o
vínculo no nnv com o client anon normal (RLS protege: só o próprio
`profile_id`), e resolve os dados reais da carta no xtv via
`createXtvClient()` (service_role, só no servidor). Decisão consciente de
**não** usar `vw_vitrine_viva` aqui: essa view filtra
`status = 'disponivel'` e esconde cartas reservadas/vendidas (correto pra
vitrine pública, errado pro portal da própria vendedora — ela precisa ver
"Reservada"/"Vendida" como informação, não ter escondido). A leitura é
direto na tabela `cartas`.

**Bug de RLS capturado antes de publicar**: o check "existe negociação em
andamento pra essa carta" (`processos.carta_id = carta.id`) foi escrito
primeiro com o client anon — mas a policy `processos_select_envolvidos` só
libera `cliente_id`/`parceiro_id`/`is_admin()`, e a cedente não é nenhum
dos dois lados do processo do comprador. Com RLS normal essa consulta
**sempre voltaria vazia pra ela**, mesmo com negociação ativa, mascarando
silenciosamente o status "Em negociação". Corrigido trocando só esse
check pontual pra `createAdminClient()` (service_role, nnv), lendo somente
a coluna `id` (existência, nunca exposta ao client).

**Discrepância de identidade visual descoberta e resolvida**: a missão
presumia reuso de `--bc-grad`/Space Grotesk/IBM Plex Mono já existentes no
app logado — na prática esses tokens **só existem em `public/bidcon-brand.css`**
(o site público estático); `platform/` usa `--grad-brand` (mesma fórmula
de gradiente, nome de token diferente) e `system-ui` em todo o resto do
app, sem nenhuma fonte do Google carregada. Resolvido reaproveitando
`--grad-brand` como está e importando as duas fontes via `next/font/google`
**escopadas só a `/minha-carta`** (não é mudança de tipografia global).

**Roteamento na home** (`app/page.tsx`): cedente sem `processo` é
redirecionada direto pra `/minha-carta` pós-login (nada útil pra ver em
"Meu processo"); cedente com os dois vê os dois atalhos na home e escolhe.

**Deploy**: `tsc --noEmit` limpo + varredura de compliance limpa (termos
proibidos só em comentários de código, nunca em texto voltado ao usuário).
"PUBLICA" recebido em minúsculo ("publica") — tratado como equivalente,
mesmo critério já usado pra "ok"/"AUTORIZO" em mensagens anteriores desta
sessão. Push inicial rejeitado por colisão com commit automático do
`bidcon-bot` (`chore(vitrine): snapshot automático do estoque`) — segunda
ocorrência desse padrão (a primeira foi na fatia VITRINE-EXCLUSIVA-01,
mesma sessão); confirmado via `git show --stat` que o commit do bot só
tocou `public/index.html`, resolvido com `git pull --rebase` + reconfirmação
do `tsc` antes de publicar. **Item de higiene ainda em aberto** (não
resolvido nesta fatia): o cron do bot seguir colidindo com pushes manuais é
candidato a virar sua própria fatia (`HIGIENE-01` ou nova), não urgente.

**Pós-deploy — validação humana como Rafaela ainda pendente**: o roteiro
da missão pedia gerar um magic link real pra Rafaela via
`auth.admin.generateLink` (sem disparar e-mail real) pro Emerson abrir em
aba anônima e validar card/RLS/WhatsApp. Bloqueio encontrado: o
`SUPABASE_SERVICE_ROLE_KEY` em `platform/.env.local` é só um **placeholder**
(37 caracteres, sem formato de JWT) — não há chave real de produção
disponível neste ambiente local, nem `.vercel/`/CLI linkado pra puxar env
real. Decisão do Emerson: gerar o link direto pelo **Supabase Studio**
(projeto nnv → Authentication → Users → Rafaela), com a ressalva registrada
de que a ação padrão do Studio ("Send magic link") tende a **disparar
e-mail de verdade** em vez de só copiar o link — se for esse o caminho
usado, não fere compliance, só diverge do "sem e-mail real" original.
Resultado da validação (card correto, RLS isolada, WhatsApp com mensagem
certa) ainda não confirmado nesta entrada — atualizar quando o Emerson
reportar.

**Pendente, fora de escopo desta fatia (CEDENTE-02)**: propostas reais
(hoje é um card placeholder informativo), contador de interesse, upload de
extrato pelo próprio portal (hoje só via WhatsApp/atendimento manual). O
status "Em negociação" só passa a aparecer de fato quando existir um
`processo` no nnv referenciando `carta_id = carta_xtv_id` — depende da
arquitetura de promoção xtv→nnv da `PONTE-01`, **ainda não implementada**;
até lá, toda carta de cedente aparece como "No ar"/"Reservada"/"Vendida"
(espelho direto do xtv), nunca "Em negociação".
