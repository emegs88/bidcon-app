-- ============================================================================
-- FAROL-ESCUTA-01 · farol_pauta
-- AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-ESCUTA-01", 08/08/2026:
-- "quero agente autonomo que procura videos tendencia crescimentos faz copy
--  adaptado a bidcon".
-- ----------------------------------------------------------------------------
-- O QUE ESTA TABELA GUARDA. Uma linha por dia: a fôrma sorteada pela rotação,
-- o gancho, o roteiro falado, a legenda escrita, as hashtags — e as FONTES que
-- a busca web devolveu. Ela é o contrato entre dois crons que não se falam:
-- /api/farol/pauta escreve às 10h BRT, /api/farol/reel-render lê às 11h30 BRT.
--
-- POR QUE `fontes` EXISTE, E POR QUE É jsonb. A OS pediu "para auditoria", e a
-- auditoria aqui é de ORIGEM, não de texto. O agente é proibido de copiar
-- frase de terceiro: ele lê o que está em alta, extrai a ESTRUTURA (gancho,
-- ângulo, formato) e escreve original com os números da carta. Guardar
-- título/URL/tema do que ele leu é a única forma de, meses depois, alguém
-- conferir que a pauta do dia 12 não saiu decalcada de um vídeo específico.
-- jsonb porque o formato do que a busca devolve é do Google/Anthropic, não
-- nosso: colunar isso seria migrar a tabela toda vez que eles mudarem um campo.
--
-- POR QUE `unique (dia, formula)`, E NÃO `unique (dia)`. Foi o que a OS
-- escreveu ("dia (date, UNIQUE com formula)") e a leitura é defensável: a
-- rotação é DETERMINÍSTICA sobre a data, então numa operação normal existe uma
-- fôrma por dia e a restrição vale como "uma linha por dia". Se um dia alguém
-- quiser duas pautas no mesmo dia com fôrmas diferentes (um teste A/B), o banco
-- não atrapalha. O que ele impede é o caso real: o cron rodando duas vezes e
-- gravando a MESMA pauta duas vezes.
--
-- A CORRIDA AQUI CUSTA DINHEIRO, NÃO REPUTAÇÃO — E POR ISSO A ORDEM É O
-- INVERSO DA DO farol_yt_comentarios. Lá a linha nasce ANTES da ação, porque a
-- ação era falar em público e duplicar seria irreversível. Aqui nada é
-- publicado: o pior caso de uma corrida é gastar duas buscas (~centavos) e
-- perder uma escrita no 23505. Então a rota confere ANTES de gastar (pré-check
-- barato) e grava DEPOIS de escrever, com o unique como rede — em vez de
-- reservar a linha e correr o risco de o reel-render encontrar uma pauta pela
-- metade e renderizar um vídeo com roteiro vazio.
--
-- POR QUE `status` É TEXT COM CHECK, E NÃO ENUM. Enum em Postgres exige
-- migração para ganhar um valor novo; esta máquina de estados ainda vai crescer
-- (a OS já prevê métrica por fôrma). CHECK dá a mesma garantia e sai barato.
--
-- 'reprovada' NÃO É LIXO, É PROVA. Quando o linter derruba o texto do modelo, a
-- linha FICA, com o motivo. É assim que se descobre que uma fôrma específica
-- puxa o modelo para "investimento" toda semana — e o show não para, porque o
-- reel-render cai no template determinístico de sempre.
--
-- SEM FK PARA `cartas`. Mesma razão das tabelas anteriores do FAROL: a carta
-- vem de uma VIEW no schema do estoque e pode sair de circulação; a pauta é
-- registro histórico e não pode ser apagada em cascata por isso.
--
-- RLS LIGADA, ZERO POLICY. O service_role ignora RLS — é ele quem escreve e lê
-- aqui. Ligar sem policy é exatamente o que fecha a porta para a chave anônima
-- do navegador. Tabela sem RLS ligada é tabela pública.
-- ============================================================================

create table if not exists farol_pauta (
  id            uuid primary key default gen_random_uuid(),
  dia           date not null,
  formula       text not null,
  gancho        text,
  roteiro       text,
  legenda       text,
  hashtags      text[],
  fontes        jsonb,
  status        text not null default 'nova'
                  check (status in ('nova', 'usada', 'reprovada')),
  motivo_linter text,
  carta_id      uuid,
  criado_em     timestamptz not null default now(),
  unique (dia, formula)
);

-- O reel-render pergunta exatamente isto, uma vez por dia: "existe pauta 'nova'
-- para hoje?". Índice PARCIAL porque só o estado 'nova' é consultado com
-- pressa; 'usada' e 'reprovada' são leitura de auditoria, sem pressa nenhuma —
-- e um índice parcial não paga por linhas que ninguém procura.
create index if not exists farol_pauta_nova_idx
  on farol_pauta (dia)
  where status = 'nova';

alter table farol_pauta enable row level security;

comment on table farol_pauta is
  'Pauta diária do FAROL escrita pelo agente de escuta (FAROL-ESCUTA-01). Uma linha por dia; `fontes` guarda título/URL do que a busca leu, para auditoria de ORIGEM — o agente extrai estrutura, nunca copia texto. status reprovada = linter barrou e o reel-render caiu no template.';
