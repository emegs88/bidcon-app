// ============================================================================
// lib/farol/reel-texto.ts — o roteiro falado e a legenda do reel
// AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-REEL-01", 06/08/2026.
// ----------------------------------------------------------------------------
// DOIS TEXTOS, DUAS NATUREZAS. O roteiro vai para um TTS: é OUVIDO. A legenda
// vai para o Instagram: é LIDA. O mesmo número se escreve diferente nos dois, e
// é por isso que este arquivo existe separado do template do feed.
//
// "R$ 250.000,00" LIDO EM VOZ ALTA É UM RISCO REAL. Dependendo do motor, sai
// "erre cifrão duzentos e cinquenta ponto zero zero zero" ou os dígitos um a um.
// Então o roteiro NÃO usa `reais()`: usa `valorFalado()`, que escreve o número
// por extenso na estrutura do português — "250 mil reais", "1 milhão e 250 mil
// reais", "3 mil e 500 reais". Qualquer TTS lê isso certo, porque já está na
// forma em que a língua fala.
//
// ARREDONDAMENTO, DECLARADO: `valorFalado` arredonda para o real inteiro. Uma
// parcela de R$ 3.499,87 é falada como "3 mil e 500 reais" — 13 centavos acima.
// Aceito e declarado porque (a) os centavos não são audíveis como informação,
// (b) o número EXATO está na legenda e na página da carta, que é onde a pessoa
// decide, e (c) arredondar para cima em PARCELA nunca subestima o custo, que é
// o lado seguro do erro.
//
// O CUSTO FALADO É DERIVADO DO CANÔNICO, NÃO REESCRITO. `custoFalado()` pega o
// que `pctAoMes()` produz ("0,65% a.m.") e troca o sufixo por " por cento ao
// mês". Escrever o número duas vezes, em duas funções, é como o falado e o
// escrito divergem com o tempo. Derivando, é impossível divergir.
//
// COMPLIANCE (CLAUDE.md): o custo aparece SEMPRE como taxa ao mês — "% a.m." no
// escrito, "por cento ao mês" no falado, que é a MESMA regra dita na forma de
// cada meio. Nunca "investimento", "rendimento", "lucro", "CDI". Nenhuma
// promessa nem data de contemplação: o roteiro fala de carta JÁ contemplada e
// para por aí. A Conta Notarial é descrita como ela é, sem "risco zero".
// `revisarLegenda()` (lib/farol/selecao.ts) mede os dois textos antes de sair.
//
// O ROTEIRO É O TEMPLATE LITERAL DA OS, com os campos preenchidos. Não
// reescrevi, não "melhorei" e não variei: a variação criativa é a fatia do
// FAROL-CRIATIVO (pauta por IA), que ainda não existe e nasce desarmada. Esta
// fatia é determinística de ponta a ponta.
// ============================================================================
import { reais, pctAoMes, type CartaCarrossel } from "@/lib/carrossel-formato";

/**
 * Valor em reais na forma que se FALA. Exato até o real (ver header):
 *   250000  -> "250 mil reais"
 *   1250000 -> "1 milhão e 250 mil reais"
 *   255300  -> "255 mil e 300 reais"
 *   890     -> "890 reais"
 */
export function valorFalado(n: number): string {
  const v = Math.round(n);
  if (!Number.isFinite(v) || v <= 0) return "zero reais";

  const milhoes = Math.floor(v / 1_000_000);
  const resto = v % 1_000_000;
  const milhares = Math.floor(resto / 1000);
  const unidades = resto % 1000;

  const partes: string[] = [];
  if (milhoes > 0) partes.push(`${milhoes} ${milhoes === 1 ? "milhão" : "milhões"}`);
  if (milhares > 0) partes.push(`${milhares} mil`);
  if (unidades > 0) partes.push(String(unidades));

  return `${partes.join(" e ")} reais`;
}

/** "0,65% a.m." -> "0,65 por cento ao mês". Derivado do canônico — ver header. */
export function custoFalado(custoAm: number | null): string {
  return pctAoMes(custoAm).replace("% a.m.", " por cento ao mês");
}

/**
 * Roteiro do reel — template LITERAL da OS. ~30-35s de fala.
 * Campos ausentes (entrada zerada, sem parcelamento) somem da frase em vez de
 * virarem "zero reais": um porta-voz que anuncia "entrada de zero reais" soa
 * como erro, e a carta sem entrada é justamente a boa notícia.
 */
export function montarRoteiro(c: CartaCarrossel): string {
  const numeros: string[] = [`crédito de ${valorFalado(c.credito)}`];
  if (c.entrada > 0) numeros.push(`entrada de ${valorFalado(c.entrada)}`);
  if (c.parcelas > 0 && c.parcela > 0) {
    numeros.push(`${c.parcelas} parcelas de ${valorFalado(c.parcela)}`);
  }

  return [
    // RÓTULO-IA revertido na FALA (07/08, ~11h50, ordem do Emerson depois de
    // assistir ao render: "não precisa falar que é uma IA"). A declaração comia
    // os 3 primeiros segundos, que é onde a retenção do reel se decide.
    //
    // O rótulo NÃO foi abandonado — só saiu do áudio. Continua escrito em três
    // lugares: legenda do post de feed, private reply e resposta pública do
    // FAROL-COMENTA. Se um dia a fala precisar declarar de novo (art. 50 do AI
    // Act mira exatamente avatar sintético), o lugar barato é a legenda do
    // reel, não a primeira frase.
    "Oi! Aqui é o porta-voz da Bidcon.",
    `A carta de hoje é de ${c.tipoLabel.toLowerCase()}: ${numeros.join(", ")} —`,
    `custo de ${custoFalado(c.custoAm)}, tudo já calculado.`,
    "O pagamento é protegido por Conta Notarial em cartório:",
    "o valor só é liberado ao vendedor depois da aprovação da administradora.",
    "Quer os detalhes? Chama a gente no direct ou toca no link da bio.",
  ].join(" ");
}

const HASHTAGS_REEL: Record<string, string> = {
  imovel:
    "#consorcio #cartacontemplada #consorciodeimovel #casapropria #planejamento #patrimonio #bidcon",
  veiculo:
    "#consorcio #cartacontemplada #consorciodeveiculo #carronovo #planejamento #patrimonio #bidcon",
};

/**
 * Legenda do reel: CURTA (números + hashtags), como a OS pede. Não repete o
 * parágrafo institucional do post de feed — quem está no reel já ouviu a Conta
 * Notarial pela voz; ler a mesma coisa embaixo só empurra o CTA para fora da
 * primeira dobra.
 */
export function montarLegendaReel(c: CartaCarrossel): string {
  const linhas: string[] = [];

  linhas.push(`Carta contemplada · ${c.tipoLabel}`);
  if (c.administradora) linhas.push(c.administradora);
  linhas.push("");

  // `reais()` é o MESMO formatador do post de feed e do card. O reel não pode
  // escrever o número de um jeito diferente do resto do produto.
  linhas.push(`Crédito: ${reais(c.credito)}`);
  if (c.entrada > 0) linhas.push(`Entrada: ${reais(c.entrada)}`);
  if (c.parcelas > 0 && c.parcela > 0) {
    linhas.push(`Parcelas: ${c.parcelas}x de ${reais(c.parcela)}`);
  }
  linhas.push(`Custo: ${pctAoMes(c.custoAm)}`);
  linhas.push("");

  linhas.push("Detalhes no link da bio. Prefere conversar? Chama no direct.");
  linhas.push("");
  linhas.push(HASHTAGS_REEL[c.tipo] ?? HASHTAGS_REEL.imovel);

  return linhas.join("\n");
}
