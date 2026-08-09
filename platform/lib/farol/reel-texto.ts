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
import { formulaDoDia, type Formula } from "@/lib/farol/formulas";

/**
 * Valor em reais na forma que se FALA. Exato até o real (ver header):
 *   250000  -> "250 mil reais"
 *   1250000 -> "1 milhão e 250 mil reais"
 *   255300  -> "255 mil e 300 reais"
 *   890     -> "890 reais"
 *   2385990 -> "2 milhões, 385 mil e 990 reais"   <- as TRÊS classes
 *   1000000 -> "1 milhão DE reais"                <- milhão redondo pede "de"
 *
 * A COLAGEM DAS CLASSES É VÍRGULA, E O " e " SÓ ANTES DA ÚLTIMA.
 * AUTORIZADO: Emerson Gomes dos Santos — decisão 3 da coordenação de 08/08/2026:
 * "corrigir a colagem — '2 milhões, 385 mil e 990 reais'".
 * A versão anterior colava tudo com " e " e produzia "2 milhões e 385 mil e 990
 * reais". Isso não é como a língua fala, e o defeito só APARECE quando as três
 * classes existem ao mesmo tempo — por isso passou: as cartas medidas até aqui
 * caíam em duas classes (1.132.000 -> "1 milhão e 132 mil"). A carta de
 * R$ 2.385.990 do Itaú, que entrou na bancada das fôrmas, é a que revelou.
 *
 * NÃO uso Intl.ListFormat: ele colaria "2 milhões, 385 mil e 990" igual, mas
 * carrega dependência de locale de runtime para uma regra de três casos que eu
 * quero LER no arquivo. Aqui a regra está escrita.
 *
 * ---------------------------------------------------------------------------
 * SEGUNDO CONSERTO, ALÉM DA LETRA DA DECISÃO 3 — DECLARADO. Medindo o defeito
 * da colagem eu achei outro na MESMA linha de retorno: o milhão redondo saía
 * "1 milhão reais" / "2 milhões reais". Em português o "de" só cai quando vem
 * outra classe atrás ("1 milhão e 132 mil reais"); terminando no milhão, é
 * "1 milhão de reais". Crédito redondo de R$ 1.000.000 é dos mais comuns em
 * imóvel, então isso ia ao ar falado errado. Emerson: se preferir que eu ande
 * só pela letra da ordem, é reverter estas duas linhas e o teste correspondente.
 *
 * LIMITE DECLARADO: não existe classe de BILHÃO aqui. R$ 2.385.990.000 sairia
 * "2385 milhões...". Não implementei porque nenhuma carta chega perto e prefiro
 * o limite escrito a um código que finge cobrir uma faixa que nunca vi.
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

  // "de reais" só quando o número TERMINA no milhão — ver header.
  const terminaNoMilhao = milhoes > 0 && milhares === 0 && unidades === 0;
  return `${colarClasses(partes)} ${terminaNoMilhao ? "de reais" : "reais"}`;
}

/**
 * Cola as classes do número: vírgula entre todas, " e " só antes da última.
 *   ["990"]                        -> "990"
 *   ["1 milhão", "132 mil"]        -> "1 milhão e 132 mil"
 *   ["2 milhões", "385 mil", "990"] -> "2 milhões, 385 mil e 990"
 * Separada de `valorFalado` porque é a regra que a decisão 3 mandou consertar —
 * quero que ela tenha nome, e que o teste consiga apontar para ela.
 */
function colarClasses(partes: string[]): string {
  if (partes.length <= 1) return partes[0] ?? "";
  const ultima = partes[partes.length - 1];
  return `${partes.slice(0, -1).join(", ")} e ${ultima}`;
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
function roteiroClassico(c: CartaCarrossel): string {
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
 *
 * ---------------------------------------------------------------------------
 * A LEGENDA PASSOU A SER O DESTINO DE ENTRADA E PARCELAS (coordenação, 09/08):
 * "a LEGENDA de cada fôrma passa a carregar os números completos (crédito,
 * entrada, parcelas, custo a.m.) + o CTA — o que sai do áudio não pode sumir da
 * peça."
 *
 * DIGO O QUE MUDOU DE VERDADE, para ninguém ler mais do que houve: os quatro
 * números JÁ estavam aqui desde a FAROL-REEL-01 — esta legenda nunca falou só
 * o crédito. O que a ordem de 09/08 muda é (a) o STATUS deles, que deixaram de
 * ser repetição do áudio e passaram a ser a única aparição de entrada e
 * parcelas na peça, e (b) o CTA, que é novo aqui.
 *
 * `cta` SUBSTITUI a linha genérica em vez de somar a ela. Somar daria três
 * pedidos na mesma legenda ("link da bio", "chama no direct", e o da fôrma) —
 * e o CTA da fôrma é justamente o específico e verificável ("comenta OBRA que
 * eu te explico como usa"). Diluí-lo em dois genéricos seria desfazer a razão
 * de ele existir.
 */
function legendaClassica(c: CartaCarrossel, selo = false, cta?: string): string {
  const linhas: string[] = [];

  linhas.push(`Carta contemplada · ${c.tipoLabel}`);
  if (c.administradora) linhas.push(c.administradora);
  // SELO DE EXCLUSIVIDADE (decisão 3 de 08/08): a exclusividade se expressa
  // AQUI, na legenda, e nunca forçando o tema do roteiro. Ver header de
  // formulas.ts para a regra que foi eliminada em favor deste selo.
  if (selo && c.exclusiva) linhas.push("Carta exclusiva Bidcon");
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

  linhas.push(cta ?? "Detalhes no link da bio. Prefere conversar? Chama no direct.");
  linhas.push("");
  linhas.push(HASHTAGS_REEL[c.tipo] ?? HASHTAGS_REEL.imovel);

  return linhas.join("\n");
}

// ===========================================================================
// EIXO DAS POSSIBILIDADES (FAROL-FORMULAS-02) — os 8 roteiros determinísticos
// ---------------------------------------------------------------------------
// POR QUE O TEXTO MORA AQUI E NÃO EM formulas.ts. O roteiro precisa de
// `valorFalado()` e `custoFalado()`, que moram neste arquivo; e este arquivo
// precisa de `formulaDoDia()`, que mora em formulas.ts. Se o texto literal
// fosse escrito lá, os dois módulos se importariam em círculo. A divisão é:
// formulas.ts é DADO E INSTRUÇÃO (o que dizer), reel-texto.ts é TEXTO (como se
// diz). Quem escreve pela IA (a ESCUTA) lê a instrução; quem escreve pelo
// template lê daqui.
//
// NENHUM DOS OITO ABRE COM SAUDAÇÃO OU COM A CARTA. Todos abrem pelo `gancho`
// da fôrma — literal, sem parafrasear — e só chegam nos números no fecho, como
// PROVA. Essa é a estrutura obrigatória da OS, e é ela que muda o eixo.
//
// LINTER: nenhum destes textos contém o caractere "%", porque o custo falado
// sai por `custoFalado()` ("por cento ao mês"). A regra de percentual de
// `revisarLegenda()` passa por ausência, não por sorte — mas os oito são
// medidos pelo linter antes de qualquer publicação, mesmo assim.
// ===========================================================================

/**
 * A carta na forma FALADA, como prova no fecho: CRÉDITO e CUSTO AO MÊS, só.
 *
 * ---------------------------------------------------------------------------
 * FECHO CURTO UNIVERSAL. AUTORIZADO: coordenação de 09/08/2026 —
 * "provaFalada(c, true) — só crédito + custo ao mês — passa a ser o padrão de
 * TODAS as 8 fôrmas, não só da P6. Entrada e parcelas SAEM do áudio e vão para
 * a LEGENDA. O custo ao mês CONTINUA falado — é promessa da marca."
 *
 * A MEDIÇÃO QUE MOTIVOU. A régua desta nota estava ERRADA e foi refeita em
 * 08/08 (FAROL-AULA-01, medição 1): eu tinha escrito "~170 palavras por minuto"
 * a partir de UMA amostra lembrada de cabeça. Medindo o átomo `mvhd` dos dois
 * mp4 REAIS que foram ao ar — 90 palavras/31,49s e 82 palavras/32,81s — a régua
 * agregada é 160,5 ppm, ou 2,68 palavras por segundo.
 *
 * Com a régua certa, a prova COMPLETA de uma carta de R$ 2,3 milhões custava 45
 * palavras — ~17 dos 39 segundos da peça, quase metade dela, só para recitar
 * número. Numa série cujo eixo é a POSSIBILIDADE e não o produto, esse era o
 * ponto em que o vídeo voltava a ser um anúncio de carta.
 *
 * O QUE NÃO SE PERDEU: entrada e parcelas continuam na legenda (aqui embaixo,
 * `legendaClassica`) e na página da carta, que é onde a pessoa decide. O que
 * sai do áudio não sai da peça. E o custo ao mês continua falado, porque dizer
 * o preço em voz alta é a promessa que separa esta casa do resto do mercado.
 *
 * Efeito colateral bem-vindo: a HeyGen cobra por DURAÇÃO (US$0,05/s no Photo
 * Avatar) e são 30 renders/mês.
 */
function provaFalada(c: CartaCarrossel): string {
  return `crédito de ${valorFalado(c.credito)}`;
}

/**
 * A frase de custo. VAZIA quando o custo não é exibível: preferimos calar do
 * que falar "custo de traço". `pctAoMes(null)` devolve "—", e um TTS lendo isso
 * produz silêncio ou ruído — nos dois casos, um vídeo estragado.
 *
 * A cauda ", tudo já calculado" saiu junto com o fecho longo (09/08): ela era a
 * versão `curta = false` desta frase, e a P6 — a fôrma que a coordenação elegeu
 * como padrão — já fechava sem ela. Continua viva no roteiro CLÁSSICO, que não
 * passa por aqui.
 */
function custoFrase(c: CartaCarrossel): string {
  if (c.custoAm == null) return "";
  return ` Custo de ${custoFalado(c.custoAm)}.`;
}

/**
 * O fecho comum: prova + custo + CTA da fôrma. UM só, para as oito.
 *
 * `abertura` existe por causa da P6, que emenda o fecho numa frase de contexto
 * ("Esse estoque gira todo dia — hoje tem…"). Antes ela carregava uma CÓPIA
 * inteira do fecho no corpo do roteiro, e foi só por sorte que a cópia não
 * divergiu do original em três dias de vida. Um parâmetro de uma palavra é mais
 * barato que uma segunda fonte da mesma frase.
 */
function fecho(c: CartaCarrossel, f: Formula, abertura = "Hoje tem"): string {
  return `${abertura} ${provaFalada(c)}.${custoFrase(c)} ${f.cta}`;
}

type Roteirista = (c: CartaCarrossel, f: Formula) => string;

const ROTEIROS: Record<string, Roteirista> = {
  P1: (c, f) =>
    [
      f.gancho,
      "Esse dinheiro não volta e não virou patrimônio.",
      "A carta contemplada é crédito já liberado: compra o imóvel à vista e troca o aluguel por parcela de uma coisa que fica sua.",
      fecho(c, f),
    ].join(" "),

  P2: (c, f) =>
    [
      f.gancho,
      "Quem já tem financiamento pode usar o crédito da carta para quitar o saldo devedor e passar a pagar a parcela do consórcio.",
      "É troca de dívida, com o custo escrito na frente para você comparar com o seu contrato.",
      fecho(c, f),
    ].join(" "),

  P3: (c, f) =>
    [
      f.gancho,
      "Quem compra à vista negocia de um jeito; quem depende de aprovação de banco negocia de outro.",
      "A carta contemplada é isso: crédito liberado para fechar à vista.",
      fecho(c, f),
    ].join(" "),

  P4: (c, f) =>
    [
      f.gancho,
      "Empresa também adquire carta de crédito.",
      c.tipo === "veiculo"
        ? "Dá para montar frota com planejamento, em vez de comprar apertado no dia em que o veículo para."
        : "Dá para trocar o aluguel comercial por sede própria, com o crédito na mão para comprar à vista.",
      fecho(c, f),
    ].join(" "),

  P5: (c, f) =>
    [
      f.gancho,
      "Terreno, construção, reforma e ampliação também entram.",
      "É o uso que a maior parte das pessoas não sabe que existe.",
      fecho(c, f),
    ].join(" "),

  P6: (c, f) =>
    [
      f.gancho,
      "A cota que você já pagou tem valor de mercado agora.",
      // O "E" inicial desta frase foi CORTADO em 09/08. AUTORIZADO nominalmente
      // pela coordenação: "P6/Imóvel: autorizado o corte de 1 palavra para
      // folga real na voz lenta". Escolhi a conjunção e não uma palavra do
      // conteúdo porque a descrição da Conta Notarial é canônica da casa (o
      // esqueleto manda citá-la assim) e a dúvida de quem vende é justamente o
      // pagamento — encurtar ali seria pagar o segundo com a única frase que
      // responde a objeção da fôrma.
      "O pagamento é protegido por Conta Notarial em cartório: o valor só é liberado ao vendedor depois da aprovação da administradora.",
      // A única fôrma que não abre o fecho com "Hoje tem": aqui a carta do dia
      // é prova de que o estoque GIRA, que é o que interessa a quem vende.
      fecho(c, f, "Esse estoque gira todo dia — hoje tem"),
    ].join(" "),

  P7: (c, f) =>
    [
      f.gancho,
      "Para quem roda o dia inteiro, o carro não é luxo: é ferramenta de trabalho.",
      "Chegar com o crédito na mão muda a condição de compra.",
      fecho(c, f),
    ].join(" "),

  P8: (c, f) =>
    [
      f.gancho,
      "Mito: consórcio é ficar esperando sorteio.",
      "Verdade: a carta contemplada já passou por essa etapa — o que você adquire é o crédito liberado.",
      fecho(c, f),
    ].join(" "),
};

/**
 * Roteiro de uma fôrma específica. Exportado para que o linter e o relatório de
 * aprovação possam renderizar as oito sem passar pelo kill-switch.
 * Fôrma sem roteirista cai no clássico em vez de devolver vazio.
 */
export function roteiroDaFormula(c: CartaCarrossel, f: Formula): string {
  const r = ROTEIROS[f.id];
  return r ? r(c, f) : roteiroClassico(c);
}

/**
 * Legenda de uma fôrma específica. Gêmea de `roteiroDaFormula`, e exportada
 * pelo mesmo motivo: desde 09/08 a legenda é METADE da peça — é ela que carrega
 * entrada e parcelas, que saíram do áudio. Uma bancada que rendesse só o
 * roteiro passaria a medir metade do que vai ao ar.
 */
export function legendaDaFormula(c: CartaCarrossel, f: Formula): string {
  return legendaClassica(c, true, f.cta);
}

// ---------------------------------------------------------------------------
// AS DUAS PORTAS PÚBLICAS — atrás do kill-switch FAROL_FORMULAS
// ---------------------------------------------------------------------------
// DOUTRINA DA CASA (Emerson, 08/08): fatia que MUTA caminho vivo nasce atrás de
// env própria. Estas duas funções são o caminho vivo do reel diário. Com
// `FAROL_FORMULAS` desarmada elas devolvem, byte a byte, o que devolviam antes
// desta fatia — o diff funcional é ZERO até alguém armar a env.
//
// `dia` é opcional para não quebrar quem ainda chama com um argumento só. Sem
// `dia` não há fôrma do dia, e portanto não há o que trocar: cai no clássico.

/**
 * Qual fôrma o template VAI usar — ou `null` quando ele cai no clássico.
 *
 * Nasceu na FAROL-DUPLA-01 (08/08) porque a rota de render precisa saber QUEM
 * fala, e quem fala é campo da fôrma. A alternativa era a rota repetir a
 * condição do kill-switch e chamar `formulaDoDia()` por conta própria — duas
 * cópias da mesma decisão, que é como elas divergem. Aqui a condição está
 * escrita UMA vez e `montarRoteiro()` passou a ler dela.
 *
 * É consulta pura: não monta texto, não escreve nada, e devolve `null` sempre
 * que o roteiro for o clássico — inclusive com `FAROL_FORMULAS` desarmada.
 */
export function formulaDoTemplate(c: CartaCarrossel, dia?: string): Formula | null {
  if (process.env.FAROL_FORMULAS !== "on" || !dia) return null;
  return formulaDoDia(dia, c.exclusiva, c.tipo);
}

/** Roteiro falado do reel. Ver bloco acima sobre o kill-switch. */
export function montarRoteiro(c: CartaCarrossel, dia?: string): string {
  const f = formulaDoTemplate(c, dia);
  return f ? roteiroDaFormula(c, f) : roteiroClassico(c);
}

/**
 * Legenda do reel.
 *
 * ATÉ 09/08 ESTA FUNÇÃO IGNORAVA A FÔRMA (`void dia`), e o comentário aqui
 * dizia, com todas as letras, que "a fôrma NÃO muda a legenda". Mudou: com o
 * fecho curto universal, entrada e parcelas só existem AQUI, e o CTA da fôrma
 * também. A legenda deixou de ser o rodapé do reel e virou a outra metade dele.
 *
 * Lê a fôrma pela MESMA `formulaDoTemplate()` que `montarRoteiro()` consulta, e
 * não por uma segunda cópia da condição do kill-switch: com `FAROL_FORMULAS`
 * desarmada não há fôrma, não há `cta`, e esta função devolve byte a byte o que
 * devolvia antes desta fatia.
 *
 * O SELO continua amarrado à ENV e não à fôrma, de propósito. Sem `dia` não há
 * fôrma, mas a carta exclusiva continua exclusiva — o selo é fato da carta
 * (decisão 3 de 08/08), não da fôrma.
 */
export function montarLegendaReel(c: CartaCarrossel, dia?: string): string {
  const f = formulaDoTemplate(c, dia);
  return legendaClassica(c, process.env.FAROL_FORMULAS === "on", f?.cta);
}
