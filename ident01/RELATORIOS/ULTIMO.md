# IDENTIDADE-01 — ÚLTIMO RELATÓRIO

**Canal definitivo.** Sobrescrito a cada relatório, empurrado ao origin na
sequência. A arquitetura lê aqui.

- **Gerado em:** 03/08/2026
- **Ato:** CORREÇÃO DE MEDIÇÃO — retratação do §4 do relatório `c478019`
- **Substrato:** `bidcon-app` @ `c478019`
- **Autor:** mão do repo/app

---

## §0. VEREDITO — O ITEM 5 REDEFINIDO ESTÁ ERRADO, E O ERRO É MEU

A decisão ratificada diz:

> *"ITEM 5 REDEFINIDO: REMOVER o campo `id` fabricado das duas rotas
> (`cotas-extra/route.js:330` e `cotas-servopa/route.js:91`). **Zero
> consumidores = troca livre de compatibilidade, medida.**"*

A palavra **"medida"** aponta para uma linha do §4 do relatório `c478019`. Essa
linha é um **falso-negativo**. O consumidor existe, está no `bidcon-app`, e
**lê exatamente o campo `id`**.

**Executar o item 5 como redefinido zeraria a ingestão de quatro fontes**
(CBC, PIFFER, CARTAS, SERVOPA) no xtv. Não é quebra de compatibilidade — é
parada de alimentação.

**ATO D1 (`bidcon-app`, D-1..D-4) NÃO é tocado por este achado.** Está
autorizado, desacoplado e pronto. Executo no ato seguinte.
**ATO D2 continua bloqueado** — agora por dois motivos, não um.

---

## §1. O QUARTO EVENTO REGRA 7 — E O PRIMEIRO QUE VAZOU

Os três primeiros falso-negativos da Regra 7 morreram dentro da própria
varredura. **Este não.** Ele foi escrito, commitado, empurrado, lido pela
arquitetura e virou base de decisão.

### O que o relatório `c478019` afirma (§4, verbatim)

```
$ git -C bidcon-app grep -n "cotas-extra" -- ':!docs' ':!ident01' ':!*.md'
exit=1     ← nenhum CÓDIGO do bidcon-app consome a rota
```

E a conclusão derivada, também no §4:

> *"**Consequência boa:** não há consumidor do índice. O campo `idx` legado
> previsto no checklist **não é necessário** — ninguém depende da posição."*

### A causa, medida

```
$ pwd
/Users/prospere/Desktop/360prospere/bidcon-app

$ git grep -n "cotas-extra" -- ':!docs' ':!ident01' ':!*.md'
exit_com_so_exclusoes=1                    ← zero linhas

$ git grep -n "cotas-extra" -- '*' ':!docs' ':!ident01' ':!*.md'
exit_com_positivo=0                        ← DEZENAS de linhas
```

**Pathspec do git composto SÓ de exclusões (`':!…'`) não casa nada.** A magia
`:!` **subtrai** de um conjunto positivo; sem conjunto positivo, o conjunto é
vazio e o `git grep` sai com `1`. Basta acrescentar `'*'` para o mesmo comando
devolver o oposto.

É o retrato exato da Regra 7: **comando quebrado, saída plausível, hipótese
confirmada por acaso.** A diferença é que desta vez a hipótese estava errada.

---

## §2. OS CONSUMIDORES REAIS — quatro arquivos

```
$ git grep -l "cotas-extra" -- 'platform/**' 'public/**' 'app/**'
platform/lib/cotas-source.ts
platform/scripts/fixture-sync-multifonte.mjs
public/bidcon.html
public/index.html
exit=0
```

### 2.1 `platform/lib/cotas-source.ts` — **LÊ O `id`. É o consumidor crítico.**

```
platform/lib/cotas-source.ts:85-87
  CBC:     "/api/cotas-extra?admin=1",
  PIFFER:  "/api/cotas-extra?admin=1",
  CARTAS:  "/api/cotas-extra?admin=1",

platform/lib/cotas-source.ts:147
  const numero = inteiro(ehLance ? r.n : r.id);
  if (numero == null || numero <= 0) continue;
```

`r.id` é **exatamente** o `id: i + 1` fabricado em `cotas-extra/route.js:330` e
`cotas-servopa/route.js:91`. O próprio arquivo declara o destino:

```
platform/lib/cotas-source.ts:47
  numero: number;   // id nativo da fonte (`n` na Lance, `id` nas demais) => numero_externo

platform/lib/cotas-source.ts:114-116
  * `id` nativo: a Lance usa `n`, as demais usam `id`. Ambos viram `numero` /
  * numero_externo — a chave de upsert (administradora_origem, numero_externo)
  * cuida da colisão de id entre fontes distintas.
```

**Consequência de remover o campo `id`:** `r.id` vira `undefined` →
`inteiro(undefined)` → `null` → `continue`. **Toda linha é pulada.** As quatro
fontes externas passam a ingerir zero cotas, em silêncio — o `continue` não
loga, não lança, não conta.

### 2.2 `public/index.html` e `public/bidcon.html` — **não leem o `id`**

```
function normExtra(a,e){return{n:-(e+1),t:a.t,c:a.c,e:a.e,p:a.p,x:a.x,_x:1,
  ac:a.ac||"ADM-00",adm:a.adm||"",fonte:a.fonte||"",ceExtra:a.custoEfetivo}}
```

Fabricam o **próprio** índice negativo (`n:-(e+1)`) e ignoram `a.id`. Estes dois
sobreviveriam à remoção. Não salvam o item 5, mas ficam registrados como
**terceira instância da mesma classe D1** — identidade por posição, agora no
`bidcon-app`.

### 2.3 `platform/scripts/fixture-sync-multifonte.mjs:103` — fixture do sync

```
EXTRA: BASE + "/api/cotas-extra?admin=1",
```

Espelha o contrato de `cotas-source.ts`. Quebraria junto.

---

## §3. O ACHADO MAIOR QUE O ERRO

Perseguir o consumidor expôs algo que nenhum dos dois lados tinha na mão: **a
identidade posicional do `prospere-360` já está gravada dentro do xtv.**

O caminho completo, medido ponta a ponta:

```
prospere-360  app/api/cotas-extra/route.js:330    id: i + 1        (posição do array)
                            ↓ HTTP ?admin=1
bidcon-app    platform/lib/cotas-source.ts:147    numero = r.id
                            ↓
bidcon-app    cotas-source.ts:115                 => numero_externo
                            ↓
xtv           chave de upsert (administradora_origem, numero_externo)
```

O próprio código já sabia, em dois comentários independentes:

```
platform/app/api/sync-cotas/route.ts:210
  // numero_externo (que é POSIÇÃO, D1). Ela precisa do payload inteiro

platform/app/api/atende/route.ts:327
  // conversa? (o sync realoca numero_externo entre rodadas; ver caso do
```

Ou seja: o `numero_externo` das quatro fontes externas **não é um id de origem
que por acaso é numérico** — é o **índice do array da raspagem daquele ciclo**.
Reordenou a raspagem, mudou o estoque, entrou uma carta no meio: as posições
seguintes deslizam e o upsert casa carta com carta errada.

É a **D1 pura**, na chave de upsert, em produção. Não é achado novo de defeito
— os comentários mostram que a casa já o conhecia. É achado novo de **alcance**:
a origem do defeito está no outro repo, e o item 5 mexia justamente nela.

**Não toquei em nada.** Isto é matéria de decisão, e provavelmente de fatia
própria.

---

## §4. O QUE MUDA PARA O ITEM 5

| afirmação ratificada | estado após a medição |
|---|---|
| "Zero consumidores" | **FALSA** — `cotas-source.ts:147` lê `r.id` |
| "troca livre de compatibilidade, medida" | **FALSA** — a remoção zera 4 fontes |
| "campo sem consumidor não ganha sal — YAGNI" | **premissa caiu**; o campo tem consumidor, e é a chave de upsert |
| `idx` legado desnecessário (§4 de `c478019`) | **FALSO** — há consumidor do índice |

A restrição que a REF-01 herdaria muda de forma: não é só *"referência pública
estável"*, é **"substituto de `numero_externo` na chave de upsert das fontes
externas"** — com migração do que já está gravado.

**Nada proposto aqui.** A mão que erra a medição não é a que redesenha a
decisão que o erro derrubou.

---

## §5. ATO D1 — INTACTO E PRONTO

O achado é todo do caminho de **ingestão** (`cotas-source.ts` escreve no xtv).
Os itens D-1..D-4 são do caminho de **leitura** (`vw_cartas_publicas` → vitrine
→ index.html → widget → atende) e tratam do **uuid real do xtv**, não do
`numero_externo`. Superfícies disjuntas.

| # | item | estado |
|---|---|---|
| D-1 | `platform/app/api/vitrine/route.ts` expõe `id` | pronto, não tocado pelo achado |
| D-2 | `public/index.html` com `id` nas 3 chamadas + modal | pronto, não tocado |
| D-3 | widget emite `data-id` (491) e lê (527), duas cópias | pronto, não tocado |
| D-4 | `/api/atende` por `id`, fallback `ref`, guarda 4b | pronto, não tocado |

A palavra `CONFIRMADO O DEPLOY D-1..D-4` é incondicional e os dois atos foram
declarados desacoplados. **Executo o ATO D1 no ato seguinte**, com build verde e
amostra do payload novo, aqui mesmo.

Parei antes dele apenas porque uma medição que já entrou em decisão ratificada
precede qualquer código novo.

---

## §6. ATO D2 — BLOQUEADO POR DOIS MOTIVOS

1. **PROSPERE-360-ADMIN-01** — commit local pré-existente `1aa7a67`
   (`entrada_parceiro` cru em `?admin=1`), pendente de revisão do Emerson antes
   de qualquer push daquele repo.
2. **NOVO** — o item 5, como redefinido, **quebra a ingestão**. Precisa ser
   redefinido de novo antes de existir como diff.

Nada foi escrito no `prospere-360`.

---

## §7. ERROS DE FERRAMENTA DESTE CICLO

- `git grep` com pathspec só de exclusões → casa vazio, `exit=1`. **Causa raiz
  do falso-negativo.** Correção: sempre incluir `'*'` positivo.
- Reforça o padrão já visto na Regra 7: `\b` inexistente no ERE do `git grep`,
  variável não expandida em pipeline, `|` engolindo `$?`. Todos produzem
  **zero resultados com saída limpa** — a forma mais perigosa de erro.

=== FIM DO RELATÓRIO ===
