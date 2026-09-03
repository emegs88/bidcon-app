# FUNIL-01 · F3.1 — as candidatas a virar captação

**Para o Emerson conferir.** Medido no xtv em **03/09/2026**. Esta lista **não escreveu nada**: ela é leitura. Nenhuma linha desceu para `captacoes` e nenhuma vai descer sem a sua palavra.

A consulta que produziu esta lista é `ident01/RELATORIOS/FUNIL-01_F3_candidatas.sql`, ao lado deste arquivo. Ela roda pela porta e pode ser rodada de novo a qualquer momento — se o resultado mudar, mudou o banco, não a régua.

---

## O que está em jogo

De 104 conversas de WhatsApp, quais são **cedentes** — gente querendo vender cota — que deviam existir como linha em `captacoes` e não existem.

| | |
|---|---|
| **inserir** | vira linha nova em `captacoes`, origem `whatsapp`, status `novo` |
| **ligar** | já existe captação com o mesmo telefone; liga as duas, não cria uma segunda |
| **revisar** | **a régua não decide.** Vai para você com o motivo escrito |
| **excluir** | não é captação, com o motivo escrito |
| *(mesma chave)* | não é classe de destino: é o telefone duplicado, mostrado de propósito |

**Resultado: 15 inserir · 1 ligar · 2 revisar · 10 excluir · 3 duplicados.**

---

## Como as conversas foram achadas

Três réguas, e elas não concordam entre si:

1. **A tag `cedente`** posta por quem atendeu. Acha pouco: 94 das 104 conversas não têm tag nenhuma.
2. **O agente que atendeu.** `caetano` (captação) e `tobias` (atende os dois lados) concentram as candidatas — 22 conversas. `valentina`, `serena`, `bento`, `aurora` são compra: nunca cedente.
3. **O texto do cliente.** Só o que o **cliente** escreveu, nunca o que a casa escreveu — o agente da casa fala "vender consórcio" o dia inteiro, e ler as nossas próprias mensagens acharia cedente em quase toda conversa. É a régua mais barulhenta: levanta mais 6, e todas as 6 caíram em `excluir`.

**O telefone foi comparado por DDD + últimos 8 dígitos**, e não pelo número inteiro, porque o mesmo cedente aparece com e sem o nono dígito nas duas pontas. Foi assim que o Leandro foi achado, e foi assim que apareceram três telefones duplicados que ninguém tinha visto.

---

# 🟢 INSERIR — 15

Nenhuma exclusão se aplica a nenhuma destas. **A lista de trabalho é esta.**

### Com extrato de cota já lido — 7

| conversa | telefone | crédito · saldo · pagas · administradora | última palavra do cliente |
|---|---|---|---|
| `3e98b925` **Romullo Carvalho S.** | 5511995504423 | 22.353,30 · 25.497,96 · 8 · *(não lida)* | 19/08: "1" |
| `8a2d5bea` **Valmir Jose Moreira** | 5511984460861 | 164.597,39 · 42.704,49 · 156 · XS5 (Caixa Consórcio) | 21/08: "Boa tarde, estive analisando o documento e percebi que a informação que você me pede já encontra-se anexa no mesmo, conforme print" |
| `070346e9` **Rafael Dutra** | 554884486309 | 1.061.000,00 · 679.917,80 · 20 · EMBRACON | 31/08: "Certo, obrigado" |
| `4ca5759f` **Joao Gabriel** | 553492060663 | 106.100,00 · 116.039,40 · 20 · *(não lida)* | 11/08: "Certo" |
| `bff43e9c` **Edjelson Henrique** | 5512991398737 | 125.303,66 · 116.539,11 · 59 · Porto Seguro | 11/08: "Caso alguém reservar vcs avisa? E normalmente vende rápido?." |
| `d5e238a6` **Ariel de Sa Machado** | 5511999842474 | 49.674,00 · 9.612,32 · 58 · *(não lida)* | 27/08: "CNH-e.pdf.pdf" |
| `0d9d74d9` *(sem nome)* | 553496897791 | 260.650,00 · *(nulo)* · *(nulo)* · Santander | 06/08: *(anexo sem legenda)* |

**`3e98b925` Romullo é o topo da fila por palavra sua (02/09):** documentos do contrato entregues em 20/08 e sem resposta desde então. É a única linha desta lista inteira que entrou por decisão sua e não por régua.

**Valmir (`8a2d5bea`) está esperando alguém.** A última coisa que ele disse é que o documento pedido já estava anexado — o que sugere que a bola está do nosso lado.

### Sem extrato lido — 8

| conversa | telefone | sinais | última palavra do cliente |
|---|---|---|---|
| `3c97c85e` **Rene Almeida** | 5511974900163 | caetano · tag cedente | 18/08: "Olá! Quero vender minha carta de consórcio contemplada pela bidcon. • Nome: Rene Almeida • WhatsApp: 11974900163 • Tipo de bem: Imóvel • Val…" |
| `dd15dc6b` **Luiz Guilherme Zanzarini Claudio** | 5515997534582 | caetano | 05/08: "Olá! Quero vender minha carta de consórcio contemplada pela bidcon. • Nome: Luiz Guilherme Zanzarini Claudio • WhatsApp: 15997534582 • Tipo…" |
| `d00854d6` **Carlos Diniz** | 553195703349 | caetano | 07/08: "Olá! Quero vender minha carta de consórcio contemplada pela bidcon. • Nome: Carlos Diniz • WhatsApp: +5531995703349 • Tipo de bem: Veículo •…" |
| `dea9330b` **Kauê** | 554999197497 | tobias · tag cedente | 12/08: "1" |
| `3f09018c` **Deus É Fiel** | 5521995024285 | caetano · tag cedente | 23/08: *(mensagem vazia)* |
| `88003de4` **Dani 🧜‍♀️** | 554797877918 | caetano · tag cedente | 20/08: *(mensagem vazia)* |
| `7cfa67f6` **🤞** | 5511933888266 | caetano · 2 extratos que não passaram | 21/08: *(anexo sem legenda)* |
| `f111dae1` *(sem nome)* | 5511993335970 | caetano | 06/08: "vcs tem qnt tempo de mercado?" |

**Rene, Luiz Guilherme e Carlos escreveram a mesma frase do formulário do site** — são leads que vieram de lá e caíram no WhatsApp. Rene e Carlos são os dois nomes que a coordenação já tinha separado para a CAPTACAO-OFERTA-01.

**`7cfa67f6` mandou dois extratos e nenhum dos dois foi lido com confiança suficiente.** A cota existe; o que faltou foi a leitura. Vale um olho.

---

# 🔵 LIGAR — 1

### `b506938f` **Leandro** → captação `fa8f1ffd`

| | |
|---|---|
| **telefone da conversa** | 558281131987 |
| **telefone da captação** | 82981131987 |
| **chave que uniu os dois** | `8281131987` |
| **captação já existente** | Leandro Bittencourt Miranda · origem **site** · status **novo** · crédito **131.000,00** |
| **extrato da conversa** | 131.163,29 · saldo 132.583,12 · 43 pagas · Porto Seguro |
| **última palavra do cliente** | 31/08: *(anexo sem legenda)* |

**Esta é a linha que justifica a régua nova.** Os dois números são o mesmo homem: um tem o nono dígito, o outro não. Nenhuma comparação de telefone que a casa tinha antes juntava os dois — o cadastro do site e a conversa do WhatsApp viveriam como duas pessoas.

A ponte **liga** a conversa à captação que já existe e **não toca no crédito**: o site diz 131.000,00 e o extrato diz 131.163,29, e quem decide qual vale é você, não a ponte.

---

# 🟡 REVISAR — 2

**A régua não decidiu, e não vamos decidir por você.** As duas foram atendidas pelo `tobias`, que atende comprador e vendedor, e nenhuma tem tag nem extrato. O texto levantou suspeita e só.

### `2605be05` **Leonardo Santana** — 5511966058743
> 01/09: "Quais delas exatamente entram nesses cenários?"

Conversa viva — falou anteontem. Está perguntando sobre regras, e não dá para saber pelo texto se ele quer vender a dele ou comprar a de alguém.

### `3dee4bb3` *(sem nome)* — 554884906166
> 05/08: "1"

Respondeu um menu com "1" em 05/08 e não voltou. Sem nome, sem tag, sem extrato.

---

# 🔴 EXCLUIR — 10

## Por pedido do próprio cliente — 1

### `042a6def` — 554399161888 · **OPT-OUT**
> 20/08: **"Não quero receber"**

Extrato lido com confiança alta: **180.000,00** · saldo 143.561,69 · 10 pagas · UNIFISA. É a maior carta desta lista inteira e **ela não entra assim mesmo**.

Se virasse captação, viraria card na mesa com próxima ação, e alguém ligaria para quem pediu para não ser procurado. Este é o único erro desta lista que sairia da casa e chegaria no cliente. **Compliance vence régua e vence palavra** — inclusive a sua.

> Se um dia quisermos falar com ele, isso é uma decisão sua, tomada de fora desta lista e por outro caminho. A ponte nunca vai fazer isso sozinha.
>
> *(O telefone dele aparece duas vezes no banco — `c18265f6` é a mesma pessoa sem o nono dígito. Ver os duplicados no fim.)*

## Por palavra sua — 4

| conversa | telefone | o que você disse (02–03/09) | última palavra do cliente |
|---|---|---|---|
| `cda21b11` **Bruce Freitas** | 5521982548357 | é corretor, não cedente → **funil de parceria** | 31/08: "ok" |
| `b3372777` *(sem nome)* | 553791972348 | cota **não contemplada** não é captação → funil próprio | 06/08: *(anexo sem legenda)* |
| `fc14bc83` *(sem nome)* | 5521981599181 | **cota cancelada** | 05/08: "Cancelada 03/07/2026" |
| `ee6271c4` **R** | 554797186871 | **negócio não fechou** | 01/09: "Hoje ainda vai chegar a minuta ?" |

**Sobre `ee6271c4`:** esta é a conversa da Tamires. O extrato dela foi lido — 50.000,00 · saldo 42.977,14 · 4 pagas · Multimarcas — e ela ainda estava perguntando pela minuta em 01/09. Conforme sua palavra, a captação `6d4f46ea` (Tamires, origem site, crédito 66.000,00) vai receber **status `perdida`** como exceção nominal no backfill, e esta conversa **não vira captação nem liga em nada**.

> **Um ponto que precisa ficar dito:** o telefone da conversa (`554797186871`) e o da captação da Tamires (`47988117408`) são **assinantes diferentes** no mesmo DDD 47 — não é o mesmo número com e sem o nono dígito. Nenhuma régua liga os dois. O vínculo entre a conversa e a captação é humano, e ele existe porque você sabe, não porque o banco mostra.
>
> *(O telefone desta conversa também aparece duas vezes no banco — `f27bda3f`.)*

## É a nossa própria linha — 1

### `9eb5f278` **Emerson** — 5519997561909

Extrato lido com confiança **0,95**: 130.584,16 · saldo 93.147,00 · 82 pagas · CNP. Pelo extrato, esta seria uma das melhores candidatas da lista.

**É o seu telefone.** Sem a lista dos números da casa — `5519997561909` e `5511973202967`, os dois que você deu em 02/09 — a sua própria conversa com a Sentinela viraria uma captação de cedente, com carta de 130 mil, e alguém ligaria para você.

> A regra da casa dispara **antes** da regra do extrato. É de propósito, e é a única razão de esta linha não estar em `inserir`.

## Querem ser parceiros, não vender — 1

### `054c72f6` **Matheus Santos** — 5521979068418
> 18/08: **"Olá, vendo consórcio e quero ser parceiro Bidcon"**

Ele diz que vende consórcio — como profissão, não como cedente. **É o mesmo caso do Bruce.** O funil de parceria, que ainda não existe, já tem duas pessoas com nome e telefone esperando por ele.

> A régua tinha excluído esta linha como "comprador", o que era a **classe certa pela razão errada**. Foi a coluna da última palavra do cliente que mostrou.

## Já é comprador no banco — 1

### `b9365734` **~DH~** — 556392463588
> 25/08: "Olá! Quero saber mais sobre o **repasse** de consórcio na bidcon."

Este telefone **já é interesse desde 25/08**, origem `chat`, status `novo`, e recebeu o toque 2 da Sentinela em 31/08. O banco já registrou de que lado ele entrou: o de comprador.

A palavra **"repasse"** é ambígua nesta casa — pode significar a venda da cota ou a compra dela — e não basta para virar o lado de alguém. Se ele declarar venda, o atendimento cria a captação pelo gatilho ao vivo.

> **Não é `revisar`**, e a diferença importa: `revisar` é quando a régua não decide. Aqui o banco já decidiu.
>
> *(O telefone dele também aparece duas vezes — `16deb7a1`.)*

## Não é cedente, é do outro lado — 2

### `e13b7227` **Marta** — 351912678630 *(Portugal)*
> 01/09: "Olá, Sou investidora portuguesa, residente fiscal em Portugal, e estou a estudar a entrada no mercado brasileiro de consórcios imobiliários,…"

O texto dela foi pego pela palavra "vender". Ela é **do lado de quem compra**. *(As palavras são dela, não nossas.)*

### `1376941b` *(sem nome)* — 5518997511173
> 14/08: "Algum retorno?"

Atendida pela `aurora`, agente de compra, sem tag e sem extrato.

---

# ⚪ OS TELEFONES DUPLICADOS — 3

**A chave nova achou três pessoas cadastradas duas vezes**, uma linha com e outra sem o nono dígito. Nenhuma comparação anterior juntava essas linhas. **Nenhuma destas três desce para `captacoes`** — elas aparecem aqui para o duplicado ficar visível, e não escondido.

| chave | a que vale | a duplicada | o que a duplicada tem |
|---|---|---|---|
| `4399161888` | `042a6def` — 554399161888 *(opt-out, Unifisa)* | `c18265f6` — 5543999161888 | prospérito · sem tag · sem extrato · o cliente nunca escreveu |
| `4797186871` | `ee6271c4` — 554797186871 *(Tamires)* | `f27bda3f` — 5547997186871 | prospérito · sem tag · sem extrato · o cliente nunca escreveu |
| `6392463588` | `b9365734` — 556392463588 *(~DH~)* | `16deb7a1` — 5563992463588 | prospérito · sem tag · sem extrato · o cliente nunca escreveu |

**As três duplicadas têm o mesmo perfil:** entraram pelo prospérito, ninguém escreveu nada, nenhuma tem extrato. São conversas que nasceram e não andaram. As três "que valem" são as que têm história.

> Isto abre uma pergunta que esta fatia não responde: **quantos duplicados existem em `wa_conversas` que ninguém nunca viu?** Aqui só apareceram os três que dividem telefone com uma candidata. Se a chave for passada sobre as 104 conversas inteiras, o número pode ser maior.

---

# Os controles desta medição

Nenhum número abaixo foi escrito à mão: todos saíram da mesma consulta, na mesma execução.

| o que se contou | resultado | |
|---|---|---|
| conversas no banco | **104** | ✅ o total conhecido |
| conversas sem telefone brasileiro utilizável | **9** | 6 identificadores do Instagram, Portugal, Colômbia, Reino Unido |
| extratos de cota no banco | **34** | ✅ o total conhecido |
| extratos com confiança suficiente para serem usados | **18** | o limiar corta metade — o resto é lixo de leitura |
| captações que já existem | **2** | ✅ ambas origem site |
| conversas com `opt_out` em **todo** o banco | **6** | só 1 delas era candidata |
| conversas em que o cliente nunca escreveu | **26** | por isso algumas linhas saem sem última palavra |
| **isca** — conversas com um agente que não existe | **0** | ✅ tem de ser 0, senão a régua de agente está quebrada |
| **isca** — decisões nominais que não acharam a conversa | **0** | ✅ tem de ser 0, senão um id está errado |
| **controle positivo** — telefones da casa achados | **2** | ✅ se fosse 0, a lista da casa não estaria pegando nada |

As duas iscas e o controle positivo existem para provar que esta medição era **capaz de falhar**. Uma contagem que não consegue dar errado não prova nada.

---

# O que esta lista não faz

- **Não escreve.** Nada foi inserido, atualizado ou apagado. A ponte que escreve ainda não existe.
- **Não decide sozinha.** Onde a régua não sabe, ela diz `revisar` e devolve para você em vez de chutar.
- **Não toca em crédito de captação que já existe.** No caso do Leandro, o valor do site e o do extrato divergem, e a ponte deixa como está.
- **Não promete data.** Nenhuma linha aqui diz quando alguma cota é contemplada.

# O que nasceu desta lista, e ainda não existe

| | |
|---|---|
| **funil de parceria** | Bruce (`cda21b11`) e Matheus Santos (`054c72f6`) já estão esperando por ele |
| **funil de não-contempladas** | `b3372777` é a primeira |
| **tabela dos telefones da casa** | hoje os dois números vivem copiados em quatro lugares do código, e o seu (`5519997561909`) não está excluído em nenhum lugar que executa |

---

*Gerado por `ident01/RELATORIOS/FUNIL-01_F3_candidatas.sql` · ramo `funil-ponte-01` · leitura no xtv em 03/09/2026.*
