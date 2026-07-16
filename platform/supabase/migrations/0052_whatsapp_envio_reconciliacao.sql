-- 0052_whatsapp_envio_reconciliacao — projeto xtv (xtvjpnyadcdeadhmzyff).
-- Reconciliação de repo: as migrations remotas "0047_whatsapp_envio" e
-- "0048_whatsapp_f3" (aplicadas em produção em 12/07/2026, via MCP, na
-- mesma sessão que criou 0046_whatsapp_fundacao) NUNCA tiveram arquivo
-- local — foram aplicadas direto e o arquivo .sql não foi salvo no repo
-- na época. Esta migration não cria nada novo: apenas espelha (idempotente,
-- `if not exists`) o que já está em produção, pra o histórico do repo bater
-- com o banco real antes da fatia F2+F3 (envio Graph + Time Prosperito)
-- começar a depender dessas colunas. Inspecionado read-only via
-- information_schema nesta sessão — ver docs/WHATSAPP-01-SPEC.md.
--
-- wa_conversas ganhou:
--   agente_ativo      : qual persona do Time Prosperito está com o "bastão"
--                        nesta conversa agora (mesmo mecanismo de bastão do
--                        /api/atende — ver ##AGENTE:<id>## em _prompt.ts).
--                        default 'prosperito' (persona inicial).
--   respondendo_desde : timestamptz nullable — marca "em andamento" enquanto
--                        o agente está processando/gerando resposta; serve
--                        de lock simples pra evitar disparo duplicado se
--                        chegar mais de um evento antes da resposta sair.
--   opt_out           : boolean, já em uso desde a Fatia 4 (ver migration
--                        do webhook e fix e8c9ac3) — LGPD, nunca enviar se
--                        true.
--   interesse_id      : uuid nullable, FK -> interesses(id) — permite ligar
--                        uma conversa de WhatsApp a um interesse já
--                        existente do site (handoff futuro), sem obrigar
--                        vínculo (nullable).
--
-- wa_mensagens ganhou:
--   template     : nome do template Meta usado, quando o envio foi via
--                  sendTemplate (nulo pra texto livre).
--   status_envio : 'enviado' | 'falha' (texto livre, não enum — mesmo
--                  padrão simples de outras colunas de status no repo).
--   erro         : mensagem de erro da Graph API quando status_envio='falha'
--                  (nunca o token, nunca dado sensível).
--   agente       : qual persona gerou esta mensagem específica (texto livre,
--                  ex.: 'prosperito', 'valentina') — mesmo padrão da coluna
--                  `mensagens.agente` do site (/api/atende).
--   tokens_in / tokens_out : uso de tokens do Anthropic nesta chamada,
--                  observabilidade/custo (mesmo padrão de `mensagens` do
--                  site).

alter table public.wa_conversas
  add column if not exists agente_ativo text not null default 'prosperito',
  add column if not exists respondendo_desde timestamptz,
  add column if not exists opt_out boolean not null default false,
  add column if not exists interesse_id uuid references public.interesses(id);

alter table public.wa_mensagens
  add column if not exists template text,
  add column if not exists status_envio text,
  add column if not exists erro text,
  add column if not exists agente text,
  add column if not exists tokens_in integer,
  add column if not exists tokens_out integer;
