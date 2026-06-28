# Checklist de deploy — Nível 3 em produção (executar amanhã)

> **Onde paramos hoje:** Nível 3 (busca semântica) **100% validado no DEV** (`fpgimirtiryivnrjdyxb`); decidido publicar a plataforma num **Supabase PROD NOVO zerado** (não reusar o banco do site `nnvjeijsrwpzsggwqpcu`) + **2º projeto Vercel separado** (Root = `platform/`) — falta executar este checklist.

---

## Decisões já fechadas (não reabrir amanhã)

- ✅ **Banco:** Supabase PROD **NOVO**, zerado. Risco zero (igual ao DEV). O banco do site (`nnvjeijsrwpzsggwqpcu`) **NÃO é tocado**.
- ✅ **Vercel:** **2º projeto separado** (`bidcon-plataforma`), **Root Directory = `platform/`**. O projeto do site que já está no ar **NÃO é tocado**.
- ✅ **DNS:** `app.bidcon.com.br` → Vercel (CNAME), no Registro.br.
- ⚠️ **`docs/publicar-nivel3-prod.md` está DESATUALIZADO** (foi escrito assumindo reuso do banco do site). **Ignore-o.** Este checklist é a fonte da verdade.

## Legenda

- 🔒 = **ação sua** (conta/credencial/clique de criação — eu não faço, não vejo segredo).
- 🤖 = **eu guio/verifico** (te passo SQL, comando, confiro saída — sem tocar PROD).

---

## Passo 0 — Pré-requisitos (2 min) 🤖

- [ ] Servidor dev pode estar desligado; nada aqui depende dele.
- [ ] Ter em mãos: login Supabase, login Vercel, login Registro.br.
- [ ] Ter a **`OPENAI_API_KEY` de produção** pronta (se a antiga foi exposta algum dia, **gere uma nova** e revogue a velha). 🔒

---

## Passo 1 — Criar o Supabase PROD novo (zerado) 🔒

1. [ ] [app.supabase.com](https://app.supabase.com) → **New project**.
2. [ ] Preencher:
   - **Name:** `bidcon-plataforma-prod`
   - **Database Password:** gere uma forte e **guarde no seu gerenciador** (não me mande).
   - **Region:** **South America (São Paulo) — `sa-east-1`** (mesma do DEV).
3. [ ] Criar e esperar ficar **Active** (~2 min).
4. [ ] **Anotar o Project ref** (o `xxxx` em `https://<ref>.supabase.co`). 🤖 me diga o ref (não é segredo) — eu confirmo que **não** é `fpgimirtiryivnrjdyxb` (DEV) nem `nnvjeijsrwpzsggwqpcu` (site).

### Chaves que você vai pegar agora (Settings ▸ API) — 🔒 são SUAS

> **Project Settings ▸ API.** Copie e guarde; **não cole aqui no chat**:

| Variável (nome) | Onde achar | Secreta? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Settings ▸ API ▸ *Project URL* | não |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Settings ▸ API ▸ *anon public* | não (pública) |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings ▸ API ▸ *service_role* | **SIM — sigilo** |

**Conferir:** a URL tem o **ref novo** (não o do DEV nem o do site).

---

## Passo 2 — Rodar as 7 migrations no banco novo, EM ORDEM 🤖 (você cola / eu confiro)

No projeto novo → **SQL Editor** → **New query**. Rode **uma de cada vez**, na ordem.
Os arquivos estão em `platform/supabase/migrations/`.

```
[ ] 0001_schema.sql            -- enums + tabelas (profiles, cartas, processos, indicacoes, comissoes)
[ ] 0002_rls.sql               -- RLS + policies
[ ] 0003_processo_eventos.sql  -- tabela de eventos de processo
[ ] 0004_cartas_sync.sql       -- RPC sync_aplicar_cotas
[ ] 0005_cartas_vitrine.sql    -- policy de vitrine
[ ] 0006_status_rpc.sql        -- RPC de status
[ ] 0007_busca_semantica.sql   -- pgvector + 3 colunas em cartas + índice HNSW + RPC buscar_cartas_semantica
```

**Como conferir "Success" DE VERDADE (não o log fake):**
- Depois de cada query, o SQL Editor mostra **"Success. No rows returned"** (DDL não retorna linhas). Se aparecer **erro vermelho**, **PARE** e me cole a mensagem — **não pule, não force a próxima**.
- Ordem importa: 0007 depende das tabelas da 0001; 0002 depende de tudo existir.

**SELECT de verificação no fim (cole após a 0007):**
```sql
-- 1) Extensão pgvector instalada?
select extname from pg_extension where extname = 'vector';                 -- espera: 1 linha 'vector'

-- 2) Função de busca existe com a assinatura certa?
select to_regprocedure(
  'public.buscar_cartas_semantica(vector,tipo_bem,numeric,numeric,int)'
);                                                                          -- espera: o nome (não null)

-- 3) Tabelas-base criadas?
select table_name from information_schema.tables
 where table_schema='public'
   and table_name in ('profiles','cartas','processos','indicacoes','comissoes')
 order by table_name;                                                       -- espera: 5 linhas

-- 4) Colunas de busca em cartas?
select column_name from information_schema.columns
 where table_schema='public' and table_name='cartas'
   and column_name in ('descricao','embedding','embedding_em')
 order by column_name;                                                      -- espera: 3 linhas

-- 5) Índice HNSW existe?
select indexname from pg_indexes where indexname='idx_cartas_embedding_hnsw'; -- espera: 1 linha
```
🤖 me cole a saída desses 5 SELECTs — eu confirmo que está tudo certo antes de seguir.

---

## Passo 3 — Encher o estoque (sync das cotas) no banco novo 🤖

O banco está vazio; precisa popular `cartas` antes do backfill.

- **Opção A (sync real, recomendada):** disparar a rota de sync uma vez. Ela lê a fonte e faz upsert das cotas disponíveis.
  - Precisa da app no ar (Passo 5) **ou** rodar local apontando o `.env.local` para o banco novo (eu te passo o comando exato na hora, com `CRON_SECRET` do seu `.env`, sem echo).
- **Opção B (seed de teste):** rodar `platform/supabase/seed_dev.sql` pelo runner Node — enche com as cartas de validação (as mesmas 900001–900021 do DEV).

> Decidimos a opção na hora, conforme você quiser estoque real (A) ou de teste primeiro (B). 🤖 eu te passo o comando.

**Conferir:** `select status, count(*) from cartas group by status;` → deve ter linhas `disponivel`.

---

## Passo 4 — Backfill dos embeddings no banco novo 🤖 (precisa `OPENAI_API_KEY`)

Gera `descricao` + `embedding` para cada carta disponível. Loop até `restantes:0`:

```bash
# trocar <DOMINIO> pela URL da plataforma (Passo 5) e <CRON_SECRET> pelo valor real (não cole no chat)
while :; do
  R=$(curl -s -X POST "https://<DOMINIO>/api/backfill-embeddings" \
        -H "Authorization: Bearer <CRON_SECRET>")
  echo "$R"
  echo "$R" | grep -q '"restantes":0' && break
  sleep 1
done
```
**Esperado:** `{"ok":true,"processadas":N,"falhas":[],"restantes":0}`.

---

## Passo 5 — Diagnóstico read-only (confirmar os 6 itens ✅) 🤖

Cole no **SQL Editor** do banco novo (só leitura, não altera nada):

```sql
-- (1) função de busca existe
select to_regprocedure('public.buscar_cartas_semantica(vector,tipo_bem,numeric,numeric,int)') is not null as func_ok;
-- (2) policy de vitrine presente
select exists (select 1 from pg_policies where schemaname='public' and tablename='cartas' and policyname='cartas_vitrine_select') as vitrine_ok;
-- (3) pgvector instalada
select exists (select 1 from pg_extension where extname='vector') as pgvector_ok;
-- (4) índice HNSW existe
select exists (select 1 from pg_indexes where indexname='idx_cartas_embedding_hnsw') as indice_ok;
-- (5) cartas disponíveis com/sem embedding
select count(*) filter (where status='disponivel') as disponiveis,
       count(*) filter (where status='disponivel' and embedding is not null) as com_embedding,
       count(*) filter (where status='disponivel' and embedding is null) as sem_embedding
from cartas;
-- (6) sanidade da 1ª carta
select numero_externo, tipo, valor_credito, status, (embedding is not null) as vetorizada
from cartas where status='disponivel' order by valor_credito limit 1;
```
**6 itens ✅ esperados:** `func_ok=t`, `vitrine_ok=t`, `pgvector_ok=t`, `indice_ok=t`, `com_embedding = disponiveis` (e `sem_embedding=0`), e a 1ª carta com `vetorizada=t`.
🤖 me cole a saída — eu confirmo os 6.

---

## Passo 6 — Criar o 2º projeto Vercel (SEPARADO) 🔒

> ⚠️ **NÃO** mexa no projeto Vercel do **site** que já está no ar. Este é um projeto **novo**.

1. [ ] Vercel ▸ **Add New… ▸ Project** ▸ importar o repo `bidcon-app`.
2. [ ] **Project Name:** `bidcon-plataforma`.
3. [ ] **CRÍTICO — Root Directory:** clicar **Edit** e definir **`platform`** (sem isso, a Vercel builda a raiz/site estático — erra tudo).
4. [ ] **Framework Preset:** Next.js (deve detectar sozinho ao apontar pra `platform`).
5. [ ] **NÃO clicar Deploy ainda** — primeiro as env vars (Passo 7). Se a tela forçar deploy, deixa falhar e a gente redeploya depois das envs.

**Conferir:** Root Directory = `platform`; é projeto **novo** (não o do site).

---

## Passo 7 — Variáveis de ambiente na Vercel (projeto `bidcon-plataforma`) 🔒

Project Settings ▸ **Environment Variables** ▸ escopo **Production**. Cole os **nomes** abaixo e preencha os **valores você** (do banco novo + suas chaves). **Não me mande valores.**

| Nome (cole exatamente) | Valor (você preenche) | Origem |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | _(vazio)_ | Supabase novo ▸ Settings ▸ API ▸ Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | _(vazio)_ | Supabase novo ▸ API ▸ anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | _(vazio)_ 🔒 sigilo | Supabase novo ▸ API ▸ service_role |
| `CRON_SECRET` | _(vazio)_ 🔒 | gere: `openssl rand -hex 32` |
| `SYNC_MIN_COTAS` | _(vazio)_ | mesmo valor do `.env.local` (piso de guarda) |
| `SYNC_MAX_QUEDA` | _(vazio)_ | mesmo valor do `.env.local` (queda máx. de guarda) |
| `OPENAI_API_KEY` | _(vazio)_ 🔒 | sua chave OpenAI de produção (nova) |
| `ONESIGNAL_APP_ID` | _(vazio)_ | painel OneSignal |
| `ONESIGNAL_REST_API_KEY` | _(vazio)_ 🔒 | painel OneSignal |

> Os nomes são exatamente os do `platform/.env.example` (9 variáveis). Confira que não sobrou nenhuma.

- [ ] Depois de colar todas, **Deploy** (ou Redeploy). Esperar **Ready/verde**.
- [ ] **Conferir:** abrir a URL `*.vercel.app` do projeto novo → login funciona, `/cartas` carrega.

> Só **depois** que a URL `.vercel.app` estiver no ar é que o **Passo 3 (sync)** e **Passo 4 (backfill)** via HTTP fazem sentido (eles batem nesse domínio). Se preferir, pode rodar sync/backfill local apontando pro banco novo antes — a gente decide na hora.

---

## Passo 8 — Apontar o DNS `app.bidcon.com.br` (Registro.br) 🔒

1. [ ] No projeto Vercel `bidcon-plataforma` ▸ **Settings ▸ Domains** ▸ **Add** → `app.bidcon.com.br`.
2. [ ] A Vercel mostra o registro a criar — normalmente um **CNAME**:
   - **Tipo:** `CNAME`
   - **Nome/Host:** `app`
   - **Valor/Destino:** `cname.vercel-dns.com` (use **exatamente** o que a Vercel mostrar).
3. [ ] No **Registro.br** ▸ painel do domínio `bidcon.com.br` ▸ **DNS / Editar zona** ▸ adicionar esse CNAME.
4. [ ] Voltar na Vercel e esperar o domínio ficar **Valid/verde** (pode levar de minutos a algumas horas pela propagação).

**Conferir:**
```bash
dig +short app.bidcon.com.br        # deve resolver pro destino da Vercel
```
> ⚠️ **Não** mexa nos registros do `www`/raiz (são do site no ar). Só **adicione** o `app`.

---

## Passo 9 — Fumaça final (1 busca real em PROD) 🤖

- [ ] Logado em `https://app.bidcon.com.br` (ou na URL `.vercel.app`), buscar **"carro até 80 mil"**.
- [ ] **Esperado:** só veículos ≤ 80k, ordenados; **nenhuma** frase prometendo contemplação/prazo nem citando mecânica interna (administradora/taxa/fundo).
- [ ] Buscar com algo sem número (ex.: "primeiro imóvel pra família") → só imóveis.

🤖 me mande print/saída — eu confirmo o comportamento (igual à validação do DEV).

---

## Resumo da ordem (cola rápida)

1. 🔒 Criar Supabase PROD novo (`sa-east-1`) → anotar ref + 3 chaves.
2. 🤖 Migrations `0001→0007` em ordem + 5 SELECTs de verificação.
3. 🤖 Encher `cartas` (sync real ou seed).
4. 🤖 Backfill embeddings até `restantes:0`.
5. 🤖 Diagnóstico read-only → 6 itens ✅.
6. 🔒 2º projeto Vercel (Root = `platform`).
7. 🔒 9 env vars (valores seus) → Deploy verde.
8. 🔒 CNAME `app` no Registro.br → domínio Valid na Vercel.
9. 🤖 1 busca de fumaça.

---

## Regras que continuam valendo (não furar)

- Sem `git push` sem você autorizar por escrito.
- Eu **não** vejo/guardo valores de chave; **não** rodo SQL em PROD; **não** clico Deploy; **não** crio conta/projeto.
- Banco do site (`nnvjeijsrwpzsggwqpcu`) e projeto Vercel do site: **intocados**.
- Compliance: nenhuma frase de carta promete contemplação/prazo; `administradora`/`taxa`/`fundo` nunca chegam ao cliente.

---

*Checklist de execução manual. Pareado com `validacao-nivel3.md` (prova do Nível 3 no DEV). Substitui, para o deploy de hoje, o `publicar-nivel3-prod.md` (aquele assume reuso do banco do site — decisão revista para banco novo).*
