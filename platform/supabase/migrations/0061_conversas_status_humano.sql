-- CRM-01: alarga o CHECK de conversas.status pra permitir 'humano'.
--
-- ACHADO (sessão CRM-01): a tabela `conversas` (chat do site) nunca teve
-- migration versionada no repo — foi criada direto em produção. O
-- constraint real só permitia 'aberta'/'fechada'. Isso quebrava
-- silenciosamente a escalação em platform/app/api/atende/route.ts (linha
-- ~731, `update({ status: "humano" })`): o UPDATE falhava (erro não
-- verificado) e, mesmo se funcionasse, a busca da conversa aberta
-- (`.eq("status","aberta")`) não encontraria mais a conversa escalada na
-- mensagem seguinte — o bot voltava a responder numa conversa nova.
--
-- Este migration é só o alargamento do constraint (aditivo, nenhuma linha
-- existente é afetada — hoje só existem 'aberta'/'fechada' na tabela). O
-- fix da rota /api/atende (lookup + gate) é código, não schema, e vem
-- junto no mesmo commit desta fatia.
--
-- Aplicado diretamente no xtv em produção via apply_migration (autorização
-- explícita do usuário), nome da migration remota:
-- "conversas_status_permite_humano". Este arquivo documenta a mudança no
-- repo pra manter o histórico rastreável — mesmo espírito das migrations
-- 0046/0052/0057 que documentam wa_conversas/wa_mensagens.

begin;

alter table conversas drop constraint conversas_status_check;
alter table conversas add constraint conversas_status_check
  check (status = any (array['aberta', 'fechada', 'humano']));

commit;
