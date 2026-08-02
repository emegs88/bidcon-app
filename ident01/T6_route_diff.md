# T6 — Diff do chamador real (`platform/app/api/sync-cotas/route.ts`)

> **DEPLOY SÓ NA FASE B.** Este arquivo é especificação, não código aplicado.
> O `route.ts` no repo continua intacto até a frase de autorização.

## O que já está certo hoje

O chamador **não precisa** das mudanças que a spec temia. Lendo o arquivo real:

- lotes de 100 (`TAMANHO_LOTE = 100`, linha 46) — **já é D5**;
- `p_varrer: false` em todo lote (linha 151) — **já nunca orfaniza dentro do lote**;
- varredura única ao fim, **com a lista completa** (`payload.map(c => c.numero)`, linha 180)
  — a "lista completa" da spec **já existe**;
- isolamento por fonte com `try/catch` por fonte, `sync_pulado` / `sync_abortado`,
  `sync_fim` com duração — telemetria já madura;
- `FONTES = [LANCE, CBC, PIFFER, CARTAS, PLAYCONTEMPLADAS]` bate com a lista branca D12
  da RPC (que aceita as 5 + SERVOPA, aposentada no leitor).

**Faltam exatamente duas coisas**, e as duas são do contrato novo:

1. **`ciclo_t0` não existe.** Hoje cada lote é uma transação com o seu próprio `now()`,
   e não há fronteira compartilhada entre "ciclo anterior" e "este ciclo".
2. **A varredura manda números, não cotas.** O contrato novo casa por *fingerprint*
   (D1), não por número — `numero_externo` é POSIÇÃO, não identidade. Mandar
   `int[]` para a varredura nova é impossível: ela precisa do payload para
   recomputar os fingerprints entrantes e rodar a checagem de integridade.

## Diff

### (a) `ciclo_t0`: abertura do ciclo, uma vez por fonte

Inserir **depois** da leitura ok (linha 126) e **antes** do laço de lotes.

```diff
@@ route.ts — dentro do for (const origem of FONTES), após `if (!leitura.ok) { ... }`
+      // (3b) ABERTURA DO CICLO (D6). Um único t0 por fonte, compartilhado por
+      // TODOS os lotes e pela varredura final. Precisa vir do relógio do BANCO:
+      // com t0 do relógio do Node adiantado em relação ao Postgres, uma carta
+      // reivindicada no lote 1 (sincronizada_em = now() do banco) ainda
+      // satisfaria `sincronizada_em < t0` no lote 2 e seria reivindicada duas
+      // vezes. sync_ciclo_t0(origem, '{}') devolve o ultima_varredura_em do
+      // estado — a fronteira exata entre o ciclo passado e este — e faz o
+      // bootstrap com now() na primeira execução da fonte (nunca -infinity).
+      const { data: t0Raw, error: errT0 } = await db.rpc("sync_ciclo_t0", {
+        p_origem: origem,
+        p_cotas: {},
+      });
+      if (errT0 || !t0Raw) {
+        try {
+          await db.from("eventos_sync").insert({
+            tipo: "sync_abortado",
+            detalhe: origem + " ciclo_t0: " + (errT0?.message ?? "nulo"),
+          });
+        } catch {
+          // silencioso de propósito
+        }
+        resultados.push({ origem, ok: false, motivo: "ciclo_t0", contagemAnterior });
+        continue;
+      }
+      const cicloT0 = t0Raw as string;
+
```

### (b) Envelope D6 em cada lote — assinatura da RPC **congelada**

```diff
@@ route.ts — dentro do for de lotes
         const lote = payload.slice(i, i + TAMANHO_LOTE);
         const indice = Math.floor(i / TAMANHO_LOTE) + 1;
         const { data, error } = await db.rpc("sync_aplicar_cotas", {
           p_origem: origem,
-          p_cotas: lote,
+          // D6: envelope canônico. A assinatura (p_origem, p_cotas, p_varrer)
+          // continua CONGELADA — o t0 viaja DENTRO do jsonb, não num 4º arg.
+          p_cotas: { ciclo_t0: cicloT0, cotas: lote },
           p_varrer: false,
         });
```

### (c) Varredura: cotas completas + o mesmo `t0` (assinatura de 3 args)

```diff
@@ route.ts — bloco (5)
       // (5) todos os lotes aplicaram => varredura única com a lista COMPLETA.
       // A RPC tem trava própria: lista vazia jamais varre.
-      const numeros = payload.map((c) => c.numero);
-      const { data: varridas, error: errVarrer } = await db.rpc("sync_varrer_ausentes", {
-        p_origem: origem,
-        p_numeros: numeros,
-      });
+      // IDENTIDADE-01: a varredura nova casa por FINGERPRINT (D1), não por
+      // numero_externo (que é POSIÇÃO, D1). Ela precisa do payload inteiro
+      // para recomputar os fingerprints entrantes e rodar a checagem de
+      // integridade do ciclo — por isso vai `payload`, não `numeros`.
+      // Mesmo cicloT0 dos lotes: a fronteira do ciclo tem que ser uma só.
+      const { data: varridas, error: errVarrer } = await db.rpc("sync_varrer_ausentes", {
+        p_origem: origem,
+        p_cotas: { ciclo_t0: cicloT0, cotas: payload },
+        p_ciclo_inicio: cicloT0,
+      });
```

> A chamada legada de 2 args (`p_numeros`) **some do route**. Ela sobrevive no banco
> só como SHIM no-op (ADENDO-1): registra `varredura_legada_chamada`, devolve 0 e
> **não escreve em `cartas`** — rede para qualquer chamador esquecido. Item **o** do kit.

### (d) Telemetria: o `t0` no resultado por fonte

```diff
@@ type ResultadoFonte
   origem: FonteMarca;
   ok: boolean;
   motivo?: string;
+  cicloT0?: string;
   lidas?: number;

@@ resultados.push do caminho feliz
       resultados.push({
         origem,
         ok: true,
+        cicloT0,
         lidas: payload.length,
```

## O que NÃO muda

- `TAMANHO_LOTE = 100`, `maxDuration = 800`, `autorizado()`, `createXtvClient()`;
- a ordem das fontes, o isolamento por `try/catch`, os tipos de evento;
- os leitores (`lerCotasFonte`, `lerCotasPlaycontempladas`) e as 5 guardas;
- a **assinatura** `sync_aplicar_cotas(p_origem, p_cotas, p_varrer)` — congelada (D5).

## Ordem de deploy obrigatória (FASE B)

A migration **primeiro**, o `route.ts` **depois** — e nessa ordem por um motivo mecânico:

- migration aplicada + route velho → o route manda `p_cotas` como array cru.
  `sync_cotas_array` devolve o próprio array e `sync_ciclo_t0` cai no ramo legado
  (t0 do estado). **Funciona.** Degrada para o comportamento correto.
- route novo + migration velha → `sync_varrer_ausentes(p_origem, p_cotas, p_ciclo_inicio)`
  não existe → `PGRST202`/`42883` em **todas** as fontes, toda hora.

A janela de incompatibilidade é assimétrica de propósito: só uma das ordens quebra.

## Risco residual declarado

O `sync_fim` mede a execução inteira. Com envelope, cada lote carrega ~1 KB a mais
de JSON (o campo `ciclo_t0` repetido) e a varredura passa a mandar o payload
completo em vez de `int[]` — para a maior fonte medida (PLAYCONTEMPLADAS, ~1.200
cotas) isso é ~300 KB num único POST, contra ~10 KB antes. Abaixo do teto do
gateway, mas é a única linha do diff que muda ordem de grandeza de tráfego.
Vale conferir o `total_ms` do `sync_fim` na primeira hora pós-deploy.
