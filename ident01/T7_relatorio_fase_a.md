# IDENTIDADE-01 — RELATÓRIO FINAL DA FASE A

**Veredito: PASS integral.** Nenhuma escrita em produção. A FASE B segue travada pela frase.

- **xtv** `xtvjpnyadcdeadhmzyff` — produção, **somente leitura** durante toda a FASE A.
- **szs** `szsqdpwwxtmrtrhaikuh` — ensaio, escritas autorizadas.

Anexos: `T1_funcoes_corrigidas_szs.sql`, `T2_staging_szs.sql`, `T5_contador_d13.md`,
`T6_route_diff.md`, `T6_migration_fase_b_DRAFT.sql`.

---

## 1. Rótulos obrigatórios

**"Replay real reduzido por restrição de transporte"** (ADENDO-3). O replay real cobre
CARTAS + LANCE, 29/07→01/08. A evidência fica em três camadas, e nenhuma delas sozinha
sustenta a fatia:

1. **Algoritmo** — provado no replay matemático de 13 dias, todas as fontes, 15×.
2. **Implementação** — provada neste replay real (80 passos de ciclo) mais o kit sintético a–o.
3. **Escala plena** — só se confirma no ciclo supervisionado da FASE B.

**"Replay reconstruído do histórico persistido"** (spec). Ponto cego declarado e não
contornado: ciclos `sync_pulado` (353) e `sync_abortado` (92) não deixam catálogo e portanto
não entram na reconstrução.

**Declaração sobre `ciclo_t0`.** O motor usa `now()` da transação **do próprio ciclo**; o
timestamp histórico entra apenas como **rótulo no log**. O corte de presença e de ciclo usa o
**instante real de término**, nunca o rótulo. Isso é fiel à produção — lá o `t0` também nasce
do relógio do banco no momento da execução — e foi o que dissolveu a fronteira de minuto
(cartas 419572/563909 ressuscitando 13:01 sob rótulo 13:00).

---

## 2. Ratificações incorporadas

| Origem | Conteúdo | Onde entrou |
|---|---|---|
| ADENDO-1 | Legado 2-arg vira SHIM no-op: zeros, evento `varredura_legada_chamada`, zero escrita em `cartas` | T1 §11, kit **o**, draft §11 |
| ADENDO-2 / Q1 | Deslocamento cobre `disponivel`/`reservada`/`indisponivel`; **`vendida` jamais** — entrante fica sem número + evento `numero_retido` | `sync_alocar_numero`, draft §8 |
| ADENDO-2 / Q2 | Fallback de adm (SERVOPA) também na CTE `entrante` da varredura | `sync_varrer_ausentes` 3-arg, draft §10 |
| ADENDO-3 | Janela reduzida + aceite por reconciliação-razão exata | §4 e §5 |
| D15 (corrigido) | Objetos da fatia (não do gabarito): REVOKE de PUBLIC/anon/authenticated + GRANT a `service_role` | aplicado no szs; rodapé no draft §15 |
| Modelo de vida v2 | Multi-intervalo, "último evento vence" | T2 linha 26, reescrita |
| Transporte | Blocos com md5 nos **dois lados**; caminho de script local **retirado** — nenhuma credencial nova em lugar nenhum | §4 |

---

## 3. A causa nomeada — H1 confirmada, H2 refutada

O bloqueio do LANCE 1:1 não era ruído de transporte. Era defeito de derivação.

**H1 — CONFIRMADA.** A regra da linha 26 do T2 (derivação **v1**) declarava a carta morta no
**primeiro** `carta_indisponivel` e era cega a ressurreição. Isso explica exatamente os dois
subgrupos das 12 perdidas: 6 v1-mortas antes da janela (por isso ausentes do saldo de abertura)
e 6 ressuscitando via `carta_atualizada` dentro dela (que em v1 não é nascimento, logo não
gera delta).

**H2 — REFUTADA.** As cartas 37291/78703 ("mesma forma, destino diferente") **não** entraram
por irmã de tupla. Entraram pelo mesmo mecanismo de H1. A hipótese da irmã de tupla era
plausível e estava errada; fica registrada como refutada para não voltar como explicação.

**Medição da arquitetura, ao vivo (xtv):** vivas hoje com morte no histórico —
**LANCE 20/64 (31%)**, **CARTAS 33/228 (14,5%)**. O ponto cego v1 é material **nas duas fontes**.

### O controle funcionou

A exigência **LANCE 1:1 contra controle real** pegou um defeito que o critério interno dos
deltas jamais veria: sob v1, criações e orfanizações fechavam entre si perfeitamente — porque
ambas nasciam da mesma derivação errada. Só o confronto com o estoque vivo real denunciou.

**A ironia técnica que explica tudo:** a fonte saudável é a que o v1 falha. Churn recria linhas
novas, que o v1 enxerga; saúde preserva linhas antigas que ressuscitam, e essas o v1 não vê.
CARTAS "fechava exato" por churn, não por correção — e a certificação por md5 abaixo era
obrigatória, não formalidade.

---

## 4. Certificação da derivação (VIA 1)

**CARTAS — certificada sem retransporte.** Rederivação integral em v2 **dentro do xtv**
(catálogo, abertura, deltas da janela) e comparação por md5 contra a derivação v1 transportada:

- catálogo `93b6fd45…` · deltas `ccbed69f…` (md5 nos dois lados, no transporte)
- **controle de fechamento CARTAS: 228/228, md5 `64c0c9d71131af3c461ee00f8a2d961e`**

**LANCE — rederivada em v2 e retransportada.** A contagem esperada saiu **da derivação**, não
de chute. Presença reconstruída com o carry-forward corrigido, reconciliação refeita com corte
no instante real:

- **controle de fechamento LANCE: 64/64, md5 `771f01fd9c7354fb06c3a40149595514` — EXATO.**

**Partição protegida (D12), intocada:** md5 `85d89a059e35fc16ccc17d8bf6323fcd` idêntico antes e
depois do replay completo — 14 linhas, incluindo **6 com fingerprint colidindo** com cartas
vivas sincronizadas.

**Produto do replay:** md5 `674f4074d5f94e3d9e52f1960c45d9a2`.

**Universo de fingerprints do xtv, pré-migration:** md5 `4a4524e919b13e0893db29064216a627`
(94.747 linhas). Âncora para conferir o backfill da FASE B.

---

## 5. Replay real e o aceite do ADENDO-3

80 passos de ciclo, 36.269 ms, `pendentes = 0`. Motor retomável (`ensaio_replay_passo` sobre
`ensaio_replay_progresso`), uma procedure, **1 ciclo por transação com COMMIT isolado** — fiel
à produção. O motor sobreviveu a uma queda de transporte do MCP no meio do replay e retomou
sem reprocessar nada.

**Aceite ADENDO-3 — reconciliação-razão exata (substitui aqui a faixa 650–1.740):**

| Critério | Exigido | Obtido |
|---|---|---|
| Criações == deltas positivos, **por ciclo e por fonte** | igualdade exata | **1.408 == 1.408**, 0 ciclos divergentes em 80 |
| Orfanizações == deltas negativos, **por ciclo e por fonte** | igualdade exata | **1.116 == 1.116**, 0 ciclos divergentes em 80 |
| Duplicatas na vitrine simulada | zero | **zero** |
| Exceções de vínculo | listadas uma a uma | listadas (kit **e**) |
| LANCE 1:1 contra controle real | exato | **64/64 exato** |

A faixa de 650–1.740 órfãs/dia **migra para a linha de base do ciclo supervisionado da FASE B**,
conforme ratificado.

**Pré-requisito do T4 — reconciliação de fechamento POR FONTE**, com corte no timestamp do
último ciclo **de cada fonte** (não global) e contabilidade explícita de nascimentos, mortes
**e ressurreições**. Fechou nas duas fontes, sem diferença não explicada. A referência ingênua
de corte global (CARTAS fechando 336 > máximo da janela 294) confirmou-se como artefato do
corte: as ressurreições eram materiais, e passaram a ser contadas.

---

## 6. Kit de borda a–o — 19/19 PASS

| Item | O que prova | Obtido | |
|---|---|---|---|
| **a** | Invariância de posição com re-loteamento — teste-símbolo | novas=0 orfas=0 vivas=1200; alvo num 5→1006, lote 1→11, **mesmo id** | PASS |
| **b1** | Multiplicidade fatiada, 6 cópias em 2 lotes | N=6, novas=0, orfas=0, ids idênticos | PASS |
| **b2** | N cai 6→4 | orfas=2 exatas, 4 mantidas, nenhuma tocada à toa | PASS |
| **b3** | N sobe 4→7 | novas=3, orfanizadas **não** reivindicadas | PASS |
| **b-real** | Caso real da abertura: tupla idx 200, 4 cópias, trajetória 4→…→1 em 34 ciclos com 6 ciclos de contagem zero | 16 linhas == 16 deltas+, 15 indisp. == 15 deltas−, 1 viva, **1 fingerprint** (classe nunca funde nem parte) | PASS |
| **c** | `ITAU - P` / `  ITAÚ - P ` no mesmo ciclo | 1 classe, 2 cópias, fp `6b648f8a…` | PASS |
| **d** | 6 adms não resolvidas × 2 grafias, números idênticos | 6 classes de 2, adms distintas **nunca** se fundem | PASS |
| **e** | Reserva ativa / interesse vivo / controle sem vínculo | c1 e c2 vivas + `ausente_reservada`; c3 morre; orfas=1 | PASS |
| **f** | LANCE idêntica ao histórico | 40 ciclos, 0 divergências, 86==86, 22==22, 0 falhas de integridade | PASS |
| **f-aud** | Rastro 1:1 ao vivo | 3 novas→3 `carta_nova`; 2 órfãs→2 `carta_indisponivel` nos ids exatos | PASS |
| **g** | Isolamento D12 | md5 protegido idêntico; **11 chamadas fora da whitelist barradas** com `origem_invalida` | PASS |
| **h** | Troca de posição sob índice único parcial | 7↔8 sem violação, ambas vivas, 0 eventos | PASS |
| **i** | Lote perdido (100 de 1.215) | **não orfaniza** (0), registra `ciclo_integridade_falhou`, avança o estado (autocura) | PASS |
| **j** | Varredura ausente no ciclo N | ciclo N+1: novas=0, orfas=0, 0 divergências | PASS |
| **k** | Bootstrap com estado vazio — retrato do 1º ciclo real | novas=0, atualizadas=1200, orfas=0 | PASS |
| **l** | Modo avulso (array puro, `p_varrer=true`) | t0 do estado, 0 divergências, estado avança | PASS |
| **m** | Materialização | 25 amostras, 0 divergentes; `valor_entrada` troca o fp; reversível | PASS |
| **n** | Escala (ADENDO-3) | 1.200 cotas contra 2.608 linhas, mult. máx 6, **2.988 ms** (teto 30 s) | PASS |
| **o** | SHIM legado (ADENDO-1) | retorno 0, 1 evento, md5 de `cartas` inalterado | PASS |

Item **k** merece nota: é o retrato exato do primeiro ciclo da FASE B, quando
`sync_fonte_estado` estará vazio contra 94.747 linhas pré-existentes. Casou 1.200 de 1.200 sem
criar duplicata nem órfã indevida.

---

## 7. Custo medido do backfill — e a correção de uma estimativa errada

Isto é o achado de maior consequência prática do T6.

**A estimativa errada, que quase virou decisão.** `trg_bidcon_price` custa **392,2 ms/linha**
(275× o baseline, medido ao restaurá-lo de `D` para `O`). Projetado ingenuamente sobre 94.747
linhas: **≈ 10h19m** — número que justificaria desativar um trigger de precificação em
produção durante a migration.

**A medição que a derrubou.** `trg_bidcon_price` é declarado
`UPDATE OF valor_credito, valor_entrada, valor_parcela, qtd_parcelas, tipo`. Um UPDATE cuja
lista SET toca **apenas** `fingerprint` **não o dispara**. Provado empiricamente no szs:
backfill completo de 1.408 linhas, md5 das colunas de preço **byte a byte inalterado** antes e
depois.

| Medição | Valor |
|---|---|
| Escrita (szs, 1.408 linhas, backfill real) | **113,2 ms → 0,080 ms/linha** |
| Expressão (xtv, 94.747 linhas, leitura pura) | **736,1 ms → 0,0078 ms/linha** |
| **Projeção do backfill da FASE B** | **≈ 740 ms de CPU + ≈ 7,6 s de escrita ≈ 10 segundos** |

Uma transação. **Sem tocar no trigger de precificação.**

**Idempotência provada:** rerodar o backfill deixou o md5 dos fingerprints inalterado — o que
confirma, por caminho independente, que a materialização do trigger e a expressão explícita do
backfill concordam exatamente.

---

## 8. Alinhamentos de gabarito (xtv é o gabarito — D14)

**Confirmados idênticos:**

- `carta_fingerprint` no xtv é **byte a byte igual** ao szs: `md5(prosrc) = 2b59bc5723f6ad9856ea4958f4ad0450` (âncora D1).
- **Correção de crença anterior:** `sync_fonte_config` no xtv **tem** PLAYCONTEMPLADAS. São 7 linhas (360prospere, CARTAS, CBC, LANCE, PIFFER, PLAYCONTEMPLADAS, SERVOPA). A ausência que eu havia registrado era do szs.

**Divergências que a FASE B precisa tratar:**

| # | Achado | Consequência |
|---|---|---|
| 1 | **`unaccent` AUSENTE no xtv.** No szs vive em **`public`** (não `extensions`), e `cartas_fingerprint_trg` fixa `search_path` em `'public','pg_temp'` | `create extension … with schema public` **antes** de `adm_fingerprint_input`, ou o trigger lança 42883 em todo INSERT. Draft §1 |
| 2 | **`reservas_vitrine` não existe no xtv** | `carta_vinculo_ativo` **diverge deliberadamente** do ensaio: reescrita contra `reservas` (0036) + `interesses` + `processos`. Draft §3 |
| 3 | **`sync_alocar_numero` não existe no xtv** | precisa ser criada. Draft §8 |
| 4 | **`cartas.fingerprint` não existe no xtv** | coluna + trigger + backfill + índice parcial. Draft §4–§5 |
| 5 | **DEFEITO REAL — `vw_vitrine_viva`** calcula `carta_fingerprint(…, COALESCE(a.nome, c.administradora_raw, ''))` **inline, sem `adm_fingerprint_input`** | para adm não resolvida o fp da view diverge do fp do sync: uma reserva feita pela vitrine grava um fingerprint que nunca casa, e a carta **nunca é bloqueada**. Hoje: **1 viva de 2.569** (`ITAÚ - P`: view lê `ITAÚ - P`, coluna lê `itau - p`); 1.333 linhas históricas no ramo de fallback. Corrigido no draft §12 — a view passa a **ler a coluna** |
| 6 | **8 administradoras não resolvidas**, não 6 como a spec declarava | `REPASSE (CAPITAL DE GIRO)` 860, `PORTOAF` 183, `BBRASIL` 141, `''` 54, `ITAÚ - P` 46, `ITAÚ - M` 42, `DAF` 5, `ITAU - P` 2 — sobre 77 raws distintos, 1.333 linhas. O fallback cobre todas; `ITAÚ - P` e `ITAU - P` colapsam no mesmo fingerprint (kit **c**) |
| 7 | `unaccent(text)` é **STABLE**, e `adm_fingerprint_input` se declara **IMMUTABLE** | promessa excessiva. Só é segura porque o índice parcial indexa a **coluna materializada**, jamais a expressão. Registrado no draft |
| 8 | `sync_aplicar_cotas` casa candidatas **sem filtro de `fonte`** | o isolamento repousa em `administradora_origem` + whitelist D12. Provado contra 6 colisões deliberadas de fingerprint (kit **g**) |

**Numeração da migration:** `platform/supabase/migrations/` vai até **0062**; **0063 está
livre**. Há duplicatas históricas em 0023 e 0024, como a spec avisava.

---

## 9. Achados de instrumentação (para não voltarem como surpresa)

- **MCP não devolve `raise notice`.** Toda medição de tempo teve de ser reescrita como CTE que retorna linha.
- **Bug do harness:** `with ordinality` fora de lugar embaralhava a ordem do payload — corrigido antes do replay.
- **Colapso de timestamp:** o harness em transação única fazia todos os ciclos compartilharem `now()`. Foi o que motivou o motor de 1 ciclo por transação com COMMIT isolado.
- **Anomalia de cobertura em `eventos_sync`:** 684 linhas apagadas por resets ad-hoc de cenário durante a montagem. Não afeta o replay (que lê o catálogo derivado), mas invalida `eventos_sync` do szs como fonte histórica.
- **Camadas `carta_fingerprint` × `adm_fingerprint_input`:** a primeira **não** normaliza a adm; quem normaliza é a segunda. Todo chamador precisa passar pela segunda — foi exatamente o que a `vw_vitrine_viva` não fazia (§8 nº 5).
- **`numero_externo` NULL** em linhas do replay CARTAS — observado e não corrigido, porque é fiel ao histórico.

---

## 10. Contador da home (D13) — recomendação: **variante B**

Medido no xtv em leitura pura, 10 dias úteis (2026-07-20 → 07-31). Unidade: fingerprints
distintos que estreiam no dia, retrospecto de 14 dias.

| série | mín | máx | média | total |
|---|---|---|---|---|
| bruta (fp cheio) | 229 | 517 | 357,5 | 3.575 |
| A (`tipo\|credito\|qtd_parcelas\|adm`) | 132 | 369 | 245,7 | 2.457 |
| B (`tipo\|credito\|adm`) | 116 | 342 | 211,4 | 2.114 |

**Decomposição exata** (B ⟹ A por construção):

- nova real = **59,1%**
- tick de prazo = **9,6%**
- **reprecificada = 31,3%** — quase um terço do contador atual é a mesma carta com o preço andado.

Amostragem manual de 10 cartas (2026-07-30) no `T5_contador_d13.md`: 4 novas reais sem irmã
anterior; 3 reprecificações puras (mesmo bem, mesmo prazo, **mesma parcela**, só o preço mudou);
3 ticks de prazo. Dissecação do balde inteiro: 90 de 152 com `|Δprazo| = 1`, e 83 dessas com
**parcela idêntica** — assinatura inequívoca de envelhecimento.

**Por que B e não A:** `qtd_parcelas` decrementa todo mês por natureza, então qualquer contador
ancorado nele herda um fluxo diário garantido de falso-positivo que não some com o tempo. Além
disso o erro de B é **conservador** numa superfície pública — subcontar não infla a vitrine,
enquanto A vende como novidade a mesma carta um mês mais velha. B tem menor erro absoluto
(≈14 fp/dia contra ≈20) **e** menor erro relativo (6,6% contra 8,1%).

Refinamento opcional registrado no T5, caso o negócio queira contar variantes de prazo.

---

## 11. Diff do `route.ts` — menor do que a spec supunha

`platform/app/api/sync-cotas/route.ts`, 269 linhas. **Já está certo** o que se temia faltar:

- `TAMANHO_LOTE = 100` (D5) — lotes já implementados
- `p_varrer: false` em todo lote — nunca orfaniza dentro de lote
- varredura final **única**, com a lista completa
- isolamento try/catch por fonte, eventos `sync_pulado` / `sync_abortado` / `sync_fim`
- `maxDuration = 800`, `runtime = "nodejs"`

**Só duas coisas mudam:** (a) `ciclo_t0` não existe e precisa ser aberto **uma vez por fonte**
via `sync_ciclo_t0`; (b) a varredura manda `int[]` de números e precisa mandar o payload de
cotas — o casamento por fingerprint exige o payload para recomputar os fingerprints entrantes.

**`ciclo_t0` tem de vir do relógio do banco, não do Node.** Se o relógio do Node adiantar, uma
carta reivindicada no lote 1 (com `sincronizada_em` = `now()` do banco) ainda satisfaria
`sincronizada_em < t0` no lote 2 — e seria reivindicada duas vezes.

**Ordem de deploy é obrigatória e assimétrica:** migration **primeiro**, route depois. Migration
antes degrada graciosamente (as funções novas aceitam array puro); route antes lança 42883 em
**toda fonte, a cada hora**.

Risco residual declarado: o POST da varredura da PLAYCONTEMPLADAS cresce de ~10 KB para ~300 KB.

---

## 12. Estado do szs ao fim da FASE A

| | |
|---|---|
| `cartas` | 1.408 linhas — CARTAS 1.322, LANCE 86 |
| vivas | 292 |
| `fingerprint` nulos | **0** |
| `eventos_sync` | 1.889 |
| `sync_fonte_estado` | 3 linhas |
| `sync_snapshot_ciclo` | 97 |
| objetos `ensaio_*` | 19 (staging do replay, preservado) |
| `trg_bidcon_price` | **`O` — restaurado** |
| `trg_cartas_fingerprint` | `O` |

Limpeza D14 executada com guardas e pós-asserções; o trigger de precificação foi restaurado de
`D` para `O` e preencheu 10/10 colunas de preço na verificação. ACL da fatia fechada (D15):
REVOKE de PUBLIC/anon/authenticated, GRANT EXECUTE só a `service_role`; o trigger segue
disparando normalmente, porque EXECUTE não é checado no disparo.

Dados sintéticos marcados e removidos. A partição protegida do gabarito permanece byte a byte
intocada.

---

## 13. Fora da fatia (não tocado)

Arquivamento das ~90 mil órfãs (recomendação registrada: **arquivar** — preserva histórico de
preço) · backfill de embeddings · defeito de acento do `resolver_administradora` (pendência
junto a 0023_administradoras_v2/0023b) · ENSAIO-01.

---

## 14. O que a FASE B executaria

1. Aplicar `0063` no xtv (draft em `T6_migration_fase_b_DRAFT.sql`, 16 seções, RLS + rodapé de grants em tudo).
2. `analyze public.cartas`.
3. Deploy do `route.ts` na Vercel.
4. Um ciclo supervisionado, com a faixa 650–1.740 órfãs/dia como linha de base.
5. Confirmar `trg_bidcon_price` ainda em `tgenabled = 'O'`.

O draft está deliberadamente em `ident01/`, **fora de `supabase/migrations/`**, para não poder
ser aplicado por acidente. Cabeçalho: `*** DRAFT DA FASE B. NÃO APLICAR. ***`

---

**FASE A encerrada. Nada foi escrito em produção.**

A FASE B — migration no xtv e deploy do route.ts — só executa com a frase
**"AUTORIZO IDENTIDADE-01 FASE B"** digitada por Emerson nesta sessão.
