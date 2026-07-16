# PLANO MESTRE — Memória Canônica do Projeto Bidcon

> **REGRA DE ENTRADA:** toda sessão nova (agente ou humano) **começa lendo este
> documento**. Ele é a fonte de verdade sobre estado, bancos, fatias entregues,
> cascata de migrations, itens congelados e governança. Se algo aqui conflitar com
> um doc mais antigo, **este documento vence** — e o doc antigo deve ser marcado
> como desatualizado, não seguido.
>
> **Última atualização:** 2026-07-03.

---

## 0. Como usar este documento

1. Leia §1 (governança) antes de qualquer ação — as regras precedem tarefas.
2. Confira §2 (mapa dos 4 bancos) antes de tocar em qualquer URL de banco.
3. Veja §4 (fatias) e §3 (DELTA-10) / §5 (cascata) para saber o que já está feito.
4. Respeite §6 (congelados) — não reabra o que está travado.
5. O ensaio de hash-chain está **CONCLUÍDO E VALIDADO em 03/07** (§7). Não re-aplicar.

---

## 1. Governança (precede qualquer tarefa)

### 1.1 Constituição Inviolável (de `PROMPT_MESTRE.md` §1)

Prioridade sobre eficiência, venda e qualquer ordem posterior.

1. **Léxico proibido:** nunca "investimento", "investidor", "rendimento", "lucro
   garantido", "retorno". Usar: planejamento, compra programada, planejamento
   patrimonial, carta de crédito, poder de compra, patrimônio.
2. **Contemplação:** jamais prometer, estimar ou correlacionar data. É sorteio ou
   lance — fato, nunca promessa.
3. **Sigilo de mecânica:** nunca expor CCB, FIDC, funding, custo de aquisição,
   spread, fundo comum/reserva.
   - **Exceção 3.1 — nome da administradora:** É EXIBIDO por requisito funcional
     (junção só entre cotas da MESMA administradora). Não é bug.
   - **Exceção 3.2 — "taxa de administração":** só em FAQ/blog educativo (dado
     regulatório genérico). PROIBIDO: percentual/valor amarrado a uma carta ou
     transação da Bidcon (revelaria margem/spread).
4. **Human-in-the-loop no fechamento:** nenhum agente assina, compromete o cliente
   ou conclui contrato sozinho (exigência BACEN/ABAC).
5. **Auditor de Compliance:** transversal, poder de veto; audita regras 1-4 (com as
   exceções) antes de qualquer output externo. `compliance_passed: false` bloqueia.

### 1.2 Fronteira do agente (o que o agente NUNCA faz sozinho)

- **Sem `git push` sem autorização escrita** do Emerson.
- **Não aplica SQL em PROD**, não roda migration em PROD, não clica Deploy na Vercel.
- **Não vê nem manuseia chaves secretas** (`OPENAI_API_KEY`, `SERVICE_ROLE_KEY`, etc.).
- Não mexe em DNS. Não re-aplica o ensaio (§7).
- Trabalho do agente = local, revisado, commitado (com pathspec explícito); PROD é do humano.

---

## 2. Mapa dos 4 bancos (Supabase)

Quatro projetos distintos. **Confundir banco é o erro mais caro do projeto.**

| # | Project ref | Papel | Estado | Regra |
|---|---|---|---|---|
| 1 | `nnvjeijsrwpzsggwqpcu` | **Site PROD** (institucional) | Em produção | **INTOCÁVEL.** Stop-guard: se a URL contiver este ref, **pare**. |
| 2 | `fpgimirtiryivnrjdyxb` | **DEV** da plataforma logada | Nível 3 validado 100% | Livre p/ teste. `.env.local`. sa-east-1. |
| 3 | `bidcon-plataforma-prod` | **PROD nova** da plataforma logada | A criar (vazio) | sa-east-1. Banco do site **NÃO** é reusado. |
| 4 | `szsqdpwwxtmrtrhaikuh` | **Ensaio** de hash-chain | **Concluído e validado** (§7) | **Não re-aplicar nada.** |

> A plataforma logada (`platform/`, 2º projeto Vercel `bidcon-plataforma`, Root=`platform/`,
> DNS `app.bidcon.com.br`) usa banco **próprio** — nunca o do site (#1).

---

## 3. DELTA-10 — delta idempotente para PROD "salpicado"

- **Origem:** commit `dbe4053 docs(prod): delta idempotente 0005-0015 para PROD salpicado (revisão)`.
- **O que é:** conjunto **idempotente** (`if not exists` / `create or replace`) que
  leva um PROD parcialmente aplicado ("salpicado") ao estado esperado, cobrindo a
  faixa **0005→0015** (10 passos → "DELTA-10").
- **Por quê:** um PROD que recebeu migrations fora de ordem/parcialmente não pode
  simplesmente rodar a cascata inteira. O delta reconcilia sem quebrar o que já existe.
- **Como aplicar (humano):** só as que faltam, **na ordem**, no SQL Editor do PROD-alvo.
  Idempotência garante segurança em re-execução, mas **conferir antes** o que já existe.
- **Fronteira:** o agente **só validou sintaxe local**. Aplicação em PROD é do Emerson.

---

## 4. Fatias entregues (com status)

Unidades de entrega ("fatias"/"slices"), do git log — HEAD `e6d8b10`.

| Fatia | Commit | Escopo | Status |
|---|---|---|---|
| **Fatia 0** | `fec09f3` | Motor de preço puro da assunção de dívida (repasse) | ✅ commitado |
| **Fatia 2** | `c2c7dd5` | Página pública estática c/ 2 simuladores (repasse) | ✅ commitado |
| **Slice 1** | `39c0f86` | Escrow — máquina de estados + fee-plan + testes (reserva) | ✅ commitado |
| **Repasse 0017** | *staged* | `0017_repasse.sql` + `0017.test.ts` | ⏳ em staging — **fora deste commit** |

**Nível 3 (busca semântica, pgvector):** ✅ validado em **DEV** (`fpgimirtiryivnrjdyxb`);
⏳ **falta** aplicar em PROD (migrations + envs + backfill). Sem chave → busca cai em
**503 honesto** (degradação, não erro feio).

**Outras entregas commitadas:** Verificador IA v1 (`6a4f32f`), Termo de Reserva +
import/export JSON (`6c11297`, `42d1253`), aviso interno de novo cadastro com guarda de
léxico (`7006216`), ingestão multi-fonte LANCE+CBC+PIFFER+CARTAS+SERVOPA (`7741dcc`),
SEO/`llms.txt` de `/repasse` (`e6d8b10`, `4d6be65`).

**Verificador cross-domain (2026-07-03):** o cliente estático em `www.bidcon.com.br`
chamava a rota autenticada em `app.bidcon.com.br` sem CORS credenciado — feature
quebrada (cookie de sessão não trafegava). Correção coerente em 2 arquivos:
(①) URL absoluta `https://app.bidcon.com.br/api/verificador` no `termo-reserva.html`;
(②) CORS restrito na rota (`Access-Control-Allow-Origin: https://www.bidcon.com.br`
+ handler `OPTIONS`); (③) `credentials: "include"` no cliente;
(④) `Access-Control-Allow-Credentials: true` no servidor (OPTIONS **e** todas as
respostas), origem sempre explícita — nunca `*`; auth e rate-limit intactos.
**Autorização expandida por decisão do Emerson** após o achado do par
credentialed-CORS; a opção literal (B) foi oferecida e **recusada** por entregar
feature quebrada.

**SYNC-SERVOPA-01 — autópsia + aposentadoria (2026-07-11):** a fonte SERVOPA
abortava 100% dos ciclos de sync desde a estreia (77/77 horas), sempre com
`"SERVOPA rpc_falhou lote 1: upstream request timeout"`, nunca entregando
uma carta via sync automático. Autópsia com evidência coletada (não
suposição): (①) `prospere-360/app/api/cotas-servopa/route.js` chama
`GET cartascontempladasservopa.com.br/api/cartas.php` — API JSON real,
paginada (14 páginas, 319 cotas), confirmada por teste ao vivo (200,
~0.03–1s por página; um timeout isolado de 30s numa rajada sequencial, não
reproduzido em retentativas imediatas) — **não é bloqueio anti-bot**, a
suspeita original não se confirma pelos dados; (②) a string de erro só é
logada no `catch` do `db.rpc("sync_aplicar_cotas", ...)` em
`platform/app/api/sync-cotas/route.ts` — ou seja, o fetch upstream **já
tinha sucesso**; a falha é na aplicação em lote no banco, não no upstream
Servopa; (③) `sync_aplicar_cotas` é 100% PL/pgSQL sem rede (`pg_net`/`http`
nem instaladas no projeto xtv) — "upstream request timeout" não existe em
nenhum `RAISE EXCEPTION` do projeto nem em nenhum dos dois repositórios
(grep vazio); é a mensagem padrão do gateway (Kong/PostgREST) da Supabase
quando o Postgres não responde a tempo ao RPC; (④) hipótese mais provável
(registrada como teoria): como o lote 1 nunca commitou uma vez sequer, todo
ciclo tenta o caminho mais pesado possível — 100% INSERT novo, nunca
UPDATE, com o trigger `trg_bidcon_price` rodando um solver Newton-Raphson
por linha — loop auto-reforçado que nunca "esfria". **Decisão de negócio do
Emerson:** a parceria Servopa é comercial, sem integração técnica do lado
deles; o canal oficial passa a ser o importador do `/admin`, não o sync
automático. **Aposentadoria:** `"SERVOPA"` removida do array `FONTES` em
`platform/lib/cotas-source.ts` (única linha que controla a rotação do
cron) — `FonteMarca`, `ENDPOINTS.SERVOPA` e o parsing em
`parsearEnvelope()` ficam **intactos/dormentes**, reversível com uma linha
se a parceria voltar a ser técnica. `sync_fonte_config` (mapeamento
fonte↔administradora, usado pelo importador) e o histórico de
`eventos_sync` foram **preservados**, nenhuma migration aplicada. Nenhuma
mudança no repo `prospere-360` (rota tecnicamente correta, só deixa de ser
chamada pelo cron).

**`sync_fonte_config.ativo` (2026-07-12, migration 0045):** fonte única da
verdade de elegibilidade a sync automático. Nasceu de um falso-positivo
real: o agente Torre (fora deste repo, console de Managed Agents da
Anthropic) reportava "fonte Itaú nunca sincronizou" — na verdade 13
cartas de importação manual (lote `contempla_bens`, migration 0044)
sendo confundidas com fonte de sync automático, já que nenhuma
administradora alimentada só por importação manual jamais gera linha em
`eventos_sync`. Corrigido ao vivo no prompt da Torre (fora deste repo).
A coluna `ativo` existe pra ser a referência que qualquer sistema — Torre,
e futuros parceiros do KIT-PARCEIROS (Servopa/Play, também manuais, mesmo
risco) — pode consultar antes de alertar "nunca sincronizou", sem
duplicar a lista `FONTES` em um terceiro lugar. SERVOPA já nasce `false`
nesta coluna, coerente com a aposentadoria de SYNC-SERVOPA-01 acima.
**Refactor futuro (não urgente):** `FONTES` em `cotas-source.ts` hoje é
array hardcoded; poderia um dia ler `ativo` desta tabela em vez de
duplicar a lista.

**WHATSAPP-01 · F1 — Fundação (2026-07-12, migration 0046):** primeira
fatia de código do atendimento via WhatsApp com cérebro Claude (spec em
`docs/WHATSAPP-01-SPEC.md`). F1 entrega só o encanamento: tabelas
`wa_conversas`/`wa_mensagens` (RLS service-only, zero policies — mesmo
padrão de `fornecedores`/`importacoes` da 0037) + rota
`platform/app/api/whatsapp/route.ts` com handshake GET da Meta e um POST
que valida assinatura (HMAC-SHA256 timing-safe sobre `X-Hub-Signature-256`,
segredo `WHATSAPP_APP_SECRET`), deduplica por `wa_message_id` e grava a
mensagem recebida — sem chamar Claude, sem enviar resposta via Graph API
(isso é F2/F3). **Correção de arquitetura descoberta nesta fatia:** a spec
original apontava as tabelas novas pro projeto Supabase "nnv"
(`nnvjeijsrwpzsggwqpcu`), mas isso conflitava com o mapa de bancos deste
documento (nnv = "Site PROD, INTOCÁVEL") e com `CLAUDE.md` (nnv = "PROD
app logado"). Investigação read-only (`list_tables` via MCP) resolveu:
`nnv` tem o mesmo schema mas está praticamente vazio (`cartas`=1,
`eventos_sync`=0, sem `interesses`/`conversas`/`mensagens`) — não é o banco
que a plataforma usa de fato. O banco real, usado por **todas** as rotas
ativas (`/api/atende`, `/api/mcp`, `/api/sync-cotas`, `/api/admin/*`) via
`createXtvClient()`, é o **xtv** (`cartas`=1.878, `eventos_sync`=11.927,
`interesses`/`conversas`/`mensagens` com uso real). `wa_conversas`/
`wa_mensagens` foram corrigidas pra viver no xtv, junto de
`interesses`/`conversas`/`mensagens` — mesmo padrão, sem banco novo.
Migration 0046 aguarda **AUTORIZO** antes de aplicar em produção; push
aguarda **PUBLICA WHATSAPP-01-F1**.

---

## 5. Cascata (ordem de migrations e deploy)

**Migrations importam em ordem.** Cadeia canônica em `platform/supabase/migrations/`:

```
0001_schema → 0002_rls → 0003_processo_eventos → 0004_cartas_sync →
0005_cartas_vitrine → 0006_status_rpc → 0007_busca_semantica → 0008_kyc →
0009_reserva → 0010_status_carta_propagacao → 0011_administradoras_fornecedores →
0012_sync_administradora → 0013_prospere_ancora → 0014_pos_reserva →
0015_sync_multifonte → 0016_reserve_core → 0017_repasse
```

- **0001→0016** = escopo do **ensaio** (§7), já validado.
- **0017** = repasse, mais novo, em staging — **não** entra no commit deste documento.
- **Cascata de deploy da plataforma (humano):** projeto Vercel `bidcon-plataforma`
  (Root=`platform/`) → migrations na ordem no PROD-alvo → 9 envs (Supabase URL/anon/
  service-role, `CRON_SECRET`, `SYNC_MIN_COTAS`, `SYNC_MAX_QUEDA`, `OPENAI_API_KEY`,
  `ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY`) → seed cartas `900001–900021` →
  backfill de embeddings até `restantes:0` → busca de fumaça.
- **Doc autoritativo do deploy:** `docs/checklist-deploy-amanha.md`.
  `docs/publicar-nivel3-prod.md` está **DESATUALIZADO** (assume reuso do banco do site) — ignorar.

---

## 6. Congelados (fora de escopo — não reabrir)

- **Números reais de comissão / margem:** travado no **Emerson**. Nenhum agente estima.
- **`publicar-nivel3-prod.md`:** desatualizado; substituído por `checklist-deploy-amanha.md`.
- **Voz (Nível 6):** só depois de N3/N4/N5 ✅. Herda "explica, não age".
- **OneSignal / push ativo:** hoje é **stub**.
- **Orquestração multi-agente completa (`orchestration-spec.md`):** RASCUNHO/VISÃO,
  **não implementado** — não tratar como operacional.
- **Aplicar SQL em PROD / `git push` / Vercel / DNS pelo agente:** proibido (§1.2).
- **Re-aplicar o ensaio (§7):** proibido — está concluído.

---

## 7. Ensaio de hash-chain — CONCLUÍDO E VALIDADO em 03/07

Realizado **externamente via conector** no banco de ensaio `szsqdpwwxtmrtrhaikuh`:

- Cadeia **0001→0016** aplicada — **16 migrations registradas**.
- Eventos **`VERIFICATION_*`** gravados.
- **`verify_chain` → ok=true.**
- **Imutabilidade** testada e aprovada.
- **Detecção de elo quebrado** (broken-link) testada e aprovada.

**Status: ✅ CONCLUÍDO E VALIDADO (2026-07-03). NÃO re-aplicar nada no ensaio.**

---

## 8. Aferição — BID-0442 / BID-0492

Cartas-referência usadas como **par de aferição** (medição/regressão) do pipeline —
match semântico, motor de preço de repasse e gate de compliance.

- **BID-0442** e **BID-0492:** cotas canônicas de conferência. Servem para verificar,
  a cada mudança relevante, que: (a) o filtro duro nunca devolve carta acima do teto
  ou fora do tipo; (b) a ordenação por significado se mantém coerente; (c) **nenhuma
  frase de encaixe** contém data de contemplação nem mecânica interna (CCB/FIDC/
  funding/spread/taxa); (d) o motor de preço do repasse é estável e reproduzível.
- **Uso:** rodar a aferição sobre BID-0442/0492 após qualquer alteração em busca,
  preço ou compliance; divergência = regressão a investigar antes de avançar.
- **Fronteira:** aferição roda em **DEV** (`fpgimirtiryivnrjdyxb`); nunca contra o
  site PROD (§2 #1).

---

## 9. Próximos degraus (roadmap travado em escopo)

1. **N3** busca semântica → validar em PROD (migrations + envs + backfill).
2. **N4** Prosperito explicador (texto) — **explica, não age**; toda saída por `sanitizarCompliance`.
3. **N5** especialista por carta — dossiê, mesma fronteira/compliance.
4. **N6** voz — último degrau, só com N3/N4/N5 ✅; fluxo `cérebro → texto →
   sanitizarCompliance → TTS → áudio`.

---

*Documento canônico. Fonte de verdade do estado do projeto. Toda sessão nova começa
por aqui. Emparelhado com `checklist-deploy-amanha.md` (deploy autoritativo),
`setup-supabase-dev.md`, `validacao-nivel3.md` e `checklist-pendencias.md`.*
0017 PROD 20260704132129 auditada · /conta-notarial v4 selo-medalha (merge+seds f444399) · WhatsApp global 5519997561909 provisório até API · selo na home · navbar global = próxima sessão — 04/07
2026-07-11 · WhatsApp oficial migrado de 5519997561909 para 5511973202967 (site + plataforma, todas as superfícies)
2026-07-11 · SERVOPA aposentada da rotação automática de sync (SYNC-SERVOPA-01) — autópsia em §4, sync_fonte_config/eventos_sync preservados, importador /admin vira canal oficial
2026-07-12 · sync_fonte_config.ativo (migration 0045, aplicada via MCP) — corrige falso-positivo da Torre sobre fonte Itaú (importação manual), fonte única da verdade de elegibilidade a sync automático — ver §4
2026-07-12 · WHATSAPP-01 F1 (migration 0046, aguarda AUTORIZO) — wa_conversas/wa_mensagens (RLS service-only, xtv) + webhook /api/whatsapp (handshake + assinatura HMAC + dedup, sem Claude/Graph API ainda), corrige rótulo nnv→xtv na spec (nnv vazio, xtv é o banco real) — ver §4
2026-07-12 · WhatsApp oficial revertido de 5511973202967 para 5519997561909 (número de 07-11 bloqueado no WhatsApp Business) — troca em todas as superfícies (site + plataforma, 16 arquivos: wa.me links, JSON-LD telephone, fallback JS, const WA), docs/AUDITORIA-2026-07.md e a linha de log de 07-11 mantidas como registro histórico, não alteradas
2026-07-12 · WhatsApp oficial de volta a 5511973202967 (bloqueio resolvido, número aprovado pelo WhatsApp Business) — reversão nos mesmos 16 arquivos; linhas de log anteriores (07-11 e a de hoje acima) mantidas como registro histórico, não alteradas
2026-07-12 · Novo bloqueio no 5511973202967 — WhatsApp oficial trocado de volta pra 5519997561909, mesmos 16 arquivos (site + plataforma); linhas de log anteriores mantidas como registro histórico, não alteradas
2026-07-12 · WHATSAPP-01 fix: 401 na validação de X-Hub-Signature-256 — comparação HMAC refeita byte-a-byte (hex sem prefixo sha256=) + log temporário do motivo da rejeição (sem segredo/corpo) pra diagnosticar em produção; Fatia 4 (LGPD) junto: quick reply "Não quero receber" do carrossel marca wa_conversas.opt_out=true — ver platform/app/api/whatsapp/route.ts. PUBLICA condicionado a confirmação do Emerson