# FUNIL-01 · F3.1 — a deriva da lista desde a âncora

**Para o Emerson conferir, e é uma boa notícia.** A lista que você aprovou continua valendo **inteira**: nenhuma das linhas que passaram pela sua palavra mudou de classe. O que aconteceu foi só o mundo andar — chegaram conversas novas depois que a lista foi medida.

Este arquivo **não escreveu nada**. É leitura, como a lista.

> **A lista aprovada, `FUNIL-01_F3_candidatas.md`, fica intocada.** Ela é uma foto, e foto tem data. Este arquivo é o que mudou depois da foto.

---

## A âncora

A lista foi medida e commitada em **`706ef122`**, com data de commit `2026-09-03T01:51:12Z`. Essa é a âncora.

O relatório original **não imprimia o próprio contexto** — não havia `current_database()` nem `now()` na saída. É uma falha da régua, registrada aqui, e o `.sql` foi corrigido. A âncora precisou então ser reconstruída, e ela foi **confirmada em três tabelas independentes**:

| medida na âncora | deu | a lista dizia |
|---|---|---|
| conversas | 104 | 104 |
| extratos brutos | 34 | 34 |
| captações | 2 | 2 |
| *isca (conversas antes de 1999)* | 0 | tem de ser 0 |

A âncora também **não está no fio da navalha**, e isso importa: a 104ª conversa nasceu em `2026-09-02 22:10:49Z` e a 105ª só em `2026-09-03 12:03:29Z`. A âncora cai no meio de uma janela vazia de quase catorze horas. Qualquer instante dentro dela dá o mesmo resultado — o número 104 não depende de acertar o segundo.

### O critério, escrito para valer da próxima vez

**Uma âncora reconstruída só vale quando cai numa janela sem evento.**

Não é a data que a torna honesta. A data do commit é uma aproximação: o `git` marca quando alguém escreveu o arquivo, não quando a consulta leu o banco — entre um e outro passam minutos que ninguém registrou. Se a 105ª conversa tivesse nascido dois minutos depois da 104ª, a reconstrução seria um chute com cara de precisão, e o `104` sairia certo ou errado por sorte.

O que a sustenta é a **janela vazia**, medida em três tabelas ao mesmo tempo: qualquer instante dentro dela devolve o mesmo número, então errar o segundo não muda nada. Se a janela for estreita, a âncora reconstruída **não serve** e a lista precisa ser remedida, não remendada.

Daqui para a frente ninguém deveria precisar disto: a linha `(contexto)` no relatório imprime `current_database()` e `now()`, e a próxima lista já nasce com a âncora dentro dela. Este critério fica para quando alguém tiver de reconstruir a âncora de um artefato velho — e para que saiba quando **não** pode.

**Uma data redonda também não serviria.** `criado_em < '2026-09-03'` cortaria fora conversas do próprio dia 3 que já estavam nas 104. Régua torta dá número certo por acaso.

---

## O resultado: três adições, zero reclassificações

A mesma consulta rodou duas vezes, com dois cortes, e as classes foram comparadas linha a linha.

| corte | inserir | ligar | revisar | excluir | *(mesma chave)* |
|---|---|---|---|---|---|
| **com âncora** | **15** | **1** | **2** | **10** | 3 |
| hoje (05/09, 14:09Z) | 15 | 2 | 3 | 11 | 3 |

**Com a âncora, a lista se reproduz exatamente: 15 / 1 / 2 / 10.**

E a diferença é toda por **adição**:

| conversa | classe | o que é | por quê |
|---|---|---|---|
| `0b1efc86` | **ligar** | ADIÇÃO | conversa nova de 05/09 |
| `57bae87d` | **revisar** | ADIÇÃO | conversa nova de 03/09 |
| `dc20bb1e` | **excluir** | ADIÇÃO | conversa nova de 04/09 |

**Nenhuma linha aprovada mudou de classe. Nenhuma.**

Isso responde a hipótese que estava na mesa e que era razoável: *"uma das 15 aprovadas como `inserir` agora tem captação do site, e virou `ligar` sozinha"*. **Medido, e é falso.** A captação nova pertence a uma conversa nova. A sua palavra não envelheceu em nenhuma linha nomeada.

---

## As três conversas novas, nominalmente

### `0b1efc86` — Sadraque Andrade · `ligar`

`5511974834098` · agente `caetano` · tag `cedente` · 2 extratos, os 2 válidos · criada **05/09 03:30:07Z**

Última palavra do cliente: *05/09 03:44: [anexo sem nome/legenda]*

**Este é o caso que vale ler devagar.** A captação `15e35e30` (Sadraque de Andrade, `11974834098`, origem **site**, crédito R$ 101.542) nasceu em **05/09 03:29:56Z**. A conversa de WhatsApp nasceu **onze segundos depois**.

É a mesma pessoa entrando pelas duas portas quase ao mesmo tempo. E `captacoes.wa_conversa_id` está **nulo**: as duas linhas não se conhecem. Ninguém no time sabe, olhando uma, que a outra existe.

É exatamente para isso que a classe `ligar` existe, e é o custo do funil desligado, medido num caso real de anteontem — não em hipótese.

### `57bae87d` — Andre · `revisar`

`5511981720001` · agente **`prosperito`** · sem tags · sem extrato · criada **03/09 13:57:26Z**

Última palavra do cliente: *03/09 13:57: "Olá! Tenho interesse específico na cota Imóvel nº 791, da Porto Seguro, anunciada pela Bidcon: Crédito: R$ 121.490 Entrada: R$ 83.404 118 parcelas de R$ 492. Go…"*

**A régua não decide, e está certa em não decidir** — mas por um motivo que ela não sabe declarar. Lendo a mensagem, o Andre é **comprador**: ele quer uma cota que a Bidcon anuncia. Não é cedente. Cai em `revisar` porque o agente `prosperito` **não existe em nenhuma das listas da régua** — nem na dos agentes de captação (`caetano`, `tobias`), nem na dos agentes de compra (`valentina`, `serena`, `bento`, `aurora`).

Agente novo entrou em produção e o código não soube. O `else revisar` segurou — o desenho previu não saber — mas isto é achado, e vai para a fila como **`AGENTE-DESCONHECIDO-01`**: quando nasce um agente, alguma lista precisa saber, ou toda conversa dele vira trabalho manual em silêncio.

É também a terceira vez que a régua de texto levanta um **comprador** (junto com `e13b7227` e `054c72f6`). O padrão já tem nome.

### `dc20bb1e` — Igor Costa · `excluir`

`5527997485393` · agente `valentina` · sem tags · sem extrato · criada **04/09 11:55:29Z**

Última palavra do cliente: *04/09 13:18: "Mas e sobre o avalista? Como funciona? Toda já estão contempladas realmente? É só comprar?"*

Régua certa e sem dúvida: agente de compra, sem tag de cedente e sem extrato. É comprador, e a própria pergunta dele confirma.

---

## O que isto muda no backfill

Nada do que foi aprovado. Muda a **forma** de aprovar, e vira regra da casa:

1. **A rodada 1 do backfill leva a âncora no `where`.** Morde só quem existia até `2026-09-03T01:51:12Z` — as 104. O ensaio tem de reproduzir 15 / 1 / 2 / 10, e é sobre esse relatório que a palavra é reconfirmada.
2. **A rodada 2 é varredura, sem âncora e sem bloco nominal.** Pura régua, tratando as conversas novas exatamente como o gatilho ao vivo trataria. Roda depois de `FUNIL=on`.
3. **Lista nominal carrega âncora.** Aprovação por contagem envelhece sozinha, porque o banco anda enquanto a fatia é construída. A partir daqui, toda lista nominal declara o instante em que foi medida, e o relatório do ensaio imprime o diff desde ele.

O que pegou tudo isso foi um controle: `total de conversas no banco — deve ser 104`. Veio **115**. Um controle que só confirma o que você já espera não é controle.

---

## Contexto desta medição

| | |
|---|---|
| banco | `postgres` (xtv) |
| medido em | `2026-09-05 14:09:05Z` / `14:10:58Z` |
| âncora | `2026-09-03 01:51:12Z` (commit `706ef122`) |
| conversas hoje | 115 (104 na âncora, +11) |
| extratos hoje | 36 (34 na âncora, +2) |
| captações hoje | 3 (2 na âncora, +1) |
| iscas | corte inexistente = 0 · conversas antes de 1999 = 0 |
