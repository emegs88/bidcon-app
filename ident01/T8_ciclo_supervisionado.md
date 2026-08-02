# T8 — Ciclo supervisionado (FASE B, passo 4)

> Critérios **pré-registrados** às 19:30 UTC, antes do tick das 20:00.
> Nada aqui foi ajustado depois de ver o resultado.

## Estado da execução

| passo | quando | resultado |
|---|---|---|
| (1) migration 0063 no xtv | 2026-08-02 ~19:10 UTC | `{"success":true}`; estado semeado 19:12:07 |
| (2) deploy route.ts | commit `488a11c`, READY **19:20:09 UTC** | verde, aliado a `app.bidcon.com.br` |
| (3) ciclo supervisionado | tick `0 * * * *` → **20:00 UTC** | pendente |

### Janela (1)→(2): fechada sem tick dentro

Cron é `0 * * * *`. Último tick antes da migration: **19:01**. Migration ~19:10,
route verde **19:20:09**. Próximo tick: 20:00.

**Zero ticks do cron caíram dentro da janela.** Logo nunca existiu "1º tick com
route velho + funções novas", e portanto não existe 2º tick inseguro. As duas
alavancas do ADENDO-5 — (a) `update sync_fonte_estado set ultima_varredura_em = now()`
e (b) pausar o cron — **não foram usadas**. Nenhuma escrita manual em
`sync_fonte_estado` foi feita em momento algum.

O tick das 20:00 é o **primeiro ciclo do contrato novo**, com route novo e
funções novas dos dois lados. É o ciclo julgado abaixo.

## Retrato ANTES — congelado em 2026-08-02 19:28:12 UTC

### Globais

| medida | valor |
|---|---|
| `cartas` total | 94.747 |
| vivas (fonte 360prospere) | 2.555 |
| fingerprints vivos distintos (global) | 2.521 |
| `vw_vitrine_viva` | 2.557 |
| `contador_novas_hoje(current_date)` (variante B) | **0** |
| `eventos_sync` total | 250.830 |
| último evento | 2026-08-02 19:01:59.639989+00 |
| md5 colunas comerciais | `b6bcb039c981d404d1279b21736b9b20` |
| partição protegida | 14 linhas / `5c7819be56b9bc584b1704cf11047e96` |
| vivas com vínculo ativo | **0** |

`vitrine 2.557` − `vivas_sync 2.555` = 2, que são as duas linhas vivas da
partição protegida (Itaú / BIDCON_DIRETO). Reconcilia exato.

### Por fonte

| origem | disp | resv | indisp | vivas | fp vivos | excedente | última sync |
|---|---|---|---|---|---|---|---|
| CARTAS | 228 | 0 | 13.583 | 228 | 228 | 0 | 2026-08-02 19:01:54 |
| CBC | 570 | 0 | 11.687 | 570 | 570 | 0 | 2026-08-02 19:01:52 |
| LANCE | 64 | 0 | 265 | 64 | 64 | 0 | **2026-07-31 18:00:31** |
| PIFFER | 614 | 0 | 20.940 | 614 | 614 | 0 | **2026-08-01 08:00:34** |
| PLAYCONTEMPLADAS | 1.079 | 0 | 45.703 | 1.079 | **1.048** | **31** | 2026-08-02 19:01:58 |

Soma de vivas = 2.555 ✔. Soma de `fp vivos` por fonte = 2.524, contra 2.521
distintos globais: **3 fingerprints existem em duas fontes ao mesmo tempo**.
Isso é D3 (estoque múltiplo legítimo entre fontes) e é inerte — a varredura é
por fonte e nunca cruza a fronteira. Registrado aqui para não ser lido como
anomalia no depois.

`sync_fonte_estado`: as 6 fontes em `2026-08-02 19:12:07.498917+00` (bootstrap
da migration, kit k — nunca `-infinity`). Como a última sync de carta foi 19:01,
**toda carta viva satisfaz `sincronizada_em < t0`** e é rerreivindicável no
primeiro ciclo do contrato novo. Re-claim é seguro por construção; é duplicata
que não é.

### Eventos nas 24 h anteriores

`carta_atualizada` 140, `sync_pulado` 50, `sync_fim` 24 —
**zero `carta_nova`, zero `carta_indisponivel`**. É o regime de feed quieto que
o ADENDO-5 formaliza, medido, não suposto.

## Fontes exercitáveis neste ciclo

| fonte | estado | consequência para o aceite |
|---|---|---|
| CARTAS | ativa | exercitável |
| CBC | ativa | exercitável |
| PLAYCONTEMPLADAS | ativa | exercitável — carrega as 31 excedentes (item 4) |
| LANCE | barrada por `SYNC_MIN_COTAS=50` (feed tem 44) | **não exercitável** salvo mudança do piso |
| PIFFER | parser cego ao formato novo | **não exercitável** — PIFFER-PARSER-01, fora da fatia |

## Critérios de aceite — pré-registrados

Os 8 itens do §14.2, adaptados pelo ADENDO-5.

| # | critério | como se mede | julgamento |
|---|---|---|---|
| 1 | Δ `ciclo_integridade_falhou` = **0** em todas as fontes | contagem do evento após 19:28:12 | **eliminatório** |
| 2 | orfanizações ≈ sumiços reais da fonte no ciclo | delta recíproco por fonte; faixa 650–1.740/dia **SUSPENSA** (feed quieto) | contra delta real |
| 3 | `contador_novas_hoje` sai do falso | valor B pós-ciclo; registrar o primeiro número real | contra delta real |
| 4 | 31 excedentes da PLAY colapsam; rebaixadas invisíveis voltam como NOVAS | `vivas − fp_vivos` da PLAY deve ir a 0 | esperado, não anomalia |
| 5 | LANCE novas reais, zero órfã de guarda; Itaú e BIDCON_DIRETO byte a byte | md5 protegidas == `5c7819be…` | protegidas eliminatório; LANCE condicionado ao piso |
| 6 | `trg_bidcon_price` só em INSERT/mudança real | ausência de disparo em reivindicação | ADENDO-4 |
| 7 | `carta_nova`/`carta_indisponivel` **1:1** com criações/orfanizações | contagem de evento vs delta de linhas | **eliminatório** |
| 8 | backfill em segundos, md5 comerciais idêntico | `b6bcb039…` sobreviveu | **já PASS no passo 2** |

Regra de guarda do ADENDO-5, literal: *ciclo quieto só é verde com item 1 e
item 7 provados — quieto sem prova é o n-v2.*

Provas negativas adicionais, do contrato novo:

- `sync_fonte_estado` tem de **avançar** para além de 19:12:07 — se não avançar,
  quem rodou foi o SHIM, não a varredura nova;
- `varredura_legada_chamada` **não pode aparecer** — se aparecer, o route ainda
  chama a sobrecarga de 2 args;
- `vivas_com_vinculo = 0` no ANTES ⇒ o caminho de proteção de vínculo
  **não é exercitável** neste ciclo. Registrado como tal, não como PASS.

## Item 6 — resolvido por estrutura, antes do ciclo (19:42 UTC)

Gatilhos vivos em `public.cartas`, lidos do banco:

```
trg_bidcon_price       BEFORE INSERT OR UPDATE OF
  valor_credito, valor_entrada, valor_parcela, qtd_parcelas, tipo, parcelas_detalhe
trg_cartas_fingerprint BEFORE INSERT OR UPDATE OF
  tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas,
  administradora_id, administradora_raw
```

UPDATE de reivindicação publicado (`sync_aplicar_cotas`, linhas 61–64):

```sql
update cartas set numero_externo=v_num,
  entrada_parceiro_raw=r.ep, administradora_raw=coalesce(r.adm_raw,administradora_raw),
  administradora_id=coalesce(v_adm_in,administradora_id), fornecedor_id=coalesce(fornecedor_id,v_forn_id),
  categoria=v_cat, sincronizada_em=v_now where id=v_cand;
```

**Contra `trg_bidcon_price`: interseção vazia.** Postgres decide o disparo pela
lista de colunas do comando, não pela mudança de valor. Logo o gatilho de preço
**não pode** disparar em reivindicação — item 6 é PASS por construção, não por
medição. O ADENDO-4 está publicado e funcionando.

**Contra `trg_cartas_fingerprint`: interseção `{administradora_id, administradora_raw}`.**
Esse gatilho **dispara** em toda reivindicação. Não é defeito, e não foi escondido:

- é D4 fazendo o trabalho dele — se a reivindicação toca a administradora, o
  fingerprint materializado tem de ser recomputado ou fica mentindo;
- e o recomputo é **idempotente aqui por invariante**: a candidata foi escolhida
  *porque* o fingerprint dela é igual ao da entrante, e o fingerprint entrante
  foi calculado a partir do mesmo `r.adm_raw` que o UPDATE grava. Recomputar
  devolve o mesmo valor.

Custo: um `md5` de concatenação por linha reivindicada — microssegundos, contra
os ~47 solves de TIR que o ADENDO-4 eliminou. Fica **registrado como observação**,
não como pendência. Se o `total_ms` do ciclo sair fora da faixa histórica, este é
o primeiro lugar a olhar.

Faixa histórica de duração (12 ciclos, 08:00–19:01): `total_ms` **12.008–15.035**,
mediana ~13.100, um outlier de 22.575 às 09:00. Sempre `fontes_ok=3 fontes_falha=2`
(LANCE e PIFFER caem os dois em `sync_pulado`, 2 por ciclo).

## Falha

Falha em qualquer item eliminatório → **PARAR**, não corrigir a quente.
O SHIM segura as varreduras legadas; diagnóstico primeiro.
