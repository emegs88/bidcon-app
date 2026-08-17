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
