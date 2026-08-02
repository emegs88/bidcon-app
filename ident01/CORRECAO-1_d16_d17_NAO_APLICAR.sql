-- ############################################################################
-- ##                            N Ã O   A P L I C A R                       ##
-- ############################################################################
--
-- IDENTIDADE-01 — CORRECAO-1 (D16 + D17). Projeto xtv (xtvjpnyadcdeadhmzyff).
--
-- ESTE ARQUIVO NÃO É PARA SER EXECUTADO. Mora em ident01/ na RAIZ do repo,
-- junto do T6_migration_fase_b_DRAFT.sql — lar único dos drafts NÃO APLICAR.
-- Fora de platform/supabase/migrations/ de propósito. É um DRAFT aguardando
-- gate humano.
--
-- CONFERÊNCIA DO RUNNER (feita, não presumida): NÃO EXISTE runner automático
-- de migrations neste repo. Não há supabase/config.toml (CLI não inicializada,
-- logo `supabase db push` não está ligado); os dois workflows do GitHub
-- (atualizar-vitrine.yml, testes.yml) não citam migration/psql/sql; não há
-- script de migration em package.json; e não existe readdir/glob/`**/*.sql`
-- em código algum. O ÚNICO consumidor programático do diretório é
-- platform/lib/reserve/0017.test.ts, que resolve UM caminho literal
-- (0017_repasse.sql) — não varre diretório. Aplicação é manual, por MCP
-- apply_migration.
-- Isso torna "recursivo" discutível para máquina, mas NÃO elimina o risco
-- real, que é HUMANO: SETUP.md e PLANO_MESTRE.md mandam o operador olhar
-- platform/supabase/migrations/ "nesta ordem", e um subdiretório ident01/
-- sentado lá dentro aparecia nessa listagem. Por isso o move — a mitigação
-- é de leitura humana, não de glob. Depois do move, migrations/ contém
-- somente arquivos .sql numerados, nenhum subdiretório.
--
-- APLICA SOMENTE com a frase, digitada por Emerson na sessão:
--     AUTORIZO IDENTIDADE-01 CORRECAO-1
--
-- NUMERAÇÃO: o arquivo nasce SEM número. Migrations são numeradas pela ordem
-- REAL de aplicação — a PRIMEIRA frase que chegar leva 0064, a SEGUNDA leva
-- 0065, sejam elas CORRECAO-1 ou CORRECAO-2. Sem renomear por antecipação.
-- Só no momento de aplicar este arquivo é renomeado para
-- 00NN_ident01_correcao1_d16_d17.sql e movido para platform/supabase/migrations/.
-- Última migration aplicada hoje: 0062_wa_conversas_referral.sql.
--
-- ORDEM DOS PORTÕES (decidida por Emerson): CORRECAO-2 primeiro (sintoma na
-- cara do cliente), CORRECAO-1 em seguida (destrava a varredura). Se a ordem
-- se mantiver, ESTE arquivo leva 0065.
--
-- O SHIM PERMANECE. O passo 6 (drop do shim) segue bloqueado até o ciclo
-- supervisionado 2 fechar verde. Esta migration não toca no shim.
--
-- ----------------------------------------------------------------------------
-- ESTADO DE ENSAIO (declarado — as duas metades agora estão no mesmo pé)
-- ----------------------------------------------------------------------------
-- AS DUAS METADES FORAM À BANCADA no szs (szsqdpwwxtmrtrhaikuh). SETE itens
-- em kit_resultado, todos pass=true:
--   D16 — q0, q-repro, q-pos, i-d16, j-d16   (ver §D16)
--   D17 — r1-r2-d17, r3-d16-d17              (ver §D17.4)
-- O r3 rodou com D16 E D17 aplicadas JUNTAS, que é a combinação que esta
-- migration entrega — as duas metades não foram ensaiadas só em separado.
--
-- Isto NÃO libera a aplicação. Ensaio verde é pré-requisito, não autorização:
-- a frase segue sendo a única chave.
--
-- ADAPTAÇÃO DECLARADA DA FIXTURE (para o registro não induzir a erro):
-- os kits i/j foram re-rodados sobre fixture REDUZIDA — 120 cotas = 40
-- fingerprints × multiplicidade 3, em 12 lotes de 10 — e não sobre as 1215
-- cotas originalmente desenhadas. Motivo medido em bancada: o caminho de
-- INSERT custa ~578 ms/linha (10 INSERTs = 5.785 ms), porque dispara
-- trg_bidcon_price; 1215 INSERTs dariam ~11,7 min, acima do teto de uma
-- chamada. i/j são testes de LÓGICA (colapso de duplicata, ausência de
-- órfã indevida, idempotência entre ciclos), não de escala — e a escala já
-- está coberta pelo kit n-v3 (1.224 reivindicações, 3,05 ms/linha, medido).
-- A redução está escrita também nas descrições de kit_registrar('i-d16')
-- e kit_registrar('j-d16') no szs, para o registro não poder enganar depois.
--
-- ============================================================================
-- D16 — INTEGRIDADE POR PEGADA
-- ============================================================================
-- DEFEITO (reproduzido no szs, kit q-repro): a checagem de integridade de
-- sync_varrer_ausentes conta, do lado `vivo`, apenas linhas com
-- status in ('disponivel','reservada'). Uma cota que nasce QUARENTENADA —
-- trg_bidcon_price é BEFORE INSERT e muta NEW.status para 'indisponivel'
-- quando o preço é degenerado (entrada >= crédito, parcela explodida;
-- migration 0034_quarentena_insert_degenerado.sql) — foi aplicada de
-- verdade, existe como linha, mas não é contada. O payload diz n=1, o lado
-- vivo diz m=0, v_div>0, e a função entra no ramo de AUTOCURA: loga
-- ciclo_integridade_falhou, avança sync_fonte_estado e `return 0` ANTES de
-- orfanizar. Resultado: uma única cota degenerada no payload PARALISA a
-- varredura inteira daquela fonte, e as ausentes reais do ciclo sobrevivem
-- indevidamente. É o que segura a varredura em produção hoje.
--
-- CORREÇÃO: `m` = linhas da fonte com sincronizada_em >= ciclo_t0, SEM
-- filtro de status. O critério deixa de ser "está vendável" e passa a ser
-- "foi tocada neste ciclo" — PEGADA. Uma linha quarentenada tem
-- sincronizada_em carimbado (o trigger muta status, não o timestamp), logo
-- deixa pegada e passa a contar.
--
-- POR QUE A CLASSE n-v2 (LOTE PERDIDO) CONTINUA SENDO PEGA — a pergunta
-- decisiva, e ela foi MEDIDA, não argumentada. Uma linha que o ciclo não
-- tocou não recebe sincronizada_em novo; fica com o timestamp do ciclo
-- anterior; `sincronizada_em >= ciclo_t0` é falso; ela não entra em `m`.
-- Portanto lote perdido AINDA diverge. Prova no szs (kit i-d16): catálogo
-- completo de 120 cotas contra 110 linhas carimbadas (lote de 10 retido) →
-- exatamente 1 evento ciclo_integridade_falhou com divergencias=10,
-- orfanizadas=0, 120 vivas / 0 mortas, 110 com pegada / 10 sem pegada.
--
-- O QUE NÃO MUDA: a SELEÇÃO DE ÓRFÃS. D11 permanece intacta — os blocos
-- (3a) ausente_reservada e (3b) orfanização seguem byte a byte idênticos,
-- só rebaixam disponivel -> indisponivel, só linhas vivas, e continuam
-- respeitando carta_vinculo_ativo. D16 mexe EXCLUSIVAMENTE no predicado de
-- contagem do CTE `vivo`. Uma linha quarentenada passa a contar para a
-- integridade e continua NÃO sendo candidata a órfã (já é indisponivel).
--
-- DIFF EFETIVO: uma linha REMOVIDA do CTE `vivo`:
--     -      and c.status in ('disponivel','reservada')
-- Todo o resto abaixo é o corpo atual do xtv, reproduzido verbatim.

create or replace function public.sync_varrer_ausentes(p_origem text, p_cotas jsonb, p_ciclo_inicio timestamptz)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_ind int:=0; v_div int:=0; v_now timestamptz:=now(); v_arr jsonb;
  v_admin_id uuid; v_adm_fb uuid;
begin
  -- ISOLAMENTO DE PARTIÇÃO (D12): BIDCON_DIRETO e Itaú intocáveis.
  if p_origem is null or p_origem not in ('LANCE','CBC','PIFFER','CARTAS','SERVOPA','PLAYCONTEMPLADAS') then
    raise exception 'origem_invalida: %', coalesce(p_origem,'<null>') using errcode='P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('sync:'||p_origem));  -- D9
  v_arr := public.sync_cotas_array(p_cotas);
  if jsonb_array_length(coalesce(v_arr,'[]'::jsonb))=0 then return 0; end if;

  -- Mesmo fallback de administradora usado por sync_aplicar_cotas (ADENDO-2/Q2:
  -- sem isto, SERVOPA computaria fingerprint diferente aqui e na aplicação, e a
  -- checagem de integridade acusaria divergência em 100% dos ciclos).
  select administradora_id into v_admin_id from sync_fonte_config where fonte=p_origem;
  v_adm_fb := case when p_origem='SERVOPA' then v_admin_id else null end;

  -- (1) snapshot bruto do ciclo
  insert into sync_snapshot_ciclo(fonte,ciclo_inicio,total_cotas,payload)
  values (p_origem,p_ciclo_inicio,jsonb_array_length(v_arr),v_arr);

  -- (2) integridade: contagem por fingerprint do payload vs REIVINDICADAS
  --     desde ciclo_t0. 'entrante' computa inline (cota não é linha);
  --     'vivo' LÊ a coluna materializada (D4).
  --     D16 — PEGADA, NÃO VENDABILIDADE: o lado direito NÃO filtra status.
  --     O que a checagem pergunta é "esta linha foi tocada neste ciclo?",
  --     e não "esta linha está vendável?". Quarentenada (nascida
  --     indisponivel por trg_bidcon_price) tem sincronizada_em carimbado,
  --     logo TEM pegada e CONTA. Linha não tocada pelo ciclo mantém o
  --     timestamp antigo, não tem pegada e continua divergindo — é assim
  --     que a classe n-v2 (lote perdido) segue sendo pega.
  with entrante as (
    select public.carta_fingerprint(((c->>'tipo')::tipo_bem)::text,(c->>'valor_credito')::numeric,
      (c->>'valor_entrada')::numeric,(c->>'valor_parcela')::numeric,(c->>'qtd_parcelas')::int,
      public.adm_fingerprint_input((select a.nome from administradoras a
        where a.id = coalesce(public.resolver_administradora(nullif(trim(c->>'administradora'),'')), v_adm_fb)),
        nullif(trim(c->>'administradora'),''))) fp, count(*) n
    from jsonb_array_elements(v_arr) c group by 1),
  vivo as (
    select c.fingerprint fp, count(*) m
    from cartas c where c.administradora_origem=p_origem
      and c.sincronizada_em >= p_ciclo_inicio group by 1)
  select count(*) into v_div from entrante e full join vivo v on v.fp=e.fp
   where coalesce(e.n,0) <> coalesce(v.m,0);

  if v_div>0 then
    insert into eventos_sync(tipo,detalhe) values ('ciclo_integridade_falhou',
      p_origem||' divergencias='||v_div||' ciclo='||p_ciclo_inicio::text);
    insert into sync_fonte_estado(fonte,ultima_varredura_em) values (p_origem,v_now)
      on conflict (fonte) do update set ultima_varredura_em=excluded.ultima_varredura_em;
    return 0;
  end if;

  -- (3a) viva ausente que SOBREVIVE à orfanização deixa rastro (D8).
  --      INALTERADO pela D16.
  insert into eventos_sync(tipo,numero_externo,carta_id,detalhe)
  select 'ausente_reservada',c.numero_externo,c.id,p_origem||' fp='||c.fingerprint
  from cartas c where c.administradora_origem=p_origem
    and c.status in ('disponivel','reservada')
    and coalesce(c.sincronizada_em,'-infinity') < p_ciclo_inicio
    and (public.carta_vinculo_ativo(c.id) or c.status='reservada');

  -- (3b) orfanização: SÓ rebaixa disponivel -> indisponivel (D11).
  --      INALTERADO pela D16 — a seleção de órfãs não muda de critério.
  with sumidas as (
    update cartas set status='indisponivel', sincronizada_em=v_now
    where administradora_origem=p_origem and fonte='360prospere' and status='disponivel'
      and coalesce(sincronizada_em,'-infinity') < p_ciclo_inicio
      and not public.carta_vinculo_ativo(cartas.id)
    returning numero_externo,id)
  insert into eventos_sync(tipo,numero_externo,carta_id,detalhe)
  select 'carta_indisponivel',numero_externo,id,p_origem||' ausente na fonte' from sumidas;
  get diagnostics v_ind = row_count;

  -- (4) ultima_varredura_em como ÚLTIMO ato.
  insert into sync_fonte_estado(fonte,ultima_varredura_em) values (p_origem,v_now)
    on conflict (fonte) do update set ultima_varredura_em=excluded.ultima_varredura_em;
  return v_ind;
end $function$;

-- ============================================================================
-- D17 — CONTADOR: QUARENTENADA NÃO É ESTREIA
-- ============================================================================
-- §D17.1 — DEFEITO. O caminho de nascimento em sync_aplicar_cotas insere a
-- linha e emite 'carta_nova' INCONDICIONALMENTE, com push_pendente=true.
-- Mas trg_bidcon_price é BEFORE INSERT: quando o preço é degenerado ele muta
-- NEW.status para 'indisponivel' e a linha NASCE MORTA. O evento sai mesmo
-- assim. Duas consequências, ambas reais:
--   (a) CONTAGEM — app/api/vitrine/route.ts:133 calcula `novas_hoje`
--       contando eventos_sync where tipo='carta_nova' e em >= hoje. Corpos
--       que nunca estiveram à venda entram como "novidade" da vitrine.
--   (b) PUSH — push_pendente=true põe a natimorta na fila de push. Uma carta
--       indisponivel pode ser anunciada como novidade ao cliente. Isto NÃO
--       estava nomeado na CORRECAO-1; foi achado ao instrumentar o D17 e vai
--       fechado junto, porque é a MESMA linha de código.
--
-- §D17.2 — CORREÇÃO. RETURNING em Postgres devolve a linha COMO INSERIDA,
-- isto é, DEPOIS de os triggers BEFORE ROW terem mexido em NEW. Então
-- `returning id, status` entrega o status REAL de nascimento, sem SELECT
-- extra e sem custo. A partir dele:
--   - nasceu 'disponivel'  -> v_novas+1 e evento 'carta_nova' (push true);
--   - nasceu qualquer outra coisa -> NÃO conta, NÃO emite 'carta_nova',
--     e emite 'carta_nova_quarentenada' com push_pendente=false.
--
-- §D17.3 — POR QUE UM EVENTO NOVO, E NÃO SIMPLESMENTE NENHUM. Suprimir o
-- evento apagaria o rastro do corpo — e esse rastro é justamente o exhibit
-- da fatia QUARENTENA-01 (b22893c1, 62 corpos). O nascimento continua
-- registrado, com carta_id, só deixa de ser classificado como estreia. Isto
-- também PRESERVA o item 7 da aceitação (§14.2, eliminatório: eventos 1:1):
-- a relação continua um nascimento = um evento, agora de dois tipos, e a
-- identidade `novas == count(carta_nova)` fica MAIS estrita do que hoje, não
-- menos. Declarado aqui porque item eliminatório não se redefine em silêncio.
--
-- eventos_sync.tipo é `text` sem check constraint (verificado no xtv), então
-- o tipo novo não exige ALTER TYPE nem migration de enum.
--
-- SEM MUDANÇA DE APLICAÇÃO: 'carta_nova' tem UM único consumidor em código
-- (app/api/vitrine/route.ts:133) e ele já conta exatamente esse tipo. Com a
-- natimorta emitindo outro tipo, `novas_hoje` passa a contar só estreias
-- vivas SOZINHO. Nenhum arquivo do app entra nesta leva.
--
-- ASSINATURA PRESERVADA: RETURNS TABLE(novas, atualizadas, indisponibilizadas)
-- fica com as MESMAS três colunas. Acrescentar uma quarta exigiria DROP +
-- CREATE (Postgres não deixa trocar OUT params por CREATE OR REPLACE), e um
-- DROP de função de sync em produção abre janela para ciclo concorrente
-- encontrar a função ausente. As quarentenadas ficam contáveis pelo evento:
--   select count(*) from eventos_sync where tipo='carta_nova_quarentenada';
--
-- §D17.4 — ENSAIO EXECUTADO NO szs, VERDE. O kit r rodou com este corpo
-- aplicado (apply_migration 'ident01_correcao1_d17_ensaio') sobre a mesma
-- fixture dos kits i/j. Expectativas foram DECLARADAS antes de cada rodada;
-- abaixo, o obtido ao lado do esperado.
--
--   r1  payload com 1 cota degenerada (ve = vc = 500.000) + 2 sãs
--       (510.000/204.000 e 520.000/208.000), todas inéditas, trg LIGADO,
--       p_varrer=false para não tocar a fixture i/j.
--       esperado                          obtido
--         novas = 2                         novas = 2      ✔
--         linhas criadas = 3                3             ✔
--         'carta_nova' = 2, push=true       2, push=true  ✔
--         'carta_nova_quarentenada' = 1,    1,            ✔
--                          push=false          push=false
--       Por linha: 500.000 -> status indisponivel, bidcon custo NULL,
--       COM pegada (sincronizada_em carimbado), evento
--       carta_nova_quarentenada; 510.000 e 520.000 -> disponivel,
--       custo 0,87% a.m., carta_nova. Registrado como 'r1-r2-d17'.
--
--   r2  identidade do item 7 (§14.2, eliminatório), conferida no mesmo ciclo:
--         novas == count('carta_nova')                       2 == 2   ✔
--         novas + quarentenadas == linhas nascidas           2+1 == 3 ✔
--
--   r3  regressão D16+D17 JUNTAS: ciclo completo de 123 cotas (fixture i/j
--       + as 3 do r), p_varrer=TRUE.
--       esperado                          obtido
--         novas = 0 (tudo reivindicado)     novas = 0            ✔
--         atualizadas = 122                 122                  ✔
--         indisponibilizadas = 0            0                    ✔
--         ciclo_integridade_falhou = 0      0                    ✔
--         'carta_nova' = 0                  0                    ✔
--       Estado final: 124 linhas, 122 vivas, 2 mortas, 43 fingerprints.
--       A integridade PASSOU por pegada mesmo a quarentenada tendo emitido
--       um tipo de evento diferente — que era exatamente o ponto do r3.
--       Registrado como 'r3-d16-d17'.
--
--   ACHADO DE BANCADA (não é falha da D17; é a QUARENTENA-01 reproduzida):
--   o r3 fechou com corpos_da_degenerada = 2 — o ciclo cunhou um segundo
--   corpo para a MESMA cota degenerada. Motivo: a busca de candidata exige
--   status in ('disponivel','reservada'), então um corpo NUNCA é
--   reivindicável, e todo ciclo insere um corpo novo para a mesma cota.
--   É o motor do b22893c1 (62 corpos), agora demonstrado em bancada e não
--   inferido. A D17 impede que esses corpos contem como estreia e que
--   entrem na fila de push; ela NÃO estanca a criação deles. Estancar é a
--   fatia QUARENTENA-01, declarada aqui para o verde do kit r não ser lido
--   como "problema resolvido".

create or replace function public.sync_aplicar_cotas(p_origem text, p_cotas jsonb, p_varrer boolean default true)
returns table(novas integer, atualizadas integer, indisponibilizadas integer)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_novas int:=0; v_atu int:=0; v_ind int:=0; r record; v_id uuid; v_cand uuid;
  v_admin_id uuid; v_forn_id uuid; v_adm_in uuid; v_adm_fb uuid; v_cat text; v_fp text;
  v_num int; v_t0 timestamptz; v_now timestamptz:=now(); v_arr jsonb;
  v_st status_carta;  -- D17: status REAL de nascimento (pós BEFORE trigger)
begin
  -- ISOLAMENTO DE PARTIÇÃO (D12): só lista branca. BIDCON_DIRETO (estoque
  -- exclusivo curado à mão) e Itaú ficam FORA — o sync nunca os toca.
  if p_origem is null or p_origem not in ('LANCE','CBC','PIFFER','CARTAS','SERVOPA','PLAYCONTEMPLADAS') then
    raise exception 'origem_invalida: %', coalesce(p_origem,'<null>') using errcode='P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('sync:'||p_origem));  -- D9
  v_t0 := public.sync_ciclo_t0(p_origem, p_cotas);             -- D6
  v_arr := public.sync_cotas_array(p_cotas);
  select administradora_id, fornecedor_id into v_admin_id, v_forn_id from sync_fonte_config where fonte=p_origem;
  v_adm_fb := case when p_origem='SERVOPA' then v_admin_id else null end;

  for r in select (c->>'numero')::int numero,(c->>'tipo')::tipo_bem tipo,(c->>'valor_credito')::numeric vc,
      (c->>'valor_entrada')::numeric ve,(c->>'valor_parcela')::numeric vp,(c->>'qtd_parcelas')::int qp,
      nullif(c->>'entrada_parceiro','')::numeric ep, nullif(trim(c->>'administradora'),'') adm_raw
    from jsonb_array_elements(v_arr) c
  loop
    v_adm_in := coalesce(public.resolver_administradora(r.adm_raw), v_adm_fb);
    v_cat := case when r.adm_raw ilike '%repasse%' then 'repasse' else 'contemplada' end;
    -- Fingerprint da cota ENTRANTE: computado inline porque ela ainda não é
    -- linha. É exatamente o valor que cartas_fingerprint_trg vai materializar
    -- na coluna quando a linha nascer/for atualizada (D4).
    v_fp := public.carta_fingerprint(r.tipo::text,r.vc,r.ve,r.vp,r.qp,
      public.adm_fingerprint_input((select a.nome from administradoras a where a.id=v_adm_in), r.adm_raw));

    -- Candidata VIVA (D11: disponivel OU reservada) e NÃO reivindicada neste
    -- ciclo (sincronizada_em < ciclo_t0), casada pela COLUNA fingerprint (D4)
    -- — o que permite o índice parcial idx_cartas_fonte_fp_vivas.
    -- Prioridade (D5): vinculadas primeiro, depois as mais antigas.
    select c.id into v_cand from cartas c
     where c.administradora_origem = p_origem
       and c.status in ('disponivel','reservada')
       and c.fingerprint = v_fp
       and coalesce(c.sincronizada_em,'-infinity') < v_t0
     order by public.carta_vinculo_ativo(c.id) desc, c.criado_em asc limit 1;

    if v_cand is not null then
      -- Deslocamento de número (D7) antes de gravar.
      v_num := public.sync_alocar_numero(p_origem, r.numero, v_cand);
      -- ADENDO-4 — REIVINDICAÇÃO NÃO ESCREVE PREÇO.
      -- A candidata foi casada por IGUALDADE DE FINGERPRINT, e o fingerprint
      -- É (tipo, credito, entrada, parcela, parcelas, adm) ao centavo. Logo os
      -- quatro campos comerciais já são idênticos por construção: reescrevê-los
      -- gravaria o mesmo valor e, pior, dispararia trg_bidcon_price
      -- (UPDATE OF valor_credito, valor_entrada, valor_parcela, qtd_parcelas,
      -- tipo) a ~392 ms/linha, recalculando TIR que não mudou.
      -- Mudança REAL de preço muda o fingerprint => a linha antiga não casa,
      -- vira órfã na varredura e nasce linha nova — e aí o trigger dispara no
      -- INSERT, que é o comportamento correto.
      -- administradora_raw/administradora_id PERMANECEM no SET: mantêm
      -- trg_cartas_fingerprint disparando e a coluna fingerprint em dia (D4).
      -- Medido no szs com trg_bidcon_price LIGADO: 1.200 reivindicações => 0
      -- disparos, 4,5 s (kit p); 1.224 reivindicações em 13 lotes => 0 disparos,
      -- 3,7 s / 3,05 ms por linha (kit n-v3). O contra-controle p-insert prova
      -- que a sonda dispara mesmo: 25 INSERTs => 25 disparos.
      -- Reivindicação: sincronizada_em := now(). NUNCA mexe em status —
      -- reivindicar uma 'reservada' atualiza numero/metadados e só (D11).
      update cartas set numero_externo=v_num,
        entrada_parceiro_raw=r.ep, administradora_raw=coalesce(r.adm_raw,administradora_raw),
        administradora_id=coalesce(v_adm_in,administradora_id), fornecedor_id=coalesce(fornecedor_id,v_forn_id),
        categoria=v_cat, sincronizada_em=v_now where id=v_cand;
      v_atu:=v_atu+1;
    else
      v_num := public.sync_alocar_numero(p_origem, r.numero, null);
      -- D17: o INSERT pede 'disponivel', mas trg_bidcon_price (BEFORE INSERT)
      -- pode mutar NEW.status para 'indisponivel' se o preço for degenerado.
      -- RETURNING devolve a linha COMO INSERIDA — depois dos triggers BEFORE —
      -- então v_st é o status REAL de nascimento, sem SELECT extra.
      insert into cartas (tipo,valor_credito,valor_entrada,valor_parcela,qtd_parcelas,status,numero_externo,
        fonte,criado_via,sincronizada_em,administradora_origem,administradora_id,fornecedor_id,
        entrada_parceiro_raw,administradora_raw,categoria)
      values (r.tipo,r.vc,r.ve,r.vp,r.qp,'disponivel',v_num,'360prospere','sync',v_now,p_origem,
        v_adm_in,v_forn_id,r.ep,r.adm_raw,v_cat) returning id, status into v_id, v_st;
      if v_st = 'disponivel' then
        -- Estreia de verdade: conta e pode ser empurrada.
        v_novas:=v_novas+1;
        insert into eventos_sync(tipo,numero_externo,carta_id,detalhe,push_pendente)
        values ('carta_nova',v_num,v_id,p_origem||' credito '||r.vc::text,true);
      else
        -- Natimorta (QUARENTENA-01): NÃO é estreia — não conta em v_novas,
        -- não vira 'carta_nova' (logo não entra em novas_hoje) e NÃO vai para
        -- a fila de push. O corpo continua rastreado por carta_id, que é o
        -- material de prova da fatia QUARENTENA-01.
        insert into eventos_sync(tipo,numero_externo,carta_id,detalhe,push_pendente)
        values ('carta_nova_quarentenada',v_num,v_id,
                p_origem||' credito '||r.vc::text||' nasceu '||v_st::text,false);
      end if;
    end if;
    v_cand:=null;
  end loop;
  -- NUNCA orfaniza dentro do lote (D5): operação destrutiva só com
  -- conhecimento do ciclo completo, que é o que a varredura tem.
  if p_varrer then select public.sync_varrer_ausentes(p_origem,p_cotas,v_t0) into v_ind; end if;
  novas:=v_novas; atualizadas:=v_atu; indisponibilizadas:=v_ind; return next;
end $function$;

-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- Ambas as funções são CREATE OR REPLACE de corpo puro — sem DDL de tabela,
-- sem alteração de tipo, sem backfill, sem índice. Reverter é re-aplicar os
-- corpos ANTERIORES, que estão capturados verbatim em:
--   D16 anterior: bloco `vivo` com `and c.status in ('disponivel','reservada')`
--   D17 anterior: `returning id into v_id;` + emissão incondicional de
--                 'carta_nova' com push_pendente=true
-- Nenhum dado é destruído por esta migration. Eventos já gravados como
-- 'carta_nova' no passado NÃO são reclassificados retroativamente — o
-- histórico fica como está, e novas_hoje só muda de comportamento daqui
-- para a frente. Reclassificação retroativa, se for desejada, é decisão da
-- fatia QUARENTENA-01, não desta.
--
-- ############################################################################
-- ##                            N Ã O   A P L I C A R                       ##
-- ############################################################################
