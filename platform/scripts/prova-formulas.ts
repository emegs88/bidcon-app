// ============================================================================
// Bancada de prova das fôrmas (FAROL-FORMULAS-02).
//   npx tsx --tsconfig tsconfig.json scripts/prova-formulas.ts
// ----------------------------------------------------------------------------
// Renderiza TODAS as fôrmas contra duas cartas REAIS do estoque, passa cada
// roteiro e cada legenda pelo mesmo `revisarLegenda()` da produção e conta as
// palavras. Não é código de produção e nada aqui roda em request: é o jeito de
// não descobrir um texto reprovado às 11h30, com a HeyGen já cobrada.
//
// RÉGUA DE DURAÇÃO — CORRIGIDA em 08/08 (FAROL-AULA-01, medição 1).
// A régua anterior (~170 ppm) vinha de UMA amostra lembrada de cabeça. Refiz a
// medição lendo o átomo `mvhd` dos mp4 REAIS hospedados no bucket:
//
//   reel 07/08  df4b877…   90 palavras → 31,49 s  → 171,5 ppm
//   reel 08/08  82572f4…   82 palavras → 32,81 s  → 149,9 ppm
//   agregado               172 palavras → 64,30 s → 160,5 ppm
//
// Vale a AGREGADA: ~160 palavras/min = 2,68 palavras/segundo. Divida o contador
// por 2,68. A régua velha subestimava a duração em ~6% — ou seja, as fôrmas são
// mais LONGAS do que eu declarei no READY da FORMULAS-02.
// Mantenha esta bancada verde ao mexer nas fôrmas.
// ============================================================================
import { FORMULAS } from "@/lib/farol/formulas";
import {
  roteiroDaFormula,
  legendaDaFormula,
  montarLegendaReel,
} from "@/lib/farol/reel-texto";
import { revisarLegenda } from "@/lib/farol/selecao";
import type { CartaCarrossel } from "@/lib/carrossel-formato";

const IMOVEL: CartaCarrossel = {
  id: "imovel-real",
  tipo: "imovel",
  tipoLabel: "Imóvel",
  administradora: "Itaú",
  credito: 2385990,
  entrada: 1245919,
  parcela: 14191,
  parcelas: 183,
  custoAm: 0.71,
  exclusiva: false,
};

const VEICULO: CartaCarrossel = {
  id: "veiculo-real",
  tipo: "veiculo",
  tipoLabel: "Veículo",
  administradora: "Bradesco",
  credito: 1132000,
  entrada: 767740,
  parcela: 16890,
  parcelas: 49,
  custoAm: 0.94,
  exclusiva: false,
};

// Régua medida (ver cabeçalho): 160,5 palavras/min = 2,68 palavras por segundo.
const PALAVRAS_POR_SEGUNDO = 2.68;

/**
 * A RÉGUA TEM DUAS PONTAS, E EU ESTAVA IMPRIMINDO SÓ O MEIO.
 *
 * As duas amostras que formam a régua não concordam: 171,5 ppm num reel e
 * 149,9 ppm no outro — 14% de dispersão. A agregada (160,5) é a melhor
 * estimativa central, mas nenhum vídeo sai na média: cada um sai numa das
 * pontas, dependendo do avatar, da voz e da pontuação do texto. E agora são
 * DUAS vozes (Porta-voz e Valentina, FAROL-DUPLA-01), o que só alarga a faixa.
 *
 * Imprimir só a agregada é declarar 25,0s para uma peça que pode sair a 26,8s e
 * estourar um teto de 25s — com a HeyGen já cobrada. A ponta LENTA (149,9 ppm =
 * 2,50 pal/s) é o pior caso realista, e é ela que decide se a promessa de
 * duração se sustenta. Uma folga de 2s na régua média é MENOR que o erro da
 * própria régua; sem esta coluna, "RASPANDO" não distingue o que passa raspado
 * do que já não passa.
 */
const PALAVRAS_POR_SEGUNDO_LENTO = 2.5;

// Abaixo desta folga o roteiro passa, mas passa raspando: qualquer palavra a
// mais numa próxima edição estoura o teto. Não é reprova — é aviso.
const FOLGA_MINIMA_S = 2;

/**
 * POR QUE A BANCADA PASSOU A IMPRIMIR SEGUNDOS.
 *
 * Ela contava palavras. Mas o contrato com o Emerson (decisão 2) é em SEGUNDOS
 * — curtas ≤25s, médias ≤32s, longas ≤40s — e a conversão ficava por conta de
 * quem lesse a saída. Um número que exige aritmética mental para virar a regra
 * não é verificação, é matéria-prima de verificação. Foi exatamente assim que
 * P1 e P2 ficaram a ~39s de um teto de 40s sem que isso aparecesse em lugar
 * nenhum: 104 palavras não parece perigoso, 38,8s parece.
 */
function contarPalavras(texto: string): number {
  return texto.trim().split(/\s+/).filter(Boolean).length;
}

let reprovas = 0;
let raspando = 0;

/**
 * Conta separada, e de propósito. Estourar na ponta LENTA da régua não é o
 * mesmo fato que estourar na régua central: o primeiro é um risco medido, o
 * segundo é uma certeza. Somar os dois no mesmo contador transformaria a
 * incerteza da minha medição em reprova de um texto que talvez esteja certo —
 * e a bancada passaria a reprovar a régua, não a fôrma.
 *
 * Por isso: REPROVAS bloqueia, PIOR CASO informa. Quem lê decide se aceita o
 * risco, mas ninguém decide sem saber que ele existe.
 */
let estouraNoPiorCaso = 0;

for (const f of FORMULAS) {
  for (const c of [IMOVEL, VEICULO]) {
    if (!f.tipos.includes(c.tipo as "imovel" | "veiculo")) continue;
    const roteiro = roteiroDaFormula(c, f);
    const veredito = revisarLegenda(roteiro);
    if (veredito) reprovas++;

    const palavras = contarPalavras(roteiro);
    const segundos = palavras / PALAVRAS_POR_SEGUNDO;
    const folga = f.duracao_alvo - segundos;

    // Estourar o teto é REPROVA, e não observação: a duração é compromisso
    // assumido, e quem descobre o estouro depois já pagou a HeyGen.
    let sinal = "OK";
    if (folga < 0) {
      reprovas++;
      sinal = `ESTOUROU por ${(-folga).toFixed(1)}s`;
    } else if (folga < FOLGA_MINIMA_S) {
      raspando++;
      sinal = `RASPANDO — só ${folga.toFixed(1)}s de folga`;
    }

    // A mesma contagem de palavras, na voz lenta. Não é cenário inventado:
    // é uma das duas amostras que formam a régua, medida de um mp4 que a
    // Bidcon já publicou.
    const segundosLento = palavras / PALAVRAS_POR_SEGUNDO_LENTO;
    const folgaLenta = f.duracao_alvo - segundosLento;
    let sinalLento = "cabe";
    if (folgaLenta < 0) {
      estouraNoPiorCaso++;
      sinalLento = `ESTOURA por ${(-folgaLenta).toFixed(1)}s`;
    }

    // A LEGENDA DA FÔRMA ENTROU NA BANCADA EM 09/08, junto com o fecho curto.
    // Enquanto a legenda repetia o áudio, medir só o roteiro era medir a peça.
    // Agora entrada e parcelas existem SÓ na legenda: uma bancada que não a
    // renderizasse estaria declarando verde uma peça da qual ela não viu
    // metade — inclusive os dois números que saíram do áudio por ordem da
    // coordenação, que é exatamente o que se quer conferir.
    const legenda = legendaDaFormula(c, f);
    const veredLegenda = revisarLegenda(legenda);
    if (veredLegenda) reprovas++;

    // Os quatro números têm que estar ESCRITOS. Não é zelo: a ordem de 09/08
    // tirou dois deles do áudio com a condição explícita de que aparecessem
    // aqui ("o que sai do áudio não pode sumir da peça"). Sem esta conferência,
    // a metade da ordem que eu cumpri esconderia a metade que eu tivesse
    // esquecido.
    const faltando = [
      ["Crédito", /^Crédito: /m],
      ["Entrada", /^Entrada: /m],
      ["Parcelas", /^Parcelas: /m],
      ["Custo", /^Custo: /m],
      ["CTA da fôrma", new RegExp(escapar(f.cta), "m")],
    ]
      .filter(([, re]) => !(re as RegExp).test(legenda))
      .map(([nome]) => nome as string);
    if (faltando.length) reprovas++;

    console.log(`\n=== ${f.id} ${f.nome} · ${c.tipoLabel} · teto ${f.duracao_alvo}s`);
    console.log(`--- linter: ${veredito ?? "OK"}`);
    console.log(roteiro);
    console.log(
      `--- palavras: ${palavras} · duração: ${segundos.toFixed(1)}s ` +
        `· teto: ${f.duracao_alvo}s · folga: ${folga.toFixed(1)}s · ${sinal}`
    );
    console.log(
      `--- voz lenta (${PALAVRAS_POR_SEGUNDO_LENTO} pal/s): ` +
        `${segundosLento.toFixed(1)}s · ${sinalLento}`
    );
    console.log(`--- LEGENDA (linter: ${veredLegenda ?? "OK"}):`);
    console.log(legenda);
    console.log(
      `--- legenda completa: ${faltando.length ? `FALTA ${faltando.join(", ")}` : "OK"}`
    );
  }
}

/** Escapa o CTA para virar regex literal — ele tem ponto, vírgula e acento. */
function escapar(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

for (const c of [IMOVEL, VEICULO]) {
  const l = montarLegendaReel(c, "2026-08-08");
  const veredito = revisarLegenda(l);
  if (veredito) reprovas++;
  console.log(`\n=== LEGENDA ${c.tipoLabel} — linter: ${veredito ?? "OK"}`);
  console.log(l);
}

console.log(`\n\nREPROVAS: ${reprovas}`);
console.log(`RASPANDO (passou com menos de ${FOLGA_MINIMA_S}s de folga): ${raspando}`);
console.log(
  `ESTOURA NA VOZ LENTA (${PALAVRAS_POR_SEGUNDO_LENTO} pal/s, medida em reel real): ` +
    `${estouraNoPiorCaso} — informativo, não reprova`
);
