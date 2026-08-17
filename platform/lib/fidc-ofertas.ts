// ============================================================================
// FIDC-OFERTAS-01 — as REGRAS da oferta: janela, faixa e aritmética.
// ----------------------------------------------------------------------------
// AUTORIZADO: Emerson Gomes dos Santos — OS "FIDC-OFERTAS-01" (12/08/2026):
// "painel para fundo fazer ofertas ... em lote ... FIDC oferece deságio;
//  ofertas válidas 24 horas".
//
// EMENDA de 12/08/2026, mesma pessoa, mesmo dia:
// "a oferta é SEMPRE entre 20% (piso) e 35% (teto) DO VALOR DO CRÉDITO."
//
// Isto trocou a CONTA, não só um limite. Deságio dizia quanto se TIRA de uma
// base — `base × (1 − pct/100)` — e a base ainda estava por decidir. A regra
// nova diz quanto se PAGA do crédito: `valor_credito × pct/100`. A base parou
// de ser pergunta, então parou de ser parâmetro.
//
// ESTE ARQUIVO É O LUGAR DAS REGRAS DE OFERTA — as quatro (janela, piso, teto
// e, desde 13/08/2026, a comissão da casa) moram juntas de propósito. Uma
// constante de negócio sozinha num arquivo é uma constante que alguém redefine
// noutro canto sem saber que já existia.
//
// PRINCÍPIO: função pura. Entrada -> saída. Sem I/O, sem rede, sem `Date.now()`
// escondido — quem chama passa o instante. Um relógio implícito torna o teste
// de uma janela de 24 horas impossível de escrever sem esperar 24 horas.
//
// ----------------------------------------------------------------------------
// DOIS AVISOS DE NOME, medidos em 12/08/2026 antes de escrever este arquivo.
//
// (1) "FIDC" É PALAVRA PROIBIDA NO LINTER DA CASA.
//     `lib/lexico.ts` e `lib/ia.ts` trazem "fidc" na lista TERMOS_PROIBIDOS,
//     sob o título "mecânica interna (sigilo) — nunca verbalizar ao cliente".
//     `garantirLexico()` é a última barreira antes de qualquer texto sair da
//     plataforma, e o aviso por e-mail (/api/hooks/novo-cadastro) já passa por
//     ela. CONSEQUÊNCIA PRÁTICA: qualquer texto para CEDENTE ou FORNECEDOR que
//     escreva "FIDC" será recusado pela guarda — corretamente. Para essas
//     pessoas o nome é "o fundo", "oferta de compra". Identificador de código e
//     nome de tabela não passam pelo linter e continuam `fidc_*`, como a
//     coordenação decidiu; o que não pode é a sigla vazar para o texto.
//
// (2) "desconto" TAMBÉM É PROIBIDA; "deságio" NÃO É.
//     A ordem já mandava usar deságio. Fica registrado que o linter impõe isso
//     sozinho, então o erro seria pego — mas depois de escrito. Melhor não
//     escrever. Depois da emenda a palavra sai de cena por outro motivo: a
//     conta não é mais de deságio. Para quem vende, a frase honesta é "o fundo
//     paga X% do valor do crédito" — que é o que a tela deve dizer.
//
// Este arquivo NÃO é `lib/fidc-ancora.ts`. Aquele é outra coisa: o funding da
// operação byAncora, uso interno da equipe, atrás do gate @prospere.com.br.
// Mesma sigla, dois assuntos. Os nomes ficam distintos de propósito.
// ============================================================================

/** Kill-switch. Nasce desarmado: sem `FIDC_OFERTAS=on`, nada disto opera. */
export const ENV_KILL_SWITCH = "FIDC_OFERTAS";

export function ofertasLigado(): boolean {
  return process.env[ENV_KILL_SWITCH] === "on";
}

/**
 * A janela, em horas. FONTE ÚNICA da verdade.
 *
 * Vive aqui, e não no banco, por medição: `timestamptz + interval` é STABLE no
 * Postgres, e coluna gerada exige expressão IMMUTABLE — `expira_em` não pode
 * ser calculada pelo banco (ver 0078_fidc_ofertas.sql, desvio (b)). Como o
 * banco não pode garantir, alguém precisa; é esta constante, num lugar só.
 */
export const JANELA_OFERTA_HORAS = 24;

const MS_POR_HORA = 3_600_000;

/**
 * A palavra que o operador do fundo digita para MANDAR a oferta.
 *
 * Palavra PRÓPRIA, e não a PALAVRA_PUBLICAR do FAROL, pela mesma razão que
 * `lib/farol/confirmacao.ts` já registra ao separar PUBLICAR de APROVAR: o
 * reflexo treinado numa tela não pode servir na outra. Aqui a ação nem sequer
 * é publicar — é assumir um compromisso de compra de 24 horas.
 *
 * Por que existe confirmação nominal AQUI, se o painel de vozes dispensou:
 * lá era GET puro. Aqui, medido no acervo vivo em 12/08/2026, a vitrine soma
 * R$ 420.493.818,53; um "selecionar tudo" no piso de 20% é uma oferta de
 * R$ 84.098.763,71. Clique de reflexo não pode alcançar esse número.
 *
 * Mora neste módulo, e não num arquivo só dela, porque este é o arquivo das
 * REGRAS DA OFERTA e ele não importa nada — atravessa a fronteira
 * servidor/cliente sem arrastar dependência, então o botão e a rota leem a
 * MESMA linha. Palavra repetida à mão nos dois lados é a divergência do dia em
 * que alguém troca um dos dois.
 *
 * Não é segredo e não pode virar um: aparece na tela, no botão e no texto do
 * erro. Quem autentica é `checarFundoApi()`; esta palavra só impede o reflexo.
 */
export const PALAVRA_OFERTAR = "OFERTAR";

/**
 * A FAIXA. Emerson, 12/08/2026: "a oferta é SEMPRE entre 20% (piso) e 35%
 * (teto) DO VALOR DO CRÉDITO."
 *
 * Ambos INCLUSIVOS: 20 vale, 35 vale. A ordem diz "entre 20 e 35" nomeando os
 * dois números como piso e teto — um piso que recusa o próprio piso não é
 * piso. E o CHECK do banco (`fidc_ofertas_faixa_20_35_do_credito`) usa `>=` e
 * `<=`, então as duas guardas concordam. Duas guardas que discordam na borda
 * produzem o pior defeito possível: a tela aceita e o banco recusa.
 */
export const OFERTA_PISO_PCT = 20;
export const OFERTA_TETO_PCT = 35;

/** Quando uma oferta criada em `criadoEm` expira. */
export function expiraEm(criadoEm: Date): Date {
  return new Date(criadoEm.getTime() + JANELA_OFERTA_HORAS * MS_POR_HORA);
}

/**
 * Quanto falta, em milissegundos. Nunca negativo — passado é 0, não dívida.
 * O contador da tela lê daqui.
 */
export function restanteMs(expira: Date, agora: Date): number {
  return Math.max(0, expira.getTime() - agora.getTime());
}

export type StatusOferta =
  | "ativa"
  | "aceita_parcial"
  | "aceita"
  | "expirada"
  | "retirada";

/**
 * Expiração verificada NA LEITURA, como a ordem manda ("sem cron novo").
 *
 * Só 'ativa' pode virar 'expirada' pela passagem do tempo. Uma oferta aceita
 * não desexpira nem expira: o aceite já aconteceu, e o relógio não desfaz ato
 * de ninguém. Retirada idem.
 *
 * O limite é `>=`: no instante exato de `expira_em` a oferta JÁ MORREU. Numa
 * janela de 24 horas o milissegundo empatado não muda dinheiro, mas muda a
 * resposta à pergunta "estava válida?" — e essa pergunta merece uma resposta
 * só.
 */
export function statusEfetivo(
  status: StatusOferta,
  expira: Date,
  agora: Date
): StatusOferta {
  if (status !== "ativa") return status;
  return agora.getTime() >= expira.getTime() ? "expirada" : "ativa";
}

/** Arredonda para centavos. O `EPSILON` cobre o 0,1+0,2 do ponto flutuante. */
function centavos(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

export type Veredito = { ok: true } | { ok: false; motivo: string };

/**
 * A guarda de aplicação da faixa. Roda ANTES do insert.
 *
 * Devolve MOTIVO, não booleano, porque quem digitou 18 precisa ler "abaixo do
 * piso de 20%", não "inválido". O CHECK do banco é a rede — pega rota nova,
 * script e console —, mas erro de constraint chega em inglês, com nome de
 * tabela, e não é texto que se mostre a uma pessoa.
 *
 * O motivo passa pelo léxico da casa: nomeia o piso e o teto, e nunca a sigla.
 */
export function checarPct(pct: number): Veredito {
  if (!Number.isFinite(pct)) {
    return { ok: false, motivo: "percentual da oferta não é um número" };
  }
  if (pct < OFERTA_PISO_PCT) {
    return {
      ok: false,
      motivo:
        `oferta de ${pct}% do valor do crédito fica abaixo do piso de ` +
        `${OFERTA_PISO_PCT}%`,
    };
  }
  if (pct > OFERTA_TETO_PCT) {
    return {
      ok: false,
      motivo:
        `oferta de ${pct}% do valor do crédito passa do teto de ` +
        `${OFERTA_TETO_PCT}%`,
    };
  }
  return { ok: true };
}

/**
 * Quanto o fundo paga por uma carta: `valorCredito × pct/100`.
 *
 * `pct` em pontos percentuais (27,5 = 27,5%), sempre SOBRE O VALOR DO CRÉDITO.
 * Não existe parâmetro de base: a base não é escolha (emenda de 12/08).
 *
 * Devolve `null` quando a entrada não permite uma resposta honesta — crédito
 * não positivo ou percentual fora da faixa. Nunca devolve 0 por falta de dado:
 * zero é um número, e número mente calado. Crédito zero também é recusado, e
 * não aceito com resultado zero, pelo mesmo motivo.
 */
export function valorOfertado(
  valorCredito: number,
  pct: number
): number | null {
  if (!Number.isFinite(valorCredito) || valorCredito <= 0) return null;
  if (!checarPct(pct).ok) return null;
  return centavos(valorCredito * (pct / 100));
}

/**
 * A COMISSÃO DA BIDCON no caminho do fundo: 7% DO VALOR DO CRÉDITO, pagos PELO
 * FUNDO, SOMADOS POR CIMA da oferta.
 *
 * ============================================================================
 * ESTA CONSTANTE JÁ VALEU 3,5. O HISTÓRICO FICA AQUI — não some.
 * ============================================================================
 * 13/08/2026 — Emerson: "comissao 3,5% do credito quando fundo faz e coloca na
 *   platforma mantem os 7". Gravado no commit `5e72373`. O raciocínio era por
 *   ESFORÇO: o fundo compra em lote, a casa trabalha menos por carta, logo
 *   metade.
 *
 * 15/08/2026 — Emerson, DECISÃO ②, que SUBSTITUI a de 13/08: "a comissão da
 *   Bidcon no fluxo do fundo é 7% DO VALOR DO CRÉDITO da carta, paga PELO
 *   FUNDO, somada por cima da oferta. Mesma regra da vitrine — um só modelo de
 *   comissão do lado do comprador, seja ele pessoa ou fundo." O raciocínio é
 *   por MODELO: existe UM SÓ PREÇO do lado do comprador.
 *
 * POR QUE O SEGUNDO PREVALECEU, por uma razão que este código já ensina em
 * outros lugares: DUAS COMISSÕES PARA O MESMO LADO DA MESA DIVERGEM NA
 * PRIMEIRA EDIÇÃO DE UMA SÓ. É o mesmo defeito dos dois leitores, aplicado a
 * dinheiro — alguém corrige o percentual da vitrine, não corrige o do fundo, e
 * a casa passa a cobrar dois preços sem que ninguém tenha decidido cobrar dois
 * preços.
 *
 * E O ARGUMENTO DE 13/08 CONTINUA VERDADEIRO — só não conclui o que concluía.
 * A Bidcon de fato não põe capital de aquisição nenhum, e isso justifica a
 * Bidcon NÃO COMPRAR CARTA. Não justifica cobrar menos de quem compra.
 *
 * ----------------------------------------------------------------------------
 * BASE: o VALOR DO CRÉDITO — a mesma base da oferta, e a mesma base dos 7% do
 * caminho da vitrine. Três números sobre uma base só é o que torna a decisão
 * conferível de cabeça.
 *
 * O QUE SÃO "OS 7", medido antes de escrever isto (13/08/2026), porque eu
 * supunha outra coisa e estava errado:
 *   - `app/api/analista-grupos/route.ts:248` → `credito * 0.07`, e a linha 59
 *     chama de "regra canônica": em contemplada o cliente paga 7% DO CRÉDITO
 *     à Bidcon, SOMADOS À ENTRADA. Em venda nova não existe.
 *   - `lib/playcontempladas-source.ts:44` → `MARGEM_CREDITO = 0.07`, somado à
 *     entrada crua do parceiro antes de exibir.
 *   NÃO é o fee de `lib/reserve/fee-plan.ts` (10% contemplada / 6% cancelada,
 *   piso R$ 2.500) — aquele é o Modelo B, incide sobre o ÁGIO e é outro fluxo.
 *   Os dois coexistem hoje e continuam coexistindo; esta constante não toca
 *   neles. O caminho do fundo é MODELO A, o mesmo da vitrine.
 *
 * Quem paga os 7% é o COMPRADOR, por cima da entrada. Aqui, quem compra é o
 * fundo — e é exatamente por isso que o número é o mesmo.
 */
export const COMISSAO_FUNDO_PCT = 7;

/**
 * O NOME DO MODELO que produziu a comissão, gravado em `fidc_ofertas.
 * comissao_base` junto do valor. Guardar o nome ao lado do número é o que
 * permite auditar uma oferta antiga sob um modelo que já mudou — e este
 * arquivo acaba de provar que modelo muda.
 *
 * SE O PERCENTUAL MUDAR, ESTE NOME MUDA JUNTO. Há teste prendendo o par: o
 * nome tem de conter o número. Um nome que sobrevive à troca do percentual é
 * pior que nome nenhum — ele afirma, com todas as letras, um modelo que não
 * foi o aplicado.
 */
export const COMISSAO_FUNDO_BASE = "credito_7pct";

/**
 * ============================================================================
 * A INCIDÊNCIA — DECIDIDA EM 15/08/2026. A COMISSÃO ENTRA POR CIMA.
 * ============================================================================
 * Em 13/08 esta pergunta estava aberta neste mesmo lugar, com duas leituras:
 * (A) a comissão sai do meio e o cedente recebe menos que o piso; (B) a
 * comissão entra por cima e o fundo desembolsa mais que o teto. A DECISÃO ②
 * escolheu (B), com todas as letras:
 *
 *   "O CEDENTE RECEBE A OFERTA CHEIA. A comissão não sai do meio. O piso de
 *    20% continua sendo o que o cedente recebe — que é a razão de ele existir."
 *
 * E resolveu, junto, a objeção que a leitura (B) carregava — o desembolso
 * passar de 35%:
 *
 *   "A constraint de 20–35% continua governando a OFERTA, não o desembolso."
 *
 * Ou seja: a faixa 20–35 nunca foi sobre o custo do fundo. É sobre o que quem
 * vende recebe. O CHECK `fidc_ofertas_faixa_20_35_do_credito` incide sobre
 * `oferta_pct_credito` e continua correto sem uma linha de migração.
 *
 * A CONTA, com os números do próprio Emerson:
 *
 *   crédito              R$ 200.000,00
 *   oferta   20%   →     R$  40.000,00   ← o cedente recebe ISTO, cheio
 *   comissão  7%   →     R$  14.000,00   ← do fundo para a Bidcon, por cima
 *   ────────────────────────────────────
 *   desembolso     →     R$  54.000,00   = 27% do crédito
 *
 * No teto, 35% + 7% = 42% do crédito. É o custo do fundo, e ele é MOSTRADO na
 * tela, decomposto — "somar sem mostrar seria esconder o que o fundo vai
 * perguntar de qualquer jeito".
 *
 * PROPORÇÃO, para quem for ler um lote: como comissão e oferta dividem a mesma
 * base, a comissão vale `7/pct` da oferta — 35% dela no piso de 20% e 20% dela
 * no teto de 35%. Quanto mais barato o fundo compra, mais pesada ela é sobre o
 * dinheiro que muda de mão.
 */
export const COMISSAO_FUNDO_INCIDENCIA = "por_cima_da_oferta" as const;

/**
 * A comissão da casa por carta: `valorCredito × 7/100`.
 *
 * `null` em crédito não positivo, pelo mesmo motivo de `valorOfertado`: zero é
 * um número e número mente calado. Não recebe `pct` de propósito — a comissão
 * não varia com o percentual ofertado, e um parâmetro que não muda a resposta
 * é um convite a passar o valor errado.
 */
export function comissaoFundo(valorCredito: number): number | null {
  if (!Number.isFinite(valorCredito) || valorCredito <= 0) return null;
  return centavos(valorCredito * (COMISSAO_FUNDO_PCT / 100));
}

export type ItemCalculado = {
  cartaId: string;
  valorCredito: number;
  /**
   * O QUE O CEDENTE RECEBE, cheio. A comissão não sai daqui — decisão ② de
   * 15/08/2026. Este é o número que a tela promete a quem vende, e é sobre ele
   * que incide a faixa de 20–35%.
   */
  valorOfertado: number;
  /** 7% do crédito, do fundo para a Bidcon. Por cima, nunca do meio. */
  comissao: number;
  /** O QUE O FUNDO DESEMBOLSA: `valorOfertado + comissao`. */
  desembolso: number;
};

export type TotalLote = {
  itens: ItemCalculado[];
  /**
   * Soma das OFERTAS já arredondadas — ver nota abaixo. É o que os cedentes
   * recebem, somado, e é o que a faixa 20–35 governa.
   *
   * NÃO é o custo do fundo. Quem quiser mostrar "quanto isto me custa" tem de
   * usar `totalDesembolso`, e a tela mostra os três lado a lado exatamente
   * para que ninguém confunda um com o outro.
   */
  total: number;
  /** Soma das comissões já arredondadas. */
  totalComissao: number;
  /** Soma dos desembolsos já arredondados — o que o fundo paga. */
  totalDesembolso: number;
  /** Cartas que ficaram de fora, com o motivo. Nunca somem em silêncio. */
  descartadas: { cartaId: string; motivo: string }[];
  /**
   * Erro do LOTE INTEIRO — hoje, só percentual fora da faixa. `null` = a faixa
   * está boa.
   *
   * Separado de `descartadas` porque são erros de naturezas diferentes e a tela
   * tem de dizer coisas diferentes. "Estas 3 cartas não têm valor de crédito" é
   * um problema das cartas. "Você pediu 18%" é um problema do que a pessoa
   * digitou — e listar as 40 cartas como descartadas por causa disso jogaria a
   * culpa no acervo e esconderia o campo que ela precisa corrigir.
   */
  recusa: string | null;
};

/**
 * Monta o lote: valor carta a carta e os três totais.
 *
 * TRÊS TOTAIS, e não um. A oferta (o que os cedentes recebem), a comissão (o
 * que a casa cobra do fundo) e o desembolso (o que o fundo paga). Devolver só
 * a soma das ofertas — como este arquivo fazia enquanto a incidência estava em
 * aberto — obrigaria cada tela a refazer a conta do custo do fundo por conta
 * própria, e a primeira que errasse erraria em silêncio.
 *
 * Cada total é a soma dos itens JÁ ARREDONDADOS, não o arredondamento da soma.
 * A diferença é de centavos e é exatamente por isso que importa: o total é o
 * número que o fundo aprova, e cada item é o número que um vendedor recebe. Se
 * o total fosse calculado por fora, a soma do que as pessoas recebem não
 * fecharia com o que o fundo autorizou, e alguém ficaria devendo centavos que
 * ninguém sabe explicar.
 *
 * Carta sem base utilizável não vira oferta de R$ 0 — sai da lista e aparece em
 * `descartadas`, nomeada. A tela precisa dizer "estas 3 ficaram de fora e por
 * quê", não entregar um lote silenciosamente menor.
 */
export function montarLote(
  cartas: { id: string; valorCredito: number | null }[],
  pct: number
): TotalLote {
  // Percentual fora da faixa recusa o lote inteiro, de uma vez e por seu nome.
  // Antes de olhar carta nenhuma: nada aqui pode ser calculado com um
  // percentual que não vale.
  const veredito = checarPct(pct);
  if (!veredito.ok) {
    return {
      itens: [],
      total: 0,
      totalComissao: 0,
      totalDesembolso: 0,
      descartadas: [],
      recusa: veredito.motivo,
    };
  }

  const itens: ItemCalculado[] = [];
  const descartadas: { cartaId: string; motivo: string }[] = [];

  for (const c of cartas) {
    if (
      c.valorCredito === null ||
      !Number.isFinite(c.valorCredito) ||
      c.valorCredito <= 0
    ) {
      descartadas.push({ cartaId: c.id, motivo: "sem valor de crédito" });
      continue;
    }
    const v = valorOfertado(c.valorCredito, pct);
    const com = comissaoFundo(c.valorCredito);
    if (v === null || com === null) {
      // Guarda de cinto e suspensório: com a faixa já conferida e o crédito
      // já positivo, não há caminho conhecido até aqui. Se um dia houver,
      // a carta sai nomeada em vez de virar oferta de valor errado.
      descartadas.push({ cartaId: c.id, motivo: "valor de crédito inválido" });
      continue;
    }
    itens.push({
      cartaId: c.id,
      valorCredito: c.valorCredito,
      valorOfertado: v,
      comissao: com,
      // Soma de dois valores JÁ arredondados a centavo — nunca
      // `centavos(credito * (pct+7)/100)`. Se o desembolso fosse calculado por
      // fora, ele poderia diferir em um centavo da conta que a tela mostra
      // decomposta, e seria a conta decomposta que a pessoa conferiria.
      desembolso: centavos(v + com),
    });
  }

  const total = centavos(itens.reduce((s, i) => s + i.valorOfertado, 0));
  const totalComissao = centavos(itens.reduce((s, i) => s + i.comissao, 0));
  const totalDesembolso = centavos(itens.reduce((s, i) => s + i.desembolso, 0));
  return { itens, total, totalComissao, totalDesembolso, descartadas, recusa: null };
}
