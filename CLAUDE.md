# CLAUDE.md — bidcon-app (Bidcon / Grupo Prospere)

## Governança (inegociável)
- NADA escreve em produção sem autorização nominal DIGITADA do Emerson, por fatia.
- Todo push na main = deploy automático em produção (bidcon.com.br / app.bidcon.com.br).
- Ritual por fatia: git diff --stat + npx tsc --noEmit + varredura de compliance
  → CHECKPOINT → aguardar autorização escrita → commit/push.
- fpg (ACERVO-360, cofre KYC) é INTOCÁVEL. prospere-360 só com fatia própria.
- Migrations: ensaiar no szs antes de aplicar. Nunca mudar assinatura de
  função usada em produção (lição do drift de 03/jul).
- Dois bancos de produção com histórico de migration SEPARADO (ver mapa
  abaixo) — migration do xtv vai em `platform/supabase/migrations/`,
  migration do nnv vai em `platform/supabase/migrations-nnv/`. Nunca
  presumir que os dois estão sincronizados; conferir schema real
  (information_schema) antes de portar SQL de um pro outro.

## Ambientes Supabase (mapa canônico — 4 projetos)
- **xtv** `xtvjpnyadcdeadhmzyff` = PROD **vitrine** (catálogo `cartas` full
  do sync multifonte, Bidcon Price, `interesses`/`conversas`/`mensagens` do
  atendimento via WhatsApp). Alimenta `/api/vitrine` e `/api/atende` via
  `createXtvClient()` (service_role). Migrations em
  `platform/supabase/migrations/` (numeração própria, hoje até 0054).
- **nnv** `nnvjeijsrwpzsggwqpcu` = PROD **app logado / auth real**
  (auth.users, profiles, processos, `cartas` operacional — tabela menor e
  curada, não o catálogo full do xtv —, reservas, contratos,
  pagamentos_sinal, checklist, KYC). Usado por `createClient()`
  (`lib/supabase-server.ts`, RLS/cookie) em `/meu-processo`, `/cartas`,
  `/admin/processos`, `/auth/*`. Migrations em
  `platform/supabase/migrations-nnv/` (numeração própria, hoje até 0019).
  **Gap de produto conhecido**: não existe pipeline automático que leve
  uma carta do catálogo xtv pro `nnv.cartas` — hoje é inserção manual (ver
  DIARIO-BORDO, fatia futura PONTE-01).
- **szs** `szsqdpwwxtmrtrhaikuh` = staging **do nnv** (schema espelha nnv,
  não xtv — não tem `vw_vitrine_viva`/`carta_fingerprint`, que são só do
  xtv). Ensaiar aqui migrations destinadas ao nnv.
- **prospere-360-dev** `fpgimirtiryivnrjdyxb` (ACERVO-360, cofre KYC) =
  **INTOCÁVEL**, read-only. prospere-360 só com fatia própria.

## Regras de negócio canônicas
- Comissão 7% do crédito somada à entrada (exceto LANCE: já embutida na origem).
- Custo financeiro = TIR ao mês (Newton-Raphson). Nunca % nominal.
- Administradora exposta no card (pré-requisito da junção).
- Nunca prometer ou sugerir data de contemplação.

## Compliance de linguagem (varrer TODO diff)
PROIBIDO: investimento, investidor, rendimento, retorno, lucro, CDI.
USAR: planejamento, compra programada, carta de crédito, poder de compra, patrimônio.

## Higiene de sessão
- 1 fatia = 1 sessão. /clear ao trocar de tarefa. /compact em marcos, não no teto.
