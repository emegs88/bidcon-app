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
 */
function legendaClassica(c: CartaCarrossel, selo = false): string {
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

  linhas.push("Detalhes no link da bio. Prefere conversar? Chama no direct.");
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
 * Os números da carta na forma FALADA, como prova no fecho.
 *
 * DUAS LARGURAS, POR MEDIÇÃO (08/08, antes do commit). O roteiro clássico que
 * está no ar tem 88 palavras e rendeu um vídeo de 31 segundos — ou seja, ~170
 * palavras por minuto na voz que usamos. Com essa régua, a prova COMPLETA de
 * uma carta de R$ 2,3 milhões custa 45 palavras, ~16 segundos, sozinha. Uma
 * fôrma de alvo 15s fecharia em 31s: o dobro do que ela declara.
 *
 * Então as fôrmas curtas (alvo <= 20s) falam só o CRÉDITO. A carta continua
 * aparecendo como prova, que é o que a OS exige; entrada e parcelas continuam
 * escritas na legenda e na página da carta, que é onde a pessoa decide. O
 * ganho não é só de retenção: a HeyGen cobra por duração, e são 30 renders/mês.
 */
function provaFalada(c: CartaCarrossel, curta = false): string {
  const partes: string[] = [`crédito de ${valorFalado(c.credito)}`];
  if (curta) return partes[0];
  if (c.entrada > 0) partes.push(`entrada de ${valorFalado(c.entrada)}`);
  if (c.parcelas > 0 && c.parcela > 0) {
    partes.push(`${c.parcelas} parcelas de ${valorFalado(c.parcela)}`);
  }
  return partes.join(", ");
}

/** Fôrma curta: fecha enxuto. Ver `provaFalada`. */
function ehCurta(f: Formula): boolean {
  return f.duracao_alvo <= 20;
}

/**
 * A frase de custo. VAZIA quando o custo não é exibível: preferimos calar do
 * que falar "custo de traço". `pctAoMes(null)` devolve "—", e um TTS lendo isso
 * produz silêncio ou ruído — nos dois casos, um vídeo estragado.
 */
function custoFrase(c: CartaCarrossel, curta = false): string {
  if (c.custoAm == null) return "";
  const cauda = curta ? "" : ", tudo já calculado";
  return ` Custo de ${custoFalado(c.custoAm)}${cauda}.`;
}

/** O fecho comum: prova + custo + CTA da fôrma. */
function fecho(c: CartaCarrossel, f: Formula): string {
  const curta = ehCurta(f);
  return `Hoje tem ${provaFalada(c, curta)}.${custoFrase(c, curta)} ${f.cta}`;
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
      "E o pagamento é protegido por Conta Notarial em cartório: o valor só é liberado ao vendedor depois da aprovação da administradora.",
      `Esse estoque gira todo dia — hoje tem ${provaFalada(c, true)}.${custoFrase(c, true)} ${f.cta}`,
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

/** Roteiro falado do reel. Ver bloco acima sobre o kill-switch. */
export function montarRoteiro(c: CartaCarrossel, dia?: string): string {
  if (process.env.FAROL_FORMULAS !== "on" || !dia) return roteiroClassico(c);
  return roteiroDaFormula(c, formulaDoDia(dia, c.exclusiva, c.tipo));
}

/**
 * Legenda do reel. A fôrma NÃO muda a legenda — os números são os mesmos e o
 * CTA escrito continua o mesmo. O que a env liga aqui é só o selo de
 * exclusividade (decisão 3), que é onde a exclusividade passou a morar.
 */
export function montarLegendaReel(c: CartaCarrossel, dia?: string): string {
  void dia;
  return legendaClassica(c, process.env.FAROL_FORMULAS === "on");
}
