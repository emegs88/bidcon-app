# AUDITORIA 2026-07 — Funil de Leads (Vitrine + Plataforma)

> **Data:** 2026-07-12. **Escopo:** vitrine pública (`public/`) + plataforma
> logada (`platform/`). **Pedido original:** mapear o que já foi
> implementado, o que falta, e levantar ideias de implementação pra
> melhorar a captação e conversão de leads — apontando o maior gargalo do
> funil. **Método:** leitura direta de código (3 varreduras dedicadas:
> vitrine, plataforma, docs/roadmap) + consultas SQL read-only aos bancos
> de produção (`xtv` e `nnv`) para números reais de uso, não estimativas.
> **Não é uma fatia de código** — é um documento de diagnóstico. Nenhuma
> alteração foi feita em produção para produzi-lo.

---

## 1. Resumo executivo

O produto está tecnicamente maduro: existe uma vitrine pública com SEO
forte, um assistente de chat com 7 personas ligado a `/api/atende`, um
fluxo completo de reserva com KYC, uma máquina de estados de processo
com 9 sub-etapas, e um programa de parceiros com comissão inteiramente
construído (telas, tabelas, RPCs). O problema não é "falta construir" —
é que **quase nada dessa engenharia está sendo usado**, e o motivo raiz
não é falta de demanda: é a ausência quase total de instrumentação e de
mecanismos de reengajamento entre a primeira mensagem do lead e qualquer
conversão formal.

**O maior gargalo do funil, por evidência direta do banco (ver §2):** a
queda entre "lead conversou no chat" (9 interesses, 8 conversas, 172
mensagens trocadas em 5 dias de atividade) e "qualquer conversão formal"
(0 processos, 0 cadastros de KYC, na história inteira do produto) é de
100%. Ninguém — nenhum dos 9 leads que já demonstraram interesse ativo —
chegou a se cadastrar formalmente na plataforma logada, apesar de haver
1.057 cartas disponíveis em estoque agora. Isso acontece num contexto em
que:

- **Não existe telemetria nenhuma no site público** (GA4 e Clarity
  configurados no código, mas com ID vazio — zero eventos são
  registrados hoje).
- **Não existe nenhum mecanismo automático de reengajamento** — uma
  conversa que esfria não gera alerta pra ninguém, nem para o cliente
  (lembrete), nem para um humano (handoff).
- **A ponte entre "conversei no WhatsApp/chat" e "virei cadastro na
  plataforma" é manual** — o assistente pode sugerir, mas não existe link
  direto, pré-preenchimento, ou qualquer atalho que carregue o contexto
  da conversa para o cadastro.
- **O programa de parceiros — canal de aquisição por indicação,
  totalmente construído em código — nunca foi usado**: zero parceiros
  cadastrados, zero indicações, zero comissões, desde sempre.

Em outras palavras: o funil não está "vazando devagar" em vários pontos
— ele **para completamente** entre o topo (conversa) e o meio (cadastro
formal), e a empresa não tem hoje nenhum instrumento pra saber *quando*
isso acontece, pra quem, ou por quê.

---

## 2. Números reais do funil (fonte: SQL direto em produção, xtv/nnv)

| Etapa | Tabela | Total histórico | Janela observada |
|---|---|---:|---|
| Carta em estoque disponível | `cartas` (xtv) | 1.057 disponíveis / 821 indisponíveis | atual |
| Lead iniciou interesse | `interesses` (xtv) | **9** | 2026-07-07 a 2026-07-12 |
| Conversa aberta no chat | `conversas` (xtv) | **8** | 2026-07-07 a 2026-07-12 |
| Mensagens trocadas | `mensagens` (xtv) | 172 | 2026-07-07 a 2026-07-12 |
| Reserva iniciada (chat ou wizard) | `reservas` (xtv) | **1** | 2026-07-09 (TTL 48h — expirada) |
| Processo formal aberto | `processos` (xtv) | **0** | nunca |
| Cadastro (login) na plataforma | `profiles` (nnv) | 5 (4 cliente + 1 admin) | acumulado |
| KYC enviado (qualquer status) | `kyc_perfis` (nnv) | **0** | nunca |
| Parceiro cadastrado | `parceiros` (xtv, via `profiles.tipo`) | **0** | nunca |
| Indicação de parceiro | `indicacoes` (xtv) | **0** | nunca |
| Comissão gerada | `comissoes` (xtv) | **0** | nunca |

Detalhamento adicional:
- Os 9 `interesses` estão **todos** parados em `status='novo'` /
  `intencao='interesse'` — nenhum avançou para `intencao='reserva_pretendida'`
  ou além.
- As 8 `conversas` estão **todas** em `status='aberta'` — nenhuma foi
  fechada, nenhuma escalou para atendimento humano (`status='humano'`).
- A única `reserva` já criada tem TTL de 48h a partir de 2026-07-09 —
  neste momento já expirada, sem ter virado processo.
- Nenhum dos 5 perfis cadastrados na plataforma (`profiles`, projeto nnv)
  enviou documentação de KYC — ou seja, **literalmente ninguém, na
  história do produto, chegou a ficar elegível para reservar uma carta
  pelo fluxo formal da plataforma logada.**

---

## 3. O que já está implementado

### 3.1 Vitrine pública (`public/`)

- `index.html` (site principal) + ~14 páginas satélite (blog com 3 posts,
  página de "carta de crédito contemplada", FAQ, etc).
- **Widget de chat "Prosperito"** (`prosperito-widget.js`) — ponto
  primário de captação: coleta nome + telefone, cria `interesses`,
  encaminha para `/api/atende`.
- SEO tecnicamente forte: sitemap, `robots.txt` com whitelist explícita
  para crawlers de IA, `llms.txt`, schema JSON-LD rico
  (Product/Offer/FAQPage), IndexNow configurado.
- Consentimento LGPD (`consent.js`) já preparado para GA4 e Microsoft
  Clarity, com helper `window.bidconTrack()` pronto para uso — só falta
  preencher os IDs (ver §4.1).
- Links de WhatsApp direto (`5511973202967`) espalhados em 18 arquivos —
  canal de contato alternativo já presente, mas sem tracking de origem.
- Testemunhos (`SHOWTESTIMONIALS`) construídos no código mas desligados,
  aguardando depoimentos reais.

### 3.2 Plataforma logada (`platform/`)

- Autenticação via Supabase Auth (projeto nnv), 3 papéis
  (`cliente`/`parceiro`/`admin`), RLS por `auth.uid()` / `is_admin()`.
- Descoberta de cartas: `/cartas` (listagem/filtros) → `/cartas/[id]`
  (detalhe) → `/reservar` (wizard, exige KYC verificado).
- Assistente de chat multi-persona ligado a `/api/atende` (7 personas,
  handoff via marcador `##AGENTE:<id>##`, reserva via marcador
  `[[RESERVAR]]ref=NNN[[/RESERVAR]]`).
- Máquina de estados de processo (`processos`): 5 estados macro
  (`reservada` → `documentacao` → `analise_administradora` →
  `transferencia` → `concluido`/`cancelado`) com 9 sub-etapas visíveis em
  `/meu-processo`, avançadas via RPC `avancar_status_processo`.
- Programa de parceiros: telas (`/parceiro`, cadastro de indicação),
  tabelas (`parceiros`, `indicacoes`, `comissoes` com regra de 7%),
  painel administrativo em `/admin` para gestão — **construído e nunca
  usado** (ver §2).
- Painel `/admin`: dashboard, gestão de cartas, gestão de processos,
  console de importação. Não existe hoje um painel de funil de leads.
- WHATSAPP-01 F1 (fundação): tabelas `wa_conversas`/`wa_mensagens` +
  rota `/api/whatsapp` (handshake + validação HMAC + dedup) — aplicado em
  produção nesta mesma sessão, sem chamada ao assistente ainda (fases
  seguintes).

---

## 4. O que está faltando (lacunas identificadas)

### 4.1 Instrumentação (a lacuna mais barata de fechar, maior alavanca)

- **GA4 e Microsoft Clarity**: já integrados no código (`consent.js`),
  mas com `GA4_ID` e `CLARITY_ID` vazios — **nenhum evento é coletado
  hoje**. Não há como saber quantas pessoas visitam o site, de onde vêm,
  ou em que ponto desistem antes mesmo de abrir o chat.
- **Sem captura de UTM/origem** em nenhum ponto do funil — mesmo quando
  um lead vira `interesse`, não há registro de qual campanha, página ou
  canal trouxe essa pessoa.
- **Formulário "vender carta contemplada"** não grava em nenhuma tabela
  — apenas abre o WhatsApp. Todo esse volume de intenção (potenciais
  fornecedores de cartas) é invisível para o time hoje.
- **Sem painel de funil** no `/admin` — os números deste documento só
  existem porque foram consultados manualmente via SQL; não há
  visibilidade contínua para o time de negócio.

### 4.2 Reengajamento e handoff

- `lib/notificar.ts` é um stub inerte para push via OneSignal — a função
  `notificarCartaNova()` nunca dispara de fato (aguarda configuração de
  conta, TODO explícito no código).
- `/api/hooks/novo-cadastro` apenas grava log — não notifica ninguém.
- Não existe job ou alerta para "conversa esfriando" — uma `conversa`
  pode ficar `aberta` indefinidamente sem que ninguém (cliente ou
  atendente humano) seja avisado.
- Não existe e-mail transacional nem envio de WhatsApp de volta a partir
  da plataforma (WHATSAPP-01 é só recepção na F1 atual).
- A reserva expira em 48h sem nenhum lembrete anterior ao vencimento.

### 4.3 Ponte chat → cadastro formal

- O assistente pode indicar a plataforma, mas não há link com contexto
  pré-carregado (ex.: carta já discutida, telefone já informado) — o
  lead que já contou tudo no chat tem que recomeçar do zero se decidir
  se cadastrar.
- KYC é a porta de entrada obrigatória para reservar formalmente, mas
  não há nada no funil que incentive ou facilite chegar até ele — e,
  como mostra §2, ninguém chegou lá ainda.

### 4.4 Canal de parceiros

- Toda a engenharia existe (cadastro, indicação, regra de comissão de
  7%, painel), mas não há nenhuma ação de divulgação, onboarding ou
  captação de parceiros documentada — o canal está pronto e ocioso.

### 4.5 Observabilidade técnica

- Sem Sentry ou equivalente — erros de produção só aparecem em
  `console.error` disperso, sem alerta centralizado.
- Rate limiting de `/api/atende` e `/api/interesse` é em memória, por
  instância — não é compartilhado entre instâncias serverless (TODO
  já registrado no código para migrar a Upstash/Redis).

### 4.6 Documentação de produto

- Nenhum documento existente hoje (`PLANO_MESTRE.md`, specs, roadmaps)
  define KPIs de funil, metas de conversão, ou estratégia de canal —
  o projeto tem documentação técnica robusta, mas nenhuma estratégia de
  aquisição/conversão registrada por escrito.

---

## 5. Ideias de implementação, em ordem de alavancagem

Ordenadas pelo critério "menor esforço de código, maior efeito na
visibilidade ou conversão do funil":

1. **Ligar GA4 + Clarity (preencher os IDs já previstos no código).**
   Custo: quase zero (só configuração). Sem isso, qualquer decisão sobre
   o funil continua sendo no escuro — é o pré-requisito para medir o
   efeito de qualquer uma das ideias abaixo.
2. **Painel de funil no `/admin`**: contagem diária de
   interesses/conversas/reservas/processos, com o mesmo tipo de consulta
   usada para produzir a tabela do §2 — hoje isso exige SQL manual.
3. **Alerta de conversa parada**: job simples (ex.: cron existente do
   projeto) que sinaliza conversas `aberta` sem mensagem nova há N horas
   — primeiro para um humano decidir se retoma contato, antes de
   qualquer automação de resposta.
4. **Capturar UTM/origem em `interesses`** (campo já é barato de
   adicionar) — sem isso, nenhum esforço futuro de divulgação por canal
   pode ser avaliado por resultado.
5. **Fazer o formulário "vender carta contemplada" gravar em tabela**
   (hoje só abre WhatsApp) — fecha um ponto cego de captação do lado
   de oferta (quem tem carta contemplada para oferecer).
6. **Link de continuidade chat → cadastro** com contexto pré-carregado
   (telefone, carta discutida) — reduz o atrito de ter que recomeçar do
   zero exatamente no ponto onde hoje 100% dos leads param.
7. **Retomar WHATSAPP-01 nas fases seguintes (F2/F3)**: a fundação (F1)
   já está em produção; o valor de reengajamento real só aparece quando
   o assistente conseguir responder pelo WhatsApp — canal onde o cliente
   brasileiro tende a ser mais responsivo que e-mail ou push.
8. **Ativar o programa de parceiros**: com a engenharia já pronta, o
   gargalo aqui é 100% de divulgação/onboarding, não de código — vale
   avaliar uma ação dedicada de captação de parceiros antes de investir
   mais em funcionalidade nova para esse canal.
9. **Lembrete antes da expiração da reserva (48h)**: mesmo sem canal de
   envio automatizado pronto ainda, vale registrar como decisão pendente
   junto da fase que implementar notificações reais.

---

## 6. Metodologia e fontes

- Leitura direta de código: `public/` (vitrine), `platform/app`,
  `platform/lib`, `platform/supabase/migrations` (plataforma logada).
- Leitura de toda a documentação existente em `docs/` e
  `docs/PLANO_MESTRE.md` (§0 a §9 e todas as entradas de §4).
- Consultas SQL read-only via MCP Supabase (`execute_sql`), projeto
  `xtv` (`xtvjpnyadcdeadhmzyff`, produção da vitrine/cartas/funil) e
  projeto `nnv` (`nnvjeijsrwpzsggwqpcu`, produção de auth/perfis/KYC).
  Nenhuma escrita foi feita nos bancos para produzir este documento.
- Números capturados em 2026-07-12; refletem o estado do produto até
  essa data, incluindo a fundação do WHATSAPP-01 (F1) publicada na
  mesma sessão em que esta auditoria foi produzida.
