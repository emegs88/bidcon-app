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

---

# RESULTADO — ciclo de 2026-08-02 20:01 UTC

## Veredito: **FALHA no item 1 (eliminatório). PARADO.**

`sync_fim`: `total_ms=27282 fontes_ok=4 fontes_falha=1` — ~2× a faixa histórica
(12.008–15.035). Δ `ciclo_integridade_falhou` = **3**, não 0.

| fonte | divergências | varreu? | vivas antes→depois | cotas no payload |
|---|---|---|---|---|
| CARTAS | 0 | **sim** | 228 → **220** (8 órfãs) | 228 |
| CBC | **3** | não — AUTOCURA | 570 → 570 | 445 |
| PIFFER | **8** | não — AUTOCURA | 614 → 614 | 622 |
| PLAYCONTEMPLADAS | **2** | não — AUTOCURA | 1.079 → 1.079 | 1.081 |
| LANCE | — | pulado: `abaixo_do_piso: 44 < 50` | 64 → 64 | 0 |

## Causa-raiz: a quarentena de preço, invisível à checagem de integridade

**A correlação que abriu o caso:** `carta_nova` por fonte é CBC **3**, PIFFER **8**,
PLAY **2**, CARTAS **0** — **idêntico às divergências, fonte a fonte**. Cada carta
criada no ciclo produz exatamente uma divergência. CARTAS passou porque não criou nenhuma.

**Cadeia causal, verificada linha a linha:**

1. O feed entrega uma cota degenerada. Das 13 criadas, **13/13** têm anomalia visível:
   `entrada ≥ crédito` (49.900/53.393 · 79.372/82.967 · 136.450/**568.542**),
   parcela explodida (**114.200** · **104.161** · **96.910** · **31.489**),
   ou corrompida (parcela **9,00**).
2. `sync_aplicar_cotas` não acha candidata viva — as cópias anteriores estão todas
   `indisponivel`, e a candidata exige `status in ('disponivel','reservada')` (linha 35).
   Logo faz INSERT com `status='disponivel'` (linha 71).
3. `trg_bidcon_price` é **BEFORE INSERT**. `bidcon_price_calcular` roda a TIR e, se
   `v_tir is null or v_tir < 0.003 or v_tir > 0.30 or valor_entrada >= valor_credito`
   (linhas 16–17), executa:

   ```
   22:      if new.status = 'disponivel' then
   23:        new.status := 'indisponivel'; -- quarentena: degenerada, explodida ou corrompida não estreia nem retorna
   ```

   Idem no `exception when others` (linhas 34–35). **A linha nasce morta**, e
   `sincronizada_em` fica no instante do INSERT porque nada a atualizou depois.
4. `sync_varrer_ausentes` monta `entrante` do payload — a cota **está lá**, `n=1` — e
   `vivo` de `status in ('disponivel','reservada') and sincronizada_em >= ciclo_t0` —
   a linha nasceu `indisponivel`, `m=0`. **Divergência.**
5. `v_div > 0` → AUTOCURA: registra o evento, avança o estado e `return 0` **antes**
   de orfanizar.

Confirmação independente: reproduzi a checagem em leitura pura sobre o
`sync_snapshot_ciclo` da CBC — 3 fingerprints com `n=1, m=0` e **nenhum `n=0, m=1`**,
o que elimina a hipótese de fingerprint calculado diferente dos dois lados (essa daria
2 divergências por carta). E `criadas_vivas = 0`: as 13 nasceram todas em quarentena.

**Por que só agora.** A quarentena é anterior à fatia (teto de sanidade, 0042). A
checagem de integridade é nova, e ela assume que **toda cota entrante vira linha viva**.
Essa premissa é falsa desde sempre — nunca houve controle que a testasse. A fatia não
criou o defeito; criou o instrumento que o enxerga. É o oposto do n-v2.

`sync_aplicar_cotas` **não escreve `status` em lugar nenhum** — a única função do schema
inteiro que escreve `status='indisponivel'` é `sync_varrer_ausentes`. E `sync_alocar_numero`
só anula `numero_externo`. A hipótese de deslocamento está descartada.

## Corolário: motor de duplicata pré-existente

Uma cota em quarentena nunca volta a ser reivindicável (candidata exige viva). Toda vez
que reaparece no feed, novo INSERT, nova quarentena. Linhas com o mesmo fingerprint na
mesma fonte, **100% `indisponivel`**:

| fonte | fingerprint | linhas | desde |
|---|---|---|---|
| PIFFER | `b22893c1…` | **62** | 2026-07-22 |
| PIFFER | `6d66d0db…` | 34 | 2026-07-22 |
| PIFFER | `2683943890…` | 28 | 2026-07-27 |
| PLAY | `cd1187df…` | 14 | 2026-07-17 |
| CBC | `16beb48a…` / `bd56738e…` / `fd627f11…` | 7 cada | 2026-07-30 |

Parte do `94.760 total` contra `2.547 vivas`. **Não é causado pela fatia** — é revelado
por ela. Pendência **QUARENTENA-01**, fora da fatia.

## Reconciliação antes/depois — fecha exata

| medida | antes 19:28:12 | depois | Δ | explicação |
|---|---|---|---|---|
| `cartas` total | 94.747 | 94.760 | **+13** | as 13 criadas em quarentena |
| vivas (sync) | 2.555 | 2.547 | **−8** | orfanizações da CARTAS |
| fp vivos | 2.521 | 2.513 | −8 | idem |
| `vw_vitrine_viva` | 2.557 | 2.549 | −8 | idem |
| `eventos_sync` | 250.830 | 250.856 | **+26** | 13+8+3+1+1 = 26 ✔ |
| rebaixadas no ciclo | — | 21 | | 8 órfãs + 13 quarentenadas ✔ |
| `contador_novas_hoje` (B) | 0 | **0** | 0 | nenhuma nova viva |

Nenhuma linha sobra em nenhum dos lados.

## Julgamento item a item

| # | critério | resultado |
|---|---|---|
| 1 | Δ `ciclo_integridade_falhou` = 0 | **FALHA — 3.** Eliminatório → PARADO |
| 2 | orfanizações ≈ sumiços reais | **parcial** — só CARTAS varreu (8); as outras 3 não são julgáveis |
| 3 | contador sai do falso | **não exercitado** — zero novas vivas; segue 0 |
| 4 | 31 excedentes da PLAY colapsam | **não alcançado** — a varredura da PLAY se recusou |
| 5 | protegidas byte a byte | **PASS pela âncora §14.2.1** (`5c7819be…` idêntico); LANCE **não exercitável** |
| 6 | `trg_bidcon_price` só em INSERT/mudança real | **PASS estrutural** — interseção vazia com o UPDATE de reivindicação |
| 7 | `carta_nova`/`carta_indisponivel` 1:1 | **PASS** — 13 eventos ↔ 13 linhas criadas; 8 eventos ↔ 8 orfanizações |
| 8 | backfill em segundos, md5 comercial | **PASS** (passo 2) |

`md5_comerciais` mudou (`b6bcb039…` → `6236e920…`) — **esperado**: 13 linhas novas
entraram. A âncora do item 8 era a janela do backfill, já fechada verde no passo 2.

### Âncora da partição protegida — RETIFICADO (CORRECAO-1, item 4)

**A ressalva anterior era falsa e está retirada.** Com a expressão **canônica do
T7 §14.2.1**, o valor bate exato:

```sql
-- §14.2.1 — a ÚNICA expressão válida para o item 5. Expressão e valor andam juntos.
select count(*) linhas,
       md5(string_agg(
         id::text||'|'||coalesce(fonte,'')||'|'||coalesce(administradora_origem,'')||'|'||
         coalesce(numero_externo::text,'')||'|'||status::text||'|'||coalesce(tipo::text,'')||'|'||
         coalesce(valor_credito::text,'')||'|'||coalesce(valor_entrada::text,'')||'|'||
         coalesce(valor_parcela::text,'')||'|'||coalesce(qtd_parcelas::text,''),
         E'\n' order by id))
from cartas where fonte is distinct from '360prospere';
```

| momento | linhas | md5 |
|---|---|---|
| FASE A | 14 | `5c7819be56b9bc584b1704cf11047e96` |
| ANTES 19:28:12 | 14 | `5c7819be56b9bc584b1704cf11047e96` |
| **DEPOIS do ciclo 20:01** | **14** | **`5c7819be56b9bc584b1704cf11047e96`** ✓ |

**H-ÂNCORA: refutada.** A expressão canônica **não** contém `fingerprint` nem
`row_to_json` — só id, fonte, administradora_origem, numero_externo, status, tipo e os
quatro comerciais. O backfill do 0063 não a toca. A hipótese de que `5c7819be` fosse o
valor pré-backfill não se sustenta: ele é o valor pós-backfill também, porque a coluna
`fingerprint` nunca entrou na expressão.

**A causa real foi minha, e é de processo.** No DEPOIS usei uma expressão *ad-hoc*
(`id:status:numero_externo:sincronizada_em`) em vez de buscar a canônica. Agravante:
**este erro já tinha ocorrido antes nesta mesma sessão** — o falso alarme `ed49a932…` —
e naquela vez fui ao §14.2.1 e corrigi na hora. Na segunda vez não fui, e ainda declarei
a âncora "irreproduzível": uma confissão falsa sobre um controle íntegro, que teria
entrado no registro permanente.

Regra registrada: **antes de declarar um controle quebrado ou irreproduzível, buscar a
expressão canônica no artefato.** Um controle só é julgado pela expressão com que foi
ancorado. O §14.2.1 existe para matar expressão ad-hoc; funcionou nas duas vezes em que
foi consultado e só falhou quando não foi.

A prova direta abaixo permanece como confirmação independente:

- as **14** linhas seguem lá, todas `status='disponivel'`, números 9001–9013 + BIDCON_DIRETO;
- **`sincronizada_em IS NULL` nas 14** — todo caminho de sync escreve `sincronizada_em`,
  logo nenhuma foi tocada por sync alguma vez;
- **0 eventos_sync** referenciam qualquer uma das 14, em todo o histórico;
- estruturalmente, a orfanização filtra `fonte='360prospere'` e a lista branca não contém
  `Itaú` nem `BIDCON_DIRETO`.

Item 5, na parte protegida: **intacto**.

## Provas negativas do contrato novo

| prova | resultado |
|---|---|
| `sync_fonte_estado` avança além de 19:12:07 | **SIM** — CARTAS/CBC/PIFFER/PLAY em 20:01:3x–5x. Quem rodou foi a varredura nova |
| `varredura_legada_chamada` não aparece | **confirmado, zero** — o route não chama mais a sobrecarga de 2 args |
| `vivas_com_vinculo = 0` | caminho de proteção de vínculo **não exercitável** neste ciclo |

O contrato novo funcionou. O que falhou foi uma premissa que ele herdou.

## Estado em que fica

Nada foi corrigido a quente. O SHIM continua no lugar. As varreduras de CBC, PIFFER e
PLAY estão **se recusando a varrer** — e vão continuar se recusando a cada ciclo em que
a fonte entregar ao menos uma cota degenerada. É contenção, não conserto: nenhuma
duplicata é criada pela fatia, mas a orfanização dessas três fontes está parada.
