-- 0019_portal_rls_cartas_cliente_processo.sql — projeto nnv (app logado/auth).
-- PORTAL-01: fecha o gap de RLS que impedia o cliente de ler a própria carta.
-- /meu-processo já existe e já trata a ausência com segurança (ver
-- app/meu-processo/page.tsx), mas hoje `carta` sempre vem null pro cliente
-- porque não existe policy de SELECT ligando cartas -> processos.cliente_id.
--
-- Extraído da migration 0054 (projeto xtv, pasta supabase/migrations/) — só a
-- parte 1 (a policy). As partes 2/3 daquela migration (views
-- vw_vitrine_viva/vw_carousel_cartas com fonte/exclusiva) ficam no xtv, que é
-- quem alimenta a vitrine pública via /api/vitrine (createXtvClient()) — nnv
-- não tem essas views e não precisa: /meu-processo e /cartas leem
-- diretamente de nnv.cartas via createClient() (RLS), não das views.
--
-- Schema conferido via information_schema antes de escrever esta migration:
-- nnv.processos tem cliente_id (uuid, not null) e carta_id (uuid); nnv.cartas
-- tem id (uuid) — SQL idêntico ao da 0054, sem nenhum ajuste de coluna.
--
-- Prova de comportamento: já ensaiada ponta-a-ponta em staging (szs) na
-- fatia original da 0054 (2 clientes, JWT simulado via set_config + SET
-- LOCAL ROLE authenticated, dentro de BEGIN...ROLLBACK) — cliente dono do
-- processo vê a própria carta mesmo em status != 'disponivel'; outro
-- cliente sem processo não vê. Reaproveitada aqui porque o EXISTS é aditivo
-- e o schema de destino (nnv) bate coluna-a-coluna com o testado.
--
-- `drop policy if exists` antes do `create` só por idempotência (permite
-- reaplicar este arquivo sem erro se já rodou uma vez).

drop policy if exists cartas_cliente_processo_select on public.cartas;

create policy cartas_cliente_processo_select
  on public.cartas
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.processos p
      where p.carta_id = cartas.id
        and p.cliente_id = auth.uid()
    )
  );

comment on policy cartas_cliente_processo_select on public.cartas is
  'PORTAL-01: cliente enxerga a carta vinculada ao próprio processo (qualquer status), via processos.cliente_id = auth.uid(). Só leitura.';
