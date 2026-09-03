-- ============================================================================
-- FUNIL-01 F3 — telefone_chave: a chave de COMPARAÇÃO de telefone
-- DRAFT. NAO APLICAR. Nasce sem numero por CLAUDE.md Regra 5; recebe o
-- proximo livre no momento do apply autorizado. Alvo: xtv (xtvjpnyadcdeadhmzyff).
-- Ao aplicar, move para platform/supabase/migrations/ com o numero do momento.
-- ============================================================================
--
-- POR QUE ESTA FUNÇÃO EXISTE
-- A casa tem duas réguas de telefone, e elas discordam na FORMA da saída:
--   `platform/lib/telefone.ts:7`  normalizarTelefoneBR  ACRESCENTA o 55
--   `0083_sentinela_dedup_telefone.sql:107` sentinela_telefone_norm  CORTA o 55
-- As duas concordam na intenção e produzem strings diferentes. Comparar o
-- resultado de uma com o da outra é comparar réguas, não corpos.
--
-- E nenhuma das duas resolve o caso que motivou a F3. Medido em 02/09/2026:
--   captação do Leandro   82981131987   (com o nono dígito)
--   conversa do Leandro  558281131987   (sem o nono dígito)
-- O que separa as duas linhas não é o DDI: é o NONO DÍGITO. Tirar ou pôr o 55
-- não faz uma virar a outra por nenhum caminho.
--
-- Por isso esta função NÃO é uma terceira forma de GUARDAR telefone. É uma
-- chave de IGUALDADE, derivada, nunca persistida. As duas colunas envolvidas
-- (`captacoes.telefone` e `wa_conversas.telefone`) continuam exatamente nos
-- formatos que já têm. Nada é reescrito.
--
-- A CHAVE
--   chave = DDD (2 dígitos) || últimos 8 dígitos
-- Composta SOBRE `sentinela_telefone_norm`, e não ao lado dela: a guarda de
-- comprimento daquela função (que salva o DDD 55 de Santa Maria e Uruguaiana
-- de virar outra pessoa) passa a valer aqui de graça. Reimplementar o corte
-- do 55 aqui seria criar a terceira régua que este arquivo existe para evitar.
--
-- POR QUE OS ÚLTIMOS 8, E NÃO OS ÚLTIMOS 9
-- A migração brasileira do nono dígito (celulares de 8 para 9 dígitos)
-- acrescentou um algarismo NA FRENTE do número, preservando a cauda. Os 8
-- últimos são, portanto, a parte que sobrevive à migração. Cortar por 9
-- manteria o problema do Leandro de pé.
--
-- O RISCO RESIDUAL, DECLARADO E NÃO ESCONDIDO
-- Dois números do mesmo DDD que difiram SÓ no nono dígito colapsam na mesma
-- chave. Na numeração brasileira isso é o mesmo número antes e depois da
-- migração do 9, e não dois assinantes: fixo começa em 2–5 e celular em 6–9,
-- então fixo e celular não colidem na cauda. Mas isso é argumento sobre o
-- plano de numeração, não medição de dado — e por isso a lista de candidatas
-- da F3.1 mostra os DOIS telefones brutos ao lado da chave, para que quem
-- confere veja a colisão se ela existir.
--
-- A GUARDA DE COMPRIMENTO, QUE É O QUE FAZ A FUNÇÃO SER SEGURA
-- Só 10 ou 11 dígitos produzem chave. Fora disso, NULL. Duas razões, ambas
-- medidas e nenhuma teórica:
--   1. Número estrangeiro. Há conversa de Portugal em `wa_conversas`
--      (prefixo 351). `sentinela_telefone_norm` não corta o 351 — a guarda
--      dela exige `left(d,2) = '55'` — e devolve 12 dígitos. Sem esta guarda,
--      `left(d,2) || right(d,8)` faria uma chave plausível para um número que
--      não tem DDD nenhum.
--   2. Lixo curto. Com menos de 10 dígitos, `left(d,2)` e `right(d,8)` se
--      SOBREPÕEM e a função devolveria uma string mais longa que a entrada,
--      inventando dígitos. NULL nunca é igual a NULL num `=`, então uma linha
--      sem chave só pode ser duplicata de si mesma — que é o comportamento
--      certo.
--
-- O GÊMEO EM TYPESCRIPT
-- `platform/lib/telefone.ts` ganha `chaveTelefone`, que compõe a mesma chave
-- sobre `normalizarTelefoneBR` (tirando o 55 que aquela põe). Os dois lados
-- são provados pelas mesmas fixtures em `platform/lib/telefone.test.ts` e por
-- uma leitura desta expressão pela porta. Se um dia divergirem, o teste de
-- espelho é o que avisa.
--
-- ENQUANTO ESTE ARQUIVO ESPERA GATE
-- A consulta de candidatas da F3.1 NÃO chama `telefone_chave`: ela inlina a
-- expressão, para poder rodar hoje sem esperar apply de DDL. Quando esta
-- função entrar no banco, a consulta passa a chamá-la e o inline sai.
-- ============================================================================

create or replace function telefone_chave(bruto text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
           when d is null                     then null
           when length(d) not in (10, 11)     then null
           else left(d, 2) || right(d, 8)
         end
  from (select sentinela_telefone_norm(bruto) as d) x;
$$;

comment on function telefone_chave(text) is
  'FUNIL-01 F3: chave de COMPARACAO de telefone, nunca persistida. DDD (2 digitos) + ultimos 8, composta sobre sentinela_telefone_norm. Os ultimos 8 sobrevivem a migracao do nono digito, que e o que separa a captacao da conversa do mesmo cedente. NULL fora de 10/11 digitos, o que descarta numero estrangeiro e lixo curto. Risco declarado: dois numeros do mesmo DDD que difiram so no nono digito colapsam na mesma chave.';
