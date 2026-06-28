# Publicar o Nível 3 em PRODUÇÃO (para o Emerson executar)

> **Contexto:** os 8 commits já estão no GitHub (`origin/main` sincronizado) e a Vercel
> faz deploy automático. O **build passa verde** (typecheck limpo + `next build` OK) —
> verificado localmente. As chaves de IA **não** afetam o build; só o *runtime* da busca.
>
> **Quem executa: VOCÊ (Emerson).** O agente não toca banco de PROD, não mexe na Vercel,
> não vê chaves. Banco PROD = `nnvjeijsrwpzsggwqpcu`.

---

## Estado atual (verificado)

| Item | Status |
|---|---|
| Código no GitHub | ✅ sincronizado (push feito) |
| Build de produção | ✅ verde (20 páginas, todas as rotas) |
| Segredos no repo | ✅ nenhum (`.env.local` ignorado; só `.env.example` com placeholders) |
| `pgvector` + função `buscar_cartas_semantica` em PROD | ❌ **falta aplicar 0007** |
| `OPENAI_API_KEY` / `CRON_SECRET` na Vercel | ❌ **falta configurar** |
| Estoque vetorizado (backfill) em PROD | ❌ **falta rodar** |

**Comportamento HOJE em produção:** a busca por IA (`/api/buscar-cartas`) responde
**503** (degradação honesta) e o `/buscar` mostra indisponível. **O resto da plataforma
segue de pé** (login, cartas, meu-processo, parceiro, admin). Sem erro feio, sem vazamento.

---

## Passo 1 — Conferir o deploy na Vercel

1. Vercel ▸ projeto da **plataforma logada** (o que builda a subpasta `platform/`).
2. Veja o último deploy do commit `fec3afc`. Deve estar **Ready/verde** (o build não
   depende das chaves).
3. Se estiver vermelho, copie o log de erro e me mande — aí sim há algo a corrigir.

> ⚠️ Atenção: o `vercel.json` da **raiz** publica o site estático (`outputDirectory: public`).
> A plataforma logada precisa ser um **projeto Vercel separado** com *Root Directory =*
> `platform`. Se a plataforma não estiver publicando, é provável que falte esse projeto
> separado (ou o Root Directory esteja errado). Confirme isso primeiro.

## Passo 2 — Aplicar migrations que faltam em PROD (na ordem)

No **SQL Editor do banco PROD**, rode o que ainda não foi aplicado, **em ordem**:

```
0005_cartas_vitrine.sql
0006_status_rpc.sql
0007_busca_semantica.sql   ← habilita pgvector + buscar_cartas_semantica
```

> Se você não tem certeza do que já está aplicado, cheque antes:
> ```sql
> select extname from pg_extension where extname='vector';                 -- 0007?
> select to_regprocedure('public.buscar_cartas_semantica(vector,tipo_bem,numeric,numeric,int)'); -- null = falta
> ```
> Todas as migrations são idempotentes (`if not exists` / `create or replace`), mas
> aplique **só as que faltam** e **em ordem**.

## Passo 3 — Configurar as variáveis na Vercel (projeto da plataforma)

Project Settings ▸ **Environment Variables** (escopo Production):

| Variável | Valor | Secreta? |
|---|---|---|
| `OPENAI_API_KEY` | sua chave OpenAI **nova** (a antiga foi exposta — revogar) | SIM |
| `CRON_SECRET` | `openssl rand -hex 32` | SIM |

> `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` provavelmente já
> existem em PROD (a plataforma já loga). Confirme que estão lá.

Depois de adicionar, **Redeploy** (pra carregar as novas envs).

## Passo 4 — Vetorizar o estoque em PROD (backfill)

Com as envs no ar, dispare o backfill (loop até `restantes:0`). No seu terminal,
trocando `<DOMINIO>` pela URL da plataforma em PROD e `<CRON_SECRET>` pelo valor real:

```bash
while :; do
  R=$(curl -s -X POST "https://<DOMINIO>/api/backfill-embeddings" \
        -H "Authorization: Bearer <CRON_SECRET>")
  echo "$R"
  echo "$R" | grep -q '"restantes":0' && break
  sleep 1
done
```

## Passo 5 — Fumaça (1 busca real)

Logado na plataforma em PROD, faça uma busca natural (ex.: "carro até 80 mil").
Deve voltar cartas rankeadas — e **nenhuma frase de encaixe** pode conter data de
contemplação nem mecânica interna (CCB/FIDC/funding/etc.).

---

## Ordem-resumo

1. Deploy verde na Vercel (e projeto da plataforma com Root = `platform`).
2. Migrations `0005→0006→0007` no banco PROD (só as que faltam).
3. `OPENAI_API_KEY` + `CRON_SECRET` na Vercel ▸ Redeploy.
4. Backfill até `restantes:0`.
5. 1 busca de fumaça.

Enquanto 2–4 não acontecerem, a busca fica em 503 — **esperado e seguro**.

---

*Guia de execução manual. O agente verificou build/typecheck/segredos localmente, mas
não aplica SQL em PROD nem altera a Vercel — isso é seu. Pareado com
`validacao-nivel3.md`, `setup-supabase-dev.md` e `checklist-pendencias.md`.*
