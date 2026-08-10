// ============================================================================
// lib/farol/prompts-arte.ts — as regras de prompt do acervo de fundos do FAROL
// AUTORIZADO: Emerson Gomes dos Santos — FAROL-ARTE-02, 09/08/2026 (regras
// duras do prompt e regra de composição) e coordenação do mesmo dia:
//   "acrescente ao prompts-arte.ts a cláusula nova, com a evidência: 'luz
//    PONTUAL, não difusa — ponto de luz atravessa o véu de 78%, massa de
//    meio-tom não (medido: a3 sobrevive, a2 some)'."
// ----------------------------------------------------------------------------
// POR QUE ESTE ARQUIVO NASCE AGORA. As três artes de FAROL-ARTE-02 foram
// geradas por um script de /tmp. O script cumpriu o pedido e morreu com a
// máquina — levando junto o texto exato que produziu a única arte que prestou.
// Regra medida que vive fora do repositório é regra que se perde na primeira
// limpeza de temporários, e aí a próxima leva de artes recomeça do palpite.
// Isto aqui é o texto, versionado, com a medição que o justifica ao lado.
//
// A REGRA INEGOCIÁVEL. O modelo pinta CENA, LUZ e TEXTURA. Nada de marca,
// logotipo, emblema, placa, texto, dígito ou pessoa reconhecível. Quem escreve
// número é o gerador determinístico, por cima do véu navy de 78%. Isso não é
// preferência estética: número pintado por modelo é número que ninguém conferiu
// contra a carta — e a casa inteira existe para que o número na tela seja o
// número do banco.
//
// PROMPT DE IMAGEM NÃO TEM HERANÇA. As três caudas abaixo são concatenadas em
// TODOS os prompts, sempre, mesmo parecendo repetição. O que não está escrito
// no prompt não vale — não existe "já falei isso no anterior".
// ============================================================================

/**
 * Tudo o que o modelo não pode desenhar. Em inglês porque foi assim que a regra
 * foi medida: os três prompts de 09/08 usaram este texto e nenhuma das três
 * artes saiu com texto, placa ou emblema. Traduzir agora seria trocar uma
 * formulação verificada por uma não verificada.
 */
export const PROIBICOES =
  "Absolutely no text, no letters, no numbers, no digits, no logos, no brand marks, " +
  "no emblems, no badges, no license plates, no signage, no watermarks, " +
  "no recognizable faces or people. ";

/**
 * A REGRA DE COMPOSIÇÃO, que é aritmética e não gosto.
 *
 * O card de feed recorta o miolo 1152×1152 de um 1152×2048 — sobram as linhas
 * y=448…1600, ou seja 21,875%…78,125% da altura. E o miolo horizontal central é
 * onde caem o número do crédito e o painel de vidro nos DOIS formatos. Logo: o
 * interesse tem de ficar entre 22% e 78% da altura E fora do centro horizontal.
 *
 * MEDIDO em 09/08: a arte do carro (a1) colocou o veículo no centro horizontal
 * e ele briga com o número do crédito exatamente onde o número cai. Não é
 * hipótese — está no card montado.
 */
export const COMPOSICAO =
  "Composition: place the subject and all visual interest in the vertical middle band " +
  "of the frame, between 22 percent and 78 percent of the image height, and pushed to " +
  "the left or right side, away from the horizontal centre. Keep the top fifth and the " +
  "bottom fifth of the frame calm, dark and empty. Keep the horizontal centre free of " +
  "bright highlights. ";

/**
 * O acabamento — e aqui mora a CLÁUSULA NOVA, a mais cara das três porque só
 * apareceu depois de montar os cards reais.
 *
 * A EVIDÊNCIA. As três artes de 09/08 foram montadas no card de story, com o
 * mesmo véu navy de 78% e a mesma carta real. Debaixo do véu:
 *   · a3 (imóvel alto) SOBREVIVE — tem janelas acesas e balizadores de jardim,
 *     ou seja PONTOS de luz, que atravessam o véu como pontos;
 *   · a2 (imóvel médio) SOME — a casa é pequena e toda em meio-tom difuso, e
 *     meio-tom sob 78% de navy vira navy;
 *   · a1 (carro) vira borrão, pelo mesmo motivo somado ao erro de composição.
 *
 * Ou seja: o véu não escurece uniformemente o que se vê — ele APAGA massa de
 * meio-tom e PRESERVA fonte pontual. Pedir "luz bonita" não basta; é preciso
 * pedir de onde a luz vem. Nenhum dos três prompts de 09/08 pedia isso, e é
 * por isso que dois dos três não prestaram.
 */
export const ACABAMENTO =
  "Realistic photography, late afternoon golden light, cinematic depth of field, " +
  "fine photographic grain, deep shadows, calm and expensive mood, muted palette " +
  "leaning to midnight navy and warm amber. " +
  // A cláusula da luz pontual. Ver o bloco acima para a medição que a originou.
  "Light must be POINT-SOURCE, not diffuse: include small bright practical lights " +
  "in the scene — lit windows, garden uplights, a lamp, a reflection catching an edge — " +
  "so that specular highlights read as distinct points against dark surroundings. " +
  "Avoid flat, evenly lit mid-tone masses. ";

/**
 * As seis categorias figurativas do acervo, na grafia exata do CHECK da
 * migração 0076. `tipo` e `faixa` são derivados dela no banco (colunas
 * `generated always as ... stored`), então esta lista é a única verdade sobre
 * quais artes o acervo conhece.
 */
export const CATEGORIAS_FIGURATIVAS = [
  "veiculo_popular",
  "veiculo_medio",
  "veiculo_alto",
  "imovel_compacto",
  "imovel_medio",
  "imovel_alto",
] as const;

export type CategoriaFigurativa = (typeof CATEGORIAS_FIGURATIVAS)[number];

/**
 * A cena de cada categoria — só a cena. As caudas comuns entram por
 * `montarPrompt`, nunca à mão, para que ninguém consiga gerar uma arte sem as
 * proibições por ter esquecido de colar.
 *
 * As três cenas com nota "medida em 09/08" são literalmente as que rodaram; as
 * outras três são escritas pelo mesmo molde e AINDA NÃO FORAM GERADAS — quando
 * forem, a nota some ou o texto muda.
 */
export const CENAS: Record<CategoriaFigurativa, string> = {
  // MEDIDA em 09/08 — resultado a1: composição errada (carro no centro
  // horizontal). Corrigido pedindo o lado.
  //
  // MEDIDA em 10/08 — REPROVADA na curadoria, e não por composição: o carro saiu
  // um VW Polo RECONHECÍVEL (grade, faróis, linha de teto), e a rua era vila
  // europeia — casas de pedra e chaminés —, não Brasil. Risco duplo: usar
  // desenho de montadora em peça publicitária, e sugerir que a carta compra
  // aquele carro.
  //
  // POR QUE PROIBIR NÃO RESOLVEU — e é isto que faz a correção ser geométrica e
  // não mais uma frase. O texto antigo JÁ pedia "unbranded" e "anonymous grille
  // with no emblem", e `PROIBICOES` JÁ veta "no logos, no brand marks, no
  // emblems, no badges". O modelo OBEDECEU: não pintou emblema nenhum. O que
  // denuncia a marca não é o emblema desenhado — é a GEOMETRIA da grade, do
  // farol e da linha de teto, copiada do acervo de carros reais que o modelo
  // conhece. Proibição alcança marca desenhada; forma de carroceria não se
  // proíbe por texto. Só resolve TIRANDO DE CENA a superfície que carrega a
  // identidade. Daí três quartos TRASEIRO — e daí a palavra "grille" SAIR do
  // texto: pedir "grade anônima" é, antes de tudo, pedir grade.
  //
  // E sair INCLUSIVE das negações. A primeira versão desta correção dizia "no
  // grille, no headlights, no front bumper in frame" — ou seja, nomeava de novo
  // as duas superfícies que eu tinha acabado de argumentar que não se deve
  // nomear. Com o carro de traseira a frase era redundante além de contraditória.
  // O texto agora diz o que ESTÁ em quadro (tampa, vidro e para-choque
  // traseiros), que é a forma que não depende de o modelo obedecer a negação.
  //
  // Carroceria escura fosca também é medição, não gosto: fosca não devolve
  // reflexo especular, então a massa do carro fica escura e os pontos de luz da
  // cláusula de luz pontual vêm das janelas e dos postes — que é exatamente o
  // que sobrevive ao véu (ver o bloco de ACABAMENTO).
  //
  // TENSÃO DECLARADA: "at night" aqui puxa contra "late afternoon golden light"
  // de `ACABAMENTO`, que é cauda comum e não sei reescrever sem remedir as seis
  // categorias. A cláusula de luz pontual já pede "distinct points against dark
  // surroundings", então as duas convivem — mas isto é raciocínio, não medida, e
  // só vira medida quando a regeração for autorizada.
  veiculo_popular:
    "A small compact hatchback car parked on a quiet Brazilian residential street at night, " +
    "seen from behind in a three-quarter REAR view from a low angle, positioned to one side " +
    "of the frame. Only the rear of the car is in frame — rear hatch, rear window and rear " +
    "bumper; the front of the car falls outside the frame entirely. Plain unbranded dark " +
    "matte charcoal bodywork with no gloss and no " +
    "reflections, plain steel wheels, simple plain rectangular tail lights. Behind it a " +
    "Brazilian residential street: plastered boundary walls, a low metal gate, a leafy tree, " +
    "warm street lamps and " +
    "windows lit from inside. No stone cottages, no chimneys, no European village " +
    "architecture, no cobblestones. ",

  // ATENÇÃO — o mesmo defeito de 10/08 está LATENTE aqui e em `veiculo_alto`:
  // ambos pedem "three-quarter view" (que o modelo lê como frontal) e ambos
  // pedem "anonymous grille with no emblem", que é a frase que não funcionou.
  // Nenhuma das duas foi gerada, então não há medição própria — mas o mecanismo
  // é o mesmo. NÃO reescritas aqui de propósito: a autorização de 10/08 era para
  // corrigir `veiculo_popular`. Reportado para decisão.
  veiculo_medio:
    "A modern unbranded sedan parked at the edge of a quiet avenue at dusk, three-quarter " +
    "view from a low angle, positioned to one side of the frame. Neutral dark bodywork, " +
    "anonymous grille with no emblem. Warm street lights and lit windows behind it. ",

  veiculo_alto:
    "An unbranded premium SUV on a clean paved driveway at dusk, three-quarter view from a " +
    "low angle, positioned to one side of the frame. Deep neutral bodywork, anonymous " +
    "grille with no emblem. Warm lit windows and garden uplights behind it. ",

  imovel_compacto:
    "A small generic Brazilian apartment building at dusk, simple modern architecture, " +
    "several windows lit warm from inside, photographed from the street at an angle, the " +
    "building pushed to one side of the frame. No name plate and no development branding. ",

  // MEDIDA em 09/08 — resultado a2: SUMIU sob o véu, por ser massa de meio-tom
  // sem fonte pontual. Texto abaixo reescrito com luz acesa, que é a correção.
  imovel_medio:
    "A generic middle-class Brazilian house at dusk, simple modern architecture, white " +
    "rendered walls, dark window frames, windows lit warm from inside, a small front garden " +
    "with a low garden light, no name plate and no development branding, photographed from " +
    "the street at an angle, the house pushed to one side of the frame. ",

  // MEDIDA em 09/08 — resultado a3: a ÚNICA que pagou. Texto praticamente
  // intocado de propósito: mexer no que funcionou é apostar contra a medição.
  imovel_alto:
    "A generic upscale Brazilian residence at dusk, contemporary architecture with clean " +
    "horizontal lines, exposed concrete and wide glass panes, warm interior light just " +
    "coming on, garden uplights, mature landscaping, no name plate and no development " +
    "branding, photographed from a low three-quarter angle, the house pushed to one side " +
    "of the frame. ",
};

/**
 * A CENA DA CATEGORIA 'abstrata' — o buraco que este bloco fecha.
 *
 * Medido em 10/08: `farol_arte.categoria` tem DEFAULT 'abstrata' na 0076, e
 * 'abstrata' é o acervo coringa — o que serve QUALQUER carta, porque não afirma
 * bem nenhum e por isso não obriga o selo "Imagem ilustrativa". É, de longe, a
 * categoria mais reaproveitável do acervo.
 *
 * E era a única sem texto. `CENAS` cobria as seis figurativas; a coringa,
 * default da tabela, dependia de alguém improvisar na hora — exatamente o
 * defeito que o cabeçalho deste arquivo diz existir para impedir ("regra medida
 * que vive fora do repositório é regra que se perde na primeira limpeza").
 *
 * O texto abaixo NÃO é invenção de cena nova: é a lição de a3 aplicada sem
 * objeto. A medição de 09/08 diz que o véu de 78% apaga massa de meio-tom e
 * preserva fonte pontual — num fundo sem objeto isso vira a regra inteira,
 * porque não há silhueta para segurar a leitura. Daí "pontos de luz sobre
 * escuro", e nada de gradiente liso.
 */
export const CENA_ABSTRATA =
  "An abstract dark background: deep midnight navy surface with subtle texture, " +
  "soft bokeh points of warm amber light scattered across it like distant city lights " +
  "out of focus, gentle depth and atmosphere, no objects, no architecture, no vehicles, " +
  "no horizon line. ";

/** Tudo que o acervo sabe pintar: as seis figurativas mais a coringa. */
export const CATEGORIAS = [...CATEGORIAS_FIGURATIVAS, "abstrata"] as const;
export type Categoria = (typeof CATEGORIAS)[number];

/**
 * Monta o prompt final. É a ÚNICA porta: cena + acabamento + composição +
 * proibições, nessa ordem, sempre. Quem quiser gerar arte chama isto.
 *
 * A ordem não é aleatória — as proibições vão por último porque é a última
 * coisa que o modelo lê e a que menos pode ser diluída pelo resto.
 *
 * A coringa recebe as MESMAS três caudas. Poderia-se argumentar que um fundo
 * sem objeto não precisa da regra de composição — precisa mais: o número do
 * crédito cai no mesmo lugar, e um brilho no centro horizontal atrapalha tanto
 * vindo de um farol quanto vindo de um bokeh.
 */
export function montarPrompt(categoria: Categoria): string {
  const cena = categoria === "abstrata" ? CENA_ABSTRATA : CENAS[categoria];
  return cena + ACABAMENTO + COMPOSICAO + PROIBICOES;
}
