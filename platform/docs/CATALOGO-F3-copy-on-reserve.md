# CATALOGO F3 — copy-on-reserve: RELATÓRIO ANTES DO CÓDIGO

Ordem do Emerson (despacho 28/08, item 4), literal:

> claim no xtv (update where status='disponivel') → cópia congelada no nnv com
> origem_xtv_id e valores do instante → reserva aponta à cópia → falha no meio
> libera o claim → órfão com prazo + vigia (padrão 0086)

Este documento é **relatório**, não implementação. Nenhuma linha de código de
produção foi escrita para o F3. Data da medição: **29/08/2026**.

---

## 0. O ACHADO QUE MUDA A LEITURA DA ORDEM

**Existem DUAS tabelas `reservas`, uma em cada projeto, e elas não se conhecem.**

| | `xtv.reservas` | `nnv.reservas` |
|---|---|---|
| linhas | 4 | 2 |
| chave do estado | `status` text: `ativa\|convertida\|cancelada` | `state` text, default `DRAFT` |
| prazo | `expira_em` default `now()+48h` | `valid_until`, `deposit_expires_at` |
| identidade da carta | `carta_id` FK → `xtv.cartas` **ON DELETE SET NULL** | `carta_id` FK → `nnv.cartas` **rígida** |
| dinheiro | nenhum | `price_total`, `signal_amount`, `fee_plan`, `settlement_rail='NOTARIAL'` |
| rateio | nenhum | `reserva_legs` |
| auditoria | nenhuma | `reserva_eventos` com `prev_hash`/`hash` encadeados |
| quem escreve | `app/api/atende/route.ts` (fluxo `[[RESERVAR]]` do chat) | `lib/reserve/*` |

A de cima é uma **etiqueta de vitrine**: segura a carta 48h para o lead não
receber "já foi" no meio da conversa. A de baixo é a **operação financeira**.

A ordem do F3 não está pedindo para mexer numa das duas. Está pedindo a **ponte**
entre elas — e a ponte é obrigatória, não estilística, por um motivo medido:

```
nnv: reservas_carta_id_fkey  FOREIGN KEY (carta_id) REFERENCES cartas(id)
```

Uma reserva no nnv **não consegue** apontar para uma carta do xtv. O banco recusa.
Ou a carta é copiada para o nnv, ou a FK cai. A cópia congelada que a ordem pede
não é preferência de desenho: é a única forma de honrar a FK que já está lá.

---

## 1. MEDIÇÃO CRUA (29/08/2026)

### 1.1 Estoque e claim

```
xtv.cartas          total 109.614
  disponivel          2.316
  reservada               0     <-- o estado existe no enum e NUNCA foi usado
  vendida                 0
  indisponivel      107.298

enum status_carta: disponivel | reservada | vendida | indisponivel
```

`reservada = 0` com 4 reservas na vida da casa. **Reservar não faz claim hoje.**
Não é bug escondido — é decisão escrita, em `app/api/vitrine/route.ts:14`:

> `cartas.status` NUNCA muda quando uma reserva é criada — só a view filtra.

### 1.2 As 4 reservas do xtv

```
id         status      origem  criado_em     expira_em     vencida  carta
4f2c933b   cancelada   teste   09/07 19:44   11/07 19:44   sim      indisponivel
460ac600   ativa       chat    15/08 15:36   17/08 15:36   sim      disponivel
e114508e   ativa       chat    18/08 02:28   20/08 02:28   sim      disponivel
a4409d02   ativa       chat    21/08 22:03   23/08 22:03   sim      indisponivel
```

**Três linhas `ativa` e vencidas.** A mais velha venceu há 12 dias. Nada nunca as
fechou. Medido: o projeto xtv **não tem pg_cron** (`relation "cron.job" does not
exist`), e não há rota que expire reserva. `convertida` nunca foi usada.

Isso não está quebrando a vitrine hoje — a view e o `lib/simulador/data.ts` ambos
filtram `expira_em > now()`, então a linha vencida é inerte para quem lê. Mas
`status='ativa'` deixou de significar "ativa": significa "nasceu e ninguém
voltou". Qualquer código futuro que confie no `status` sozinho vai errar.

### 1.3 A exclusão é por fingerprint, e fingerprint não é identidade

```sql
carta_fingerprint(tipo, credito, entrada, parcela, parcelas, adm)
  = md5(tipo|credito*100|entrada*100|parcela*100|parcelas|adm)
```

`vw_vitrine_viva` esconde a carta assim:

```sql
NOT EXISTS (SELECT 1 FROM reservas r
            WHERE r.status='ativa' AND r.expira_em > now()
              AND r.fingerprint = c.fingerprint)
```

O fingerprint é hash de **atributos**, não da carta. Duas cartas idênticas de
fornecedores diferentes colidem de propósito. Medido na vitrine de hoje:

```
cartas na vitrine .................. 2.296
fingerprints distintos ............. 2.253
fingerprints com mais de uma carta ..... 35
cartas dentro desses grupos ............ 78
maior grupo ............................. 5
```

**Reservar uma carta de um grupo de 5 esconde as 5.** É defensável para a etiqueta
de vitrine (são ofertas indistinguíveis; mostrar as outras 4 seria mostrar a mesma
coisa). É **indefensável para o claim do F3**, porque o claim precisa dizer *qual
linha* saiu do estoque — e `fornecedor_id` é justamente o que diferencia as 5.

### 1.4 A corrida não tem rede

```
reservas_pkey            UNIQUE (id)
idx_reservas_fp_ativas   INDEX (fingerprint) WHERE status='ativa'   <-- NÃO é UNIQUE
```

`app/api/atende/route.ts:374-411` é um **check-then-insert**: consulta reserva
ativa (linha 375), e se não achar, insere (linha 404). Entre as duas não há
transação, nem `for update`, nem índice único. Dois `[[RESERVAR]]` simultâneos no
mesmo fingerprint **passam os dois**. O índice existe e chega a parecer a trava —
mas é índice de leitura, não restrição.

Isto é exatamente o defeito que a 0086 documenta e conserta na agenda (trava 2).

### 1.5 A cópia congelada JÁ EXISTE — no lugar errado

`app/api/atende/route.ts:420-432` monta um `snapshot` com os valores do instante
(`ref, tipo, credito, entrada, parcela, parcelas, adm`) e grava em
`interesses.snapshot`. Ou seja: metade do que o F3 pede já está de pé.

O problema é a hierarquia declarada logo acima, na linha 417:

> falha aqui não desfaz a reserva nem finge erro ao cliente — a reserva em si é a
> fonte de verdade

**A reserva é autoritativa e a cópia é esforço-melhor.** O F3 inverte isso: a
cópia congelada passa a ser o objeto que a reserva referencia, então cópia que
falha *tem* que derrubar o claim. A regra da linha 417 não sobrevive ao F3 — e
mudá-la é uma decisão consciente, não um detalhe de refatoração.

### 1.6 O destino da cópia, e o precedente que já existe

`nnv.cartas` tem 2 linhas e **não tem `origem_xtv_id`**. Mas o padrão de ponteiro
entre projetos já foi resolvido uma vez nesta casa:

```
nnv.cedente_cartas.carta_xtv_id  uuid NOT NULL, SEM FK
comentário: "vínculo entre um profile (nnv) e uma carta (xtv, carta_xtv_id sem
             FK — projetos distintos)"
```

O F3 deve seguir esse precedente (coluna uuid sem FK, nome e comentário
explicando por quê), não inventar um terceiro estilo.

### 1.7 Ledgers (de onde sai o número da migração)

```
xtv  0092_radar_conteudo_vazio         (0089 aparece DUAS vezes no ledger)
nnv  0073_revoke_anon_buscar_cartas_semantica
     diretório migrations-nnv/ para em 0072 — 0070 não tem arquivo
```

Próximos números **pela regra da casa** (derivar do ledger do projeto-alvo E do
diretório, no momento de aplicar): xtv `0093`, nnv `0074`. Reconferir na hora — o
diretório e o ledger divergem nos dois projetos.

---

## 2. OS SEIS DEFEITOS, EM ORDEM DE GRAVIDADE

| # | defeito | evidência |
|---|---|---|
| 1 | reservar não faz claim | `reservada = 0` em 109.614 |
| 2 | check-then-insert sem índice único | `idx_reservas_fp_ativas` não é UNIQUE |
| 3 | claim por fingerprint esconde irmãs | 78 cartas em 35 grupos, maior = 5 |
| 4 | reserva vencida nunca fecha | 3 linhas `ativa` vencidas, sem pg_cron |
| 5 | cópia congelada é esforço-melhor | `route.ts:417` diz isso por escrito |
| 6 | nenhum vigia olha reserva | `radar_alertas` não tem tipo de reserva |

---

## 3. DESENHO PROPOSTO

### 3.1 O claim (xtv) — trava, não combinado

Lição literal da 0086 §2.2, que vale igual aqui:

> se `'reservando'` ficar de fora [da EXCLUDE], duas pessoas reservam o mesmo
> horário ao mesmo tempo e as duas passam — que é o defeito que a trava 2 existe
> para impedir

Traduzido para cartas: **o claim tem que estar DENTRO da restrição de unicidade,
ou a restrição é enfeite.**

- `cartas.status` passa a receber `'reservada'` no claim. O valor já existe no
  enum — não precisa `ALTER TYPE`, e portanto não precisa da separação a/b que a
  0086 precisou (`ALTER TYPE ... ADD VALUE` não roda na mesma transação que o uso).
- O claim é `UPDATE cartas SET status='reservada' WHERE id=$1 AND
  status='disponivel' RETURNING id`. **Zero linhas devolvidas = alguém chegou
  antes.** É o próprio UPDATE que serializa; não há janela entre checar e agir.
- `cartas` ganha `reserva_expira_em timestamptz` + CHECK
  `status <> 'reservada' OR reserva_expira_em IS NOT NULL` — cópia direta da
  trava 3 da 0086 (`0086:259-263`). Claim sem prazo não existe.
- Índice parcial `(reserva_expira_em) WHERE status='reservada'`, como `0086:328`.

**Consequência que precisa ser dita:** com claim de verdade, a exclusão por
fingerprint da view passa a ter um segundo dono. Uma carta `reservada` já sai da
view pelo `status='disponivel'`. As 4 irmãs de fingerprint **continuam
aparecendo** — o que é o comportamento certo, e é uma mudança visível de
comportamento da vitrine. Não dá para entregar o F3 e fingir que a vitrine não
mudou.

### 3.2 A cópia (nnv) — congelada e autoritativa

`nnv.cartas` ganha:
- `origem_xtv_id uuid` — sem FK, seguindo `cedente_cartas.carta_xtv_id`
- `origem_congelada_em timestamptz`
- UNIQUE parcial em `origem_xtv_id` onde não nulo — uma cópia por carta de origem,
  senão duas reservas geram duas cópias divergentes da mesma carta.

Valores copiados: os do instante do claim, **lidos do `RETURNING` do UPDATE**, não
de uma segunda leitura. Segunda leitura reabre a janela que o claim fechou.

`fornecedor_id` **não atravessa**. É a regra permanente da casa, e aqui ela tem
mordida extra: a cópia vive no projeto do portal logado.

### 3.3 A falha no meio, e o que a torna verificável

Ordem: `claim (xtv)` → `cópia (nnv)` → `reserva aponta à cópia (nnv)`. São dois
bancos: **não existe transação que cubra os três.** Portanto o desenho não pode
prometer atomicidade; tem que prometer *detectabilidade*.

- Falhou a cópia ou a reserva → compensação imediata: `UPDATE cartas SET
  status='disponivel', reserva_expira_em=NULL WHERE id=$1 AND status='reservada'`.
- A compensação também pode falhar (processo morto, rede caída). É por isso que
  `reserva_expira_em` existe: **o prazo é a rede que pega o que a compensação
  perdeu.**

### 3.4 O órfão e o vigia (padrão 0086, literal)

`agenda_orfaos_google` é **detector puro** (`stable`, não escreve) e quem abre e
fecha alerta é o RADAR via `radar_registrar`/`radar_resolver` (`0086:333-375`).
O F3 copia essa forma:

- `cartas_reservadas_orfas(p_carencia_minutos int default 15)` — `stable`, não
  escreve, devolve carta, há quanto tempo venceu, e se existe reserva viva
  apontando para a cópia.
- Dois motivos distintos, como a 0086 faz (`reserva_expirada` vs
  `pendente_sem_evento`):
  - `claim_expirado` — `status='reservada'` e prazo vencido
  - `claim_sem_reserva` — claim vivo, mas nenhuma reserva no nnv aponta para a
    cópia (a falha no meio que a compensação perdeu)
- `revoke all ... from public, anon, authenticated; grant execute ... to
  service_role` (Regra 1, como `0086:383`).
- VIGIA 11 na varredura, ligado como o 10: `marcar()` **depois** do guard da
  Regra 19; `null` não julga, e vira aviso em `avisos[]`.
- **Controle da Regra 9:** o teste tem que provar que o vigia *grita* contra a
  medição real. Hoje a medição real seria zero (nunca houve claim), então o
  controle precisa ser um caso construído, e isso tem que estar escrito no teste —
  senão o vigia nasce sem prova de que sabe gritar.

---

## 4. O QUE ESTE RELATÓRIO NÃO RESOLVE — decisões do Emerson

1. **A vitrine muda de comportamento** (§3.1): as irmãs de fingerprint param de
   sumir junto. É o certo, e é visível. Confirma?
2. **A linha 417 do `atende/route.ts` cai**: a cópia passa a poder derrubar a
   reserva. Hoje está escrito o contrário.
3. **Prazo do claim.** A 0086 usa carência de 15min para o órfão. Reserva de
   vitrine hoje é 48h. São coisas diferentes: sugiro claim curto (minutos, é só a
   travessia técnica) e mantido o 48h como prazo comercial da reserva. Falta
   número.
4. **As 3 reservas `ativa` vencidas**: fecho como `cancelada` numa migração de
   dados, ou ficam como estão? Elas são inertes hoje, mas viram ruído no primeiro
   vigia que olhar `status` sem olhar `expira_em`.
5. **RESERVA-EXPIRA-01 está na fila (item 8) e colide com este item.** O expirador
   e o claim mexem na mesma máquina. Ou o F3 absorve o expirador, ou o item 8 sai
   da fila. Pedir os dois separados é pedir dois donos para a mesma trava.

---

## 5. FORA DE ESCOPO, REGISTRADO

- Unificar as duas `reservas` num modelo só. É reescrita da operação financeira,
  não cabe no F3.
- Trocar a exclusão por fingerprint da `vw_vitrine_viva` por exclusão por `id`.
  O claim já resolve o caso do F3; mexer na view é fatia própria, e cai dentro
  das janelas 08h50–09h10 / 14h50–15h10.
- Backfill de `origem_xtv_id` nas 2 linhas que já existem em `nnv.cartas` — elas
  não vieram do xtv.
