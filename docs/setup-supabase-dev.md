# Guia — criar o Supabase DEV e pegar as chaves (para o Emerson executar)

> **Quem executa: VOCÊ (Emerson).** Credencial é sua. O agente **não toca banco**,
> não roda comando contra Supabase e nunca vê as chaves secretas.
>
> **Objetivo:** ter um projeto Supabase **novo, separado do PROD** (`nnvjeijsrwpzsggwqpcu`),
> apontar o `.env.local` pra ele e validar o Nível 3 (busca semântica) sem risco de
> tocar em dado real. Quando terminar este guia, você roda o roteiro de
> `docs/validacao-nivel3.md` (itens do curl).

---

## 0) Antes de começar — o que você vai obter

Ao final você terá preenchido **5 valores** no `platform/.env.local`:

| Variável | De onde vem | Secreta? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase ▸ Settings ▸ API ▸ Project URL | não (vai ao client) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase ▸ Settings ▸ API ▸ `anon` `public` | não (vai ao client) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase ▸ Settings ▸ API ▸ `service_role` | **SIM — nunca commitar/colar em chat** |
| `OPENAI_API_KEY` | platform.openai.com ▸ API keys | **SIM** |
| `CRON_SECRET` | você gera: `openssl rand -hex 32` | **SIM** |

> ⚠️ As três secretas (`service_role`, `OPENAI_API_KEY`, `CRON_SECRET`) **só** vivem no
> `.env.local` (que está no `.gitignore`). Nunca no repo, nunca no chat, nunca em log.

---

## 1) Criar o projeto DEV

1. Acesse https://supabase.com/dashboard ▸ **New project**.
2. Nome sugerido: `bidcon-dev` (deixa óbvio que **não** é produção).
3. Escolha uma senha forte de banco (guarde no seu gerenciador) e a região mais próxima.
4. Aguarde o provisionamento (~2 min).

> **Conferência mental:** este projeto novo tem um **ref diferente** de
> `nnvjeijsrwpzsggwqpcu`. Se em algum momento a URL contiver `nnvjeijsrwpzsggwqpcu`,
> **pare** — isso é PROD.

---

## 2) Aplicar as migrations 0001 → 0007 (nesta ordem)

No projeto DEV: **SQL Editor** ▸ cole e rode **uma de cada vez, em ordem**:

```
platform/supabase/migrations/0001_schema.sql
platform/supabase/migrations/0002_rls.sql
platform/supabase/migrations/0003_processo_eventos.sql
platform/supabase/migrations/0004_cartas_sync.sql
platform/supabase/migrations/0005_cartas_vitrine.sql
platform/supabase/migrations/0006_status_rpc.sql
platform/supabase/migrations/0007_busca_semantica.sql
```

- A ordem importa: cada uma depende das anteriores (tabelas → RLS → eventos → sync →
  vitrine → RPCs de status → busca semântica).
- A **0007** habilita `pgvector`, adiciona as colunas `descricao/embedding/embedding_em`,
  cria o índice HNSW e a função `buscar_cartas_semantica`. Todas são idempotentes
  (`if not exists` / `create or replace`).

**Conferência da 0007** (rode no SQL Editor depois de aplicar):
```sql
select extname from pg_extension where extname = 'vector';            -- 1 linha
select indexname from pg_indexes where indexname = 'idx_cartas_embedding_hnsw'; -- 1 linha
\d cartas   -- deve listar descricao / embedding / embedding_em
```

---

## 3) Pegar as 2 chaves do Supabase

No projeto DEV ▸ **Settings ▸ API**:

- **Project URL** → vai em `NEXT_PUBLIC_SUPABASE_URL`.
- **Project API keys ▸ `anon` `public`** → vai em `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- **Project API keys ▸ `service_role`** (clique em *Reveal*) → vai em
  `SUPABASE_SERVICE_ROLE_KEY`. **Esta é a secreta** — trate como senha.

---

## 4) Pegar a chave da OpenAI

- https://platform.openai.com/api-keys ▸ **Create new secret key**.
- Copie o valor (só aparece uma vez) → `OPENAI_API_KEY`.
- Garanta que a conta tem crédito/billing ativo (embeddings + gpt-4o-mini são baratos,
  mas precisam de billing).

---

## 5) Gerar o CRON_SECRET

```bash
openssl rand -hex 32
```
Cole o resultado em `CRON_SECRET`. É ele que autoriza `/api/backfill-embeddings`
(e `/api/sync-cotas`) — o backfill do roteiro (d) manda `Authorization: Bearer <CRON_SECRET>`.

---

## 6) Montar o `.env.local`

Na pasta `platform/`:

```bash
cp .env.example .env.local
```

Edite `.env.local` e preencha (exemplo de forma — **valores reais são seus**):

```
NEXT_PUBLIC_SUPABASE_URL=https://SEU-REF-DEV.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...anon do DEV...
SUPABASE_SERVICE_ROLE_KEY=...service_role do DEV...
OPENAI_API_KEY=sk-...
CRON_SECRET=...saída do openssl...
```

> ✅ Confirme que a URL é a do **DEV** (ref novo), nunca `nnvjeijsrwpzsggwqpcu`.
> ✅ Confirme que `.env.local` **não** aparece em `git status` (está no `.gitignore`).

---

## 7) Semear estoque de teste

A busca só rankeia cartas `status='disponivel'` que **tenham embedding**. Para testar
você precisa de algumas cartas no DEV. Use o **SQL Editor** para inserir um punhado de
cartas de exemplo (imóvel e veículo, faixas variadas) — sem cliente/parceiro real,
só estoque. (Se já houver um `seed_dev.sql` no projeto, rode-o; senão, alguns
`insert into cartas (...)` de exemplo bastam.)

> As cartas nascem **sem** `embedding` — quem preenche é o backfill no passo seguinte.

---

## 8) Subir o app e rodar o roteiro de validação

```bash
cd platform
npm install      # se ainda não instalou
npm run dev      # sobe em http://localhost:3000
```

Agora siga **`docs/validacao-nivel3.md`**:
1. Faça login (magic link) para ter sessão (a busca exige usuário autenticado).
2. Rode o **loop de backfill** até `"restantes":0` (vetoriza o estoque).
3. Rode as **4 buscas** (filtro duro, nuance semântica, degradação 503, compliance).

---

## Erros comuns

| Sintoma | Causa provável | Ação |
|---|---|---|
| Busca responde **503** | `OPENAI_API_KEY` ausente/inválida ou sem billing | confira a chave e o crédito |
| Backfill responde **401** | `CRON_SECRET` não bate com o header `Bearer` | confira o valor no `.env.local` e no curl |
| Busca volta vazia mesmo com estoque | cartas sem `embedding` ainda | rode o loop de backfill até `restantes:0` |
| `function buscar_cartas_semantica does not exist` | 0007 não aplicada (ou fora de ordem) | reaplique as migrations 0001→0007 |
| URL contém `nnvjeijsrwpzsggwqpcu` | apontou pro **PROD** por engano | **pare**, troque pela URL do DEV |

---

*Guia de execução manual. O agente não roda nada disto — credenciais e banco são do
Emerson. Pareado com `docs/validacao-nivel3.md` (revisão + roteiro curl) e
`docs/checklist-pendencias.md` (ordem das próximas etapas).*
