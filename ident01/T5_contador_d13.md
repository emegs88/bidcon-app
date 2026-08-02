# T5 — Contador da home (D13): séries bruta/A/B + amostragem

Medido no **xtv em leitura pura** (FASE A). Nenhuma escrita em produção.

## Definições

- **fp cheio** = `carta_fingerprint(tipo, credito, entrada, parcela, parcelas, adm_input)` —
  `md5(prosrc)` no xtv = `2b59bc5723f6ad9856ea4958f4ad0450`, **byte a byte igual ao szs** (âncora D1 vale em produção).
- **fp_estrutural A** = `md5(tipo|credito|qtd_parcelas|adm_input)`
- **fp_estrutural B** = `md5(tipo|credito|adm_input)`
- **adm_input** = nome resolvido por `resolver_administradora`; se não resolve, cru normalizado
  (`unaccent(lower(trim(raw)))` com espaços colapsados) — D2.
- **"Novas hoje"** = fp cheio que estreia no dia **e** cujo fp_estrutural também estreia,
  em janela de retrospecto de **14 dias**.
- **Unidade das séries**: fingerprints distintos que estreiam no dia (não linhas).

### Nota de implementação: `unaccent` não existe no xtv

`CREATE EXTENSION unaccent` **não está instalada no xtv** e nenhuma função `unaccent`
é visível. Para medir em leitura pura, o ramo de fallback foi emulado com `translate()`
sobre o mapa Latin-1 completo. A emulação foi **certificada contra o `unaccent` real do szs**:
9 cadeias de teste, incluindo uma sonda com os 48 caracteres acentuados,
**0 divergências**. As únicas linhas não-ASCII no fallback do xtv são `ITAÚ - P` (46)
e `ITAÚ - M` (42).

> **Consequência para a FASE B**: a migration precisa de `CREATE EXTENSION IF NOT EXISTS unaccent`
> **antes** de `adm_fingerprint_input`, ou a função não compila.

## Janela

Tabela `cartas` do xtv cobre `2026-07-05` → `2026-08-01 09:02`, 94.747 linhas.
Retrospecto de 14 dias só fica completo a partir de **2026-07-20**.

Dias excluídos da estatística: `2026-07-19` e `2026-07-26` (sem sync),
`2026-07-25` (bruta=6) e `2026-08-01` (bruta=4, dia parcial, corte às 09:02).

## Séries (10 dias úteis)

| dia | bruta | A | B | nova real | tick de prazo | reprecificada |
|---|---|---|---|---|---|---|
| 2026-07-20 | 289 | 224 | 172 | 172 | 52 | 65 |
| 2026-07-21 | 475 | 244 | 204 | 204 | 40 | 231 |
| 2026-07-22 | 388 | 270 | 218 | 218 | 52 | 118 |
| 2026-07-23 | 517 | 369 | 342 | 342 | 27 | 148 |
| 2026-07-24 | 290 | 229 | 201 | 201 | 28 | 61 |
| 2026-07-27 | 331 | 268 | 242 | 242 | 26 | 63 |
| 2026-07-28 | 306 | 205 | 173 | 173 | 32 | 101 |
| 2026-07-29 | 277 | 224 | 203 | 203 | 21 | 53 |
| 2026-07-30 | 473 | 292 | 243 | 243 | 49 | 181 |
| 2026-07-31 | 229 | 132 | 116 | 116 | 16 | 97 |

| série | mín | máx | média | mediana | total |
|---|---|---|---|---|---|
| bruta | 229 | 517 | 357,5 | 318,5 | 3.575 |
| A | 132 | 369 | 245,7 | 236,5 | 2.457 |
| B | 116 | 342 | 211,4 | 203,5 | 2.114 |

Redução: **A −31,3%** e **B −40,9%** contra a bruta; **B −14,0%** contra A.

Faixa de referência da spec para a bruta: 223–467/dia.
Observado: **229–517/dia**, média 357,5 — dentro da faixa, com 3 dias acima do teto.

### Decomposição

`B ⟹ A` por construção (fpB é engrossamento de fpA), então os baldes são exatos:

- **nova real** = B = 2.114 (**59,1%**)
- **tick de prazo** = A − B = 343 (**9,6%**)
- **reprecificada** = bruta − A = 1.118 (**31,3%**)

Isto é o defeito que a D13 nomeia, medido: **quase um terço do contador atual é
a mesma carta reprecificada**.

## Amostragem manual — 10 cartas (2026-07-30)

### Balde 1 — nova real (4/4 sem irmã anterior)

| origem | tipo | crédito | entrada | parcela | prazo | adm |
|---|---|---|---|---|---|---|
| PIFFER | imóvel | 258.990 | 124.029 | 1.681 | 152 | Santander |
| PLAYCONTEMPLADAS | imóvel | 265.900 | 106.103 | 4.807 | 64 | Racon |
| CBC | imóvel | 137.775 | 53.544 | 2.534 | 58 | Itaú |
| CBC | veículo | 162.900 | 83.303 | 1.952 | 91 | HS Consórcios |

### Balde 3 — reprecificada (o defeito, em estado puro)

| adm / origem | crédito | prazo | parcela antes → depois | entrada antes → depois |
|---|---|---|---|---|
| Bradesco / CBC | 150.000 | 39 (igual) | 2.189 → 2.189 | 101.690 → 101.500 |
| Unicoob / CARTAS | 180.950 | 207 (igual) | 960 → 960 | 91.217 → **87.282** |
| Rodobens / CBC | 251.600 | 197 (igual) | 1.582 → 1.581 | 121.802 → 120.612 |

Mesmo bem, mesmo prazo, mesma parcela — só o preço andou.
O fp cheio muda e o contador bruto grita "carta nova". **A e B matam os três.**

### Balde 2 — tick de prazo (a fronteira entre A e B)

| adm / origem | crédito | prazo antes → depois | parcela | leitura |
|---|---|---|---|---|
| Mycon / PLAY | 45.174 | 70 → **69** | 608 → 608 | envelhecimento puro |
| Santander / PIFFER | 66.090 | 225 → **226** | 331 → 331 | prazo subiu: não é envelhecimento |
| Itaú / PLAY | 36.700 | 28 → **37** | 1.333 → 937 | plano genuinamente distinto |

**Dissecação do balde 2 inteiro (152 cartas em 2026-07-30):**

- **90 (59%)** com `|Δprazo| = 1` → envelhecimento
- **83 dessas 90 (55% do balde)** mantêm a **parcela idêntica** → assinatura de tick puro
- **62 (41%)** com `|Δprazo| > 1` → plano genuinamente distinto (Δ chega a 26)

## Recomendação: **variante B**

`fp_estrutural = tipo | credito | adm_real`

**Com números:**

| | erro residual/dia | % da própria série |
|---|---|---|
| A | sobreconta ~20 fp (envelhecimento vendido como novidade) | 8,1% |
| B | subconta ~14 fp (planos distintos de mesmo crédito) | 6,6% |

Ambas eliminam 100% das reprecificações (31,3% da bruta, ~112 fp/dia). O desempate:

1. **`qtd_parcelas` é atributo móvel por natureza** — decrementa todo mês. Qualquer contador
   ancorado nele herda um fluxo diário garantido de falso-positivo, que não some com o tempo.
   Crédito + tipo + administradora é a identidade estável da oferta do ponto de vista de quem compra.
2. **O erro de B é conservador** numa superfície pública: subcontar "novas hoje" não infla a vitrine.
   O erro de A infla — e "novidade" que na verdade é a mesma carta um mês mais velha é
   exatamente o tipo de afirmação que não se sustenta.
3. B tem menor erro absoluto **e** menor erro relativo.

**Refinamento opcional para a FASE B** (se o negócio quiser contar variantes de prazo):
usar A excluindo `|Δparcelas| = 1` com `valor_parcela` inalterado — recupera 83 dos 90 ticks
sem perder os 62 planos distintos. Custa uma comparação com a irmã estrutural anterior.

## Ressalva de alinhamento

A spec declara **6** administradoras não resolvidas; medido agora no xtv: **8**
(`REPASSE (CAPITAL DE GIRO)` 860, `PORTOAF` 183, `BBRASIL` 141, `''` 54, `ITAÚ - P` 46,
`ITAÚ - M` 42, `DAF` 5, `ITAU - P` 2) sobre 77 raws distintos, 1.333 linhas no fallback.
O fallback por cru normalizado cobre todas; `ITAÚ - P` e `ITAU - P` colapsam no mesmo
fingerprint, como exige o kit c.
