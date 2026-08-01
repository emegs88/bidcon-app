FATIA IDENTIDADE-01 — SPEC CONSOLIDADA v2 (fonte de verdade desta fatia)

GOVERNANÇA
1. Ler o CLAUDE.md do repo e obedecer integralmente.
2. Produção vitrine = xtv `xtvjpnyadcdeadhmzyff` (bidcon-plataforma-prod) — SÓ LEITURA na FASE A. Ensaio = szs `szsqdpwwxtmrtrhaikuh` (bidcon-app) — escrita autorizada. NUNCA tocar em nnv, ACERVO-360 ou prospere-lancamentos.
3. FASE A (leitura no xtv + ensaio no szs): autorizada para a sessão de execução aberta por Emerson com o prompt que referencia esta spec. FASE B (migration no xtv + deploy do route.ts): SÓ executa depois que Emerson digitar, na sessão de execução: "AUTORIZO IDENTIDADE-01 FASE B".
4. Integridade deste arquivo: a última linha DEVE ser "=== FIM DA SPEC ===". Se estiver ausente, o arquivo está corrompido → PARAR e avisar. O sha256 canônico é conferido na entrega, por instrução fora do arquivo.
5. O diagnóstico histórico está encerrado e validado por três sessões independentes — não re-derivar. Re-medir apenas o que for insumo direto do que se vai escrever.
6. Primeiro ato da sessão de execução: ler este arquivo inteiro, verificar o INVENTÁRIO DO SZS e ler ident01/A1_fingerprint_szs.sql e ident01/A3_funcoes_szs.sql. Divergência de inventário → reportar antes de escrever.

CONTEXTO
O sync destruía e recriava o estoque (~10–12 mil linhas/dia para uma vitrine de ~2.569; 90.013 órfãs; 22 duplicatas; embeddings 100% pendentes) porque a identidade era posicional: (administradora_origem, numero_externo) — e numero_externo é a POSIÇÃO da carta na exportação da fonte, não identificador. A guarda da 0047/0050 (impedir sobrescrita de carta sob reserva) está certa; a chave estava errada. O replay matemático já provou o desenho novo: ~15× de redução (531–943 criações/dia; órfãs na faixa 650–1.740) contra 10–12 mil. Lista branca de fontes: PLAYCONTEMPLADAS, PIFFER, CBC, CARTAS, SERVOPA; LANCE saudável; Itaú e BIDCON_DIRETO fora do sync.

DESENHO — DECISÕES FECHADAS (não reabrir nenhuma)
D1. Identidade = multiconjunto de fingerprint reconciliado POR CONTAGEM dentro de cada fonte (partição = p_origem). carta_fingerprint(tipo, credito, entrada, parcela, parcelas, adm): já existe, md5, IMMUTABLE, hash validado xtv↔szs (00a95361cf1b0535bbf3efbf44c88b25).
D2. Componente adm = administradora REAL via adm_fingerprint_input(adm_resolvida, adm_raw): resolvida como está quando existir; senão norm(adm_raw) = lower + trim + colapso de espaços internos + remoção de acentos; JAMAIS token constante. "ITAU - P"/"ITAÚ - P" convergem (efeito declarado correto). As 6 não resolvidas hoje: BBRASIL, DAF, ITAU - P, ITAÚ - P, PORTOAF, REPASSE (CAPITAL DE GIRO).
D3. Colisão de fingerprint = estoque múltiplo LEGÍTIMO (provado: máx. 6 cópias criadas na mesma transação). PROIBIDO unique constraint em fingerprint.
D4. Fingerprint MATERIALIZADO: coluna cartas.fingerprint mantida por trigger BEFORE INSERT OR UPDATE OF (tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas, administradora_id, administradora_raw); numero_externo FORA da lista. O trigger é o ÚNICO calculador; sync, contador e (na FASE B) vw_vitrine_viva LEEM a coluna; recomputação inline PROIBIDA. Índice parcial (administradora_origem, fingerprint) WHERE status IN ('disponivel','reservada'). Custo declarado: rename/alias em administradoras exige re-materialização dirigida (documentar junto à pendência do acento).
D5. Lote de 100 preservado (0027; motivo = timeout; 0025 fixou statement_timeout do service_role em 150s). Princípio: operação DESTRUTIVA só com conhecimento do ciclo completo. sync_aplicar_cotas (assinatura CONGELADA: p_origem text, p_cotas jsonb, p_varrer boolean default true): por lote, casa cada cota entrante com carta viva NÃO reivindicada da mesma fonte e mesmo fingerprint (pela coluna); reivindicar = sincronizada_em := now(); prioridade de reivindicação: vinculadas primeiro, depois as mais antigas; sem match livre → criar; NUNCA orfaniza dentro do lote.
D6. Envelope de ciclo: p_cotas aceita {"ciclo_t0": timestamptz, "cotas": [...]} (canônico; o route gera t0 único para lotes e varredura) OU array puro (modo avulso/legado → t0 de sync_fonte_estado; bootstrap sem linha de estado: inserir t0 = now() sob o lock; JAMAIS -infinity/epoch). Reivindicada NESTE ciclo = sincronizada_em >= ciclo_t0. Helpers sync_ciclo_t0 e sync_cotas_array já existem no szs.
D7. Deslocamento de número: ao atribuir um numero detido por outra carta viva da fonte, set null nela primeiro (mesma transação); a deslocada NÃO é orfanizada (o destino dela é da varredura). O índice uniq_cartas_origem_numero permanece; numero_externo é dado, não identidade.
D8. sync_varrer_ausentes(p_origem, p_cotas COMPLETA, p_ciclo_inicio) — assinatura nova (nunca foi congelada). Ordem interna: (1) snapshot bruto do ciclo em sync_snapshot_ciclo; (2) integridade: contagem por fingerprint do p_cotas vs reivindicadas desde ciclo_t0 — divergência → evento 'ciclo_integridade_falhou', NÃO orfaniza E AVANÇA o estado (autocura, sem duplicata); (3) orfaniza vivas não reivindicadas SEM vínculo; COM vínculo → permanecem vivas + evento 'ausente_reservada fonte=<o> fp=<fp>'; (4) grava ultima_varredura_em em sync_fonte_estado como ÚLTIMO ato.
D9. Lock consultivo por fonte (pg_advisory_xact_lock sobre hash da origem) nos lotes e na varredura.
D10. Vínculo = helper único carta_vinculo_ativo(carta_id): reserva ativa, interesse vivo, processo vivo. As funções de sync consultam SÓ o helper. No szs ele aponta para reservas_vitrine (dublê com DDL da 0036) + interesses + processos; na FASE B, para reservas reais (0036) + interesses + processos. Corpo das funções byte-idêntico entre ensaio e produção.
D11. SEMÂNTICA DE VIVA: viva = status IN ('disponivel','reservada') para contagem M, casamento e reivindicação. Orfanização SÓ rebaixa disponivel → indisponivel. reservada e vendida JAMAIS são alteradas pelo sync (mudam apenas por fluxo de negócio). Carta reservada conta em M e é reivindicável (numero/metadados atualizam), nunca orfanizável. vendida e indisponivel ficam fora do jogo: não contam, não casam, não reivindicam.
D12. Isolamento de partição: a reconciliação jamais toca carta de fonte fora da lista branca; BIDCON_DIRETO (estoque exclusivo curado à mão) e Itaú intocáveis — registrar como comentário na própria função.
D13. Contador da home: o fp cheio inclui preço → reprecificação NÃO é carta nova. fp_estrutural variante A = tipo|credito|qtd_parcelas|adm_real; variante B = tipo|credito|adm_real. "Novas hoje" = fp inédito do dia CUJO fp_estrutural também é inédito (janela de 14 dias). Medir as séries bruta/A/B (bruta de referência: 223–467/dia) + amostragem manual de 10 cartas (nova real × reprecificada × tick de prazo); recomendar A ou B com números.
D14. Regra do gabarito: o xtv é o gabarito para szs.cartas e satélites do sync — alterar apenas PARA IGUALAR a definição vigente LIDA DO XTV NA HORA, nunca para divergir. Intocáveis: reservas (RESERVE-01: 2 linhas reais + 3 eventos), reserva_legs, reserva_conditions, reserva_eventos, cedente_cartas, contratos, pagamentos_sinal, kyc_*, checklist_*, processo_documentos. Dados sintéticos em tabelas reais do szs: permitidos, marcados como sintéticos, removidos ao fim do kit.
D15. Objetos novos SEMPRE com RLS habilitado + grants service-only (padrão SEGURANCA-01/0069).

INVENTÁRIO DO SZS (verificar antes de escrever)
unaccent · carta_fingerprint · adm_fingerprint_input · carta_vinculo_ativo · sync_ciclo_t0 · sync_cotas_array · sync_aplicar_cotas e sync_varrer_ausentes com envelope (AINDA com status='disponivel' e recomputação inline — corrigir na T1) · cartas.fingerprint + trg_cartas_fingerprint + índice parcial · sync_snapshot_ciclo, sync_fonte_estado, ensaio_replay_progresso (todos com RLS/grants no padrão) · reservas_vitrine (DDL da 0036) · seeds: 19 administradoras, 5 fornecedores, 6 fontes em sync_fonte_config · cartas, eventos_sync, sync_snapshot_ciclo, sync_fonte_estado e reservas_vitrine ZERADOS (limpeza feita) · gabarito já aplicado: DROP chk_cartas_adm_origem; ADD cartas_categoria_check; ADD cartas.categoria; enum status_carta completo (disponivel, reservada, vendida, indisponivel); tipo_bem ok (imovel, veiculo).

PASSES PRESERVADOS (re-passam fim-a-fim no replay)
(c) "ITAU - P"/"ITAÚ - P" mesmo fingerprint e (d) 6 adms não resolvidas não se fundem — validados no nível do helper; envelope desenvelopa e prioriza sobre estado.

TAREFAS T1–T7 (executar sem parar; parar só em bloqueio real)
T1. Corrigir as DUAS funções: semântica de viva (D11) + casamento/contagem por cartas.fingerprint (coluna, D4).
T2. Staging via 2 do xtv (só leitura): multiconjunto {tipo, credito, entrada, parcela, parcelas, adm_raw, adm_resolvida, contagem} por fonte e por ciclo (âncora = eventos sync_fim; vida da carta = criado_em → seu evento carta_indisponivel), 30 dias. Gerador de payload no padrão do chamador real (app/api/sync-cotas/route.ts): lotes de 100 com envelope, numeros embaralhados entre ciclos E através das fronteiras de lote, varredura final com a lista completa + mesmo ciclo_t0.
T3. Motor retomável sobre ensaio_replay_progresso: ~40s por chamada (teto do MCP: 60s; do banco: 150s), reentrada idempotente.
T4. Replay de 30 dias, todas as fontes, + kit a–n fim-a-fim.
T5. Contador: séries bruta/A/B + amostragem manual (D13).
T6. Diff do route.ts (envelope + varredura com lista completa; deploy SÓ na FASE B) + DRAFT completo da migration da FASE B.
T7. Relatório final da FASE A: PASS/FAIL a–n, séries do contador + amostragem, custo medido do backfill, lista de alinhamentos de gabarito, estado do szs, diff e draft anexos. PARAR e pedir a frase.

KIT DE BORDA a–n (resultado esperado explícito em cada item)
a. Invariância de posição com re-loteamento (carta migra do lote 1 ao 11) → 0 novas, 0 órfãs. Teste-símbolo da fatia.
b. Multiplicidade fatiada: fp com 6 cópias, 2 no lote 1 e 4 no lote 7 → 0 órfãs espúrias; N 6→4→7 entre ciclos → delta exato, sem tocar nas que batem.
c. "ITAU - P"/"ITAÚ - P" → mesmo fingerprint, contadas juntas (fim-a-fim).
d. 6 adm não resolvidas → fallback pelo cru normalizado; adms distintas nunca se fundem (fim-a-fim).
e. Reserva ativa em carta cujo fp perde contagem → permanece viva + evento 'ausente_reservada'; variante com interesse vivo.
f. LANCE → comportamento idêntico ao histórico (novas reais, 0 órfãs de guarda).
g. Isolamento: replay completo deixa Itaú e BIDCON_DIRETO byte a byte intocadas.
h. Troca de posição entre duas cartas vivas no mesmo ciclo → sem violação do índice, ambas vivas ao final.
i. Lote perdido simulado → varredura detecta divergência, NÃO orfaniza, registra 'ciclo_integridade_falhou'.
j. Varredura ausente no ciclo N; ciclo N+1 completo → ZERO duplicata, zero órfã indevida.
k. Bootstrap: sync_fonte_estado vazio + estoque pré-carregado simulando o xtv → primeiro ciclo casa/reivindica sem duplicata nem órfã indevida. Retrato do primeiro ciclo real da FASE B — teste crítico.
l. Modo avulso: array puro + p_varrer=true → comportamento íntegro com t0 de estado.
m. Materialização: amostra — coluna == recomputação canônica; UPDATE em valor_entrada troca o fingerprint da linha.
n. Performance: ciclo cheio da PLAYCONTEMPLADAS (≥1.048 cotas contra estoque cheio) termina < 30s no szs.

ACEITE DO REPLAY
Órfãs/dia dentro da faixa declarada 650–1.740 (não 10 mil); criações/dia em centenas (fluxo real da vitrine); zero duplicata na vitrine simulada; LANCE intacta. Rótulo obrigatório: "replay reconstruído do histórico persistido". Ponto cego declarado: ciclos sync_pulado (353) e sync_abortado (92).

FASE B — ESCOPO DO DRAFT (executa só com a frase)
Migration no xtv: sync_aplicar_cotas nova (assinatura congelada) + sync_varrer_ausentes nova + adm_fingerprint_input + carta_vinculo_ativo apontando para reservas (0036)/interesses/processos reais + sync_fonte_estado + sync_ciclo_t0 + sync_cotas_array + cartas.fingerprint + trigger + BACKFILL das 94.747 linhas (custo medido no ensaio) + índice parcial + sync_snapshot_ciclo + unaccent no xtv (verificar/criar) + vw_vitrine_viva lendo a coluna (mesma normalização) + backfill de reservas.fingerprint ativas (hoje zero; incluir mesmo assim) + contador da home (fp inédito + estrutural) — tudo com RLS + rodapé de grants, numeração no padrão do repo (atenção: há nomes duplicados no histórico). E deploy do route.ts na Vercel. A frase "AUTORIZO IDENTIDADE-01 FASE B" cobre os dois.

FORA DA FATIA (não tocar)
Arquivamento das 90 mil órfãs (recomendação: arquivar — preserva histórico de preço) · backfill de embeddings · defeito de acento do resolver_administradora (pendência junto a 0023_administradoras_v2/0023b) · ENSAIO-01 (proposta para o CLAUDE.md: próxima fatia de vitrine ensaia em BRANCH do xtv; o szs volta a ser companheiro do nnv/RESERVE-01).

COMPLIANCE (superfícies públicas)
Nunca "investimento/investidor/rendimento/CDI/lucro"; sempre "planejamento/compra programada/carta de crédito/poder de compra/patrimônio"; nunca prometer data de contemplação; custo a.m. via TIR é a métrica canônica.

=== FIM DA SPEC ===
