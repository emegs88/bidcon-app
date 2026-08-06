-- ============================================================================
-- 0067_insta_canal — FATIA INSTA-01 (Prosperito nas DMs do @bidcon.br)
-- AUTORIZADO: Emerson Gomes dos Santos — "vamos fazer tudo agora",
-- 06/08/2026 ~13h30.
-- ----------------------------------------------------------------------------
-- Uma conversa de Instagram mora na MESMA wa_conversas: `telefone` guarda o
-- IGSID (id numérico que a Meta atribui à pessoa por conta comercial) e
-- `canal` diz de onde ela veio. Nenhuma tabela nova, nenhuma coluna além
-- destas — wa_mensagens serve como está.
--
-- POR QUE TEM UM ÍNDICE AQUI (a OS previa "+ índice se a leitura do código
-- mostrar consulta por telefone+canal" — mostrou):
--
--   Medido no banco em 06/08/2026, não inferido:
--     wa_conversas_telefone_key  UNIQUE (telefone)
--   e três call-sites gravam com esse índice como alvo de conflito —
--     app/api/whatsapp/route.ts        .upsert({telefone},{onConflict:"telefone"})
--     app/api/whatsapp/disparo/route.ts        idem
--     app/api/sentinela/varredura/route.ts     idem
--
--   Com UNIQUE(telefone) sozinho, o upsert do Instagram teria que apontar
--   pro mesmo índice — e aí um IGSID que por acaso coincidisse com um
--   telefone já cadastrado cairia em DO UPDATE e FUNDIRIA a conversa de
--   duas pessoas diferentes, silenciosamente. É o pior tipo de bug: não
--   falha, mistura.
--
--   Trocar UNIQUE(telefone) por UNIQUE(telefone,canal) resolveria a fusão,
--   mas quebraria os três upserts acima ("no unique or exclusion constraint
--   matching the ON CONFLICT specification") — inclusive o do webhook do
--   WhatsApp, cujo diff a OS exige VAZIO. Então NÃO se troca.
--
--   Os dois convivem. O índice composto existe pra ser o alvo de conflito do
--   lado do Instagram; o UNIQUE(telefone) continua sendo o alvo dos três
--   call-sites do WhatsApp, byte por byte como antes. Efeito colateral
--   desejado: se um IGSID colidir com um telefone existente, o INSERT do IG
--   viola UNIQUE(telefone) e ERRA ALTO (conversa não nasce, erro logado) em
--   vez de fundir em silêncio. Falhar é recuperável; misturar não.
--
--   Medição de plausibilidade da colisão (06/08/2026): 16 linhas em
--   wa_conversas, todas só dígitos, comprimento 12–13 (E.164 sem "+").
--   IGSID tem 16–17 dígitos. A colisão é improvável — o que não é motivo
--   pra deixá-la silenciosa.
--
-- DDL 100% aditivo: nenhuma linha existente muda de valor além do default
-- 'whatsapp' aplicado ao backfill, que é exatamente o que essas 16 linhas
-- são.
-- ============================================================================

alter table wa_conversas
  add column if not exists canal text not null default 'whatsapp';

-- Alvo de conflito do upsert do Instagram. NÃO substitui
-- wa_conversas_telefone_key (ver bloco acima) — convive com ele.
create unique index if not exists wa_conversas_telefone_canal_key
  on wa_conversas (telefone, canal);

comment on column wa_conversas.canal is
  'Origem da conversa: whatsapp (default) ou instagram. No canal instagram, '
  'a coluna telefone guarda o IGSID da pessoa, não um número de telefone.';
