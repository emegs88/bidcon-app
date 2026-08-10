-- ============================================================================
-- 0077_wa_anexo_ver.sql — PROSPERITO-ANEXO-01, Entrega 2 (VER)
-- PROJETO: xtv (xtvjpnyadcdeadhmzyff). NÃO rodar na nnv.
-- ----------------------------------------------------------------------------
-- POR QUE ESTA MIGRAÇÃO EXISTE. Desde 20/07/2026 o extrato do cedente chega
-- pelo WhatsApp, é baixado da Graph e guardado no bucket privado `wa-extratos`
-- (migração 0057). Medido em 10/08/2026: 15 anexos, 15 com media_id, 15 com
-- storage_path, 0 baixados sem subir. E nenhum deles é visível em lugar nenhum
-- do painel — `app/admin/conversas/whatsapp/[id]/page.tsx` nunca seleciona as
-- duas colunas. É lead qualificado guardado num cofre sem porta.
--
-- POR QUE NÃO EXISTE UMA TABELA `wa_anexos`. A ordem pedia uma. A medição
-- desaconselhou: `media_id` e `storage_path` já vivem em `wa_mensagens` numa
-- relação estritamente 1:1 — o WhatsApp entrega UMA mídia por mensagem, e as
-- 15 linhas medidas confirmam (15 mensagens, 15 media_id, 15 storage_path).
-- Uma tabela nova obrigaria a escolher entre duplicar as duas colunas (duas
-- fontes de verdade para o mesmo fato) ou apagá-las de `wa_mensagens` e
-- quebrar `lib/whatsapp/processar-background.ts:211`, que escreve ali. O que
-- faltava de verdade eram três campos — mime, nome e tamanho. É o que este
-- arquivo acrescenta.
-- AUTORIZADO: Emerson Gomes dos Santos — 10/08/2026, decisão "ALTER em
-- wa_mensagens" tomada sobre a medição acima.
--
-- SE UM DIA HOUVER N ANEXOS POR MENSAGEM (mídia múltipla, ou anexo enviado
-- pelo nosso lado), esta escolha vira dívida e a tabela 1:N passa a ser certa.
-- Fica registrado aqui para que a decisão seja revista com o fato novo, e não
-- por gosto.
--
-- BUCKET: `wa-extratos` continua PRIVADO e continua criado À MÃO no painel do
-- Supabase — SQL não cria bucket nesta casa (precedente 0008/0014 na nnv).
-- Nada aqui mexe em storage.
--
-- RLS: padrão do projeto xtv — `enable row level security` com ZERO policies.
-- A xtv não tem `auth.users` nem `is_admin()`; todo acesso é service_role via
-- `createXtvClient()`. A restrição a admin é feita na camada de aplicação por
-- `checarAdminConsoleApi()`. RLS ligada sem policy é a trava de fundo: se algum
-- dia uma chave anon vazar para esta tabela, ela lê zero linhas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Os três campos que faltavam no anexo.
-- ----------------------------------------------------------------------------
-- Todos NULLABLE de propósito. As 15 linhas antigas não têm como saber o
-- tamanho sem rebaixar os bytes, e inventar um zero seria pior que um vazio:
-- zero é um número, e número mente calado. A tela sabe lidar com nulo.
alter table public.wa_mensagens
  add column if not exists mime_type     text,
  add column if not exists nome_arquivo  text,
  add column if not exists tamanho_bytes bigint;

comment on column public.wa_mensagens.mime_type is
  'MIME do anexo, como a Meta informou no webhook (document.mime_type / image.mime_type). Nas 15 linhas anteriores a 10/08/2026 foi DERIVADO da extensão do storage_path, não observado — ver bloco 4.';
comment on column public.wa_mensagens.nome_arquivo is
  'Nome original do arquivo (document.filename da Meta). Nulo para imagem: o WhatsApp não manda nome de foto. NÃO retroagido — `conteudo` já guarda o filename nas linhas antigas, mas guarda a legenda quando não há filename, e os dois são indistinguíveis depois do fato.';
comment on column public.wa_mensagens.tamanho_bytes is
  'Tamanho em bytes medido no download (midia.bytes.byteLength). Nulo nas linhas anteriores a 10/08/2026 — o dado não foi guardado e só voltaria rebaixando o arquivo.';

-- ----------------------------------------------------------------------------
-- 2. Índice parcial: a fila de "Extratos recebidos".
-- ----------------------------------------------------------------------------
-- A tela lista os anexos mais recentes de TODAS as conversas. Sem índice isso
-- é varredura em wa_mensagens inteira (362 linhas hoje, mas cresce com cada
-- mensagem de texto, que é a esmagadora maioria). Parcial porque só 15 das 362
-- linhas têm anexo: o índice fica ~4% do tamanho de um índice cheio e responde
-- exatamente a pergunta da tela.
create index if not exists wa_mensagens_anexo_idx
  on public.wa_mensagens (criado_em desc)
  where storage_path is not null;

-- ----------------------------------------------------------------------------
-- 3. Log de acesso ao arquivo.
-- ----------------------------------------------------------------------------
-- Extrato de cota é documento financeiro DE TERCEIRO. Quem abriu e quando não
-- é enfeite de auditoria: é a única prova que a casa terá se algum dia alguém
-- perguntar. Mesmo papel que farol_log/sentinela_log cumprem para seus agentes.
--
-- POR QUE ISTO CONSEGUE DIZER "ABRIU" E NÃO SÓ "PEDIU". Uma URL assinada, uma
-- vez cunhada, é abrível N vezes sem passar por nós — um log feito na emissão
-- registraria intenção, não leitura. Por isso a página NÃO recebe URL assinada:
-- ela aponta para /api/admin/conversas/anexo, que confere a sessão, grava aqui,
-- cunha uma URL de vida curta e redireciona. Todo acesso atravessa o servidor.
--
-- `motivo` separa o clique deliberado do carregamento automático da miniatura.
-- Sem essa coluna, abrir a thread de uma conversa com 6 fotos escreveria 6
-- linhas de "abertura" que ninguém decidiu, e o log viraria ruído — que é o
-- mesmo que não ter log, só que mais caro de ler.
create table if not exists public.wa_anexo_acessos (
  id           uuid primary key default gen_random_uuid(),
  mensagem_id  bigint not null references public.wa_mensagens(id) on delete cascade,
  storage_path text   not null,
  admin_email  text   not null,
  motivo       text   not null default 'abertura'
               check (motivo in ('abertura', 'miniatura')),
  criado_em    timestamptz not null default now()
);

comment on table public.wa_anexo_acessos is
  'PROSPERITO-ANEXO-01: quem abriu qual extrato e quando. Escrita só service_role (RLS ligada, zero policies). Uma linha por passagem pela rota /api/admin/conversas/anexo — a página nunca recebe URL assinada, justamente para que todo acesso seja registrável.';
comment on column public.wa_anexo_acessos.motivo is
  'abertura = clique deliberado do operador. miniatura = carregamento automático da prévia na thread. Separados para que a auditoria de quem LEU um documento não seja afogada por render de tela.';
comment on column public.wa_anexo_acessos.admin_email is
  'E-mail da sessão admin (BIDCON_ADMIN_EMAILS), lido de checarAdminConsoleApi(). Nunca vem do cliente.';

create index if not exists wa_anexo_acessos_mensagem_idx
  on public.wa_anexo_acessos (mensagem_id, criado_em desc);

alter table public.wa_anexo_acessos enable row level security;
-- zero policies de propósito — ver cabeçalho.

-- ----------------------------------------------------------------------------
-- 4. Retroação do mime — e só dele.
-- ----------------------------------------------------------------------------
-- A extensão do storage_path foi ESCRITA a partir do mime, por EXT_POR_MIME em
-- lib/whatsapp/media.ts. Inverter esse mapa é determinístico, não é chute.
-- Medido em 10/08/2026: as 15 linhas têm só `.jpg` (11) e `.pdf` (4) — nenhuma
-- caiu no fallback `.bin`, que é o único caso em que a extensão não determina o
-- mime. Por isso o `where` cobre extensão por extensão e ignora o resto: se
-- amanhã existir um `.bin`, ele fica NULO em vez de receber um palpite.
--
-- nome_arquivo e tamanho_bytes NÃO são retroagidos. Ver comentários das colunas.
update public.wa_mensagens
   set mime_type = case
         when storage_path like '%.pdf'  then 'application/pdf'
         when storage_path like '%.jpg'  then 'image/jpeg'
         when storage_path like '%.png'  then 'image/png'
         when storage_path like '%.webp' then 'image/webp'
       end
 where storage_path is not null
   and mime_type is null
   and (storage_path like '%.pdf' or storage_path like '%.jpg'
        or storage_path like '%.png' or storage_path like '%.webp');

-- ----------------------------------------------------------------------------
-- CONFERÊNCIA (rodar depois de aplicar; nenhuma destas escreve)
-- ----------------------------------------------------------------------------
-- Esperado em 10/08/2026: 15 anexos, 15 com mime, 4 pdf e 11 jpg, 0 sem mime.
--
--   select count(*) filter (where storage_path is not null)            as anexos,
--          count(*) filter (where storage_path is not null
--                             and mime_type is null)                   as sem_mime,
--          count(*) filter (where mime_type = 'application/pdf')       as pdf,
--          count(*) filter (where mime_type = 'image/jpeg')            as jpg
--     from public.wa_mensagens;
--
--   select count(*) from public.wa_anexo_acessos;   -- esperado: 0
-- ============================================================================
