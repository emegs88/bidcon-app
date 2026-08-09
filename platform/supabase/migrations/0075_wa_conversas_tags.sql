-- PAINEL-DASHBOARD-01 (conserto 2) — wa_conversas.tags
--
-- O funil da sala de controle pede uma etapa "marcadas cedente" que não tinha
-- fonte NENHUMA. Medido em 09/08/2026: o enum `wa_status` é
-- (ativo | humano | encerrado) e não existe, em coluna alguma de wa_conversas,
-- marcação de que a pessoa do outro lado quer VENDER a cota dela. Sem isto a
-- última etapa do funil é um bloco vazio permanente.
--
-- POR QUE `text[]` E NÃO UMA COLUNA `cedente boolean`.
-- Um booleano responde uma pergunta só, e a próxima etiqueta (inadimplente,
-- contemplado, parceiro, curioso) pediria outra coluna, outra migração e outro
-- lugar para esquecer de olhar. Um array de etiquetas absorve as próximas sem
-- mudar o schema. O custo é não haver validação de domínio no banco — quem
-- escreve etiqueta é o código, e a lista canônica mora em lib/farol/cedente.ts.
--
-- NOT NULL DEFAULT '{}' de propósito: com nullable haveria TRÊS estados
-- (null, {}, {...}) para representar dois, e todo consumidor teria que decidir
-- sozinho se `null` significa "sem etiqueta" ou "nunca avaliado". Array vazio é
-- "avaliado e nada bateu"; a distinção "nunca avaliado" é resolvida por DATA
-- (ver DETECTOR_CEDENTE_DESDE em lib/farol/cedente.ts), que é onde ela de fato
-- mora — o detector entrou em produção num instante, e conversa anterior a ele
-- não é conversa sem etiqueta, é conversa nunca examinada.
--
-- Em Postgres 11+ um ADD COLUMN com DEFAULT não constante-volátil não reescreve
-- a tabela, então isto é seguro nas 100 e poucas linhas de hoje e continuaria
-- seguro em milhões.
--
-- APLICAR SÓ COM AUTORIZAÇÃO EXPLÍCITA E SEPARADA (mesmo padrão da 0062): este
-- arquivo DOCUMENTA a mudança e não é rodado automaticamente. Enquanto não for
-- aplicado, o código já enviado degrada sozinho — a leitura do painel tenta
-- `tags`, leva erro de coluna inexistente e relê sem ela, e o funil mostra o
-- bloco vazio dizendo que a migração 0075 não foi aplicada.

begin;

alter table wa_conversas
  add column if not exists tags text[] not null default '{}';

comment on column wa_conversas.tags is
  'Etiquetas de intenção da conversa, atribuídas pelo detector de vocabulário em lib/farol/cedente.ts. Hoje só ''cedente'' (quer VENDER a própria cota). Heurística de palavra-chave, não classificação de IA: serve para PRIORIZAR atendimento humano, nunca como fato comercial. Array vazio = avaliado e nada bateu; conversa anterior a 09/08/2026 nunca foi avaliada (ver DETECTOR_CEDENTE_DESDE).';

-- Containment (`tags @> '{cedente}'`) é a única consulta prevista, e é
-- exatamente o que o GIN indexa. Sem índice a tabela de hoje responderia igual;
-- o índice existe para que a consulta do painel não vire varredura no ano em
-- que a tabela crescer, quando ninguém vai lembrar de voltar aqui.
create index if not exists wa_conversas_tags_idx
  on wa_conversas using gin (tags);

-- Acréscimo ATÔMICO de etiqueta. Existe para não fazer ler-modificar-escrever
-- no código: duas mensagens da mesma conversa chegando no mesmo instante — que
-- é o normal quando alguém manda três balões seguidos — leriam o mesmo array e
-- a segunda escrita apagaria a etiqueta da primeira. `array_append` sob o guard
-- de containment resolve no banco, numa instrução, e é idempotente: chamar dez
-- vezes com a mesma etiqueta deixa uma.
create or replace function wa_conversa_add_tag(p_conversa uuid, p_tag text)
returns void
language sql
as $$
  update wa_conversas
     set tags = array_append(tags, p_tag)
   where id = p_conversa
     and not (tags @> array[p_tag]);
$$;

comment on function wa_conversa_add_tag(uuid, text) is
  'Acrescenta uma etiqueta a wa_conversas.tags de forma atômica e idempotente. Usada pelo webhook do WhatsApp e pelo webhook do Instagram.';

commit;
