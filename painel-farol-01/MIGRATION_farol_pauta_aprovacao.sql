-- ============================================================================
-- DRAFT — NÃO APLICADA. Aguarda gate nominal digitado do Emerson.
--
-- Mora AQUI, e não em `platform/supabase/migrations/`, por CLAUDE.md Regra 4
-- ("draft NÃO APLICAR não mora em pasta de migration"; lar único = pasta da
-- fatia na raiz do repo). NASCE SEM NÚMERO por CLAUDE.md Regra 5 ("numeração
-- sai da ordem REAL de aplicação"): recebe o próximo livre no momento de
-- aplicar, derivado de `list_migrations` + do conteúdo de
-- `platform/supabase/migrations/` NAQUELE momento — não do que eu vi hoje.
--
-- PROJETO-ALVO: **xtv** (`xtvjpnyadcdeadhmzyff`). `farol_pauta` foi criada na
-- 0071, em `platform/supabase/migrations/`, que é a pasta do xtv (Regra 2).
-- NÃO é nnv. Nada aqui toca nnv, ACERVO-360 ou prospere-lancamentos.
-- ============================================================================
-- PARA QUE SERVE
--
-- PAINEL-FAROL-01 item 2: com `FAROL_PAUTA_APROVA=on`, a pauta escrita às 10h
-- para de nascer pronta para uso e passa a esperar um humano. Isso são dois
-- estados novos numa máquina que hoje tem três:
--
--   'aguardando_aprovacao'  escrita pelo agente, ainda não olhada por ninguém.
--                           O reel-render NÃO consome.
--   'aprovada'              um admin leu e liberou. É o que o reel-render passa
--                           a exigir quando a env está on.
--
-- Os três estados atuais ficam INTOCADOS e continuam significando o mesmo:
--   'nova'       o fluxo autônomo de hoje (env off) — nasce assim e é consumida
--                assim. Nada muda para quem não ligar a env.
--   'usada'      virou reel.
--   'reprovada'  o LINTER derrubou o texto (máquina).
--
-- POR QUE 'reprovada' NÃO SERVE PARA A REPROVAÇÃO HUMANA, e existe
-- 'reprovada_humano'. Hoje 'reprovada' significa exatamente uma coisa:
-- "o linter de compliance barrou, e `motivo_linter` diz qual regra". É o dado
-- que responde "qual fôrma puxa o modelo para fora da cerca toda semana" — a
-- pergunta que o comentário da 0071 diz, com todas as letras, que a linha
-- reprovada existe para responder. Misturar "um humano não gostou do gancho"
-- nesse mesmo balde envenena essa medição em silêncio: a fôrma passaria a
-- parecer não-conforme por motivo editorial. Estado separado custa uma linha de
-- CHECK e preserva as duas leituras.
-- ============================================================================
-- COMO APLICAR (ordem obrigatória da Regra 2)
--   1. mover/copiar este arquivo para `platform/supabase/migrations/` com o
--      próximo número livre derivado NA HORA (referência do dia em que foi
--      escrito: 0071 é a última em disco — conferir contra `list_migrations`);
--   2. aplicar LENDO DESSE ARQUIVO (nunca SQL que existe só no chat);
--   3. rodar `get_advisors` (security) e colar a saída.
--
-- ENSAIO: esta migration é do xtv, e szs espelha o nnv — não há ensaio
-- equivalente disponível. Mitigação: a alteração é de CHECK, aditiva, sem
-- reescrita de dados e sem mudança de assinatura de função. `alter table` de
-- constraint pega ACCESS EXCLUSIVE por instantes numa tabela de ~dezenas de
-- linhas.
--
-- SEM RODAPÉ DE GRANT (Regra 1): esta migration não cria nem altera função.
-- Não há `revoke/grant` a fazer — a Regra 1 governa função em `public`, e aqui
-- só se mexe numa constraint de tabela. A tabela segue com RLS ligada e zero
-- policy, alcançável só por service_role, como a 0071 a deixou.
--
-- REVERSÍVEL: para voltar, basta recriar o CHECK com os três valores originais.
-- Só é seguro depois de garantir que nenhuma linha esteja nos estados novos
-- (`FAROL_PAUTA_APROVA` desligada + as pendentes resolvidas), senão o CHECK
-- antigo é recusado pela validação das linhas existentes.
-- ============================================================================

alter table farol_pauta
  drop constraint if exists farol_pauta_status_check;

alter table farol_pauta
  add constraint farol_pauta_status_check
  check (
    status in (
      'nova',
      'usada',
      'reprovada',
      'aguardando_aprovacao',
      'aprovada',
      'reprovada_humano'
    )
  );

-- O índice parcial da 0071 (`farol_pauta_nova_idx ... where status = 'nova'`)
-- responde "existe pauta consumível para hoje?". Com a env on, a pergunta passa
-- a ser sobre 'aprovada', e o índice de 'nova' não a cobre. Índice irmão, também
-- parcial, pelo mesmo raciocínio da 0071: só o estado consultado com pressa paga
-- índice. Os dois convivem porque as duas perguntas convivem — a env pode ser
-- desligada a qualquer momento e o fluxo antigo volta inteiro.
create index if not exists farol_pauta_aprovada_idx
  on farol_pauta (dia)
  where status = 'aprovada';

-- A fila do painel: "o que está esperando um humano?". Sem data no filtro,
-- porque pauta esquecida de anteontem é exatamente o que se quer enxergar.
create index if not exists farol_pauta_aguardando_idx
  on farol_pauta (dia desc)
  where status = 'aguardando_aprovacao';

comment on table farol_pauta is
  'Pauta diária do FAROL escrita pelo agente de escuta (FAROL-ESCUTA-01). Uma linha por dia; `fontes` guarda título/URL do que a busca leu, para auditoria de ORIGEM — o agente extrai estrutura, nunca copia texto. status: nova/aprovada = consumível pelo reel-render (qual dos dois depende de FAROL_PAUTA_APROVA); usada = virou reel; reprovada = LINTER barrou (motivo_linter); reprovada_humano = admin recusou no painel (PAINEL-FAROL-01).';
