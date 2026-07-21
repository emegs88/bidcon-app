-- FATIA 1 (venda nova): adiciona wa_conversas.referral pra guardar o
-- payload de referral do Click-to-WhatsApp Ads (CTWA) que a Meta manda no
-- webhook quando a conversa nasce de um anúncio. Alimenta atribuição do
-- FAROL (junto com o UTM first-touch capturado no widget do site).
--
-- Coluna nullable, aditiva — nenhuma linha existente é afetada. Gravação é
-- first-touch only (só grava se referral IS NULL na conversa; nunca
-- sobrescreve um referral já capturado) — lógica fica no código
-- (platform/app/api/whatsapp/route.ts), não neste arquivo.
--
-- Aplicar só com autorização explícita e separada (mesmo padrão da 0061 em
-- CRM-01): este arquivo documenta a mudança, mas NÃO é rodado
-- automaticamente — apply_migration só depois do "AUTORIZO" do Emerson.

begin;

alter table wa_conversas add column if not exists referral jsonb;

comment on column wa_conversas.referral is
  'FATIA 1: payload de referral do CTWA (Click-to-WhatsApp Ads) da Meta, capturado first-touch (só na primeira mensagem da conversa, nunca sobrescrito). Nullable — maioria das conversas não vem de anúncio.';

commit;
