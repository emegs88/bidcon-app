// ============================================================================
// FIDC-OFERTAS-01 — núcleo PURO: janela, expiração e aritmética do deságio.
// ----------------------------------------------------------------------------
// AUTORIZADO: Emerson Gomes dos Santos — OS "FIDC-OFERTAS-01" (12/08/2026):
// "painel para fundo fazer ofertas ... em lote ... FIDC oferece deságio;
//  ofertas válidas 24 horas".
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
//     escrever.
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

/**
 * Quanto o fundo paga por uma carta.
 *
 * `desagioPct` em pontos percentuais (12,5 = 12,5%), sobre `valorBase` — e a
 * BASE é nomeada em `fidc_ofertas.desagio_base`, decisão ainda aberta do
 * Emerson. Esta função não escolhe a base; recebe o número já escolhido.
 *
 * Devolve `null` quando a entrada não permite uma resposta honesta (base
 * negativa, percentual fora de 0–100, valor não finito). Nunca devolve 0 por
 * falta de dado: zero é um número, e número mente calado.
 */
export function valorOfertado(
  valorBase: number,
  desagioPct: number
): number | null {
  if (!Number.isFinite(valorBase) || valorBase < 0) return null;
  if (!Number.isFinite(desagioPct) || desagioPct <= 0 || desagioPct >= 100) {
    return null;
  }
  return centavos(valorBase * (1 - desagioPct / 100));
}

export type ItemCalculado = {
  cartaId: string;
  valorBase: number;
  valorOfertado: number;
};

export type TotalLote = {
  itens: ItemCalculado[];
  /** Soma dos itens JÁ arredondados — ver nota abaixo. */
  total: number;
  /** Cartas que ficaram de fora, com o motivo. Nunca somem em silêncio. */
  descartadas: { cartaId: string; motivo: string }[];
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
  cartas: { id: string; valorBase: number | null }[],
  desagioPct: number
): TotalLote {
  const itens: ItemCalculado[] = [];
  const descartadas: { cartaId: string; motivo: string }[] = [];

  for (const c of cartas) {
    if (c.valorBase === null || !Number.isFinite(c.valorBase)) {
      descartadas.push({ cartaId: c.id, motivo: "sem valor de base" });
      continue;
    }
    const v = valorOfertado(c.valorBase, desagioPct);
    if (v === null) {
      descartadas.push({ cartaId: c.id, motivo: "base ou deságio inválido" });
      continue;
    }
    itens.push({ cartaId: c.id, valorBase: c.valorBase, valorOfertado: v });
  }

  const total = centavos(itens.reduce((s, i) => s + i.valorOfertado, 0));
  return { itens, total, descartadas };
}
