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

---

# 12 — CONSISTENCIA-01, segunda rodada: rebase, selo RA e Regra 8

Autorizações desta rodada, todas de Emerson (03/08): manter a correção dos 6
bullets editoriais; remover o resíduo "mais previsível do que linhas de
crédito"; rebase em `f4dd9c6`; rodar o gerador de novo; reauditar o preview
com asserção de sanidade; instalar o selo RA Verificada. **Produção segue
travada aguardando aval nominal.**

Branch `consistencia-01` = `0beb4c4` (forçada sobre `fd921ba` após rebase).

## 12.1 — A decisão que virou norma

Emerson: *"quando spec e critério de aceite conflitam, manda o critério de
aceite — ele é o que a G2 vai medir."* A spec listava 2 substituições do
bloco C e ao mesmo tempo exigia zero ocorrências global; os dois não cabem
juntos. Fica registrado o critério de desempate, que não era meu para decidir
sozinho e por isso foi levado ao portão em 11.4.1.

## 12.2 — Rebase

`git rebase f4dd9c6` conflitou em `public/index.html`, exatamente na região
que o bot reescreve. Resolvido com `--theirs` (em rebase, `--theirs` é o MEU
commit), verificado sem marcador de conflito e com os padrões proibidos em
zero antes do `--continue`. Resultado `9136a36`;
`git merge-base --is-ancestor f4dd9c6 HEAD` confirmou a ancestralidade.

Gerador rodado depois: `EXIT_GERADOR=[0]`, 2477 cartas, 60 cards, linha 42
com 60× "Bidcon — EGS Capital Participações Ltda" e 0× "Prospere".

## 12.3 — Resíduo de comparação com produto financeiro

Além do trecho nomeado, a varredura achou 22 "financiamento", 18 "juros" e
5 "linha de crédito" ainda no site. Classificados antes de tocar:

- **Corrigido (13 substituições):** cláusulas do tipo "sem os juros de um
  financiamento" e "custo mensal mais previsível do que linhas de crédito",
  mais um `<h2>` órfão — "Carta de crédito x financiamento" → "Como o custo
  do consórcio é exibido" — que eu mesmo tinha deixado para trás na primeira
  rodada ao reescrever o parágrafo sem reescrever o título dele.
- **NÃO tocado, aguarda decisão nominal:** 7 pares de FAQ "Qual a diferença
  entre carta de crédito e financiamento?" em `bidcon-imobiliaria` (2),
  `bidcon-lojista` (2), `bidcon.html` (1) e `carta-contemplada-veiculo` (2).
  A comparação está **na própria pergunta**, e cada par existe duplicado em
  JSON-LD `FAQPage` + `<details>` visível: editar mexe em rich result do
  Google. Não é decisão de execução.
- **NÃO tocado, de propósito:** `ferramentas/termo-reserva.html`. A palavra
  "juros" ali é item do `LEXICO_PROIBIDO` — é a guarda de compliance. Tocar
  seria remover a trava enquanto se limpa a vitrine.

Residual global: "mais previsível" 0, "linha(s) de crédito" 0.

## 12.4 — Selo RA Verificada

Instalado em **15 páginas**, 1 ocorrência por página, 0 duplicados.

- Bloco entre `<!-- BC:SELO-RA-INICIO/FIM -->`, imediatamente antes de
  `</body>`; medido `dentro_do_head = False` nas 15.
- `defer` no script, para não regredir o LCP mobile.
- **CSP precisou de mais do que o pedido.** O enunciado mandava liberar
  `script-src`. Baixando o bundle antes de instalar, ele chama
  `api.reclameaqui.com.br` e `verificada.reclameaqui.com.br`. Só com
  `script-src`, o script carregaria e o fetch morreria em `connect-src`:
  selo vazio — o cenário que o próprio enunciado classificou como pior que
  ausência. Liberados os três.
- **Armadilha do bot verificada, não assumida:** `gerar-vitrine.mjs` só
  reescreve entre `BC:SSR-COTAS-*` e `BC:SSR-LD-*`. Gerador rodado DEPOIS da
  inserção: bloco intacto, sem duplicação.
- **Fora:** `ferramentas/termo-reserva.html`, página-ferramenta sem rodapé
  institucional. Decisão minha, reportada e reversível.

**Divergência no enunciado do item.** A "faixa de selos do rodapé (Conta
Notarial, LGPD, Banco Central)" não existe. "Banco Central" aparece 1× em
`index.html` e 1× em `bidcon.html`, como `<span class="tchip">` da faixa de
confiança **do topo**. "LGPD" é texto corrido em `privacidade.html`. Não há
elemento `<footer>`; o rodapé é `<div class="foot">`, ausente em 4 dos 16
HTMLs. Por isso a âncora foi o fim do body, uniforme. Se a faixa era para
existir, ela é outra fatia.

## 12.5 — Auditoria do preview (Regra 8 em vigor)

`bidcon-app-git-consistencia-01-…vercel.app`, commit `0beb4c4`, com bypass
`_vercel_share` e cookie jar.

15 páginas HTML: **http=200 em todas**, bytes de 10.068 a 249.866, asserção
de sanidade `Grupo Prospere` ≥ 1 em todas, selo = 1, script = 1, soma dos 5
padrões proibidos = 0. `llms.txt` (5.290) e `robots.txt` (726) limpos. CSP
servida no preview já traz os três domínios.

**Um número exigiu explicação antes de eu aprovar:** `/` e `/bidcon`
devolveram 249.866 bytes idênticos. Não era coincidência — `vercel.json`
linhas 10-11 têm 301 de `/bidcon` e `/bidcon.html` para `/`. A página foi
aposentada de propósito. Consequências registradas, não corrigidas (fora do
escopo): `public/bidcon.html` é peso morto e minhas edições nele — inclusive
1 dos 7 pares de FAQ — nunca alcançam um usuário; o link interno
`<a href="/bidcon">O que é a bidcon</a>` no index é um 301 de volta à própria
home; e `/cartas → /bidcon → /` é salto duplo de 301.

**Erro de medição meu nesta rodada, apanhado antes de virar relatório:** o
check do selo pós-gerador imprimiu `selo_no_index=0` antes e depois — o `\"`
dentro de `$( )` dentro de aspas duplas virou barra literal e o grep procurou
`id=\"ra-verified-seal\"`. Um comando quebrado devolvendo o número que a
hipótese temia. Descartado e refeito em Python: 15/15. Regra 7, terceira
aparição na mesma fatia.

Corrijo também um número que dei antes: os "247335 bytes" do `index.html`
eram **caracteres** — `len()` do Python conta chars, e acento é 2 bytes em
UTF-8. O arquivo tem 249.703 bytes e não mudou depois do commit.

## 12.6 — Regra 8 no CLAUDE.md

Gravada como ditada por Emerson: nenhuma auditoria por fetch vale sem asserção
positiva que prove que o corpo foi lido; zero em corpo vazio é falso negativo,
não aprovação; e provar que o alvo é o sistema pretendido antes de auditar,
porque um repo pode alimentar mais de um deploy. Diff: 21 inserções, **0
remoções**, 8 regras — append-only preservado.

## 12.7 — Estado

CONSISTENCIA-01: **preview reauditado e verde. NÃO encerrada.** Faltam:

1. Aval nominal de Emerson para produção — não publico sem isso.
2. Decisão sobre os 7 pares de FAQ (12.3).
3. Decisão sobre o selo em `termo-reserva.html` (12.4).
4. Se a "faixa de selos" do 12.4 deve passar a existir de fato.

Pendências mantidas: INGESTAO-POSICIONAL-01 · PROSPERE-360-ADMIN-01 ·
divergência das cópias do widget · `package-lock` · trim de grants (FAROL-01) ·
regra de namespace · ciclo supervisionado 2.

---

## §13 — CONSISTENCIA-01, terceira rodada: o critério vira princípio

Append-only. Corrige por acréscimo o que §12 deu por fechado.

### 13.1 — O que passou por baixo de todas as auditorias anteriores

Publiquei em produção (`3f94b1c`) e só então ampliei o conjunto de padrões.
Achei **32 ocorrências de "Prospere" fora de "Grupo Prospere"** vivas no ar.

Causa, sem atenuante: minhas auditorias mediam o literal `"Prospere
Consórcios"`. Nenhuma dessas 32 usa esse literal. **O conjunto de padrões é
que define o que se pode achar** — o meu era estreito demais, e por isso os
verdes anteriores eram verdes verdadeiros de uma pergunta errada.

### 13.2 — REGRA PERMANENTE DA CASA (ditada por Emerson, 03/08)

> **O critério de aceite é o PRINCÍPIO, não a lista.**
>
> Critério: *zero ocorrências de "Prospere" fora de "Grupo Prospere", exceto a
> allowlist explícita — `Prospere Hortolândia`, `Prospere Corretora de Seguros
> LTDA`, e o texto de consentimento `pela bidcon/Prospere via WhatsApp`.*
>
> **Auditoria mede contra o princípio + allowlist, nunca contra literais
> escolhidos a dedo.** Lista de literais é hipótese; princípio com allowlist é
> critério. Quem audita pela lista só encontra o que já sabia.

Vale por analogia para qualquer fatia: se o critério puder ser escrito como
"zero X exceto allowlist", escreve-se assim, e a régua nasce do princípio.

### 13.3 — Corrigido (24 substituições, commit `5f71e14`, 9 arquivos)

| # | padrão | n | destino |
|---|---|---|---|
| A1 | ` \| Prospere` em og:title / twitter:title | 4 | removido |
| B  | `Intermediação e suporte Prospere` | 4 | `... bidcon` |
| B8 | `a bidcon/Prospere não é instituição financeira` | 3 | `a bidcon (EGS Capital Participações Ltda) não é ...` |
| B3 | `verificada pela Prospere` (template JS do modal) | 1 | `verificada pela equipe bidcon` |
| B4 | `Acompanhamento Prospere` | 1 | `Acompanhamento bidcon` |
| —  | `A plataforma da Prospere para` | 3 | `A plataforma bidcon para` |
| —  | JSON-LD `parentOrganization.name: "Prospere"` | 2 | `"Grupo Prospere"` |
| —  | `Fale com a Prospere` / `fale com a Prospere` | 6 | `... a bidcon` |

### 13.4 — Mantido intacto, por decisão nominal

Não é inconsistência de entidade, é fato:
- **Prospere Hortolândia** — agência parceira real.
- **Prospere Corretora de Seguros LTDA** — outra PJ, fonte de dado.
- **"Autorizo o contato pela bidcon/Prospere via WhatsApp"** — texto de
  consentimento; alterar texto de consentimento já colhido é pior que a
  inconsistência.

### 13.5 — Dois erros do meu instrumento, na mesma auditoria

Ambos apareceram na saída crua e foram corrigidos antes de virar relatório:

1. **A régua fabricou violação.** O script apagava `"Grupo Prospere"` do corpo
   antes do regex; onde havia `"name":"Grupo Prospere"` sobrava `"name":""` e o
   `prospere.com.br` vizinho era contado como violação. 72 falsos positivos.
   Corrigido mascarando com `@` do mesmo comprimento, preservando offsets.
2. **Regra 8 disparou e estava certa.** `/ferramentas/termo-reserva` deu
   `VIOL=0` com `sanidade=0` — a âncora `Grupo Prospere` não existe naquela
   página. Zero sem âncora não é aprovação; é medição inválida. Refeito com
   âncora `bidcon` (existe em todas), 4 ocorrências ali.

### 13.6 — Auditoria de produção sob a Regra 8 (`5f71e14`)

17 rotas derivadas do repo, não digitadas a dedo. Todas http=200, âncora
positiva, `VIOLACOES DO CRITERIO = 0`. Menor corpo 726 B (robots), maior
249 708 B (`/`). Âncora `bidcon` variando de 2 a 375 por página.

Dois `308` provados no destino, ambos desejados: `/bidcon → /` (redirect
declarado no `vercel.json`) e `/blog/ → /blog` (`trailingSlash:false`).

O gerador não reintroduz: `grep -c Prospere scripts/gerar-vitrine.mjs` = **0**.
O template JS do modal (B3) foi corrigido no próprio `index.html` e sobreviveu
à rodada do gerador.

### 13.7 — ABERTO: 76 ocorrências de infraestrutura, mascaradas e NÃO decididas

Mascarar não é decidir. Ficam registradas para chamada de Emerson:

| n | o quê | leitura |
|---|---|---|
| 37 | link/domínio `prospere.com.br` | é o site do **Grupo** Prospere, alvo do "by Grupo Prospere". Coerente. |
| 15 | e-mail `contato@prospere.com.br` | e-mail real em uso. Trocar exige caixa nova, não é edição de texto. |
| 15 | host `360prospere.vercel.app` | API interna. Invisível ao usuário, mas aparece no `window.BIDCON_API` e no CSP. |
| 8  | variável JS `PROSPERE_COTAS` | nome de variável do snapshot. Renomear toca o gerador. |
| 1  | `instagram.com/prospere.consorcio` em `sameAs` | **o único com cheiro de inconsistência de entidade**: o schema `Organization` da bidcon reivindica o Instagram da Prospere Consórcios como perfil dela. |

Recomendo tratar só o último; os quatro primeiros são infraestrutura legítima
ou custo desproporcional. Não toquei em nenhum.

### 13.8 — Estado

Produção `5f71e14`, deploy `dpl_4QxWAG5wXnSc52yAcDSbfsXbeVbp`, READY.

Seguem aguardando palavra nominal, de §12: os 7 pares de FAQ "Qual a diferença
entre carta de crédito e financiamento?" (JSON-LD FAQPage + `<details>`
visível), o selo RA em `termo-reserva.html`, e se a "faixa de selos" do rodapé
— que **não existe** — deve ser construída.

### 13.9 — Terceiro e quarto modos de falha de medição

Acréscimo a §13.5. A lista de modos de falha de medição desta casa passa a ter
quatro entradas, e elas apontam para direções diferentes:

| # | modo | o que ele produz | o que o pega |
|---|---|---|---|
| 1 | contexto errado (Regra 7) | falso negativo plausível | provar `pwd`/`git -C` na própria saída |
| 2 | corpo não lido (Regra 8) | falso negativo em corpo vazio | asserção de sanidade positiva |
| 3 | **régua que mascara antes de medir** | **falso POSITIVO** | **inspecionar o que foi acusado** |
| 4 | **resposta positiva que não discrimina** | **confirmação vazia** | **controle negativo** |

**Modo 3 — a régua fabrica violação.** Descrito em §13.5: apagar o padrão
permitido antes do regex criou 72 acusações falsas. A asserção de sanidade não
pega isto, porque ela só prova que houve corpo — não que a acusação procede.
**Sanidade positiva pega o falso negativo; só a inspeção do que foi acusado
pega o falso positivo. As duas direções precisam de verificação.**

**Modo 4 — instrumento que devolve sucesso para tudo (ditado por Emerson, 03/08).**
Testei se `instagram.com/bidcon.br` existia: `http=200`. Parecia confirmação.
Só virou informação quando criei o handle-controle
`handle-que-nao-existe-xyz-99887` e ele devolveu **o mesmo 200, com 605 KB**.

> **Regra: todo teste de existência precisa de controle negativo antes de valer
> como evidência.** Instrumento que devolve sucesso para o caso verdadeiro e
> para o falso não mede nada, mesmo parecendo confirmar.

### 13.10 — Quarta rodada: `sameAs`, FAQ e selo (decisões nominais de Emerson)

**`sameAs` — o achado era maior que a pergunta.** Ao medir por parse do JSON-LD
(e não por string truncada), o dono do `sameAs` é `Organization name='bidcon'`,
`@id=.../#org`, `legalName='EGS Capital Participações Ltda'` — não o Grupo. Nas
**10** páginas ele continha `https://www.prospere.com.br/`, ou seja, o site
declarava ao Google que a bidcon **é** o site do Grupo. `sameAs` é identidade;
`parentOrganization` é vínculo — e o vínculo já estava correto.

Decidido por Emerson: sai `instagram.com/prospere.consorcio`, sai
`prospere.com.br`, entra e propaga `instagram.com/bidcon.br`. Resultado em todo
o site: `sameAs = ["https://www.instagram.com/bidcon.br/"]`, único valor
distinto nas 10, com `parentOrganization` preservado intacto em todas.

**PROVENIÊNCIA, registrada como fato de Emerson e não como inferência minha:**
`instagram.com/bidcon.br` está ativo e é a conta oficial da Bidcon — afirmado
por Emerson em 03/08. **Eu não consegui verificar isso por HTTP** (modo 4:
login-wall devolve 200 para qualquer handle). O dado entra no site pela palavra
dele, não pela minha medição.

**FAQ — o comparativo sobrevivia onde mais pesa.** As 7 ocorrências eram 3
textos espelhados em JSON-LD `FAQPage` + `<details>`. Todas abriam com "O
financiamento cobra juros sobre o valor emprestado" e afirmavam "custo mensal
menor" — a mesma classe que o BLOCO C removeu do resto do site, só que em
structured data, onde vira rich result e o Google exibe a comparação na SERP.

Reescrito por Emerson, pergunta trocada de comparativa para descritiva:
"O que é uma carta de crédito de consórcio contemplada?", com a resposta
declarando compra programada sem juros e a transferência sujeita à análise e
aprovação da administradora. Variantes do bem: `do imóvel` (imobiliária),
`do veículo` (veículo), `do bem` (lojista). Residual: `custo mensal menor` = 0,
`Qual a diferença entre carta de crédito e financiamento` = 0.

**`bidcon.html`: bloco `FAQPage` removido inteiro** (o `<script>` só continha
ele). Structured data de FAQ sem conteúdo visível viola a política do Google, e
a página está 301 para `/` — era rich result declarado em página não servida.
Não se recriou `<details>` ali: o certo era remover a declaração, não fabricar
conteúdo para justificá-la.

**Selo em `termo-reserva.html`: instalado**, mesma instalação das demais, no fim
do body com `defer`. Cobertura agora **16 de 16** páginas HTML, 1× cada, zero
duplicatas. O guarda de léxico da página
(`["investimento","rendimento","rendimentos","rendendo","render","retorno","lucro garantido","juros","pix","sinal"]`)
não é disparado pelo bloco.

**Faixa de selos: NÃO construída**, por decisão de Emerson — a spec assumia uma
faixa que não existe, e construir componente novo seria mudança de layout, fora
do escopo desta fatia.

**Auditoria local:** violações do critério = 0; 25 blocos `ld+json` válidos, 0
inválidos; `sameAs` distintos no site = 1; selo 16/16; gerador com 0 ocorrências
de `Prospere`, `sameAs`, `FAQPage` e `ra-verified` — não reintroduz nada.

### 13.11 — `bidcon.html`: INAUDITÁVEL POR CONSTRUÇÃO (limitação conhecida, não pendência)

`public/bidcon.html` existe no repo, é buildado e sobe no deploy, mas **não é
servido em nenhuma rota**. Medido:

```
/bidcon.html  -> 308  redirect=https://www.bidcon.com.br/bidcon
/bidcon       -> 308  redirect=https://www.bidcon.com.br/
/             -> 200  (index.html)
```

Corrente de dois saltos, por soma de duas regras do `vercel.json`:
`"cleanUrls": true` tira o `.html` **antes** de a regra `/bidcon.html → /`
disparar, então quem manda é `/bidcon → /`. A regra do `.html` virou letra
morta e a chegada em `/` custa um hop a mais.

**Consequência para toda auditoria futura:** nenhuma alteração em
`bidcon.html` pode ser verificada por fetch. Nesta rodada removi dali o bloco
`FAQPage` inteiro — a remoção está verificada **localmente e no diff do
commit**, e é impossível de verificar em produção. Isso não é falha da Regra 9,
item 5: é cobertura que não existe, e está declarada.

Se a página voltar a ser servida (removendo o redirect), o que estará lá é o
estado do commit `b6c0d0d`: sem `FAQPage`, com `sameAs` já corrigido e com o
selo RA. **Não é pendência** — é propriedade conhecida da superfície,
registrada para que ninguém a redescubra como incidente.
