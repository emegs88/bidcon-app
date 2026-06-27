# Setup do banco (Supabase) — passo a passo via CLI

> Roteiro completo para subir o schema + RLS no seu projeto Supabase e rodar a
> área do cliente localmente. Siga em ordem. **Tudo é feito por você** — o agente
> nunca loga em conta nem vê chave secreta.
>
> Ordem: instalar CLI → login → link → `db push` → seed → verificação → `npm run dev`.

---

## 0. Antes de começar — regras de segurança

- **`anon key`** (pública): vai no `.env.local` e pode ir ao client. OK.
- **`service_role key`** (secreta): vai **só** em `SUPABASE_SERVICE_ROLE_KEY` no
  `.env.local`. **NUNCA** cole no chat, **NUNCA** commite no Git. Nada na Fase 0/1
  usa ela ainda (só leitura com anon key + RLS); ela fica inerte até a Fase 2/3.
- **Senha do banco (db password):** a CLI pode pedir no `db push`/`link`. Digite no
  terminal quando solicitado — **nunca** cole no chat nem no repo.
- O `.env.local` está no `.gitignore` (`.env*`). Confirme antes de salvar chaves.

---

## 1. Instalar a Supabase CLI

**macOS (Homebrew):**
```bash
brew install supabase/tap/supabase
```

**Confirme a instalação:**
```bash
supabase --version
```
(Alternativas: `npm i -g supabase` ou binário em https://github.com/supabase/cli/releases.)

---

## 2. Login na CLI

```bash
supabase login
```
Abre o navegador para você autorizar e cola um token automaticamente. **Você** faz
o login — o agente não participa disso.

---

## 3. Linkar o projeto local a este repositório

Entre na pasta da plataforma (onde fica `supabase/`):
```bash
cd platform
```

Pegue o **Project Ref** no painel: *Project Settings → General → Reference ID*
(string curta tipo `abcdwxyzqwerlkjh`). Então:
```bash
supabase link --project-ref SEU_PROJECT_REF
```
Se pedir a **database password**, digite a senha do banco (definida na criação do
projeto). Não cole essa senha em lugar nenhum além do prompt.

---

## 4. Aplicar as migrations (`db push`)

As migrations estão em `platform/supabase/migrations/`, nesta ordem:

| Arquivo | O que faz |
|---|---|
| `0001_schema.sql` | enums + tabelas (profiles, cartas, processos, indicacoes, comissoes) |
| `0002_rls.sql` | liga **RLS** em todas + políticas de acesso |
| `0003_processo_eventos.sql` | tabela de histórico `processo_eventos` + RLS |

Rode:
```bash
supabase db push
```
Isso aplica as três migrations em ordem no banco do projeto linkado.

> **Se o `db push` reclamar do formato da versão** (a CLI espera prefixo de
> timestamp de 14 dígitos e estes arquivos usam `0001/0002/0003`): use o **fallback
> pelo SQL Editor** — abra o painel → *SQL Editor* → cole e rode o conteúdo de
> `0001_schema.sql`, depois `0002_rls.sql`, depois `0003_processo_eventos.sql`,
> **nessa ordem**, um de cada vez. O resultado é idêntico.

---

## 5. Seed de teste (dados FICTÍCIOS — LGPD)

O seed (`platform/supabase/seed.sql`) cria cliente/parceiro/carta/processo/eventos
**fictícios** só para testar as telas. **Não** rode em produção com dados reais.

Pelo SQL Editor (recomendado, porque mexe em `auth.users`):
1. Painel → *SQL Editor* → cole o conteúdo de `supabase/seed.sql` → **Run**.
2. (Alternativa pelo painel) se preferir não inserir em `auth.users` via SQL, pule
   os `insert into auth.users (...)` e crie os usuários em *Authentication → Users →
   Add user* usando os **mesmos UUIDs/e-mails** do seed; depois rode só os INSERTs de
   `profiles`/`cartas`/`processos`/`processo_eventos`.

Usuários fictícios criados:
- `cliente.a@exemplo.test` (Ana) — tem 1 processo em *Em análise na administradora*.
- `cliente.b@exemplo.test` (Bruno) — **sem** processo (testa estado vazio).
- `parceiro@exemplo.test` — parceiro fictício.

---

## 6. Verificação — RLS ligado em TODAS as tabelas

No *SQL Editor*, rode:
```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
```
**Esperado:** `rowsecurity = true` (ou `t`) em **todas** as linhas:
`cartas, comissoes, indicacoes, processo_eventos, processos, profiles`.

> ⚠️ Se **qualquer** tabela vier `rowsecurity = false`, **pare** e avise — não siga
> para o `npm run dev`. (Provável causa: alguma migration não rodou; reaplique.)

Confira também que existem políticas:
```sql
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```
**Esperado:** várias linhas (SELECT/INSERT/UPDATE/ALL por tabela). `comissoes` deve
ter apenas SELECT para parceiro (nada de UPDATE pelo client) — mudança de status é
server-side nas Fases 2/3.

---

## 7. Configurar o `.env.local`

Na pasta `platform/`, copie o exemplo e preencha:
```bash
cp .env.example .env.local
```
Edite `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<sua anon key>
SUPABASE_SERVICE_ROLE_KEY=<sua service_role key — NÃO commitar, NÃO colar no chat>
```
- `URL` e `anon key`: *Project Settings → API*.
- `service_role`: mesma tela. Cole **só** no `.env.local`. Nada a usa ainda.

---

## 8. Rodar a área do cliente localmente

```bash
npm install
npm run dev
```
Abra http://localhost:3000.

**Teste de ponta a ponta:**
1. Vá em `/login` → entre como **Ana** (`cliente.a@exemplo.test`) pelo magic link.
   - No dev, o link de login aparece em *Authentication → Users → (usuário) → magic
     link*, ou configure o e-mail de teste do Supabase.
2. Na home, clique **Meu processo** (`/meu-processo`):
   - deve mostrar a **timeline** com o estado *Em análise na administradora* em
     destaque, a **carta** vinculada e o **histórico** de eventos.
3. Saia e entre como **Bruno** (`cliente.b@exemplo.test`):
   - `/meu-processo` deve mostrar o **estado vazio** (sem processo) com o botão de
     atendimento.
4. Confirme o isolamento por RLS: Ana **não** vê o processo de ninguém além do dela
   (Bruno não tem; experimente trocar e ver que cada um só enxerga o próprio).

---

## 9. Sync automático de cotas (cron horário) — Fase 1.5

> Só ative depois do banco de pé (passos 1–6) **e** do app publicado num projeto
> Vercel próprio. Em dev local o cron não roda; dá para testar a rota na mão.

A migration **0004** já entra no `db push` (passo 4): adiciona em `cartas` as
colunas de sync (`numero_externo` único, `fonte`, `valor_parcela`, `qtd_parcelas`,
`sincronizada_em`, `criado_via`), o enum `indisponivel`, a tabela `eventos_sync`
e a função atômica `sync_aplicar_cotas()`.

**Env vars (Vercel ▸ Project Settings ▸ Environment Variables):**
- `CRON_SECRET` — gere com `openssl rand -hex 32`. A Vercel manda
  `Authorization: Bearer <CRON_SECRET>` no cron; a rota recusa qualquer chamada
  sem esse header. **Server-only**, nunca no repo.
- `SUPABASE_SERVICE_ROLE_KEY` — a mesma do passo 7, marcada como secreta.
- `SYNC_MIN_COTAS` (default 50) e `SYNC_MAX_QUEDA` (default 0.6) — opcionais.

**O cron já está agendado** em `platform/vercel.json`:
```json
{ "crons": [ { "path": "/api/sync-cotas", "schedule": "0 * * * *" } ] }
```
`0 * * * *` = 1×/hora. A Vercel só ativa crons em deploy de produção.

**Testar a rota localmente (sem esperar o cron):**
```bash
# no .env.local, defina CRON_SECRET=um-valor-qualquer-para-teste
npm run dev
curl -s http://localhost:3000/api/sync-cotas \
  -H "Authorization: Bearer um-valor-qualquer-para-teste" | jq
```
Resposta esperada no caminho feliz:
`{ ok: true, lidas: ~373, novas, atualizadas, indisponibilizadas }`.
Sem o header correto → `401 nao_autorizado`. Se a fonte estiver fora do ar ou o
volume despencar, vem `{ ok:false, abortado:true, motivo:... }` **e o estoque não
é tocado** (as 5 guardas) — confira o registro em `eventos_sync`.

**Push:** cartas novas nascem com evento `push_pendente=true`. O disparo real só
entra quando o OneSignal for plugado (`lib/notificar.ts` é stub hoje).

---

## Pronto

Com o `pg_tables` mostrando `rowsecurity = true` em tudo e o `/meu-processo`
funcionando para Ana (cheio) e Bruno (vazio), o banco da Fase 1 está de pé.

**Próximo passo combinado:** você roda o `db push`, cola aqui o resultado do
`select` de `pg_tables`. Se alguma tabela vier `rowsecurity = false`, **pare** e
avise antes de seguir.

### Lembretes
- Deploy do app só quando o DNS `app.bidcon.com.br` estiver pronto (projeto Vercel
  **separado** do site estático). A Fase 1 roda só em dev local por enquanto.
- Nenhuma chave secreta no repo; `service_role` e senha do banco nunca no chat.
