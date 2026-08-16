-- ============================================================================
-- 0081_sentinela_toque_por_linha — FATIA SENTINELA-RADAR-01, Parte 1 (1.3)
-- AUTORIZADO: Emerson, 15/08/2026 ("max_toques por linha, default 2, 1 nos
-- antigos... status encerrado_por_silencio").
-- NÃO APLICADA neste commit. Arquivo primeiro, apply só com ordem expressa.
-- ----------------------------------------------------------------------------
-- POR QUE O TETO DE TOQUES DEIXA DE SER GLOBAL
--
-- MAX_TOQUES era uma constante da rota: 2, igual para todo mundo. Isso trata
-- como iguais duas populações que a medição mostra serem diferentes:
--
--   - 21 linhas em 'aguardando_template', TODAS com criado_em idêntico
--     (2026-08-04 22:27:20.820481+00 — carimbos_distintos = 1). São de uma
--     captação única, e desde então passaram onze dias sem um toque sequer,
--     porque o template nunca existiu.
--   - 5 linhas em 'pendente', com 5 carimbos distintos (06/08 a 14/08), que
--     entraram no ritmo normal.
--
-- Onze dias depois, insistência é lida como cobrança. Um segundo toque na
-- mesma pessoa não soa como cuidado — soa como sistema. Por isso as antigas
-- levam max_toques = 1: uma frase, uma vez. A honestidade é a única coisa que
-- ainda reabre a conversa nesse ponto, e a frase que abre é a que assume o
-- erro, não a que oferece carta.
--
-- O default segue 2 para quem entrar daqui pra frente, que é o comportamento
-- que a rota já tinha.
--
-- ----------------------------------------------------------------------------
-- POR QUE 'esgotado' NÃO BASTAVA
--
-- 'esgotado' hoje quer dizer duas coisas ao mesmo tempo: "tocamos o máximo e
-- não voltou" e "acabou". Perde a informação de POR QUE acabou, que é a única
-- que serve pra decidir o que fazer com a linha depois. Os três valores novos
-- separam saídas que não são a mesma coisa:
--
--   encerrado_por_silencio  — tocamos o que era pra tocar, o cliente não
--                             respondeu. É o fim natural do fluxo.
--   encerrada_cordialmente  — a conversa já tinha ACABADO BEM antes de a fila
--                             existir; tocar seria reabrir o que foi fechado
--                             com "até logo".
--   handoff_humano          — alguém do time já assumiu; o Sentinela tocar
--                             junto é duas vozes falando com a mesma pessoa.
--
-- ----------------------------------------------------------------------------
-- O QUE ESTA MIGRAÇÃO NÃO FAZ, E POR QUE
--
-- Não retira nenhuma linha da fila. Postgres recusa USAR um valor de enum na
-- mesma transação em que ele é criado ("unsafe use of new value of enum type"),
-- então qualquer update para 'encerrada_cordialmente' / 'handoff_humano' tem de
-- vir em migração posterior — que também é onde a decisão de QUAIS linhas cabe.
-- A medição do banco encontrou UMA conversa em handoff (conversas.status =
-- 'humano'), não três; interesses.atendido_por é NULL nas 26. Escrever nome na
-- mão sem o campo que prove seria inventar dado.
-- ============================================================================

-- 1. Os três valores novos. IF NOT EXISTS porque migração tem de poder rodar
--    duas vezes sem quebrar (o apply por MCP pode dar timeout com commit —
--    CLAUDE.md, Regra 3).
alter type sentinela_status add value if not exists 'encerrado_por_silencio';
alter type sentinela_status add value if not exists 'encerrada_cordialmente';
alter type sentinela_status add value if not exists 'handoff_humano';

-- 2. Teto de toques por linha.
alter table sentinela_fila
  add column if not exists max_toques smallint not null default 2;

-- Zero pararia a linha sem nunca tocar, e é indistinguível de "esquecemos de
-- preencher". Teto alto é o outro extremo: 2 é o que a casa já praticava, e
-- passar disso exige decisão humana, não digitação.
alter table sentinela_fila
  drop constraint if exists sentinela_fila_max_toques_faixa;
alter table sentinela_fila
  add constraint sentinela_fila_max_toques_faixa
  check (max_toques between 1 and 3);

comment on column sentinela_fila.max_toques is
  'SENTINELA-RADAR-01: teto de toques DESTA linha. Default 2. As 21 captadas em 04/08 levam 1 — onze dias de silencio nosso transformam o segundo toque em cobranca.';

-- 3. Backfill das antigas. O recorte é o carimbo, não o status: status muda,
--    criado_em não. A medição mostrou carimbos_distintos = 1 nas 21, então o
--    '<=' abaixo pega exatamente elas e nada do que entrou depois (o próximo
--    carimbo é 06/08).
update sentinela_fila
   set max_toques = 1
 where criado_em <= '2026-08-05 00:00:00+00'
   and max_toques <> 1;

-- ----------------------------------------------------------------------------
-- 4. A SELEÇÃO SAI DA ROTA E VEM PRA CÁ — e o motivo é um bug, não estética.
--
-- A rota selecionava com `.lt("tentativas", MAX_TOQUES)` + `.limit(15)`. Com o
-- teto virando COLUNA, PostgREST não sabe comparar duas colunas da mesma linha
-- (`tentativas < max_toques` não existe na sintaxe). O caminho preguiçoso seria
-- afrouxar o filtro no banco e refinar em JavaScript — e é justamente ele que
-- reintroduz o defeito que o Emerson apontou: a janela de 15 seria consumida
-- por linhas que o JS depois descarta. As 21 antigas, todas com criado_em
-- IDÊNTICO e primeiras na ordem, ocupariam as 15 vagas toda execução e as 5
-- novas nunca chegariam a ser olhadas — para sempre, não uma vez.
--
-- Com o filtro no SQL, quem não pode ser tocado não ocupa vaga.
--
-- O desempate por `id` que a ordem pediu está aqui, no `order by criado_em, id`:
-- é o mesmo desempate, escrito onde a comparação entre colunas também tem de
-- morar. Sem ele, 21 linhas com o mesmo carimbo saem em ordem arbitrária do
-- Postgres — e "arbitrária" pode significar as mesmas 15 sempre.
create or replace function sentinela_a_tocar(limite int default 15)
returns table (
  id               uuid,
  conversa_site_id uuid,
  wa_conversa_id   uuid,
  nome             text,
  telefone         text,
  status           text,
  tentativas       int,
  max_toques       smallint,
  ultimo_envio_em  timestamptz,
  proximo_toque_em timestamptz
)
language sql
stable
set search_path = public
as $$
  select f.id, f.conversa_site_id, f.wa_conversa_id, f.nome, f.telefone,
         f.status::text, f.tentativas, f.max_toques,
         f.ultimo_envio_em, f.proximo_toque_em
  from sentinela_fila f
  where f.status in ('pendente', 'aguardando_template', 'enviado')
    and f.tentativas < f.max_toques
    and (f.proximo_toque_em is null or f.proximo_toque_em <= now())
  order by f.criado_em, f.id
  limit greatest(coalesce(limite, 0), 0);
$$;

comment on function sentinela_a_tocar(int) is
  'SENTINELA-RADAR-01: linhas elegiveis a toque AGORA, com o teto por linha aplicado no SQL. Desempate por id porque as 21 de 04/08 tem criado_em identico.';

-- CLAUDE.md, Regra 1 — com desvio declarado, e mais APERTADO que o padrão.
-- O rodapé da regra concede EXECUTE a `authenticated`. Aqui não: esta função
-- lê telefone de lead parado e só existe para o cron, que fala com o banco
-- pela service key. Nenhum usuário logado tem motivo para chamá-la. O objetivo
-- da Regra 1 é fechar a porta do `anon` aberta por default privilege; fechar
-- também a do `authenticated` não a contraria — vai além dela.
revoke all on function public.sentinela_a_tocar(int) from public, anon, authenticated;
grant execute on function public.sentinela_a_tocar(int) to service_role;
