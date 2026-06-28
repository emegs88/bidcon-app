# Validação — Nível 3 (busca por linguagem natural)

> **Estado:** código pronto e commitado (local, sem push). **Nada rodou em banco real.**
> O banco `nnvjeijsrwpzsggwqpcu` é tratado como **PROD** e **não** é tocado.
> Todo o roteiro de execução (item **d**) é para um **Supabase DEV NOVO**, que o
> Emerson vai criar e apontar no `.env.local`, com as chaves preenchidas.
>
> Este documento cobre três frentes: **(b)** revisão linha a linha da migration
> 0007, **(c)** prova lógica de "filtro duro × ranking vetorial", e **(d)** o
> roteiro de validação por `curl` (backfill + 4 buscas).

---

## (b) Migration 0007 — revisão linha a linha

Arquivo: `platform/supabase/migrations/0007_busca_semantica.sql`.
**Aplicada pelo Emerson no SQL editor do Supabase. O agente não aplica em PROD.**

A migration faz **5 coisas** e nada além disso. Nenhuma policy é alterada;
nenhum dado existente é tocado (as colunas novas nascem `NULL`).

### 1. Extensão pgvector — `create extension if not exists vector;`
- Liga o tipo `vector` e os operadores de distância (incl. `<=>`, cosseno).
- **`if not exists`** → idempotente; re-rodar não dá erro.
- No Supabase a extensão mora no schema `extensions`; isso é transparente para o
  uso aqui porque a função fixa `search_path = public` (ver item 4).
- **Risco:** nenhum. É pré-requisito de tudo o que vem abaixo.

### 2. Três colunas em `cartas`
```sql
alter table cartas
  add column if not exists descricao    text,
  add column if not exists embedding    vector(1536),
  add column if not exists embedding_em  timestamptz;
```
- `descricao` — texto curto, **neutro e determinístico** de catálogo, gerado pelo
  backfill (`descricaoDeCarta()` em `lib/ia.ts`, **sem LLM** → não há como violar
  compliance). É **este** texto que vira embedding.
- `embedding` — vetor 1536-d (`text-embedding-3-small` da OpenAI).
- `embedding_em` — carimbo de quando o vetor foi (re)gerado. Permite reprocessar
  só o que mudou.
- **`if not exists` nas três** → migration re-rodável.
- Como nascem `NULL`, a carta existente continua válida; ela só entra na busca
  **depois** do backfill (item d). Coerente com o `where embedding is not null`
  do índice e da RPC.
- **Risco:** `vector(1536)` precisa casar **exatamente** com a dimensão do modelo
  de embedding. `text-embedding-3-small` = 1536. Se um dia trocar o modelo, troca
  a dimensão da coluna **e** revetoriza tudo. Está documentado no cabeçalho.

### 3. Índice HNSW parcial
```sql
create index if not exists idx_cartas_embedding_hnsw
  on cartas using hnsw (embedding vector_cosine_ops)
  where embedding is not null;
```
- **HNSW** = vizinhança aproximada; ótima recall/latência para um catálogo.
- **`vector_cosine_ops`** casa com o operador `<=>` usado no `order by` da RPC
  (item 4). Operador e classe de operador **têm de combinar** — combinam.
- **Índice parcial** (`where embedding is not null`) → não indexa estoque ainda
  sem vetor; índice menor e mais rápido.
- **`if not exists`** → re-rodável.
- **Risco:** criar índice HNSW em tabela com **muitas** linhas já vetorizadas pode
  ser pesado. Aqui o índice é criado **antes** do backfill (tabela sem embeddings),
  então a construção é barata; cada linha entra no índice conforme é vetorizada.

### 4. RPC `buscar_cartas_semantica` — o coração
```sql
create or replace function public.buscar_cartas_semantica(
  p_embedding   vector(1536),
  p_tipo        tipo_bem      default null,
  p_valor_max   numeric       default null,
  p_entrada_max numeric       default null,
  p_limite      int           default 3
) returns table ( id uuid, tipo tipo_bem, valor_credito numeric,
  valor_entrada numeric, valor_parcela numeric, qtd_parcelas int,
  score double precision )
language sql stable security definer set search_path = public
as $$
  select c.id, c.tipo, c.valor_credito, c.valor_entrada, c.valor_parcela,
         c.qtd_parcelas,
         (1 - (c.embedding <=> p_embedding))::double precision as score
  from cartas c
  where c.status = 'disponivel'
    and c.embedding is not null
    and (p_tipo        is null or c.tipo          =  p_tipo)
    and (p_valor_max   is null or c.valor_credito <= p_valor_max)
    and (p_entrada_max is null or coalesce(c.valor_entrada, 0) <= p_entrada_max)
  order by c.embedding <=> p_embedding
  limit greatest(1, least(coalesce(p_limite, 3), 12));
$$;
```
Linha a linha do que importa:
- **Assinatura** — todos os filtros têm `default null`; só `p_embedding` é
  obrigatório. `p_limite` default 3.
- **`returns table (...)`** — devolve **só campos públicos** de carta. **Não**
  retorna `parceiro_id`, `descricao` crua, `embedding`, nem nada de cliente/processo.
- **`language sql stable`** — função pura de leitura; `stable` permite ao planejador
  reusar o resultado dentro da mesma query.
- **`security definer` + `set search_path = public`** — roda com o privilégio do
  dono (para conseguir varrer o estoque cuja `parceiro_id` é `NULL`) **mas** a
  saída é limitada pela própria query a `status='disponivel'`. O `search_path`
  fixo fecha a porta de *search-path hijacking* (boa prática para `definer`).
- **`where c.status = 'disponivel'`** — mesma fronteira da vitrine (migration 0005).
  Carta reservada/indisponível **nunca** aparece.
- **`and c.embedding is not null`** — sem vetor não há como rankear; ignora estoque
  não vetorizado.
- **Filtros duros** — três linhas no padrão `p_X is null or coluna <op> p_X`:
  quando o parâmetro vem `NULL`, a condição é verdadeira e **não filtra**; quando
  vem valor, vira **WHERE exato**. `valor_entrada` usa `coalesce(...,0)` para tratar
  entrada nula como 0 (não excluir carta sem entrada cadastrada de um teto de entrada).
- **`order by c.embedding <=> p_embedding`** — ordena por **distância de cosseno**
  (menor = mais parecido). É **só ordenação**, dentro do conjunto já filtrado.
- **`score = (1 - distância)`** — 1.0 = idêntico, 0 = ortogonal. É um sinal de
  **relevância de texto** para a UI; **nunca** é "chance de contemplação".
- **`limit greatest(1, least(coalesce(p_limite,3),12))`** — clamp defensivo: no
  mínimo 1, no máximo 12, mesmo se o chamador mandar lixo. A rota chama com 3.
- **Risco / atenção:**
  - `tipo_bem` é enum do schema 0001 — a RPC depende de ele existir (ordem das
    migrations importa: 0001 antes de 0007).
  - HNSW é **aproximado**: pode, em tese, não trazer o vizinho exato mais próximo.
    Para um catálogo pequeno o efeito é irrelevante e o ganho de latência compensa.
  - `security definer` é necessário aqui; a contenção está em a query só projetar
    campos públicos e só `disponivel`. Conferido: não há vazamento de coluna.

### 5. Grant
```sql
revoke all on function public.buscar_cartas_semantica(vector, tipo_bem, numeric, numeric, int) from public;
grant  execute on function public.buscar_cartas_semantica(vector, tipo_bem, numeric, numeric, int) to authenticated;
```
- **Revoga de `public`** (ninguém por padrão) e **concede só a `authenticated`**.
- Anônimo **não** chama — busca é da área logada, como a vitrine.
- A assinatura no grant casa com a da função (5 tipos) — necessário porque pode
  haver overload; aqui é exata.

### Bloco de verificação (comentado, opcional)
O rodapé traz `select`s para conferir extensão, colunas, índice e um exemplo de
chamada — tudo **comentado**, não executa nada. Útil para o Emerson conferir
pós-aplicação.

### Veredito do item (b)
Migration **coerente e segura**: idempotente, sem tocar dado existente, sem alterar
RLS, RPC com saída pública e fronteira de vitrine. **Um ajuste cosmético feito**
nesta revisão: o comentário do cabeçalho citava um caminho inexistente
(`scripts/backfill-embeddings.ts`); corrigido para o caminho real
(`app/api/backfill-embeddings/route.ts` + `descricaoDeCarta()` em `lib/ia.ts`).
Nenhuma mudança de comportamento — só comentário.

---

## (c) Validação lógica — filtros duros × ranking vetorial

**Tese a provar:** o **preço/tipo nunca é aproximado**; o vetor **só ordena**, e
ordena **dentro** do conjunto que o SQL já filtrou de forma exata. Em fintech isso
é inegociável: quem tem teto de R$ 80 mil **não pode** ver carta de R$ 120 mil,
por mais "semanticamente parecida" que ela seja.

### Onde cada decisão acontece
| Decisão | Quem decide | Como |
|---|---|---|
| Tipo do bem (imóvel/veículo) | **SQL** | `p_tipo is null or c.tipo = p_tipo` (igualdade exata) |
| Teto de crédito | **SQL** | `p_valor_max is null or c.valor_credito <= p_valor_max` |
| Teto de entrada | **SQL** | `p_entrada_max is null or coalesce(c.valor_entrada,0) <= p_entrada_max` |
| Só estoque vendável | **SQL** | `c.status = 'disponivel'` |
| Só o que dá pra rankear | **SQL** | `c.embedding is not null` |
| **Ordem** dos que sobraram | **Vetor** | `order by c.embedding <=> p_embedding` |
| Quantos voltam | **SQL** | `limit clamp(1..12)` |

O vetor aparece **uma única vez** e **só** no `order by`. Ele **não** está em
nenhuma cláusula `where`. Logo, é **logicamente impossível** que a similaridade
"resgate" uma carta fora do teto: ela já foi cortada pelo `where` antes de chegar
ao `order by`.

### Fluxo no servidor (route handler) — confirma o desenho
`platform/app/api/buscar-cartas/route.ts`:
1. **Autentica** (`getUser()` → 401 se não logado). Busca é logada.
2. **Rate-limit** por `user.id` (8/min, em memória) → 429. Contém custo OpenAI.
3. Valida texto (`< 3` chars → 422) e trunca a 400 chars.
4. **Em paralelo** (`Promise.all`): `extrairIntencao(desejo)` (LLM → filtros duros)
   **e** `gerarEmbedding(desejo)` (vetor do desejo). Qualquer falha → **503**
   (degrada explicitamente, não inventa resultado).
5. Chama a RPC com `p_tipo / p_valor_max / p_entrada_max` vindos da **intenção** e
   `p_embedding` vindo do **vetor**. Erro de RPC → 400.
6. Para cada carta, `fraseDeEncaixe()` (frase compliance-locked; cada uma cai em
   fallback seguro). Devolve `cartas[]` + `criterios{tipo_bem,valor_max,entrada_max}`.

Pontos lógicos que sustentam a tese:
- **Separação de papéis**: `extrairIntencao` produz **números**; `gerarEmbedding`
  produz **vetor**. Vão para parâmetros diferentes da RPC. Não se misturam.
- **Filtro ausente ≠ filtro frouxo**: se o LLM não achou teto, `valor_max` vem
  `null` e o SQL **não filtra preço** — mas aí o cliente também não pediu teto.
  O sistema nunca **inventa** um teto nem **ignora** um teto que veio.
- **Degradação honesta**: se a OpenAI cai, a rota responde 503 — **não** devolve
  lista "no chute". Sem vetor não há ranking; sem intenção não há filtro confiável.
- **`score` é cosmético**: vem no payload por carta, mas **não** reordena nada no
  client e **não** é apresentado como probabilidade de nada. A ordem é a que o SQL
  já devolveu.

### Casos lógicos (o que **deve** acontecer)
1. *"apê de uns 300 mil com entrada baixa"* → `tipo=imovel`, `valor_max≈300000`,
   `entrada_max` baixa. **Só** imóveis `<= 300k` com entrada dentro do teto entram;
   entre eles, o vetor põe na frente os de descrição mais próxima do desejo.
2. *"carro até 80 mil"* → `tipo=veiculo`, `valor_max=80000`. Imóvel **não** aparece
   (corte por tipo); veículo de 120k **não** aparece (corte por preço) — ainda que
   o texto fosse parecido.
3. *"primeiro imóvel pra família crescer"* (sem número) → `tipo=imovel`, tetos
   `null`. Todos os imóveis disponíveis entram; o **vetor** é quem privilegia os de
   nuance "família/primeiro imóvel". Aqui o ganho semântico aparece sem relaxar
   nenhum preço (porque o cliente não deu preço).
4. *desejo vago/curto* (`< 3` chars) → 422, nem chega à RPC.

### Veredito do item (c)
**Tese comprovada por construção.** O vetor não tem como furar o filtro porque não
participa do `where`. Precisão financeira é do SQL (igualdade/`<=` exatos);
nuance é do vetor (só `order by`). Falha de IA degrada para 503, nunca para um
resultado inventado.

> **Confirmação empírica fica para o item (d)**, no banco **DEV novo** — este
> documento prova a lógica; os `curl` provam o comportamento com dados reais.

---

## (d) Roteiro de validação por `curl`

> ### ⚠️ LEIA ANTES DE RODAR
> **Todos os comandos abaixo são para o banco Supabase DEV NOVO** — aquele que
> você (Emerson) vai criar e apontar no `.env.local`. **NUNCA** rode contra
> `nnvjeijsrwpzsggwqpcu` (PROD). Os comandos só funcionam **depois** de:
> 1. criar o projeto Supabase DEV;
> 2. aplicar as migrations **na ordem** `0001 → … → 0007` nesse DEV;
> 3. preencher no `.env.local` (do projeto DEV):
>    - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
>    - `SUPABASE_SERVICE_ROLE_KEY` (só no servidor; nunca no client/repo)
>    - `OPENAI_API_KEY` (só no servidor)
>    - `CRON_SECRET` (qualquer segredo forte; usado no backfill)
> 4. ter cartas de teste cadastradas (`seed_dev.sql` ou cadastro manual);
> 5. subir o app local: `npm run dev` (porta padrão 3000).
>
> Sem esses passos, os `curl` retornam 401/erro — **é esperado**.

### Convenções
```bash
BASE="http://localhost:3000"          # app DEV local
CRON="<CRON_SECRET do .env.local DEV>" # mesmo valor do .env.local
```
A busca é **logada** → precisa de cookie de sessão. Duas formas:
- **(simples)** logar no navegador (magic link), abrir DevTools → Network → copiar
  o header `Cookie` de uma chamada e colar em `COOKIE` abaixo; **ou**
- testar a busca direto pela tela `/buscar` no navegador (o backfill abaixo é por
  `curl` com `CRON_SECRET`, não precisa de cookie).
```bash
COOKIE="<cole aqui o header Cookie de uma sessão logada no DEV>"
```

### Passo 1 — Backfill em loop (até `restantes: 0`)
Vetoriza as cartas de teste. Autoriza por `CRON_SECRET` (não usa cookie).
```bash
# Um lote (default 25). Repita até "restantes":0.
curl -s -X POST "$BASE/api/backfill-embeddings" \
  -H "Authorization: Bearer $CRON" | tee /tmp/bf.json

# Loop automático: chama em sequência até zerar os restantes.
while :; do
  out=$(curl -s -X POST "$BASE/api/backfill-embeddings" \
        -H "Authorization: Bearer $CRON")
  echo "$out"
  echo "$out" | grep -q '"restantes":0' && break
  sleep 1
done
```
**Esperado:** JSON `{"ok":true,"processadas":N,"falhas":[],"restantes":M}` e, ao
final, `"restantes":0`. Se vier `{"ok":false,"erro":"nao_autorizado"}` (401), o
`CRON_SECRET` não bate com o `.env.local`. Se `falhas` vier com ids, a `OPENAI_API_KEY`
provavelmente está ausente/inválida no DEV.

### Passo 2 — As 4 buscas
Cada uma é `POST /api/buscar-cartas` com `{ "texto": "..." }`. Precisa de `COOKIE`
de sessão logada no DEV.
```bash
busca () { # $1 = texto
  curl -s -X POST "$BASE/api/buscar-cartas" \
    -H "Content-Type: application/json" \
    -H "Cookie: $COOKIE" \
    -d "{\"texto\": $(printf '%s' "$1" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')}"
  echo
}
```

**Busca 1 — filtro duro (preço/tipo exatos):**
```bash
busca "carro até 80 mil pra trocar o meu"
```
- **Esperado:** `criterios.tipo_bem = "veiculo"`, `criterios.valor_max ≈ 80000`.
  **Nenhuma** carta com `valor_credito > 80000`; **nenhum** imóvel. Prova o item (c)
  na prática: o teto é uma parede, não uma sugestão.

**Busca 2 — nuance semântica (sem número):**
```bash
busca "primeiro imóvel pra família crescer com tranquilidade"
```
- **Esperado:** `criterios.tipo_bem = "imovel"`, tetos `null`. Volta uma lista de
  imóveis disponíveis **ordenada** de modo que os de descrição mais próxima de
  "primeiro imóvel / família" venham antes. Prova que o **vetor ordena** quando não
  há preço pra filtrar.

**Busca 3 — degradação (503/fallback honesto):**
```bash
# Pré-condição: rode ESTA busca com a OPENAI_API_KEY temporariamente vazia/errada
# no .env.local do DEV e reinicie o npm run dev.
busca "apartamento de uns 300 mil com entrada baixa"
```
- **Esperado:** HTTP **503** com
  `{"erro":"Não foi possível processar a busca agora. Tente de novo."}`.
  **Não** pode vir lista "no chute". Confirma que, sem IA, o sistema **degrada**,
  não inventa. (Depois, restaure a chave e refaça para ver a busca normal.)

**Busca 4 — compliance (a barreira está no texto, não na busca):**
A barreira `sanitizarCompliance` blinda a **frase de encaixe** (`fraseDeEncaixe`)
e qualquer saída de IA. A busca em si não promete nada; mas vale confirmar que
**nenhuma** `encaixe` no payload contém promessa de prazo nem mecânica interna.
```bash
busca "quero garantir que vou ser contemplado mês que vem"
```
- **Esperado:** a busca responde normalmente (é só um desejo do cliente; o texto
  **dele** não é publicado). As frases `encaixe` retornadas **não** podem conter
  data/prazo de contemplação nem CCB/FIDC/funding/etc. Se a IA tentasse, o
  `fraseDeEncaixe` cai no fallback neutro
  ("Esta carta se encaixa no perfil que você descreveu."). Confira no JSON: nenhum
  `encaixe` com mês/ano/"contemplado em".

### Checklist de aceite do Nível 3 (no DEV)
- [ ] Backfill chega a `"restantes":0` sem `falhas`.
- [ ] Busca 1: teto e tipo respeitados (zero carta fora do filtro).
- [ ] Busca 2: imóveis ordenados por nuance, sem perder nenhum por falta de número.
- [ ] Busca 3: 503 honesto quando a IA está indisponível.
- [ ] Busca 4: nenhuma frase de encaixe viola compliance.
- [ ] (opcional) `score` decrescente dentro de cada resposta.

Passou nos 6 → **Nível 3 validado no DEV**. Aí sim: avaliar `git push` e, só
depois, abrir o Nível 4.

---

## (e) Resultado da validação executada no DEV

> Banco DEV `fpgimirtiryivnrjdyxb` (ref do `.env.local`). App rodando local
> (`npm run dev`, localhost:3000). Buscas feitas pelo Emerson logado
> (`eme.santos123@…`), via UI `/buscar`, com evidência em print. **PROD não tocado.**

### Placar dos critérios de aceite

- [x] **Backfill** chegou a `{"ok":true,"processadas":6,"falhas":[],"restantes":0}`
      — todas as cartas disponíveis do DEV (6, do seed) com embedding.
- [x] **Auth** — `POST /api/buscar-cartas` sem cookie → **HTTP 401**
      (`{"erro":"Não autenticado."}`). Barreira de sessão confirmada.
- [x] **Busca 1** (filtro duro) — "Carro até 80 mil pra trocar o meu" → só
      **Veículos**, todos **≤ R$ 70.000** (70.000 / 30.590 / 37.949). A carta de
      R$ 196.735 (vista numa busca sem teto) **some** aqui. Teto = parede provado.
- [x] **Busca 2** (ranking por nuance, sem número) — "Primeiro imóvel pra família"
      → só **Imóveis**, zero veículo. O `tipo=imovel` foi extraído da nuance, não de
      número no texto. Prova que o **vetor ordena** quando não há preço pra filtrar.
- [x] **Apartamento de uns 300 mil com entrada baixa** → só Imóveis, crédito
      R$ 250.000 (dentro do teto de 300k). Teto + tipo respeitados juntos.
- [x] **Veículo de trabalho parcelado** → só Veículos (70.000 / 57.526), frases
      neutras ("compra programada", "de forma planejada").
- [x] **Busca 4** (compliance) — "quero garantir que vou ser contemplado mês que
      vem" → responde normalmente; **nenhuma** frase de encaixe promete contemplação,
      cita prazo/data ou mecânica interna (administradora/taxa/fundo). Frases tipo
      "oferece poder de compra para adquirir o veículo desejado".
- [x] **Ordenação por custo efetivo** coerente dentro de cada resposta (ex.: 1,04% <
      1,06% a.m. nos imóveis; 2,27% nos veículos).
- [ ] **Busca 3** (degradação 503) — **opcional, pendente.** É teste de infra:
      esvaziar `OPENAI_API_KEY` no `.env.local` (DEV), reiniciar `npm run dev`, refazer
      uma busca → esperar HTTP **503** sem inventar lista; depois restaurar a chave.

**Veredito:** núcleo do Nível 3 **validado no DEV**. A busca semântica se comporta
como projetada — **filtro duro como parede + vetor só na ordenação** — e a barreira
de compliance segura as frases de encaixe. Resta apenas o teste 503 (opcional) antes
de considerar push/PROD.

---

*Documento de validação. Não executa nada por si. Os comandos da seção (d) são para
o banco DEV NOVO; o banco `nnvjeijsrwpzsggwqpcu` (PROD) não é tocado.*
