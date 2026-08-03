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

---

## §8 — ERRATA DE REGISTRO (append, 03/08)

O §7 acima fica como está — a liturgia é append-only, não reescrevo o que já
foi lido pela arquitetura. Ele contém um erro de nomenclatura com consequência
prática, corrigido aqui.

### 8.1 — "CORRECAO-1 encerrada" está ERRADO

O aceite de Emerson registrado no §7 refere-se ao **TESTE DA CORRECAO-2**
(caminho SSR: site → card → especialista → detalhe). **Esse aceite é válido e
está mantido** — o que foi testado, foi testado, e o que foi entregue (D-1..D-4,
commits `3d8239b`/`f1d1669`) está no ar.

**CORRECAO-1 é a migration 0065 (D16+D17), que NUNCA FOI APLICADA.** Carimbei
como encerrada uma fatia à qual falta o ato principal. O banco mede, e desmente:

| medida | valor |
|---|---|
| eventos `carta_nova_quarentenada` | **zero** |
| `ciclo_integridade_falhou` nas últimas 6h | **16** |
| varredura de CBC / PIFFER / PLAY | **travada** |
| vazamento de push (natimorta anunciada como novidade) | **vivo** |

**A FATIA NÃO ESTÁ ENCERRADA.** Falta um ato de produção, que executa **na
arquitetura**, sob a frase de Emerson — não aqui.

Erro meu, e da mesma família dos outros desta sessão: **conclusão mais larga
que a medição**. O §7 chegou a registrar corretamente o que *não* fora
verificado no caminho client-side, e ainda assim eu estendi um aceite de
caminho a um encerramento de fatia. Um "aprovado" sobre um teste não é um
"encerrado" sobre a fatia que o contém. Onde o §7 diz "CORRECAO-1: encerrada",
leia-se: **teste da CORRECAO-2 aprovado; fatia aberta, pendente da 0065.**

### 8.2 — FAROL-LOG-01 (registro novo)

Migration `create_farol_log` presente no xtv **sem número e fora da liturgia**.
Tabela `farol_log` vazia. Origem a confirmar com Emerson.

Conferi as policies, como pedido — e o resultado **precisa** ser lido inteiro,
porque metade dele engana:

```
RLS/LINHAS   farol_log   relrowsecurity=true   relforcerowsecurity=false   linhas=0
POLICIES     (nenhuma linha retornada)
GRANTS       anon           → SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
             authenticated  → SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
             service_role   → idem      postgres → idem
```

**Leitura:** RLS ligado com **zero policies** = *default deny*. Hoje `anon` e
`authenticated` **não leem nem escrevem** nada, apesar dos grants. Confirmado o
"latentes" da arquitetura — não há exposição ativa.

**Mas o desenho é uma armadilha carregada.** A porta está trancada por RLS, não
por permissão: a segurança depende da *ausência* de policy, e não da presença de
uma regra. No dia em que alguém adicionar **uma única policy permissiva** — ou
der `disable row level security` — `anon` ganha CRUD completo **incluindo
TRUNCATE**, de uma vez, sem que ninguém tenha escrito "dar acesso a anon" em
lugar nenhum. É o oposto do fail-safe: o default protege, a primeira mudança
abre tudo.

Não toquei em nada. `revoke` em tabela de origem desconhecida é ato de produção,
e ato de produção não se faz de passagem — vai sob fatia própria.

**Regra registrada:** *footprint de banco do FAROL só sob fatia própria,
gated.*

### 8.3 — Pendências mantidas

- **INGESTAO-POSICIONAL-01** — contrato `r.id`/`r.n` → `numero_externo`.
- **PROSPERE-360-ADMIN-01** — revisão do `1aa7a67` por Emerson.
- **Divergência das duas cópias do `prosperito-widget.js`** — 55 linhas.
- **`platform/package-lock.json`** — modificado na árvore local, fora de todos
  os commits, decisão de Emerson.
- **FAROL-LOG-01** — acima.

Sessão em espera. O fecho real vem depois do **ciclo supervisionado 2**,
verificado pela arquitetura.

---

## §9 — 0065 APLICADA (append, 03/08)

O §8.1 acima ficou **desatualizado no mesmo dia**: ele afirma que a 0065 nunca
foi aplicada, e isso deixou de ser verdade. Append, não reescrita — o §8.1
descreve corretamente o estado em que foi escrito.

**Ato executado na arquitetura, sob a frase de Emerson.** Não fui eu, e não
tenho como medir o conteúdo do que rodou daqui.

**Repassado pela arquitetura (atribuído, não medido por mim):** md5 pós —
`varrer3=83846ddb`, `aplicar=c83894d4`; shim intocado; 95.270 cartas
inalteradas; filtro 2→1; `quarentenada` + `returning` presentes.

**Medido por mim, independentemente**, no `supabase_migrations` do xtv:

```
20260802191207  0063_identidade_estavel_fingerprint
20260803013639  0064_correcao2_view_id_invoker
20260803014919  create_farol_log            ← sem número, fora da liturgia
20260803181037  0065_correcao1_d16_d17      ← ÚLTIMA, aplicada
```

Confirmo o **registro** da 0065 como aplicada e que ela é a última da fila.
**Não** confirmo os md5 nem as contagens — esses são medição da arquitetura e
ficam atribuídos a ela. Registro separado de propósito: repetir número alheio
como se fosse meu é exatamente o vício que a Regra 7 existe para impedir.

### 9.1 — Achado colateral sobre o FAROL-LOG-01

A listagem acima responde parcialmente o "origem a confirmar" do §8.2. A
`create_farol_log` **não** é um resíduo antigo nem apareceu em janela isolada:
foi aplicada em **03/08 01:49**, ou seja, **13 minutos depois da 0064**
(03/08 01:36) e no mesmo bloco de trabalho. Está cronologicamente encravada
entre a CORRECAO-2 e a CORRECAO-1.

Isso estreita a pergunta para Emerson: não é "de onde veio essa tabela?", é
"o que rodou nesta máquina/sessão entre 01:36 e 01:49 de 03/08". A resposta
provável é ferramenta automatizada agindo fora da liturgia na mesma janela em
que a 0064 foi aplicada — o que, se confirmado, vale mais como alerta de
processo do que como incidente de segurança (a tabela segue em *default deny*,
§8.2).

**Continua sem ação da minha parte.** Vale a regra já registrada: footprint de
banco do FAROL só sob fatia própria, gated.

### 9.2 — LACUNA DO §2 FECHADA: o bot real rodou

O §2 declarou um limite honesto: *"rodei o comando do bot, não o bot. Não
provei o ambiente do GitHub Actions."* Esse limite **caiu sozinho**. Ao
empurrar este relatório, o push foi rejeitado porque o origin havia andado —
era o workflow `atualizar-vitrine` executando de verdade, no Actions:

```
a789af9  chore(vitrine): snapshot automático do estoque
 public/index.html | 204 ++++++------- (102 insertions, 102 deletions)
```

Medido **no arquivo que o bot real produziu**
(`git show a789af9:public/index.html`):

```
data_id_uuids=60          ← 60 cards SSR, 60 uuids
chamadas_com_id=3         ← as três chamadas do D-2 intactas
data-id="9d1cfc2c-d5fe-44f1-889e-2b7b769677f1"
data-id="24bcab90-bff0-43a4-803e-f0b040b69173"
```

**Ramo (a) agora está provado no ambiente de produção do bot**, não por
simulação local nem por leitura de código. O aceite adicional do ATO D1 está
integralmente cumprido: o `id` sobreviveu ao snapshot real.

### 9.3 — Estado

Próximo tick = **ciclo supervisionado 2**, medido pela arquitetura contra o
§14.2 / T8. Sessão segue em espera. Pendências do §8.3 inalteradas.

---

## §10 — FAROL-LOG-01 RESOLVIDO (append, 03/08)

**Sem incidente.** Log do Postgres: `create_farol_log` aplicada em 03/08 01:49
via conector claude.ai de Emerson, **autorizada por ele em 02/08** ("AUTORIZADO:
farol_log") na conversa de design do FAROL. Liturgia própria daquela frente,
padrão **SEGURANCA-01** (RLS on, sem policies). Encerrado como alerta.

### 10.1 — Minha inferência do §9.1 estava errada

O §9.1 concluiu: *"A resposta provável é ferramenta automatizada agindo fora da
liturgia."* **Errado, e errado de um jeito específico que vale registrar.**

Acertei o mecanismo (foi ferramenta — o conector) e errei o que importava: li
**"sem número" como "sem autorização"**. Não estava fora da liturgia; estava
dentro da liturgia *de outra frente*, com palavra de Emerson dada no dia
anterior. Confundi *"não segue a convenção que eu conheço"* com *"não segue
convenção nenhuma"* — que é a versão de processo do mesmo vício das outras
vezes: **conclusão mais larga que a medição**. Eu tinha o timestamp; não tinha
o log do Postgres nem a conversa do FAROL. Deveria ter parado no timestamp.

O timestamp, aliás, foi útil: estreitou a janela e é o que permitiu resolver.
O erro não foi medir — foi anexar hipótese de causa a uma medição de tempo.

### 10.2 — O que do §8.2 permanece de pé

A leitura técnica continua válida e agora tem nome de padrão: RLS ligado com
zero policies = *default deny*, exposição ativa **nula** hoje. Isso é o
SEGURANCA-01 funcionando.

O que eu chamei de "armadilha carregada" **não era crítica ao padrão** — é
exatamente a razão do item que já está na fila: **trim de grants**. Com
`anon` segurando `SELECT/INSERT/UPDATE/DELETE/TRUNCATE` no papel, a proteção
mora só no RLS; a primeira policy permissiva que alguém escrever abre tudo de
uma vez. O trim tira a redundância perigosa e faz o `revoke` dizer explicitamente
o que o RLS já diz implicitamente. Segue **dentro da FAROL-01**, não aqui.

### 10.3 — Regra de namespace: evidência medida a favor

A proposta (prefixo `farol_` por frente) tem suporte empírico no próprio
histórico do xtv. A numeração sequencial global **já colidiu cinco vezes**,
com frentes diferentes reivindicando o mesmo número:

```
0039_api_cartas_publicas (11/07)      ×  0039_fornecedores_sync_config_acesso_privado (24/07)
0040_quarentena_cobre_update (11/07)  ×  0040_cartas_parcelas_detalhe_jsonb (24/07)
0043_busca_bidcon_price (11/07)       ×  0043_bidcon_price_parcelas_detalhe (24/07)
0047_whatsapp_envio (12/07)           ×  0047_sync_identidade_estavel (16/07)
0048_whatsapp_f3 (12/07)              ×  0048_cartas_vitrine_publica (16/07)
```

Além disso: `0027_sync_lotes` foi aplicada **depois** da `0030`, e há buracos
em 0050, 0051, 0056, 0059, 0060, 0061. Ou seja — o número sequencial global
**já não descreve** nem ordem de aplicação nem unicidade. O prefixo por frente
não é organização cosmética: é o reconhecimento de um fato que o banco já
registrou cinco vezes.

**Não é ato meu.** Fica como insumo medido para a decisão de Emerson.

### 10.4 — Estado

Pendências: INGESTAO-POSICIONAL-01 · PROSPERE-360-ADMIN-01 · divergência das
cópias do widget · `package-lock` (decisão de Emerson) · trim de grants (dentro
da FAROL-01) · regra de namespace (proposta a Emerson).

FAROL-LOG-01: **fechado**. Sessão segue em espera pelo ciclo supervisionado 2.

---

# §11 — CONSISTENCIA-01 · PREVIEW NO AR, AGUARDANDO O OLHO DE EMERSON

Fatia nova, autorizada por `AUTORIZADO: consistencia-01` (Emerson, 03/08/2026).
Alinhamento do bidcon.com.br ao dossiê G2. **Nada foi para produção.**

- Branch: `consistencia-01` · commit `fd921ba` (base `72d6925`)
- Preview: https://bidcon-app-git-consistencia-01-emerson-gomes-s-projects.vercel.app
- Produção segue em `f4dd9c6`, intocada.

## 11.1 — O achado que decidiu a execução (REGRA DO BOT, de novo)

Das 73 ocorrências de "Prospere Consórcios" no `index.html`, **60 estavam na
linha 42** — o JSON-LD que o workflow `atualizar-vitrine.yml` reescreve três
vezes por dia a partir de `scripts/gerar-vitrine.mjs`.

Corrigir só o HTML **passaria na auditoria e seria desfeito no próximo cron.**

Isto não é hipótese. Enquanto eu trabalhava, o bot rodou na `main` (`f4dd9c6`)
e o `git grep` pós-merge mede:

```
=== bot na main reintroduziu? ===
      61
```

Sessenta e uma ocorrências de volta, na produção, sem mão humana. A correção
foi feita **no gerador**, e verificada rodando o comando do próprio bot:

```
[gerar-vitrine] 2477 cartas disponíveis (filtro credito>0).
EXIT_GERADOR=[0]
=== JSON-LD do bot (index.html linha 42) ===
  Bidcon — EGS Capital Participações Ltda: 60
  Prospere: 0
```

## 11.2 — Auditoria do preview (fetch, 13 páginas)

```
PAGINA                           HTTP   BYTES | PC juros banco waAnt | GrupoProsp
OK    /                              200 249201 |  0     0     0     0 | 6
OK    /bidcon-lojista                200 121814 |  0     0     0     0 | 4
OK    /bidcon-imobiliaria            200 111874 |  0     0     0     0 | 4
OK    /carta-contemplada-veiculo     200 120774 |  0     0     0     0 | 4
OK    /repasse                       200  58282 |  0     0     0     0 | 5
OK    /conta-notarial                200  69169 |  0     0     0     0 | 1
OK    /seguranca                     200  25696 |  0     0     0     0 | 2
OK    /privacidade                   200  19853 |  0     0     0     0 | 3
OK    /empresas                      200  25766 |  0     0     0     0 | 3
OK    /vender-consorcio-contemplado  200  39746 |  0     0     0     0 | 5
OK    /blog/                         200   9403 |  0     0     0     0 | 2
OK    /llms.txt                      200   5290 |  0     0     0     0 | 1
OK    /robots.txt                    200    726 |  0     0     0     0 | 1
```

Deve permanecer, medido na home: EGS Capital 66 · CNPJ 2 ·
`NIRE 35.250.408.073 · Av. Brigadeiro Faria Lima, 1572, sala 1022 — São Paulo/SP` ·
disclaimer de instituição financeira 1 · "compra programada" 2 · WhatsApp
canônico 3. **Os seis critérios de aceite passam.**

## 11.3 — Incidente de medição (Regra 7, terceira vez nesta sessão)

A primeira auditoria que rodei deu **"OK" em 13 páginas** — e era lixo. As
páginas devolviam 307/404 com corpo vazio; o `grep` em nada retorna zero, e
zero é exatamente o resultado que a hipótese queria. Relatório fictício sem
mentira, na forma pura.

Duas causas, ambas minhas: (a) não segui os redirects da proteção de preview;
(b) **eu estava auditando o projeto errado.** O `bidcon-plataforma` serve o
Next.js de `platform/` (`<title>Bidcon · Área logada</title>`) — o site
estático sai de um **segundo projeto Vercel, `bidcon-app`**, no mesmo repo.

A auditoria só passou a valer quando pus uma **asserção de sanidade** —
`Grupo Prospere` tem de ser > 0; se der 0, a medição não vale. Foi ela que
pegou o erro.

Registro estrutural: **um repo, dois projetos Vercel.** Todo push nesta
`main` publica os dois.

## 11.4 — Três pontos que precisam do olho de Emerson, não do meu

1. **Reescrita editorial além dos padrões listados.** A spec dava substituição
   para duas frases do comparativo bancário. A varredura achou "juros de
   financiamento" em **seis outros lugares** (imobiliaria, lojista ×3,
   carta-contemplada-veiculo, blog, bidcon.html), vários como bullet
   `<li><b>Sem juros de financiamento:</b>`. Troquei por
   `<b>Custo efetivo transparente:</b>`. Isso é **mexer em copy**, e a spec
   diz explicitamente que mudança de conteúdo além dos padrões está fora de
   escopo. Fiz porque o critério de aceite 2 exige zero ocorrências — os dois
   itens da spec se contradizem aqui. **Se a leitura correta for outra, é
   reverter estes seis.**

2. **Resíduo de comparação que eu NÃO toquei.** Os mesmos bullets seguem com
   "custo mensal mais previsível **do que linhas de crédito**". É comparação
   bancária em espírito, mas não está na lista de padrões. Deixei. Nomeio em
   vez de decidir sozinho.

3. **Rebase antes de produção.** A branch nasceu em `72d6925`; a `main` já
   está em `f4dd9c6`. O merge exige rebase — e o `index.html` da `main` foi
   reescrito pelo bot. Depois do rebase, **rodar o gerador de novo** antes de
   publicar.

## 11.5 — Escopo tocado

`scripts/gerar-vitrine.mjs` + 17 arquivos de `public/`. **Zero arquivos em
`platform/`** — `app.bidcon.com.br` e "Modo leilão" não foram tocados, como
manda a spec. `platform/package-lock.json` segue fora do commit.

WhatsApp: 45 substituições em **três formatos** (`5519997561909`,
`+55-19-99756-1909`, `(19) 99756-1909`). O grep de string crua da spec pegaria
só o primeiro — os outros dois teriam sobrevivido à auditoria.

## 11.6 — Estado

CONSISTENCIA-01: **preview no ar, não encerrada.** Falta o olho de Emerson,
a decisão sobre o item 11.4.1, o rebase e a publicação.

Pendências mantidas: INGESTAO-POSICIONAL-01 · PROSPERE-360-ADMIN-01 ·
divergência das cópias do widget · `package-lock` · trim de grants (FAROL-01) ·
regra de namespace · ciclo supervisionado 2.
