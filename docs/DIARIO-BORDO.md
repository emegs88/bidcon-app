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
