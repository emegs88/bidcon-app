# Checklist de pendências — Bidcon `platform/` (ordem de execução)

> **Estado em commit:** `main` está **7 commits à frente** de `origin/main`, **sem push**.
> Nada foi aplicado em PROD. Banco `nnvjeijsrwpzsggwqpcu` = **PROD** (não tocar).
>
> Legenda: 👤 = você (Emerson) executa · 🤖 = o agente faz (local, sem banco/push) ·
> 🔒 = bloqueado até o item anterior.

---

## Prioridade 0 — Validar o Nível 3 (busca semântica) em DEV

O código está pronto e revisado; falta **rodar** num banco real de teste.

- [ ] 👤 **Criar Supabase DEV + aplicar migrations 0001→0007 + preencher `.env.local`**
      → siga `docs/setup-supabase-dev.md`.
- [ ] 👤 **Semear estoque de teste** (cartas imóvel/veículo, faixas variadas).
- [ ] 👤 **Rodar o loop de backfill** até `"restantes":0` (vetoriza o estoque).
      → `docs/validacao-nivel3.md`, passo (d) etapa 1.
- [ ] 👤 **Rodar as 4 buscas** (filtro duro · nuance semântica · degradação 503 ·
      compliance) e conferir o checklist de aceite. → `docs/validacao-nivel3.md`, etapa 2.
- [ ] 👤 **Sinalizar OK** ao agente quando as 4 passarem.

**Critério de pronto:** filtro duro nunca devolve carta acima do teto / fora do tipo;
nuance ordena por significado; sem chave a busca cai pra 503 honesto; nenhuma frase
de encaixe contém data de contemplação nem mecânica interna (CCB/FIDC/funding/etc.).

---

## Prioridade 1 — Push do trabalho acumulado

- [ ] 🔒👤 **Autorizar `git push`** dos 7 commits (só após o Nível 3 validar em DEV).
      O agente **não** dá push sem seu ok explícito.

Commits que vão no push:
```
71405e7 docs: validação do nível 3 (revisão 0007 + filtros×ranking + roteiro curl)
9db1acb docs: roadmap da camada de voz (Nível 6)
57a0328 fix(platform): reforço de compliance — anti-data + sigilo de mecânica interna
3ea60ea chore(platform): backfill de embeddings + OPENAI_API_KEY no .env.example
407429c feat(platform): busca por linguagem natural (nível 3)
d176dd1 feat(platform): camada de IA (embeddings + intenção + frase)
e592048 feat(platform): migration 0007 — busca semântica (pgvector)
```
*(+ os 2 docs novos deste passo, quando commitados.)*

---

## Prioridade 2 — Aplicar 0007 (e 0005/0006) em PROD

- [ ] 🔒👤 **Emerson aplica em PROD** as migrations que faltam (0005 vitrine, 0006 RPCs
      de status, 0007 busca semântica) via SQL Editor, **na ordem**. O agente só validou
      sintaxe local — quem roda em PROD é você.
- [ ] 🔒👤 **Configurar env de PROD na Vercel** (`OPENAI_API_KEY`, `CRON_SECRET`, etc.)
      e agendar o cron de backfill.
- [ ] 🔒👤 **Backfill em PROD** até `restantes:0`.

---

## Prioridade 3 — Nível 4: Prosperito explicador (texto)

> Só começa **depois** do Nível 3 validado. Escopo travado: **explica, não age.**

- [ ] 🔒🤖 Camada que responde dúvidas do cliente **em texto** sobre uma carta/processo,
      reusando o mesmo cérebro/compliance. **Toda saída passa por `sanitizarCompliance`**
      antes de chegar ao cliente.
- [ ] 🔒🤖 Sem nenhuma ação de mutação (não muda status, não mexe em dado).
- [ ] 🔒👤 Validar + autorizar push.

---

## Prioridade 4 — Nível 5: especialista por carta

- [ ] 🔒🤖 Dossiê por carta (mesmo prompt-lock), aprofundando o N4. Mesma fronteira:
      explicar, nunca agir; mesma barreira de compliance.

---

## Prioridade 5 — Nível 6: voz do Prosperito

> Documentado em `docs/roadmap-voz.md`. **Último degrau.** Só inicia com N3/N4/N5 ✅.

- [ ] 🔒 Decisões de produto pendentes (transcrição tempo-real vs trecho; TTS; retenção
      de áudio; identidade sonora; custo-alvo). Ver o roadmap.
- [ ] 🔒 Fluxo obrigatório: `cérebro → texto → sanitizarCompliance → TTS → áudio`.

---

## Fora de escopo (não fazer agora)

- Números reais de comissão (travado no Emerson).
- Push automático / aplicar SQL em PROD pelo agente / mexer em Vercel/DNS.
- Qualquer ação por voz (a voz herda o limite "explica, não age").
- OneSignal/push ativo (hoje é stub).

---

*Checklist vivo. Marque os itens conforme avançar. Pareado com
`docs/setup-supabase-dev.md` e `docs/validacao-nivel3.md`.*
