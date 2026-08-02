-- =====================================================================
-- IDENTIDADE-01 / T2 — staging do replay + gerador de payload (alvo: szs)
-- =====================================================================
-- Reconstrói, a partir do histórico persistido do xtv (SÓ LEITURA), o
-- multiconjunto {tipo, credito, entrada, parcela, parcelas, adm_raw,
-- adm_resolvida, contagem} por fonte e por ciclo, e gera os payloads no
-- padrão do chamador real (app/api/sync-cotas/route.ts).
--
-- Rótulo obrigatório em todo uso destes dados:
--   "replay reconstruído do histórico persistido"
--
-- ---------------------------------------------------------------------
-- MÉTODO DE RECONSTRUÇÃO (decisão T2-b) — e seus limites, declarados
-- ---------------------------------------------------------------------
-- !! Este bloco descreve a reconstrução v1, que foi SUPERADA. As duas
-- !! premissas riscadas abaixo foram medidas e refutadas; a versão em
-- !! vigor está em "CORREÇÃO v2" logo a seguir. O texto original fica
-- !! para trilha de auditoria — não é o que roda.
--
-- [v1 — REFUTADO] Âncora de ciclo: eventos sync_fim do xtv. Medido: 543
--   ciclos, de 2026-07-08 23:07:49 a 2026-08-01 15:01:13.
--   LIMITE 1: a spec pede 30 dias; sync_fim só existe a partir de 08/07,
--   logo a janela ancorável real é de ~24 dias, não 30. carta_nova recua
--   até 28/06 e carta_indisponivel até 30/06, mas sem âncora de ciclo.
--   LIMITE 2: sync_fim é marcador GLOBAL do ciclo horário, não por fonte
--   — seu detalhe é "total_ms=… fontes_ok=… fontes_falha=…", sem nome de
--   fonte e sem contagem de cotas, e com numero_externo/carta_id nulos.
--   Por isso a atribuição por fonte NÃO vem do sync_fim: vem de
--   cartas.administradora_origem. O sync_fim é usado só como fronteira.
--
-- [v1 — REFUTADO] Vida da carta: criado_em → seu primeiro evento
--   carta_indisponivel (modelo da spec). VALIDADO ao vivo contra a
--   verdade de hoje no xtv: 0 falsos-mortos e 22 falsos-vivos em 94.747
--   cartas (0,023%).
--   LIMITE 3: as 22 divergentes não têm NENHUM evento carta_indisponivel
--   e ainda assim estão 'indisponivel', sendo atualizadas de hora em hora
--   pelo sync — foram rebaixadas sem evento. É estoque invisível, e é
--   exatamente o dano que D11 elimina (órfã só desce disponivel→
--   indisponivel; casamento só enxerga viva, nunca ressuscita morta).
--
-- ---------------------------------------------------------------------
-- CORREÇÃO v2 — o que efetivamente foi derivado e transportado
-- ---------------------------------------------------------------------
-- Por que a correção existe: o controle externo LANCE 1:1 (ADENDO-3)
--   FALHOU contra o staging derivado em v1 — 12 cotas vivas no xtv não
--   tinham tupla no catálogo. O critério interno dos deltas jamais veria
--   esse defeito: os deltas fechavam consigo mesmos. O controle funcionou.
--
-- CAUSA CONFIRMADA (H1): a regra de seleção v1 acima — morte no PRIMEIRO
--   carta_indisponivel, cegueira a ressurreição. Confirmação: v1 sobre a
--   janela cheia de 13 dias devolve exatamente 187 tuplas LANCE, o número
--   registrado na tabela de escala abaixo — prova de que o catálogo v1
--   foi derivado assim. As 12 perdidas se dividem 6/6, como previsto:
--     • 6 mortas em v1 ANTES da janela (nunca entram na abertura):
--       veiculo 33133, 34582, 38770, 49286, 51809, 70458;
--     • 6 ressuscitando DENTRO da janela via carta_atualizada — que em v1
--       não é nascimento, logo não gera delta:
--       veiculo 29069, 30590, 39609, 41495, 42121, 56419.
--   As 12 morreram em 2026-07-05 21:03, antes de existir qualquer
--   sync_fim: são permanentemente invisíveis ao modelo v1.
--
-- HIPÓTESE H2 (irmã de tupla) — REFUTADA: 37291 e 78703 têm exatamente
--   uma carta cada, sem irmã de tupla; entraram por ressurreição pura.
--
-- MEDIÇÃO DE ARQUITETURA, ao vivo — o ponto cego v1 é material NAS DUAS
--   fontes: vivas hoje com morte no histórico = LANCE 20/64 (31%) e
--   CARTAS 33/228 (14,5%). Ou seja: o "fecha exato" da CARTAS em v1 NÃO
--   era derivação correta, era cobertura acidental por irmãs de tupla —
--   churn recria atributos idênticos. Por isso a certificação por md5
--   abaixo foi tratada como obrigatória, não formalidade.
--
-- IRONIA TÉCNICA que explica tudo: a fonte SAUDÁVEL é a que o v1 falha.
--   Churn recria linhas novas (v1-visíveis); saúde preserva linhas
--   antigas que ressuscitam (v1-cegas).
--
-- ÂNCORA DE CICLO v2 (medida, 40/40): ciclo_ts = date_trunc('hour', em)
--   sobre os eventos DE CARTA (carta_nova, carta_atualizada,
--   carta_indisponivel) das fontes do replay — NÃO sync_fim. Verificado
--   contra os 40 ciclos carregados: casam exatamente, em ordem. Horas com
--   sync_fim e sem evento de carta não são ciclo; horas com evento de
--   carta e sem sync_fim são.
--
-- CORTE v2 = instante real de término do ciclo, não o rótulo. Como não
--   existe nenhum evento das fontes entre o último evento de cada hora e
--   o fim dessa hora, corte := ciclo_ts + interval '1 hour' é
--   PROVADAMENTE equivalente ao instante real — e resolve a fronteira de
--   minutos (419572/563909 ressuscitam 13:01 contra o rótulo 13:00).
--
-- MODELO DE VIDA v2 (ratificado; substitui a linha "Vida da carta"):
--   multi-intervalo, "último evento vence". O estado em T é dado pelo
--   último evento de carta com em <= T: carta_indisponivel → morta;
--   carta_nova / carta_atualizada → viva. Empate no mesmo instante: a
--   morte vence. Cartas sem evento recebem um nascimento sintético em
--   criado_em, de modo que toda carta é coberta.
--
-- CERTIFICAÇÃO POR md5 (derivado no xtv x transportado no szs):
--   CARTAS — certificada v2-equivalente SEM retransporte, os três batem:
--     catálogo 296  dc9a5e3e732f84de36f7c3a15fa3048f
--     abertura 190 linhas / 226 cotas  d590035fd4c2ceef7e05e2b3dd4b4148
--     deltas   2.220  3708786828f37f95d2f55cd2255db0f6
--   LANCE — RETRANSPORTADA (v1 defeituosa: 71 tuplas,
--     a25b067883fd2878f82ce15f6f6506fc). Valores v2 vigentes:
--     catálogo 84  dd4bd8fd476e765e2b27d5fb2075ef19
--     abertura 60 linhas / 60 cotas  42a52b54753ecd6461ce7929579f99d5
--     deltas   108  78264b5a375214a5b0816b4e97a6907f
--   A contagem 84 saiu da derivação, não de estimativa.
--
-- FECHAMENTO 1:1 no último ciclo (ordem 39), por MULTICONJUNTO de tuplas
--   e não só por total — szs x xtv, md5 idêntico, zero eventos após o
--   corte em ambas as fontes:
--     CARTAS 228 tuplas / 228 cotas  64c0c9d71131af3c461ee00f8a2d961e
--     LANCE   64 tuplas /  64 cotas  771f01fd9c7354fb06c3a40149595514
--   Sem eventos pós-corte, não há nascimento, morte ou ressurreição a
--   itemizar depois dele: o corte é o instante real.
--
-- LIMITE 4 (o mais importante — não silenciar no relatório):
--   "vivas no nosso banco em T" é um PROXY do que a fonte exportou em T,
--   e esse proxy herda os bugs do código antigo. Morte causada pelo
--   casamento posicional quebrado aparece aqui como se a fonte tivesse
--   retirado a cota. Logo a série reconstruída SUPERESTIMA o churn real
--   da fonte. Consequência: os números de criação/órfã medidos sobre ela
--   são TETO, não estimativa central.
--
-- LIMITE 5: ciclos sync_pulado (357) e sync_abortado (92) são ponto cego
--   declarado — não produziram fronteira utilizável.
--
-- ---------------------------------------------------------------------
-- ESCALA MEDIDA no xtv (justifica o encoding compacto abaixo)
-- ---------------------------------------------------------------------
--   fonte             cartas  tuplas distintas  inflação
--   PLAYCONTEMPLADAS  46.782            2.967    15,8x
--   PIFFER            21.554            1.101    19,6x
--   CARTAS            13.811              599    23,1x
--   CBC               12.257            1.302     9,4x
--   LANCE                188              187     1,0x  <- intacta
--     (as 187 são contagem v1 sobre 13 dias; é justamente esse número
--      que confirma H1 — ver CORREÇÃO v2 acima)
--   Itaú                  13               13     1,0x  <- intocada
--   BIDCON_DIRETO          1                1     1,0x  <- intocada
--   Catálogo inteiro = 6.170 tuplas.
-- A inflação de 9x a 23x nas fontes automáticas, contra 1,0x na LANCE,
-- é a assinatura do dano de identidade posicional que D1 corrige.
--
-- Encoding: catálogo de tuplas + linha de base do multiconjunto no
-- início da janela + deltas líquidos por hora. Delta líquido porque
-- morte de uma carta e nascimento de outra IDÊNTICA na mesma hora não é
-- movimento da fonte — é troca de linha nossa. Medido: 176.921 pontos
-- brutos colapsam para 53.244 com mudança real.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. CATÁLOGO DE TUPLAS
-- ---------------------------------------------------------------------
create table if not exists public.ensaio_tupla (
  id             bigserial primary key,
  fonte          text        not null,
  tipo           text        not null,
  credito        numeric,
  entrada        numeric,
  parcela        numeric,
  parcelas       integer,
  adm_raw        text,
  adm_resolvida  text,
  criado_em      timestamptz not null default now(),
  constraint ensaio_tupla_unica
    unique (fonte, tipo, credito, entrada, parcela, parcelas, adm_raw)
);
comment on table public.ensaio_tupla is
  'IDENTIDADE-01 T2: catálogo de tuplas de cota reconstruídas do xtv. Dado de ensaio.';


-- ---------------------------------------------------------------------
-- 2. CICLOS (fronteiras, ancoradas em sync_fim do xtv)
-- ---------------------------------------------------------------------
create table if not exists public.ensaio_ciclo (
  id         bigserial primary key,
  ordem      integer     not null unique,
  ciclo_ts   timestamptz not null unique,
  criado_em  timestamptz not null default now()
);
comment on table public.ensaio_ciclo is
  'IDENTIDADE-01 T2: fronteiras horárias do replay, ancoradas nos sync_fim do xtv.';


-- ---------------------------------------------------------------------
-- 3. DELTAS LÍQUIDOS (entrada compacta)
-- ---------------------------------------------------------------------
create table if not exists public.ensaio_delta (
  ciclo_id  bigint  not null references public.ensaio_ciclo(id) on delete cascade,
  tupla_id  bigint  not null references public.ensaio_tupla(id) on delete cascade,
  delta     integer not null,
  primary key (ciclo_id, tupla_id)
);


-- ---------------------------------------------------------------------
-- 4. PRESENÇA (multiconjunto expandido: o que a fonte exportou no ciclo)
-- ---------------------------------------------------------------------
create table if not exists public.ensaio_presenca (
  ciclo_id   bigint  not null references public.ensaio_ciclo(id) on delete cascade,
  tupla_id   bigint  not null references public.ensaio_tupla(id) on delete cascade,
  contagem   integer not null check (contagem > 0),
  primary key (ciclo_id, tupla_id)
);
create index if not exists idx_ensaio_presenca_ciclo on public.ensaio_presenca(ciclo_id);
comment on table public.ensaio_presenca is
  'IDENTIDADE-01 T2: multiconjunto por ciclo. Replay reconstruído do histórico persistido.';


-- ---------------------------------------------------------------------
-- 5. PROGRESSO DO MOTOR RETOMÁVEL (T3)
-- ---------------------------------------------------------------------
create table if not exists public.ensaio_replay_progresso (
  fonte           text    primary key,
  ultimo_ciclo    integer not null default 0,
  ciclos_feitos   integer not null default 0,
  cotas_aplicadas bigint  not null default 0,
  atualizado_em   timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 6. RLS — D15: habilitada, sem policy (service_role ignora RLS)
-- ---------------------------------------------------------------------
alter table public.ensaio_tupla            enable row level security;
alter table public.ensaio_ciclo            enable row level security;
alter table public.ensaio_delta            enable row level security;
alter table public.ensaio_presenca         enable row level security;
alter table public.ensaio_replay_progresso enable row level security;

revoke all on public.ensaio_tupla            from public, anon, authenticated;
revoke all on public.ensaio_ciclo            from public, anon, authenticated;
revoke all on public.ensaio_delta            from public, anon, authenticated;
revoke all on public.ensaio_presenca         from public, anon, authenticated;
revoke all on public.ensaio_replay_progresso from public, anon, authenticated;

grant select, insert, update, delete on public.ensaio_tupla            to service_role;
grant select, insert, update, delete on public.ensaio_ciclo            to service_role;
grant select, insert, update, delete on public.ensaio_delta            to service_role;
grant select, insert, update, delete on public.ensaio_presenca         to service_role;
grant select, insert, update, delete on public.ensaio_replay_progresso to service_role;
grant usage, select on sequence public.ensaio_tupla_id_seq to service_role;
grant usage, select on sequence public.ensaio_ciclo_id_seq to service_role;


-- ---------------------------------------------------------------------
-- 7. EXPANSÃO: deltas -> presença (soma cumulativa por tupla)
-- ---------------------------------------------------------------------
create or replace function public.ensaio_expandir_presenca()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_n bigint;
begin
  delete from ensaio_presenca;

  -- CORREÇÃO (migration ident01_t2_fix_expandir_presenca):
  -- a versão original acumulava APENAS sobre as linhas existentes em
  -- ensaio_delta. Uma tupla com delta no ciclo 0 e o próximo só no ciclo 20
  -- não gerava linha de presença nos ciclos 1..19 — o estoque "sumia" entre
  -- mudanças (o ciclo 1 marcava 2 cotas em vez de 281). O acúmulo agora corre
  -- sobre a grade COMPLETA ciclo x tupla, com delta 0 onde não há evento, o
  -- que faz o saldo ser carregado para frente (carry-forward).
  insert into ensaio_presenca (ciclo_id, tupla_id, contagem)
  select ciclo_id, tupla_id, contagem
  from (
    select g.ciclo_id, g.tupla_id,
           sum(g.delta) over (partition by g.tupla_id order by g.ordem
                              rows between unbounded preceding and current row) as contagem
    from (
      select c.id as ciclo_id, c.ordem, t.id as tupla_id,
             coalesce(d.delta, 0) as delta
      from ensaio_ciclo c
      cross join ensaio_tupla t
      left join (
        select ciclo_id, tupla_id, sum(delta) as delta
        from ensaio_delta group by ciclo_id, tupla_id
      ) d on d.ciclo_id = c.id and d.tupla_id = t.id
    ) g
  ) s
  where contagem > 0;

  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke all on function public.ensaio_expandir_presenca() from public, anon, authenticated;
grant execute on function public.ensaio_expandir_presenca() to service_role;


-- ---------------------------------------------------------------------
-- 8. GERADOR DE PAYLOAD — padrão do chamador real
-- ---------------------------------------------------------------------
-- route.ts hoje: lotes de TAMANHO_LOTE=100, service_role, e varredura
-- final. Aqui: mesmos lotes de 100, mas com ENVELOPE {ciclo_t0, cotas}
-- (D6) e a varredura recebendo a LISTA COMPLETA + o MESMO ciclo_t0.
--
-- Números embaralhados de propósito, com semente derivada do ciclo: a
-- posição na exportação da fonte NÃO é identidade (D7). O embaralho é
-- entre ciclos E através das fronteiras de lote — é o que faz o teste
-- (a) (invariância posicional) ter valor.
create or replace function public.ensaio_payload(
  p_fonte    text,
  p_ciclo    integer,          -- ordem do ciclo
  p_tamanho  integer default 100
) returns table (lote integer, envelope jsonb)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_ciclo_id bigint;
  v_t0       timestamptz;
begin
  select id, ciclo_ts into v_ciclo_id, v_t0
  from ensaio_ciclo where ordem = p_ciclo;
  if v_ciclo_id is null then
    raise exception 'ciclo_inexistente: %', p_ciclo using errcode = 'P0001';
  end if;

  return query
  with expandido as (
    -- multiconjunto -> uma linha por cópia (contagem materializada, D3:
    -- múltiplas cópias da mesma tupla são estoque legítimo, não duplicata)
    select t.*
    from ensaio_presenca p
    join ensaio_tupla t on t.id = p.tupla_id
    cross join lateral generate_series(1, p.contagem)
    where p.ciclo_id = v_ciclo_id and t.fonte = p_fonte
  ),
  numerado as (
    select e.*,
           -- número = posição embaralhada, semente = ciclo
           row_number() over (order by md5(e.id::text || ':' || p_ciclo::text)) as numero,
           -- ordem de emissão embaralhada por semente DIFERENTE, para que
           -- a fatia em lotes não acompanhe a ordem dos números
           row_number() over (order by md5(p_ciclo::text || ':' || e.id::text || ':emissao')) as ord
    from expandido e
  )
  select ((n.ord - 1) / p_tamanho)::integer as lote,
         jsonb_build_object(
           'ciclo_t0', v_t0,
           'cotas', jsonb_agg(
             jsonb_build_object(
               'numero',           n.numero,
               'tipo',             n.tipo,
               'valor_credito',    n.credito,
               'valor_entrada',    n.entrada,
               'valor_parcela',    n.parcela,
               'qtd_parcelas',     n.parcelas,
               'administradora',   n.adm_raw
             ) order by n.ord)
         ) as envelope
  from numerado n
  group by 1
  order by 1;
end;
$function$;

revoke all on function public.ensaio_payload(text, integer, integer) from public, anon, authenticated;
grant execute on function public.ensaio_payload(text, integer, integer) to service_role;


-- ---------------------------------------------------------------------
-- 9. LISTA COMPLETA DO CICLO (para a varredura final, mesmo ciclo_t0)
-- ---------------------------------------------------------------------
create or replace function public.ensaio_payload_completo(
  p_fonte text,
  p_ciclo integer
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_r jsonb;
begin
  select jsonb_build_object('ciclo_t0', min(e.envelope->>'ciclo_t0'),
                            'cotas', jsonb_agg(c))
    into v_r
  from ensaio_payload(p_fonte, p_ciclo, 1000000) e,
       lateral jsonb_array_elements(e.envelope->'cotas') c;
  return coalesce(v_r, jsonb_build_object('ciclo_t0', null, 'cotas', '[]'::jsonb));
end;
$function$;

revoke all on function public.ensaio_payload_completo(text, integer) from public, anon, authenticated;
grant execute on function public.ensaio_payload_completo(text, integer) to service_role;


-- =====================================================================
-- 10. RESULTADO DA CARGA AO VIVO (executada na sessão IDENTIDADE-01)
-- =====================================================================
-- Rótulo obrigatório: REPLAY RECONSTRUÍDO DO HISTÓRICO PERSISTIDO.
--
-- ESCOPO EFETIVAMENTE CARREGADO (redução declarada — vai ao relatório T7):
--   fontes : CARTAS (pior inflação, 23,1x) + LANCE (controle intacto, 1,0x)
--            em vez das 6 da whitelist do D12.
--   janela : 2026-07-29 00:00 -> 2026-08-02 (3 dias) em vez dos 30 da spec.
--   MOTIVO : não existe caminho de máquina entre xtv e szs sem colar
--            credencial em SQL (dblink/postgres_fdw/http/pg_net ausentes no
--            szs; sem psql/supabase-cli local; .env.local proíbe expor valor
--            real). A transferência passou pelo contexto da conversa, o que
--            impõe teto de volume. A redução NÃO é conveniência: é o limite
--            físico do canal disponível, e está declarada, não silenciosa.
--
-- VOLUMES CARREGADOS
--   ensaio_tupla     367   (catálogo do multiconjunto)
--   ensaio_ciclo      40   (ordem 0 = abertura + ordens 1..39 = ciclos reais)
--   ensaio_delta   2.314   (243 de abertura + 2.071 na janela)
--   ensaio_presenca 9.877  (após o fix do carry-forward)
--
-- FIDELIDADE DA TRANSFERÊNCIA (checksum ponta a ponta)
--   Método: md5 do blob canônico calculado no xtv, reconstruído no szs a
--   partir das linhas já gravadas e comparado. Prova que nada se perdeu nem
--   se corrompeu ao atravessar o contexto.
--     catálogo : 93b6fd45ef18f5175df33275ff57ec91  (xtv == szs)  OK
--     deltas   : ccbed69f7262adb8fa5e1778be2801bd  (xtv == szs)  OK
--
-- ÂNCORA DE ABERTURA
--   O ciclo ordem 0 fica em 2026-07-28 23:00+00, uma hora ANTES da janela,
--   de propósito: existe ciclo real em 2026-07-29 00:00 e a abertura não
--   pode colidir com ele. Saldo de abertura = 279 cotas (226 CARTAS + 53
--   LANCE), obtido por greatest(sum(delta),0) sobre tudo anterior à janela.
--
-- SANIDADE DO MULTICONJUNTO
--   contagens negativas .............. 0        (modelo fecha)
--   multiplicidade máxima ............ 4        (4 tuplas chegam a 4 cópias)
--   -> confirma o D3: unique constraint em fingerprint seria ERRADA.
--
-- TRAJETÓRIA DO ESTOQUE (abre 279, fecha 280; oscila 266..343)
--   LANCE  fica entre 47 e 56 o tempo todo — é a fonte de controle, sã.
--   CARTAS fica entre 216 e 294. O pico do ciclo 19 (2026-07-30 15:00, 294)
--   seguido do tombo no ciclo 20 (225) é a assinatura da recriação em massa:
--   a fonte reapresentou o mesmo estoque em posições novas e o código antigo
--   tratou tudo como carta nova. É exatamente o que o D1 elimina.
--
-- BUG CORRIGIDO NESTA SEÇÃO (achado ao validar, não em revisão de mesa)
--   ensaio_expandir_presenca() acumulava só sobre as linhas existentes em
--   ensaio_delta, então o estoque desaparecia entre duas mudanças da mesma
--   tupla (ciclo 1 marcava 2 cotas em vez de 281). Corrigido para acumular
--   sobre a grade completa ciclo x tupla. Migration: ident01_t2_fix_expandir_presenca.
--   Presença passou de 1.755 para 9.877 linhas.
--
-- GERADOR DE PAYLOAD — VALIDADO
--   ensaio_payload('CARTAS',19)     -> 3 lotes, 294 cotas, 294 números
--                                      distintos, ciclo_t0 2026-07-30T15:00Z.
--   ensaio_payload_completo('LANCE',23) -> 56 cotas, mesmo ciclo_t0.
--   Chaves emitidas conferem com o contrato CONGELADO de sync_aplicar_cotas:
--     numero, tipo, valor_credito, valor_entrada, valor_parcela,
--     qtd_parcelas, entrada_parceiro, administradora.
--   EMBARALHAMENTO: entre os ciclos 19 e 20, ZERO cotas mantiveram o mesmo
--   número. A posição é 100% remexida a cada ciclo — é isso que dá valor ao
--   teste (a) de invariância posicional e ao (h) de troca de posição.
--
-- OBSERVAÇÃO PARA O KIT
--   As 6 administradoras não resolvidas (BBRASIL, DAF, ITAU - P, ITAÚ - P,
--   PORTOAF, REPASSE) NÃO aparecem no recorte CARTAS+LANCE: as 367 tuplas
--   têm adm_resolvida preenchida. Logo o teste (d) não pode sair do replay —
--   tem de ser teste dirigido no nível da função, com entradas sintéticas.
-- =====================================================================
