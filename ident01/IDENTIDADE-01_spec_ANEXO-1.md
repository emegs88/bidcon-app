ANEXO-1 da spec IDENTIDADE-01 — continuação append-only; a spec original permanece congelada (sha256 959d…c436cb1). Este anexo tem hash próprio, conferido externamente.

---

## 0. Natureza deste arquivo

A spec `ident01/IDENTIDADE-01_spec.md` declara-se "fonte de verdade desta
fatia" e está **congelada**: seu sha256 entra no checklist de boot e mexer no
arquivo invalidaria a conferência de todos que o citam. Decisões e mudanças de
estado posteriores à v2 entram **aqui**, por acréscimo, nunca por edição da
spec.

Este anexo é **append-only**, pela mesma norma da seção de regras do
`CLAUDE.md`: item novo entra no fim com o próximo número; item revogado fica
no lugar, marcado `REVOGADO` + motivo + data; número não é reciclado.

---

## 1. FASE B — **CONSUMIDA**

A spec (governança, item 3) trata a FASE B como futura, condicionada à frase
`AUTORIZO IDENTIDADE-01 FASE B`. **Ela já foi aplicada.** O portão está
gasto — não é um gate aberto esperando frase.

Medido ao vivo no xtv (`xtvjpnyadcdeadhmzyff`) em 02/08/2026:

```
version          | name
20260802191207   | 0063_identidade_estavel_fingerprint
```

```
col_fingerprint   1      fn_ciclo_t0        1
trigger_fp        1      tb_fonte_estado    1
fn_adm_fp         1      tb_snapshot        1
fn_vinculo        1      ext_unaccent       1

cartas_total     94825
cartas_com_fp    94825      <- backfill completo
```

- **Backfill completo**: 94.825/94.825. A spec previa 94.747 linhas; a
  diferença é **crescimento de estoque** entre a estimativa e a aplicação,
  não divergência de escopo.
- **`vw_vitrine_viva` lê a coluna**: a definição vigente projeta
  `c.fingerprint` e casa reserva por `r.fingerprint = c.fingerprint`.
- **Route com envelope no ar** (declarado pela arquitetura).
- **SHIM ATIVO** — o drop do shim segue **pendente de dois ciclos
  supervisionados verdes** (declarado pela arquitetura; não medido neste
  anexo). Nenhuma migration desta fatia toca no shim.

---

## 2. D16 — INTEGRIDADE POR PEGADA

*Verbatim de `ident01/CORRECAO-1_d16_d17_NAO_APLICAR.sql`, §D16.*

> **DEFEITO** (reproduzido no szs, kit q-repro): a checagem de integridade de
> `sync_varrer_ausentes` conta, do lado `vivo`, apenas linhas com
> `status in ('disponivel','reservada')`. Uma cota que nasce QUARENTENADA —
> `trg_bidcon_price` é BEFORE INSERT e muta `NEW.status` para `'indisponivel'`
> quando o preço é degenerado (entrada >= crédito, parcela explodida;
> migration `0034_quarentena_insert_degenerado.sql`) — foi aplicada de
> verdade, existe como linha, mas não é contada. O payload diz n=1, o lado
> vivo diz m=0, v_div>0, e a função entra no ramo de AUTOCURA: loga
> `ciclo_integridade_falhou`, avança `sync_fonte_estado` e `return 0` ANTES de
> orfanizar. Resultado: uma única cota degenerada no payload PARALISA a
> varredura inteira daquela fonte, e as ausentes reais do ciclo sobrevivem
> indevidamente. É o que segura a varredura em produção hoje.
>
> **CORREÇÃO**: `m` = linhas da fonte com `sincronizada_em >= ciclo_t0`, SEM
> filtro de status. O critério deixa de ser "está vendável" e passa a ser
> "foi tocada neste ciclo" — PEGADA. Uma linha quarentenada tem
> `sincronizada_em` carimbado (o trigger muta status, não o timestamp), logo
> deixa pegada e passa a contar.
>
> **POR QUE A CLASSE n-v2 (LOTE PERDIDO) CONTINUA SENDO PEGA** — a pergunta
> decisiva, e ela foi MEDIDA, não argumentada. Uma linha que o ciclo não
> tocou não recebe `sincronizada_em` novo; fica com o timestamp do ciclo
> anterior; `sincronizada_em >= ciclo_t0` é falso; ela não entra em `m`.
> Portanto lote perdido AINDA diverge. Prova no szs (kit i-d16): catálogo
> completo de 120 cotas contra 110 linhas carimbadas (lote de 10 retido) →
> exatamente 1 evento `ciclo_integridade_falhou` com divergencias=10,
> orfanizadas=0, 120 vivas / 0 mortas, 110 com pegada / 10 sem pegada.

Relação com a **D11** da spec: a D11 continua governando **casamento,
reivindicação e orfanização** (viva = `disponivel`/`reservada`). A D16 muda
**apenas o lado `m` da checagem de integridade**. Não é reabertura da D11.

---

## 3. D17 — CONTADOR: QUARENTENADA NÃO É ESTREIA

*Verbatim de `ident01/CORRECAO-1_d16_d17_NAO_APLICAR.sql`, §D17.1–§D17.3.*

> **§D17.1 — DEFEITO.** O caminho de nascimento em `sync_aplicar_cotas` insere
> a linha e emite `'carta_nova'` INCONDICIONALMENTE, com `push_pendente=true`.
> Mas `trg_bidcon_price` é BEFORE INSERT: quando o preço é degenerado ele muta
> `NEW.status` para `'indisponivel'` e a linha NASCE MORTA. O evento sai mesmo
> assim. Duas consequências, ambas reais:
>   - **(a) CONTAGEM** — `app/api/vitrine/route.ts:133` calcula `novas_hoje`
>     contando `eventos_sync where tipo='carta_nova' e em >= hoje`. Corpos que
>     nunca estiveram à venda entram como "novidade" da vitrine.
>   - **(b) PUSH** — `push_pendente=true` põe a natimorta na fila de push. Uma
>     carta `indisponivel` pode ser anunciada como novidade ao cliente. Isto
>     NÃO estava nomeado na CORRECAO-1; foi achado ao instrumentar o D17 e vai
>     fechado junto, porque é a MESMA linha de código.
>
> **§D17.2 — CORREÇÃO.** `RETURNING` em Postgres devolve a linha COMO
> INSERIDA, isto é, DEPOIS de os triggers BEFORE ROW terem mexido em NEW.
> Então `returning id, status` entrega o status REAL de nascimento, sem SELECT
> extra e sem custo. A partir dele:
>   - nasceu `'disponivel'` → `v_novas+1` e evento `'carta_nova'` (push true);
>   - nasceu qualquer outra coisa → NÃO conta, NÃO emite `'carta_nova'`, e
>     emite **`'carta_nova_quarentenada'` com `push_pendente=false`**.
>
> **§D17.3 — POR QUE UM EVENTO NOVO, E NÃO SIMPLESMENTE NENHUM.** Suprimir o
> evento apagaria o rastro do corpo — e esse rastro é justamente o exhibit da
> fatia QUARENTENA-01 (b22893c1, 62 corpos). O nascimento continua registrado,
> com `carta_id`, só deixa de ser classificado como estreia. Isto também
> PRESERVA o item 7 da aceitação (§14.2, eliminatório: eventos 1:1): a relação
> continua um nascimento = um evento, agora de dois tipos, e a identidade
> `novas == count(carta_nova)` fica MAIS estrita do que hoje, não menos.
> Declarado aqui porque item eliminatório não se redefine em silêncio.
>
> `eventos_sync.tipo` é `text` sem check constraint (verificado no xtv), então
> o tipo novo não exige `ALTER TYPE` nem migration de enum.

**Estado medido em 02/08/2026, antes da aplicação:** `carta_nova_quarentenada`
**não existe** no xtv — contagem zero em `eventos_sync`. É o esperado: a D17
ainda não foi aplicada. Qualquer relato de eventos desse tipo antes da
aplicação é falso (ver item 4).

---

## 4. NOTA — **não existe D18**

Não há decisão D18 nesta fatia. A spec vai até D15; este anexo acrescenta D16
e D17. **Qualquer referência a um "D18" vem do relatório fictício de
02/08/2026** — narrativa de execução sem medição, refutada pelo banco e
registrada no diário de bordo.

Registro do incidente: `ident01/CORRECAO-2_estado_real_NAO_APLICAR.md`
(medições cruas, tabela de reconciliação e os dois padrões de erro nomeados) e
`docs/DIARIO-BORDO.md`.

---

## 5. PORTÕES ABERTOS — nesta ordem

**1º · `AUTORIZO IDENTIDADE-01 CORRECAO-2`**
Escopo: view com `id` + `security_invoker` (invoker **pela arquitetura**) +
diff da app, itens 2–6.
Artefatos, commit `b8760b4` (no origin):
`ident01/CORRECAO-2_view_NAO_APLICAR.sql` e `ident01/CORRECAO-2_diff_app.md`,
ambos com header "CONSTRUÍDO DO ZERO pós-incidente 02/08".

> *Referência cruzada obrigatória, medida em 02/08 e registrada no §4 do SQL:*
> `reservas` tem RLS habilitada e **nenhuma política**. Com
> `security_invoker=on`, o `NOT EXISTS (select 1 from reservas …)` de
> `vw_vitrine_viva` passa a enxergar zero linhas e volta sempre verdadeiro —
> carta reservada reaparece na vitrine. Hoje `reservas_ativas = 0`, logo o
> efeito é **latente**, não ativo. Fica registrado para que a decisão da
> arquitetura seja tomada com o número na mão.

**2º · `AUTORIZO IDENTIDADE-01 CORRECAO-1`**
Escopo: D16 + D17.
Draft no origin: `ident01/CORRECAO-1_d16_d17_NAO_APLICAR.sql`.
Ensaiado no szs, sete itens `pass=true` em `kit_resultado`:
`q0`, `q-repro`, `q-pos`, `i-d16`, `j-d16` (D16); `r1-r2-d17`, `r3-d16-d17`
(D17). O `r3` rodou com D16 e D17 **juntas**, que é a combinação entregue.
O item `n-v2` consta `pass=false` e está **REVOGADO** no próprio registro
(defeito de t0 do harness → verde falso), substituído por `n-v3` (`pass=true`).

**Numeração:** nenhum dos dois nasce numerado. A **primeira frase que chegar
leva o número livre seguinte**; a segunda, o próximo (`CLAUDE.md`, Regra 5).

**DIVISÃO DE MÃOS (decisão de 02/08):** as **frases de migration são digitadas
na ARQUITETURA**, que executa a aplicação em produção. Este canal não recebe
frase de autorização de migration — nem completa nem de uma linha. **Repo, app
e artefatos** continuam nesta mão.

---

## 6. REGRA ZERO

`REGRA ZERO` está gravada como **Regra 6** do `CLAUDE.md`: relato de execução
sem a saída CRUA da ferramenta na mesma mensagem = **NÃO ACONTECEU**. Um ato
por mensagem; executa → cola cru → re-mede → PARA.

A seção de regras do `CLAUDE.md` é **APPEND-ONLY, nunca renumerar** — diários
e relatórios citam regra por número.

Origem: incidentes de narrativa de 02/08/2026, registrados no diário de bordo.

---

## 7. FORA DA FATIA (nomeadas, não abertas)

`QUARENTENA-01` · `REF-01` · `ENSAIO-01` · `PIFFER-PARSER-01` · `PRICE-01`

Pendências registradas no aterramento de 02/08 e ainda sem fatia:
`administradora_origem` tem nome enganoso (contém **fornecedor**, não
administradora — LANCE é fornecedor; as cartas são **HS Consórcios**);
fornecedor dividido entre `360prospere (legado)` e `LANCE`; 54 linhas sem
`administradora_id`.

Levantada em 02/08 e ainda sem destino: o repositório **`emegs88/360prospere`**
(app separado, não toca o schema `cartas`) gera identidade por posição em
`app/api/cotas-extra/route.js:330` — `id: i + 1`, índice do array. Mesma classe
da D1, superfície distinta.

=== FIM DO ANEXO-1 ===
