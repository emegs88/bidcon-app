# LEDGER-RECONCILIACAO-01 — o ledger do xtv contra os arquivos do repo

**Projeto:** xtv (`xtvjpnyadcdeadhmzyff`) — vitrine em produção.
**Medido em:** 17/08/2026.
**Natureza:** DOCUMENTO. Não é migration, não aplica nada, não corrige nada.
**APPEND-ONLY.** Linha escrita aqui não se reescreve. Se uma linha estiver
errada, a correção entra como linha NOVA, datada, dizendo qual linha ela
corrige. O ledger do banco também não se reescreve — ver "O que este
documento NÃO autoriza", no fim.

---

## COMO FOI MEDIDO (para quem quiser refazer)

Três medições independentes, nesta ordem:

1. **O ledger**, direto do banco:
   `select version, name from supabase_migrations.schema_migrations order by version;`
   → 87 entradas.

2. **Os arquivos**, varridos em TODOS os refs (locais e `origin/`), não só na
   main — porque arquivo que ainda está num ramo aberto não é arquivo ausente:
   `git for-each-ref refs/heads refs/remotes/origin` + `git ls-tree -r` em
   `platform/supabase/migrations/`
   → 65 nomes distintos.

3. **O pareamento**, por ASSUNTO e não por nome: de cada lado se remove o
   prefixo `^[0-9]{4}[ab]?_` e se casa o que sobra. Isso encontra o par quando
   só o número mudou — que é a maioria dos casos. Os pares que o casamento
   automático NÃO pegou foram conferidos À MÃO, lendo o cabeçalho do arquivo, e
   estão marcados como tal.

**Ausência sozinha não prova nada.** Onde este documento diz "aplicada", há
prova no dado, não só entrada no ledger — ver linha L-0080-A.

---

## BLOCO 0 — CORREÇÃO DA PREMISSA DA ORDEM

A ordem que gerou este documento dizia: *"quatro entradas aplicadas sem arquivo
em ramo nenhum (`0083a_sentinela_dedup_enum`, `0081a_sentinela_status_novos`,
`0080_fidc_comissao_not_null`, `0073_farol_pauta_aprovacao`) e dois pares de
número repetido (dois 0080, dois 0073)."*

A medição diz outra coisa, em três pontos:

| o que a ordem supunha | o que a medição achou |
|---|---|
| 4 entradas sem arquivo | **39** entradas sem arquivo. Das 4 nomeadas, **3 TÊM arquivo** — ver L-0081-A, L-0083-A, L-0080-B. Só `0073_farol_pauta_aprovacao` é órfã de verdade. |
| 2 pares de número repetido | **11** pares: **7 colisões** (assuntos diferentes no mesmo número) + **4 divisões a/b** (mesmo assunto partido). |
| 2 divisões a/b | **4** divisões. O motivo do `ALTER TYPE` vale para **2** delas (0081, 0083) — está escrito nos próprios arquivos. Para 0023 e 0024 **não há motivo medido**, e este documento não inventa um. |

Registro do meu próprio erro: eu carreguei a lista das "4 órfãs" de sessão
anterior e a repeti sem conferir contra os arquivos. Três dos quatro nomes
tinham arquivo o tempo todo. Anotação velha tratada como medição — o mesmo
defeito que o `guarda-ramo` existe para pegar.

---

## BLOCO 1 — AS QUATRO ENTRADAS NOMEADAS NA ORDEM

Uma linha por entrada: número no ledger · arquivo correspondente ou ausência
declarada · motivo.

**L-0083-A** · `0083a_sentinela_dedup_enum` @ 20260816190104 ·
**TEM ARQUIVO**: `0083_sentinela_dedup_telefone.sql` ·
*Motivo:* não é órfã — é a **primeira metade** de um arquivo único, e o próprio
arquivo diz isso na linha 12: *"0083a — só o `alter type ... add value` da seção
1, commitado sozinho"*. O apply foi partido; o arquivo não.

**L-0081-A** · `0081a_sentinela_status_novos` @ 20260816181108 ·
**TEM ARQUIVO**: `0081_sentinela_toque_por_linha.sql` ·
*Motivo:* idem. O arquivo declara na linha 14: *"0081a — só os três `alter type
... add value` (linhas 59-61), commitados"*, e explica por que não virou dois
arquivos: *"partir em dois arquivos faria a numeração mentir sobre quantas
migrações existem"*.

**L-0080-B** · `0080_fidc_comissao_not_null` @ 20260815202017 ·
**TEM ARQUIVO**: `0080_fidc_comissao_decidida.sql` ·
*Motivo:* deriva de NOME, não ausência. O casamento automático não pegou porque
o assunto difere (`not_null` × `decidida`). Conferido à mão: o cabeçalho do
arquivo fecha a DECISÃO 2 de 15/08/2026 — mesma data do `version`. O apply foi
nomeado pelo efeito técnico (tornar as colunas NOT NULL), o arquivo pelo motivo
de negócio. São a mesma migração.

**L-0073-A** · `0073_farol_pauta_aprovacao` @ 20260809115931 ·
**AUSÊNCIA DECLARADA** — nenhum arquivo, em nenhum ramo, sob nenhum nome ·
*Motivo:* **não determinado pela medição.** Foi aplicada em 09/08/2026 11:59:31,
1h35 antes de `0073_farol_olheiro` (que TEM arquivo) tomar o mesmo número. Esta é
a única das quatro que é órfã de verdade.

---

## BLOCO 2 — AS DIVISÕES a/b, COM O MOTIVO REAL

O Postgres não aceita `ALTER TYPE ... ADD VALUE` e o **uso** do valor novo na
mesma transação. Quem tenta leva
`unsafe use of new value ... of enum type` (55P03). Por isso o apply de uma
migration que acrescenta valor de enum E já usa esse valor tem de ser partido em
dois commits: o `a` acrescenta e commita; o `b` usa.

Isso é **defeito do banco, não do arquivo**. Por decisão registrada nos próprios
arquivos, o repo mantém UM arquivo por migration, porque partir em dois faria a
numeração mentir sobre quantas migrações existem.

**L-DIV-0081** · `0081a` + `0081b` → um arquivo, `0081_sentinela_toque_por_linha.sql` ·
*Motivo:* MEDIDO — três `alter type sentinela_status add value if not exists`
(linhas 78–80) seguidos de uso nas seções posteriores.

**L-DIV-0083** · `0083a` + `0083b` → um arquivo, `0083_sentinela_dedup_telefone.sql` ·
*Motivo:* MEDIDO — seção 1 é o `add value`, seções 2+ usam.

**L-DIV-0023** · `0023_administradoras_v2` + `0023b_fallback_so_fonte_mono` ·
*Motivo:* **não determinado.** Ambas sem arquivo. Aplicadas com 42 segundos de
diferença. O motivo do `ALTER TYPE` **não foi verificado aqui** e não se
presume.

**L-DIV-0024** · `0024b_colunas_bidcon_price` + `0024_bidcon_price_trigger` ·
*Motivo:* **não determinado.** O `b` foi aplicado **ANTES** do base (10:06:36
contra 10:09:53), o que é ordem invertida em relação a 0081/0083. Ambas sem
arquivo.

---

## BLOCO 3 — NÚMEROS REPETIDOS

### Colisões de verdade (assuntos diferentes disputando o mesmo número): 7

**L-COL-0039** · `0039_api_cartas_publicas` @20260711003700 × `0039_fornecedores_sync_config_acesso_privado` @20260724153118 · 13 dias de distância · nenhuma das duas tem arquivo.
**L-COL-0040** · `0040_quarentena_cobre_update` @20260711171003 × `0040_cartas_parcelas_detalhe_jsonb` @20260724153719 · nenhuma tem arquivo.
**L-COL-0043** · `0043_busca_bidcon_price` @20260711235700 × `0043_bidcon_price_parcelas_detalhe` @20260724160504 · nenhuma tem arquivo.
**L-COL-0047** · `0047_whatsapp_envio` @20260712205801 × `0047_sync_identidade_estavel` @20260716191849 · a segunda TEM arquivo, renumerado para `0050_sync_identidade_estavel.sql`; a primeira não tem.
**L-COL-0048** · `0048_whatsapp_f3` @20260712205818 × `0048_cartas_vitrine_publica` @20260716191931 · a segunda TEM arquivo, renumerado para `0051_cartas_vitrine_publica.sql`; a primeira não tem.
**L-COL-0073** · `0073_farol_pauta_aprovacao` @20260809115931 × `0073_farol_olheiro` @20260809133448 · 1h35 de distância · a segunda tem arquivo, a primeira não (L-0073-A).
**L-COL-0080** · `0080_administradoras_grafias_orfas` @20260813200250 × `0080_fidc_comissao_not_null` @20260815202017 · **as duas têm arquivo** — e é essa colisão que o rename de hoje resolveu (L-0080-A).

*Motivo comum, MEDIDO:* nos pares 0039/0040/0043/0047/0048 a segunda entrada
chega 4 a 13 dias depois da primeira, em bloco. É o padrão de quem retomou a
numeração de um ponto anterior. Por que, não está determinado.

### Divisões a/b (mesmo assunto, número compartilhado de propósito): 4
0023, 0024, 0081, 0083 — ver BLOCO 2.

---

## BLOCO 4 — ENTRADAS QUE TÊM ARQUIVO COM OUTRO NOME (13)

Estas **não são órfãs**. O nome no ledger é o nome do apply; o nome no repo é o
do arquivo. Divergiram e ninguém reconciliou. Ficam registradas para que a
próxima busca por "cadê o arquivo da X" termine aqui.

| ledger | arquivo no repo | como foi casado |
|---|---|---|
| `0080_administradoras_grafias_orfas` | `0085_administradoras_grafias_orfas.sql` | renomeado em 17/08/2026 (L-0080-A) |
| `0047_sync_identidade_estavel` | `0050_sync_identidade_estavel.sql` | assunto |
| `0048_cartas_vitrine_publica` | `0051_cartas_vitrine_publica.sql` | assunto |
| `repasse_capgiro_categoria` | `0056_repasse_capgiro_categoria.sql` | assunto |
| `vw_sync_possiveis_duplicatas` | `0059_vw_sync_possiveis_duplicatas.sql` | assunto |
| `vw_carousel_cartas_agio120` | `0060_vw_carousel_cartas_agio120.sql` | assunto |
| `conversas_status_permite_humano` | `0061_conversas_status_humano.sql` | **à mão** — assunto difere por uma palavra; conferido lendo o cabeçalho |
| `insta_canal` | `0067_insta_canal.sql` | assunto |
| `farol_posts` | `0068_farol_posts.sql` | assunto |
| `farol_pauta` | `0071_farol_pauta.sql` | assunto |
| `0081b_sentinela_toque_por_linha` | `0081_sentinela_toque_por_linha.sql` | assunto (metade b — BLOCO 2) |
| `0083b_sentinela_dedup_telefone` | `0083_sentinela_dedup_telefone.sql` | assunto (metade b — BLOCO 2) |
| `0080_fidc_comissao_not_null` | `0080_fidc_comissao_decidida.sql` | **à mão** — assunto difere; conferido lendo o cabeçalho (L-0080-B) |

*Motivo comum, MEDIDO:* sete delas (`repasse_capgiro`, `vw_sync`, `vw_carousel`,
`conversas_status`, `insta_canal`, `farol_posts`, `farol_pauta`) entraram no
ledger **sem número** e ganharam número só quando viraram arquivo. Isso é a
assinatura de apply feito direto por MCP/painel: o `name` do apply é o assunto,
sem prefixo. O arquivo veio depois, para o repo.

---

## BLOCO 5 — AUSÊNCIA DECLARADA: 39 ENTRADAS SEM ARQUIVO EM RAMO NENHUM

Aplicadas em produção. Nenhum arquivo, em nenhum ramo, sob nenhum nome.
*Motivo, quando não escrito, é `não determinado pela medição` — e fica assim
até alguém que estava lá dizer.*

**Numeradas (26)** — tiveram número, logo é provável que tenha existido arquivo
que nunca foi commitado. Isso é INFERÊNCIA pelo formato do nome, não medição:

`0019_interesses` @20260705140817 · `0020_conversas` @20260705140829 ·
`0021_parceiros` @20260705140839 · `0022_hardening_xtv` @20260705182751 ·
`0026_administradoras_aliases` @20260708201838 · `0027_sync_lotes` @20260708222202 ·
`0028_administradoras_play` @20260708202954 · `0029_administradoras_rs` @20260708205031 ·
`0030_drop_indice_global_numero` @20260708215653 · `0031_rls_bkp_e_sync_config` @20260709110301 ·
`0039_api_cartas_publicas` @20260711003700 · `0039_fornecedores_sync_config_acesso_privado` @20260724153118 ·
`0040_quarentena_cobre_update` @20260711171003 · `0040_cartas_parcelas_detalhe_jsonb` @20260724153719 ·
`0041_vitrine_anon_select` @20260711203803 · `0042_teto_sanidade` @20260711235258 ·
`0043_busca_bidcon_price` @20260711235700 · `0043_bidcon_price_parcelas_detalhe` @20260724160504 ·
`0044_refs_curadoria` @20260712012755 · `0047_whatsapp_envio` @20260712205801 ·
`0048_whatsapp_f3` @20260712205818 · `0049_vw_carousel_cartas` @20260714215640 ·
`0063_identidade_estavel_fingerprint` @20260802191207 · `0064_correcao2_view_id_invoker` @20260803013639 ·
`0065_correcao1_d16_d17` @20260803181037 · `0073_farol_pauta_aprovacao` @20260809115931

> Nota: `0064_correcao2_view_id_invoker` e `0065_correcao1_d16_d17` têm parentes
> em `ident01/` (`CORRECAO-2_view_NAO_APLICAR.sql`,
> `CORRECAO-1_d16_d17_NAO_APLICAR.sql`). São rascunhos marcados NÃO APLICAR,
> **não** o arquivo aplicado, e por isso não contam como par. Fica registrado
> que o parente existe.

**Sem número (13)** — assinatura de apply direto por MCP/painel:

`syncfix_xtv_multifonte` @20260705192301 · `syncfix_rpc_security_definer` @20260705210206 ·
`criar_view_leads_inativos` @20260705230729 · `consorcios_schema_multi_administradora` @20260715011021 ·
`consorcios_vw_join_normalizado` @20260715012359 · `consorcios_norm_codigo_search_path` @20260715012455 ·
`consorcios_vw_lances_historico_v2` @20260715012835 · `rpc_consorcios_grupos_calibrados` @20260715020047 ·
`consorcios_comissoes_multi_administradora` @20260728204311 · `create_farol_log` @20260803014919 ·
`wa_touch_atualizado_em` @20260804174323 · `wa_atendente_campos_handoff` @20260804174501 ·
`price01_bidcon_price_config_e_views` @20260805140227

*Motivo, INFERIDO do padrão de nome e não medido:* apply por
`mcp.apply_migration`, cujo `name` é escrito à mão na hora. Seis dos nomes
começam com `consorcios_`, o que sugere um bloco de trabalho inteiro feito assim.

---

## BLOCO 6 — O CAMINHO INVERSO: ARQUIVO SEM ENTRADA NO LEDGER DO XTV (21)

**17 deles estão no ledger do NNV, não do xtv.** `0001_schema` … `0017_repasse`
vivem em `platform/supabase/migrations/` (a pasta do xtv) mas foram aplicados no
nnv (`nnvjeijsrwpzsggwqpcu`), onde aparecem no ledger com `version` de 0001 a
0015 e `20260704023421`/`20260704132129` para 0016/0017. **Não são órfãos: estão
na pasta errada.** Este documento só registra; mover arquivo aplicado é ato, e
ato não se toma dentro de um documento.

**4 restantes:**

**L-ARQ-0026** · `0026_profile_cpf.sql` · sem entrada no ledger do xtv **e** sem
entrada no do nnv · *Motivo:* **MEDIDO em 17/08/2026 — o efeito está aplicado no
nnv e não foi registrado em ledger nenhum.** É a única linha deste documento com
esse formato, e por isso ela é uma CLASSE NOVA, não mais um caso da lista acima.

As quatro medições, para quem quiser refazer:

| pergunta | comando | resultado |
|---|---|---|
| a coluna existe no nnv? | `information_schema.columns where column_name ilike '%cpf%'` (nnv) | **sim** — `profiles.cpf text` (e mais 3: `kyc_perfis.cpf`, `vendas_novas.cpf`, `assinatura_signatarios.cpf_cnpj`) |
| a coluna existe no xtv? | mesma consulta (xtv) | **não** — zero linhas |
| está no ledger do nnv? | `name ilike '%profile%' or name ilike '%cpf%'` (nnv) | **não** — zero linhas |
| está no ledger do xtv? | `name ilike '%profile%'` (xtv) | **não** — zero linhas. CONTROLE: `name ilike '%carta%'` = 7, então a consulta funciona |

O arquivo diz de si mesmo, na primeira linha do cabeçalho: *"Bidcon — plataforma
logada · Migration 0026"*. **Plataforma logada é nnv.** O arquivo está na pasta do
xtv, como as 17 do BLOCO 6 — mesmo defeito de arquivamento, mesma origem provável.

O corpo é `alter table profiles add column if not exists cpf text`. O `if not
exists` é o que torna o caso indecidível pelo efeito sozinho: rodar duas vezes dá o
mesmo banco. O que decide é o **par** de medições — presente no nnv, ausente no
xtv — e ele diz que a migração foi aplicada uma vez, no projeto certo, **por fora
da ferramenta que escreve o ledger** (dashboard ou MCP sem `apply_migration`).

Atenção a uma armadilha de leitura: **o xtv TEM uma tabela `profiles`**, e ela não é
a mesma coisa. As 7 colunas dela são `id, nome, telefone, email, tipo, status,
criado_em` — nenhuma `cpf`, nenhum vínculo com o contrato. Quem medisse só
"existe tabela `profiles` no xtv?" concluiria que a migração pertence ao xtv e está
faltando. Não está: ela não é dali.

**Esta linha inverte o sentido de todo o resto do documento.** Os 39 casos do
BLOCO 5 são *ledger presente, arquivo ausente*. Este é *arquivo presente, efeito
presente, ledger ausente nos dois projetos* — o banco andou e não deixou registro.
Não sei quantos outros casos assim existem, e **não os procurei**: descobrir isso
exige comparar o schema inteiro contra os arquivos, que é outro trabalho e não foi
pedido. Registro a lacuna para que ela não passe por conclusão.
**L-ARQ-0061** · `0061_conversas_status_humano.sql` · tem par (BLOCO 4).
**L-ARQ-0080** · `0080_fidc_comissao_decidida.sql` · tem par (L-0080-B).
**L-ARQ-0084** · `0084_buscar_cartas_entrada_max.sql` · **corretamente ausente**
do ledger. Verificado no banco: `select count(*) from pg_proc where
proname='buscar_cartas' and pronargs=6` → **0**. Não foi aplicada, e não devia
ter sido: aguarda ordem. Esta linha existe para que a ausência dela conste como
esperada, e não seja "descoberta" como defeito daqui a um mês.

---

## BLOCO 7 — O ACHADO QUE ESTA MEDIÇÃO PRODUZIU

**L-0080-A** · `0080_administradoras_grafias_orfas` @ 20260813200250 ·
arquivo hoje: `0085_administradoras_grafias_orfas.sql` (ramo
`administradoras-grafias-01`) ·

**Ela está APLICADA em produção desde 13/08/2026 20:02:50 — e o cabeçalho do
arquivo diz `AUTORIZADO: PENDENTE. NAO APLICAR sem ordem expressa`.**

O cabeçalho está errado, não o banco. Prova no dado, não só no ledger — a
conferência que a própria migration deixou escrita foi rodada em 17/08/2026 e
bate em cima:

| conferência escrita na migration | esperado | medido em 17/08 |
|---|---|---|
| administradoras distintas em `vw_vitrine_viva` | 33 | **33** |
| Itaú aparece | 1× | **1×** |
| Banco do Brasil aparece | 1× | **1×** |
| alias `BBRASIL` em Banco do Brasil | presente | **presente** |
| alias `ITAÚ - P` (com acento) em Itaú | presente | **presente** |
| `Groscon` cadastrada | sim | **sim** |
| cartas `BBRASIL` com vínculo nulo | 0 | **0** |

Sete confirmações independentes. Não é coincidência de idempotência: `Groscon`
só existe se o `insert` rodou.

**Consequência que fica registrada:** em 17/08/2026 eu renumerei esse arquivo
de 0080 para 0085 e escrevi na mensagem de commit que ela continuava pendente,
repetindo o que o cabeçalho dizia. Eu li o arquivo inteiro e não li o ledger.
A renumeração em si continua certa — dois arquivos 0080 não podem coexistir —
mas a afirmação "não aplicada" que foi junto era falsa.

---

## BLOCO 8 — CORREÇÕES E MEDIÇÕES DE 17/08/2026, DEPOIS DO COMMIT

Este bloco é append-only na prática, não só na declaração: **nenhuma linha
acima foi reescrita.** Cada item abaixo diz qual linha ele corrige.

### L-0073-B · A ÚNICA ÓRFÃ NÃO ERA ÓRFÃ

**Corrige: L-0073-A (BLOCO 1), a linha do BLOCO 0 que diz "Só
`0073_farol_pauta_aprovacao` é órfã de verdade", L-COL-0073 (BLOCO 3), a
entrada de `0073_farol_pauta_aprovacao` na lista de 26 numeradas do BLOCO 5, e
o pedido nº 1.**

O SQL **nunca esteve perdido**. Está em
`painel-farol-01/MIGRATION_farol_pauta_aprovacao.sql` — 5.584 bytes,
rastreado pelo git, commitado em `80bca90` ("PAINEL-FAROL-01: painel de
conteúdo no portal admin"), em 08/08/2026. A migration foi aplicada no dia
seguinte, 09/08 11:59:31.

**Por que eu não o achei:** meu inventário varreu
`platform/supabase/migrations/` e mais nada. Um arquivo de migration guardado
na pasta da própria fatia era invisível para a medição. O documento diz, no
"COMO FOI MEDIDO", que os arquivos foram varridos "em TODOS os refs" — o que é
verdade quanto a *refs* e falso quanto a *caminhos*. **A varredura foi
completa em ramos e estreita em pastas, e eu chamei isso de completa.**

Três provas independentes de que este arquivo é o que o ledger aplicou:

| prova | no arquivo | vivo no xtv |
|---|---|---|
| lista do CHECK | `'nova','usada','reprovada','aguardando_aprovacao','aprovada','reprovada_humano'` | **idêntica, na mesma ordem** |
| índice parcial 1 | `farol_pauta_aprovada_idx` on `(dia) where status='aprovada'` | **presente, definição idêntica** |
| índice parcial 2 | `farol_pauta_aguardando_idx` on `(dia desc) where status='aguardando_aprovacao'` | **presente, inclusive o `desc`** |

O CHECK original, em `0071_farol_pauta.sql`, tem **3** valores
(`'nova','usada','reprovada'`). Os 3 valores extras são todos de aprovação.
Nenhum outro arquivo, em nenhum ref, altera esse CHECK — conferido com o
literal SQL entre aspas, porque buscar `aprovada` sem aspas casa dentro de
`reprovada` e devolve 1.227 falsos positivos.

*Limite desta prova, declarado:* `farol_pauta` tem **0 linhas**. A evidência é
de ESTRUTURA, não de uso. A migration rodou; ninguém usou o que ela abriu.

**Efeito nos totais deste documento:** as ausências do BLOCO 5 caem de **39
para 38** (26 numeradas viram 25). E das **4 entradas nomeadas na ordem
original, as 4 têm arquivo** — nenhuma é órfã. A premissa da ordem estava
errada não em 3 pontos, como diz o BLOCO 0, mas em 4.

### L-0073-C · DUAS AFIRMAÇÕES FALSAS EM CÓDIGO DE PRODUÇÃO

Consequência que **não é deste documento resolver**, e por isso vai como
pedido nº 7. Dois arquivos vivos declaram que esta migration não foi aplicada:

- `platform/lib/farol/painel.ts` — *"A migration está escrita e NÃO aplicada
  (ver `painel-farol-01/` na raiz do repo). Ligar esta env antes de aplicar faz
  o insert das 10h falhar no 23514."*
- `platform/app/api/admin/farol/pauta/[id]/route.ts:42` — mesma afirmação.

Os dois textos apontam para a pasta certa e tiram a conclusão errada. O
pré-requisito que eles declaram **já está satisfeito**: o CHECK aceita os seis
valores desde 09/08. `FAROL_PAUTA_APROVA` está desarmada há oito dias por uma
premissa que deixou de valer no dia seguinte ao commit que a escreveu.

Não armei a env e não editei os comentários: armar é ato em produção e não
houve ordem. Fica reportado.

### L-NNV-17 · OS 17 ARQUIVOS DO NNV, MEDIDOS NOS DOIS BANCOS

**Complementa o BLOCO 6**, que dizia "17 deles estão no ledger do NNV" sem
dizer o que aconteceu no xtv. Medido por existência das 22 tabelas que os 17
arquivos criam:

| arquivo | tabelas | nnv | xtv |
|---|---|---|---|
| `0001_schema` | profiles, cartas, processos, indicacoes, comissoes | **5/5** | **5/5** |
| `0003_processo_eventos` | processo_eventos | **1/1** | **1/1** |
| `0004_cartas_sync` | eventos_sync | **1/1** | **1/1** |
| `0008_kyc` | kyc_perfis, kyc_eventos | **2/2** | **0/2** |
| `0011_administradoras_fornecedores` | administradoras, fornecedores | **2/2** | **2/2** |
| `0012_sync_administradora` | sync_fonte_config | **1/1** | **1/1** |
| `0013_prospere_ancora` | ancora_tabela | **1/1** | **0/1** |
| `0014_pos_reserva` | checklist_modelos, checklist_itens, processo_documentos, contratos, pagamentos_sinal | **5/5** | **0/5** |
| `0016_reserve_core` | reservas, reserva_legs, reserva_conditions, reserva_eventos | **4/4** | **0/4** |

**No nnv: 22 de 22.** Os 17 rodaram lá, como o ledger do nnv já dizia.

**No xtv: 5 dos 9 arquivos que criam tabela rodaram TAMBÉM.** Não é
"pasta errada" simples: `0001`, `0003`, `0004`, `0011` e `0012` fazem parte da
história real do xtv — `cartas` e `administradoras` são o coração da vitrine.

*Armadilha corrigida na própria medição:* a primeira leitura deu
`reservas → SIM` no xtv, o que faria `0016_reserve_core` parecer parcialmente
aplicado. As colunas desmentem: **xtv tem 10** (`carta_id, criado_em,
expira_em, fingerprint, id, interesse_id, nome, origem, status, telefone`) e
**nnv tem 27** (`fee_plan, settlement_rail, seller_id, buyer_id…`). Só `id` e
`carta_id` coincidem. São tabelas homônimas e sem parentesco: `0016` tem
**0/4** no xtv. Mesma armadilha do `profiles` em L-ARQ-0026, no mesmo dia, em
sentido contrário — lá o homônimo faria alguém adotar a migration, aqui faria
alguém aplicá-la de novo.

**8 dos 17 não criam tabela** (`0002_rls`, `0005_cartas_vitrine`,
`0006_status_rpc`, `0007_busca_semantica`, `0009_reserva`,
`0010_status_carta_propagacao`, `0015_sync_multifonte`, `0017_repasse`) e
**esta medição não os decide**. Eles fazem RLS, view e função; situá-los exige
comparar policy e assinatura de função, que não foi feito. Registro para que a
tabela acima não seja lida como se cobrisse os 17.

**O que isto significa para o pedido nº 4 ("mover, ou deixar e anotar?"):**
mover os 5 que rodaram nos DOIS bancos apagaria história do xtv. Nenhuma
proposta aqui — a ordem foi medir e reportar antes de propor, e é o que este
bloco faz.

### L-0080-D · O CABEÇALHO DA 0085 FOI CORRIGIDO

**Fecha o pedido nº 3 e a restrição "Não corrigir o cabeçalho da 0085 por
conta própria".** A ordem veio em 17/08/2026. Commit `0e9ff0f` no ramo
`administradoras-grafias-01`: 32 inserções, 3 deleções, **nenhuma linha
executável tocada** — as 3 deleções são exatamente o bloco `AUTORIZADO:
PENDENTE`. A frase antiga sobrevive no arquivo como citação datada, para que a
correção não apague o registro de que houve erro.

Três defeitos meus no próprio texto da correção, achados por medição antes do
commit e anotados lá: eu escrevi "todos os insert" (há **um**), citei
`if not exists` (**não aparece** naquele arquivo; controle: aparece 2× em
`0071_farol_pauta.sql`) e atribuí a todos os `update` o guard
`administradora_id is null` (vale para **1** dos 5; os outros 4 usam
`not (<alias> = any(aliases))`). O arquivo já descrevia isso certo no parágrafo
`IDEMPOTENTE`, mais abaixo — **eu escrevi um cabeçalho pior do que a descrição
que o próprio arquivo já tinha, sem ter descido até ela.**

---

## BLOCO 9 — A RE-MEDIÇÃO POR LINHAGEM, E O QUE ELA DERRUBOU

Também append-only: **nenhuma linha acima foi reescrita**, inclusive as que este
bloco declara falsas. Cada item diz qual linha corrige.

O BLOCO 8 mediu por EXISTÊNCIA DE NOME. Este mede por **LINHAGEM** — quem criou
a tabela, e com que forma. São perguntas diferentes, e dão respostas diferentes.
A primeira eu fiz e reportei como se fosse a segunda. Este bloco é o conserto.

### L-ORDEM-A · A ORDEM DOS 17 CABEÇALHOS ESTÁ CUMPRIDA

17 de 17 arquivos têm a linha `BANCO ALVO` no cabeçalho. Conferido em
17/08/2026 arquivo a arquivo, com controle (`!!! SEM LINHA BANCO ALVO` para
quem não tivesse) — o controle não disparou em nenhum.

| grupo | arquivos | quantos |
|---|---|---|
| **A — aplicada nos DOIS** | 0001, 0002, 0003, 0004, 0005, 0006, 0007, 0012 | **8** |
| **B — só nnv** | 0008, 0009, 0010, 0011, 0013, 0014, 0016, 0017 | **8** |
| **C — parcial, seção a seção** | 0015 | **1** |

### L-NNV-17-B · A 0011 NÃO RODOU NO XTV — corrige L-NNV-17

**Corrige duas coisas em L-NNV-17 (BLOCO 8):** a linha
`| 0011_administradoras_fornecedores | administradoras, fornecedores | 2/2 | 2/2 |`,
e a frase *"No xtv: 5 dos 9 arquivos que criam tabela rodaram TAMBÉM… `0001`,
`0003`, `0004`, `0011` e `0012`"*.

**O certo é 4 dos 9: `0001`, `0003`, `0004` e `0012`.** A 0011 sai da lista, e
com ela o `2/2` no xtv vira **0/2**. As duas tabelas existem no xtv, mas
nenhuma das duas nasceu neste arquivo:

- **`administradoras`** nasce em **`0023_administradoras_v2`** — nativa do xtv,
  aplicada em 08/07/2026. Ela cria a tabela do zero com 3 colunas e depois
  acrescenta as outras 7 por `add column if not exists`. O comentário da própria
  0023 entrega o jogo: *"Higiene (no xtv: no-op, tabela nasce vazia)"* — ela sabe
  que está **criando**, não estendendo.
- **`fornecedores`** nasce em **`0037_fornecedores_importacoes`** — nativa do
  xtv, aplicada em 09/07/2026 (`20260709204303`), com
  `create table public.fornecedores` **SEM `if not exists`**. Este é o
  instrumento de datação mais limpo do bloco: um `create table` sem guard que
  **teve sucesso** prova que a tabela não existia naquele instante. Se a 0011
  tivesse rodado antes, a 0037 teria abortado.

### L-LINHAGEM-11 · AS 11 TABELAS DE NOME COMPARTILHADO, MEDIDAS UMA A UMA

A premissa da ordem dizia *"no xtv só existem homônimos"*. Medido: **3 de 11**
são homônimos. As outras 8 são a mesma tabela, com uma ponta estendida de um
lado ou do outro.

| tabela | xtv | nnv | veredito |
|---|---|---|---|
| `profiles` | 7 | 8 | **MESMA** — xtv é a 0001 literal; nnv é 0001 + `cpf` |
| `cartas` | 29 | 24 | **MESMA** — 20 nomes comuns; os dois lados estenderam |
| `processos` | 9 | 12 | **MESMA** — xtv é subconjunto perfeito do nnv |
| `indicacoes` | 5 | 5 | **MESMA**, idêntica |
| `comissoes` | 8 | 13 | **MESMA** — xtv é subconjunto perfeito |
| `processo_eventos` | 6 | 6 | **MESMA**, idêntica |
| `eventos_sync` | 7 | 7 | **MESMA**, idêntica |
| `sync_fonte_config` | 5 | 4 | **MESMA** — xtv = nnv + `ativo` (da `0045_sync_fonte_config_ativo`) |
| `administradoras` | 10 | 9 | **HOMÔNIMO CONVERGENTE** |
| `fornecedores` | 8 | 9 | **HOMÔNIMO DIVERGENTE** |
| `reservas` | 10 | 27 | **HOMÔNIMO DIVERGENTE** |

**A distinção que este bloco introduz, porque ela muda o risco:**

- **Homônimo DIVERGENTE é o fácil.** `fornecedores` compartilha **4 nomes de
  8/9** — `id`, `nome`, `ativo`, `criado_em` —, todos genéricos; nenhum campo de
  negócio casa. `reservas` compartilha **2 de 10/27**. Abrir as duas lado a lado
  desfaz a ilusão em cinco segundos.

  ```
  fornecedores  xtv (8): id · nome · contato_nome · whatsapp · email ·
                         observacoes · ativo · criado_em          <- 0037
                nnv (9): id · nome · portal_origem · canal_lance · resp_nome ·
                         resp_contato · obs · ativo · criado_em   <- 0011

  reservas      xtv (10): id · carta_id · interesse_id · nome · telefone ·
                          origem · status · fingerprint · expira_em ·
                          criado_em                               <- 0036
                nnv (27): id · carta_id · buyer_id · seller_id · fee_plan ·
                          settlement_rail · ...                   <- 0016 +
  ```

- **Homônimo CONVERGENTE é o traiçoeiro, e `administradoras` é o caso.**
  **9 dos 10 nomes coincidem** (o xtv tem `aliases` a mais, da
  `0026_administradoras_aliases`). A forma quase idêntica **parece prova de
  linhagem e não é**: a 0023 se declara, no próprio cabeçalho, *"convergindo o
  schema rico do motor de repasse"*. Ela chegou ao mesmo desenho de propósito,
  por outro caminho. **Forma igual não prova origem comum** — e um homônimo
  divergente se denuncia sozinho, enquanto um convergente passa na conferência.

### L-LEDGER-PISO · O LEDGER DO XTV NÃO COBRE 0001–0018

Fato medido que muda o que se pode afirmar em todo o documento: o
`supabase_migrations.schema_migrations` do xtv **começa em `20260705140817` /
`0019_interesses`**. Não há entrada nenhuma para 0001 a 0018.

Tudo anterior a 05/07/2026 foi aplicado à mão, por fora da ferramenta que
escreve o ledger. **Para essa faixa, "só o ledger diz o que aconteceu" não tem
o que consultar** — e a linhagem por forma de coluna passa a ser o único
instrumento disponível.

**Uma pergunta que isto deixa aberta, e eu registro como não sabida:**
`cartas.administradora_id` e `cartas.fornecedor_id` existem no xtv, e a 0011 é o
único arquivo da pasta que as acrescenta. Mas 0023 e 0037 apenas **pressupõem**
as colunas prontas (a 0037 chega a criar
`constraint cartas_fornecedor_fk foreign key (fornecedor_id)`). Quem as criou no
xtv não é determinável: quem saberia era o ledger, e o ledger começa depois.

### L-ARQ-0026-B · O `profiles` DO XTV É A TABELA DA 0001 — corrige L-ARQ-0026

**Corrige a frase** *"o xtv TEM uma tabela `profiles`, e ela não é a mesma
coisa"* (BLOCO 6).

Como **observação** ela está certa: o xtv não tem `cpf`, e quem medisse só
"existe `profiles` no xtv?" tiraria a conclusão errada. Como **afirmação de
linhagem** está errada. Medido no corpo da `0001_schema.sql`: ela define
`profiles` com exatamente `id, nome, telefone, email, tipo, status, criado_em`
— **as 7 colunas que o xtv tem**, na ordem. E `grep -n "cpf" 0001_schema.sql`
devolve zero.

Ou seja: **o `profiles` do xtv É a tabela da 0001**, literal. O do nnv é a mesma
tabela mais a coluna que a `0026_profile_cpf.sql` acrescentou depois. Não são
homônimas — são a mesma, com uma ponta a mais de um lado. A conclusão prática
de L-ARQ-0026 (*"a migration do cpf não é do xtv"*) **continua de pé**; o que
cai é o argumento pelo qual eu cheguei nela.

### L-SEM-TABELA-8 · OS 8 QUE NÃO CRIAM TABELA, AGORA DECIDIDOS

**Corrige** a frase de L-NNV-17: *"8 dos 17 não criam tabela … e **esta medição
não os decide**"*. Foram medidos por policy, por assinatura de função e, onde
existir não bastava, **pelo corpo da função**:

| arquivo | como foi decidido | nnv | xtv |
|---|---|---|---|
| `0002_rls` | `is_admin` + as 13 policies | 14/14 | **14/14** |
| `0005_cartas_vitrine` | policy `cartas_vitrine_select` | 1/1 | **1/1** |
| `0006_status_rpc` | as 4 funções de status/comissão | 4/4 | **4/4** |
| `0007_busca_semantica` | função `buscar_cartas_semantica` | 1/1 | **1/1** |
| `0009_reserva` | função `reservar_carta` | 1/1 | **0/1** |
| `0010_status_carta_propagacao` | **o CORPO** de `avancar_status_processo` | SIM | **NÃO** |
| `0015_sync_multifonte` | **seção a seção** (§1–§5) | INTEIRA | **PARCIAL** |
| `0017_repasse` | colunas de repasse + CHECK de `reserva_legs` | SIM | **NÃO** |

**A 0010 é a lição do lote, e vale mais que o resultado dela.**
`avancar_status_processo` existe nos DOIS bancos — e isso **não decide nada**,
porque a função **nasce na 0006**, que rodou nos dois. Existir só provaria que a
0006 rodou. Quem separa é a marca que a 0010 acrescenta ao corpo: o
`update cartas set status = 'vendida'` dentro do bloco de carta vinculada. **O
corpo do nnv tem; o do xtv não** — lá a função segue na versão da 0006. Sem
descer ao corpo, eu teria contado a 0010 como aplicada nos dois.

**A 0015, seção a seção** (única do lote com veredito misto):

| seção | objeto | nnv | xtv |
|---|---|---|---|
| §1 | `administradora_origem`, `entrada_parceiro_raw`, índice `uniq_cartas_origem_numero` | SIM | **SIM** |
| §2 | `processos.status_confirmacao_parceiro` | SIM | **NÃO** |
| §3 | linhas de `sync_fonte_config` das 5 marcas | SIM | **SIM** |
| §4 | `sync_aplicar_cotas` de 2 argumentos | SIM | **SIM** |
| §5 | `reservar_carta` | SIM | **NÃO** |

As duas ausências no xtv são **pulo, não remoção**: nenhuma migration da pasta
dá `drop` nesses objetos. E a §5 **não poderia** ter rodado lá — o corpo declara
`v_kyc kyc_status`, e o tipo `kyc_status` (da 0008) não existe no xtv. O
Postgres valida corpo de plpgsql no `CREATE`, então falharia na hora.

### L-REPRODUCAO · "SUCESSO SEM ERRO" NÃO É SINAL DE NADA

Achado que só apareceu porque eu fui conferir uma frase minha, e que muda o
aviso que os cabeçalhos precisavam dar.

Eu havia escrito no cabeçalho da 0011 que reproduzi-la contra banco vivo
*"aborta na primeira policy já existente"* — o raciocínio de que `create policy`
não tem `if not exists`, logo colide. Medido em `pg_policies` do xtv em
17/08/2026: **`fornecedores` tem RLS ligado e ZERO policies**; `administradoras`
tem só `administradoras_leitura_publica`, da 0023. **Nenhum dos 3 nomes de
policy da 0011 colide com coisa nenhuma.**

Rodada contra o xtv, a 0011 vai **do começo ao fim sem um erro**:

1. os 2 `create table if not exists` viram **no-op silencioso** contra as
   tabelas de 0023/0037 — inclusive contra a `fornecedores` de forma diferente,
   que ele não corrige e não denuncia;
2. os 2 `add column if not exists` em `cartas` viram no-op;
3. e os 3 `create policy` **são criados**, enxertando regra de acesso em tabelas
   que este arquivo não criou.

O item 3 é o dano. `fornecedores_admin_all` é `for all using (is_admin())` sobre
uma tabela que hoje, no xtv, é **service-role-only por ausência DELIBERADA de
policy** — a 0037 fecha o acesso justamente **não escrevendo policy nenhuma**.
Reproduzir a 0011 **abre essa tabela para todo `is_admin()`**, e o operador não
vê um aviso. Ausência de policy é uma decisão de segurança que parece um vazio a
preencher.

**A regra que fica:** idempotente não quer dizer seguro; quer dizer sem freio.

### L-MEU-ERRO-0011 · TRÊS AFIRMAÇÕES MINHAS, FALSAS, NO CABEÇALHO QUE EU ESCREVI

O cabeçalho da 0011 que eu publiquei em 17/08/2026 dizia três coisas erradas.
As três foram achadas por medição minha, no mesmo dia, antes de qualquer
consequência — e ficam registradas com o nome que têm:

1. **"BANCO ALVO: xtv E nnv — APLICADA NOS DOIS."** Não rodou no xtv
   (L-NNV-17-B).
2. **"com lastro comum — não são homônimas."** As duas **são** homônimas: uma
   convergente, uma divergente (L-LINHAGEM-11).
3. **"aborta na primeira policy já existente."** Não aborta; roda limpa e alarga
   acesso (L-REPRODUCAO). **Esta é a pior das três**: eu avisei um operador
   futuro de que o arquivo pararia sozinho, quando ele não para.

**A causa é uma só, e é a que este documento inteiro existe para pegar:** minha
medição anterior perguntou *"o NOME existe nos dois bancos?"*, a resposta foi
sim, e eu reportei isso como *"o arquivo está aplicado nos dois"*. Duas
perguntas diferentes, uma resposta só. Cometi, dentro do conserto, o defeito que
o conserto persegue.

O cabeçalho da 0011 foi reescrito em 17/08/2026 com marca `CORREÇÃO DE
17/08/2026` que **preserva a frase antiga citada**, para que a correção não
apague o registro de que houve erro — mesmo procedimento de L-0080-D.

---

## BLOCO 10 — A 0086, E O QUE O LEDGER ANDOU DEPOIS DE 17/08

Append-only como os anteriores: **nenhuma linha acima foi tocada.** Cada item diz
qual linha corrige.

O ledger tinha **87** entradas em 17/08/2026. Hoje, 19/08/2026, tem **92**. As
cinco novas são o assunto deste bloco — e uma delas não é da 0086.

```
20260818000743  0084_buscar_cartas_entrada_max
20260818003849  agenda_01_agendamentos
20260818003935  agenda_01_touch_security_invoker
20260819232113  0086a_agendamentos_reconciliacao_enum
20260819232141  0086b_agendamentos_delta
```

### L-DIV-0086 · A QUINTA DIVISÃO a/b — corrige BLOCO 2 e BLOCO 3

**Corrige:** a frase do BLOCO 0 *"**4 divisões a/b** (mesmo assunto partido)"*, a
lista do BLOCO 2 (que enumera 0023, 0024, 0081, 0083) e a linha do BLOCO 3
*"### Divisões a/b … : 4"*. **São 5.**

**L-DIV-0086** · `0086a_agendamentos_reconciliacao_enum` @20260819232113 +
`0086b_agendamentos_delta` @20260819232141 · **28 segundos de diferença**, na
ordem certa (o `a` antes do `b`, ao contrário de L-DIV-0024) → um arquivo,
`platform/supabase/migrations/0086_agendamentos.sql` ·

*Motivo:* **MEDIDO, e é o mesmo defeito do Postgres de L-DIV-0081 e L-DIV-0083.**
A SEÇÃO 1 do arquivo (linha 245) faz
`alter type agenda_status add value if not exists 'reservando' before 'pendente'`
e a SEÇÃO 2.2 **usa** esse valor, ao reconstruir a constraint de exclusão. Uso do
valor novo na mesma transação que o cria = `55P03`. Por isso o apply foi partido.
O arquivo **não** foi partido, pelo mesmo motivo já registrado em L-DIV-0081:
*"partir em dois arquivos faria a numeração mentir sobre quantas migrações
existem"*.

**O que esta divisão tem de diferente das quatro anteriores, e vale registrar:**
em 0023, 0024, 0081 e 0083 o motivo foi *reconstruído depois*, lendo o arquivo —
e em 0023 e 0024 não foi reconstruído coisa nenhuma (*"não determinado"*). Aqui o
motivo foi **escrito no cabeçalho antes do apply**, junto com a ordem das duas
metades. É a primeira divisão a/b deste banco que nasce declarada em vez de
deduzida.

### L-NOME-0086 · AS DUAS METADES TÊM ARQUIVO COM OUTRO NOME — complementa BLOCO 4

**Complementa** a tabela do BLOCO 4, que tinha 13 linhas e passa a ter 15. Não
corrige nada: nenhuma daquelas 13 estava errada.

| ledger | arquivo no repo | como foi casado |
|---|---|---|
| `0086a_agendamentos_reconciliacao_enum` | `0086_agendamentos.sql` | assunto (metade a — L-DIV-0086) |
| `0086b_agendamentos_delta` | `0086_agendamentos.sql` | assunto (metade b — L-DIV-0086) |

Diferença em relação a 0081/0083: lá **só a metade `b`** divergia do nome do
arquivo (a metade `a` também, mas o BLOCO 4 só registrou a `b`). Aqui **as duas**
divergem, porque nenhuma das duas repete o assunto do arquivo (`agendamentos`
seco). Fica registrado para que a próxima busca por *"cadê o arquivo da 0086a"*
termine aqui.

### L-AGENDA-01 · AS DUAS `agenda_01_*` DE 18/08 — a linha nasce aqui, não é anotada

A ordem que gerou este bloco pedia que *"a linha das duas órfãs `agenda_01_*` de
18/08 ganhe a nota «reconciliadas pela 0086a»"*. **Essa linha não existia.** Não
por esquecimento: este documento foi medido em **17/08/2026** e as duas entradas
foram aplicadas em **18/08/2026 00:38:49 e 00:39:35** — um dia depois. Elas nunca
puderam estar no BLOCO 5, e o BLOCO 5 não fica errado por não as ter. **Anotar
uma linha que não existe seria inventar histórico; a linha nasce agora.**

**L-AGENDA-01** · `agenda_01_agendamentos` @20260818003849 +
`agenda_01_touch_security_invoker` @20260818003935 ·
**SEM NÚMERO** — assinatura de apply direto por MCP/painel, o mesmo padrão dos 13
do BLOCO 5 ·
**RECONCILIADAS PELA 0086a** em 19/08/2026 23:21:13.

*O que "reconciliada" quer dizer aqui, com precisão:* a SEÇÃO 0 do
`0086_agendamentos.sql` é a **construtora** dos objetos que essas duas entradas
já haviam criado à mão. Ela não os altera — ela passa a **descrevê-los**, para que
um ambiente novo nasça igual ao xtv. Medido objeto a objeto em 19/08/2026, antes
do apply:

| objeto da SEÇÃO 0 | vivo no xtv antes do apply | efeito da SEÇÃO 0 |
|---|---|---|
| `type agenda_status` | 6 valores idênticos | do-block pula |
| `table agendamentos` | existe, 20 colunas, uma a uma iguais ao `create table` | `if not exists` pula |
| `agendamentos_sem_sobreposicao` | existe, predicado idêntico | do-block pula |
| 2 índices únicos + 4 índices | existem, `indexdef` idêntico | `if not exists` pula |
| `table agenda_log` + 2 índices | existem | pula |
| RLS nas duas | ligada, **zero policies** | já era o desenho |
| `tg_agendamentos_touch` | `prosecdef=false`, `search_path=''` | `or replace` idêntico |
| `trigger agendamentos_touch` | mesmo nome, mesmo corpo | `or replace` idêntico |

**Só dois comandos da SEÇÃO 0 escrevem, e os dois são `or replace` que produzem
objeto idêntico ao que já estava lá.** O conserto de segurança que a
`agenda_01_touch_security_invoker` fez em 18/08 (tirar o `security definer` e
fixar `search_path`) **não regride** — a SEÇÃO 0 o reescreve igual. É por isso
que o cabeçalho pôde declarar *"no-op no xtv e construtora em qualquer ambiente
novo"*, e é isso que a medição confirma.

**Uma consequência que fica:** as duas `agenda_01_*` continuam **sem arquivo
próprio**, e continuarão. O arquivo delas é o `0086_agendamentos.sql`, por
adoção, não por origem. Quem procurar `agenda_01_agendamentos.sql` não vai achar
— e é para isso que esta linha existe.

### L-ARQ-0084-B · A 0084 FOI APLICADA — corrige L-ARQ-0084 (BLOCO 6)

**Corrige** a linha *"**L-ARQ-0084** · `0084_buscar_cartas_entrada_max.sql` ·
**corretamente ausente** do ledger… **Não foi aplicada, e não devia ter sido:
aguarda ordem.** Esta linha existe para que a ausência dela conste como esperada,
e não seja «descoberta» como defeito daqui a um mês."*

Não fez um mês: fez **dois dias**. Ela foi aplicada em **18/08/2026 00:07:43**.

**O controle que a própria L-ARQ-0084 escreveu disparou.** Ela mandava medir
`select count(*) from pg_proc where proname='buscar_cartas' and pronargs=6`, e
registrava o resultado de 17/08 como **0**. Medido de novo em 19/08/2026:

```
buscar_cartas com 6 argumentos ...... 1     (era 0 em 17/08)
buscar_cartas com qualquer aridade .. 1
aridades existentes ................. 6
```

A aridade 6 é a única que existe — ou seja, a função de 6 argumentos não convive
com uma anterior, **substituiu**. Não há sobrecarga velha pendurada.

**O que esta linha NÃO afirma:** que a aplicação foi indevida. L-ARQ-0084 dizia
*"aguarda ordem"*, e **se a ordem veio, este documento não a viu** — ordem chega
por chat, não por banco. O que a medição estabelece é só o fato e a data. Fica
como pedido nº 8.

*Registro do que isto ensina sobre o próprio documento:* L-ARQ-0084 é a única
linha do ledger inteiro que foi escrita **prevendo o próprio disparo** — ela
anotou o comando e o valor esperado, e por isso a mudança foi detectável em uma
consulta, sem investigação. Todas as outras ausências do BLOCO 5 estão anotadas
sem controle: se qualquer uma delas ganhar arquivo ou efeito amanhã, nada avisa.

### L-VIGIA-ZERO · O ZERO DO VIGIA É O ZERO DA MESA VAZIA

A pós-checagem do apply mediu `agenda_orfaos_google()` → **0 órfãos**, e o número
está certo. **Ele não prova que o vigia funciona.**

```
agendamentos ........ 0 linhas
agenda_log .......... 0 linhas
agenda_orfaos_google() → 0
```

Uma função que varre uma tabela vazia devolve zero **por construção**, tenha ela
lógica ou não. Pela regra da casa — *todo zero afirmado precisa de um controle
que possa disparar* — este zero é **não informativo**, e fica declarado como tal
em vez de contado como aprovação.

O que **foi** verificado, por leitura do corpo e não por execução: a função tem
dois braços reais (`reserva_expirada` para `status='reservando'` com
`reserva_expira_em < now()`, e `pendente_sem_evento` para `status='pendente'` sem
`google_event_id` além da carência), é `STABLE`, **não** é `security definer`,
tem `search_path='public'` e a ACL é `postgres` + `service_role` — nem `anon` nem
`authenticated`.

**O controle que falta**, para quando houver ordem: inserir uma linha em
`'reservando'` com `reserva_expira_em` no passado, confirmar que a função devolve
**1**, e remover. Sem isso, o vigia está escrito e **nunca foi visto detectar
nada**. Não executei: escrever em produção é ato, e não houve ordem.

### L-RESERVA-SEGURA · O QUE A 0086b MUDOU NO RISCO DA GRADE

Medido depois do apply:

```
enum ..... reservando < pendente < confirmado < cancelado < realizado < nao_compareceu < erro
EXCLUDE .. tstzrange(inicio_em, fim_em, '[)') WITH &&
           WHERE status IN ('reservando','pendente','confirmado')
CHECK .... status <> 'reservando' OR reserva_expira_em IS NOT NULL
colunas .. 20 -> 23
```

A constraint de exclusão agora **segura o horário durante a reserva** — que é a
trava 3 inteira, e a razão de o `'reservando'` ter entrado **antes** do
`'pendente'` na ordem do enum.

**O efeito colateral que isso cria, e que precisa de dono:** uma reserva que
morreu no meio do caminho **bloqueia o horário** enquanto estiver em
`'reservando'`, e o `CHECK` garante que ela tem prazo, mas **nada faz o prazo
vencer sozinho**. A `agenda_orfaos_google()` **detecta** e não age — desvio já
declarado no cabeçalho da 0086 (o RADAR é dono do ciclo de vida do alerta, porque
`agenda_log` não tem `resolvido_em`). Ou seja: **enquanto não existir o varredor
que expira reserva, um horário perdido some da grade e ninguém é avisado.** Esse
varredor é o item `RESERVA-EXPIRA-01` da fila, e esta linha existe para que a
ligação entre os dois não se perca.

---

## O QUE ESTE DOCUMENTO NÃO AUTORIZA

- **Não reescrever o ledger.** Nenhum `insert`, `update` ou `delete` em
  `supabase_migrations.schema_migrations`. Ledger que se conserta por dentro
  deixa de ser evidência e vira opinião com carimbo de banco. A divergência fica
  onde está, documentada aqui.
- **Não renumerar nada retroativamente.** Arquivo já aplicado com número X
  continua X. A renumeração de 17/08 foi exceção com motivo declarado: dois
  arquivos disputando o mesmo nome na mesma árvore.
- **Não mover os 17 arquivos do nnv** para `migrations-nnv/`. É ato, precisa de
  ordem, e mover arquivo aplicado tem risco de reaplicação em máquina de
  terceiro.
- **Não corrigir o cabeçalho da 0085** por conta própria. Está reportado no
  BLOCO 7; a correção é uma linha nova neste arquivo e uma edição naquele, com
  ordem.

## O QUE ESTE DOCUMENTO PEDE (decisões, para quando houver tempo)

1. `0073_farol_pauta_aprovacao` — única órfã de verdade entre as quatro
   nomeadas. Existe o SQL em algum lugar (histórico, backup, chat)?
2. ~~`0026_profile_cpf.sql` — aplicada ou não?~~ **RESPONDIDA na mesma sessão, em
   17/08/2026** — aplicada no nnv, ausente dos dois ledgers (BLOCO 6, L-ARQ-0026).
   Fica riscada, não apagada: a pergunta foi feita e teve resposta, e o documento
   é append-only. O que ela deixa em aberto é outro pedido, e é o de número 5.
5. **Quantos outros casos existem de "banco andou sem deixar registro"?** O
   L-ARQ-0026 é o único que eu encontrei, mas eu não fui procurar — ele apareceu
   por acidente, enquanto eu respondia outra pergunta. Descobrir o tamanho real
   disso é comparar o schema inteiro dos dois projetos contra os arquivos, e é
   trabalho de outra ordem. Registro para não virar surpresa.
6. **O número 0026 está ocupado por um arquivo que não é do xtv.** O ledger do xtv
   tem `0026_administradoras_aliases` @20260708201838, que está entre as 39
   ausências do BLOCO 5. A pasta do xtv, no mesmo número, tem
   `0026_profile_cpf.sql`, que é do nnv. Ou seja: a 0026 de verdade do xtv não tem
   arquivo, e o arquivo 0026 que existe pertence a outro banco. Não é colisão
   dentro do ledger (por isso não está no BLOCO 3) — é colisão entre o ledger e a
   pasta, e some sozinha se a decisão 4 for "mover".
3. O cabeçalho de `0085_administradoras_grafias_orfas.sql` diz PENDENTE sobre
   algo que está em produção há 4 dias. Corrigir para `APLICADA EM 13/08/2026`.
4. Os 17 arquivos do nnv na pasta do xtv — mover, ou deixar e anotar?

**Acrescentados em 17/08/2026, depois do commit** (append: nenhum item acima
foi reescrito):

7. **`FAROL_PAUTA_APROVA` está desarmada por uma premissa que deixou de valer.**
   Este número é citado por L-0073-C desde que o bloco foi escrito, e **nunca
   existiu nesta lista** — a citação apontava para o vazio. Fica criado aqui,
   com o mesmo texto que L-0073-C já pedia: dois arquivos vivos
   (`platform/lib/farol/painel.ts` e
   `platform/app/api/admin/farol/pauta/[id]/route.ts`) declaram que a migration
   *"está escrita e NÃO aplicada"*, e ela está aplicada desde 09/08/2026. O
   CHECK aceita os seis valores. **Decisão pedida:** armar a env e corrigir os
   dois comentários, ou manter desarmada por outro motivo. Armar é ato em
   produção; não houve ordem e nada foi armado.
   *Registro do defeito:* eu escrevi "vai como pedido nº 7" e não criei o
   pedido nº 7. Uma referência a um item que não existe é pior que a ausência do
   item, porque parece que alguém já cuidou.

**RESPOSTA AO PEDIDO Nº 4 — 17/08/2026.** *Não risco o pedido 4.* O pedido 2 foi
riscado enquanto o documento ainda era rascunho, antes do commit; a partir do
commit a regra é linha nova, e é o que esta é.

A decisão veio nominal: **DEIXAR E ANOTAR.** Motivo dado na ordem: mover quebra
a correspondência ledger↔nome de arquivo, que é justamente o que esta
reconciliação está consertando — *"trocaria uma confusão por outra"*. O conserto
executado foi o barato e reversível: **os 17 ganharam a linha `BANCO ALVO` no
cabeçalho** (L-ORDEM-A), e o homônimo `reservas` entrou nomeado, com as duas
formas lado a lado (L-LINHAGEM-11).

A medição do BLOCO 9 **reforça a decisão e enfraquece um dos argumentos dela**,
e as duas coisas ficam ditas:
- **Reforça:** 8 dos 17 rodaram nos DOIS bancos. Mover apagaria história do xtv
  — a `0002_rls` fechou a RLS da vitrine, a `0012` deu ao xtv a
  `sync_fonte_config`. Não são forasteiros.
- **Enfraquece:** o argumento de que *"no xtv só existem homônimos"* vale para
  **3 de 11** tabelas, não para todas (L-LINHAGEM-11). A premissa era mais forte
  do que o fato. A decisão não depende dela — depende do custo de mover —, mas
  fica registrado que ela foi medida e reduzida.

**Efeito no pedido nº 6:** ele previa que a colisão do número 0026 *"some
sozinha se a decisão 4 for mover"*. A decisão foi **não mover**, então **o
pedido 6 continua aberto** e não some sozinho.

**Acrescentados em 19/08/2026** (append: nenhum item acima foi reescrito):

8. **A `0084_buscar_cartas_entrada_max` foi aplicada em 18/08/2026 00:07:43, e
   L-ARQ-0084 dizia «aguarda ordem».** A ordem existiu? Este documento só vê o
   banco; ordem chega por chat. **Decisão pedida:** confirmar que houve ordem — e,
   se houve, L-ARQ-0084-B basta como registro. Se não houve, o que fica em aberto
   não é a migration (ela está aplicada e a aridade 6 é a única que existe), é
   **como uma migration marcada «não aplicar» foi aplicada**. Nada a desfazer foi
   proposto aqui.

9. **Os 38 casos de ausência do BLOCO 5 não têm controle.** L-ARQ-0084 disparou
   sozinha porque foi a única linha escrita com o comando e o valor esperado ao
   lado. As outras ausências estão anotadas em prosa: se qualquer uma ganhar
   arquivo ou efeito amanhã, **nada avisa**. **Decisão pedida:** vale escrever o
   controle das 38, ou o custo não paga? Não escrevi nenhum — é trabalho, e
   trabalho precisa de ordem.

10. **O vigia `agenda_orfaos_google()` nunca foi visto detectar nada**
    (L-VIGIA-ZERO). O zero medido é o zero de uma tabela vazia. **Decisão
    pedida:** autorizar o controle (inserir uma reserva vencida, conferir que a
    função devolve 1, remover), ou deixar o vigia sem prova até o primeiro
    agendamento real. Escrever em produção é ato; nada foi executado.

---

## REGISTRO DE ALTERAÇÕES (append-only)

- **17/08/2026** — criação. Medição de 87 entradas do ledger contra 65 arquivos
  em todos os refs. Corrige a premissa da ordem em três pontos (BLOCO 0).
  Achado principal no BLOCO 7.
- **17/08/2026, ainda antes do commit** — três correções minhas, todas no mesmo
  documento, todas antes de ele existir no repositório:
  1. **Aritmética.** Os subtotais do BLOCO 5 diziam "Numeradas (22)" e "Sem número
     (17)". As listas tinham 26 e 13. O total de 39 estava certo; os dois pedaços,
     errados. Corrigidos para 26 e 13.
  2. **L-ARQ-0026 medido.** A linha dizia "não determinado... merece verificação".
     Eu escrevi a pergunta e depois a respondi, com as quatro consultas anotadas.
     Virou classe nova: efeito no banco, registro em ledger nenhum.
  3. **Duas perguntas novas** (5 e 6) que só existem porque a 2 foi respondida.
  Anoto as três porque o documento nasce dizendo que linha escrita não se
  reescreve — e estas foram reescritas. A regra vale a partir do commit; até lá é
  rascunho, e o rascunho também merece ter a emenda declarada.
- **17/08/2026, depois do commit `6e73fa3`** — BLOCO 8: L-0073-B (a única órfã
  tinha arquivo), L-0073-C (duas afirmações falsas em código vivo), L-NNV-17
  (os 17 medidos nos dois bancos), L-0080-D (cabeçalho da 0085 corrigido).
  **Nenhuma linha anterior foi tocada.**
- **17/08/2026, ainda depois do commit** — **BLOCO 9**, a re-medição por
  LINHAGEM. Este bloco existe porque o BLOCO 8 respondeu à pergunta errada: ele
  mediu se o NOME da tabela existia nos dois bancos e reportou isso como "o
  arquivo está aplicado nos dois". O que ele corrige, nomeadamente:
  1. **L-NNV-17-B** corrige L-NNV-17 — a 0011 **não** rodou no xtv; "5 dos 9"
     vira **4 dos 9**; o `2/2` dela no xtv vira **0/2**.
  2. **L-ARQ-0026-B** corrige L-ARQ-0026 — o `profiles` do xtv **é** a tabela
     da 0001, literal; "não é a mesma coisa" valia como observação e não como
     afirmação de linhagem. A conclusão prática daquela linha continua de pé.
  3. **L-SEM-TABELA-8** corrige *"esta medição não os decide"* — os 8 arquivos
     sem tabela foram decididos, dois deles só pelo CORPO da função.
  4. **L-LINHAGEM-11** reduz a premissa *"no xtv só existem homônimos"* de todas
     para **3 de 11**, e separa homônimo **convergente** de **divergente**.
  5. **L-LEDGER-PISO** registra que o ledger do xtv começa em `0019_interesses`
     — 0001 a 0018 não têm registro nenhum, e para essa faixa não existe ledger
     a consultar.
  6. **L-REPRODUCAO** desmente uma frase minha: reproduzir a 0011 contra o xtv
     **não aborta**, roda limpa e alarga o acesso a `fornecedores`.
  7. **L-MEU-ERRO-0011** assume as três afirmações falsas que eu publiquei no
     cabeçalho da 0011, e nomeia a causa comum.
  8. Criado o **pedido nº 7**, citado por L-0073-C desde sempre e inexistente
     na lista. Respondido o **pedido nº 4** (DEIXAR E ANOTAR) por linha nova,
     **sem riscar** — riscar foi procedimento de rascunho, e o rascunho acabou.
  **Nenhuma linha anterior foi tocada.** As afirmações erradas continuam
  legíveis onde foram escritas, cada uma com a linha que a corrige apontando
  para ela.
- **19/08/2026** — **BLOCO 10**, escrito depois do apply da 0086 (ordem nominal,
  aplicada pela coordenação por MCP às 23:21:13 e 23:21:41 UTC). O ledger foi de
  **87 para 92** entradas. O que este bloco acrescenta e corrige:
  1. **L-DIV-0086** corrige BLOCO 0, BLOCO 2 e BLOCO 3 — as divisões a/b passam
     de **4 para 5**. É a primeira cujo motivo do enum foi **declarado antes** do
     apply, e não reconstruído depois.
  2. **L-NOME-0086** complementa BLOCO 4 — de 13 para **15** entradas com nome
     divergente do arquivo. Aqui **as duas** metades divergem, não só a `b`.
  3. **L-AGENDA-01** cria a linha das duas `agenda_01_*` de 18/08 e a marca
     **reconciliadas pela 0086a**, com a tabela objeto-a-objeto que sustenta o
     "no-op no xtv". *A ordem pedia para ANOTAR essa linha; ela não existia —
     este documento é de 17/08 e as entradas são de 18/08. Anotar linha
     inexistente seria inventar histórico, então ela nasce, datada.*
  4. **L-ARQ-0084-B** corrige L-ARQ-0084 — a 0084 **foi aplicada** em 18/08, e o
     controle que aquela própria linha escreveu disparou (`pronargs=6`: 0 → 1).
     Gera o pedido nº 8.
  5. **L-VIGIA-ZERO** declara que os "0 órfãos" da pós-checagem são o zero de uma
     **tabela vazia** — número certo, prova nenhuma. Gera o pedido nº 10.
  6. **L-RESERVA-SEGURA** registra o que a 0086b mudou no risco da grade, e liga
     a reserva órfã ao item `RESERVA-EXPIRA-01`, que ainda não existe.
  7. Criados os pedidos **8, 9 e 10**. O nº 9 nasce de uma observação sobre este
     documento: das 38 ausências do BLOCO 5, **nenhuma tem controle**; a única
     linha que tinha (L-ARQ-0084) foi a única que avisou sozinha.
  **Nenhuma linha anterior foi tocada.**
