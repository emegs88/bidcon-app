-- ============================================================================
-- Bidcon Reserve — 0069: HARDENING-SIMULACOES (pré-condição da SIM-PARCEIRO-02)
-- ----------------------------------------------------------------------------
-- Por quê: 0068 criou `public.simulacoes` com RLS "dono/admin" correta, mas
-- deixou furos abertos de propósito (documentados no próprio 0068):
--
--   (a) `simulacoes_dono_admin_update` permite UPDATE de QUALQUER coluna pro
--       dono/admin a nível de RLS — a imutabilidade de cesta/resultado
--       dependia só da API nunca expor esse update. Comentário deixado em
--       0068: "reforçar com trigger BEFORE UPDATE dedicado se este design for
--       confirmado, antes de aplicar em produção." Confirmado — trigger vem
--       agora, e cobre também `administradora_nome` (ver ponto 3 abaixo).
--
--   (b) `anon` tinha GRANT bruto (INSERT/UPDATE/SELECT/REFERENCES) em TODAS
--       as colunas de `simulacoes` (verificado ao vivo via
--       information_schema.column_privileges, nnv, 22/07/2026) — muito mais
--       largo que o desenho pretendido. A policy `simulacoes_link_publico_select`
--       (SELECT, anon) também não tem nenhum recorte de coluna: gate só por
--       linha (ativo=true e não expirado). Resultado: qualquer request anon
--       pro link público leria cliente_nome (completo) e cliente_whatsapp
--       (telefone) de qualquer simulação ativa não expirada. Tabela está
--       vazia em produção (count=0, verificado ao vivo) — exposição é
--       latente, não vazamento consumado. Nenhum código de app ainda lê/escreve
--       `simulacoes` (grep no repo: única referência é o próprio 0068) — logo
--       este hardening não quebra nada em produção, SIM-PARCEIRO-02 (a feature
--       que usaria esta tabela) ainda não foi construída.
--
-- Decisões (Emerson, checkpoint de revisão desta migration — ver histórico da
-- sessão): trigger BEFORE UPDATE (agora incluindo administradora_nome) +
-- RPC por-id (nunca view enumerável) como única porta de leitura pro anon +
-- expira_em com default de 30 dias E semântica de NULL invertida (NULL nunca
-- aparece publicamente — modo de falha seguro é sumir, não durar pra sempre).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- (a) Imutabilidade de cesta/resultado/administradora_nome: trigger dedicado,
-- não depende da API. Aplica pra QUALQUER UPDATE (dono, admin, futuro
-- service_role via API) — um snapshot servido não pode ser recalculado nem
-- reidentificado depois de criado. `ativo` e `expira_em` continuam editáveis
-- (revogar ou encurtar a validade do link é uso legítimo, não é o que este
-- trigger protege). Distinto do trigger `simulacoes_touch` (0068), que só
-- toca atualizado_em.
-- ----------------------------------------------------------------------------
create or replace function public.simulacoes_bloquear_alteracao_resultado()
 returns trigger
 language plpgsql
 set search_path = 'public'
as $function$
begin
  if new.cesta is distinct from old.cesta
     or new.resultado is distinct from old.resultado
     or new.administradora_nome is distinct from old.administradora_nome then
    raise exception 'simulacao_imutavel: cesta, resultado e administradora_nome nao podem ser alterados apos a criacao'
      using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

comment on function public.simulacoes_bloquear_alteracao_resultado() is
  'Trigger BEFORE UPDATE em simulacoes: bloqueia alteracao de cesta/resultado/administradora_nome apos a criacao da linha (identidade do demonstrativo e imutavel). ativo/expira_em seguem editaveis (revogar/encurtar link e legitimo). Reforca a nivel de banco o que a RLS (simulacoes_dono_admin_update) permite a nivel de linha mas nao de coluna. 0069.';

drop trigger if exists trg_simulacoes_imutavel on public.simulacoes;
create trigger trg_simulacoes_imutavel
  before update on public.simulacoes
  for each row
  execute function public.simulacoes_bloquear_alteracao_resultado();

-- Regra 1 — rodapé de revoke/grant: função de trigger, não é RPC chamável.
-- Ninguém precisa (nem deve) chamá-la diretamente; o motor de triggers a
-- invoca automaticamente independente de grant de EXECUTE. Revoke explícito
-- por clareza/defesa em profundidade.
revoke all on function public.simulacoes_bloquear_alteracao_resultado() from public, anon;

-- ----------------------------------------------------------------------------
-- expira_em: default de 30 dias + semântica de NULL invertida.
-- Antes (0068): coluna nullable sem default; filtro público tratava NULL como
-- "nunca expira" (is null or expira_em > now()). Decisão agora: com o default,
-- toda linha legítima nasce com data de expiração — um NULL só pode vir de bug
-- ou caminho de escrita fora do padrão, e o modo de falha seguro é o link
-- SUMIR (invisível ao público), nunca durar pra sempre por omissão. A API da
-- SIM-PARCEIRO-02 (ainda não construída) fica responsável por deixar o
-- parceiro ENCURTAR o prazo, nunca zerar (nunca gravar NULL de propósito).
-- ----------------------------------------------------------------------------
alter table public.simulacoes
  alter column expira_em set default (now() + interval '30 days');

comment on column public.simulacoes.expira_em is
  'Validade do link publico. Default 30 dias a partir da criacao (0069) — parceiro pode encurtar via API, nunca deve gravar NULL de proposito. Leitura publica (simulacao_publica) exige expira_em > now(): NULL e tratado como expirado/invisivel, nao como "sem prazo".';

-- ----------------------------------------------------------------------------
-- (b) Grant anon reduzido: revoke bruto na tabela-base; RPC por-id como
-- única porta de entrada pro link público — NUNCA uma view/tabela
-- set-returning sem filtro de id, que permitiria enumerar todo o
-- deal-flow de todos os parceiros só varrendo `select * from ...`. O uuid
-- só funciona como segredo se a única forma de ler for "eu já tenho o id".
-- ----------------------------------------------------------------------------

-- Fecha o grant largo (SELECT/INSERT/UPDATE/REFERENCES em toda coluna) que
-- veio de 0068. `authenticated` fica intocado — dono/admin seguem lendo e
-- escrevendo a tabela cheia via RLS (simulacoes_dono_admin_select/update/insert),
-- sem mudança de comportamento pra eles.
revoke all on public.simulacoes from anon;

-- A policy de SELECT pro anon na tabela-base fica órfã (anon não alcança mais
-- a tabela) — em vez de deixar como código morto reativável por um futuro
-- `grant select` desavisado, derruba explicitamente. Qualquer acesso público
-- futuro passa a exigir decisão consciente (recriar a policy) em vez de já
-- estar meio-presente e só "desativada" pelo revoke.
drop policy if exists simulacoes_link_publico_select on public.simulacoes;

-- Defesa contra qualquer rascunho anterior desta migration ter chegado a
-- criar a view descartada (nunca aplicada em produção, mas idempotente por
-- segurança): se existir, cai. A única superfície de leitura pública passa a
-- ser a RPC abaixo.
drop view if exists public.simulacoes_publicas;

create or replace function public.simulacao_publica(p_id uuid)
 returns table (
   id uuid,
   administradora_nome text,
   objetivo text,
   taxa_transferencia numeric,
   cesta jsonb,
   resultado jsonb,
   cliente_primeiro_nome text,
   ativo boolean,
   expira_em timestamptz,
   criado_em timestamptz
 )
 language sql
 stable
 security definer
 set search_path = 'public'
as $function$
  select
    s.id,
    s.administradora_nome,
    s.objetivo,
    s.taxa_transferencia,
    s.cesta,
    s.resultado,
    nullif(split_part(coalesce(s.cliente_nome, ''), ' ', 1), '') as cliente_primeiro_nome,
    s.ativo,
    s.expira_em,
    s.criado_em
  from public.simulacoes s
  where s.id = p_id
    and s.ativo = true
    and s.expira_em > now();
$function$;

comment on function public.simulacao_publica(uuid) is
  'RPC por-id (SECURITY DEFINER): unica superficie de leitura publica (anon) do link de simulacao. Mascara cliente_nome (so primeiro nome via split_part), omite cliente_whatsapp e colunas internas (parceiro_id, administradora_xtv_id, params_fundo). Exige id exato na assinatura (nao ha equivalente set-returning sem filtro) — evita enumeracao do deal-flow de todos os parceiros. expira_em > now() trata NULL como invisivel (falha segura). 0069 — substitui o acesso direto que anon tinha na tabela-base.';

-- Regra 1, caso de exceção documentada: esta função É intencionalmente
-- pública (o cliente final abre o link sem login). revoke primeiro pra
-- limpar os default privileges do schema (que dariam EXECUTE direto ao
-- anon por omissão — incidente 0063/0064), depois grant explícito e
-- justificado a anon + authenticated (parceiro/admin também usam a mesma
-- RPC pra pré-visualizar o link antes de mandar). Pós-apply: `get_advisors`
-- vai listar esta função em `anon_security_definer_function_executable` —
-- ESPERADO e DOCUMENTADO, não é achado novo a corrigir.
revoke all on function public.simulacao_publica(uuid) from public, anon;
grant execute on function public.simulacao_publica(uuid) to anon, authenticated;

commit;

-- FIM 0069 · imutabilidade de cesta/resultado/administradora_nome via trigger
-- dedicado (qualquer role, ativo/expira_em seguem editáveis); anon perde
-- acesso bruto a `simulacoes` e passa a ler só via `simulacao_publica(uuid)`
-- (RPC por-id, sem enumeração possível, cliente_nome mascarado, sem
-- cliente_whatsapp); expira_em ganha default de 30 dias com NULL tratado
-- como expirado na leitura pública. `authenticated` intocado (RLS de 0068
-- segue igual pra dono/admin, exceto pelo trigger de imutabilidade, que
-- também vale pra eles). Nenhuma tabela/coluna removida ou renomeada;
-- nenhum grant de `authenticated` alterado.
--
-- REGISTRO pra SIM-PARCEIRO-02 (fora do escopo SQL desta migration): a API
-- que for construída deve (i) sempre setar/validar expira_em num INSERT
-- explícito (nunca depender só do default, se quiser um prazo diferente de
-- 30 dias) e (ii) permitir o parceiro só ENCURTAR o prazo depois, nunca
-- gravar NULL de propósito — o trigger desta migration não protege
-- expira_em (é editável por design), então essa regra é responsabilidade da
-- camada de aplicação, não do banco.
