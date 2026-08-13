-- =============================================================
-- BIDCON-ASSINATURA-01 — 0072: delta v2→v3
-- A 0071 foi aplicada a partir do draft v2; este delta corrige
-- para o estado v3 aprovado na revisão (13/08/2026).
-- Autorização nominal: "autorizo ASSINATURA-01" (Emerson).
-- =============================================================

-- BLOQUEADOR: unique cheia quebra a regeneração do gerar_contrato
-- (0066:268, insert puro) — trocar por unique PARCIAL nos tipos novos.
alter table public.contratos drop constraint if exists contratos_processo_tipo_uniq;
create unique index if not exists contratos_processo_tipo_assinatura_uniq
  on public.contratos (processo_id, tipo)
  where tipo in ('cessao','requerimento_conta');

-- LGPD / URL-capacidade: cliente não lê signatários nesta fatia.
drop policy if exists ass_sig_select_cliente on public.assinatura_signatarios;

-- Índice que faltou no v2.
create index if not exists idx_ass_env_processo on public.assinatura_envelopes(processo_id);

-- Comment correto: path interno, nunca URL do provedor.
comment on column public.contratos.pdf_assinado_path is
  'BIDCON-ASSINATURA-01: path interno no bucket processo-docs do PDF assinado ({processo_id}/{item}-assinado-{ts}.pdf). Nunca URL temporária do provedor.';

-- Regra 1 na função do trigger: search_path fixo + revoke; drop-first.
create or replace function public.tg_ass_env_touch() returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

revoke execute on function public.tg_ass_env_touch() from public, anon, authenticated;

drop trigger if exists tg_ass_env_touch on public.assinatura_envelopes;
create trigger tg_ass_env_touch before update on public.assinatura_envelopes
  for each row execute function public.tg_ass_env_touch();
