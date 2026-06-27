# Bidcon — Plataforma logada

> **Status:** código-fonte para revisão. **Nada foi executado pelo agente** —
> nenhum projeto Supabase/Vercel criado, nenhuma credencial usada, nenhuma chave
> no repositório. Ver `docs/plataforma-arquitetura.md` (decisões) e
> `docs/privacidade-rascunho-adicoes.md` (privacidade).

Projeto **separado** do site estático. O site de marketing (`bidcon.com.br`,
pasta `/public`) continua intocado. Esta pasta vira o projeto Vercel de
`app.bidcon.com.br`.

## O que já está construído
- Login por **magic link** e home "Olá, {nome}" com próximo passo do processo.
- **Área do cliente:** `/meu-processo` (timeline de status) e vitrine `/cartas`
  (+ detalhe `/cartas/[id]`, CTA WhatsApp).
- **Área do parceiro** (`tipo='parceiro'`): painel, carteira de cartas, cadastro
  de carta própria, indicações e comissões (somente leitura do que é seu).
- **Painel admin** (`tipo='admin'`): visão geral, parceiros (aprovar/suspender
  conta), processos (avançar status), estoque de cartas e comissões
  (liberar/marcar paga).
- Clientes Supabase para browser e servidor (`lib/`). RLS estrito em todas as
  tabelas: cada usuário só enxerga os próprios dados; admin enxerga tudo.
- **Sem dado bancário** em nenhuma tabela; comissão só rastreia status.

## Arquitetura, em uma frase
Server Components leem via **RLS** (anon key + cookies). **Mutações** vivem em
Route Handlers (`app/api/.../route.ts`) — nunca Server Actions. Mudança de status
de processo/carta/comissão acontece dentro de **RPCs SQL `security definer`**
(migration 0006) com checagem de papel embutida; escrita privilegiada de conta de
parceiro usa `createAdminClient()` (service_role) **após** confirmar admin no
servidor.

## Rodar localmente
1. `cp .env.example .env.local` e preencher:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (públicas);
   - `SUPABASE_SERVICE_ROLE_KEY` (**secreta** — só em env var de servidor, nunca
     no repo).
2. `npm install`
3. `npm run dev` → http://localhost:3000

Checagens: `npx tsc --noEmit` e `npm run build`.

## Migrations (ordem) — aplicadas pelo Emerson, não pelo agente
No SQL Editor do Supabase ou `supabase db push`, nesta ordem:
1. `0001_schema.sql` — schema (tabelas, enums).
2. `0002_rls.sql` — RLS estrito + `is_admin()`.
3. `0003_processo_eventos.sql` — trilha de status do processo.
4. `0004_cartas_sync.sql` — sync de cotas (RPC atômico) + `indisponivel`.
5. `0005_cartas_vitrine.sql` — leitura pública das cartas `disponivel`.
6. `0006_status_rpc.sql` — RPCs de mudança de status (processo/carta/comissão).

`supabase/seed_dev.sql` **não é migration**: é massa de teste para um projeto de
desenvolvimento (admin, parceiros, clientes, cartas, processos, comissão). **Não
rodar em produção.**

## Segurança
- `.env*` está no `.gitignore` — chaves nunca vão ao Git.
- `anon key` pode ir ao client; `service_role` só no servidor.
- RLS em todas as tabelas; mudança de status = server-side via RPC.
- Área logada com `robots: noindex` no `app/layout.tsx`.

## Pendências que travam fases (Emerson)
- Números de comissão (percentual/base/teto/escalonamento + liberação auto vs.
  manual) → travam a Fase 3.
- DNS `app.bidcon.com.br` e criação do projeto Vercel.
