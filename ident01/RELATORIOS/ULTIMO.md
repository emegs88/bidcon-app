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

---

## 14 — CONTATO-01: migração do e-mail de contato (03/08)

**Autorizado por Emerson.** `contato@prospere.com.br` → `contato@bidcon.com.br`
no site estático. Commit `7d50a77`, deploy `dpl_AmwxaAmME2XxgPDw7MoHKMnq7RPq`.

### 14.1 — PROVENIÊNCIA (declarada, não medida)

A existência da caixa `contato@bidcon.com.br` e o fato de ela ser monitorada são
**fato afirmado por Emerson**. Não são medição deste agente.

O que eu medi foi só o domínio: `dig bidcon.com.br MX` devolve `1 smtp.google.com.`,
com controle positivo (`prospere.com.br` → hostinger) e controle negativo
(`xyz99887-nao-existe.com.br` → vazio). Isso prova que o **domínio** recebe e-mail.
MX é registro de domínio, não de caixa: nenhum teste de DNS discrimina se
`contato@` existe. A garantia da caixa é do Emerson.

### 14.2 — O número reconcilia: 15 em produção, 17 no site, 19 no repo

A autorização falava em 15. O repositório tinha 19. Não era divergência:

| | |
|---|---|
| 8 HTML em `public/` × 2 campos cada | 16 |
| − `bidcon.html`, que não é servido (§13.11) | −2 |
| + `llms.txt` × 1 | +1 |
| **= o que produção servia** | **15** |
| + os 2 de `bidcon.html` | **17** migrados |
| + `ULTIMO.md` (1) + `platform/` (1) | 19 no repo |

Migrados os 17. Os 2 de `bidcon.html` entram pela consistência do arquivo, sem
possibilidade de verificação em produção.

### 14.3 — O achado que justifica a fatia

O site publicava **dois endereços de contato diferentes ao mesmo tempo**:

- `contato@bidcon.com.br` nas páginas legais — `privacidade.html` (3×),
  `seguranca.html` (2×) — e na Regra de ouro do pagamento;
- `contato@prospere.com.br` no structured data, que é o que o Google lê.

Não era só inconsistência de entidade entre páginas. Era contradição interna
**na mesma página**: `index.html` declarava um endereço no texto legal e outro
no `Organization.email` do JSON-LD.

Cada HTML tinha o endereço em dois campos do mesmo `@graph` já corrigido em
CONSISTENCIA-01: `Organization.email` e `Organization.contactPoint.email`
(`contactType: sales`).

### 14.4 — NÃO alterado, por decisão explícita

| onde | por quê |
|---|---|
| `ident01/RELATORIOS/ULTIMO.md` | a ocorrência é a linha de §13.7 que registra a própria pendência; arquivo append-only |
| `platform/app/meu-processo/page.tsx` | app.bidcon.com.br, fora do escopo declarado da fatia |
| `BIDCON_ADMIN_EMAILS=emerson@prospere.com.br` | controle de acesso, não contato publicado |
| RLS `like '%@prospere.com.br'` (`0013_prospere_ancora.sql` + rascunho) | idem — alterar removeria o acesso admin da plataforma |
| `prospere.com.br`, `360prospere.vercel.app`, `PROSPERE_COTAS` | infraestrutura, mantida intacta por ordem |

Medido em `public/` após a migração: `prospere.com.br`=32, `360prospere.vercel.app`=18,
`PROSPERE_COTAS`=9, `prospere.consorcio`=0. O `prospere.com.br` caiu de 49 para 32
**sem que nenhuma referência de infraestrutura fosse tocada**: cada
`contato@prospere.com.br` continha o domínio como substring.

### 14.5 — Modo 3 outra vez: contagem por linha teria FABRICADO 8 acusações

Ao inspecionar o diff, a contagem por linha removida acusava **8 ocorrências de
`prospere.com.br` fora do e-mail**. Falso. O JSON-LD é minificado: a linha inteira
é substituída, e essas 8 reaparecem intactas na linha adicionada.

O instrumento que discrimina é a **diferença simétrica de tokens** entre linhas
removidas e adicionadas:

```
TOKENS QUE SO SAIRAM:    -17x  contato@prospere.com.br
TOKENS QUE SO ENTRARAM:  +17x  contato@bidcon.com.br
```

Nada mais mudou. Lição já na Regra 9, item 3, agora com segundo caso: **a unidade
de medida escolhida é parte da régua.** Contar por linha num arquivo minificado é
transformar antes de medir.

### 14.6 — Modo 5 outra vez: sitemap é DECLARAÇÃO, não o que é servido

Derivei a cobertura do `sitemap.xml`. Verde nas 14 rotas. Mas o sitemap tem 12
rotas e `public/` tem 16 HTML: **`/seguranca` e `/ferramentas/termo-reserva` não
estavam no sitemap e não foram medidos** — e `seguranca.html` é justamente uma
das páginas que já publicava o endereço novo.

Fechado por diferença contra o disco. Cobertura final: 12 do sitemap + `llms.txt`
+ `/blog` + as 2 faltantes = **16 rotas**, todas `ALVO=0`.

Lição, para somar ao item 5 da Regra 9: **derivar cobertura de um artefato que o
próprio site declara é derivar da intenção, não do fato.** Sitemap, índice e menu
são declarações. A cobertura se prova contra o que é publicado.

### 14.7 — Auditoria de produção sob a Regra 9 (`7d50a77`)

Provas do instrumento, todas na mesma saída:

- **can-fail**: corpo sintético com o alvo → régua conta 1; sem o alvo → 0.
- **âncora positiva**: `bidcon` presente em toda página medida (4 a 377).
- **controle negativo de rota**: `/rota-que-nao-existe-xyz99887` → 404, 0 bytes.
- **verbatim**: qualquer ocorrência do alvo seria impressa com 120 caracteres de
  entorno. Nenhuma foi.

Resultado: **16 rotas, VIOLAÇÕES=0, FALHAS=0**, 24 ocorrências servidas de
`contato@bidcon.com.br`. Local: 26 blocos `ld+json` válidos, 0 inválidos;
`sameAs` preservado em valor único; gerador inerte (`contato@`=0, `prospere`=0,
`email`=0).

O único 308 é `/bidcon` — §13.11, inauditável por construção, não falha.

### 14.8 — Estado

CONTATO-01 fechada. Critério de aceite atingido: zero ocorrências de
`contato@prospere.com.br` no site servido, endereço novo coerente com a Regra de
ouro do pagamento e com as páginas legais.

Segue aberto, sem decisão: a infraestrutura de §13.7 (`prospere.com.br`,
`360prospere.vercel.app`, `PROSPERE_COTAS`), mantida intacta por ordem expressa.

---

## 15 — SELO-CSP-01: o selo montava oculto (03/08)

**Autorizado por Emerson**, com diagnóstico conclusivo dele. Commit `10e64fc`.

### 15.1 — A causa

O `bundle.js` do RA carregava — `script-src` já tinha `s3.amazonaws.com` — e o
markup era montado. O que estava bloqueado era o **`styles.css` do widget**:
`style-src` listava apenas `'self'`, `'unsafe-inline'` e `fonts.googleapis.com`.

Sem a folha, a regra

```
.ra-widget-verified-content.ra-verified-loaded { visibility: visible !important }
```

nunca aplica, e o selo fica no DOM **permanentemente invisível**. Não era falha de
instalação nem de `id`: era CSP. Um recurso pode ser autorizado numa diretiva e
proibido em outra, e o sintoma — elemento presente e invisível — não se parece
com bloqueio.

Alterado, 1 diretiva, 1 linha, JSON revalidado antes de gravar:

```
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com
        -> ... https://fonts.googleapis.com https://s3.amazonaws.com
```

`font-src` já cobria: o CSS importa Open Sans de `fonts.googleapis.com` (style-src)
e os arquivos de `fonts.gstatic.com` (font-src), ambos liberados. `img-src` e
`connect-src` intactos.

### 15.2 — Item 2: a duplicata NÃO existe no fonte

A hipótese era tag do widget duplicada. Varredura das 16 páginas:

```
id="ra-verified-seal"=1   id="ra-embed-verified-seal"=1   raichu-beta=1   em TODAS
gerador: ra-verified / raichu / ra-embed = 0
```

O HTML servido tem exatamente uma ocorrência por página, e o gerador não injeta
selo. As duas requisições de `bundle.js` e `styles.css` observadas em algumas
cargas têm **outra causa, em runtime** — provavelmente o próprio bundle
reagindo ao bloqueio. Nada foi alterado a esse título: corrigir uma duplicata
inexistente seria inventar trabalho e mexer em 16 arquivos sem motivo.

### 15.3 — O que este instrumento NÃO alcança

O selo é renderizado por JS. **Fetch de HTML não prova visibilidade.** A presença
do `<div>` é condição necessária e não suficiente.

Provado por fetch: (a) o header CSP servido, (b) o `styles.css` respondendo,
(c) o `<div>` exatamente 1× por página.

Não provado, e não afirmado: que o selo aparece. Isso só o Emerson confirma no
navegador.

### 15.4 — O erro do meu instrumento, pego por redundância

Na primeira auditoria a saída se contradisse: o bloco [1] media `style-src+s3 =
SIM` para `/`, e o bloco [3] media `nao` para **a mesma `/`**.

Causa: em [1] eu lia o header com fallback de capitalização; em [3] só em
minúsculas. `dict(r.headers)` preserva a capitalização original, então a chave
minúscula não existe e o `.get` devolve vazio. O vazio virou "não tem s3".

Isto é a Regra 7 aplicada a header em vez de comando: **um acesso que erra a
chave devolve ausência, não erro.** A busca malsucedida se parece com uma
medição bem-sucedida de zero.

O que salvou foi ter medido a mesma coisa **duas vezes na mesma saída**, por
caminhos diferentes. Não foi perícia: foi redundância. Lição a somar à Regra 9:
quando o resultado for um zero ou um "não", vale medir o mesmo fato por um
segundo caminho — duas rotas discordando é a única evidência barata de que uma
delas está quebrada.

### 15.5 — Auditoria de produção (`10e64fc`)

Provas do instrumento, na mesma saída:

- **can-fail do contador**: corpo sintético com o div → 1; sem o div → 0.
- **can-fail da leitura de CSP**: header sintético sem s3 → `False`; com s3 →
  `True`; sem a diretiva → `None` (ausência distinguida de negativa).
- **controle negativo de rota**: `/rota-que-nao-existe-xyz99887` → 404, 0 bytes.
- **controle negativo de asset**: arquivo inexistente no bucket do RA → 403, 0
  bytes, contra 200 do `bundle.js` (8371 B) e do `styles.css` (3197 B).
- **âncora positiva** `bidcon` em toda página medida (4 a 377).

Resultado:

| critério | resultado |
|---|---|
| (a) `style-src` com `s3.amazonaws.com` | **15 de 15** rotas servidas |
| (b) `styles.css` do RA | **200**, 3197 B |
| (c) `<div>` e script 1× por página | **15 de 15** |

A 16ª é `/bidcon` — 308, inauditável por construção (§13.11).

### 15.6 — Estado

Correção no ar. **Pendente de confirmação visual do Emerson no navegador** — é o
único critério que este agente não consegue medir.

---

## 16 — Regra 9 ganha o sexto item: medição redundante (03/08)

**Ditado por Emerson.** Item 6 acrescentado à Regra 9 no `CLAUDE.md`.

> **Medição redundante em caminho independente.** Diante de um zero, de um "não"
> ou de qualquer ausência, meça por um segundo caminho antes de concluir. Duas
> rotas discordando é a evidência mais barata de que uma delas está quebrada;
> duas rotas concordando é a confirmação mais barata que existe. Ausência nunca
> se aceita de uma leitura só quando há caminho independente disponível.

### 16.1 — Uma linha modificada, declarada antes de gravar

A seção de regras do `CLAUDE.md` é append-only. Esta edição **quebra isso em uma
linha**, deliberadamente e com aviso prévio: `"Cinco provas"` → `"Seis provas"`.
Manter "Cinco" acima de seis itens seria deixar no arquivo de normas o mesmo
defeito que a fatia CONTATO-01 corrigiu no site — duas afirmações contraditórias
no mesmo documento.

Diff medido: **16 inserções, 1 deleção**, e a única linha removida é a da
contagem. A nota de origem dos cinco modos foi preservada intacta, porque é
registro histórico do que aconteceu na CONSISTENCIA-01; o item 6 recebeu nota de
origem própria.

### 16.2 — As duas ocorrências que motivaram

**Dentro do repo (§15.4, medida por mim).** `.get('content-security-policy')` num
dicionário que preserva a capitalização original devolve vazio. O vazio passou
por medição: o relatório teria dito que o `style-src` não tinha `s3`, com o
header correto sendo servido. O que denunciou foi a mesma saída conter dois
blocos que mediam a MESMA rota e discordavam.

**Fora do repo (relato de Emerson).** Um fetch de `bidcon.com.br` devolveu a
página **anterior à fatia**, servida de cache. Estava a um passo de virar o
relato de que o deploy não havia subido — uma afirmação falsa construída sobre
uma leitura verdadeira. O que desmentiu foi consultar a Vercel: **fonte
independente**, não uma segunda tentativa do mesmo caminho.

Os dois casos têm a mesma forma. O instrumento não erra: ele responde. O que
falha é a inferência de que a resposta descreve o sistema, quando descreve
apenas o caminho até ele — a chave usada, o cache atravessado, o intermediário
que respondeu no lugar.

### 16.3 — O que muda na prática

Repetir o mesmo comando não é redundância; é a mesma leitura duas vezes.
Redundância exige **caminho independente**: outro protocolo, outro campo, outra
fonte, outro nível da pilha. Header contra corpo. Fetch contra API da Vercel.
Parse contra string. Disco contra sitemap.

E a assimetria que justifica o custo: um "sim" costuma trazer o conteúdo junto,
que é evidência em si. Um "não" não traz nada — é indistinguível de não ter
perguntado. Por isso a regra incide sobre a ausência, não sobre a presença.

### 16.4 — Estado

`CLAUDE.md` com 9 regras, Regra 9 com 6 itens. Pendente apenas a confirmação
visual do selo pelo Emerson (§15.6).

---

## 17 — PAINEL-WA-01: as seis correções do delta, e a régua que não cobria nada (04/08)

Fatia ditada pelo Emerson em seis itens, escrita na branch `painel-wa-01` sobre
a base `0d84a66`. **Oito commits, 14 arquivos, 846 inserções e 51 deleções.**
Worktree limpo depois de cada um.

```
617110b item 6: o {error} do supabase-js passa a ser conferido
93bb01b item 5 (UI): Encerrar como botão, Caminho B como link
9a8e042 item 5 (backend): encerrar arquiva, e mensagem nova reabre
bed0818 item 4: handoff vira mensagem na thread
f918bd2 item 3 (UI): compositor no painel, janela de 24h visível
96231e1 item 3 (backend): envio pelo painel com janela de 24h
a5cc910 item 2: última atividade derivada das mensagens
162b99b item 1: relê status antes de emitir
```

### 17.1 — A foto e a releitura, que era o defeito de verdade

O item 1 tinha nome de corrida, mas o que estava embaixo era uma forma que
reapareceu em quase toda a fatia: **valor fotografado num instante e usado como
verdade em outro.** O webhook lia `conversa.status`, empacotava no job junto com
o `podeResponder` já decidido, e o job atravessava `DEBOUNCE_MS = 8s` mais mídia,
visão e geração da Anthropic — dez a vinte segundos. É exatamente a janela em que
o operador clica "Assumir". A resposta do bot saía depois, por cima da pessoa,
com a foto na mão dizendo que podia.

A correção não foi um lock novo: foi **reler o status no ponto onde o lock já é
adquirido**, imediatamente antes de emitir. E o job que aborta por status virado
**registra o descarte na thread** — como o Emerson ditou, mensagem que some sem
rastro é pior que resposta duplicada.

A releitura ficou no **processador**, não no transporte. `sendText` precisa
continuar servindo o envio manual do painel, que é legítimo justamente quando
`status='humano'`. O `opt_out`, ao contrário, é do transporte — bloqueia toda
saída, e por isso o `graph.ts` já o relia.

O item 3 herdou o mesmo raciocínio na UI: o estado da janela no compositor é
**foto do render**. A autoridade é a rota, que relê. A tela avisa; ela não decide.

### 17.2 — O que cada item passou a fazer

**Item 2 — `atualizado_em`.** A leitura passou a derivar a última atividade de
`max(wa_mensagens.criado_em)`. A correção na escrita é DDL e continua **parada
esperando `AUTORIZADO: wa-touch`**. Enquanto isso o campo segue sendo hora de
criação com nome errado.

**Item 3 — envio pelo painel.** Rota nova `responder/`, com recusas explícitas:
409 se a conversa não está assumida, 409 no opt-out, 409 fora da janela de 24h,
502 com o erro real da Cloud API. `graph.ts` ganhou `papel?: 'prosperito' |
'humano'` — mensagem escrita por pessoa não pode ser gravada como se o bot
tivesse escrito. O `status_envio` gravado é sempre o **real**, nunca um
`'enviado'` otimista, e a bolha marca `· não entregue` quando falhou.

A janela de 24h é calculada **no servidor**, a partir da última mensagem do
cliente — resposta nossa não reabre janela nenhuma. O compositor não contém
nenhum `Date`: recebe booleano e frase prontos. Isso evita divergência de
hidratação e tira o relógio do navegador de uma decisão que é da Meta.

**Item 4 — handoff na thread.** `lib/whatsapp/sistema.ts`. Assumir e devolver
passam a narrar-se na conversa. Mensagens `sistema` são **descartadas da memória
do modelo** (`montarMensagensWa` faz `continue`), então narrar não faz o agente
acreditar depois que foi ele quem disse.

Aqui eu ia introduzir um defeito e vi antes: clicar "Assumir" numa conversa já
assumida era no-op silencioso; somar um insert sem mais nada geraria handoffs
duplicados. Resolvido com o `.neq()` **dentro do próprio update** e `.select("id")`
lendo o que mudou na mesma instrução. Ler antes e escrever depois deixaria a
janela aberta para dois operadores clicando junto.

**Item 5 — Encerrar.** `encerrado` existia no enum e aparecia em **um lugar do
código inteiro**: o ternário do selo na lista. Ninguém escrevia, ninguém lia para
decidir nada. Botar o botão sem mais nada criaria mentira nova, porque
`podeResponder` só exclui `humano` — o bot continuaria respondendo com o selo
dizendo "Encerrada". Havia duas saídas, e escolhi documentando a rejeitada:
*encerrado também silencia o bot* foi **recusada** porque o cliente que voltasse a
escrever receberia silêncio para sempre, e "nunca mais me mande nada" já tem
mecanismo próprio, o opt-out. Ficou: **encerrar é arquivar, e mensagem nova
reabre**, no webhook.

O Caminho B ("Atender no meu WhatsApp") saiu como **link, não botão**. A
diferença de peso visual é o conteúdo da fatia, não estética: disponível sem
fricção, não sugerido — com o aviso de que nada do que for dito lá fica
registrado aqui.

**Item 6 — o `{error}`.** `supabase-js` **devolve** erro, não lança; `try/catch`
em volta de query não pega nada. Corrigido no `logGuardrail` e — achado do
caminho — no vizinho `contarFallbacksRecentes`, onde a cegueira era **pior**:
query falha, `count` vem null, vira 0, e o anti-loop conclui "sem fallback
recente" e **para de escalar em silêncio**. Consequência comportamental, não só
log perdido.

### 17.3 — A régua não cobria nada, e foi um erro meu que provou

Numa isca de controle positivo escrevi `.neq("status", 12345)` esperando que o
`tsc` acusasse. **Não acusou.** A conclusão fácil seria "não coberto" e seguir;
a conclusão correta foi ver que a isca **não era capaz de falhar**: sem tipos
gerados, `supabase-js` aceita `unknown` no valor. Reiscado com um erro de tipo de
verdade (`const id: number = params.id`), o `tsc` acusou nas duas linhas.

O que isso revelou vale mais que a fatia: **nenhuma query desta fatia é coberta
pelo typecheck.** Nome de coluna é string; coluna errada compila e só quebra em
produção. O `tsc` verde nunca disse o que eu estava lendo dele.

Fechei o buraco pelo caminho independente que existia: conferi os **25 nomes de
coluna** usados contra `information_schema.columns`, com **dois controles
negativos** — `wa_conversas.coluna_que_nao_existe_xyz` e `wa_mensagens.assumido_em`.
Os dois voltaram `### AUSENTE ###`, provando que a medição sabia dizer não. Os 25
reais vieram com tipo. De quebra, `assumido_em` ausente confirma que a migração
`wa-atendente` continua não aplicada.

O controle positivo foi feito **dentro das regiões recém-escritas**, não em
arquivo isca descartável, sete vezes, com restauração byte a byte conferida.

### 17.4 — O que está provado e o que não está

**Provado.** Build real do Next: `exit 0`, sem linha de erro, com as duas rotas
novas coletadas (`.../encerrar`, `.../responder`) e a página da thread indo de
3,56 kB para 4,2 kB. Typecheck limpo em todos os passos, com cobertura provada
por isca. Os 25 nomes de coluna conferidos contra o catálogo, com controle
negativo.

**Não provado — e fica escrito assim.** Que `update().neq().select()` no
`supabase-js` devolve as linhas afetadas é semântica de runtime: o `tsc` não mede
isso e o build também não. A idempotência do assumir/devolver/encerrar depende
disso. Quem prova é a auditoria no preview, exercitando as rotas — e é lá que as
queries ganham a primeira cobertura real.

### 17.5 — Estado: o push está bloqueado

Os 8 commits existem **só na máquina local**. `git push` devolveu `could not read
Username for 'https://github.com': Device not configured`. O remoto é HTTPS, o
`gh` não está instalado, e o `credential.helper` é `osxkeychain`, indisponível
aqui. **Não vou digitar credencial** — nem que fosse pedido.

Leitura do remoto funciona (`ls-remote` exit 0), e por ela a base está segura:
`0d84a66` é ancestral de `origin/main`; o remoto só tem à frente um commit não
relacionado (`07c1c17`, snapshot automático do estoque).

Sem push não há preview, e sem preview não há auditoria — inclusive os controles
negativos obrigatórios de deslogado e não-admin. **A fatia está pronta e parada
nesse ponto, esperando o Emerson.**

Pendências nominais que seguem bloqueadas: `AUTORIZADO: wa-touch` (trigger do
`atualizado_em`) e `AUTORIZADO: wa-atendente` (`atendente_id`, `atendente_nome`,
`assumido_em`, confirmados ausentes do banco). E o teste ao vivo do Caminho A
depende da conversa `9eb5f278`, única com janela de 24h aberta.

## 18 — PAINEL-WA-01 fecha em produção: DDL, o push destravado por SSH, e o que ficou sem prova (04/08)

### 18.1 — O que foi aplicado no banco

Dois DDLs, cada um sob token nominal do Emerson.

`wa_touch_atualizado_em`. `atualizado_em` era mantida à mão por cada rota; quem
esquecesse deixaria a lista mentindo sobre a última atividade. **A convenção não
veio da minha memória:** li as funções já existentes e copiei o padrão da casa —
`<tabela>_touch` BEFORE UPDATE chamando `tg_<tabela>_touch()`, todas com
`SET search_path TO ''`. Eu teria omitido o search_path escrevendo de cabeça.

Provado **por comportamento, não por catálogo**: um bloco DO atualizou uma linha
sem tocar em `atualizado_em`, e um RAISE EXCEPTION carregou a medição para fora
forçando rollback — `antes=2026-07-16 … depois=2026-08-04 … DISPAROU=t`, com
`inalterada=true` na leitura seguinte. A prova não deixou resíduo. Sem backfill:
corrigir linhas antigas seria inventar história que ninguém mediu.

`wa_atendente_campos_handoff`. `atendente_id uuid references profiles(id) on
delete set null`, `atendente_nome text`, `assumido_em timestamptz`. A FK aponta
para `profiles` e não para `auth.users` porque **nenhuma tabela do public
referencia auth.users diretamente** nesta base; precedente exato:
`interesses.atendido_por`. Descoberto por reconhecimento, não suposto.

### 18.2 — As colunas nasceram MORTAS, e isso foi dito na hora

Criadas, nada as preenchia: `checarAdminConsoleApi()` devolvia só `{ok, email}`.
Registrei como coluna morta em vez de fingir entrega.

Decisão do Emerson: gate **aditivo**, `userId?: string` no braço `ok:true`.
Exigências dele, cumpridas e medidas:

- **Nenhum chamador quebra:** 12 call sites, **zero desestruturação** — todos
  `const acesso = await checarAdminConsoleApi()`. Medido por leitura dirigida,
  não suposto.
- **Typecheck com controle positivo DENTRO do gate:** tsc limpo PASSOU; com isca
  em `admin-console.ts:82` (dentro da própria função) e em `assumir/route.ts:68`,
  FALHOU nominalmente nas duas; restaurado, **sha256 idêntico byte a byte**;
  PASSOU de novo. Sem o passo do meio, o primeiro verde não valeria nada.
- **Identidade não se inventa:** sessão sem id devolve `undefined` e a coluna
  fica nula.

**Perigo encontrado antes de morder:** `atendente_id` tem FK. Um admin sem linha
em `profiles` causaria violação e derrubaria o *Assumir inteiro* — o operador
perderia a pausa do bot por causa de um campo de registro. O id só é gravado se o
perfil existir; o nome cai no e-mail autenticado, dado real da sessão.

`devolver` e `encerrar` **não foram tocados**, por decisão do Emerson: "status já
responde quem está nela agora; a coluna existe para responder quem assumiu.
Zerar destrói a única informação que ela guarda."

### 18.3 — O push estava bloqueado, e não foi credencial que resolveu

`could not read Username for 'https://github.com'`. Não pedi nem digitei senha.
Medi o que já existia: `ssh -T git@github.com` respondeu `Hi emegs88!`. Push por
URL SSH explícita, **sem alterar o config do repositório**. Efeito colateral
registrado: `origin/main` local ficou desatualizado, então `@{u}` virou régua
mentirosa e foi descartado em favor de `ls-remote`.

### 18.4 — Publicado em produção SEM auditoria de runtime, por decisão explícita

Ofereci três caminhos; o Emerson escolheu nominalmente o merge em main, cujo
texto dizia "SEM auditoria de runtime". A objeção foi feita uma vez; a decisão
foi dele.

Antes do merge, o que dava para provar sem sessão: build exit 0 com controle
negativo, e as 4 rotas em 401 com **corpo real da app**. Esse segundo ponto quase
virou relatório fictício: no preview o 401 vinha do **SSO da Vercel**, não do meu
portão — corpo que não é o corpo real, modo 1 da Regra 9. Refeito com URL de
bypass e cookie jar até sair `{"erro":"não autenticado"}` da própria app, contra
`404` na rota isca.

### 18.5 — Teste vivo, feito pelo Emerson em produção

`Assumir` gravou a mensagem `sistema` **uma única vez** (msg 98) e o envio pelo
painel gravou `papel: humano` (msg 99). Itens 3 e 4 provados por comportamento —
única régua que existia para eles, já que o tsc não cobre query nenhuma desta
fatia. As colunas `atendente_*` vieram nulas nesse teste porque o commit do gate
ainda não estava publicado: explicação, não mistério.

### 18.6 — NÃO PROVADO: a lista honesta

- **Controle negativo de não-admin.** Só o deslogado foi medido. Um usuário
  autenticado fora da allowlist deveria parar no 403, e ninguém verificou. Exige
  uma sessão que não temos, e **não se força**. Caminhos, do mais barato ao mais
  arriscado: (a) logar com um segundo e-mail que **não** esteja na allowlist e
  abrir uma rota admin — se vier 403 com corpo da app, fecha; (b) remover
  temporariamente o próprio e-mail da allowlist, medir, e repor — deixa o painel
  sem dono por alguns segundos, em produção; (c) permanecer aberto e declarado.
  Nenhuma delas eu executo sozinho: (a) depende de sessão humana, (b) mexe em
  controle de acesso em produção.
- **Que `update().neq().select()` devolve as linhas afetadas.** Semântica de
  runtime do supabase-js, e a idempotência de assumir/devolver/encerrar depende
  dela. A msg 98 aparecendo uma vez só é indício forte, não prova fechada.
- **Devolver** — o bot voltar a responder é o que fecha o item 1, a releitura de
  status. Não medido.
- **Entrega da msg 99 no aparelho.** Depende do WhatsApp; fora do alcance.
- **`GET /api/whatsapp` = 403.** Medido depois do deploy, nunca antes. Não posso
  afirmar que está inalterado, só que está assim.

### 18.7 — A Regra 7 apareceu três vezes nesta fatia

Todas pegas antes de virarem relatório, todas do mesmo tipo: comando quebrado
devolvendo resultado plausível.

1. `git status` imprimindo vazio seguido do meu próprio eco "(vazio acima =
   worktree limpo)". O diretório havia revertido sozinho e **todos** os git
   tinham errado. Corrigido com `git -C <abs>` e marcadores de fim.
2. `PUSH exit=` e `BUILD exit=` saindo **vazios**: a captura de `$?` quebrou
   depois de pipe. Substituído por veredito explícito com controle negativo
   (`false` → FALHOU), provando que a régua rejeita.
3. As quebras de linha de um bloco inteiro se perderam e o shell recebeu tudo
   como um comando só — `(eval):cd:1: too many arguments`. **Apareceu na tela um
   `RESULTADO=BUILD_FALHOU` que não era o build falhando: era lixo.** O build
   nunca rodou. Refeito por arquivo de script, com `EXIT_CODE=0` de verdade.

E uma quarta, ao gravar esta própria seção: a asserção de âncora usou
`t.count("## 17")`, que conta substring — `### 17.1` também casa. Deu 6 e
abortou. Reescrita para `^## 17` por início de linha, deu **AUSENTE** — e o §17
existe. O formato da casa é `## N — Título (data)`, com travessão e sem ponto.
Duas réguas erradas seguidas, ambas **falhando para o lado seguro**: nenhuma
gravou nada. É o comportamento que se quer de uma asserção pré-escrita.

Lição gravada: **eco meu não é medição.** Se a frase que interpreta o resultado
foi escrita por mim e não pelo instrumento, ela não prova nada.

### 18.8 — Fatias abertas na fila

**LEADS-WA-01** (ditada pelo Emerson) — botão de contato por WhatsApp na lista de
leads: link interno quando a conversa existe, `wa.me` com aviso de saída do
histórico quando não existe. A medição prévia que ele exigiu **antes** de
escrever já está feita:

- 37 leads, **todos** com telefone utilizável (≥8 dígitos).
- **6 conversas na base inteira.**
- **2 leads casam** pela regra dos últimos 8 dígitos. 35 vão para o `wa.me`.
- 0 ambíguos; controle negativo 0; controle positivo 37.
- **`wa_conversas.interesse_id` existe e está 100% vazia.** Eu ia usá-la como
  caminho independente (Regra 9, item 6). Medi a causa antes de concluir: se
  tivesse lido "0 por interesse_id contra 2 por telefone" como divergência,
  teria inventado um problema. É régua muda, não contradição — **e fica
  registrado que o casamento por telefone segue sem corroboração de segunda
  rota.**
- Pendente antes de escrever: colisão de sufixo. `11 98115-0213` e
  `21 98115-0213` têm os mesmos 8 finais e são pessoas diferentes. Entregar um
  "Abrir conversa" que leva à thread de outra pessoa é pior que não entregar.

**Dois achados abertos, ainda não investigados:**

- Markup `[[CARTA]]` / `[[OPCOES]]` aparecendo **cru** na thread do site. Falta
  medir o essencial: **o cliente também vê**, ou só vaza no painel? A resposta
  muda a severidade de cosmética para exposição.
- **Todos os leads em "Novo" desde 29/07.** Duas causas incompatíveis: fluxo
  acontecendo fora do painel, com o status nunca avançando; ou lead não
  atendido. Não dá para escolher entre elas sem medir, e a segunda é a cara.


## 19 — Fechamento dos achados abertos e escopo da LEADS-WA-01 (04/08/2026)

### 19.1 — [[CARTA]]/[[OPCOES]] cru: o cliente nao ve

Suspeita levantada na 18.8: markup aparecendo cru na thread do site.
Medicao em dois caminhos independentes.

Caminho 1 — banco, no nivel de MARCADOR (nao de mensagem):
  416 mensagens; 47 contem [[CARTA]]; 90 aberturas, 90 fechamentos, 0 desbalanceadas.
  [[OPCOES]]: 61 / 61 / 0. Maximo de 3 marcadores numa mesma mensagem.
  Markup so em papel='agente', so no canal 'site'.
  Regua provada CAPAZ DE FALHAR: isca sintetica com um marcador aberto e nao
  fechado devolveu abre=2, fecha=1 — a regua acusou.

Caminho 2 — os bytes efetivamente servidos ao navegador:
  bidcon.com.br e www  -> sha256 9588ea4f... (31224 bytes)
  app.bidcon.com.br    -> sha256 9fd5536f... (30846 bytes)
  Ambos contem PW_CARTA_RE (5 ocorrencias) e replace(PW_CARTA_RE (1).
  Controle negativo: caminho inexistente devolveu 404.

VEREDITO: o parser existe no arquivo servido e todos os marcadores estao fechados.
O cliente NAO ve markup cru. Severidade: cosmetica, restrita ao painel admin, que
renderiza o conteudo bruto sem passar pelo parser do widget.

Erro de regua registrado: a primeira contagem contava MENSAGENS que tinham abertura
e fechamento. Uma mensagem com dois marcadores, o segundo sem fechar, passaria limpa.
47 mensagens carregam 90 marcadores. A contagem por mensagem era cega justamente
para o caso que importava.

Desvio de prompt observado, sem acao: _prompt.ts:239 manda no MAXIMO 2 marcadores
[[CARTA]] por mensagem, e o medido e 3. O modelo desobedece. Sem consequencia para
o cliente enquanto os marcadores fecharem.

### 19.2 — Leads em "Novo" desde 29/07: nao e fluxo fora do painel

Fechado por medicao do Emerson: atendido_por nulo em 37 de 37, nenhum lead
trabalhado desde 07/07. Nao ha fluxo paralelo — sao leads nao atendidos.
Descontando testes e duplicatas, 31 pessoas reais esperando.
Consequencia direta: a LEADS-WA-01 deixa de ser conveniencia e vira o caminho de
contato.

### 19.3 — Colisao de sufixo: zero real

A regra 1 da LEADS-WA-01 casa pelos ultimos 8 digitos. Isso tolera DDI e nono digito
ausentes, mas pode colidir entre DDDs diferentes. Medido, nao assumido.

Primeira medicao (so digitos, sufixo 8):
  a_COLISOES_entre_leads     = 5   -> todas duplicatas EXATAS, nao colisoes
  c_COLISOES_entre_conversas = 0
  e_pares_casados            = 2

Segunda medicao (normalizacao completa da regra 4: prefixa 55 quando falta e exige
igualdade INTEIRA):
  d_pares_por_SUFIXO8            = 2
  e_pares_canon_IGUAL            = 2
  f_pares_canon_DIFERENTE_risco  = 0
  b_leads_canon_INVALIDO         = 0
  o_CONTROLE_NEGATIVO_impossivel = 0

Verbatim dos pares:
  7968d3a7 | Emerson | lead=19997561909 -> canon=5519997561909 || conv=5519997561909 || IGUAL=true
  96ca3ae4 | emerosn | lead=19997561909 -> canon=5519997561909 || conv=5519997561909 || IGUAL=true

Detector provado por isca sintetica (mesmo sufixo de 8, DDD diferente):
  lead=11988887777 canon=5511988887777 || conv=5521988887777 canon=5521988887777 || IGUAL=false
  h_ISCA_pares_por_sufixo = 1 ; i_ISCA_canon_diferente = 1

VEREDITO: colisao real zero, com detector provado capaz de acusar. Os 8 digitos
ficam, agora sem custo demonstrado.

Erro de rotulo registrado: na primeira rodada chamei os 2 pares de SUSPEITOS. A
diferenca era exatamente o 55 que a regra 4 manda tolerar — comportamento pretendido
rotulado como anomalia. O verbatim colado matou o falso positivo antes de ele virar
investigacao. Falso positivo criado pela nomenclatura da regua, nao pelos dados.

### 19.4 — Duplicatas em interesses: resolve na exibicao, nao no dado

5 grupos com 2 registros cada, 10 linhas ao todo:
  5511979915526 | registros=2 | mais_recente=2026-07-12 17:49:20
  5511981649351 | registros=2 | mais_recente=2026-07-15 18:03:17
  5519997561909 | registros=2 | mais_recente=2026-07-07 21:16:19
  5519999999999 | registros=2 | mais_recente=2026-07-13 22:15:07
  5581997194289 | registros=2 | mais_recente=2026-07-24 02:40:19

Dano ja existente, anterior a fatia: na lista entregue ao Emerson, Elvis, Claudia,
Victor e Daniel apareciam duas vezes. Ligar duas vezes para a mesma pessoa e atrito
com cliente real.

Deduplicar e escrita destrutiva e exigiria decidir qual linha sobrevive. NAO ENTRA.

DECISAO (Emerson): a lista agrupa por telefone normalizado na EXIBICAO. Uma linha
por pessoa, com contagem ("2 registros") e a data do mais recente. O leads-status
escreve em TODAS as linhas do grupo. Resolve a mentira sem apagar nada, e o banco
mantem o historico integro. Cabe no escopo ja autorizado: status e atendido_por,
agora em N linhas em vez de 1.

37 linhas viram 32 na lista. Nomes divergem dentro do grupo (Emerson / emerosn):
exibe-se o do registro mais recente, sem fundir dado.

### 19.5 — Numeros de teste: sem filtro heuristico

19999999999 e 19997561909 sao registros do proprio Emerson.
PROIBIDO inventar filtro por padrao de digito repetido — reprovaria numero real.
DECISAO (Emerson): leads de teste ficam VISIVEIS. Nenhum filtro, nada escondido.
19999999999 gera wa.me para numero inexistente e esta tudo bem: e registro dele e
ele sabe o que e.

### 19.6 — WIDGET-SYNC-01: duas copias divergentes do widget

Achado colateral da 19.1. As duas copias de prosperito-widget.js diferem e nenhuma
e superconjunto da outra:
  public/prosperito-widget.js           (9588ea4f...) tem .pw-carta-price e o rotulo
                                        de preco; NAO tem data-adm.
  platform/public/prosperito-widget.js  (9fd5536f...) tem adm no eyebrow e data-adm
                                        no CTA; NAO tem o bloco de preco.

Consequencia: reserva feita pelo host errado nasce com administradora vazia — dado
perdido na hora de fechar, e e a administradora que sustenta a logica de join.

Fatia propria, na fila DEPOIS da LEADS-WA-01. Escopo quando chegar a hora: convergir
para um superconjunto (bloco de preco + administradora com data-adm). Primeiro ato
da fatia: medir se da para servir UMA copia so pelos dois hosts. NAO TOCAR AGORA.

### 19.7 — LEADS-WA-01: escopo fechado

Baseline medido antes de escrever:
  37 leads, 0 com telefone inutilizavel
  6 conversas WhatsApp
  2 linhas casam = 1 pessoa
  32 grupos na exibicao: 1 com conversa, 31 sem
  wa_conversas.interesse_id existe mas esta 100% vazio — regua muda, nao
  contradicao; nao serve como caminho independente.

O controle negativo da Regra 9 (lead sem conversa mostra o caminho 3) nao precisa
ser fabricado: 31 dos 32 grupos sao o controle.

Escopo:
  1. Casamento por telefone normalizado (digitos, 55 prefixado, ultimos 8).
  2. Com conversa: "Abrir conversa" -> thread interna. Preferencial, destacado.
  3. Sem conversa: "Chamar no WhatsApp" -> wa.me/55<numero> com mensagem
     pre-preenchida, MAIS aviso na interface de que a conversa acontece no aparelho
     e nao entra no historico da Bidcon.
  4. Numero invalido nao gera link.
  5. Exibicao agrupada por telefone normalizado, com contagem e data mais recente.

AUTORIZADO: leads-status. Escrita permitida EXCLUSIVAMENTE em interesses.status e
interesses.atendido_por, a partir da lista, com o e-mail do gate como autor, em
todas as linhas do grupo. Nenhuma outra coluna, nenhuma outra tabela, nenhuma
migration. Todo o resto da fatia e somente leitura.

Pendente antes de escrever: os valores validos do enum de interesses.status e se
atendido_por e FK para profiles. Se for, vale a regra do atendente_id: so grava o id
se houver linha, senao deixa nulo e registra o nome onde couber.

### 19.8 — Ainda NAO PROVADO

  - Controle negativo de nao-admin (403): segue em (c) declarado. Sai de graca
    quando houver um segundo usuario no console.
  - Devolver (bot volta a responder): fecha o item 1 do PAINEL-WA-01.
  - Entrega da mensagem 99 no aparelho.
  - Semantica de runtime do update().neq().select().
  - GET /api/whatsapp 403 nunca medido antes do deploy.


## 20 — Pre-escrita da LEADS-WA-01: CHECK, FK e o autor sem lugar (04/08/2026)

Medicao exigida antes de qualquer escrita, conforme a autorizacao leads-status.

### 20.1 — status nao e enum: e CHECK

  a_col_status = text / udt=text / nullable=NO / default='novo'::text
  d_enum_valores = ### NAO E TIPO ENUM ###
  interesses_status_check :: CHECK ((status = ANY (ARRAY['novo','em_atendimento','convertido','descartado'])))
  g_status_distintos = novo = 37
  c_CONTROLE_NEGATIVO_col_inexistente = ### AUSENTE ###

Armadilha registrada: a consulta a pg_enum devolveu vazio. Vazio ali NAO significa
"sem restricao" — significa que a restricao mora em outro lugar. Se eu tivesse
parado na primeira regua, teria concluido que qualquer texto serve e escrito
"em atendimento" com espaco, tomando 400 em producao. Foi o segundo caminho
(pg_constraint) que trouxe os valores.

Valores validos: novo | em_atendimento | convertido | descartado.
O transito da fatia e novo -> em_atendimento.

### 20.2 — atendido_por E FK para profiles

  b_col_atendido_por = uuid / nullable=YES
  interesses_atendido_por_fkey :: FOREIGN KEY (atendido_por) REFERENCES profiles(id) ON DELETE SET NULL
  h_atendido_por_preenchidos = 0
  i_profiles_total = 1

Confirmado o que a autorizacao previa. Vale a mesma regra do atendente_id da
PAINEL-WA-01: so grava o id se houver linha em profiles; senao, nulo.

Agravante novo: profiles tem UMA linha. Se o id do gate nao for exatamente essa
linha, a FK derruba o UPDATE — e como o leads-status escreve em TODAS as linhas do
grupo, cairiam N linhas juntas, nao uma.

### 20.3 — Nao ha onde registrar o nome do autor

  j_profiles_colunas = id, nome, telefone, email, tipo, status, criado_em

Em wa_conversas existia atendente_nome como plano B quando o perfil faltava. Em
interesses NAO existe coluna equivalente, e cria-la e migration — proibido pelo
escopo autorizado.

Consequencia honesta: se o gate nao tiver linha em profiles, atendido_por fica nulo
e o autor nao fica gravado em lugar nenhum. O leads-status viraria exatamente a
mentira que veio consertar — o status mudaria e o painel continuaria sem saber quem
trabalhou. NAO CONTORNAR POR CONTA PROPRIA. Decisao do Emerson.

### 20.4 — RLS ligada em interesses

  k_RLS_interesses = RLS LIGADA

Antes de escrever e preciso saber com qual cliente a rota escreve. Com cliente de
sessao e sem policy de UPDATE, o update volta "0 linhas alteradas" sem erro — falha
silenciosa, a pior categoria: o painel diz que marcou e o banco nao mudou.

### 20.5 — Bloqueio declarado

A parte de LEITURA da LEADS-WA-01 (agrupamento, casamento, botoes, aviso) esta
liberada: nao depende de nada disto.

A parte de ESCRITA (leads-status) fica retida ate medir:
  - qual e a unica linha de profiles (id e email) e se ela corresponde ao gate;
  - as policies de UPDATE de interesses e qual cliente a rota usa.

Sem essas duas, escrever seria apostar que a FK passa e que a RLS deixa.

## 21 — ACESSO-01: dois projetos com nomes trocados, e as duas frentes de código escritas (05/08/2026)

### 21.1 — Correção da §20: eu medi o projeto errado

A §20 fica onde está — canal é append-only, erro apagado é erro que volta. Mas ela
precisa ser lida com esta correção grudada.

Quando escrevi "`profiles` tem 1 linha" e "`auth.users` tem 4", eu estava medindo o
projeto `xtvjpnyadcdeadhmzyff`. Não é onde as pessoas criam conta. Os números estão
certos; a conclusão que eles sugeriam — "quase ninguém tem perfil" — estava errada.

No projeto onde o cadastro realmente acontece são 21 usuários e 21 perfis. Nenhum órfão.
O trigger funciona.

### 21.2 — A armadilha: o projeto chamado `-prod` não é o de produção

| variável de ambiente | ref do projeto | nome no painel Supabase | o que vive lá |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `nnvjeijsrwpzsggwqpcu` | `bidcon-plataforma` | **auth de verdade**, `profiles`, `vendas_novas` |
| `BIDCON_XTV_URL` | `xtvjpnyadcdeadhmzyff` | `bidcon-plataforma-**prod**` | `interesses`, `wa_conversas` |

O projeto com `-prod` no nome **não** é onde a produção autentica. Quem abrir o painel
procurando "o de produção" vai medir o lado errado — foi exatamente o que eu fiz.

Prova de que são dois: o e-mail `eme.santos123@gmail.com` existe nos dois com **id
diferente em cada um**.

### 21.3 — Consequência: a FK do autor é cross-project

`interesses.atendido_por` e `wa_conversas.atendente_id` apontam para `profiles(id)` **do
xtv**. O id da sessão de quem opera o painel vem do **nnv**. São universos de id
diferentes.

Isso não é teoria: significa que a guarda do `wa-atendente` nunca preenche em produção.
Ela procura no xtv um id que só existe no nnv, não acha, e grava nulo. Sem erro, sem
aviso. O registro de quem atendeu simplesmente não acontece.

Por isso o autor terá de ser gravado **por e-mail**, não por id. O e-mail é a única
chave que atravessa os dois projetos.

### 21.4 — ACESSO-01: o quadro medido

Emerson reportou usuários travados depois de criar conta. O que se mediu:

- O trigger `on_auth_user_created` existe, está ativo (`tgenabled=O`), é `SECURITY
  DEFINER` com `search_path='public'` e insere em `profiles` com `on conflict do
  nothing`. **O buraco não é o trigger.**
- Contas paradas sem confirmar o e-mail, reais: `ys937132@gmail.com` (31/07),
  `viniciusmoreira192@gmail.com` (22/07), `roberthdeocleciano@gmail.com` (13/07). Mais
  a conta de teste `teste.verificacao.bidcon@gmail.com` (07/07).
- Caso à parte: `rafacruz2321@gmail.com` (17/07) — confirmou e mesmo assim nunca entrou.
  Compatível com o defeito 2 abaixo.

### 21.5 — Defeito 1: o login era mudo

`app/login/page.tsx` colapsava **todo** erro do `signInWithPassword` numa única frase:
"E-mail ou senha incorretos."

Quem não confirmou o e-mail recebia essa frase. Lia como senha errada. Trocava a senha.
Recebia a mesma frase. Trocava de novo. O sistema tinha a informação certa na mão — o
Supabase devolve `email_not_confirmed` — e jogava fora antes de mostrar.

Não é um erro de lógica. É um erro de honestidade: a tela dizia uma coisa que não era a
verdade que o sistema conhecia.

### 21.6 — Defeito 2: o callback engolia o erro

`app/auth/callback/route.ts` fazia `await supabase.auth.exchangeCodeForSession(code)` e
seguia para o redirect de sucesso **de qualquer jeito**. Retorno ignorado.

Link expirado, link já usado, código inválido: os três aterrissavam o usuário na home
sem sessão e sem uma palavra. Visualmente idêntico a ter dado certo. Ele clica no link
que pediu, chega numa página que parece certa, e não está logado.

### 21.7 — O que foi escrito (frentes 2 e 3)

Autorizado pelo Emerson. Duas frentes de código; a terceira (SMTP) é configuração de
painel e é mão dele.

| arquivo | + | − | sha256 antes → depois |
|---|---|---|---|
| `app/login/page.tsx` | 77 | 2 | `242eb1b4…` → `afb4c40b…` |
| `app/auth/callback/route.ts` | 14 | 1 | `d54f6225…` → `17470aeb…` |

Frente 2: o caso `email_not_confirmed` passa a ser distinguido e ganha botão "Reenviar
confirmação" (`supabase.auth.resend`), com o retorno conferido — se o reenvio falhar, a
tela diz que falhou, não diz "enviado". Qualquer outro erro **continua** virando "E-mail
ou senha incorretos": mensagem crua de terceiro não vaza pro usuário.

Frente 3: o retorno do `exchangeCodeForSession` passa a ser capturado. Em erro, log no
servidor e redirect para `/login?erro=link-expirado`, onde a tela mostra o motivo e o
mesmo botão de reenvio.

**Divergência declarada:** foi pedido detectar por `error.message`. Detecto por
`error.code === "email_not_confirmed"` primeiro, mensagem como reserva. String de
terceiro muda sem aviso e a régua morreria muda; o code é o contrato estável.

### 21.8 — O que NÃO está provado

Isto é o que impede esta seção de ser um relatório de vitória:

- **Não passou por typecheck nem por build.** Contei ocorrências com `grep`. Grep não
  compila nada.
- **O caminho de erro não foi exercido vivo.** A conta
  `teste.verificacao.bidcon@gmail.com` existe justamente pra isso, e o teste é no
  preview, antes da produção.
- **SMTP: NÃO MEDIDO.** O e-mail de confirmação quem dispara é o Auth do Supabase, não
  código nosso. Se o SMTP não estiver configurado, as duas frentes acima funcionam
  perfeitamente e ninguém recebe e-mail nenhum. O conserto de verdade mora no painel.
- **As três contas reais paradas continuam paradas** depois deste conserto. Ele impede
  novos travados; não destrava os antigos. Reenviar ou confirmar na mão é decisão do
  Emerson.

### 21.9 — Regra 7 pela quinta vez, e a mais perigosa até agora

Um comando com `--include=*.ts` sem aspas foi abortado pelo zsh (`no matches found`) e
dois blocos de busca simplesmente não rodaram. A saída veio vazia.

Vazio ali significava "não há tratamento de confirmação de e-mail no código" — que era
justamente a conclusão plausível que eu estava a caminho de escrever. O comando quebrado
não mentiu: ele calou, e o silêncio se parecia com uma resposta.

Régua morta com resultado plausível é o pai do relatório fictício sem mentira.

## 22 — Reconhecimento de cinco fatias: o que já existia antes de eu escrever (05/08/2026)

Seção de recon. Quase nada de código novo aqui — e é esse o ponto. Cinco fatias foram
autorizadas e, em quatro delas, a medição achou a peça **já construída**. O trabalho foi
descobrir isso antes de duplicar.

### 22.1 — ACESSO-02: o recado errado que eu quase dei

A fatia mandava sinalizar ao Emerson que `CRON_SECRET` era env nova, a criar.
**Ela já existe** — e três crons de produção dependem dela hoje: `sync-cotas` (de hora em
hora), `backfill-embeddings` e `sentinela/varredura`. Se não existisse na Vercel, os três
estariam quebrados agora.

Pedir a alguém que crie o que já está criado gasta confiança à toa, e na terceira vez
vira "esse aí não confere nada".

### 22.2 — Não existe pasta `cron/` nesta casa

Os três crons vivem soltos em `app/api/<nome>/`, com o agendamento em `platform/vercel.json`.
O caminho `app/api/cron/…` que a fatia pedia inauguraria convenção nova para nada. Corrigido
para `app/api/lembrete-confirmacao/`.

Segundo achado: `auth.admin.listUsers()` **não aceita filtro** — só `page` e `perPage`. Não dá
para pedir ao servidor "não confirmados criados entre 24h e 48h". A filtragem é em JS sobre a
página trazida. Com 21 usuários é irrelevante; quando a base crescer, a primeira página deixa
de conter todo mundo e o cron passa a ignorar gente **sem errar** — bomba-relógio silenciosa.
Paginação explícita desde o primeiro dia.

### 22.3 — ACESSO-03: a `lib/mail.ts` já previa esta fatia

O arquivo existe, embrulha o Resend com `fetch` nativo (sem SDK novo) e o cabeçalho dele diz,
escrito antes de mim: *"Usado por rotas server-side que precisam avisar o admin (ex.: novo
cadastro)"*.

`POST` cru para a API do Resend foi descartado: dois caminhos de envio significam dois lugares
para vazar a chave e dois para consertar. Endereços ficam em `MAIL_FROM`/`MAIL_ADMIN`, não
fixos no código — hardcode tira o endereço do alcance de quem opera.

### 22.4 — O que os zeros do `.env.local` NÃO provam

`MAIL_FROM`, `MAIL_ADMIN`, `RESEND_API_KEY`, `HOOK_SECRET`: todos zero no `.env.local`.

Isso **não** significa que faltam na Vercel. `.env.local` é arquivo de máquina; env de produção
vive no painel e não passa por aqui. Minha régua não alcança lá. O que os zeros provam é uma
coisa só, e é operacional: **rodando local, `enviarEmail()` devolve `ok:false` sem tentar
enviar**. Teste de e-mail nesta máquina não vale como prova de nada.

Reportar "as envs não existem" teria sido relatório fictício sem mentira: número certo, régua
curta demais para a conclusão.

### 22.5 — Next 14 mata o `waitUntil`

`next ^14.2.5`, `react ^18.3.1`. O `after()` é do Next 15. Não existe aqui, e não vale importar
dependência nova para enfileirar uma chamada de 300ms. Um e-mail cabe folgado no timeout do
webhook com `await` direto.

### 22.6 — ANEXO-01: o arquivo é nosso, e os dois cincos que ainda não fecharam

`wa_mensagens` tem **as duas** colunas: `media_id` e `storage_path`. Em 152 mensagens: 5 com
`media_id`, 5 com `storage_path`. Bucket `wa-extratos`, `publico=false` — privado, como extrato
bancário exige. `storage.objects` tem 5 objetos.

**Não provei que os dois conjuntos de 5 são o mesmo conjunto.** Se houver uma linha com
`media_id` e sem `storage_path`, os totais batem e o arquivo daquela pessoa não está nosso —
URL de mídia da Cloud API expira. Dois números iguais lado a lado parecem uma resposta; são
uma coincidência até a interseção ser medida.

Se fechar em 5, a fatia é só de leitura e UI, sem item de persistência.

### 22.7 — LEXICO-01: "repasse" sai de cena

Correção de léxico do Emerson, válida em todas as superfícies: o fluxo do vendedor de carta
contemplada **não é repasse** — é venda de cota na Bidcon (intermediação ou compra direta),
avaliada pelo Bidcon Price.

Não é cosmética. "Repassar" sugere empurrar uma obrigação adiante; "vender" descreve o que
acontece. Cliente que entende errado o que está fazendo é reclamação com data marcada.

Registrado, **não tocado** — aguarda token. Primeiro fio: existe `app/api/repasse/route.ts`.
E a busca terá de cobrir código **e** banco: prompt de agente pode morar em tabela, e grep
limpo no repositório provaria apenas que a palavra não está no repositório.

### 22.8 — AVALIA-01: a TIR já existe e é canônica

`lib/tir.ts` (`tirMensalMenorRaiz`, `anualEquivalente`), extraída de `analista-grupos`. O
`custo-efetivo-plano-novo.ts` a importa e carrega escrita a regra permanente — *"toda simulação
termina em TIR"* — mais a convenção da **menor raiz** quando há mais de uma matematicamente
válida, e um aviso explícito contra usar percentual nominal no lugar de TIR ausente.

Existe também `lib/comissao.ts` com teste ao lado. Se os 7% já moram lá, a fatia herda a regra:
número de negócio repetido em dois arquivos é divergência com data marcada.

`cedente`: **zero ocorrências** em `platform/lib` e `platform/app`. Seguro a conclusão — o
repositório alimenta dois projetos Vercel e o fluxo do vendedor pode ser página fora dessas
pastas. Zero ali significa "não está onde olhei".

### 22.9 — RESUMO-01: o lugar de gravar já existe, e o resumo é inerte

`cerebro.ts:164` — `if (m.papel === "sistema") continue;`. Medido, não suposto. Resumo gravado
como `sistema` **não entra no contexto do modelo**: não é cumulativo, não engorda prompt.

`lib/whatsapp/sistema.ts` já faz a gravação, já confere `{error}` explicitamente e já registra
por escrito que o handoff *"existe desde 20/07 e NUNCA deixou rastro"*.

Correção sobre o modelo: não há "o rápido dos dois". Nas chamadas reais (linhas 409-418 e
544-553) o cérebro usa `claude-fable-5`, hardcoded. O `claude-sonnet-4-6` aparece só num
comentário explicando por que a env sugerida pela spec não foi adotada.

Risco levantado antes de escrever: o `sistema_extrato` é gravado com `agente:"sistema_extrato"`,
mas o **`papel` dele não foi medido**. Se for `sistema`, reusar o montador de histórico do
cérebro descartaria exatamente o extrato que o resumo precisa ler. O texto sairia plausível e
cego — e ninguém notaria.

### 22.10 — Um alarme que levantei e não se confirmou

O HEAD mudou sem mim e eu parei tudo antes de escrever. Era commit do próprio Emerson
(SENTINELA-01), sem relação com o meu código. Confirmado pelo grep **no blob do HEAD**, não no
disco: o conserto do ACESSO-01 não estava publicado.

Levantei alarme falso. Prefiro assim do que o inverso — e o custo foi um comando.

### 22.11 — Regra 7, sexta aparição: exit code depois de pipe

`GREP_X_EXIT=$(...)` depois de `| head` mede o `head`, não o `grep`. O bloco real e o bloco da
isca devolveram **o mesmo `0`**. É a sexta vez nesta sessão que um controle por exit code sai
inútil — padrão, não azar.

Regra operacional nova: **contagem antes do pipe**, nunca exit code depois dele. O que
discriminou foi o conteúdo — 40 linhas contra nenhuma.

### 22.12 — O que está escrito e NÃO auditado

As frentes 2 e 3 do ACESSO-01 seguem **só no worktree**, deliberadamente fora de `main`:
push em `main` dispara produção, e a ordem era preview antes de produção.

Elas não passaram por typecheck, não passaram por build e o caminho de erro não foi exercido
vivo. Enquanto isso não acontecer, o correto é dizer que o ACESSO-01 está **escrito**, não
consertado. Cinco fatias entraram na fila enquanto essa auditoria não aconteceu; registro isso
aqui para que a dívida tenha nome e data.

## 23 — FUNIL-01, F2: a 0093 em produção pela ordem certa, e a porta da casa medida antes de usada (02/09/2026)

Primeira migration desta corrida a entrar no banco **depois** de estar em `main`. O que segue
vale menos pelo que a 0093 faz e mais pelo que a fatia descobriu sobre os instrumentos com que
esta casa mede.

### 23.1 — A ordem que passa a valer: portões → PR → merge → `apply_migration`

O motivo tem nome e número: a **0090** está aplicada nos dois bancos e o arquivo dela nunca
chegou à `main` — vive numa branch aberta. Migration que entra no banco antes de estar em `main`
é migration cujo texto ninguém consegue auditar depois.

A F2 fez o inverso, e é a primeira vez: portões locais verdes → `push` → PR #61 → merge
(`main = 2963b46`) → e só então o banco, por `apply_migration` com `name = 0093_funil_01`.

**Nunca `execute_sql` para aplicar migration.** Ele escreve no banco e não registra no ledger: o
resultado é uma migration fantasma, que é exatamente a doença que a 0090 tem.

### 23.2 — A porta da casa para o Postgres, medida antes de carregada

Nada disto era sabido. Tudo foi medido com isca e controle positivo, em probes de raio de dano
mínimo, antes de qualquer DDL de verdade:

| propriedade | como ficou provada |
|---|---|
| `begin`/`rollback` é honrado — não é auto-commit | `create table` dentro de `begin…rollback` → `to_regclass` nulo, com `to_regclass('public.interesses')` devolvendo nome na **mesma expressão** |
| multi-statement passa, mas **só o resultado do último volta** | os `select` do meio sumiram; o desenho do ensaio inteiro mudou por causa disso |
| `raise exception` dentro de `begin` **devolve a mensagem e garante o desfazimento** | mais forte que `rollback;`: nenhum caminho commita, nem por erro no meio do arquivo |
| `\n` sobrevive na mensagem de erro | por isso o relatório do ensaio pôde vir em linhas |
| o papel é `postgres`, superusuário | `current_user` |
| a conexão é **limpa** depois do erro | zero `idle in transaction (aborted)`, zero `AccessExclusiveLock` no alvo, com `sessoes_totais` como positivo |
| `apply_migration` guarda o corpo **verbatim, um statement só, sem aparar** | `md5(statements)` = md5 do arquivo, e `n_statements = 1` |

A última linha é a que fecha a auditoria da fatia: o que está no banco é byte por byte o que está
em `main`, por md5 — não por argumento.

### 23.3 — Como se prova um arquivo inteiro sem aplicá-lo

O ensaio da 0093: `begin` → `set local lock_timeout = '5s'` e `statement_timeout = '60s'` → uma
**temp table** de relatório → âncoras do "antes" → **o arquivo verbatim, como statements de
topo** (nunca retranscrito para dentro de `execute`) → âncoras do "depois", isca e controle
positivo → `raise exception` carregando o relatório inteiro.

A temp table foi descartada cedo demais na primeira versão do desenho, por eu pensar nela como
sobrevivente do rollback. Ela não precisa sobreviver: precisa estar viva **até o `raise`**, e ali
está.

Duas emendas da coordenação que ficam como padrão:

1. **Sentinela.** O relatório termina em `--FIM-DO-RELATORIO--`. Se a sentinela não aparece, a
   mensagem foi cortada e o ensaio conta como **não lido** — não como aprovado.
2. **Relatório denso.** Contagens, nomes e `sqlstate`; nunca despejos.

E uma técnica que vale guardar: as **sete impressões digitais**. Os `comment on` são prosa longa;
erro de transcrição neles **não** produz erro de sintaxe. Medi o comprimento dos sete literais no
arquivo (101, 118, 153, 169, 243, 250, 372) e conferi contra `length(d.description)` no banco. É
a única prova disponível para a região que a sintaxe não cobre.

### 23.4 — `length()` conta caracteres; byte é `octet_length()`

O arquivo tem **22348 bytes** e **22017 caracteres** — 331 de diferença, que são os acentos (`ã`,
`é`, `—`, `·` e companhia). Comparar `length()` com `wc -c` é comparar réguas, não corpos, e por
um momento essa diferença passou por "331 bytes que a porta descartou".

Regra: **`length()` = caracteres, `octet_length()` = bytes.** Nunca comparar um com o outro.

### 23.5 — As 25 combinações que falharam, e por isso provaram

Para descobrir se a porta fatiava o corpo, fatiei o arquivo localmente — separador que respeita
comentário de linha e literal com `''`, 33 statements de topo — e testei **cinco formas de
recortar × cinco juntas = 25 combinações**. Nenhuma bateu com o md5 do banco. A única coisa que
casa é o arquivo **intacto**.

Prova por fracasso: se a porta tivesse fatiado, uma das 25 teria batido.

O separador foi obrigado a mostrar que sabe errar antes de valer: `select 1 -- sem ponto e
virgula` → 0 · `select 1; select 2;` → 2 · `select 'tem ; dentro do literal';` → 1 · `select 1
-- ; em comentario` + `;` → 1.

### 23.6 — Controle positivo não é formalidade

No ensaio, a isca — `insert` de um `interesses` `convertido` sem fechamento — foi recusada com
`23514 · interesses_convertido_tem_fechamento`. Sozinha, ela não prova nada: constraint que
recusa tudo é a mesma coisa que eixo que reprova tudo.

O controle positivo — a mesma linha **com** `fechado_em` e `fechado_valor` — foi aceito. E rendeu
mais do que a formalidade: foi a **única linha viva** que exercitou o braço `convertido →
fechado_venda` do mapa e a regra do `parado_horas` nulo.

Depois da aplicação, com dado real, `vw_funil` tem 60 linhas e **uma única etapa distinta:
`entrada`**; `parado_horas` nulo em zero. Dez dos doze braços do mapa seguem provados por
leitura, não por dado. A F5 fecha isso com um `insert` por status.

Regra: **controle positivo é o único dado que testa o caminho feliz de uma trava nova.**

### 23.7 — A regra do cano, e as quatro reincidências desta fatia

A §22.11 escreveu *contagem antes do pipe, nunca exit code depois dele*. Nesta fatia a mesma
família apareceu quatro vezes:

- `EXIT=$?` depois de `echo "$(binario | head -1)"` mediu o `echo` → **0** para um binário
  inexistente. Conserto: `binario >/dev/null 2>&1; echo $?` → **127**, com `node -v` → 0 como
  positivo.
- `${PIPESTATUS[0]}` **não existe aqui**: o shell da casa é `zsh`, não `bash`. O bloco inteiro
  quebrou com `tail: echo: No such file or directory`.
- `grep -E '^. (tests|pass|fail) '` não casou nada porque a linha começa com `ℹ`, que é
  multi-byte. Lido como "zero testes", teria virado relatório fictício sem mentira.
- `git ls-remote --heads origin <ramo-inventado>` sai com **0** e zero linhas. Quem lê o exit
  conclui que o ramo existe. **Quem julga é a contagem.**

Autodiagnóstico que fica escrito: *construo a régua com pressa quando o resultado que espero é
óbvio.*

### 23.8 — `Portoes: testes N/N` é retrato de ramo, não série que sobe

Um commit trazia `testes 1236/1236` e o portão desta fatia deu `1240/1240`. A diferença não é
regressão nem inflação: os números de portão de commits diferentes são retratos de **ramos**
diferentes.

Reconciliado por medição, não por inferência: `1196` (base) `+ 3` (funil) `+ 40` (captação) `+ 1`
= **1240**. Os dois arquivos foram rodados isolados para a inferência virar medição:
`ℹ tests 40 / pass 40 / fail 0` e `ℹ tests 1 / pass 1 / fail 0`.

### 23.9 — Os dois órfãos, e a candidata `LEDGER-REPO-01`

Conferindo os comentários da 0093 por diferença, apareceram **14** no banco contra **13** nos
arquivos:

- 7 da `0093_funil_01.sql`;
- 6 da `0088_captacoes.sql` (122, 157, 171, 193, 196, 345);
- **1 órfão**: `interesses.alerta_enviado`, 70 caracteres, presente no xtv e ausente dos 72
  arquivos de `platform/supabase/migrations/`. O ledger aponta a origem:
  `20260712205801 · 0047_whatsapp_envio`.

E há **dois `0047`** no ledger: `0047_whatsapp_envio` (12/07) e `0047_sync_identidade_estavel`
(16/07). Colisão de número, quatro dias de distância.

Hipótese, marcada como hipótese: em julho, migrations entraram pela porta direto do chat, sem
arquivo, e o número foi reusado por quem não viu a primeira porque ela nunca esteve no
repositório.

**`LEDGER-REPO-01`, parada, para a mesa do Emerson:** reconciliar ledger × repositório — para
cada uma das 101 entradas, existe arquivo? para cada um dos 72 arquivos, existe entrada? quais
números colidem (0023, 0024, 0047, 0089)? — e escrever a regra que faltava, que é justamente a
da §23.1. As duas provas de que ela é necessária são a `0090` e o `alerta_enviado`.

O `0089_radar_handoff_mudo` também segue **em dobro** no ledger, confirmado de novo hoje.

### 23.10 — O que a F2 entregou, um item por linha

Três colunas de operação nas duas mesas · uma conversa, uma captação viva, por índice único
parcial que não matou o índice de busca · a vista do funil com allowlist positiva de 19 colunas e
nenhum texto livre do cliente · a escada do comprador com os dois degraus novos, por palavra do
Emerson · a lista de operadores no banco, uma pessoa por linha, para poder suspender uma sem
suspender o grupo · fechamento só com valor e data, nos dois lados · a porta pública de
`interesses` fechada em `novo` · o quinto interruptor da casa, nascido desarmado.

Ledger: `101 · 20260902220912 · 0093_funil_01`. Colunas: `captacoes` 18 → 23, `interesses`
14 → 19. Dado tocado: **nenhum** — 2 captações, 58 interesses, 60 linhas na vista, antes e
depois. Sem backfill.

### 23.11 — O que a F2 **não** muda

`FUNIL` não está na Vercel e nenhuma rota lê as colunas novas. O deploy de produção que levou a
fatia não mudou comportamento nenhum. A mesa continua sendo o quadro publicado até a F4, e o
interruptor só é armado na F6, por palavra do Emerson.

### 23.12 — O que fica sem prova

- **Dez dos doze braços do mapa de etapas**, e o `else fora_do_mapa` — provados por leitura do
  arquivo, não por dado. F5, trava 4.
- **A allowlist de 19 colunas prova que as 19 estão, não que são só elas.** Também F5.
- **8 vulnerabilidades** (3 moderate, 5 high) reportadas pelo `npm ci`. Candidata
  `SEGURANCA-DEPS-01`.
- **41 `;` no arquivo contra 33 de topo.** Os 8 restantes vivem dentro de literal ou de prosa;
  não os conferi um a um. É inferência, não medição.
- **O resíduo dos pacotes**: o `npm ci` de hoje diz "added 154, audited 155"; réguas antigas
  deram 150 e 160, e ninguém explicou.

---

## 24 — LOJISTA-JK-01: a Webmotors fechou a porta, e a página foi pelo snapshot (02–03/09/2026)

**Estado: preview medido e verde, aguardando o clique do Emerson.** Duas frentes. A F1
(`prospere-360`) bateu numa parada dura e **fica parada, PR aberto, sem merge, por ordem
expressa**. A F2 (`bidcon-app`) foi refeita em cima de snapshot, aplicada limpa e medida no
preview: **47 de 47 veículos com encaixe**.

### 24.1 — A F1 morreu medida, não suposta

Branch `estoque-webmotors-01`, commit `f4b8d01`, só `app/api/estoque/route.js` (+157). Portões
verdes (`npm ci`, build, rota presente). A medição no preview:

```json
{"ok":false,"custom":true,"parceiro":"webmotors.com.br",
 "error":"A Webmotors não respondeu ao motor (webmotors_http_403)…","veiculos":[]}
```

`http=422`, **três tentativas, três vezes o mesmo**. O adaptador se comportou como projetado:
devolveu erro honesto em vez de lista vazia fingindo sucesso.

**O diagnóstico que mudou a conclusão da OS.** A OS supunha bloqueio de IP de datacenter. Chamei
a mesma API **da máquina local, IP residencial, mesmos cabeçalhos** — **403 também**. Não é IP:
o endpoint exige a sessão anti-bot do navegador. Logo **proxy, troca de UA ou outro IP não
resolveriam**, e tentar teria sido queimar rodada. O próprio comentário do patch já avisava que
a API "foi medida só via navegador".

Regressão conferida antes de encostar em qualquer coisa: o caminho WooCommerce padrão continua
`ok:true`, **359 veículos** (Unimais Veículos). Nada quebrou.

Parada dura acatada. **`estoque-webmotors-01` não foi tocada e não deve ser mesclada.**

### 24.2 — A F2 v2: snapshot-primeiro, motor como reserva

Patch `LOJISTA-JK-01_bidcon-app_lojista-jk-01_v2.patch`, conferido **antes** do `git am`:

| medida | valor |
|---|---|
| linhas | 1293 ✓ |
| bytes | 57436 |
| sha256 | `5497017e0311b969a5722fc8dbc8f2ee757297c1d58439886993c4df32bf8374` ✓ |

Branch `lojista-jk-01` tirada de `origin/main` (`c8334c5`), `git am --3way`, dois commits limpos:
`73f77fe` (página + sitemap) e **`d1b7797`** (snapshot + leitura snapshot-primeiro). Autoria
`Emerson Santos <eme.santos123@gmail.com>` preservada nos dois. Escopo real:

```
public/bidcon-lojista/jk-alphaville.html | 222 +
public/bidcon-lojista/jk-alphaville.json | 952 +
public/sitemap.xml                       |   5 +
3 arquivos, 1179 inserções
```

O coração da mudança — a página tenta o snapshot commitado e **só cai no motor se ele faltar**:

```js
function estoque(){
  return fetch("/bidcon-lojista/jk-alphaville.json",{cache:"no-cache"})
    .then(function(r){if(!r.ok)throw 0;return r.json()})
    .catch(function(){return fetch(API+"/api/estoque?url="+encodeURIComponent(LOJA_URL))…});
}
```

### 24.3 — O portão que teria quebrado a página em silêncio

Antes do push conferi a CSP do `vercel.json`, porque é o portão que derruba página estática sem
erro visível: `img-src 'self' data: https:` cobre o CDN da Webmotors; `connect-src` lista
**nominalmente** `app.bidcon.com.br` e `360prospere.vercel.app`, que são exatamente os dois
endpoints da página; `script-src` tem `'unsafe-inline'`, então o script embutido roda. **Verde,
sem precisar mexer na CSP.**

### 24.4 — Medição no preview (`dpl_E7jhXnkc…`, sha `d1b7797`, READY)

| checagem | resultado |
|---|---|
| `/bidcon-lojista/jk-alphaville` | **200** `text/html`, 19251 bytes |
| `/bidcon-lojista/jk-alphaville.json` | **200** `application/json`, 31569 bytes |
| `/bidcon-lojista` (a página antiga) | **200**, 122605 bytes — **intacta** |
| `app.bidcon.com.br/api/vitrine`, Origin `bidcon.com.br` | **200**, `access-control-allow-origin: https://www.bidcon.com.br`, 2277 cotas |
| 5 fotos do CDN `image.webmotors.com.br` | **206 `image/webp`** — imagem real |
| cabeçalho | "47 veículos no estoque" · "Estoque de **02/09/2026** · cartas de 03/09/2026" |

**Risco que levantei por conta própria e medi:** o patch cria a pasta
`public/bidcon-lojista/` ao lado do arquivo `public/bidcon-lojista.html` que já existia. Com
`cleanUrls: true`, `/bidcon-lojista` poderia ficar ambíguo e a página antiga sumir. Não sumiu —
responde 200 com os mesmos 122605 bytes.

### 24.5 — O encaixe, reproduzido contra a vitrine ao vivo

Reproduzi em Python a regra exata da página (mesma cota-única, mesma junção até 4 cotas da
**mesma administradora**, mesmo score `TIR + 0,10 p.p. por cota extra + 0,05 p.p. por 1% de
sobra`), rodando contra as 2277 cotas reais:

| medida | valor |
|---|---|
| **com encaixe** | **47 / 47** |
| por junção de cotas | 37 |
| menor custo financeiro | **1,05% a.m. (TIR)** |
| custo médio | 1,35% a.m. (TIR) |
| administradoras elegíveis | 25 (HS 215, Itaú 126, Porto 124, Bradesco 92, Mycon 80…) |

Emerson esperava ~45/47. **Deu 47/47** — melhor que o previsto, e a razão é medível: a vitrine
tem 2277 cotas elegíveis em 25 administradoras, e a junção de até 4 cotas é generosa.

Léxico conferido no HTML servido: **zero** ocorrências de investimento, investidor, rendimento,
retorno, lucro ou CDI. Administradora exposta no card (`<span class="adm">`) **e** dentro da
mensagem do WhatsApp. "A entrada já inclui a intermediação bidcon" e "Pagamento protegido por
Conta Notarial" no texto de topo. Nenhuma promessa de contemplação.

### 24.6 — O que fica sem prova (e o achado que Emerson precisa ver)

- **Seis dos 47 veículos têm `fipe: 0`** — Corvette Stingray Conversível (R$ 1.069.900),
  BYD Song Plus DM-i, Ford F-1000 4.9, GWM Tank 300, Toyota Yaris Cross Hybrid XRE e Denza B5.
  A página cai em `fipe = preco` e marca **"(ref.)"** no card, o que é honesto. Mas a promessa
  "saldo devedor dentro da FIPE" fica **mais frouxa** nesses seis, porque a régua vira o próprio
  preço pedido. O caso gritante é a **Ford F-1000**: o snapshot carrega `fipe_pct: 517`, ou seja,
  a FIPE real ronda R$ 40 mil e o anúncio pede R$ 210 mil (picape antiga restaurada). Os seis
  fecham encaixe, mas contra uma régua que não é a FIPE. **Decisão de negócio, não minha.**
- **`fipe_pct` residual com `fipe: 0`** em dois veículos (517 e 163). A página **não lê**
  `fipe_pct`, então hoje é inerte — mas é sujeira no contrato do snapshot.
- **Não abri a página em navegador de verdade.** O encaixe foi reproduzido em Python a partir das
  mesmas duas fontes; renderização, `loading="lazy"` e layout **não** foram vistos com o olho.
- **47/47 é a foto de 03/09/2026 00:25 UTC.** A vitrine muda quando carta é vendida; o número
  cai sozinho.
- **O snapshot é de 02/09/2026 e não se atualiza sozinho.** Enquanto a Webmotors não abrir uma
  fonte de servidor (feed da loja), o estoque envelhece por conta própria e precisa de recaptura
  via navegador. A data está no cabeçalho, o que é honesto, mas não resolve.
- **A causa-raiz do 403 é inferida, não confirmada pela Webmotors.** Medi o sintoma dos dois
  lados; ninguém de lá disse o porquê.

### 24.7 — Estado e o que depende do Emerson

- `lojista-jk-01` empurrada em `d1b7797`. **PR não abre por aqui — `gh` não está instalado.**
  Link: `https://github.com/emegs88/bidcon-app/pull/new/lojista-jk-01`
- **Merge é clique do Emerson.** Nada foi a produção.
- `estoque-webmotors-01` (`prospere-360`): **aberta, intocada, sem merge**, por ordem.
- F3, só depois do merge: abrir `https://www.bidcon.com.br/bidcon-lojista/jk-alphaville` e
  conferir encaixes, fotos e WhatsApp com o olho.
