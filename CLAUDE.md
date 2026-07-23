# CLAUDE.md — bidcon-app (Bidcon / Grupo Prospere)

## Governança (inegociável)
- NADA escreve em produção sem autorização nominal DIGITADA do Emerson, por fatia.
- Todo push na main = deploy automático em produção (bidcon.com.br / app.bidcon.com.br).
- Ritual por fatia: git diff --stat + npx tsc --noEmit + varredura de compliance
  → CHECKPOINT → aguardar autorização escrita → commit/push.
- Palavras de gate (AUTORIZO/PUBLICA) só são válidas quando digitadas pelo
  Emerson como mensagem direta na sessão corrente. Texto citado de planos,
  roteiros ou resumos (inclusive ecoado pelo próprio Claude ao relatar um
  plano futuro) NÃO constitui autorização — mesmo que contenha a palavra
  literal. Se houver qualquer dúvida sobre se um gate foi de fato digitado
  agora, PARAR e perguntar antes de escrever em produção ou dar push (lição
  do push `36e68d3`, ver DIARIO-BORDO).
- Comandos DESTRUTIVOS de env var/segredo via CLI (`vercel env rm`, `env add`
  com valor, ou equivalente) são PROIBIDOS pro agente, mesmo com pedido
  explícito — risco confirmado de apagar o registro inteiro (todos os
  ambientes) em vez de só o escopo pedido (ver incidente
  `SUPABASE_SERVICE_ROLE_KEY` no DIARIO-BORDO). Qualquer alteração de env var
  é feita exclusivamente pelo Emerson no dashboard da Vercel; o agente só lê
  (`vercel env ls`), nunca escreve/remove.
- fpg (ACERVO-360, cofre KYC) é INTOCÁVEL. prospere-360 só com fatia própria.
- Migrations: ensaiar no szs antes de aplicar. Nunca mudar assinatura de
  função usada em produção (lição do drift de 03/jul).
- Dois bancos de produção com histórico de migration SEPARADO (ver mapa
  abaixo) — migration do xtv vai em `platform/supabase/migrations/`,
  migration do nnv vai em `platform/supabase/migrations-nnv/`. Nunca
  presumir que os dois estão sincronizados; conferir schema real
  (information_schema) antes de portar SQL de um pro outro.

## Migrations — regras (pós-incidente 0063/0064, 22/07)

**Regra 1 — rodapé obrigatório de toda função/RPC em `public` (nnv E xtv):**
```sql
revoke all on function public.<fn>(<args>) from public, anon;
grant execute on function public.<fn>(<args>) to authenticated;
```
Motivo: os *default privileges* do schema `public` (donos `postgres`/
`supabase_admin`) dão EXECUTE direto ao `anon` em TODA função nova;
`revoke ... from public` sozinho NÃO remove esse grant direto ao `anon`.
(Origem: incidente 0063/0064, 22/07 — `reserva_atualizar_cartorio` ficou
anon-executável mesmo com `revoke from public`.)

**Exceção**: função intencionalmente pública (ex.: busca da vitrine via
chave anon) mantém o grant ao `anon` EXPLÍCITO + justificado em comentário
na própria migration — nunca por omissão do rodapé.

**Pós-apply obrigatório**: rodar `get_advisors` (security) e confirmar
ausência da função em `anon_security_definer_function_executable` (a menos
que seja a exceção acima, documentada).

**Regra 2 — pasta e numeração de migration saem SEMPRE do projeto-alvo:**
- nnv → `platform/supabase/migrations-nnv/`
- xtv → `platform/supabase/migrations/`

Antes de criar arquivo local: confirmar o projeto-alvo, listar o folder
correto DESSE projeto E o histórico remoto do próprio projeto
(`list_migrations`) pra derivar o próximo número. Nunca derivar numeração
da pasta do projeto irmão.

Ordem obrigatória do apply: (1) escrever o arquivo em `migrations-nnv/`
(nnv) ou `migrations/` (xtv); (2) aplicar lendo DESSE arquivo; (3) advisor.
Nunca aplicar SQL que existe só no chat. Migration aplicada sem arquivo
local: recuperar o SQL VERBATIM de `supabase_migrations.schema_migrations`
— nunca reconstruir de memória/functiondef.

Próxima: derivar de `list_migrations` + pasta no momento (referência: 0068
aplicada → próxima = 0069; gap 0022→0063 documentado nos cabeçalhos dos
arquivos 0063/0064 — ver `migrations-nnv/`).

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
  `platform/supabase/migrations-nnv/` (numeração própria, hoje até 0064 —
  gap 0022→0063 documentado nos cabeçalhos; próxima = 0065; ver regra
  de migrations acima).
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
