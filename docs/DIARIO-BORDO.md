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

**Status no momento deste registro**: Emerson reportou ter restaurado a
chave (Production only) via dashboard; conferência via `vercel env ls` /
`vercel env ls production` (leitura, MCP/CLI) **ainda não mostra
`SUPABASE_SERVICE_ROLE_KEY` em nenhum ambiente** — discrepância sinalizada
de volta pro Emerson na sessão, pendente de confirmação/novo re-check antes
de qualquer redeploy.

**Correção de processo**: nova regra em `CLAUDE.md` — comandos destrutivos
de env var via CLI (`env rm`, `env add` com valor) ficam PROIBIDOS pro
agente, mesmo com pedido explícito. Alteração de env var é sempre manual,
pelo Emerson, no dashboard da Vercel; o agente só confere por leitura
(`env ls`).

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
