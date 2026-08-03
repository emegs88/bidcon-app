# IDENTIDADE-01 — ÚLTIMO RELATÓRIO

**Canal definitivo.** Sobrescrito a cada relatório, empurrado ao origin na
sequência. A arquitetura lê aqui.

- **Gerado em:** 03/08/2026
- **Ato:** ATO C — varredura do `emegs88/360prospere`
- **Substrato de código:** `prospere-360` @ `1aa7a67` (origin `github.com/emegs88/360prospere.git`)
- **Autor:** mão do repo/app

---

## §0. VEREDITO — DEPLOY NÃO EXECUTADO

O ATO C trouxe **dois achados materiais** que mudam o item 5 do checklist §6.
A palavra condicional de Emerson tem condição explícita — *"CONCLUÍDO O ATO C
**SEM ACHADO QUE MUDE O CHECKLIST**"* — e a condição **não foi satisfeita**.
A instrução do mesmo parágrafo é literal: *"Se o ATO C trouxer achado material:
PARAR e reportar ANTES de deployar."*

**Parado. Nada foi deployado.** Os achados estão no §3.

Os itens 1–4 do checklist (snapshot, index.html, atende, widget) **não foram
tocados pelos achados** — seguem válidos como escritos e prontos para executar
assim que o item 5 for redefinido.

---

## §1. DISCIPLINA DE CONTEXTO (Regra 7) — TRÊS FALSO-NEGATIVOS DESCARTADOS

A Regra 7, ratificada neste ciclo, foi acionada **três vezes na própria
varredura que a estreou**:

1. `P=<caminho>; git -C "$P" grep numero_externo` → devolveu
   `ZERO ocorrencias de numero_externo`, mas o bloco de prova de contexto veio
   **vazio** e o stderr trazia `fatal: not a git repository`. A variável não
   expandiu. **Descartado.**
2. `git grep -nE '\bid: ' -- app public` → `exit=1`, zero linhas — quando já
   sabíamos existir `id: i + 1`. Causa: **`\b` não existe no ERE do `git grep`**.
   Não era falso-negativo de contexto, era de sintaxe. **Descartado.**
3. `git grep ... | head -60` → saída vazia e `exit` em branco; o cano engoliu o
   código de saída. **Descartado.**

Nos três casos a resposta era plausível e o item 1 **estava certo por acaso** —
`numero_externo` de fato não existe naquele repo. Confirmado depois, com
contexto provado:

```
$ pwd                          → /Users/prospere/Desktop/360prospere/prospere-360
$ git rev-parse --show-toplevel → /Users/prospere/Desktop/360prospere/prospere-360
$ git grep -n "numero_externo" -- . ':!*.sql'
exit_numero_externo=1          ← zero ocorrências, agora medido
```

Toda medição abaixo carrega `pwd` ou `git -C` explícito na saída.

---

## §2. VARREDURA — RESULTADO

Contexto: `pwd` = `/Users/prospere/Desktop/360prospere/prospere-360`, HEAD `1aa7a67`.

### 2.1 `numero_externo` — ZERO
Confirmado com contexto provado (acima). O `prospere-360` não conhece o
`numero_externo` nem as views do xtv.

### 2.2 `ref` — três sítios, nenhum é identidade pública

```
app/api/cotas-servopa/route.js:102-107   idParceiro (ref) — SÓ em ?admin=1
app/api/fipe/route.js:48                 referencia: v.MesReferencia — FIPE, sem relação
app/page.jsx:9-10                        href — sem relação
```

### 2.3 `id` — inventário completo de `app/` e `public/`

```
app/api/cotas-extra/route.js:330      id: i + 1,              ← DEFEITO D1
app/api/cotas-servopa/route.js:91     id: i + 1,              ← DEFEITO D1 (novo)
app/api/estoque/route.js:58           id: p.id,               ← repasse de id real, OK
app/api/imoveis/route.js:162          id: codigo || url,      ← chave de negócio, fora de escopo
public/painel.html:301-441            id:uid()                ← painel local, localStorage, fora de escopo
```

`app/api/cotas/route.js:37` — `const n = Number(o.id) || 0`: **lê** o id de
origem da Lance e o publica como `n`. É o `numero_externo` (POSIÇÃO, na
linguagem da D1), coerente com o resto. Não fabrica identidade.
*Observação menor, não bloqueante:* o `|| 0` colapsa qualquer id não-numérico
para `0` — duas cartas podem sair com `n=0`.

### 2.4 `cotas-jsonld` — HIPÓTESE REFUTADA

A arquitetura previu "mesma classe provável — âncora posicional". **Não é.**

```
app/api/cotas-jsonld/route.js:148-152
  const itemListElement = disp.map((a, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    item: produto(a, ts),
  }));
```

`position: i + 1` é o **contrato do schema.org**: o campo se chama `position` e
significa posição na lista. É o oposto exato do defeito D1 — D1 é posição
usando o nome `id`. Aqui a posição usa o nome `position`.

`produto()` (linhas 98–125) emite `@type`, `name`, `category`, `dateModified`,
`offers`, `additionalProperty` — **sem `@id`, sem `sku`, sem `identifier`, sem
`url` por produto**. Nenhuma identidade posicional vaza para o schema.

*Achado lateral, fora desta fatia:* justamente por não haver `sku`/`@id`, os
produtos do JSON-LD não têm identificador estável para buscadores. É questão de
SEO/deduplicação, não de D1. Registrado, não endereçado.

---

## §3. OS DOIS ACHADOS MATERIAIS

O checklist §6 item 5 dizia: *"`cotas-extra` `id: i+1` → uuid real, com `idx`
legado se houver consumidor do índice."* A varredura mostra que essa formulação
**não é executável como escrita**, por dois motivos independentes.

### ACHADO 1 — não existe uuid a colocar no lugar

`/api/cotas-extra` **não lê o banco xtv**. Ele agrega raspagem de três
parceiros (CBC, PIFFER, CARTAS) e monta o payload em memória:

```
app/api/cotas-extra/route.js:320-348
  let cotas = all.map((o, i) => {
    ...
    const out = {
      id: i + 1,
      fonte: o.fonte,  t: o.t,  c: o.c,  e: eExib,
      p: o.p,  x: o.x,  ac: ..., adm: o.adm,  custoEfetivo,
    };
```

O objeto de origem `o` traz `fonte, t, c, e, p, x, admN, adm, soma`. **Não há
uuid, não há id de parceiro, não há chave do xtv.** "Trocar por uuid real" não
tem origem de onde tirar o uuid. O item 5 pressupõe um dado que não existe
nessa rota.

### ACHADO 2 — no `cotas-servopa` o id real existe, e é DELIBERADAMENTE secreto

Segundo sítio, não previsto no checklist:

```
app/api/cotas-servopa/route.js:90-107
  const carta = { id: i + 1, fonte: ADM, t, c, e: entradaCliente, p, x, adm: ADM };
  // Campos internos só no painel (?admin=1). Ambos NUNCA no payload público:
  //  - idParceiro (ref): a Servopa é fonte EXCLUSIVA com página própria por ref
  //    (cartascontempladasservopa.com.br/cartas/<ref>). Ref público = qualquer um
  //    pega o número no card da Bidcon e vai direto no parceiro — mesmo bypass que
  //    já fechamos pra administradora. Como aqui a fonte é única, o risco persiste.
  if (admReq) { carta.idParceiro = o.ref; }
```

Aqui **existe** identidade estável de origem (`o.ref`), e ela está fora do
payload público **por decisão explícita e documentada de anti-bypass**.

Aplicar o item 5 ao pé da letra neste sítio — trocar `id: i+1` pelo id real —
**publicaria o `ref` da Servopa e desfaria essa proteção em silêncio**. Seria
executar uma correção de identidade criando um vazamento comercial.

Não toquei. É exatamente o tipo de decisão que não é da mão que executa.

---

## §4. CONSUMIDORES MAPEADOS — o campo `id` não é lido por ninguém

Exigência do ato: mapear consumidores antes de qualquer troca.

```
$ git grep -n "cotas-extra\|cotas-servopa"    (prospere-360)
app/api/cotas-jsonld/route.js:74   const r = await fetch(base + '/api/cotas-extra', ...)
next.config.mjs:8                  source: '/api/:path(imoveis|estoque|fipe|cotas|cotas-extra)'
(demais ocorrências são comentários)

$ git -C bidcon-app grep -n "cotas-extra" -- ':!docs' ':!ident01' ':!*.md'
exit=1     ← nenhum CÓDIGO do bidcon-app consome a rota
```

O único consumidor de código é o `cotas-jsonld`, e ele **descarta o `id`**:

```
app/api/cotas-jsonld/route.js:78-85
  return cotas.filter((o) => Number(o.c) > 0).map((o) => {
    const a = { t: ..., c: Number(o.c), e: Number(o.e) || 0 };
    const adm = String(o.adm || '').trim();
    if (adm) a.adm = adm;
    return a;
  });
```

Mapeia `{t, c, e, adm}`. Nunca lê `o.id`.

Nenhum front do `prospere-360` chama `/api/cotas-extra` — os HTMLs públicos
(`bidcon.html`, `bidcon-lojista.html`, `bidcon-imobiliaria.html`,
`cerebro.html`) chamam `/api/cotas`, rota diferente.

**Consequência boa:** não há consumidor do índice. O campo `idx` legado
previsto no checklist **não é necessário** — ninguém depende da posição. A
troca é livre de compatibilidade; o que falta é *o quê* colocar no lugar.

---

## §5. CAMINHO PROPOSTO — PARA DECISÃO DA ARQUITETURA, NÃO APLICADO

Os dois achados apontam para a mesma saída, e ela já é doutrina desta fatia:
**identidade por pegada (fingerprint), que é a própria D1 e o mecanismo da
0063.**

- **`cotas-extra`:** `id` = hash estável de `(fonte, t, c, e, p, x, adm)`.
  Determinístico, não-posicional, sobrevive a reordenação e a mudança de teto.
  Resolve o ACHADO 1 sem inventar uuid que não existe.
- **`cotas-servopa`:** `id` = hash de `o.ref` **com sal**, ou da mesma tupla de
  negócio. Dá identidade real e estável ao payload público **sem revelar o
  `ref`** — o anti-bypass do comentário 102–105 fica intacto. Resolve o
  ACHADO 2 sem desfazer a proteção.

Ambos são opacos, estáveis e não-posicionais — atendem à regra de fundo
(*id fabricado por índice não coexiste com id real no mesmo ecossistema*) sem
os efeitos colaterais.

**Não apliquei.** Escolher a função de pegada, o sal e a granularidade é
decisão de arquitetura, e o ACHADO 2 tem lado comercial que não é meu.

---

## §6. CHECKLIST DO DEPLOY — ESTADO APÓS O ATO C

| # | item | estado |
|---|---|---|
| 1 | snapshot com `id` da `vw_cartas_publicas` | **inalterado**, pronto |
| 2 | `index.html` com `id` nas 3 chamadas + modal | **inalterado**, pronto |
| 3 | `/api/atende` por `id`, fallback `ref`, guarda 4b | **inalterado**, pronto |
| 4 | widget emite `data-id` (linha 491) e lê (527) | **inalterado**, pronto |
| 5 | `cotas-extra` `id:i+1` → uuid real, `idx` legado | **BLOQUEADO** — não há uuid (ACHADO 1); há 2º sítio com id secreto (ACHADO 2); `idx` desnecessário (§4) |

Itens 1–4 são do `bidcon-app` e independem do item 5, que é do `prospere-360`.

---

## §7. O QUE ESTA MÃO AGUARDA

Uma decisão sobre o item 5 — a pegada proposta no §5, ou outra forma. Feita
essa escolha, o deploy dos itens 1–4 pode seguir sob a palavra já dada, e o
item 5 vira ato próprio no outro repo.

Nada do `prospere-360` foi escrito. O ATO C foi leitura, como especificado.

=== FIM DO RELATÓRIO ===
