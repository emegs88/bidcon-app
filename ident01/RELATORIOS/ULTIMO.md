# IDENTIDADE-01 — ÚLTIMO RELATÓRIO

**Canal definitivo.** Este arquivo é sobrescrito a cada relatório e empurrado
para o origin imediatamente. A arquitetura lê aqui, no origin — não no chat.
Colagem de relatório no canal de conversa: proibida.

- **Gerado em:** 03/08/2026
- **Commit base do repo no momento da escrita:** `62def0c`
- **Substrato medido:** `xtvjpnyadcdeadhmzyff` (xtv, produção)
- **Autor do ato:** mão do repo/app (a mão de migrations é a arquitetura)

---

## §0. VEREDITO EM UMA LINHA

A medição da arquitetura está **inteiramente correta**. As mudanças do app não
estão no origin. **Mas não é deploy que falhou: é deploy que nunca foi
escrito.** Prova abaixo. E o deploy **não foi executado agora** porque a
palavra curta de Emerson **não consta desta sessão** — a condição que a própria
arquitetura impôs.

---

## §1. CONFIRMAÇÃO INDEPENDENTE DAS TRÊS MEDIÇÕES DA ARQUITETURA

Medido por esta mão, no `origin/main`, não no disco local.

### 1.1 — Payload do widget sem `id`: CONFIRMADO

`git show origin/main:public/prosperito-widget.js` → 546 linhas.

```
354:  var ref = a.getAttribute('data-ref');
491:    +'<button type="button" class="pw-carta-cta" data-ref="'+ref+'" data-tipo="'+pwEsc(c.tipo||'')+'" data-credito="'+pwEsc(c.credito||'')+'" data-entrada="'+pwEsc(c.entrada||'')+'" data-parcela="'+pwEsc(c.parcela||'')+'" data-nparcelas="'+pwEsc(c.nparcelas||'')+'" data-custo="'+pwEsc(c.custo||'')+'">Quero esta</button>'
527:  var ref = btn.getAttribute('data-ref') || '';
```

`grep -n "data-id"` → **nenhuma ocorrência**. A janela completa do botão
(linha 491) está colada acima: emite sete atributos, **nenhum deles `data-id`**.

### 1.2 — Zero `id:` no html: CONFIRMADO

`git show origin/main:public/index.html` → 1671 linhas.

```
grep -c "id:" → 0
```

Três chamadas de `abrirProsperitoComCarta` (duas no bloco minificado da linha
1334, uma na linha 1471). Todas passam o mesmo objeto:

```
abrirProsperitoComCarta({ref:...,tipo:...,credito:...,entrada:...,parcela:...,
                         nparcelas:...,adm:...,fonte:...,n:...,custo:...})
```

`ref` e `n` — ambos derivados de `a.n`, que é o `numero_externo`. Nenhum `id`.

### 1.3 — `cotas-extra` ausente do bidcon-app: CONFIRMADO, e localizado

```
$ git -C bidcon-app  ls-files | grep -i cotas-extra
(nenhum arquivo cotas-extra rastreado no bidcon-app)

$ git -C prospere-360 ls-files | grep -i cotas
app/api/cotas-extra/route.js
app/api/cotas-jsonld/route.js
app/api/cotas-servopa/route.js
app/api/cotas/route.js
public/cotas.js
```

**Declarado: `cotas-extra` mora no `prospere-360` (= `emegs88/360prospere`),
em `app/api/cotas-extra/route.js`. O `id: i + 1` está na linha 330.** Não é
arquivo do `bidcon-app` e nunca foi.

---

## §2. POR QUE O SUBSTRATO ESTÁ ASSIM — E POR QUE NÃO CONTRADIZ ESTA MÃO

O que os commits desta sessão tocaram, cru:

```
--- 62def0c ERRATA-1 no diff_app
ident01/CORRECAO-2_diff_app.md

--- 16add7c ANEXO-1 da spec
ident01/IDENTIDADE-01_spec_ANEXO-1.md

--- b8760b4 CORRECAO-2 reconstruida do zero + CLAUDE.md Regra 6
CLAUDE.md
ident01/CORRECAO-2_diff_app.md
ident01/CORRECAO-2_view_NAO_APLICAR.sql

--- 8b1aae4 aterramento — estado real medido no xtv
ident01/CORRECAO-2_estado_real_NAO_APLICAR.md
```

**Nenhum commit desta sessão tocou `public/`, `app/` ou `platform/`.** Os itens
D-1..D-5 foram *propostos* em `CORRECAO-2_diff_app.md` e nunca escritos em
arquivo. O substrato não diverge de nenhum relatório desta mão: ele bate
exatamente com o que foi feito, que foi documento — não deploy.

Se um relatório anterior a esta sessão afirmou deploy, esse relatório é da
mesma família do incidente de 02/08 e está refutado por este `git log`.

---

## §3. INCIDENTE DE MEDIÇÃO NESTA SESSÃO — DECLARADO

Ao iniciar esta varredura, um bloco de comandos falhou: `cd` retornou
`too many arguments` e **o bloco inteiro rodou fora do repositório**, com o
shell colapsando quebras de linha (o `grep` chegou a receber `echo` como nome
de arquivo). A saída daquele bloco dizia `(nenhum data-id/data-ref)` e
`AUSENTE do bidcon-app` — **falso-negativos de comando quebrado, não medições.**

Foram descartados e tudo foi refeito com `git -C`. As conclusões do §1 vêm
apenas da segunda rodada. Registrado aqui porque um falso-negativo que por
acaso concorda com a hipótese é exatamente como se fabrica um relatório
fictício sem má-fé.

---

## §4. 0064 — MEDIDA NO AR PELA MÃO DO REPO

Aplicada pela arquitetura. Verificação pós-aplicação (V1–V7 do SQL irmão):

```
migrations_recentes:
  20260803014919 create_farol_log
  20260803013639 0064_correcao2_view_id_invoker      <-- 0064 APLICADA
  20260802191207 0063_identidade_estavel_fingerprint
  20260728204311 consorcios_comissoes_multi_administradora

colunas vw_cartas_publicas:
  ref, tipo, credito, entrada, parcela, parcelas, custo_am, administradora, atualizado, id
                                                                                       ^^ id no fim
reloptions vw_cartas_publicas: security_invoker=true

V1_linhas_vw_cartas_publicas .... 2549
V2_linhas_vw_vitrine_viva ....... 2549
V3_ids_nulos .................... 0
V4_ids_distintos ................ 2549
V5_reloptions_vitrine_viva ...... (null=definer)
V6_reservas_total ............... 1
V7_rpc_buscar_cartas_rowtype .... SETOF vw_cartas_publicas
```

**Verde.** `id` entrou no fim (respeitando o limite do `CREATE OR REPLACE
VIEW`), sem nulos, `2549` distintos para `2549` linhas — identidade real, um
por linha. `V1 == V2`: nada vazou e nada sumiu. A RPC continua com o rowtype
da view, contrato preservado.

### RESERVA-VIS-01 — estado após o invoker

```
reservas: 1 linha
  status = 'cancelada' | origem = 'teste' | nome = 'TESTE-SISTEMA'
  expira_em = 2026-07-11 (vencida)
policies_em_reservas = 0
```

A externa virou `security_invoker=true`, mas **`vw_vitrine_viva` continua
`(null=definer)`**. O `NOT EXISTS (reservas)` mora na interna, que segue
rodando como dono — a ocultação não depende do contador estar zerado, depende
do definer da camada de baixo. A única linha de `reservas` está `cancelada` e
vencida, logo **reservas ativas = 0**.

`RESERVA-VIS-01` permanece **latente, não ativa**, exatamente como nomeado no
ANEXO-1. O risco real é futuro: se algum dia a interna virar invoker, ou se
`reservas` ganhar linha ativa sem ganhar policy, a ocultação cai em silêncio.
`policies_em_reservas = 0` continua sendo a dívida de fundo.

---

## §5. DEPLOY DO APP — NÃO EXECUTADO. MOTIVO.

A condição posta pela arquitetura tem três partes:

| condição | estado medido |
|---|---|
| 0064 no ar | **CUMPRIDA** (§4) |
| ATO C (varredura do 360prospere) | **NÃO CUMPRIDA** — anunciada, não executada |
| palavra curta de Emerson | **NÃO CONSTA desta sessão** |

Varri o histórico desta sessão em busca de confirmação curta de Emerson
autorizando o deploy do app. **Não há.** Todas as mensagens vieram pelo canal
da arquitetura. A menção mais recente a essa palavra a coloca no futuro:
*"o deploy do app volta a você, sob confirmação curta de Emerson"* e
*"Deploy do app: só após ATO C + 0064 no ar + confirmação curta de Emerson."*

A instrução deste ciclo é explícita nos dois ramos: *"Se a palavra ainda não
veio, aguarde-a."* **Aguardando.** Não deduzo a palavra a partir do fato de o
resto estar pronto — foi exatamente assim que a frase truncada
`AUTORIZO IDENTIDADE-01 CORRECAO-` foi recusada, e a arquitetura ratificou a
recusa.

Duas coisas ficam prontas para o instante em que a palavra vier:

1. O banco já entrega `id`. O bloqueio do deploy é só de autorização, não
   técnico.
2. O checklist está fechado e é o que segue no §6.

---

## §6. CHECKLIST DO DEPLOY — CONGELADO, AGUARDANDO PALAVRA

Na ordem, um ato por mensagem, saída crua junto:

1. **snapshot com `id`** — a fonte do snapshot passa a projetar `id` da
   `vw_cartas_publicas` (que já o tem, §4).
2. **`index.html`** — `id` no objeto de `abrirProsperitoComCarta` (3 sítios:
   dois no bloco 1334, um no 1471) e no modal.
3. **widget servido** (`public/prosperito-widget.js`) — emitir `data-id` na
   linha 491 e lê-lo na 527; hoje só há `data-ref`.
4. **`/api/atende`** — chavear por `id`, com fallback para `ref` e guarda 4b.
5. **`cotas-extra` → `id` real** — no `prospere-360`, `app/api/cotas-extra/route.js:330`.
   `id: i + 1` sai; entra o uuid verdadeiro. **Antes de trocar: localizar os
   consumidores da rota.** Se algum depender da posição, o campo legado
   sobrevive como `idx`, declarado, e `id` passa a ser o uuid — nunca os dois
   significados no mesmo nome.

**Regra de fundo (D1):** id fabricado por índice não coexiste com id real no
mesmo ecossistema. Enquanto o passo 5 não fecha, existem dois `id` com
significados diferentes em produção.

**Evidência exigida do ato:** commit + push + build verde + amostra do payload
novo — tudo dentro deste arquivo.

---

## §7. PRÓXIMO ATO DESTA MÃO

**ATO C** — varredura do `emegs88/360prospere`: `ref` / `numero_externo` / `id`
nas superfícies de leitura, `arquivo:linha`, evidência crua; e localização dos
consumidores de `/api/cotas-extra` antes de qualquer troca. Sem escrita naquele
repo antes do diff.

O deploy do app (§6) só depois da palavra curta de Emerson.

=== FIM DO RELATÓRIO ===
