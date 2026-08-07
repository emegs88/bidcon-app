// ============================================================================
// lib/farol/selecao.ts — a seleção da carta do dia, compartilhada pelo FAROL
// AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-REEL-01", 06/08/2026:
// "escolhe a carta do dia pela MESMA lib de seleção do FAROL-POST".
// ----------------------------------------------------------------------------
// MEDIÇÃO ANTES DE OPINIÃO — E UM DESVIO DECLARADO NA PREMISSA DA OS.
// Fui ler a "lib de seleção do FAROL-POST" para importá-la. ELA NÃO EXISTIA:
// `hojeSP`, `publicadasRecentemente`, `candidatos` e a regra de escolha estavam
// TODAS inline dentro de app/api/farol/post-diario/route.ts. A OS descreve uma
// lib que ainda não tinha nascido.
//
// Duas saídas possíveis: copiar a regra para dentro do reel (duas cópias que
// divergem no primeiro ajuste — é assim que o feed e o reel passariam a
// escolher cartas por critérios diferentes sem ninguém perceber), ou EXTRAIR.
// Extraí. É exatamente o precedente que o próprio FAROL já abriu no item 6 do
// FAROL-POST, quando a publicação saiu da rota manual e virou
// lib/instagram/publicar.ts: MUDANÇA DE ENDEREÇO, NÃO DE COMPORTAMENTO.
//
// DIFF FUNCIONAL DA ROTA post-diario = ZERO. Todo corpo abaixo veio de lá
// LITERAL, incluindo as constantes, os textos de erro (`farol_posts_ilegivel:`,
// `vitrine_ilegivel:`), o prefixo de log `[farol]` e o comportamento de
// propagar exceção em vez de degradar. As duas únicas diferenças, ambas
// aditivas e ambas com o padrão antigo como default:
//
//   1. `publicadasRecentemente` passou a receber QUAIS ações contam como
//      memória. O post-diario chama com ["post_publicado"] — idêntico ao que
//      fazia. O reel chama com ["post_publicado","reel_publicado"], porque um
//      reel não deve repetir carta que já virou reel.
//   2. A escolha (segunda-exclusiva → tipo do dia → tipo alternativo) virou
//      `escolherCartaDoDia`, devolvendo `{carta, motivo}` em vez de mutar duas
//      variáveis locais. Mesma ordem, mesmos motivos, mesmas strings.
//
// NÃO MUDEI a memória do post-diario para também enxergar `reel_publicado`.
// Seria uma mudança de comportamento da rota em produção, e a OS não pediu.
// Consequência real e declarada: uma carta que virou reel PODE virar post de
// feed depois. O contrário não acontece. Se o Emerson quiser simetria, é uma
// linha — e é decisão dele, não minha.
//
// ---------------------------------------------------------------------------
// A REGRA (inalterada, repetida aqui porque agora mora aqui):
//   1. fonte = `vw_vitrine_viva`, a MESMA que /api/card-image lê;
//   2. exclui cartas já usadas nos últimos 14 dias (memória em farol_posts);
//   3. alterna tipo por dia: ímpar = imóvel, par = veículo; sem estoque, cai
//      no outro;
//   4. escolhe o MENOR custo ao mês, pelo cálculo canônico;
//   5. exclusiva fura fila 1× por semana, na segunda.
// "Dia" é em São Paulo, não em UTC — senão `getDate()` no runtime da Vercel
// inverte imóvel/veículo sozinho e ninguém mexeu em nada.
// ============================================================================
import { createXtvClient } from "@/lib/supabase-xtv";
import {
  CAMPOS_VITRINE,
  normalizarCarta,
  type CartaCarrossel,
  type LinhaVitrine,
} from "@/lib/carrossel-formato";

type Db = ReturnType<typeof createXtvClient>;

const TZ = "America/Sao_Paulo";

/** Dias sem repetir a mesma carta. Regra da OS. */
export const JANELA_REPETICAO_DIAS = 14;

/** Quantos candidatos mais baratos puxar da view antes do cálculo canônico. */
export const LIMITE_CANDIDATOS = 80;

/**
 * Guard do FAROL. Espelha `autorizado()` de app/api/sentinela/varredura.
 * `CRON_SECRET` no fim da linha é o que o cron da Vercel manda sozinho;
 * `FAROL_SECRET` existe pra disparo à mão. Sem secret => NÃO roda (numa preview
 * sem env a rota fica fechada, não aberta).
 */
export function autorizadoFarol(req: Request): boolean {
  const secret = process.env.FAROL_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/** Dia do mês e "é segunda?" no fuso de São Paulo — ver header. */
export function hojeSP(): { data: string; dia: number; segunda: boolean } {
  const agora = new Date();
  // en-CA devolve YYYY-MM-DD, que é ordenável e não ambíguo.
  const data = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
  const semana = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
  }).format(agora);
  return { data, dia: Number(data.slice(8, 10)), segunda: semana === "Mon" };
}

/** Cartas já usadas na janela — a memória que impede repetir. */
export async function publicadasRecentemente(
  db: Db,
  acoes: string[] = ["post_publicado"]
): Promise<Set<string>> {
  const desde = new Date(
    Date.now() - JANELA_REPETICAO_DIAS * 24 * 60 * 60 * 1000
  ).toISOString();
  const { data, error } = await db
    .from("farol_posts")
    .select("carta_id")
    .in("acao", acoes)
    .gte("criado_em", desde);
  if (error) {
    // Falha de leitura NÃO pode virar "pode repetir tudo": sem a memória, o
    // FAROL poderia postar a mesma carta dois dias seguidos. Propaga.
    throw new Error(`farol_posts_ilegivel: ${error.message}`);
  }
  const ids = new Set<string>();
  for (const l of (data ?? []) as { carta_id: string | null }[]) {
    if (l.carta_id) ids.add(l.carta_id);
  }
  return ids;
}

/**
 * Busca candidatos na view (mais baratos primeiro pelo `custo_am` da view),
 * remove os repetidos, recalcula o custo pelo canônico e devolve ordenado.
 */
export async function candidatos(
  db: Db,
  filtro: { tipo?: string; exclusiva?: boolean },
  excluidos: Set<string>
): Promise<CartaCarrossel[]> {
  let q = db
    .from("vw_vitrine_viva")
    .select(CAMPOS_VITRINE)
    .order("custo_am", { ascending: true, nullsFirst: false })
    .limit(LIMITE_CANDIDATOS);
  if (filtro.tipo) q = q.eq("tipo", filtro.tipo);
  if (filtro.exclusiva) q = q.eq("exclusiva", true);

  const { data, error } = await q;
  if (error) throw new Error(`vitrine_ilegivel: ${error.message}`);

  return ((data ?? []) as LinhaVitrine[])
    .map(normalizarCarta)
    .filter((c): c is CartaCarrossel => c !== null)
    .filter((c) => !excluidos.has(c.id))
    // custoAm null = a carta não tem parcela/prazo utilizáveis. O card e a
    // legenda mostrariam "—" no lugar do número principal. Fora.
    .filter((c) => c.custoAm != null)
    .sort((a, b) => (a.custoAm as number) - (b.custoAm as number));
}

export type EscolhaDoDia = {
  carta: CartaCarrossel | null;
  motivo: string;
  tipoDoDia: string;
};

/**
 * A escolha, na ordem original: exclusiva na segunda → tipo do dia → o outro
 * tipo. `carta: null` significa "não há carta elegível hoje" — não é erro.
 */
export async function escolherCartaDoDia(
  db: Db,
  opts: { dia: number; segunda: boolean; excluidos: Set<string> }
): Promise<EscolhaDoDia> {
  const tipoDoDia = opts.dia % 2 === 1 ? "imovel" : "veiculo";
  const tipoAlternativo = tipoDoDia === "imovel" ? "veiculo" : "imovel";

  // Segunda: exclusiva fura fila (qualquer tipo). Se não houver exclusiva
  // elegível, o dia segue a regra normal — sem post especial, sem erro.
  if (opts.segunda) {
    const exclusivas = await candidatos(db, { exclusiva: true }, opts.excluidos);
    if (exclusivas.length > 0) {
      return { carta: exclusivas[0], motivo: "exclusiva_segunda", tipoDoDia };
    }
  }

  const doTipo = await candidatos(db, { tipo: tipoDoDia }, opts.excluidos);
  if (doTipo.length > 0) {
    return { carta: doTipo[0], motivo: `tipo_do_dia:${tipoDoDia}`, tipoDoDia };
  }

  const doOutro = await candidatos(db, { tipo: tipoAlternativo }, opts.excluidos);
  if (doOutro.length > 0) {
    return {
      carta: doOutro[0],
      motivo: `tipo_alternativo:${tipoAlternativo}`,
      tipoDoDia,
    };
  }

  return { carta: null, motivo: "", tipoDoDia };
}

// ---------------------------------------------------------------------------
// Compliance — trava DETERMINÍSTICA (não é IA). Lista literal do CLAUDE.md.
// Vive aqui, e não na rota, para que reel e post sejam medidos pela MESMA
// régua: o dia em que um texto for reescrito às pressas, ele não sai em vez de
// sair irregular — nos dois formatos.
// ---------------------------------------------------------------------------
export const TERMOS_PROIBIDOS = [
  "investimento",
  "investidor",
  "rendimento",
  "lucro",
  "cdi",
  "risco zero",
  "100% seguro",
  "garantido",
];

export function revisarLegenda(texto: string): string | null {
  const t = texto.toLowerCase();
  for (const termo of TERMOS_PROIBIDOS) {
    if (t.includes(termo)) return `termo_proibido:${termo}`;
  }
  // Custo tem que aparecer como taxa ao mês, nunca como nominal simples.
  if (t.includes("%") && !t.includes("% a.m.")) return "percentual_sem_ao_mes";
  return null;
}

/** Grava no diário do FAROL. Nunca derruba a rota: log é log. */
export async function registrar(
  db: Db,
  acao: string,
  carta_id: string | null,
  post_id: string | null,
  detalhe: Record<string, unknown>
): Promise<void> {
  const { error } = await db
    .from("farol_posts")
    .insert({ acao, carta_id, post_id, detalhe });
  if (error) console.error("[farol] falha gravando farol_posts:", error.message);
}
