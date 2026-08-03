# IDENTIDADE-01 — ÚLTIMO RELATÓRIO

**Canal definitivo.** Sobrescrito a cada relatório, empurrado ao origin na
mesma respiração. Colagem de relatório em chat: proibida.

---

## §0 — VEREDITO

**ATO D1 EXECUTADO E NO AR.** D-1, D-2, D-3 e D-4 aplicados, build verde,
152 testes passando, deploy confirmado em produção com o payload novo medido
na rota real. O aceite adicional (sobreviver ao bot de snapshot) foi cumprido
executando o próprio bot, não prevendo o que ele faria.

Commits: `3d8239b` (o ato) e `f1d1669` (snapshot regenerado).
Origin em `f1d1669`. ATO D2: morto nesta fatia por revogação do item 5.

**O número que justifica a fatia inteira, medido no payload de produção:**

| medida | valor |
|---|---|
| cotas no payload | 2657 |
| com `id` (uuid) | **2657 — 100%, todos únicos** |
| com `n` (= ref) **nulo** | **31** |
| cotas cujo `ref` está **repetido** no mesmo payload | **2301** |
| **não endereçáveis unicamente por `ref`** | **2332 — 87,8%** |

`ref 6`, no mesmo payload, é **duas cartas ao mesmo tempo**:

```
bd5100da-01de-4c2e-a7c4-49bcc45cb921  imovel   890000  CNP (Caixa)
51bc17ad-efea-4520-9db5-b248dddc0f8b  veiculo   14036  Mycon
```

O sintoma nunca foi "o sync realoca numero_externo entre rodadas". Isso é o
caso raro. O caso comum é que **`ref` não identifica carta nenhuma dentro de
uma única resposta** — 87,8% do estoque. O handoff por `ref` acertava por
sorte ou porque a guarda 4b abortava. As 31 cartas sem `ref` não tinham
sequer como serem apontadas.

---

## §1 — REGRA DO BOT: **RAMO (a)**, medido duas vezes

Ordem cumprida: medir antes de editar `index.html`.

**Medição 1 — diff do `2eb511d`** (o snapshot que apareceu no origin durante
o ato anterior): 35 hunks, todos entre as linhas **42 e 1074**. Linha 42 =
JSON-LD `<script id="ldCotas">`; linha 294 = linha de estatística
(`2549 cartas` → `2621 cartas`); 298–1074 = blocos `<span class="cnum">nº
1254</span>` dos cards SSR. **Nada acima de 1074.**

**Corroboração no próprio gerador** — o comentário de `cardHtml`
(`scripts/gerar-vitrine.mjs:141-142`) já declarava o motivo:

> "Card estático — mesmas classes CSS do card client-side (renderMarket(), em
> public/index.html), só sem os elementos interativos (onclick/handlers que
> dependem de JS ainda não carregado nesse ponto do carregamento)."

Card SSR não tem `onclick`. Logo o D-2 (que vive nos `onclick`, linhas
1334/1471) está fora do alcance do bot. **Ramo (a).**

**Medição 2 — a prova empírica, §2 abaixo.** Não me contentei com a leitura.

---

## §2 — ACEITE ADICIONAL: o `id` sobrevive ao bot (executado, não previsto)

`gh` não existe nesta máquina (`command not found`, exit 127), então não deu
para disparar o `workflow_dispatch`. **Fiz melhor: rodei o bot.** O workflow
`.github/workflows/atualizar-vitrine.yml:28` roda exatamente
`node scripts/gerar-vitrine.mjs`. Executei esse mesmo comando, no mesmo
repositório, com a mesma env (`BIDCON_PUBLISHABLE_KEY`, de
`platform/.env.local`), contra o mesmo banco.

```
EXIT_GERADOR=[0]
[gerar-vitrine] buscando vw_cartas_publicas...
[gerar-vitrine] 2657 cartas disponíveis (filtro credito>0).
[gerar-vitrine] public/index.html atualizado (60 cards estáticos de 2657 cartas no total).
```

**Depois da regeneração:**

```
=== data-id nos cards SSR (D-1 pós-bot) ===
data-id="9d1cfc2c-d5fe-44f1-889e-2b7b769677f1"
data-id="24bcab90-bff0-43a4-803e-f0b040b69173"
data-id="83f8af16-9fbf-41e3-81be-ff0a8dd45692"
total_data_id=60          ← 60 cards, 60 uuids

=== D-2 sobreviveu ao gerador? ===
chamadas_com_id=3         ← as três chamadas intactas

=== faixa que o gerador tocou ===
primeira_linha_tocada=42
ultima_linha_tocada=1062
linhas do D-2: 1334, 1471   ← fora da faixa
```

Ramo (a) confirmado por execução. O `id` sobrevive; o D-2 sobrevive.
Snapshot commitado em `f1d1669` para que a evidência fique no origin.

**Limite honesto do que provei:** rodei o comando do bot, não o bot. Não
provei o ambiente do GitHub Actions (checkout limpo, node 20, secret do
repo). Provei o comportamento do gerador, que é onde estava a dúvida. Se o
próximo cron produzir algo diferente disso, o culpado é o ambiente, não o
código — e será visível no diff do próximo commit `chore(vitrine)`.

---

## §3 — O QUE FOI APLICADO

**D-1 — a fonte expõe o `id`.**
`platform/app/api/vitrine/route.ts` — achado no caminho: esta rota lê
**`vw_vitrine_viva`**, não `vw_cartas_publicas` (o gerador é que lê a
segunda). Confirmei no `information_schema` que `vw_vitrine_viva.id` é
`uuid` na posição 1 antes de escrever qualquer linha. `campos` ganhou `id`;
`LinhaCarta` ganhou `id: string | null`; o map passa `id: c.id`. O `n`
**permanece** — é o rótulo exibido ("nº ...") e a chave de
`refCota(a.n)`/`abrirDetalhe(a.n)` no cliente. Não troquei uma coisa pela
outra; acrescentei a que faltava.

`scripts/gerar-vitrine.mjs` — `",id"` entrou em `campos` (linha 71, como
ordenado; coluna existe desde a 0064) e o card SSR ganhou
`data-id="${escHtml(c.id || "")}"`.

**D-2 — `index.html`, três chamadas incluindo a do modal.** Aplicado por
substituição literal com contagem (`TOTAL SUBSTITUIDO = 3`): a de
`abrirDetalhe` (modal, variante `e.`) e as duas de `renderMarket` (variante
`a.`). Reusei o helper `cfEsc` que já existia no arquivo, em vez de inventar
escape novo.

**D-3 — widget emite e lê `data-id`, nas duas cópias.** As duas cópias
**divergiram** entre si (55 linhas de diff, nos dois sentidos):
`platform/public/` já emitia `data-id` via `ctaAttrs` e tem `data-adm`/
`eyebrow`; `public/` tem os blocos `pw-carta-price` e a linha do ágio
"abaixo do teto" que a outra não tem. **Não unifiquei** — não é o escopo
desta fatia e unificar às cegas quebraria uma das duas. Apliquei o mínimo em
cada uma: `id` no `cartaFocoAtual` de `abrirProsperitoComCarta`, leitura de
`data-id` no handler de clique, e `id` no `cartaFocoAtual` do handler. A
divergência entre as cópias fica **registrada como achado**, não corrigida.

**D-4 — `atende` por `id`, fallback por `ref`, guarda 4b nos dois caminhos.**

```ts
const porId = typeof cartaFoco.id === "string" && cartaFoco.id !== "";
const baseQuery = supabase.from("cartas").select(...).eq("status","disponivel").gt("valor_credito",0);
const { data: cartaDb, error: erroCarta } = await (porId
  ? baseQuery.eq("id", cartaFoco.id as string)
  : baseQuery.eq("numero_externo", refFoco)
).maybeSingle();
```

`id?: string` é **opcional de propósito**: app antiga em cache e cards
hidratados client-side mandam só `ref`. A guarda 4b **não foi enfraquecida**
— continua nos dois caminhos, e o comentário no código agora diz por quê (no
fallback ela é a única defesa contra realocação; na busca por `id` ela ainda
pega a carta cujos valores mudaram desde o clique).

---

## §4 — EVIDÊNCIA DE EXECUÇÃO

```
$ git diff --stat        (antes do commit)
 platform/app/api/atende/route.ts     | 28 ++++++++++++++++++------
 platform/app/api/vitrine/route.ts    |  8 +++++++-
 platform/public/prosperito-widget.js |  6 ++++++
 public/index.html                    |  4 ++--
 public/prosperito-widget.js          |  8 +++++++-
 scripts/gerar-vitrine.mjs            |  9 +++++++--
 6 files changed, 51 insertions(+), 12 deletions(-)

$ npm run build > /tmp/build2.log 2>&1; RC=$?; printf 'EXIT_BUILD=[%s]\n' "$RC"
EXIT_BUILD=[0]     compiled=1     erros=0

$ npm test > /tmp/test2.log 2>&1; RC=$?; printf 'EXIT_TEST=[%s]\n' "$RC"
EXIT_TEST=[0]
ℹ tests 152   ℹ pass 152   ℹ fail 0   ℹ cancelled 0

$ git push ssh://git@ssh.github.com:443/emegs88/bidcon-app.git HEAD:main
   0c74930..3d8239b  HEAD -> main
```

**Amostra do payload, colhida na rota de produção depois do deploy:**

```
$ curl -s "https://app.bidcon.com.br/api/vitrine" -H "Origin: https://bidcon.com.br"
http=200 bytes=536215   total_cotas=2657   CAMPO_ID_PRESENTE=True

{
 "id": "83f8af16-9fbf-41e3-81be-ff0a8dd45692",
 "n": null,                       ← esta carta NÃO TINHA como ser apontada por ref
 "t": "imovel",
 "c": 136069.72,
 "e": 69524.88,
 "p": 854.67,
 "x": 109,
 "adm": "CNP (Caixa)",
 "custo": 0.65,
 "agio150": 20800,
 "agio120": 14700,
 "fonte": "cliente_direto",
 "exclusiva": true
}
```

A primeira cota do payload já é uma das 31 com `n: null`. Não escolhi o
exemplo: é o primeiro registro.

**Nota de higiene:** `npm test` falhava com exit 127 (`tsx: command not
found`) — o `tsx` está declarado em `package.json:27` mas ausente do
`node_modules/.bin`. Rodei `npm install` (exit 0), que resolveu **e sujou o
`platform/package-lock.json`**. O lockfile **não entrou no commit** (stage
conferido arquivo a arquivo antes de commitar); segue modificado na árvore
local, para decisão sua em separado.

---

## §5 — PENDÊNCIAS REGISTRADAS (não tocadas)

- **INGESTAO-POSICIONAL-01** — contrato `r.id`/`r.n` → `numero_externo`
  (`platform/lib/cotas-source.ts:147`; `prospere-360 cotas-extra/route.js:330`,
  `cotas-servopa/route.js:91`). Inclui a terceira instância da classe
  (`n:-(e+1)` em `public/index.html` e `public/bidcon.html:495`) e a cobertura
  futura de `id` real no caminho client-side do cotas-extra.
- **PROSPERE-360-ADMIN-01** — revisão do `1aa7a67` (`entrada_parceiro` cru
  atrás de `?admin=1`) por Emerson. Independente. Nada empurrado naquele repo.
- **Divergência das duas cópias do `prosperito-widget.js`** — achado novo
  desta fatia, 55 linhas, nos dois sentidos. Não unificado.

**Limitação declarada, confirmada em produção:** cards hidratados
client-side do cotas-extra não têm uuid (`normExtra` fabrica `n:-(e+1)` e não
tem `id`) → handoff com `id` ausente → `atende` cai no fallback por
`numero_externo` com guarda 4b = comportamento de hoje, sem regressão.

---

## §6 — ERROS DE FERRAMENTA DESTA SESSÃO (Regra 7)

Dois eventos, ambos pegos antes de virarem relatório:

**5º evento — `cd` perdido.** O diretório de trabalho voltou sozinho para
`/Users/prospere/Desktop/360prospere` (o pai) e o `git show` respondeu
`fatal: not a git repository`. Como a Regra 7 exige contexto provado na
própria saída, o erro apareceu no lugar do resultado plausível. Refeito com
`cd ... &&` explícito e `git rev-parse --show-toplevel` no output.

**6º evento — código de saída vazio, duas vezes.** `${PIPESTATUS[0]}` é
bashismo e este shell é zsh 5.9 (o correto seria `$pipestatus`); depois,
`echo "EXIT=$?"` após redirecionamento também voltou vazio. **Só descobri
porque o valor veio VAZIO, e não porque veio errado** — se tivesse vindo
`0` espúrio, eu teria relatado build verde sem ter medido. Testei o
mecanismo isolado (`true`→0, `false`→1) antes de confiar nele, e fechei com
`RC=$?; printf 'EXIT_BUILD=[%s]\n' "$RC"` — colchetes justamente para que
vazio seja visível como `[]` em vez de passar batido.

Menores: BSD grep estoura em `\{0,260\}` (teto 255); `grep -oE "...[^)]*\)"`
truncava na primeira `)` de uma linha minificada.

---

## §7 — FECHAMENTO

**Re-teste do caminho exato executado por Emerson (03/08): APROVADO.**
Site → card → especialista → detalhe. Sintoma morto na verificação humana,
que é a que vale — o payload de produção já estava medido (§0/§4), faltava a
ponta que nenhuma medição minha alcança: a carta certa aparecendo na tela.

Registro do que **não** foi verificado, para não virar aceite largo demais:
o teste cobre o caminho SSR/vitrine (card com uuid). O caminho dos cards
hidratados client-side do cotas-extra continua sem uuid, caindo no fallback
por `numero_externo` com guarda 4b — comportamento de hoje, declarado em §5,
não testado nesta rodada porque não mudou.

Tentei confirmar por logs de runtime se chegou requisição com
`carta_foco.id` preenchido; o conector devolveu rate-limit duas vezes
(`The connector's server is rate-limiting requests`) e a medição não saiu.
Fica como não-medido, não como medido-e-ok.

**Fatia IDENTIDADE-01 / CORRECAO-1: encerrada.** Seguem abertas, cada uma
com dono e escopo próprios: INGESTAO-POSICIONAL-01, PROSPERE-360-ADMIN-01 e
a divergência das duas cópias do `prosperito-widget.js` (§5).

Parando aqui, conforme ordenado.
