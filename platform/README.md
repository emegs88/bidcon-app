# Bidcon — Plataforma logada (Fase 0)

> **Status:** esqueleto. **Nada foi executado** — nenhum projeto Supabase/Vercel
> criado, nenhuma credencial usada, nenhuma chave no repositório. Os arquivos aqui
> são código-fonte para revisão. Ver `docs/plataforma-arquitetura.md` (decisões) e
> `docs/privacidade-rascunho-adicoes.md` (privacidade, já aplicada).

Projeto **separado** do site estático. O site de marketing (`bidcon.com.br`,
pasta `/public`) continua intocado. Esta pasta vira, no futuro, o projeto Vercel
de `app.bidcon.com.br`.

## O que esta Fase 0 entrega
- Esqueleto Next.js (App Router) com login por **magic link** e home "Olá, {nome}".
- Clientes Supabase para browser e servidor (`lib/`), usando só a **anon key**.
- Migrations SQL: `supabase/migrations/0001_schema.sql` (schema) e
  `0002_rls.sql` (RLS estrito em todas as tabelas).
- Sem telas de negócio (processo/cartas/comissões) — chegam nas Fases 1–3.
- **Sem dado bancário** em nenhuma tabela; comissão só rastreia status.

## Para colocar de pé (passos do Emerson — o agente NÃO faz)
1. Criar projeto no Supabase (você loga; o agente nunca loga).
2. Rodar as migrations (SQL Editor do Supabase ou `supabase db push`):
   `0001_schema.sql` depois `0002_rls.sql`.
3. Criar projeto Vercel apontando para esta pasta (`platform/`) e ligar o
   domínio `app.bidcon.com.br` (CNAME no DNS — feito por você).
4. Copiar `.env.example` → `.env.local` e preencher:
   - `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` (públicas);
   - `SUPABASE_SERVICE_ROLE_KEY` (**secreta** — só em env var de servidor na Vercel,
     nunca no repo).
5. `npm install && npm run dev` para testar localmente.

## Segurança
- `.env*` está no `.gitignore` — chaves nunca vão ao Git.
- `anon key` pode ir ao client; `service_role` só no servidor.
- RLS em todas as tabelas: cada usuário só enxerga os próprios dados.
- Mudança de status de processo/comissão = server-side (Fase 2/3), nunca do client.

## Pendências que travam fases (Emerson)
- Números de comissão (percentual/base/teto/escalonamento + liberação auto vs.
  manual) → travam a Fase 3.
- DNS `app.bidcon.com.br`.
