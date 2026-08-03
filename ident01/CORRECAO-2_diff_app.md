# IDENTIDADE-01 / CORRECAO-2 — diff da aplicação

**NÃO APLICAR.** Rascunho. Vive em `ident01/` (CLAUDE.md, Regra 4).
**CONSTRUÍDO DO ZERO pós-incidente 02/08.**

---

## §0. Método e procedência

O "diff dos 6 itens" aprovado em 01/08 **não existe em disco** e não foi
reconstruído de memória — paráfrase não é diff
(`CORRECAO-2_estado_real_NAO_APLICAR.md`, §3.4). Este documento é uma
derivação NOVA, feita de duas fontes e só delas:

1. o repositório real, por `grep` e leitura — toda afirmação abaixo carrega
   `arquivo:linha` e o trecho cru;
2. o banco ao vivo (xtv `xtvjpnyadcdeadhmzyff`), medido nesta sessão.

`CORRECAO-2_estado_real_NAO_APLICAR.md` foi usado **apenas** como registro do
que se perdeu, nunca como fonte de fato. Nenhuma conclusão do relatório
fictício de 02/08 semeia este documento — inclusive o "achado" do
`security_invoker`, que foi **re-medido do zero** e cujo veredito está no
arquivo SQL irmão, §4.

**Achado que contraria a expectativa herdada:** boa parte da app **já está
correta**. O defeito é mais estreito do que "6 itens" sugeria. Os itens que
sobram estão no §3.

---

## §1. A regra que está sendo verificada

`vw_vitrine_viva` define, cru (`pg_get_viewdef`, medido):

```
 SELECT c.id,
    c.numero_externo AS ref,
    ...
```

Logo `ref == cartas.numero_externo`, literal. Pela **D1** da spec,
`numero_externo` é **POSIÇÃO na fonte, não identidade** — o sync realoca o
número entre rodadas.

**Critério aplicado a cada superfície:**

- `ref` usado como **rótulo de exibição** → OK, não mexer.
- `ref` usado como **chave de lookup / link de detalhe** → DEFEITO.

---

## §2. Inventário completo (todas as ocorrências, com veredito)

Varredura: `grep -n "numero_externo"` em todo o repo (fora de `.sql`) +
`grep -n "\bref\b"` em `platform/app/**/*.ts`.

### 2.1 — Superfícies JÁ CORRETAS (nenhuma mudança)

| arquivo:linha | trecho cru | veredito |
|---|---|---|
| `platform/components/CartaCard.tsx:37` | `href={\`/cartas/${carta.id}\`}` | **já chaveado por `id`** |
| `platform/app/cartas/[id]/page.tsx:62` | `"id, tipo, numero_externo, valor_credito, ..."` | seleciona ambos |
| `platform/app/cartas/[id]/page.tsx:74` | `const ref = c.numero_externo ? \`nº ${c.numero_externo}\` : \`ref. ${c.id.slice(0, 8)}\`` | `ref` é **rótulo** |
| `platform/lib/simulador/data.ts:112` | `"id, numero_externo, administradora_id, ..."` | seleciona ambos |
| `platform/lib/simulador/data.ts:139` | `ref: c.numero_externo != null ? \`#${c.numero_externo}\` : c.id.slice(0, 6)` | **rótulo** |
| `platform/lib/simulador/engine.ts:21` | `ref: string; // "#"+numero_externo ?? id.slice(0,6)` | **rótulo**, documentado |
| `platform/app/admin/revisao/page.tsx:102` | `... · ref. {c.numero_externo ?? "—"}` | **rótulo** |
| `platform/lib/buscar-cartas-tool.ts:125` | `.select("id, ref, tipo, credito, entrada, parcela, parcelas, custo_am, administradora, agio_120")` | **já traz `id`** |
| `platform/lib/buscar-cartas-tool.ts:140` | `id: String(c.id),` | devolve `id` ao modelo |
| `platform/app/api/atende/_prompt.ts:225` | `[[CARTA]]id=<id>\|ref=<ref>\|tipo=...` | marcador **já carrega `id`** |
| `platform/app/api/atende/_prompt.ts:219` | `"ela é a ÚNICA fonte com id, administradora e selo corretos"` | afirmação **verdadeira**, confirmada em 2.1 acima |

Confirmação no banco de que `lib/buscar-cartas-tool.ts` tem de onde tirar o
`id` (cru):

```
vw_carousel_cartas | attnum 1 | id
```

### 2.2 — Superfícies FORA DE ESCOPO (varridas e declaradas)

| arquivo:linha | trecho cru | por que fica de fora |
|---|---|---|
| `platform/lib/importador-preview.ts:182-183` | `porFornecedorNumero.set(\`${c.fornecedor_id}\|${c.numero_externo}\`, ...)` | dedup de **importação**, não vitrine; a chave `(fornecedor, numero)` é do arquivo do fornecedor |
| `platform/lib/importador-preview.ts:209-210` | `else if (l.numero_externo != null) { ... porFornecedorNumero.get(...) }` | idem |
| `platform/lib/importador-source.ts:95` | `numero_externo: ["numero_externo", "numeroexterno", "ref", "numero", "n", "id"]` | mapa de **cabeçalho de CSV** do fornecedor |
| `platform/lib/cotas-source.ts:47,115` | `numero: number; // id nativo da fonte ... => numero_externo` | contrato do **sync**, coberto pela FASE B, não pela CORRECAO-2 |
| `platform/app/api/sync-cotas/route.ts:210` | comentário sobre `numero_externo` ser POSIÇÃO (D1) | já correto |
| `platform/app/api/admin/importar/publicar/route.ts:98` | `numero_externo: l.numero_externo,` | gravação na importação |
| `platform/app/api/repasse/route.ts:77` | `const campos = "ref,tipo,credito,entrada,parcela,parcelas,saldo_devedor,administradora"` | superfície **REPASSE**; alimenta simulador client-side, **sem link de detalhe** — `ref` é rótulo. Fica declarado como pendência separada, não silenciado. |
| `scripts/gerar-vitrine.mjs:71` | `campos = "ref,tipo,credito,entrada,parcela,parcelas,custo_am,administradora"` | SSR estático; `ref` só vira `<span class="cnum">` |
| `scripts/gerar-vitrine.mjs:170` | `<span class="cnum">${refCota(c.ref)}</span>` | **rótulo** |

### 2.3 — Superfícies COM DEFEITO

| # | arquivo:linha | trecho cru | natureza |
|---|---|---|---|
| A | `platform/app/api/atende/route.ts:316` | `.eq("numero_externo", refFoco)` | **LOOKUP POR POSIÇÃO** — o defeito central |
| B | `platform/app/api/vitrine/route.ts:91` | `"ref,tipo,credito,entrada,parcela,parcelas,custo_am,agio_120,agio_150,administradora,fonte,exclusiva"` | `id` **ausente** do payload público |
| C | `public/prosperito-widget.js:491` | `... class="pw-carta-cta" data-ref="'+ref+'" data-tipo=...` | **não emite `data-id`** (a cópia servida) |
| D | `public/prosperito-widget.js:527` e `platform/public/prosperito-widget.js:526` | `var ref = btn.getAttribute('data-ref') \|\| '';` | handler **descarta o `id`** que já existe |
| E | `platform/app/api/atende/route.ts:213-222` | `type CartaFoco = { ref: string; tipo: string; ... }` | tipo **sem campo `id`** |
| F | `platform/app/api/atende/route.ts:227` | `const ref = String(o.ref ?? '').trim().slice(0, 40);` | parser **não lê `id`** |
| G | `platform/app/api/mcp/route.ts:43` | `ref: number;` | conector MCP **sem `id` disponível** (bloqueado pela view — ver SQL irmão) |

---

## §3. A cadeia do defeito, traçada linha a linha

Este é o caminho real do Emerson (ratificado na mensagem C): site
institucional → card → widget Prosperito → conversa sobre "esta carta".

```
[1] platform/app/api/vitrine/route.ts:91
      campos = "ref,tipo,credito,..."          <-- id NUNCA entra no payload
    platform/app/api/vitrine/route.ts:147
      n: c.ref,                                <-- vira "n" no JSON

[2] public/index.html:1342
      fetch("https://app.bidcon.com.br/api/vitrine")
    public/index.html:1471
      onclick='abrirProsperitoComCarta({ref:...,n:...,tipo:...,credito:...})'
                                               <-- não há id para passar

[3] public/prosperito-widget.js:317
      window.abrirProsperitoComCarta = function (carta) {
    public/prosperito-widget.js:319
      var ref = carta.ref != null ? String(carta.ref).slice(0, 40) : '';
    public/prosperito-widget.js:327
      cartaFocoAtual = { ... }                 <-- sem id
    public/prosperito-widget.js:243
      if (cartaFocoAtual) corpo.carta_foco = cartaFocoAtual;

[4] platform/app/api/atende/route.ts:227
      const ref = String(o.ref ?? '').trim().slice(0, 40);
                                               <-- id nem seria lido se viesse

[5] platform/app/api/atende/route.ts:299
      const refFoco = Number(cartaFoco.ref);
    platform/app/api/atende/route.ts:316
      .eq("numero_externo", refFoco)           <-- LOOKUP POR POSIÇÃO
```

O caminho paralelo, do card renderizado **dentro** do chat, **tem `id` na
origem e o perde no meio**:

```
vw_carousel_cartas.id (attnum 1, medido)
  -> platform/lib/buscar-cartas-tool.ts:125  .select("id, ref, ...")
  -> platform/lib/buscar-cartas-tool.ts:140  id: String(c.id)
  -> platform/app/api/atende/_prompt.ts:225  [[CARTA]]id=<id>|ref=<ref>|...
  -> platform/public/prosperito-widget.js:462  data-id="'+pwEsc(c.id||'')+'"   <-- emitido
     public/prosperito-widget.js:491            (sem data-id)                   <-- NÃO emitido
  -> ambos os handlers (526 / 527): leem só data-ref                            <-- DESCARTADO
```

Isto é o `id` chegando até o penúltimo passo e sendo jogado fora.

### Divergência entre as duas cópias do widget (medida)

```
$ git log -1 --format=%h -- public/prosperito-widget.js
a1bd5f6
$ git log -1 --format=%h -- platform/public/prosperito-widget.js
a1bd5f6
$ grep -c "data-id" public/prosperito-widget.js
0
$ grep -c "data-id" platform/public/prosperito-widget.js
1
```

Mesmo commit, conteúdo diferente, **e a divergência é nos dois sentidos**
(`public/` tem bloco Bidcon Price que `platform/public/` não tem;
`platform/public/` tem `data-adm` e `data-id` que `public/` não tem). Duas
cópias vivas do mesmo arquivo divergindo em silêncio é um risco por si só e
está declarado no §5.

---

## §4. Diff proposto

Ordem obrigatória: **view primeiro** (SQL irmão), depois app. Publicar app que
lê `id` antes de a view expor `id` derruba a superfície.

### D-1 — `platform/app/api/vitrine/route.ts` — expor `id`

`vw_vitrine_viva` **já tem** `id` (attnum 1, medido). Nenhuma mudança de banco
é necessária para este item.

```diff
@@ type LinhaCarta @@
 type LinhaCarta = {
+  id: string | null;
   ref: number | null;
@@ linha 90-91 @@
-    const campos =
-      "ref,tipo,credito,entrada,parcela,parcelas,custo_am,agio_120,agio_150,administradora,fonte,exclusiva";
+    const campos =
+      "id,ref,tipo,credito,entrada,parcela,parcelas,custo_am,agio_120,agio_150,administradora,fonte,exclusiva";
@@ linha 146-147 @@
     const cotas = linhas.map((c) => ({
+      id: c.id,
       n: c.ref,
```

`n` **permanece** — é o rótulo já usado pelo front (`refCota(a.n)`) e por
`abrirDetalhe(a.n)`. Não se troca rótulo nesta fatia.

### D-2 — `public/index.html` — carregar `id` no clique

```diff
-onclick='abrirProsperitoComCarta({ref:...,tipo:...,credito:...,...,n:...,custo:...})'
+onclick='abrirProsperitoComCarta({id:${cfEsc(a.id)},ref:...,tipo:...,credito:...,...,n:...,custo:...})'
```

Três ocorrências, todas com a mesma forma: **1342** (bloco minificado:
`abrirDetalhe` e `renderMarket`) e **1471**. `cfEsc` é o escapador já usado
ali para strings.

### D-3 — widget: parar de descartar o `id`

Nas **duas** cópias (`public/` e `platform/public/`):

```diff
@@ abrirProsperitoComCarta, ~linha 318-330 @@
   cartaFocoAtual = {
+    id: carta.id != null ? String(carta.id).slice(0, 40) : '',
     ref: ref,
@@ handler do card do chat, ~linha 526-534 @@
   var ref = btn.getAttribute('data-ref') || '';
+  var id  = btn.getAttribute('data-id')  || '';
   ...
   cartaFocoAtual = {
+    id: id,
     ref: ref,
```

E em `public/prosperito-widget.js:491`, emitir `data-id` como a outra cópia já
faz em `platform/public/prosperito-widget.js:462`.

### D-4 — `platform/app/api/atende/route.ts` — aceitar e preferir `id`

```diff
@@ type CartaFoco, linhas 213-222 @@
 type CartaFoco = {
+  id?: string;
   ref: string;
@@ lerCartaFoco, linha 227 @@
   const ref = String(o.ref ?? '').trim().slice(0, 40);
+  const id = String(o.id ?? '').trim().slice(0, 40);
@@ retorno, linha 245 @@
-  return { ref, tipo, credito, entrada, parcela, nparcelas, adm, custo };
+  return { id: id || undefined, ref, tipo, credito, entrada, parcela, nparcelas, adm, custo };
@@ lookup, linhas 299-316 @@
-      .eq("numero_externo", refFoco)
+      // IDENTIDADE-01/D1: id quando houver; numero_externo só como
+      // fallback do estoque legado que ainda não carrega id.
+      ...(cartaFoco.id ? { por: "id" } : { por: "numero_externo" })
```

`id` é **opcional** de propósito: enquanto a app antiga estiver em cache no
navegador do cliente, `carta_foco` continua chegando só com `ref`. Tornar `id`
obrigatório derrubaria a reserva por chat para todo cliente com aba aberta.

**A guarda 4b (linhas 326-334) PERMANECE**, conforme ratificado na mensagem C
— cinto duplo depois da troca, não em vez dela. Com lookup por `id` ela passa
a ser redundante no caminho novo e continua sendo a única proteção no caminho
de fallback.

### D-5 — `platform/app/api/mcp/route.ts` — **BLOQUEADO pela view**

`buscar_cartas` retorna `SETOF vw_cartas_publicas` (medido), que não tem `id`.
**Não há diff de app possível aqui antes da DDL** do arquivo SQL irmão. Depois
dela:

```diff
@@ linha 43 @@
 type CartaMcp = {
+  id: string;
   ref: number;
```

O texto renderizado em `route.ts:178` (`` `#${c.ref} — ...` ``) **não muda** —
`ref` continua sendo o rótulo que o humano lê.

---

## §5. Risco residual — declarado, não resolvido

1. **Duas cópias vivas do widget divergindo** (§3). Este diff manda editar as
   duas, o que **perpetua** o problema em vez de resolvê-lo. Consolidar as
   cópias é uma fatia própria — não cabe aqui e não vai ser feita de contrabando.
2. **Cache de navegador.** Clientes com a aba aberta seguem mandando
   `carta_foco` sem `id` por tempo indeterminado. O fallback por
   `numero_externo` fica, e com ele a janela de erro da D1 — reduzida, não
   fechada.
3. **`app/api/repasse/route.ts` fica sem `id`** (§2.2). Hoje não tem detalhe
   por link; se ganhar, herda o defeito inteiro.
4. **`lib/whatsapp/cerebro.ts:188,221`** monta `ref=${c.numero_externo}` no
   mesmo formato do `blocoCartas` (`atende/route.ts:157,198`). É bloco
   estático de contexto, não lookup — mas se algum dia virar gatilho de ação,
   entra no mesmo defeito. Registrado.
5. **`security_invoker`**: real, medido, **e não corrigido** — ver SQL irmão,
   §4, incluindo o bloqueador de `reservas` (RLS ligada, zero políticas).
6. **A DDL pode ser recusada pelo Postgres** por causa da dependência
   `SETOF vw_cartas_publicas`. Só o ensaio no szs responde. Se recusar,
   PARAR — sem `DROP ... CASCADE`.

---

## §6. Ordem de aplicação

1. Ensaio integral no szs (SQL irmão, §5). Falhou → PARAR.
2. Frase `AUTORIZO IDENTIDADE-01 CORRECAO-2` → DDL no xtv → re-medir e colar
   cru → PARAR e aguardar confirmação.
3. D-1 → publicar → medir o payload real de `/api/vitrine` → PARAR.
4. D-2 + D-3 → publicar → PARAR.
5. D-4 → publicar → PARAR.
6. D-5 (só depois de 2 confirmado) → PARAR.

Um ato por mensagem, saída crua junto, confirmação externa antes do próximo
(CLAUDE.md, Regra 6).

---

## §7. ERRATA-1 — escopo real da varredura do §2

*Acrescentada em 02/08/2026, por decisão da arquitetura. Esta seção é
**append-only**: o texto do §2 fica como está, errado, porque a errata é o
registro honesto do erro de cobertura — corrigir por reescrita apagaria o
rastro.*

**O que o §2 afirma:** "Inventário **completo** (todas as ocorrências)" e
"Varredura: `grep` em **todo o repo**".

**O que foi de fato varrido:** o repositório **`emegs88/bidcon-app`**, e
somente ele.

**O que ficou de fora:** o repositório **`emegs88/360prospere`** (clone local
`~/Desktop/360prospere/prospere-360`), que é uma segunda superfície de
produção. Ele não foi varrido quando o §2 foi escrito; o §2 declarou cobertura
maior do que a medição sustentava.

**Por que o diff do §4 continua válido mesmo assim** — medido depois, não
argumentado: `grep` no `360prospere` retorna **zero** ocorrências de
`numero_externo`, `vw_cartas_publicas`, `vw_vitrine_viva` e `from("cartas")`.
Aquele app **não toca o schema `cartas` do xtv**, logo o DDL do SQL irmão e os
itens D-1..D-5 não o afetam nem dependem dele. O erro é de **declaração de
escopo**, não de conteúdo do diff.

**O que a varredura de fora encontrou** (registrado, endereçado em ato
próprio): `app/api/cotas-extra/route.js:330` fabrica identidade por posição de
array — `id: i + 1`. Mesma classe da D1, superfície distinta.

**Classe do erro:** é a mesma do incidente de 02/08 — declarar cobertura mais
larga do que a medição feita. Por isso entra aqui nomeada, e não some.

**Escopo varrido: `bidcon-app`. Pendente: `360prospere` (ATO C).**
