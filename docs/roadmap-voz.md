# Roadmap — Nível 6: Camada de Voz do Prosperito

> **Status: DOCUMENTAÇÃO. Nada construído.** Este arquivo registra o plano da voz
> para referência futura. A voz é o **último** degrau e só começa quando todos os
> pré-requisitos abaixo estiverem ✅.

## Pré-requisitos absolutos (todos antes de iniciar)

| # | Pré-requisito | Estado hoje |
|---|---------------|-------------|
| 1 | Nível 3 (busca por linguagem natural) validado em **banco DEV** | ⬜ pendente — falta DEV + chaves no `.env.local` |
| 2 | Barreira `sanitizarCompliance` blindada (anti-data + termos internos) **envolvendo TODA saída** | ✅ função pronta e testada (35 casos, 0 divergências) — falta ser *aplicada* a N4/N5 quando existirem |
| 3 | Nível 4 (explicador em texto) validado **e com push** | ⬜ não iniciado (gate em N3) |
| 4 | Nível 5 (especialista por carta) validado | ⬜ não iniciado (gate em N4) |

A voz **não cria inteligência nova**: ela só dá ouvido e boca ao cérebro que já
existir nos Níveis 4/5. Sem esse cérebro validado, não há o que falar.

## Arquitetura — 4 partes

### 1. OUVIR (fala → texto)
Transcrição da fala do cliente.
- **Decisão pendente:** tempo-real (stream) vs. por-trecho (push-to-talk).
  Trade-off central é **custo × fluidez**: stream é mais natural mas mais caro e
  exige infra de áudio contínuo; por-trecho é mais barato e simples de degradar.
- Reaproveitar a experiência prévia com **Whisper** (avaliar Whisper API vs.
  modelos locais; latência, custo por minuto, privacidade do áudio).
- **Privacidade:** áudio é dado sensível. Definir retenção (idealmente **não
  reter** o áudio cru após transcrever), e nunca enviá-lo a destino que não seja
  o provedor de transcrição escolhido.

### 2. PENSAR (o cérebro)
Reusar **exatamente** o cérebro do Nível 4/5 — mesmo prompt-lock, mesmo dossiê
por carta, mesma fronteira de "explicar, não agir". A camada de voz é só um novo
*transporte* de entrada/saída; a lógica de resposta não muda.
- Entrada: texto transcrito (parte 1).
- Saída: texto da resposta, que segue para a parte 4 **antes** de virar áudio.

### 3. FALAR (texto → voz)
- **Identidade sonora do Prosperito** é decisão de **branding** (timbre, ritmo,
  formalidade) — alinhar com a identidade visual azul/âmbar e o tom sóbrio.
- Avaliar opções de **TTS por custo e qualidade** (provedores de voz neural;
  naturalidade × preço por caractere × latência). Decidir voz fixa vs. ajustável.

### 4. COMPLIANCE (inegociável)
**Toda fala passa por `sanitizarCompliance` ANTES de virar áudio.**
- Áudio **não tem desfazer**: uma promessa de contemplação falada não pode ser
  retirada. Por isso a barreira roda no **texto**, antes da síntese — nunca depois.
- A barreira já está blindada (commit `fix(platform): reforço de compliance`):
  bloqueia promessa de data/prazo de contemplação **e** vazamento de mecânica
  interna (CCB/FIDC/funding/custo de aquisição). A voz herda essa mesma função;
  **não** se cria uma régua de compliance separada para áudio.
- Fluxo obrigatório: `cérebro → texto → sanitizarCompliance → TTS → áudio`.
  Se `sanitizarCompliance` devolver o fallback, é o **fallback** que é falado.

## Pontos de decisão que o Emerson precisará responder

> O usuário sinalizou que esta lista continua (a mensagem original terminou em
> "PONTOS DE DECISÃO QUE VOU PRECISAR RESPONDER"). Registrar aqui conforme forem
> definidos. Itens já levantados:

1. **Transcrição:** tempo-real vs. por-trecho? Whisper API vs. local?
2. **Retenção de áudio:** descartar o áudio cru pós-transcrição? (recomendado: sim)
3. **TTS:** qual provedor? voz fixa do Prosperito vs. configurável?
4. **Identidade sonora:** timbre/persona — alinhar com branding.
5. **Custo-alvo por conversa de voz** (transcrição + LLM + TTS somados).
6. **Escopo da fala:** só explicar (espelho de N4) ou também especialista (N5)?
7. **Acessibilidade:** legenda do que foi falado? botão de "ler em vez de ouvir"?

## Fora de escopo (desta camada)
- Qualquer **ação** por voz (mudar status, mexer em dado): a voz herda o limite
  de N4/N5 — **explica, não age**.
- Construção de qualquer parte antes dos pré-requisitos ✅.
- Régua de compliance própria para áudio (usa-se a mesma `sanitizarCompliance`).

---
*Documento de planejamento. Não implementa nada. Atualizar conforme as decisões
acima forem fechadas e os Níveis 3/4/5 forem validados.*
