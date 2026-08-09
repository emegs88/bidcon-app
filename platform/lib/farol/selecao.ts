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
// A REGRA:
//   1. fonte = `vw_vitrine_viva`, a MESMA que /api/card-image lê;
//   2. exclui cartas já usadas na janela DO TIPO delas — 14 dias para imóvel,
//      7 para veículo (memória em farol_posts). Ver `JANELA_REPETICAO_DIAS`;
//   3. alterna tipo por dia: ímpar = imóvel, par = veículo; sem estoque, cai
//      no outro;
//   4. FILTRO por teto de custo + RANKING por ALAVANCAGEM — ver o bloco
//      "NOVA REGRA DE SELEÇÃO" logo abaixo das constantes. Até 09/08/2026 este
//      passo era só "o menor custo ao mês";
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

/**
 * Dias sem repetir a mesma carta — POR TIPO desde 09/08/2026.
 *
 * Era 14 para todo mundo. Veículo caiu para 7 por uma pressão MEDIDA, não por
 * gosto. Com o teto de veículo em 1,50% a.m. (decisão (d) da mesma data), o
 * pool elegível é de 17 cartas. Com post diário e carrossel de sábado armados,
 * o consumo projetado é de ~13 cartas de veículo a cada 14 dias — sobrariam ~4.
 * Nada quebraria: `escolherCartaDoDia` cai no outro tipo sozinha, sem erro. E é
 * exatamente por isso que o problema é perigoso — ele apareceria como "sumiu
 * veículo do Instagram", sem uma única linha vermelha em log nenhum.
 *
 * Imóvel não tem essa pressão (278 elegíveis) e fica em 14.
 *
 * Afrouxar o teto seria o instrumento errado, e isso também está MEDIDO:
 * 1,55% não compra nenhuma carta nova (17), 1,60% compra 2 (19), e só 1,70%
 * alarga de verdade (27) — devolvendo ao card o 1,6x% a.m. que a decisão (d)
 * tinha acabado de tirar de propósito.
 *
 * O fundamento da escolha: a janela existe por FRESCOR EDITORIAL, não por
 * correção. Carta republicada depois de 7 dias continua disponível e continua
 * verdadeira. Vitrine sem veículo, essa sim, é erro de produto.
 */
export const JANELA_REPETICAO_DIAS: Record<string, number> = {
  imovel: 14,
  veiculo: 7,
};

/** Tipo desconhecido usa a janela mais LONGA: na dúvida, repete menos. */
export const JANELA_REPETICAO_PADRAO = 14;

/** A maior das janelas — é o quanto a memória precisa enxergar para trás. */
export const JANELA_REPETICAO_MAX = Math.max(
  JANELA_REPETICAO_PADRAO,
  ...Object.values(JANELA_REPETICAO_DIAS)
);

/** A janela do tipo, em dias. Tipo ausente ou desconhecido cai no padrão. */
export function janelaDias(tipo?: string | null): number {
  if (!tipo) return JANELA_REPETICAO_PADRAO;
  return JANELA_REPETICAO_DIAS[tipo] ?? JANELA_REPETICAO_PADRAO;
}

/**
 * Quantos candidatos puxar da view antes do cálculo canônico.
 *
 * SUBIU DE 80 PARA 500 EM 09/08/2026, E ISSO NÃO É COSMÉTICO — era um defeito
 * que a regra nova expôs. Enquanto o ranking ERA "menor custo", pegar as 80
 * mais baratas e escolher a primeira dava a resposta certa: a nº 81 nunca
 * ganharia de qualquer uma das 80. Com o ranking por ALAVANCAGEM isso deixa de
 * valer — a carta de melhor alavancagem pode estar em qualquer posição da faixa
 * elegível. MEDIDO HOJE: 278 imóveis e 42 veículos passam no teto de custo.
 * Com o limite em 80, 198 imóveis elegíveis JAMAIS entrariam na disputa, e o
 * "melhor da vitrine" seria na verdade "o melhor entre os 80 mais baratos".
 * 500 cobre a população elegível de hoje com folga; o PostgREST corta em 1000
 * de qualquer jeito, então este número é um teto de segurança, não a peneira.
 */
export const LIMITE_CANDIDATOS = 500;

// ---------------------------------------------------------------------------
// NOVA REGRA DE SELEÇÃO — AUTORIZADO: Emerson Gomes dos Santos, 09/08/2026:
// "sempre usar cartas de menor taxa, menor parcela e maior crédito".
//
// Os três critérios brigam: maior crédito quase sempre traz maior parcela. A
// OS já resolve a briga e eu implementei a resolução dela, em três camadas:
//
//   1. FILTRO (não é ranking): custo ao mês <= o teto do tipo. Carta cara não
//      disputa, por melhor que seja a alavancagem dela.
//   2. RANKING: ALAVANCAGEM = crédito / parcela. Quanto de crédito o cliente
//      leva por cada real de parcela mensal. Maior vence — respeitada a BANDA
//      DE EMPATE de 0,5% (ver `BANDA_EMPATE`, autorizada em 09/08/2026).
//   3. DESEMPATE: menor custo ao mês; empate persistente, maior crédito.
//
// ----------------------------------------------------------------------------
// ORIGEM DOS TETOS — REGISTRO MANTIDO A PEDIDO DA COORDENAÇÃO (09/08/2026).
// A OS dizia "o teto do tipo JÁ DEFINIDO na casa (PRICE-01)". Procurei antes de
// escrever: `grep` em todo o repo e busca nas funções do Postgres do xtv. Não
// há nenhuma constante de 1,00% / 1,85% em lugar nenhum, e "PRICE-01" no
// acervo é outra coisa — é a pendência de custo do trigger `trg_bidcon_price`
// (47 solves de TIR por linha), não um teto de vitrine.
// A coordenação confirmou depois que os números SÃO regra de casa do PRICE-01
// (custo ao mês máximo aceito na vitrine) e mandou manter este parágrafo como
// está: no que diz respeito ao CÓDIGO, eles nascem aqui. É origem, não reuso —
// e quem for auditar daqui a um ano tem direito de saber que o número não veio
// de outra linha do repositório.
//
// ----------------------------------------------------------------------------
// O QUE A ALAVANCAGEM NÃO VÊ — LIMITE HONESTO DA MÉTRICA.
// `credito / parcela` IGNORA A ENTRADA. Duas cartas com o mesmo crédito e a
// mesma parcela empatam na alavancagem mesmo que uma exija R$ 5 mil de entrada
// e a outra R$ 80 mil. Quem protege esse flanco é a camada 1: a entrada entra
// no cálculo do custo ao mês (saldo = crédito − entrada), e uma entrada
// desproporcional empurra o custo para cima até estourar o teto. Ou seja: a
// entrada não ordena, mas ELIMINA. Registrado porque é o ponto onde a métrica
// pedida pode surpreender, e a hora de dizer isso é agora, não no dia em que
// sair um card com entrada alta.
// ---------------------------------------------------------------------------

/**
 * Teto de custo ao mês (% a.m.) por tipo de bem. Camada 1 da regra.
 *
 * VEÍCULO BAIXOU DE 1,85 PARA 1,50 EM 09/08/2026, por decisão de marca, não de
 * cálculo. O ranking por alavancagem não mudou; mudou a FAIXA que a vitrine
 * defende. Motivo registrado: com o teto em 1,85 o topo de veículo saía a 1,64%
 * a.m. no mesmo dia em que existia 0,30% no estoque, e a Bidcon estampa o custo
 * ao mês no card — a conta fechava e a percepção não.
 *
 * Este é o botão certo para mexer quando o custo publicado incomodar. Apertar
 * aqui tira carta cara da disputa sem tocar em como as sobreviventes são
 * ordenadas; mexer na camada 2 mudaria o que "melhor carta" significa.
 */
export const TETO_CUSTO_AM: Record<string, number> = {
  imovel: 1.0,
  veiculo: 1.5,
};

/**
 * Folga usada só na consulta ao banco. MEDIDO: a coluna `custo_am` da view vem
 * arredondada em 2 casas, e o maior desvio dela contra o cálculo canônico é
 * 0,005047 (medido sobre as 1.926 linhas da vitrine hoje). Filtrar no banco
 * pelo teto exato descartaria carta que o canônico ainda aprovaria. 0,01 cobre
 * o desvio medido com quase o dobro de margem. A peneira que VALE é a canônica,
 * aplicada depois em memória — esta aqui só evita trazer o estoque inteiro.
 */
export const MARGEM_TETO_VIEW = 0.01;

/**
 * Alavancagem: crédito por real de parcela. Camada 2 da regra.
 * Parcela ausente devolve 0 (perde de todas) em vez de Infinity — uma carta
 * sem parcela conhecida não pode liderar a vitrine por falta de dado.
 */
export function alavancagem(c: Pick<CartaCarrossel, "credito" | "parcela">): number {
  return c.parcela > 0 ? c.credito / c.parcela : 0;
}

/** Empate em float. Comparar `===` em divisão é como não ter desempate. */
const EPS = 1e-9;

/**
 * BANDA DE EMPATE DA CAMADA 2 — autorizada em 09/08/2026.
 *
 * O CASO QUE A CRIOU (medido na vitrine de hoje): b8328a93 venceu 7f251b5a por
 * alavancagem 411,731207 contra 411,719818 — 0,0028% de diferença, vinda de
 * R$ 10 a mais de crédito num crédito de R$ 361 mil. Esses R$ 10 decidiram o
 * topo da vitrine ANTES que o desempate por custo pudesse pesar os 0,02 p.p.
 * de diferença real entre as duas. Ruído ganhando de sinal.
 *
 * Sem banda, o desempate por custo era letra morta na prática: alavancagem é
 * float contínuo, e empate exato só acontece em cartas duplicadas.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO É UMA FAIXA QUANTIZADA E NÃO UMA VIZINHANÇA DE 0,5%.
 * A implementação óbvia — "se |a−b|/a < 0,5%, empatou" — NÃO É TRANSITIVA: A
 * empata com B, B empata com C, e A perde de C. Comparador não-transitivo faz
 * `Array.prototype.sort` produzir ordem que depende do algoritmo do motor e do
 * tamanho do array. A vitrine de sábado sairia diferente da de segunda com o
 * mesmo estoque, e ninguém conseguiria reproduzir o bug. Regra determinística
 * não pode depender da versão do V8.
 *
 * Então a banda é uma GRADE: cada carta cai numa faixa logarítmica de passo
 * 0,5%, e a comparação é entre faixas. Isso é transitivo por construção (é uma
 * ordem sobre inteiros) e reproduzível em qualquer motor.
 *
 * O PREÇO, dito por inteiro: duas cartas separadas por menos de 0,5% podem
 * cair em faixas vizinhas se houver uma linha da grade entre elas — nesse caso
 * elas NÃO empatam. Não dá para ter tolerância relativa e transitividade ao
 * mesmo tempo; qualquer versão transitiva é uma quantização, e toda
 * quantização tem borda. O que importa é a escala: o passo da grade (0,5%) é
 * ~180x maior que o ruído que motivou a mudança (0,0028%), então o caso da OS
 * fica resolvido com folga, e o resíduo é uma borda estreita em vez de uma
 * ordem instável.
 */
export const BANDA_EMPATE = 0.005;

/**
 * A faixa (bucket) de alavancagem. Inteiro, para a comparação ser exata.
 * Alavancagem 0 (carta sem parcela) tem faixa própria, a pior de todas — e
 * finita, senão `faixa(b) - faixa(a)` daria NaN quando as duas fossem 0.
 */
function faixaAlavancagem(v: number): number {
  if (!(v > 0)) return -Number.MAX_SAFE_INTEGER;
  return Math.floor(Math.log(v) / Math.log(1 + BANDA_EMPATE));
}

/**
 * O comparador das três camadas (o filtro da camada 1 é aplicado antes, em
 * `dentroDoTeto`). Ordena do melhor para o pior — `.sort()` direto.
 */
export function compararPelaRegra(a: CartaCarrossel, b: CartaCarrossel): number {
  // Camada 2 — maior alavancagem vence, dentro da grade de 0,5%.
  const faixa = faixaAlavancagem(alavancagem(b)) - faixaAlavancagem(alavancagem(a));
  if (faixa !== 0) return faixa;

  const custoA = a.custoAm ?? Infinity;
  const custoB = b.custoAm ?? Infinity;
  if (Math.abs(custoA - custoB) > EPS) return custoA - custoB; // menor custo

  return b.credito - a.credito; // maior crédito
}

/**
 * Camada 1. Tipo sem teto cadastrado PASSA, de propósito: se amanhã nascer um
 * `tipo` novo na vitrine, o certo é ele aparecer e alguém decidir o teto dele —
 * não sumir em silêncio de todas as peças do FAROL no dia do deploy.
 */
export function dentroDoTeto(c: CartaCarrossel): boolean {
  const teto = TETO_CUSTO_AM[c.tipo];
  if (teto == null) return true;
  return c.custoAm != null && c.custoAm <= teto;
}

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

/**
 * A memória que impede repetir: id da carta → instante do post MAIS RECENTE.
 *
 * DEIXOU DE SER `Set<string>` EM 09/08/2026, e a razão é a janela por tipo.
 * Esta função lê `farol_posts`, que guarda `carta_id` e mais nada sobre a
 * carta — ela NÃO SABE se aquilo era imóvel ou veículo, e cada rota a chama uma
 * única vez, antes de o tipo do dia sequer existir. Um conjunto de ids já
 * cortados numa janela fixa não tem como carregar duas janelas diferentes.
 *
 * Então a divisão do trabalho mudou: aqui se lê pela janela MAIS LONGA e se
 * devolve o CARIMBO DE TEMPO; o corte exato acontece em `candidatos()`, carta a
 * carta, onde `normalizarCarta` já disse o tipo de cada uma. Continua sendo uma
 * pergunta ao banco, não duas — e o ramo da exclusiva, que varre os dois tipos
 * juntos e por isso nunca teve um "tipo do filtro", passou a acertar a janela
 * de cada carta em vez de aplicar uma só para as duas.
 */
export type MemoriaRecente = Map<string, number>;

/** Memória vazia — para quem não usa janela (o carrossel, de propósito). */
export function memoriaVazia(): MemoriaRecente {
  return new Map();
}

export async function publicadasRecentemente(
  db: Db,
  acoes: string[] = ["post_publicado"]
): Promise<MemoriaRecente> {
  const desde = new Date(
    Date.now() - JANELA_REPETICAO_MAX * 24 * 60 * 60 * 1000
  ).toISOString();
  const { data, error } = await db
    .from("farol_posts")
    .select("carta_id,criado_em")
    .in("acao", acoes)
    .gte("criado_em", desde);
  if (error) {
    // Falha de leitura NÃO pode virar "pode repetir tudo": sem a memória, o
    // FAROL poderia postar a mesma carta dois dias seguidos. Propaga.
    throw new Error(`farol_posts_ilegivel: ${error.message}`);
  }
  const memoria: MemoriaRecente = new Map();
  const linhas = (data ?? []) as {
    carta_id: string | null;
    criado_em: string | null;
  }[];
  for (const l of linhas) {
    if (!l.carta_id) continue;
    const t = l.criado_em ? Date.parse(l.criado_em) : NaN;
    // Data ilegível vira "agora": o efeito é excluir a carta pela janela
    // inteira. Errar para o lado de NÃO repetir, igual ao erro de leitura.
    const quando = Number.isFinite(t) ? t : Date.now();
    const atual = memoria.get(l.carta_id);
    // Só o post mais recente importa: é dele que a janela conta.
    if (atual === undefined || quando > atual) memoria.set(l.carta_id, quando);
  }
  return memoria;
}

/** True se a carta foi publicada DENTRO da janela do tipo dela. */
export function repetiriaCedoDemais(
  memoria: MemoriaRecente,
  carta: { id: string; tipo?: string | null },
  agora: number = Date.now()
): boolean {
  const quando = memoria.get(carta.id);
  if (quando === undefined) return false;
  return agora - quando < janelaDias(carta.tipo) * 24 * 60 * 60 * 1000;
}

/**
 * Busca candidatos na view, remove os repetidos, recalcula o custo pelo
 * canônico, APLICA O TETO e devolve ordenado pela regra das três camadas.
 *
 * A consulta continua ordenando por `custo_am` no banco — não porque essa é a
 * ordem final (não é mais), mas porque com o `lte` ela garante que, se algum
 * dia a população elegível passar de LIMITE_CANDIDATOS, o que sobrar de fora
 * sejam as MAIS CARAS da faixa, e não uma fatia arbitrária.
 */
export async function candidatos(
  db: Db,
  filtro: { tipo?: string; exclusiva?: boolean },
  memoria: MemoriaRecente
): Promise<CartaCarrossel[]> {
  // Um instante só para o lote inteiro: duas cartas na mesma consulta não podem
  // ser julgadas por relógios diferentes.
  const agora = Date.now();
  // Teto no banco: com tipo conhecido, o dele; sem tipo (ramo da exclusiva, que
  // varre imóvel e veículo juntos), o MAIOR dos dois — apertar aqui cortaria
  // veículo legítimo antes de o canônico opinar. A peneira exata vem depois.
  const tetoConsulta =
    (filtro.tipo ? TETO_CUSTO_AM[filtro.tipo] : Math.max(...Object.values(TETO_CUSTO_AM))) ??
    Math.max(...Object.values(TETO_CUSTO_AM));

  let q = db
    .from("vw_vitrine_viva")
    .select(CAMPOS_VITRINE)
    .lte("custo_am", tetoConsulta + MARGEM_TETO_VIEW)
    .order("custo_am", { ascending: true, nullsFirst: false })
    .limit(LIMITE_CANDIDATOS);
  if (filtro.tipo) q = q.eq("tipo", filtro.tipo);
  if (filtro.exclusiva) q = q.eq("exclusiva", true);

  const { data, error } = await q;
  if (error) throw new Error(`vitrine_ilegivel: ${error.message}`);

  return ((data ?? []) as LinhaVitrine[])
    .map(normalizarCarta)
    .filter((c): c is CartaCarrossel => c !== null)
    // Janela anti-repetição, agora pelo tipo DA CARTA (7 veículo / 14 imóvel).
    .filter((c) => !repetiriaCedoDemais(memoria, c, agora))
    // custoAm null = a carta não tem parcela/prazo utilizáveis. O card e a
    // legenda mostrariam "—" no lugar do número principal. Fora.
    .filter((c) => c.custoAm != null)
    // Camada 1 — o teto, agora pelo custo CANÔNICO (a coluna da view é só a
    // pré-filtragem barata; quem decide é este cálculo).
    .filter(dentroDoTeto)
    // Camadas 2 e 3 — alavancagem, depois custo, depois crédito.
    .sort(compararPelaRegra);
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
  opts: { dia: number; segunda: boolean; memoria: MemoriaRecente }
): Promise<EscolhaDoDia> {
  const tipoDoDia = opts.dia % 2 === 1 ? "imovel" : "veiculo";
  const tipoAlternativo = tipoDoDia === "imovel" ? "veiculo" : "imovel";

  // Segunda: exclusiva fura fila (qualquer tipo). Se não houver exclusiva
  // elegível, o dia segue a regra normal — sem post especial, sem erro.
  if (opts.segunda) {
    const exclusivas = await candidatos(db, { exclusiva: true }, opts.memoria);
    if (exclusivas.length > 0) {
      return { carta: exclusivas[0], motivo: "exclusiva_segunda", tipoDoDia };
    }
  }

  const doTipo = await candidatos(db, { tipo: tipoDoDia }, opts.memoria);
  if (doTipo.length > 0) {
    return { carta: doTipo[0], motivo: `tipo_do_dia:${tipoDoDia}`, tipoDoDia };
  }

  const doOutro = await candidatos(db, { tipo: tipoAlternativo }, opts.memoria);
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

// ---------------------------------------------------------------------------
// PROMESSA DE CONTEMPLAÇÃO — regra própria, por regex.
// AUTORIZADO: Emerson Gomes dos Santos — microfatia "RÓTULO-IA + linter", 07/08.
//
// POR QUE NÃO ENTRA EM `TERMOS_PROIBIDOS`: aquela lista é substring pura, e a
// palavra "contemplada" é O PRODUTO — "carta contemplada", "cota contemplada"
// aparecem em toda legenda e em todo roteiro. Bloquear a palavra mataria o
// FAROL inteiro. O que é proibido não é a palavra: é a PROMESSA (garantia ou
// prazo). Por isso a regra olha o que vem GRUDADO nela.
//
// LACUNA REAL QUE ISTO FECHA (medida hoje): `TERMOS_PROIBIDOS` tem "garantido"
// no masculino e NÃO tem "garantida". Logo "contemplação garantida" passava
// limpo pelo linter até esta linha existir.
//
// Cada padrão abaixo é comentado com o que ele pega e o que ele deixa passar
// de propósito — porque um linter de compliance que ninguém entende é um
// linter que alguém desliga.
// ---------------------------------------------------------------------------
// `\w` em JS é [A-Za-z0-9_] e NÃO cobre acento — medido: /contempl\w*\s+em/
// não pega "contemplação em 2 semanas", porque `\w*` para no "ç". Esta classe
// existe só para consertar isso, e é usada onde havia `\w*`.
const L = "[a-zà-öø-ÿ]";

const PADROES_CONTEMPLACAO: Array<{ nome: string; re: RegExp }> = [
  // "contemplação garantida", "contemplacao garantido". Fecha a lacuna do
  // feminino descrita acima.
  { nome: "contemplacao_garantida", re: /contempla(?:ç|c)(?:ã|a)o\s+garantid[ao]/ },

  // "garantimos a contemplação", "garantia de contemplação" — a mesma promessa
  // dita pelo outro lado da frase.
  {
    nome: "garantia_de_contemplacao",
    re: new RegExp(`garant${L}*\\s+(?:a\\s+|de\\s+|da\\s+)?contempla`),
  },

  // "será contemplado", "vai ser contemplada", "estará contemplado" — futuro
  // afirmativo sobre a pessoa. NÃO pega "foi contemplada" (passado, que é fato).
  {
    nome: "futuro_contemplado",
    re: /(?:ser[áa]|vai\s+ser|v[ãa]o\s+ser|estar[áa]|fica)\s+contemplad[ao]/,
  },

  // "contemplado em 3 meses", "contemplada em até 90 dias", "contemplação em
  // 2 semanas". EXIGE unidade de tempo depois do número, de propósito: sem
  // isso, "contemplada em 2024" (fato passado, legítimo) seria reprovada.
  {
    nome: "prazo_de_contemplacao",
    re: new RegExp(
      `contempl${L}*\\s+em\\s+(?:at[ée]\\s+)?\\d+\\s*(?:dia|semana|m[eê]s|mes|ano)`
    ),
  },

  // "contempla em ..." — verbo no presente prometendo evento futuro. Note que
  // "contemplada em" NÃO casa aqui (depois de "contempla" vem "d", não espaço),
  // então o produto continua livre.
  { nome: "contempla_em", re: /contempla\s+em\b/ },
];

export function revisarLegenda(texto: string): string | null {
  const t = texto.toLowerCase();
  for (const termo of TERMOS_PROIBIDOS) {
    if (t.includes(termo)) return `termo_proibido:${termo}`;
  }
  // Promessa/prazo de contemplação — ver bloco acima.
  for (const p of PADROES_CONTEMPLACAO) {
    if (p.re.test(t)) return `promessa_contemplacao:${p.nome}`;
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
