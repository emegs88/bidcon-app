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
 * A COMISSÃO DA BIDCON no caminho do fundo. Emerson, 13/08/2026:
 * "comissao 3,5% do credito quando fundo faz e coloca na platforma mantem os 7".
 *
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
 *   piso R$ 2.500) — aquele incide sobre o ÁGIO e é outro fluxo. Os dois
 *   coexistem hoje e continuam coexistindo; esta constante não toca neles.
 *
 * Quem paga os 7% é o COMPRADOR, por cima da entrada. Aqui, quem compra é o
 * fundo — e é justamente aí que mora a pergunta ainda em aberto, abaixo.
 *
 * PROPORÇÃO: 3,5 é metade de 7, sobre a mesma base. Por carta, o caminho do
 * fundo rende à casa exatamente metade do caminho da vitrine. Coerente com o
 * que a ordem já dizia — o fundo compra em lote e a Bidcon não põe capital de
 * aquisição nenhum.
 */
export const COMISSAO_FUNDO_PCT = 3.5;

/**
 * ============================================================================
 * EM ABERTO — DE QUEM SAI A COMISSÃO. NÃO DECIDIDO EM 13/08/2026.
 * ============================================================================
 * A ordem fixou o percentual e a base. Não disse a INCIDÊNCIA, e as duas
 * leituras possíveis brigam com a emenda dos 20–35%. Em crédito de R$ 100.000
 * com oferta no piso de 20% (R$ 20.000) e comissão de R$ 3.500:
 *
 *   (A) sai do meio — o cedente recebe R$ 16.500.
 *       O fundo desembolsa os 20% combinados, mas quem vende recebe 16,5% do
 *       crédito. O piso de 20% deixa de ser piso PARA QUEM VENDE, e é para
 *       quem vende que a tela promete o número.
 *
 *   (B) entra por cima — o fundo desembolsa R$ 23.500.
 *       O cedente recebe os 20% inteiros, mas o custo real do fundo vira 23,5%
 *       do crédito; no teto, 38,5%. A emenda diz "SEMPRE entre 20% e 35% DO
 *       VALOR DO CRÉDITO", e 38,5% não está entre 20 e 35.
 *
 * Nenhuma das duas preserva ao mesmo tempo o piso como "o que o cedente
 * recebe" e o teto como "o que o fundo paga". É decisão de negócio, não de
 * engenharia, e chutar aqui seria inventar dinheiro de terceiro.
 *
 * POR ISSO `montarLote` NÃO SOMA NEM SUBTRAI COMISSÃO. O total que ele devolve
 * é o que a emenda define: a soma de `valor_credito × pct/100`. Enquanto a
 * incidência não for decidida, um total "com comissão" seria um número que a
 * ordem não autoriza — e é o número que o fundo aprova na tela.
 *
 * Nota de proporção, para a decisão: como comissão e oferta dividem a mesma
 * base, a comissão vale `3,5/pct` da oferta — 17,5% dela no piso de 20% e 10%
 * dela no teto de 35%. Quanto mais barato o fundo compra, mais pesada ela é
 * sobre o dinheiro que muda de mão.
 */
export const COMISSAO_FUNDO_INCIDENCIA_DECIDIDA = false;

/**
 * A comissão da casa por carta: `valorCredito × 3,5/100`.
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
  valorOfertado: number;
};

export type TotalLote = {
  itens: ItemCalculado[];
  /** Soma dos itens JÁ arredondados — ver nota abaixo. */
  total: number;
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
 * Monta o lote: valor carta a carta e o total.
 *
 * O total é a soma dos itens JÁ ARREDONDADOS, não o arredondamento da soma.
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
    return { itens: [], total: 0, descartadas: [], recusa: veredito.motivo };
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
    if (v === null) {
      // Guarda de cinto e suspensório: com a faixa já conferida e o crédito
      // já positivo, não há caminho conhecido até aqui. Se um dia houver,
      // a carta sai nomeada em vez de virar oferta de valor errado.
      descartadas.push({ cartaId: c.id, motivo: "valor de crédito inválido" });
      continue;
    }
    itens.push({ cartaId: c.id, valorCredito: c.valorCredito, valorOfertado: v });
  }

  const total = centavos(itens.reduce((s, i) => s + i.valorOfertado, 0));
  return { itens, total, descartadas, recusa: null };
}
