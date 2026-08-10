# O ponto cego do `tsc --noEmit`

**Escrito em 10/08/2026, a partir de um defeito real** — a rota de curadoria de
arte (`app/api/admin/farol/arte/route.ts`) reprovou o `next build` depois de
passar limpa no `tsc --noEmit`. Não foi azar de digitação: é uma classe de erro
que o portão mais rápido da casa **não consegue ver**, por construção.

Este documento existe porque a lição estava viva em dois comentários de código
— `lib/farol/confirmacao.ts:11` e `app/api/admin/farol/arte/route.ts:38` — ou
seja, só é encontrada por quem já está dentro do arquivo onde o erro aconteceu.
Quem for escrever a próxima rota não passa por lá.

---

## O erro

```
Type error: X is not a valid Route export field.
```

`tsc --noEmit` passa. `npm test` passa. Só o `next build` reprova.

## Por que o `tsc` não vê

Um Route Handler do Next (App Router) **não é um módulo TypeScript comum**. O
Next impõe um conjunto **fechado** de exports permitidos:

- os métodos HTTP: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`
- um punhado de opções de segmento: `dynamic`, `runtime`, `revalidate`,
  `fetchCache`, `dynamicParams`, `preferredRegion`, `maxDuration`

Qualquer outro `export` — uma constante, um tipo auxiliar, uma função de
apoio — é **erro de build**.

O `tsc` não tem como saber disso. Para ele, `export const PALAVRA = "aprovar"`
é TypeScript perfeitamente válido, porque é. A regra não é da linguagem: é do
framework, e só é aplicada pelo plugin de tipos que o `next build` roda. Os dois
portões olham para coisas diferentes, e **nenhum dos dois é redundante**.

O mesmo vale para páginas (`page.tsx`) e layouts, com uma lista própria de
exports permitidos (`metadata`, `generateMetadata`, `viewport`, …).

## O conserto

A constante mora em `lib/`, e a rota **importa**.

```ts
// lib/farol/confirmacao.ts
export const PALAVRA_APROVAR = "aprovar";

// app/api/admin/farol/arte/route.ts
import { PALAVRA_APROVAR } from "@/lib/farol/confirmacao";
```

Isso não é só contornar o build. É melhor pelo motivo que interessa: a palavra
de confirmação é lida **em dois lugares** — o servidor, que valida, e o botão,
que a mostra ao operador. Uma linha só para os dois lados significa que não
existe o estado em que o botão pede uma palavra e o servidor espera outra.

A regra geral, então:

> **Route handler e page só exportam o que o Next reconhece. Todo o resto mora
> em `lib/` e é importado.**

E isso vale mesmo quando a constante é usada num arquivo só — porque o "um
arquivo só" de hoje é o "dois arquivos" de amanhã, e a segunda cópia é
descoberta quando as duas divergem.

## O que isso significa para os portões

A casa roda três portões, nesta ordem, e **a ordem é do mais barato para o mais
caro**:

| Portão | Tempo | O que pega | O que NÃO pega |
|---|---|---|---|
| `npx tsc --noEmit` | ~15 s | tipos, imports quebrados, assinatura | **exports inválidos de rota/página** |
| `npm test` | ~10 s | comportamento, regressão de regra | qualquer coisa fora de `lib/` |
| `npx next build` | ~2 min | contrato do framework, resolução real | comportamento em runtime |

Duas consequências práticas:

1. **`tsc` limpo não autoriza commit.** Um commit que só passou pelo `tsc` pode
   quebrar o deploy de todo mundo. Os três portões, sempre, antes de empurrar.

2. **A suíte não olha `app/`.** `scripts/testes.mjs` varre recursivamente
   `DIRS = ["lib"]` atrás de `*.test.ts(x)`. Página e rota **não têm teste** —
   é mais um motivo para a lógica que merece teste morar em `lib/`, e a rota
   ficar sendo o casco fino que valida entrada, chama a lib e devolve JSON.

## Como reconhecer que você caiu nisto

O sintoma é característico e enganoso: **o erro aponta o arquivo certo mas
sugere a causa errada**. A mensagem fala em "Route export field" e a pessoa vai
conferir o `export async function POST` — que está correto. O culpado é a linha
inocente logo acima ou abaixo, normalmente uma constante que alguém colocou ali
por proximidade, exatamente porque parecia o lugar mais natural.

Se o `next build` reprovar uma rota que o `tsc` aprovou, a primeira coisa a
fazer é listar os exports do arquivo:

```
grep -n "^export" app/api/.../route.ts
```

Tudo que não for método HTTP ou opção de segmento é candidato — e a mudança é
sempre a mesma: move para `lib/`, importa de volta.
