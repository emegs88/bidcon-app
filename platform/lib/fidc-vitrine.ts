// ============================================================================
// FIDC-OFERTAS-01 · Entrega 2 — A VITRINE QUE O FUNDO ENXERGA.
// ----------------------------------------------------------------------------
// A ordem tem uma trava dura aqui: "o fundo NÃO vê dado pessoal de cedente
// nenhum antes do aceite". Este arquivo cumpre isso por ESTRUTURA, não por
// disciplina.
//
// A fonte é a VIEW `vw_vitrine_viva`, nunca a tabela `cartas`. Medi a definição
// dela na 0056: ela não projeta `parceiro_id`, não projeta `fornecedor_id`, não
// projeta `entrada_parceiro_raw`. Lendo a view, essas colunas não existem para
// quem lê — não há o que esquecer de excluir. Lendo `cartas` direto, a regra da
// 0011 ("NUNCA selecione cartas.fornecedor_id") passaria a depender de eu, e
// depois outra pessoa, lembrar dela em toda consulta nova. Regra que depende de
// memória é regra que um dia falha calada.
//
// A view também já embute `status='disponivel' AND valor_credito>0 AND
// categoria='contemplada' AND NOT EXISTS(reserva ativa)`. Carta reservada no chat
// some daqui sozinha: o fundo não faz oferta por algo que já está sendo vendido.
//
// ----------------------------------------------------------------------------
// O QUE EU DEIXEI DE FORA DE PROPÓSITO, e é mais importante do que o que entrou:
//
//   agio_120 / agio_150 — é a MARGEM DA CASA. A view expõe, e seria fácil trazer
//   junto com o resto. O fundo é a contraparte compradora desta mesa; entregar a
//   ele o indicador do quanto a Bidcon marca em cima é negociar contra si mesmo
//   de graça. Não é dado pessoal, é dado comercial, e por isso não aparece em
//   lugar nenhum abaixo.
//
//   fonte / exclusiva — diz se a carta veio de cliente direto ou de parceiro.
//   Não muda o preço nem a oferta, e conta a estrutura da operação. Fica fora
//   até que exista um motivo nomeado para entrar.
//
//   fingerprint — chave interna de deduplicação. Não é assunto de fora.
//
// ----------------------------------------------------------------------------
// O TETO DE TELA É DECLARADO, NUNCA SILENCIOSO.
//
// Medido no xtv em 12/08/2026: a vitrine viva tem 2.425 cartas e soma
// R$ 420.493.818,53. A tela carrega no máximo TETO_TELA e SEMPRE informa o total
// verdadeiro que casou com o filtro. Uma lista cortada que não se anuncia faria o
// fundo acreditar que "selecionar tudo" pegou tudo — e "tudo" aqui é dinheiro de
// nove dígitos.
// ============================================================================
import { createXtvClient } from "@/lib/supabase-xtv";

/** O recorte que sai daqui. Nenhum campo a mais — ver cabeçalho. */
export type CartaVitrine = {
  id: string;
  ref: number | null;
  tipo: string | null;
  credito: number;
  entrada: number | null;
  parcela: number | null;
  parcelas: number | null;
  custo_am: number | null;
  administradora: string | null;
};

export type FiltrosVitrine = {
  tipo: "imovel" | "veiculo" | null;
  creditoMin: number | null;
  creditoMax: number | null;
  administradora: string | null;
  custoMax: number | null;
};

/** Quantas cartas a tela carrega de uma vez. Ver "TETO DE TELA" no cabeçalho. */
export const TETO_TELA = 500;

const FILTROS_VAZIOS: FiltrosVitrine = {
  tipo: null,
  creditoMin: null,
  creditoMax: null,
  administradora: null,
  custoMax: null,
};

/**
 * O PONTO É AMBÍGUO, e a primeira versão deste código errou por ignorar isso.
 *
 * Ela apagava TODO ponto como separador de milhar. "150.000" virava 150000 —
 * certo. "150000.50" virava 15000050 — cem vezes o valor pedido, calado. O teste
 * pegou antes de existir tela; sem ele, o filtro devolveria a lista errada e
 * alguém ofertaria 24 horas em cima dela.
 *
 * A regra, escrita por extenso porque adivinhar formato é sempre uma aposta:
 *
 *   1. Tem vírgula? Então é pt-BR: a vírgula é a decimal e os pontos são milhar.
 *      "1.234.567,89" -> 1234567.89
 *   2. Não tem vírgula, e os pontos formam grupos de exatamente 3 dígitos?
 *      Então são milhar. "150.000" -> 150000
 *   3. Qualquer outro ponto é decimal. "150000.50" -> 150000.5
 *
 * O caso que esta regra decide contra o pt-BR é "150.00": ela lê 150,00 e não
 * quinze mil. Assumido de propósito — grupo de milhar tem três dígitos, e quem
 * escreve dois está escrevendo centavos em qualquer leitura razoável.
 */
function numeroOuNulo(v: string | undefined | null): number | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const bruto = v.trim().replace(/\s/g, "");

  let limpo: string;
  if (bruto.includes(",")) {
    limpo = bruto.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(bruto)) {
    limpo = bruto.replace(/\./g, "");
  } else {
    limpo = bruto;
  }

  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

/**
 * Lê os filtros da URL. PURA — é o que dá para testar sem banco.
 *
 * Entrada inválida vira `null` (filtro ausente), nunca zero. Zero é um número:
 * `creditoMin=0` filtraria de verdade, e "não consegui ler o que você digitou"
 * viraria "você pediu crédito acima de zero". São coisas diferentes.
 *
 * Faixa invertida (mín 500k, máx 100k) é CORRIGIDA trocando as pontas, e não
 * recusada: a intenção de quem digitou é óbvia, e devolver lista vazia sem
 * explicação seria pior do que fazer o que a pessoa claramente quis.
 */
export function normalizarFiltros(
  sp: Record<string, string | string[] | undefined>
): FiltrosVitrine {
  const um = (k: string): string | undefined => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const tipoBruto = (um("tipo") ?? "").trim().toLowerCase();
  const tipo =
    tipoBruto === "imovel" || tipoBruto === "veiculo" ? tipoBruto : null;

  let creditoMin = numeroOuNulo(um("credito_min"));
  let creditoMax = numeroOuNulo(um("credito_max"));
  if (creditoMin !== null && creditoMax !== null && creditoMin > creditoMax) {
    [creditoMin, creditoMax] = [creditoMax, creditoMin];
  }

  const adm = (um("adm") ?? "").trim();
  const custoMax = numeroOuNulo(um("custo_max"));

  return {
    ...FILTROS_VAZIOS,
    tipo,
    creditoMin,
    creditoMax,
    administradora: adm.length > 0 ? adm : null,
    custoMax: custoMax !== null && custoMax > 0 ? custoMax : null,
  };
}

export type ResultadoVitrine = {
  cartas: CartaVitrine[];
  /** Quantas cartas casaram com o filtro no banco — não quantas vieram. */
  total: number;
  /** `true` quando `total > TETO_TELA`: a tela precisa dizer isso em voz alta. */
  truncado: boolean;
};

const CAMPOS =
  "id,ref,tipo,credito,entrada,parcela,parcelas,custo_am,administradora";

/**
 * UMA consulta só, e não duas.
 *
 * A primeira versão fazia uma contagem `head:true` e depois a página, com os
 * filtros aplicados nos dois lugares por um helper genérico — que o `tsc`
 * derrubou com TS2589 (instanciação profunda demais contra o builder do
 * supabase). O erro de tipo foi útil: obrigou a olhar de novo e ver que a
 * segunda consulta nunca foi necessária. `count:"exact"` junto do `.range()` faz
 * o PostgREST devolver o total do FILTRO INTEIRO no `Content-Range`, ao lado das
 * 500 linhas da página.
 *
 * Ganho que importa mais que a latência: com uma consulta só, o total e a lista
 * não podem discordar. Em duas, bastaria uma carta ser reservada entre as duas
 * idas ao banco para a tela dizer "2.425 encontradas" mostrando 2.424 — e esse
 * tipo de defeito aparece uma vez a cada mil telas, que é quando ninguém acredita
 * em quem viu.
 */

/**
 * A consulta. Ordem: crédito desc (o fundo olha tamanho primeiro), com `id` como
 * desempate estável — sem ele, duas cartas de mesmo crédito podem trocar de
 * posição entre a contagem e a página, e a lista "pula" sem motivo visível.
 *
 * CUSTO NULO E O FILTRO DE CUSTO: medi 1 carta com `custo_am` nulo na vitrine
 * viva. Sem filtro de custo ela aparece — existe e é ofertável. COM filtro de
 * custo ela sai, porque não dá para afirmar que está abaixo de um teto que não
 * se sabe medir. O Postgres já faz isso sozinho (`null <= x` não é verdadeiro),
 * e fica registrado aqui que é o comportamento desejado, não um acidente.
 */
export async function buscarVitrine(
  filtros: FiltrosVitrine
): Promise<ResultadoVitrine> {
  const supabase = createXtvClient();

  let q = supabase.from("vw_vitrine_viva").select(CAMPOS, { count: "exact" });
  if (filtros.tipo) q = q.eq("tipo", filtros.tipo);
  if (filtros.creditoMin !== null) q = q.gte("credito", filtros.creditoMin);
  if (filtros.creditoMax !== null) q = q.lte("credito", filtros.creditoMax);
  if (filtros.custoMax !== null) q = q.lte("custo_am", filtros.custoMax);
  if (filtros.administradora) {
    q = q.ilike("administradora", `%${filtros.administradora}%`);
  }

  const { data, error, count } = await q
    .order("credito", { ascending: false })
    .order("id", { ascending: true })
    .range(0, TETO_TELA - 1);
  if (error) throw error;

  const total = count ?? 0;
  return {
    cartas: (data ?? []) as unknown as CartaVitrine[],
    total,
    truncado: total > TETO_TELA,
  };
}

/**
 * Quantos ids cabem numa ida ao banco.
 *
 * `.in("id", [...])` vira query string: cada UUID custa 37 caracteres mais a
 * vírgula. Com os 500 do teto da tela seriam ~19 KB de URL — acima do que
 * proxies e o próprio PostgREST aceitam sem cortar, e o corte apareceria como
 * "carta não encontrada" em cartas que existem. 100 por ida dá ~3,9 KB, com
 * folga de sobra, ao custo de no máximo 5 idas.
 */
export const LOTE_CONSULTA = 100;

/**
 * Parte o pedido em fatias que cabem numa URL.
 *
 * Exportada e separada da consulta por um motivo só: é a única aritmética aqui,
 * e é aritmética que erra em silêncio. Um `<=` no lugar do `<`, ou um `i += 1`
 * sobrevivente de um refactor, não estoura nada — devolve MENOS cartas do que
 * se pediu, e o efeito visível seria a oferta sair com 400 cartas quando o
 * operador marcou 500, com as 100 faltantes listadas como "saíram da vitrine".
 * Um erro que se disfarça de fato do mundo precisa de teste, e teste precisa de
 * função que rode sem banco.
 *
 * A garantia que o teste trava: a concatenação das fatias é exatamente a
 * entrada, na ordem, sem repetir e sem perder ninguém.
 */
export function fatiar<T>(itens: T[], tamanho = LOTE_CONSULTA): T[][] {
  if (tamanho < 1) throw new Error("tamanho de fatia tem de ser ao menos 1");
  const fatias: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    fatias.push(itens.slice(i, i + tamanho));
  }
  return fatias;
}

/**
 * Relê o crédito das cartas pedidas, DIRETO DA VITRINE VIVA, por id.
 *
 * É a peça central da honestidade da oferta. O painel manda ids e um
 * percentual; o valor de cada carta NUNCA vem do cliente. Se viesse, bastaria
 * um `fetch` na consola trocando `credito` para o fundo se comprometer com um
 * número que a casa não reconhece — e o compromisso é de 24 horas.
 *
 * Ler da VIEW, e não da tabela `cartas`, faz dobrar como conferência de
 * disponibilidade sem uma linha a mais: a `vw_vitrine_viva` só projeta o que
 * está de pé. Carta vendida, reservada ou removida entre a tela e o clique
 * simplesmente não volta — e quem chamou compara o que pediu com o que voltou
 * para dizer, nomeando, quais ficaram de fora.
 *
 * Devolve um Map para que a comparação seja por id, e não por posição: o
 * PostgREST não promete devolver na ordem em que se pediu, e casar por índice
 * seria trocar o crédito de uma carta pelo de outra em silêncio.
 */
export async function buscarCartasPorId(
  ids: string[]
): Promise<Map<string, CartaVitrine>> {
  const achadas = new Map<string, CartaVitrine>();
  if (ids.length === 0) return achadas;

  const supabase = createXtvClient();

  for (const fatia of fatiar(ids)) {
    const { data, error } = await supabase
      .from("vw_vitrine_viva")
      .select(CAMPOS)
      .in("id", fatia);
    if (error) throw error;
    for (const c of (data ?? []) as unknown as CartaVitrine[]) {
      achadas.set(c.id, c);
    }
  }

  return achadas;
}

/**
 * As cartas em que ESTE fundo já tem oferta viva (ativa e dentro da janela).
 *
 * Existe para a tela poder dizer "você já ofertou nesta" antes do clique. Sem
 * isso, o mesmo lote sairia duas vezes num dia movimentado e o cedente receberia
 * duas propostas do mesmo comprador — o que parece erro nosso, porque é.
 *
 * NÃO é uma trava: ofertar de novo é decisão do fundo (o preço pode ter mudado
 * de ideia). É um aviso. Trava sem ordem que a peça seria eu inventando regra.
 */
export async function cartasJaOfertadas(
  fundoId: string,
  agora: Date
): Promise<Set<string>> {
  const supabase = createXtvClient();

  const { data, error } = await supabase
    .from("fidc_ofertas")
    .select("id")
    .eq("fundo_id", fundoId)
    .eq("status", "ativa")
    .gt("expira_em", agora.toISOString());
  if (error) throw error;

  const ids = (data ?? []).map((o: { id: string }) => o.id);
  if (ids.length === 0) return new Set();

  const itens = await supabase
    .from("fidc_oferta_itens")
    .select("carta_id")
    .in("oferta_id", ids);
  if (itens.error) throw itens.error;

  return new Set(
    (itens.data ?? []).map((i: { carta_id: string }) => i.carta_id)
  );
}
