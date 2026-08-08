// ============================================================================
// lib/farol/painel.ts — a LEITURA do estado do FAROL para o painel admin
// AUTORIZADO: Emerson Gomes dos Santos — OS "PAINEL-FAROL-01", 08/08/2026:
// "painel de vídeos virais dentro da Bidcon, sendo disparado de lá".
// ----------------------------------------------------------------------------
// POR QUE UMA LIB E NÃO CONSULTAS NA PÁGINA. Três superfícies precisam da MESMA
// verdade sobre o dia: a página (que desenha), as rotas de ação (que decidem se
// a ação é legal — "destravar" só existe para linha travada) e, amanhã, quem
// vier medir o FAROL. Consulta inline na página vira cópia divergente na
// primeira rota que precisar da mesma pergunta.
//
// TUDO AQUI LÊ O xtv, e só o xtv. As três tabelas do FAROL (`farol_posts`,
// `farol_reels`, `farol_pauta`) moram lá, com RLS ligada e ZERO policy — ou
// seja, alcançáveis apenas por service_role. Isso tem uma consequência que
// define a arquitetura do painel inteiro e está escrita aqui para não ser
// redescoberta: **o navegador nunca fala com estas tabelas**. Não existe
// caminho de chave anônima até elas, por construção do banco. Toda leitura é
// server-side, e o gate é o da aplicação (`exigirAdminConsolePagina`), mesmo
// padrão de /admin/revisao, /admin/importar e /admin/conversas — que leem xtv
// pelo mesmo motivo. NÃO é `exigirPapel("admin")`: aquele vale para dados no
// nnv, onde a RLS por sessão é que barra.
//
// LEITURA NUNCA DERRUBA A TELA. Cada bloco devolve `{dados, erro}`: uma tabela
// ilegível vira um aviso naquele card e o resto da página continua de pé. O
// oposto — propagar — trocaria "o reel de hoje falhou" por uma página de erro
// que não diz nada. Nas rotas do FAROL a propagação é certa (lá, ler errado
// publica errado); aqui ninguém publica, só se olha.
// ============================================================================
import { createXtvClient } from "@/lib/supabase-xtv";
import { hojeSP } from "@/lib/farol/selecao";

type Db = ReturnType<typeof createXtvClient>;

/** Janela do histórico da tela. A OS pede 14 dias. */
export const JANELA_PAINEL_DIAS = 14;

/**
 * A aprovação humana da pauta NASCE DESARMADA (item 2 da OS). Sem
 * `FAROL_PAUTA_APROVA=on`, `/api/farol/pauta` continua gravando 'nova' e
 * `/api/farol/reel-render` continua consumindo 'nova' — comportamento atual bit
 * a bit. Com a env on, entra o estado intermediário.
 *
 * Mora aqui, e não em cada rota, porque três arquivos fazem a MESMA pergunta e
 * três leituras de `process.env` divergem no dia em que alguém renomear a env.
 *
 * PRÉ-REQUISITO DE BANCO, declarado: os estados novos ('aguardando_aprovacao',
 * 'aprovada') não passam pelo CHECK atual de `farol_pauta.status`. A migration
 * está escrita e NÃO aplicada (ver `painel-farol-01/` na raiz do repo). Ligar
 * esta env antes de aplicar faz o insert das 10h falhar no 23514. É por isso
 * que ela nasce desarmada, e não por estética.
 */
export function aprovacaoDePautaLigada(): boolean {
  return process.env.FAROL_PAUTA_APROVA === "on";
}

/** Estado que a pauta do dia recebe ao nascer, conforme a env acima. */
export function statusInicialDaPauta(): string {
  return aprovacaoDePautaLigada() ? "aguardando_aprovacao" : "nova";
}

/** Estado que o reel-render exige para CONSUMIR a pauta, conforme a env acima. */
export function statusConsumivelDaPauta(): string {
  return aprovacaoDePautaLigada() ? "aprovada" : "nova";
}

// ---------------------------------------------------------------------------
// Tipos — o que a tela desenha
// ---------------------------------------------------------------------------

export type DetalhePost = {
  data?: string;
  tipo?: string;
  administradora?: string;
  credito?: number;
  custo_am?: number | null;
  escolha?: string;
  erro?: string;
  motivo?: string;
};

export type LinhaPost = {
  id: string;
  acao: string;
  carta_id: string | null;
  post_id: string | null;
  detalhe: DetalhePost | null;
  criado_em: string;
};

export type DetalheReel = {
  data?: string;
  tipo?: string;
  administradora?: string;
  credito?: number;
  custo_am?: number | null;
  avatar_tipo?: string;
  formula?: string;
  pauta_id?: string;
  fonte_texto?: string;
  url_hospedada?: string;
  yt_video_id?: string;
  tt_publish_id?: string;
  container_anterior?: string;
  dedupe_confirmado_em?: string;
};

export type LinhaReel = {
  id: string;
  carta_id: string | null;
  video_id: string;
  container_id: string | null;
  post_id: string | null;
  status: string;
  roteiro: string | null;
  legenda: string | null;
  erro: string | null;
  detalhe: DetalheReel | null;
  criado_em: string;
  atualizado_em: string | null;
};

export type FontePauta = { titulo?: string; url?: string; tema?: string };

export type LinhaPauta = {
  id: string;
  dia: string;
  formula: string;
  gancho: string | null;
  roteiro: string | null;
  legenda: string | null;
  hashtags: string[] | null;
  fontes: FontePauta[] | null;
  status: string;
  motivo_linter: string | null;
  carta_id: string | null;
  criado_em: string;
};

export type Bloco<T> = { dados: T; erro: string | null };

/** Estados de `farol_reels` que ainda estão em movimento. */
export const STATUS_REEL_VIVOS = ["renderizando", "pronto", "publicando"];

/**
 * Uma linha de reel está TRAVADA quando continua num estado vivo e faz tempo
 * demais que ninguém a move. Isto é o que habilita o botão "destravar" — e ele
 * não aparece para linha saudável, porque destravar uma linha que está só
 * demorando joga fora um container que ia publicar.
 *
 * O relógio é `atualizado_em` (a última mexida real), com queda para
 * `criado_em` na linha que nunca foi tocada. É a mesma âncora que a autocura de
 * container usa na fase 2 — uma régua só para os dois, senão a tela diz
 * "travada" sobre uma linha que a máquina considera nova.
 */
export const IDADE_TRAVADA_MS = 30 * 60 * 1000;

export function reelTravado(l: LinhaReel, agoraMs: number = Date.now()): boolean {
  if (!STATUS_REEL_VIVOS.includes(l.status)) return false;
  const base = l.atualizado_em ?? l.criado_em;
  const idade = agoraMs - new Date(base).getTime();
  return Number.isFinite(idade) && idade >= IDADE_TRAVADA_MS;
}

// ---------------------------------------------------------------------------
// Leituras
// ---------------------------------------------------------------------------

function desde(dias: number): string {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
}

/** Mensagem de erro de leitura, curta e literal — é o que aparece no card. */
function falha(qual: string, msg: string): string {
  return `${qual}: ${msg}`.slice(0, 300);
}

export async function lerPosts(db: Db, dias = JANELA_PAINEL_DIAS): Promise<Bloco<LinhaPost[]>> {
  const { data, error } = await db
    .from("farol_posts")
    .select("id,acao,carta_id,post_id,detalhe,criado_em")
    .gte("criado_em", desde(dias))
    .order("criado_em", { ascending: false });
  if (error) return { dados: [], erro: falha("farol_posts ilegível", error.message) };
  return { dados: (data ?? []) as LinhaPost[], erro: null };
}

export async function lerReels(db: Db, dias = JANELA_PAINEL_DIAS): Promise<Bloco<LinhaReel[]>> {
  const { data, error } = await db
    .from("farol_reels")
    .select(
      "id,carta_id,video_id,container_id,post_id,status,roteiro,legenda,erro,detalhe,criado_em,atualizado_em"
    )
    .gte("criado_em", desde(dias))
    .order("criado_em", { ascending: false });
  if (error) return { dados: [], erro: falha("farol_reels ilegível", error.message) };
  return { dados: (data ?? []) as LinhaReel[], erro: null };
}

export async function lerPautas(db: Db, dias = JANELA_PAINEL_DIAS): Promise<Bloco<LinhaPauta[]>> {
  // `dia` é `date`, não timestamptz — o corte é por data civil, e a data civil
  // do FAROL é a de São Paulo. Cortar por UTC mostraria a pauta de hoje como
  // "amanhã" durante a madrugada.
  const limite = new Date(Date.now() - dias * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const { data, error } = await db
    .from("farol_pauta")
    .select(
      "id,dia,formula,gancho,roteiro,legenda,hashtags,fontes,status,motivo_linter,carta_id,criado_em"
    )
    .gte("dia", limite)
    .order("dia", { ascending: false });
  if (error) return { dados: [], erro: falha("farol_pauta ilegível", error.message) };
  return { dados: (data ?? []) as LinhaPauta[], erro: null };
}

export type EstadoFarol = {
  /** Data civil de São Paulo — a mesma que o FAROL usa para tudo. */
  hoje: string;
  posts: Bloco<LinhaPost[]>;
  reels: Bloco<LinhaReel[]>;
  pautas: Bloco<LinhaPauta[]>;
  aprovacaoLigada: boolean;
};

/**
 * O estado inteiro numa chamada. As três leituras vão em paralelo porque são
 * independentes: serializar triplicaria a latência da tela sem comprar nada.
 */
export async function lerEstadoFarol(db: Db): Promise<EstadoFarol> {
  const { data: hoje } = hojeSP();
  const [posts, reels, pautas] = await Promise.all([
    lerPosts(db),
    lerReels(db),
    lerPautas(db),
  ]);
  return { hoje, posts, reels, pautas, aprovacaoLigada: aprovacaoDePautaLigada() };
}

// ---------------------------------------------------------------------------
// Recortes do dia
// ---------------------------------------------------------------------------

/**
 * O post de HOJE. Preferência pelo publicado: num dia em que a primeira
 * tentativa falhou e a segunda passou, o card tem de mostrar o que está no ar,
 * não a falha. Sem publicado, mostra a tentativa mais recente — que é onde o
 * motivo do fracasso está escrito.
 */
export function postDoDia(linhas: LinhaPost[], hoje: string): LinhaPost | null {
  const doDia = linhas.filter((l) => l.detalhe?.data === hoje && l.acao.startsWith("post_"));
  return doDia.find((l) => l.acao === "post_publicado") ?? doDia[0] ?? null;
}

/** O reel de HOJE, pela mesma regra: publicado ganha da tentativa. */
export function reelDoDia(linhas: LinhaReel[], hoje: string): LinhaReel | null {
  const doDia = linhas.filter((l) => l.detalhe?.data === hoje);
  return doDia.find((l) => l.status === "publicado") ?? doDia[0] ?? null;
}

/** A pauta de HOJE. Uma por dia na operação normal (unique dia+fôrma). */
export function pautaDoDia(linhas: LinhaPauta[], hoje: string): LinhaPauta | null {
  return linhas.find((l) => l.dia === hoje) ?? null;
}
