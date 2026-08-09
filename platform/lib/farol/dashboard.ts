// ============================================================================
// lib/farol/dashboard.ts — as AGREGAÇÕES da sala de controle do FAROL
// AUTORIZADO: Emerson Gomes dos Santos — OS "PAINEL-DASHBOARD-01", 09/08/2026:
// "onde confiro tudo isso, colocar painel com dashboard e gráficos".
// ----------------------------------------------------------------------------
// POR QUE A AGREGAÇÃO É FUNÇÃO PURA. A tela é Server Component e as tabelas do
// FAROL estão quase vazias hoje (medido em 09/08: farol_posts 6, farol_reels 2,
// farol_metricas 0, farol_videos 0, farol_pauta 0). Se a regra de agregação
// morasse na página, ela só seria exercitada por dados que ainda não existem —
// isto é, nunca. Separada aqui, cada regra roda contra fixture e o teste vale
// hoje, com a tabela vazia, que é justamente quando um gráfico mente mais fácil.
//
// AS LEITURAS FICAM NO FIM DO ARQUIVO, e são a ÚNICA parte impura. A OS pede
// "todas as consultas agregadas em lib/farol/dashboard.ts", então elas moram
// aqui mesmo — mas isoladas embaixo, sem nenhuma regra de negócio dentro, para
// que a fronteira testável continue óbvia: tudo acima da faixa "Leituras" roda
// sem banco.
//
// A REGRA DE HONESTIDADE DA OS, e como ela vira código. "Nenhum gráfico com
// dado inventado. Onde a fonte ainda não existe, o bloco aparece com estado
// vazio dizendo POR QUE está vazio e o que o destrava." Isso não é um bilhete
// para o programador: é um TIPO. Toda medida devolve `Medida`, que ou é
// `{ estado: "medido", ... }` ou `{ estado: "sem_fonte", porque, destrava }`.
// Não existe caminho em que um número apareça sem que sua origem tenha sido
// declarada, porque `sem_fonte` não carrega número nenhum para a tela desenhar.
// Um zero honesto ("medimos, deu zero") e uma ausência ("não há de onde medir")
// são coisas diferentes e a tela precisa dizer qual das duas está olhando.
//
// O `n` PEQUENO É REGRA, NÃO ENFEITE. A OS manda mostrar o n ao lado de todo
// número quando n < 10. Com as contagens de hoje isso vale para quase tudo, e é
// o que impede a tela de anunciar "taxa de sucesso 100%" a partir de três
// linhas. `LIMITE_N_VISIVEL` mora aqui e `precisaMostrarN()` é a única
// autoridade sobre isso.
//
// DATAS. Toda chave de dia sai de `diaBR()` — a data civil de São Paulo. É a
// mesma régua que o resto do FAROL usa (`hojeSP()`), e o motivo está escrito em
// lib/data-br.ts: `iso.slice(0,10)` agrupa em UTC e joga o que foi feito às 22h
// para o dia seguinte. Um dashboard que agrupa por dia é exatamente onde esse
// defeito seria mais caro e menos visível.
// ============================================================================
import { diaBR } from "@/lib/data-br";
import type { createXtvClient } from "@/lib/supabase-xtv";
import {
  lerPosts,
  lerReels,
  type Bloco,
  type LinhaPost,
  type LinhaReel,
} from "@/lib/farol/painel";
import { DETECTOR_CEDENTE_DESDE, TAG_CEDENTE } from "@/lib/farol/cedente";

// ---------------------------------------------------------------------------
// O tipo que carrega a honestidade
// ---------------------------------------------------------------------------

/**
 * Uma medida ou foi medida, ou não tem de onde sair. Nunca as duas.
 *
 * `sem_fonte` carrega DUAS strings de propósito: `porque` (o que falta) e
 * `destrava` (o gesto que resolve). Só o primeiro vira um card que informa e
 * não ajuda; a OS pede os dois — "dizendo POR QUE está vazio e o que o
 * destrava".
 */
export type Medida<T> =
  | { estado: "medido"; valor: T; n: number }
  | { estado: "sem_fonte"; porque: string; destrava: string };

export function medido<T>(valor: T, n: number): Medida<T> {
  return { estado: "medido", valor, n };
}

export function semFonte<T>(porque: string, destrava: string): Medida<T> {
  return { estado: "sem_fonte", porque, destrava };
}

/** Abaixo disto a tela mostra o n ao lado do número (regra da OS). */
export const LIMITE_N_VISIVEL = 10;

export function precisaMostrarN(n: number): boolean {
  return n < LIMITE_N_VISIVEL;
}

// ---------------------------------------------------------------------------
// Vocabulário de `farol_posts.acao`
// ---------------------------------------------------------------------------

/**
 * As ações são classificadas por SUFIXO, não por lista fechada.
 *
 * Medido em 09/08 nos call sites de `registrar()` (lib/farol/selecao.ts): o
 * vocabulário tem 18 valores hoje — disparo_manual, pauta_escrita,
 * pauta_reprovada, post_falhou, post_publicado, reel_destravado, reel_falhou,
 * reel_publicado, reel_sem_carta, reel_tiktok_falhou, reel_tiktok_publicado,
 * reel_youtube_falhou, reel_youtube_publicado, responde_falhou,
 * responde_renderizou, responde_reprovado, sem_carta, yt_comentario_respondido.
 * Nas 6 linhas que existem aparecem só 4 deles: o resto está atrás de flags
 * desarmadas, não ausente do código.
 *
 * Uma lista fechada aqui envelheceria na primeira fatia que criasse
 * `reel_kwai_publicado` — e envelheceria em SILÊNCIO, com o gráfico só
 * ignorando a plataforma nova. Pelo sufixo, a peça nova entra sozinha.
 */
export const SUFIXO_PUBLICADO = "_publicado";
export const SUFIXO_FALHOU = "_falhou";

export function ehPublicacao(acao: string): boolean {
  return acao.endsWith(SUFIXO_PUBLICADO);
}

export function ehFalha(acao: string): boolean {
  return acao.endsWith(SUFIXO_FALHOU);
}

/**
 * "Não havia carta para publicar" NÃO é falha da máquina.
 *
 * `sem_carta` e `reel_sem_carta` dizem que o estoque não tinha peça elegível
 * naquele dia. Contar isso como falha faria a taxa de sucesso despencar por um
 * motivo comercial (estoque vazio) travestido de defeito técnico — e o operador
 * iria caçar bug onde não há. Fica numa faixa própria, visível e separada.
 */
export function ehSemInsumo(acao: string): boolean {
  return acao === "sem_carta" || acao.endsWith("_sem_carta");
}

// ---------------------------------------------------------------------------
// Seção 1 — PRODUÇÃO
// ---------------------------------------------------------------------------

export type DiaProducao = {
  dia: string;
  postsPublicados: number;
  reelsPublicados: number;
  falhas: number;
  semInsumo: number;
};

/**
 * A "espinha" de dias: TODOS os dias da janela, do mais antigo ao mais novo,
 * inclusive os que não têm linha nenhuma.
 *
 * Existe porque um gráfico de barras por dia construído só com os dias que têm
 * dado mente por omissão: três publicações em três semanas viram três barras
 * coladas com cara de sequência diária. Os dias vazios são o dado mais
 * importante de uma esteira que deveria rodar todo dia.
 */
export function espinhaDeDias(dias: number, agoraMs: number = Date.now()): string[] {
  const out: string[] = [];
  for (let i = dias - 1; i >= 0; i--) {
    const d = diaBR(agoraMs - i * 24 * 60 * 60 * 1000);
    if (d) out.push(d);
  }
  return out;
}

/**
 * Barras empilhadas por dia. Posts e reels vêm de tabelas diferentes e o dia é
 * o de São Paulo em ambas.
 *
 * Reels entram por `farol_reels.status === "publicado"`, não pelo diário: a
 * tabela de reels é a dona do estado do reel, e `farol_posts` só registra o
 * evento. Contar pelos dois somaria a mesma peça duas vezes no dia em que os
 * dois existem — que é o dia normal.
 */
export function serieProducao(
  posts: LinhaPost[],
  reels: LinhaReel[],
  dias: number,
  agoraMs: number = Date.now()
): DiaProducao[] {
  const espinha = espinhaDeDias(dias, agoraMs);
  const mapa = new Map<string, DiaProducao>(
    espinha.map((dia) => [
      dia,
      { dia, postsPublicados: 0, reelsPublicados: 0, falhas: 0, semInsumo: 0 },
    ])
  );

  for (const p of posts) {
    const dia = diaBR(p.criado_em);
    const alvo = dia ? mapa.get(dia) : undefined;
    if (!alvo) continue;
    // Só o post de feed conta aqui; reel_* publicado é contado pela tabela de
    // reels, logo abaixo, para não duplicar a mesma peça.
    if (p.acao === "post_publicado") alvo.postsPublicados++;
    else if (ehFalha(p.acao)) alvo.falhas++;
    else if (ehSemInsumo(p.acao)) alvo.semInsumo++;
  }

  for (const r of reels) {
    const dia = diaBR(r.criado_em);
    const alvo = dia ? mapa.get(dia) : undefined;
    if (!alvo) continue;
    if (r.status === "publicado") alvo.reelsPublicados++;
  }

  return espinha.map((d) => mapa.get(d) as DiaProducao);
}

export type PlacarProducao = {
  publicadas: Medida<number>;
  taxaSucesso: Medida<number>;
  medianaRenderMs: Medida<number>;
  diasSemFalha: Medida<number>;
};

/**
 * Mediana, não média, para o tempo render→publicação.
 *
 * Com n de um dígito uma única render travada de seis horas (e há uma medida,
 * na flag aberta de latência) puxa a média para um número que nunca aconteceu.
 * A mediana responde "quanto costuma demorar", que é a pergunta do operador.
 */
export function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const v = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
}

/**
 * Dias consecutivos sem falha, contados de HOJE para trás.
 *
 * Um dia sem nenhuma linha NÃO quebra a sequência nem a alimenta: a esteira não
 * rodou, então não há o que julgar. Contar dia vazio como "sem falha" premiaria
 * a máquina desligada com o melhor placar da tela, que é o incentivo exatamente
 * invertido.
 */
export function diasConsecutivosSemFalha(serie: DiaProducao[]): number {
  let conta = 0;
  for (let i = serie.length - 1; i >= 0; i--) {
    const d = serie[i];
    if (d.falhas > 0) break;
    if (d.postsPublicados + d.reelsPublicados > 0) conta++;
  }
  return conta;
}

export function placarProducao(
  serie: DiaProducao[],
  reels: LinhaReel[],
  agoraMs: number = Date.now()
): PlacarProducao {
  const publicadas = serie.reduce((s, d) => s + d.postsPublicados + d.reelsPublicados, 0);
  const falhas = serie.reduce((s, d) => s + d.falhas, 0);
  const tentadas = publicadas + falhas;

  // render→publicação: `criado_em` é o início da render e `atualizado_em` a
  // última mexida — que, na linha já publicada, é a publicação. É a mesma
  // âncora que `reelTravado()` usa; uma régua só para os dois.
  const janela = agoraMs - serie.length * 24 * 60 * 60 * 1000;
  const duracoes = reels
    .filter((r) => r.status === "publicado" && r.atualizado_em)
    .filter((r) => new Date(r.criado_em).getTime() >= janela)
    .map((r) => new Date(r.atualizado_em as string).getTime() - new Date(r.criado_em).getTime())
    .filter((ms) => Number.isFinite(ms) && ms >= 0);

  const med = mediana(duracoes);

  return {
    publicadas: medido(publicadas, publicadas),
    taxaSucesso:
      tentadas > 0
        ? medido(publicadas / tentadas, tentadas)
        : semFonte(
            "nenhuma tentativa de publicação na janela",
            "a esteira publica sozinha às 10h; sem linha aqui, ou o cron não rodou ou as flags estão desarmadas"
          ),
    medianaRenderMs:
      med != null
        ? medido(med, duracoes.length)
        : semFonte(
            "nenhum reel publicado com `atualizado_em` na janela",
            "o tempo sai de farol_reels quando a linha chega a status='publicado'"
          ),
    diasSemFalha: medido(diasConsecutivosSemFalha(serie), serie.length),
  };
}

/**
 * Distribuição por plataforma — o multiplicador da esteira.
 *
 * O mesmo mp4 vira peça em três lugares, e é isso que a OS quer ver ("mostra o
 * multiplicador da esteira"). Sai do sufixo do `acao`: `reel_youtube_publicado`
 * → YouTube. `post_publicado` e `reel_publicado` são ambos Instagram (feed e
 * reels), e ficam separados porque são superfícies diferentes lá dentro.
 */
export type PecaPlataforma = { plataforma: string; n: number };

const ROTULO_PLATAFORMA: Record<string, string> = {
  post_publicado: "Instagram · feed",
  reel_publicado: "Instagram · reels",
  reel_youtube_publicado: "YouTube Short",
  reel_tiktok_publicado: "TikTok",
};

export function porPlataforma(posts: LinhaPost[], dias: number, agoraMs: number = Date.now()): Medida<PecaPlataforma[]> {
  const janela = new Set(espinhaDeDias(dias, agoraMs));
  const conta = new Map<string, number>();
  let total = 0;

  for (const p of posts) {
    const dia = diaBR(p.criado_em);
    if (!dia || !janela.has(dia)) continue;
    if (!ehPublicacao(p.acao)) continue;
    const rotulo = ROTULO_PLATAFORMA[p.acao] ?? p.acao;
    conta.set(rotulo, (conta.get(rotulo) ?? 0) + 1);
    total++;
  }

  if (total === 0) {
    return semFonte(
      "nenhuma publicação registrada na janela",
      "YouTube e TikTok só aparecem com FAROL_YOUTUBE e a verificação de domínio do TikTok; o código que grava reel_youtube_publicado / reel_tiktok_publicado já existe"
    );
  }

  const linhas = [...conta.entries()]
    .map(([plataforma, n]) => ({ plataforma, n }))
    .sort((a, b) => b.n - a.n || a.plataforma.localeCompare(b.plataforma));
  return medido(linhas, total);
}

// ---------------------------------------------------------------------------
// Seção 2 — FUNIL
// ---------------------------------------------------------------------------

/**
 * As linhas de conversa que o funil lê. Tipos locais e mínimos: o dashboard não
 * precisa (nem deve) carregar o conteúdo das mensagens — só quem falou, quando
 * e por qual agente. Menos coluna no `select` é menos dado de cliente passeando
 * por uma tela de operação.
 */
export type LinhaWaConversa = {
  id: string;
  canal: string | null;
  criado_em: string;
  /**
   * Etiquetas de intenção (hoje só `cedente`), da migração 0075.
   *
   * OPCIONAL DE PROPÓSITO, e a opcionalidade CARREGA INFORMAÇÃO: a coluna é
   * `not null default '{}'`, então uma vez aplicada a migração ela nunca vem
   * ausente nem nula. `undefined` aqui significa exatamente uma coisa — a
   * leitura caiu no plano B porque a coluna não existe (ver `lerConversas`) —
   * e é assim que o funil distingue "nenhuma conversa marcada" de "não há como
   * marcar". Sem essa distinção a etapa mostraria 0 nos dois casos, e um 0 que
   * significa "medimos e não achamos" ao lado de um 0 que significa "não
   * medimos" é a mentira mais barata que esta tela poderia contar.
   */
  tags?: string[];
};

export type LinhaWaMensagem = {
  conversa_id: string | null;
  papel: string;
  agente: string | null;
  status_envio: string | null;
  criado_em: string;
  tokens_in: number | null;
  tokens_out: number | null;
};

/** Agente que assina o private reply do FAROL-COMENTA (medido em produção). */
export const AGENTE_COMENTA = "farol-comenta";

/**
 * `status_envio` que significam "saiu daqui". Medidos na tabela: enviado,
 * entregue, lida, falha, enviando. Os três primeiros são sucesso; `enviando` é
 * a linha gravada ANTES da chamada (a trava de dedupe do webhook) e `falha` é
 * recusa da Meta — nenhum dos dois é entrega.
 */
export const ENVIO_OK = ["enviado", "entregue", "lida"];

export type EtapaFunil = {
  rotulo: string;
  medida: Medida<number>;
  /** Conversão em relação à etapa anterior. `null` na primeira etapa. */
  conversao: number | null;
};

/**
 * A quinta etapa do funil, isolada porque é a única com mais de um jeito de não
 * ter resposta. Ver o bloco de `funil()` para os três estados e o porquê.
 *
 * A checagem de coluna ausente exige `conversas.length > 0`: com a janela
 * vazia não há linha para inspecionar, e chutar "coluna não existe" a partir de
 * lista vazia seria adivinhação. Sem conversa nenhuma, o estado honesto é o
 * mesmo de sempre — não há o que examinar — e é para lá que a função cai.
 *
 * `every` e não `some`: o PostgREST devolve a coluna para TODAS as linhas ou
 * para nenhuma, então as duas dariam o mesmo resultado hoje. `every` é a que
 * continua certa se algum dia a lista vier de duas leituras diferentes.
 */
function medidaCedente(conversas: LinhaWaConversa[]): Medida<number> {
  if (conversas.length > 0 && conversas.every((c) => c.tags === undefined)) {
    return semFonte(
      "a coluna wa_conversas.tags não existe no banco — a leitura do painel tentou lê-la, levou erro e releu sem ela",
      "aplicar a migração 0075 (supabase/migrations/0075_wa_conversas_tags.sql); o detector no webhook do WhatsApp já está no ar e passa a gravar assim que a coluna e a função wa_conversa_add_tag existirem"
    );
  }

  // Conversa anterior ao detector tem `tags = {}` porque nunca foi examinada,
  // não porque foi examinada e inocentada. Só entra no denominador quem nasceu
  // com o detector já de pé.
  const examinaveis = conversas.filter((c) => {
    const dia = diaBR(c.criado_em);
    return dia != null && dia >= DETECTOR_CEDENTE_DESDE;
  });

  if (examinaveis.length === 0) {
    return semFonte(
      `detector não implantado quando estas conversas nasceram: nenhuma da janela é de ${DETECTOR_CEDENTE_DESDE} ou depois, e array de etiquetas vazio em conversa antiga significa "nunca examinada", não "não é cedente"`,
      "a próxima conversa que entrar já nasce examinada; a etapa vira número sozinha conforme a janela de 30 dias rola sobre a data de implantação"
    );
  }

  const marcadas = examinaveis.filter((c) => (c.tags ?? []).includes(TAG_CEDENTE)).length;
  return medido(marcadas, examinaveis.length);
}

/**
 * O funil de conteúdo→negócio. Cinco etapas.
 *
 * A quinta — "marcadas `cedente`" — nasceu `sem_fonte` fixa (não havia onde
 * gravar a marcação: `wa_conversas.status` é o enum ativo|humano|encerrado e
 * nada mais) e ganhou fonte em 09/08/2026, com a coluna `tags` da migração 0075
 * e o detector de vocabulário em `lib/farol/cedente.ts`. Ela agora tem TRÊS
 * estados, e a razão de existirem três é que dois deles seriam o mesmo "0" na
 * tela:
 *
 *   1. COLUNA AUSENTE (migração 0075 não aplicada) — `tags` vem `undefined`
 *      porque `lerConversas` caiu no plano B. Não dá para marcar ninguém.
 *   2. COLUNA EXISTE, MAS A JANELA É TODA ANTERIOR AO DETECTOR — as conversas
 *      têm `tags = {}`, e esse array vazio NÃO quer dizer "não é cedente",
 *      quer dizer "nunca foi examinada". O detector só passa a olhar as
 *      mensagens que chegam depois de instalado; ele não volta no tempo.
 *   3. MEDIDO — há conversa da janela nascida em `DETECTOR_CEDENTE_DESDE` ou
 *      depois, e aí `{}` finalmente significa "examinada e não bateu".
 *
 * O `n` da medida é o número de conversas EXAMINÁVEIS, não o total da janela.
 * Do contrário, no primeiro dia o painel diria "0 de 45" quando a verdade é
 * "0 de 3" — e o operador concluiria que o detector não funciona, quando ele
 * só é novo. O denominador cresce sozinho conforme a janela rola.
 */
export function funil(
  conversas: LinhaWaConversa[],
  mensagens: LinhaWaMensagem[]
): EtapaFunil[] {
  const doComenta = mensagens.filter((m) => m.agente === AGENTE_COMENTA);
  const entregues = doComenta.filter((m) => m.status_envio && ENVIO_OK.includes(m.status_envio));

  const comResposta = new Set(
    mensagens.filter((m) => m.papel === "cliente" && m.conversa_id).map((m) => m.conversa_id as string)
  );
  const conversasComResposta = conversas.filter((c) => comResposta.has(c.id)).length;

  const etapas: Array<{ rotulo: string; medida: Medida<number>; semConversao?: boolean }> = [
    { rotulo: "comentários tratados", medida: medido(doComenta.length, doComenta.length) },
    { rotulo: "private replies entregues", medida: medido(entregues.length, entregues.length) },
    { rotulo: "conversas iniciadas", medida: medido(conversas.length, conversas.length) },
    { rotulo: "conversas com resposta do cliente", medida: medido(conversasComResposta, conversas.length) },
    // `semConversao`: esta etapa NUNCA mostra taxa de conversão, mesmo quando
    // vira número. A etapa anterior conta as conversas da janela inteira e esta
    // conta só as nascidas depois do detector; dividir uma pela outra daria uma
    // taxa que despenca no primeiro mês e sobe sozinha depois, sem que nada
    // tenha mudado no atendimento. É o mesmo motivo pelo qual `custoRender` não
    // entra no `totalUsd`: duas séries de coberturas diferentes não se dividem
    // nem se somam. O número absoluto é honesto; a razão entre eles não seria.
    { rotulo: "marcadas cedente", medida: medidaCedente(conversas), semConversao: true },
  ];

  let anterior: number | null = null;
  return etapas.map(({ rotulo, medida, semConversao }) => {
    const atual = medida.estado === "medido" ? medida.valor : null;
    const conversao =
      !semConversao && anterior != null && anterior > 0 && atual != null ? atual / anterior : null;
    if (atual != null) anterior = atual;
    return { rotulo, medida, conversao };
  });
}

export type DiaCanal = { dia: string; instagram: number; whatsapp: number; outro: number };

/** Série diária de conversas novas por canal. Medido: whatsapp 21, instagram 4. */
export function serieCanais(
  conversas: LinhaWaConversa[],
  dias: number,
  agoraMs: number = Date.now()
): DiaCanal[] {
  const espinha = espinhaDeDias(dias, agoraMs);
  const mapa = new Map<string, DiaCanal>(
    espinha.map((dia) => [dia, { dia, instagram: 0, whatsapp: 0, outro: 0 }])
  );
  for (const c of conversas) {
    const dia = diaBR(c.criado_em);
    const alvo = dia ? mapa.get(dia) : undefined;
    if (!alvo) continue;
    if (c.canal === "instagram") alvo.instagram++;
    else if (c.canal === "whatsapp") alvo.whatsapp++;
    else alvo.outro++;
  }
  return espinha.map((d) => mapa.get(d) as DiaCanal);
}

// ---------------------------------------------------------------------------
// Seção 3 — FÔRMAS E PERSONAS
// ---------------------------------------------------------------------------

export type LinhaMetrica = {
  peca_id: string | null;
  formula: string | null;
  persona: string | null;
  retencao: number | null;
  pct_nao_seguidores: number | null;
  indice: number | null;
};

export type RankingFormula = {
  formula: string;
  pecas: number;
  retencao: Medida<number>;
  pctNaoSeguidores: Medida<number>;
  indice: Medida<number>;
};

function mediaDe(valores: Array<number | null>): number | null {
  const v = valores.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/**
 * Ranking por fôrma (P1–P8).
 *
 * DUAS fontes e DUAS ausências independentes, e a tela precisa distinguí-las:
 *   · a CONTAGEM DE USO sai de `farol_reels.detalhe.formula` — que o
 *     reel-render já grava (route.ts: `formula: pautaUsada.formula` e
 *     `formula: formulaUsada.id`), mas só quando há pauta ou `FAROL_FORMULAS=on`.
 *     Medido em 09/08: os 2 reels existentes não têm a chave, porque nasceram
 *     antes da FAROL-FORMULAS-02. Fonte ligada, linhas ausentes.
 *   · o DESEMPENHO (retenção, % não-seguidores, índice) sai de
 *     `farol_metricas`, que está vazia e cujo comentário de tabela diz por quê:
 *     "a coleta (FAROL-METRICAS-01) ainda não existe".
 *
 * Por isso o ranking devolve a peça contada mesmo sem métrica: é o que a OS
 * pede ("mostrar só a contagem de uso e o aviso"). As três colunas de
 * desempenho viram `sem_fonte` individualmente, e não a linha inteira.
 */
export function rankingFormulas(
  reels: LinhaReel[],
  metricas: LinhaMetrica[]
): RankingFormula[] {
  const uso = new Map<string, number>();
  for (const r of reels) {
    const f = (r.detalhe as { formula?: string } | null)?.formula;
    if (!f) continue;
    uso.set(f, (uso.get(f) ?? 0) + 1);
  }

  const porFormula = new Map<string, LinhaMetrica[]>();
  for (const m of metricas) {
    if (!m.formula) continue;
    const lista = porFormula.get(m.formula) ?? [];
    lista.push(m);
    porFormula.set(m.formula, lista);
  }

  const chaves = new Set<string>([...uso.keys(), ...porFormula.keys()]);
  const semMetrica = <T,>(): Medida<T> =>
    semFonte(
      "farol_metricas está vazia",
      "FAROL-METRICAS-01 (Insights do IG + YouTube Analytics) ainda não coletou"
    );

  return [...chaves]
    .map((formula) => {
      const ms = porFormula.get(formula) ?? [];
      const ret = mediaDe(ms.map((m) => m.retencao));
      const pct = mediaDe(ms.map((m) => m.pct_nao_seguidores));
      const idx = mediaDe(ms.map((m) => m.indice));
      return {
        formula,
        pecas: uso.get(formula) ?? 0,
        retencao: ret != null ? medido(ret, ms.length) : semMetrica<number>(),
        pctNaoSeguidores: pct != null ? medido(pct, ms.length) : semMetrica<number>(),
        indice: idx != null ? medido(idx, ms.length) : semMetrica<number>(),
      };
    })
    .sort((a, b) => {
      const ia = a.indice.estado === "medido" ? a.indice.valor : -Infinity;
      const ib = b.indice.estado === "medido" ? b.indice.valor : -Infinity;
      if (ia !== ib) return ib - ia;
      return b.pecas - a.pecas || a.formula.localeCompare(b.formula);
    });
}

/** Mínimo de peças para uma fôrma ser candidata a sair da rotação. */
export const N_MINIMO_ROTACAO = 3;

/**
 * As três piores fôrmas com n >= 3 — as candidatas a sair da rotação.
 *
 * O piso de n existe para não condenar uma fôrma por uma peça azarada. Sem
 * índice medido não há alerta nenhum: acusar a pior sem métrica seria decidir
 * rotação no escuro, que é pior do que não decidir.
 */
export function alertaRotacao(ranking: RankingFormula[]): Medida<RankingFormula[]> {
  const comIndice = ranking.filter(
    (r) => r.indice.estado === "medido" && r.pecas >= N_MINIMO_ROTACAO
  );
  if (comIndice.length === 0) {
    return semFonte(
      `nenhuma fôrma tem índice medido com n >= ${N_MINIMO_ROTACAO}`,
      "o índice vem de farol_metricas; sem a coleta da METRICAS-01 não há como ordenar desempenho"
    );
  }
  const piores = [...comIndice]
    .sort((a, b) => {
      const ia = a.indice.estado === "medido" ? a.indice.valor : 0;
      const ib = b.indice.estado === "medido" ? b.indice.valor : 0;
      return ia - ib;
    })
    .slice(0, 3);
  return medido(piores, comIndice.length);
}

export type ColunaPersona = { persona: string; pecas: number; indice: Medida<number> };

/**
 * Porta-voz × Valentina.
 *
 * ATENÇÃO ao falso amigo: `farol_reels.detalhe.avatar_tipo` NÃO é este eixo.
 * Medido: seu único valor é "photo_avatar", que é o tipo de avatar da HeyGen,
 * não a persona. A persona real é `detalhe.persona`, escrita pelo reel-render
 * junto com a fôrma — e igualmente dormente hoje.
 */
export function colunasPersona(reels: LinhaReel[], metricas: LinhaMetrica[]): Medida<ColunaPersona[]> {
  const uso = new Map<string, number>();
  for (const r of reels) {
    const p = r.detalhe?.persona;
    if (!p) continue;
    uso.set(p, (uso.get(p) ?? 0) + 1);
  }
  if (uso.size === 0) {
    return semFonte(
      "nenhum reel tem `detalhe.persona` gravada",
      "o reel-render já grava a persona; falta armar FAROL_DUPLA para as duas personas entrarem na rotação"
    );
  }
  const linhas = [...uso.entries()].map(([persona, pecas]) => {
    const idx = mediaDe(metricas.filter((m) => m.persona === persona).map((m) => m.indice));
    const n = metricas.filter((m) => m.persona === persona).length;
    return {
      persona,
      pecas,
      indice:
        idx != null
          ? medido(idx, n)
          : semFonte<number>(
              "farol_metricas está vazia",
              "FAROL-METRICAS-01 ainda não coletou"
            ),
    };
  });
  return medido(linhas, [...uso.values()].reduce((a, b) => a + b, 0));
}

// ---------------------------------------------------------------------------
// Seção 4 — CUSTO
// ---------------------------------------------------------------------------

/**
 * TABELA DE PREÇO DECLARADA — é ESTIMATIVA, não fatura.
 *
 * Preço público do gpt-4o-mini (o `MODELO_CHAT` de lib/ia.ts), lido em
 * 09/08/2026, em dólar por 1 milhão de tokens. Fica como constante nomeada, e
 * não espalhado numa multiplicação, porque no dia em que a OpenAI mudar o preço
 * a tela tem que mudar num lugar só — e porque um número mágico de custo é
 * exatamente o tipo de coisa que ninguém consegue auditar depois.
 */
export const USD_POR_MTOK_IN = 0.15;
export const USD_POR_MTOK_OUT = 0.6;

/**
 * US$ por SEGUNDO de render, a tabela declarada pela OS ("segundos × US$0,05").
 *
 * Vem da OS, não de fatura, e por isso é a parcela MENOS auditável do bloco:
 * o preço de token eu conferi na tabela pública do provedor, este eu recebi
 * pronto. Fica nomeado aqui para que o dia em que a fatura do HeyGen contradizer
 * a conta, se corrija num lugar só.
 */
export const USD_POR_SEGUNDO_RENDER = 0.05;

export type CustoDia = { dia: string; usd: number; tokensIn: number; tokensOut: number };

export function custoDeTokens(tokensIn: number, tokensOut: number): number {
  return (tokensIn / 1_000_000) * USD_POR_MTOK_IN + (tokensOut / 1_000_000) * USD_POR_MTOK_OUT;
}

/**
 * Custo diário de IA conversacional — a ÚNICA fonte de custo medida na casa.
 *
 * A OS pede "custo estimado de render (segundos × US$0,05) + embeddings +
 * pauta". Dessas três parcelas, NENHUMA é computável hoje, e a razão está
 * medida:
 *   · RENDER: DESTRAVADO em 09/08/2026. Era a parcela sem multiplicando — o
 *     `StatusVideo` não carregava o `duration` que a v3 devolve e ninguém
 *     gravava. Agora `lerStatus` lê e a fase 2 grava `detalhe.duracao_s` assim
 *     que o render fica pronto; o custo sai em `placarCusto.custoRender`, não
 *     nesta série. Fica FORA do custo diário de propósito: as peças anteriores
 *     a 09/08 não têm duração e nunca terão, então uma barra por dia misturaria
 *     dias medidos com dias cegos desenhados como baratos.
 *   · EMBEDDINGS e PAUTA: nenhuma das duas grava contagem de token. A única
 *     tabela com `tokens_in`/`tokens_out` é `wa_mensagens`.
 *
 * O que EXISTE, e não estava na OS: `wa_mensagens.tokens_in/tokens_out`, com
 * 102 mensagens medidas (1.015.810 in / 35.300 out, 16/07→08/08). É custo real
 * de IA, é auditável linha a linha, e é o que esta função soma. As parcelas que
 * não existem aparecem na tela como `sem_fonte` — somar zero por elas faria o
 * "custo do mês" parecer completo quando é parcial, que é a pior forma de
 * mentir com número verdadeiro.
 */
export function serieCusto(
  mensagens: LinhaWaMensagem[],
  dias: number,
  agoraMs: number = Date.now()
): CustoDia[] {
  const espinha = espinhaDeDias(dias, agoraMs);
  const mapa = new Map<string, CustoDia>(
    espinha.map((dia) => [dia, { dia, usd: 0, tokensIn: 0, tokensOut: 0 }])
  );
  for (const m of mensagens) {
    if (m.tokens_in == null && m.tokens_out == null) continue;
    const dia = diaBR(m.criado_em);
    const alvo = dia ? mapa.get(dia) : undefined;
    if (!alvo) continue;
    alvo.tokensIn += m.tokens_in ?? 0;
    alvo.tokensOut += m.tokens_out ?? 0;
    alvo.usd = custoDeTokens(alvo.tokensIn, alvo.tokensOut);
  }
  return espinha.map((d) => mapa.get(d) as CustoDia);
}

export type PlacarCusto = {
  totalUsd: Medida<number>;
  porPeca: Medida<number>;
  porLead: Medida<number>;
  custoRender: Medida<number>;
};

/**
 * POR QUE `custoRender` NÃO É SOMADO AO `totalUsd`.
 *
 * Seria fácil devolver um "custo do mês" único e parecer mais completo. Seria
 * mentira aritmética: o custo de token cobre a janela INTEIRA (toda mensagem de
 * IA grava token desde julho), enquanto o de render só cobre os reels
 * renderizados a partir de 09/08/2026 — antes disso a duração era descartada e
 * é irrecuperável. Somar uma série completa com uma série que começa no meio
 * produz um total que não é nem uma coisa nem outra, e que sobe sozinho no mês
 * que vem sem que nada tenha encarecido. Duas medidas, dois `n`, cada uma
 * dizendo de quantas peças está falando.
 */
export function placarCusto(
  serieC: CustoDia[],
  pecasPublicadas: number,
  conversasNovas: number,
  reels: LinhaReel[] = []
): PlacarCusto {
  const total = serieC.reduce((s, d) => s + d.usd, 0);
  const nComToken = serieC.filter((d) => d.tokensIn + d.tokensOut > 0).length;

  // Só os reels que TÊM duração medida. Os antigos não entram nem como zero:
  // zero segundo de render é peça que não existiu, e diluiria o custo médio.
  const comDuracao = reels
    .map((r) => r.detalhe?.duracao_s)
    .filter((d): d is number => typeof d === "number" && Number.isFinite(d) && d > 0);
  const segundos = comDuracao.reduce((s, d) => s + d, 0);

  return {
    totalUsd:
      nComToken > 0
        ? medido(total, nComToken)
        : semFonte(
            "nenhuma mensagem com contagem de token na janela",
            "só as mensagens geradas por IA gravam tokens_in/tokens_out; medido: 102 das 309 têm"
          ),
    porPeca:
      pecasPublicadas > 0 && nComToken > 0
        ? medido(total / pecasPublicadas, pecasPublicadas)
        : semFonte(
            "sem peça publicada na janela, ou sem custo medido",
            "o custo por peça precisa das duas pontas: publicação em farol_posts/farol_reels e token em wa_mensagens"
          ),
    porLead:
      conversasNovas > 0 && nComToken > 0
        ? medido(total / conversasNovas, conversasNovas)
        : semFonte(
            "sem conversa nova na janela, ou sem custo medido",
            "custo por lead = custo do mês ÷ conversas novas do mês"
          ),
    custoRender:
      comDuracao.length > 0
        ? medido(segundos * USD_POR_SEGUNDO_RENDER, comDuracao.length)
        : semFonte(
            "nenhum reel da janela tem `detalhe.duracao_s` gravada",
            "a gravação passou a existir em 09/08/2026 (StatusVideo carrega `duration` e a fase 2 grava assim que o render fica pronto); as peças anteriores não têm e não dá para recuperar — o próximo render preenche"
          ),
  };
}

// ---------------------------------------------------------------------------
// Leituras — a única parte impura do arquivo
// ---------------------------------------------------------------------------
//
// MESMO CONTRATO DO painel.ts: cada leitura devolve `Bloco<T[]>` e NUNCA lança.
// Uma tabela ilegível vira um aviso naquela seção e o resto da sala de controle
// continua de pé. Numa tela de leitura isso não é tolerância a falha por
// preguiça: propagar trocaria cinco seções boas por uma página de erro que não
// diz qual das cinco quebrou.
//
// AS COLUNAS FORAM MEDIDAS, NÃO SUPOSTAS (information_schema, 09/08). Um nome
// de coluna errado no `select` do PostgREST não degrada nada: reprova a
// consulta inteira e a seção nasce vazia com um erro que parece "tabela vazia".

type Db = ReturnType<typeof createXtvClient>;

/** Janela da sala de controle. A OS pede 30 dias em todos os gráficos. */
export const JANELA_DASHBOARD_DIAS = 30;

function desde(dias: number): string {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
}

function falha(qual: string, msg: string): string {
  return `${qual}: ${msg}`.slice(0, 300);
}

/**
 * Conversas novas da janela. Três colunas e nada mais.
 *
 * `wa_conversas` tem 15 colunas, incluindo `telefone` e `nome` — dado pessoal de
 * cliente que esta tela não usa para nada. Pedir só `id,canal,criado_em` não é
 * economia de bytes: é não trazer telefone de cliente para uma tela de operação
 * que só quer contar linhas.
 */
/**
 * Conversas da janela — com PLANO B para a coluna `tags`.
 *
 * A releitura sem `tags` não é zelo decorativo, é a única forma de esta seção
 * sobreviver ao intervalo entre o deploy deste código e a aplicação da migração
 * 0075. No PostgREST um nome de coluna inexistente no `select` derruba a
 * CONSULTA INTEIRA, não só o campo: sem o plano B, a seção 2 do painel
 * apareceria vazia — comentários, private replies, conversas, respostas, tudo —
 * e a tela diria "não houve conversa nenhuma em 30 dias" quando a verdade é
 * "faltou rodar um `alter table`". Perder uma etapa por falta de coluna é
 * aceitável; perder as outras quatro junto não é.
 *
 * O custo é uma ida a mais ao banco no dia em que a migração ainda não foi
 * aplicada, e nenhuma depois. Quando a coluna existir, o primeiro `select`
 * passa e o plano B nunca roda.
 *
 * O `erro` do plano B fica em `null` de propósito: não é falha de leitura, é
 * uma etapa sem fonte, e quem conta isso na tela é o `funil()` — que vê `tags`
 * ausente e devolve `sem_fonte` com o texto certo. Um banner vermelho de "erro"
 * aqui mandaria o operador procurar defeito onde só falta uma migração.
 */
export async function lerConversas(
  db: Db,
  dias = JANELA_DASHBOARD_DIAS
): Promise<Bloco<LinhaWaConversa[]>> {
  const corte = desde(dias);
  const comTags = await db
    .from("wa_conversas")
    .select("id,canal,criado_em,tags")
    .gte("criado_em", corte)
    .order("criado_em", { ascending: false });
  if (!comTags.error) {
    return { dados: (comTags.data ?? []) as LinhaWaConversa[], erro: null };
  }

  const { data, error } = await db
    .from("wa_conversas")
    .select("id,canal,criado_em")
    .gte("criado_em", corte)
    .order("criado_em", { ascending: false });
  if (error) return { dados: [], erro: falha("wa_conversas ilegível", error.message) };
  return { dados: (data ?? []) as LinhaWaConversa[], erro: null };
}

/**
 * Mensagens da janela — sem `conteudo`, pelo mesmo motivo.
 *
 * O funil precisa de quem falou (`papel`), de quem assinou (`agente`) e de se
 * saiu (`status_envio`); o custo precisa de `tokens_in`/`tokens_out`. O texto da
 * conversa do cliente não entra nesta tela, e a forma de garantir isso é não o
 * selecionar.
 *
 * `papel` é o enum `wa_papel` — medido: cliente | prosperito | humano | sistema,
 * com 158 linhas em `cliente`. É por isso que `funil()` compara com "cliente" e
 * não com "user".
 */
export async function lerMensagens(
  db: Db,
  dias = JANELA_DASHBOARD_DIAS
): Promise<Bloco<LinhaWaMensagem[]>> {
  const { data, error } = await db
    .from("wa_mensagens")
    .select("conversa_id,papel,agente,status_envio,criado_em,tokens_in,tokens_out")
    .gte("criado_em", desde(dias))
    .order("criado_em", { ascending: false });
  if (error) return { dados: [], erro: falha("wa_mensagens ilegível", error.message) };
  return { dados: (data ?? []) as LinhaWaMensagem[], erro: null };
}

/**
 * Métricas de desempenho — SEM corte de janela, de propósito.
 *
 * As outras leituras cortam em 30 dias porque respondem "o que aconteceu no
 * mês". Esta responde "qual fôrma funciona", que é uma pergunta acumulada: uma
 * fôrma medida há 40 dias continua sendo evidência sobre ela. Cortar aqui faria
 * o ranking esquecer o que aprendeu, todo mês, sem avisar.
 *
 * O `limit` é teto de segurança, não regra de negócio: a tabela tem 0 linhas
 * hoje e um `select` sem teto numa tabela que um dia crescer traria a coleção
 * inteira para dentro da renderização da página.
 */
export async function lerMetricas(db: Db): Promise<Bloco<LinhaMetrica[]>> {
  const { data, error } = await db
    .from("farol_metricas")
    .select("peca_id,formula,persona,retencao,pct_nao_seguidores,indice")
    .order("medido_em", { ascending: false })
    .limit(5000);
  if (error) return { dados: [], erro: falha("farol_metricas ilegível", error.message) };
  return { dados: (data ?? []) as LinhaMetrica[], erro: null };
}

/**
 * O radar da seção 5. Só a contagem — a OS manda "se a seção do radar já
 * existir, apenas linkar; se não, deixar o espaço reservado".
 *
 * `head: true` traz o total sem trazer linha nenhuma: a tela precisa saber se há
 * o que mostrar, não do quê.
 */
export async function contarVideosRadar(db: Db): Promise<Bloco<number>> {
  const { count, error } = await db
    .from("farol_videos")
    .select("id", { count: "exact", head: true });
  if (error) return { dados: 0, erro: falha("farol_videos ilegível", error.message) };
  return { dados: count ?? 0, erro: null };
}

export type FontesDashboard = {
  posts: Bloco<LinhaPost[]>;
  reels: Bloco<LinhaReel[]>;
  conversas: Bloco<LinhaWaConversa[]>;
  mensagens: Bloco<LinhaWaMensagem[]>;
  metricas: Bloco<LinhaMetrica[]>;
  videosRadar: Bloco<number>;
};

/**
 * As cinco fontes numa chamada, em PARALELO — mesmo desenho de
 * `lerEstadoFarol`. Serializar seis leituras independentes multiplicaria por
 * seis a latência de uma tela que já é `force-dynamic`.
 *
 * `lerPosts`/`lerReels` são reaproveitadas de painel.ts com a janela de 30 dias
 * em vez das 14 do painel de operação — a mesma consulta, outro recorte. Uma
 * segunda cópia aqui divergiria na primeira coluna nova.
 */
export async function lerFontesDashboard(
  db: Db,
  dias = JANELA_DASHBOARD_DIAS
): Promise<FontesDashboard> {
  const [posts, reels, conversas, mensagens, metricas, videosRadar] = await Promise.all([
    lerPosts(db, dias),
    lerReels(db, dias),
    lerConversas(db, dias),
    lerMensagens(db, dias),
    lerMetricas(db),
    contarVideosRadar(db),
  ]);
  return { posts, reels, conversas, mensagens, metricas, videosRadar };
}
