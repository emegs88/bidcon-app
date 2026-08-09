// ============================================================================
// lib/data-br.ts — datas e horas no fuso de São Paulo, em UM lugar só
// ----------------------------------------------------------------------------
// AUTORIZADO: Emerson Gomes dos Santos — OS "PAINEL: horários em
// America/Sao_Paulo", 09/08/2026, a partir de duas provas medidas por ele na
// tela:
//   · `post_publicado` de 08/08 mostrava "14:00". Foi às 11h00 BRT — 14:00Z.
//   · `reel_destravado` mostrava "12:12". Foi às 09h12 BRT — 12:12Z.
//
// A CAUSA, e por que ela é invisível no desenvolvimento. `toLocaleString("pt-BR")`
// tem DOIS eixos independentes, e é fácil confundi-los:
//   · o LOCALE ("pt-BR") decide o FORMATO — dia/mês/ano, vírgula, 24h;
//   · o timeZone decide o INSTANTE — e, quando omitido, ele NÃO vem do locale:
//     vem do relógio do processo.
// Escrever "pt-BR" e nada mais produz um horário com aparência brasileira e
// instante do servidor. Na máquina de quem desenvolve o servidor está em BRT e
// tudo parece certo; na Vercel o processo roda em UTC e a tela passa a mentir
// três horas para frente, sem erro, sem log, sem nada quebrar. É a pior classe
// de defeito de tela: o número continua plausível.
//
// POR QUE UM MÓDULO, E NÃO UM `timeZone` A MAIS NA FUNÇÃO DA TELA. Porque a
// omissão é o estado natural — quem escrever a próxima tela vai chamar
// `toLocaleString("pt-BR", { ... })` de novo, que é o que qualquer um escreve, e
// o defeito volta. Com o formatador pronto aqui, o caminho curto passa a ser o
// caminho certo. As funções abaixo NÃO aceitam fuso por parâmetro de propósito:
// não existe tela nossa que deva mostrar hora em outro fuso, e um parâmetro
// opcional seria só um jeito novo de esquecer.
//
// O FUSO É FIXO E ISSO É DECISÃO, NÃO PREGUIÇA. `America/Sao_Paulo` está
// escrito literalmente, e não lido de env: o negócio é em São Paulo, a operação
// é em São Paulo, e o operador que lê o painel quer o relógio da parede dele.
// Um env aqui só criaria um jeito de a produção divergir da preview.
//
// HORÁRIO DE VERÃO. O Brasil não tem mais desde 2019, mas o `Intl` conhece o
// histórico: uma data de 2018 é convertida com −02:00 e uma de hoje com −03:00,
// automaticamente. Nada aqui precisa saber disso — é justamente o motivo de
// usar `Intl` em vez de subtrair três horas na mão. Há um teste travando isso,
// porque "subtrair 3h" é exatamente o atalho que alguém tentaria depois.
// ============================================================================

/** O fuso da operação. Fixo — ver o cabeçalho. */
export const TZ_BR = "America/Sao_Paulo";

// Formatadores são caros de construir e imutáveis depois de prontos: um por
// formato, no módulo, em vez de um por linha renderizada da tabela.
const FMT_DATA_HORA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ_BR,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const FMT_DATA_HORA_ANO = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ_BR,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const FMT_DATA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ_BR,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const FMT_DIA_ISO = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ_BR,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Aceita o que as telas realmente têm em mãos e devolve `null` no que não é
 * data. Timestamp do Supabase chega como string ISO; `Date` chega dos cálculos;
 * `number` chega de `Date.now()`. Data inválida vira `null` aqui, uma vez, em
 * vez de virar "Invalid Date" espalhado por cinco telas.
 */
function paraData(v: string | number | Date | null | undefined): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * "08/08, 11:00" — dia, mês e hora no relógio de São Paulo.
 *
 * É o formato que o painel do FAROL já usava; o que mudou foi o instante. Sem
 * data (ou com data inválida) devolve o travessão, que é o que a tabela mostra
 * numa coluna vazia.
 */
export function dataHoraBR(v: string | number | Date | null | undefined): string {
  const d = paraData(v);
  return d ? FMT_DATA_HORA.format(d) : "—";
}

/**
 * "08/08/2026, 11:00" — o mesmo instante, com o ANO.
 *
 * Existe porque as telas de /admin fora do FAROL (revisão, audit-logs, as
 * quatro de conversas) mostram registros que podem ser de meses atrás, onde
 * "08/08" sozinho é ambíguo. O painel do FAROL olha uma janela de 14 dias e
 * por isso dispensa o ano — são dois formatos legítimos, não um descuido.
 *
 * Todas essas telas tinham EXATAMENTE o mesmo defeito do painel: uma função
 * `dataHora` local chamando `toLocaleString("pt-BR", {...})` sem `timeZone`.
 * São todas server components, então todas as seis mostravam UTC em produção —
 * o mesmo erro de três horas que o Emerson mediu no FAROL, na tela de conversas
 * e na de audit-logs também.
 */
export function dataHoraAnoBR(v: string | number | Date | null | undefined): string {
  const d = paraData(v);
  return d ? FMT_DATA_HORA_ANO.format(d) : "—";
}

/** "08/08/2026" — só a data civil, no relógio de São Paulo. */
export function dataBR(v: string | number | Date | null | undefined): string {
  const d = paraData(v);
  return d ? FMT_DATA.format(d) : "—";
}

/**
 * "2026-08-08" — a DATA CIVIL de São Paulo em formato ordenável.
 *
 * Existe para substituir `iso.slice(0, 10)`, que é o atalho que parece
 * inofensivo e não é: `slice` corta a data em UTC. Um evento das 22h de 07/08
 * em São Paulo tem `criado_em` = "2026-08-08T01:00:00Z", e o `slice` o agrupa
 * no dia 08 — o operador procura no dia errado o que ele mesmo fez ontem à
 * noite. Toda chave de agrupamento por dia e todo corte de coluna `date` do
 * FAROL passam por aqui, porque o resto do FAROL já grava a data civil de São
 * Paulo (`hojeSP()` em lib/farol/selecao.ts) e as duas têm que casar.
 */
export function diaBR(v: string | number | Date | null | undefined): string | null {
  const d = paraData(v);
  if (!d) return null;
  // `formatToParts` em vez de confiar que "en-CA" devolve YYYY-MM-DD: o formato
  // do locale é detalhe de implementação do ICU, e a ordem aqui é contrato.
  const p = FMT_DIA_ISO.formatToParts(d);
  const parte = (t: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === t)?.value ?? "";
  return `${parte("year")}-${parte("month")}-${parte("day")}`;
}
