# TEMPLATE `sentinela_retomada_01`

**Status:** texto APROVADO por Emerson em 16/08/2026. Ainda **não submetido à Meta**.

Este arquivo é a **fonte do texto**. Ele nasceu numa conversa e ficou preso lá por dois
dias — texto que governa mensagem a cliente precisa viver no repositório, versionado,
como qualquer regra. Quem for cadastrar na Meta copia daqui, não do histórico de um chat.

---

## Ficha

| Campo | Valor |
|---|---|
| Nome | `sentinela_retomada_01` |
| Categoria | **MARKETING** |
| Idioma | `pt_BR` |
| Header | nenhum |
| Variáveis | uma só: `{{1}}` = primeiro nome |
| Botões | quick reply: **Quero retomar** · **Não quero receber** |

### Por que MARKETING e não UTILITY

Declarar UTILITY numa mensagem que reabre conversa com quem parou de responder é convidar
a Meta a reclassificar. Reclassificação não é multa: é o template caindo, e a fila inteira
parando junto. MARKETING custa mais por mensagem e é o que a mensagem **é**.

### Por que uma variável só

Não é preferência de estilo — é o que o código faz hoje. Medido em
`app/api/sentinela/varredura/route.ts:424-428`:

```ts
components: [
  {
    type: "body",
    parameters: [{ type: "text", text: primeiroNome(f.nome) }],
  },
]
```

Um parâmetro de body, `languageCode: "pt_BR"`, nenhum componente de header. Um template
com duas variáveis seria rejeitado no envio, uma linha por vez, em silêncio.

---

## Corpo — copiar exatamente

```
Oi, {{1}}. Aqui é o Prosperito, da Bidcon.

A gente conversou por aqui e eu não voltei. A demora foi minha, e peço desculpa por isso.

Se ainda fizer sentido, eu retomo de onde a gente parou — é só tocar em Quero retomar. Se não fizer mais, toca em Não quero receber que eu não te escrevo de novo.

Grupo Prospere · Bidcon
```

### Rodapé opcional

Só se a Meta objetar à ausência de contexto de origem:

```
Você recebeu porque falou com a Bidcon pelo site.
```

Não incluir de saída. Cada linha a mais é uma linha a menos de conversa.

---

## As duas decisões do texto

### 1. "eu não voltei", nunca "você não respondeu"

Mentira na primeira linha mata a conversa. Quem parou fomos nós: a pessoa perguntou
alguma coisa e a casa sumiu. As 21 linhas captadas em 04/08 ficaram onze dias em
`aguardando_template` sem que nada acusasse — o vigia de fila envelhecendo
(`DIAS_FILA_PARADA = 3`) existe exatamente por causa desse buraco.

Escrever "você não respondeu" seria devolver ao cliente a culpa por um silêncio nosso, na
primeira frase, para uma pessoa que já foi ignorada uma vez.

### 2. `Não quero receber` é LITERAL — não é estilo

⚠️ **O título do botão é uma chave de código.** `lib/opt-out.ts:72-74`:

```ts
export function ehBotaoOptOut(titulo: string | null | undefined): boolean {
  return !!titulo && normalizarTexto(titulo) === TEXTO_BOTAO_OPT_OUT;
}
```

com `TEXTO_BOTAO_OPT_OUT = "não quero receber"` (linha 31) e `normalizarTexto` fazendo
apenas `trim` + `toLowerCase` + tirar pontuação das pontas (linhas 48-53).

O que isso significa, na prática:

- **A comparação é por IGUALDADE EXATA**, e é assim de propósito. O título do botão é
  escolhido por NÓS ao cadastrar o template, não digitado pelo cliente; aceitar aqui a
  lista larga de `PALAVRAS_OPT_OUT` deixaria um botão de outro template ("Parar", "Sair")
  desligar o canal sem querer.
- **O acento é obrigatório.** `normalizarTexto` não remove acento. `"Nao quero receber"`
  sem til **não bate** e o cliente que tocar nele não sai. (A forma sem acento existe em
  `PALAVRAS_OPT_OUT` só para texto DIGITADO, que passa por outro caminho.)
- Maiúscula/minúscula não importam; ponto final no fim não importa.

**Qualquer outro rótulo — "Não quero mais", "Parar de receber", "Sair" — é um botão de
saída que não sai.** Cliente toca, nada acontece, e a casa continua escrevendo para quem
pediu para parar. Se um dia o rótulo mudar na Meta, muda-se **primeiro** em
`lib/opt-out.ts`; a suíte `lib/opt-out.test.ts` quebra se o literal sair do lugar.

---

## Os quatro portões antes do primeiro disparo

1. **Texto** — ✅ aprovado, 16/08/2026. É este arquivo.
2. **Submissão à Meta** — ⏳ pendente. Antes de submeter, rodar
   `/api/whatsapp/template-info` com o `DISPARO_SECRET` para ver o que já existe na conta
   e não criar duplicata.
3. **Env `SENTINELA_TEMPLATE` na Vercel** — ⏳ pendente, **pela mão do Emerson**.
   Enquanto a env não existir, a FASE C não envia nada: as linhas viram
   `aguardando_template`. Esse gate é o que torna o deploy seguro antes da aprovação.
   ⚠️ Esta env **não é criada por assistente**, em nenhuma circunstância.
4. **A decisão de quem entra no primeiro lote** — ✅ resolvida: decisão (c), toca as 27,
   ninguém é retirado. Executa depois do dedup por telefone (migração `0083`), que fechou
   uma linha duplicada e deixou **26 elegíveis distintos**.

---

## Ordem de execução

Nada sai enquanto os portões 2 e 3 não fecharem. Quando fecharem, a fila anda sozinha: o
cron da varredura pega no máximo 15 por execução, e o vigia de fila acusa em `grave` se a
mais antiga passar de 6 dias.
