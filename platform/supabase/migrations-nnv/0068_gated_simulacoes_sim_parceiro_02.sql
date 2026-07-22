-- ============================================================================
-- Bidcon Reserve — 0068 (GATED, ARQUIVO-ONLY): sub-fatia SIM-PARCEIRO-02
-- (persistência + link compartilhável do demonstrativo do simulador).
-- ----------------------------------------------------------------------------
-- NÃO EXECUTAR VIA apply_migration sem AUTORIZO nominal e digitado do Emerson
-- pra esta fatia especificamente. Este arquivo existe SÓ pra deixar o design
-- proposto revisável em diff — zero escrita em banco, zero aplicação, zero
-- efeito até autorização explícita.
--
-- DISCLOSURE DE NUMERAÇÃO (Regra 2, CLAUDE.md) — ler antes de tocar neste
-- arquivo:
--   - Pasta local (supabase/migrations-nnv/) nesta branch (fatia/sim-parceiro-01,
--     criada a partir de main limpa) termina em 0066_gate_termo_docs_hardening.sql.
--   - `list_migrations` do projeto nnv (nnvjeijsrwpzsggwqpcu) mostra 0067
--     (`reserva_terms_signed_termo`) já aplicada em produção — mas o arquivo
--     0067 NÃO existe nesta branch nem em main; ele pertence à fatia F7a-APP
--     (trabalho anterior, não relacionado a este simulador) e está parado
--     sem commit num stash (`0068-train pendente: adendo Regra2 (CLAUDE.md)
--     + 0066 verbatim + 0067 fixtures footer`), aguardando reconciliação
--     própria — fora do escopo desta sessão/fatia.
--   - Por isso este arquivo NÃO pode usar "0067" (já tomado no remoto) e usa
--     "0068" citando o mesmo número que o stash acima já reserva
--     informalmente para aquele trem F7a-APP não relacionado. Como este
--     arquivo é FILE-ONLY / NÃO APLICADO, não há risco de colisão real em
--     banco — mas quem for reconciliar o stash 0068-train E este arquivo no
--     futuro (provavelmente em sessões/PRs diferentes) PRECISA re-derivar a
--     numeração final via `list_migrations` + pasta local no momento do
--     merge, renomeando um dos dois se ambos ainda pretenderem ser "0068".
--     Não renumerar silenciosamente agora — sinalizar na descrição do PR.
--
-- ESCOPO — o que esta fatia resolve:
--   O simulador (SIM-PARCEIRO-01, client-only, lib/simulador/engine.ts +
--   SimuladorClient.tsx) hoje gera o demonstrativo só na sessão do navegador
--   do parceiro — fechar a aba perde tudo, e o WhatsApp manda só TEXTO (sem
--   link pra reabrir o demonstrativo formatado). Esta sub-fatia persiste o
--   resultado gerado (snapshot imutável dos números — não uma referência viva
--   ao estoque, que muda) numa tabela `simulacoes`, com um link público
--   opaco (pelo próprio `id` uuid, não adivinhável) que o cliente pode abrir
--   sem login pra ver o mesmo demonstrativo que o parceiro gerou.
--
--   IMPORTANTE — snapshot, não referência viva: `cesta` e `resultado` abaixo
--   gravam os valores JÁ CALCULADOS no momento do "Enviar por WhatsApp"
--   (poder de compra, entrada, TIR, escala de parcelas etc.), exatamente como
--   o motor (lib/simulador/engine.ts) produziu naquele instante. Isso é
--   proposital: se a cota for reservada/vendida por outro cliente depois, ou
--   se o motor de cálculo mudar numa versão futura, o link já compartilhado
--   PRECISA continuar mostrando o que foi prometido ao cliente naquele
--   momento — nunca recalcular silenciosamente depois do fato (mesmo
--   princípio de "valores finais, nunca recalcular" já aplicado a
--   entrada/parcela do estoque em lib/simulador/engine.ts).
--
--   `administradora_id`/cota `id` dentro de `cesta` referenciam o projeto xtv
--   (catálogo real), NÃO a tabela `public.administradoras`/`public.cartas`
--   deste projeto (nnv tem as suas próprias, menores/curadas — ver mapa de
--   ambientes no CLAUDE.md). Por isso NÃO há FK pra essas colunas — mesmo
--   padrão já usado por `cedente_cartas.carta_xtv_id` (0020_cedente_cartas.sql):
--   uuid solto, sem `references`, com o motivo documentado aqui.
--
-- ASSUNÇÕES DE DESIGN (reconstrução — texto literal do pedido original da
-- sub-fatia SIM-PARCEIRO-02 não estava disponível nesta sessão; campos abaixo
-- foram inferidos do necessário pra "persistência + link compartilhável" e
-- PRECISAM de revisão do Emerson antes de qualquer AUTORIZO):
--   - Link = o próprio `id` (uuid v4, não sequencial, não adivinhável) — sem
--     token separado, pra manter a tabela simples. Revogável via `ativo=false`.
--   - `expira_em` opcional: dá suporte a expirar o link (estoque/condições
--     ficam velhos com o tempo); política de leitura pública já filtra por
--     isso, mas nenhuma rotina de expiração automática é criada aqui (ficaria
--     pra uma fatia própria, com cron, se o negócio confirmar a necessidade).
--   - Sem DELETE físico exposto a ninguém além de admin/service_role — só
--     `ativo=false` (revogação), consistente com a postura geral do projeto
--     contra deleção destrutiva por engano.
-- ============================================================================

create table if not exists public.simulacoes (
  id uuid primary key default gen_random_uuid(),
  parceiro_id uuid not null references public.profiles(id),

  -- Identidade da administradora simulada (projeto xtv — ver nota acima;
  -- sem FK proposital). Nome duplicado (não só o id) pra o link público não
  -- depender de outra fonte pra exibir o nome se o catálogo xtv mudar depois.
  administradora_xtv_id uuid not null,
  administradora_nome text not null,

  -- Snapshot da cesta (array de CotaSim, mesmo shape de lib/simulador/engine.ts)
  -- no momento da geração — nunca recalcular a partir de estoque atual.
  cesta jsonb not null,

  objetivo text not null check (objetivo in ('aquisicao', 'levantamento')),
  taxa_transferencia numeric not null default 0,

  -- Snapshot de ParamsFundo (fundoPct/ccb/iofPct/taxaNoLiquido) — só
  -- preenchido quando objetivo='levantamento'; null em 'aquisicao'.
  params_fundo jsonb,

  -- Snapshot do resultado já calculado (poderCompra, entradaTotal,
  -- saldoDevedor, desembolsoInicial, tirMensal/tirCliente + equivalente a.a.,
  -- custosFundo, liquidoCliente, escalaParcelas) — o link público lê ISTO,
  -- nunca reexecuta o motor sobre estoque potencialmente mudado.
  resultado jsonb not null,

  cliente_nome text,
  cliente_whatsapp text,

  ativo boolean not null default true,
  expira_em timestamptz,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists simulacoes_parceiro_idx
  on public.simulacoes (parceiro_id);

comment on table public.simulacoes is
  'SIM-PARCEIRO-02 (GATED): snapshot imutável de um demonstrativo gerado pelo simulador (SIM-PARCEIRO-01), com link público via id (uuid) pra o cliente reabrir sem login. cesta/resultado são snapshots — nunca recalculados a partir do estoque atual ou de uma versão futura do motor de cálculo.';

comment on column public.simulacoes.administradora_xtv_id is
  'Id da administradora no projeto xtv (catálogo real) — sem FK: nnv tem sua própria tabela administradoras (menor/curada), projetos distintos, mesmo padrão de cedente_cartas.carta_xtv_id.';

comment on column public.simulacoes.cesta is
  'Snapshot da cesta no momento da geração (array de CotaSim: id, ref, credito, entrada, prazo, parcela, custoAmEstoque, exclusiva) — valores finais, nunca recalculados.';

comment on column public.simulacoes.resultado is
  'Snapshot do resultado já calculado pelo motor (poderCompra, entradaTotal, saldoDevedor, desembolsoInicial, tir/tirAnualEquivalente, custosFundo, liquidoCliente, escalaParcelas) no momento do envio — nunca reexecutar o motor sobre este registro depois.';

-- Trigger de atualizado_em: reaproveita a function já existente no projeto
-- (mesmo padrão de vendas_novas em 0021_fatia1_venda_nova_multiadm.sql).
drop trigger if exists simulacoes_touch on public.simulacoes;

create trigger simulacoes_touch
  before update on public.simulacoes
  for each row
  execute function public.tg_set_atualizado_em();

alter table public.simulacoes enable row level security;

-- ---------------------------------------------------------------------------
-- RLS — dono (parceiro) e admin.
-- ---------------------------------------------------------------------------
drop policy if exists simulacoes_dono_admin_select on public.simulacoes;

create policy simulacoes_dono_admin_select
  on public.simulacoes
  for select
  to authenticated
  using (
    parceiro_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.tipo = 'admin'::tipo_perfil
    )
  );

drop policy if exists simulacoes_dono_insert on public.simulacoes;

create policy simulacoes_dono_insert
  on public.simulacoes
  for insert
  to authenticated
  with check (
    parceiro_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.tipo = 'admin'::tipo_perfil
    )
  );

-- Update restrito: dono/admin só pode mexer em ativo/expira_em (revogar ou
-- ajustar validade do link) — nunca reescrever cesta/resultado depois de
-- gerado (snapshot é imutável por design; ver comentário da tabela).
drop policy if exists simulacoes_dono_admin_update on public.simulacoes;

create policy simulacoes_dono_admin_update
  on public.simulacoes
  for update
  to authenticated
  using (
    parceiro_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.tipo = 'admin'::tipo_perfil
    )
  )
  with check (
    parceiro_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.tipo = 'admin'::tipo_perfil
    )
  );

comment on policy simulacoes_dono_admin_update on public.simulacoes is
  'Policy permite UPDATE de qualquer coluna a nível de RLS; a imutabilidade de cesta/resultado depende da API (rota /api/simulador/*) só expor update de ativo/expira_em — reforçar com trigger BEFORE UPDATE dedicado se este design for confirmado, antes de aplicar em produção.';

-- ---------------------------------------------------------------------------
-- EXCEÇÃO (documentada, per CLAUDE.md): leitura pública (anon) do link
-- compartilhável — só pelo id exato (uuid não adivinhável), só enquanto
-- ativo=true e não expirado. Justificativa: o cliente final abre o link
-- recebido via WhatsApp sem ter conta/login na plataforma.
-- ---------------------------------------------------------------------------
drop policy if exists simulacoes_link_publico_select on public.simulacoes;

create policy simulacoes_link_publico_select
  on public.simulacoes
  for select
  to anon
  using (
    ativo = true
    and (expira_em is null or expira_em > now())
  );

comment on policy simulacoes_link_publico_select on public.simulacoes is
  'EXCEÇÃO documentada (CLAUDE.md, Regra 1): grant de leitura a anon é intencional — o cliente final abre o demonstrativo pelo link (id uuid não adivinhável) sem login. Só linhas ativo=true e não expiradas. Revisar com Emerson antes de aplicar: expõe cliente_nome/cliente_whatsapp a quem tiver o link.';

grant select on public.simulacoes to anon;
grant select, insert, update on public.simulacoes to authenticated;
revoke delete on public.simulacoes from anon, authenticated, public;

-- FIM 0068 (SIM-PARCEIRO-02, GATED) — arquivo de design pra revisão. Nenhuma
-- execução, nenhum apply_migration, nenhum efeito em qualquer banco até
-- AUTORIZO nominal do Emerson especificamente para esta fatia.
