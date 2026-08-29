// ============================================================================
// lib/captacao.test.ts — prova do lado do CEDENTE (CAPTACAO-OFERTA-01 F2)
// ----------------------------------------------------------------------------
// Rodar isolado:
//   npx tsx --tsconfig tsconfig.test.json --test lib/captacao.test.ts
//
// O QUE ESTE ARQUIVO EXISTE PARA PEGAR. A fatia inteira falha em silêncio:
//   - `Imóvel` acentuado bate no check da 0088 e o lead é PERDIDO com 500;
//   - "150.000" lido como decimal vira 150 — erro de mil vezes, sem exceção;
//   - a faixa calculada sobre o crédito BRUTO infla a proposta exatamente nas
//     cotas com lance embutido alto;
//   - o texto obrigatório envelhece no HTML enquanto a constante muda no TS,
//     e NENHUM dos dois portões percebe.
//
// A ÚLTIMA É A ÚNICA QUE PRECISA LER ARQUIVO. Cópia literal envelhecida passa
// no `tsc` (são dois arquivos que não se conhecem) E passa em teste de
// conteúdo (o HTML continua tendo *algum* texto). Só o teste de ACOPLAMENTO —
// ler o HTML de verdade e comparar com a constante — pega a divergência.
// Precedente: lib/farol-arte.test.ts, que varre `app/` pelo `__dirname`.
//
// SEM REDE, SEM BANCO, SEM SEGREDO. Nada aqui toca Supabase nem lê env.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  normalizarTipoBem,
  digitosTelefone,
  telefoneValido,
  chaveOrigem,
  moedaParaNumero,
  inteiroNaoNegativo,
  textoCurto,
  creditoLiquido,
  faixaProposta,
  tarifaNotarial,
  TABELA_NOTARIAL,
  NOTARIAL_FONTE,
  NOTARIAL_VIGENCIA,
  PARTE_TABELIAO,
  PROPOSTA_MIN,
  PROPOSTA_MAX,
  TEXTO_FAIXA,
  TEXTO_NOTARIAL,
  LEXICO_PROIBIDO,
} from "./captacao";

// ----------------------------------------------------------------------------
// A armadilha declarada na 0088
// ----------------------------------------------------------------------------

test("normalizarTipoBem aceita os literais que o <select> da página emite", () => {
  // Fixtures COPIADAS do HTML, não inventadas: <option value="Imóvel"> e
  // <option value="Veículo">. Se alguém trocar o value na página, o teste de
  // acoplamento lá embaixo é que acusa — este aqui prova a normalização.
  assert.equal(normalizarTipoBem("Imóvel"), "imovel");
  assert.equal(normalizarTipoBem("Veículo"), "veiculo");
});

test("normalizarTipoBem aceita também o que o banco já guarda", () => {
  assert.equal(normalizarTipoBem("imovel"), "imovel");
  assert.equal(normalizarTipoBem("veiculo"), "veiculo");
  assert.equal(normalizarTipoBem("  IMÓVEL  "), "imovel");
});

test("normalizarTipoBem devolve null fora do vocabulário, nunca chuta", () => {
  // `null` é gravável (coluna nullable). Um valor inventado quebraria o check
  // `captacoes_tipo_bem_sano` e derrubaria o lead inteiro.
  for (const ruim of ["moto", "", "casa", null, 42, undefined, {}]) {
    assert.equal(normalizarTipoBem(ruim), null, `deveria recusar: ${String(ruim)}`);
  }
});

// ----------------------------------------------------------------------------
// Dinheiro como a página escreve
// ----------------------------------------------------------------------------

test("moedaParaNumero lê a máscara da página (milhar por ponto, sem centavos)", () => {
  // maskMoneyBR faz Number(digitos).toLocaleString("pt-BR"): só reais
  // inteiros. Tratar o ponto como decimal daria 150 — mil vezes menor.
  assert.equal(moedaParaNumero("150.000"), 150000);
  assert.equal(moedaParaNumero("1.250.000"), 1250000);
  assert.equal(moedaParaNumero("R$ 87.500"), 87500);
  assert.equal(moedaParaNumero("0"), 0);
  assert.equal(moedaParaNumero(150000), 150000);
});

test("moedaParaNumero distingue vazio de zero", () => {
  // Zero é resposta legítima (saldo devedor quitado). Vazio não é zero.
  assert.equal(moedaParaNumero(""), null);
  assert.equal(moedaParaNumero("abc"), null);
  assert.equal(moedaParaNumero(null), null);
  assert.equal(moedaParaNumero(-5), null);
  assert.equal(moedaParaNumero("0"), 0);
});

test("inteiroNaoNegativo aceita zero e recusa lixo", () => {
  assert.equal(inteiroNaoNegativo("36"), 36);
  assert.equal(inteiroNaoNegativo(0), 0);
  assert.equal(inteiroNaoNegativo(""), null);
  assert.equal(inteiroNaoNegativo(3.5), null);
  assert.equal(inteiroNaoNegativo(-1), null);
});

test("textoCurto apara, colapsa espaço e corta no limite", () => {
  assert.equal(textoCurto("  Porto   Seguro ", 120), "Porto Seguro");
  assert.equal(textoCurto("   ", 120), null);
  assert.equal(textoCurto(123, 120), null);
  assert.equal(textoCurto("x".repeat(200), 10), "x".repeat(10));
});

// ----------------------------------------------------------------------------
// Telefone e idempotência
// ----------------------------------------------------------------------------

test("digitosTelefone/telefoneValido aceitam a forma brasileira", () => {
  assert.equal(digitosTelefone("(19) 9 9543-1000"), "19995431000");
  assert.equal(telefoneValido("19995431000"), true);
  assert.equal(telefoneValido("1935431000"), true);
  assert.equal(telefoneValido("199954"), false);
});

test("chaveOrigem devolve null quando o telefone não serve de chave", () => {
  // Sem esta guarda, telefone curto viraria chave e o índice único parcial
  // colapsaria pessoas diferentes numa linha só.
  assert.equal(chaveOrigem("site", "199954"), null);
  assert.equal(chaveOrigem("site", ""), null);
  assert.equal(chaveOrigem("site", "19995431000"), "site:19995431000");
});

test("chaveOrigem separa por origem: mesma pessoa, portas diferentes", () => {
  assert.notEqual(
    chaveOrigem("site", "19995431000"),
    chaveOrigem("whatsapp", "19995431000")
  );
});

// ----------------------------------------------------------------------------
// PEDRA 1 — crédito líquido ao cessionário
// ----------------------------------------------------------------------------

test("creditoLiquido desconta o lance embutido", () => {
  assert.equal(creditoLiquido(200000, 40000), 160000);
  assert.equal(creditoLiquido(200000, null), 200000);
  assert.equal(creditoLiquido(200000, 0), 200000);
});

test("creditoLiquido devolve null quando não sobra crédito", () => {
  // Devolver 0 aqui faria a página exibir "R$ 0 a R$ 0" como se fosse
  // proposta real. Ausência de faixa não é faixa de zero.
  assert.equal(creditoLiquido(200000, 200000), null);
  assert.equal(creditoLiquido(200000, 250000), null);
  assert.equal(creditoLiquido(0, 0), null);
  assert.equal(creditoLiquido(null, 10), null);
  assert.equal(creditoLiquido(200000, -1), null);
});

test("a faixa sai sobre o LÍQUIDO, não sobre o bruto", () => {
  // A prova da pedra 1: com lance embutido, a conta sobre o bruto seria
  // maior — e maior justamente na cota que entrega menos poder de compra.
  const bruto = 200000;
  const lance = 40000;
  const liquido = creditoLiquido(bruto, lance);
  const faixa = faixaProposta(liquido);
  assert.ok(faixa);
  assert.equal(faixa.min, 160000 * PROPOSTA_MIN);
  assert.equal(faixa.max, 160000 * PROPOSTA_MAX);
  assert.ok(faixa.max < bruto * PROPOSTA_MAX, "faixa sobre bruto seria maior");
});

test("faixaProposta devolve null em vez de faixa vazia", () => {
  assert.equal(faixaProposta(null), null);
  assert.equal(faixaProposta(0), null);
  assert.equal(faixaProposta(-1), null);
});

// ----------------------------------------------------------------------------
// PEDRA 2 — tarifa da Conta Notarial (Informe CNB/CF nº 09/2026)
// ----------------------------------------------------------------------------

test("a tabela notarial tem as onze faixas do informe, na ordem", () => {
  assert.equal(TABELA_NOTARIAL.length, 11);
  TABELA_NOTARIAL.forEach((f, i) => assert.equal(f.faixa, i + 1));
  // Faixa 1 é valor FIXO; todas as outras são percentuais. Ler a faixa 1 como
  // percentual cobraria R$ 500 de "0,05%" — absurdo silencioso.
  assert.equal(TABELA_NOTARIAL[0].tipo, "fixa");
  assert.ok(TABELA_NOTARIAL.slice(1).every((f) => f.tipo === "percentual"));
  // Só a faixa 11 é aberta.
  assert.equal(TABELA_NOTARIAL[10].max, null);
  assert.ok(TABELA_NOTARIAL.slice(0, 10).every((f) => f.max !== null));
});

test("os percentuais caem monotonicamente da faixa 2 à 11", () => {
  // Controle contra erro de digitação na transcrição do informe: a curva do
  // documento é decrescente (0,45% -> 0,13%). Um dígito trocado a quebra.
  const perc = TABELA_NOTARIAL.slice(1).map((f) => f.valor);
  for (let i = 1; i < perc.length; i++) {
    assert.ok(perc[i] < perc[i - 1], `faixa ${i + 2} não é menor que a anterior`);
  }
  assert.equal(perc[0], 0.0045);
  assert.equal(perc[perc.length - 1], 0.0013);
});

test("abaixo de R$ 100 mil a tarifa é fixa, R$ 500,00", () => {
  // É a faixa que importa nesta página: a operação é a PROPOSTA (15–20% do
  // crédito), não o crédito. Carta de R$ 150 mil => operação ~R$ 30 mil.
  for (const v of [0, 1, 30000, 99999.99]) {
    const t = tarifaNotarial(v);
    assert.ok(t, `sem tarifa para ${v}`);
    assert.equal(t.valor, 500);
    assert.equal(t.faixa, 1);
    assert.equal(t.tipo, "fixa");
  }
});

test("as fronteiras das faixas caem do lado certo", () => {
  // Piso é inclusivo. Estes são exatamente os pontos onde um `>` no lugar de
  // `>=` erraria de faixa sem erro visível.
  assert.equal(tarifaNotarial(99999.99)?.faixa, 1);
  assert.equal(tarifaNotarial(100000)?.faixa, 2);
  assert.equal(tarifaNotarial(299999.99)?.faixa, 2);
  assert.equal(tarifaNotarial(300000)?.faixa, 3);
  assert.equal(tarifaNotarial(5999999.99)?.faixa, 10);
  assert.equal(tarifaNotarial(6000000)?.faixa, 11);
});

test("a faixa aberta não tem teto: valor gigante ainda responde", () => {
  // Buscar por teto criaria `null` aqui. Buscar por piso responde sempre.
  const t = tarifaNotarial(50000000);
  assert.ok(t);
  assert.equal(t.faixa, 11);
  assert.equal(t.valor, Math.round(50000000 * 0.0013 * 100) / 100);
});

test("o percentual incide sobre o depósito e sai em centavos", () => {
  const t = tarifaNotarial(250000);
  assert.ok(t);
  assert.equal(t.faixa, 2);
  assert.equal(t.valor, 1125); // 250.000 * 0,45%
  const q = tarifaNotarial(123456.78);
  assert.ok(q);
  assert.equal(q.valor, Math.round(123456.78 * 0.0045 * 100) / 100);
});

test("tarifaNotarial devolve null em vez de zero disfarçado", () => {
  assert.equal(tarifaNotarial(null), null);
  assert.equal(tarifaNotarial(-1), null);
  assert.equal(tarifaNotarial(Number.NaN), null);
  assert.equal(tarifaNotarial(Number.POSITIVE_INFINITY), null);
});

test("a tarifa NÃO é monotônica na fronteira de R$ 100 mil — e isso é fiel", () => {
  // MEDIDO em 29/08/2026, não deduzido: cruzar R$ 100.000,00 faz a tarifa CAIR
  // de R$ 500,00 para R$ 450,00, e ela só volta a R$ 500,00 em R$ 111.111,11.
  //
  // Isso NÃO é defeito desta tabela. É o que o INFORME NOTARIAL Nº 09/2026 diz:
  // faixa 1 é um valor FIXO de R$ 500,00 e a faixa 2 é 0,45% — e 0,45% de
  // R$ 100 mil é R$ 450. Quem reproduz o documento herda o degrau.
  //
  // O teste existe porque este é exatamente o tipo de coisa que um leitor futuro
  // "conserta" sozinho, achando que achou um bug de arredondamento. Se a tarifa
  // virar monotônica, ela deixou de ser a tabela do cartório e virou invenção
  // nossa — e aí o número na tela do cedente não tem fonte.
  assert.equal(tarifaNotarial(99999.99)?.valor, 500);
  assert.equal(tarifaNotarial(100000)?.valor, 450);
  assert.ok(
    (tarifaNotarial(100000)?.valor ?? 0) < (tarifaNotarial(99999.99)?.valor ?? 0),
    "a queda na fronteira sumiu: ou a tabela mudou, ou alguém 'consertou' o degrau"
  );
  // O ponto de retorno, para que o degrau tenha largura conhecida e não vire
  // folclore de corredor.
  assert.equal(tarifaNotarial(111111.11)?.valor, 500);
});

test("os 59% do tabelião NÃO entram no que o usuário paga", () => {
  // O informe diz que a remuneração do tabelião é 59% DA TARIFA — repartição
  // interna. Somar inflaria a conta em 59%. Este teste é a trava contra um
  // "conserto" futuro bem-intencionado.
  assert.equal(tarifaNotarial(250000)?.valor, 250000 * 0.0045);
  assert.equal(tarifaNotarial(30000)?.valor, 500);
  // E a constante existe para ser CITADA, nunca somada: se alguém a usar como
  // multiplicador, este número é o que ele vai encontrar.
  assert.equal(PARTE_TABELIAO, 0.59);
});

test("a procedência da tabela viaja junto com ela", () => {
  // Número sem fonte é número que ninguém confere. Estas duas constantes são
  // o que a página exibe embaixo da tarifa.
  assert.match(NOTARIAL_FONTE, /Informe Notarial nº 09\/2026/);
  assert.match(NOTARIAL_FONTE, /CNB\/CF/);
});

test("a ambiguidade de vigência do informe fica registrada, não resolvida", () => {
  // O documento diz "março" no subtítulo e "abril" no corpo. Escolher um dos
  // dois em silêncio seria inventar. A constante carrega a divergência para
  // quem for perguntar ao cartório.
  assert.match(NOTARIAL_VIGENCIA, /março/);
  assert.match(NOTARIAL_VIGENCIA, /abril/);
});

// ----------------------------------------------------------------------------
// ACOPLAMENTO — o HTML publicado contra as constantes do TS
// ----------------------------------------------------------------------------

const PAGINA = join(
  __dirname,
  "..",
  "..",
  "public",
  "vender-consorcio-contemplado.html"
);

function html(): string {
  return readFileSync(PAGINA, "utf8");
}

test("a página existe e é a que este módulo serve", () => {
  // Controle da Regra 9: se o caminho quebrar, os testes de acoplamento
  // abaixo passariam a medir string vazia e "passariam" sem provar nada.
  const fonte = html();
  assert.ok(fonte.length > 1000, "página vazia ou caminho errado");
  assert.match(fonte, /id="leadForm"/, "não é a página do cedente");
});

test("o texto obrigatório da faixa está na página, palavra por palavra", () => {
  assert.ok(
    html().includes(TEXTO_FAIXA),
    `a página não traz, literal: ${TEXTO_FAIXA}`
  );
});

test("o texto obrigatório da Conta Notarial está na página, palavra por palavra", () => {
  assert.ok(
    html().includes(TEXTO_NOTARIAL),
    `a página não traz, literal: ${TEXTO_NOTARIAL}`
  );
});

// ESTE TESTE JÁ ESTEVE ERRADO, e o erro foi medido antes de rodar.
//
// A primeira versão varria a PÁGINA INTEIRA atrás de LEXICO_PROIBIDO. Medindo,
// a página tem exatamente UMA ocorrência de "investimento" — dentro do aviso
// legal do rodapé, e numa NEGAÇÃO:
//
//     "Consórcio é compra programada, não investimento."
//
// ("investidor", "rendimento", "lucro" e "CDI": zero ocorrências.)
//
// Ou seja: o teste falharia sobre copy CORRETA, e a saída dele empurraria quem
// viesse depois a apagar um aviso legal para "consertar a suíte". Um teste que
// pressiona na direção do defeito é pior que teste nenhum. Por isso a trava é
// ESCOPADA à seção nova, delimitada por marcadores no HTML — e vem acompanhada
// do controle positivo abaixo, que prende a negação no lugar.
// SÃO DOIS TRECHOS, não um — e isso foi medido, não suposto. A primeira
// versão marcava só o markup; rodando o portão, a citação do informe não
// apareceu no escopo. Motivo: `simRender` monta em JS boa parte do que o
// cedente LÊ (a linha da tarifa, a nota da Conta Notarial), e o <script>
// estava fora dos marcadores. Uma trava de léxico que não alcança o texto
// gerado é trava de enfeite. Por isso o extrator colhe TODOS os pares.
const MARCA_INICIO = "CAPTACAO-OFERTA-01 F2 (INICIO)";
const MARCA_FIM = "CAPTACAO-OFERTA-01 F2 (FIM)";

/**
 * Trechos marcados, SEM comentários — comentário não chega ao usuário.
 *
 * O marcador de início mora DENTRO de um comentário nos dois casos (é a única
 * forma de marcar sem que a palavra apareça na tela). Logo a fatia começa no
 * meio de um comentário, sem o `<!--`/`/*` de abertura, e uma varredura
 * ingênua de comentários não o alcançaria. Por isso a primeira coisa que se
 * descarta é o RESTO do comentário de abertura: tudo até o primeiro fecha-
 * comentário, seja o do HTML ou o de bloco do JS. Se isso comer demais, os
 * testes de âncora (`id="simuladorOferta"`, `function simRender`) caem — que
 * é a rede armada embaixo desta manobra.
 */
function secaoNova(): string {
  const fonte = html();
  const partes: string[] = [];
  let cursor = 0;
  for (;;) {
    const i = fonte.indexOf(MARCA_INICIO, cursor);
    if (i < 0) break;
    const f = fonte.indexOf(MARCA_FIM, i);
    if (f < 0) break;
    partes.push(
      fonte
        .slice(i, f)
        // 1) o rabo do comentário onde o marcador vive
        .replace(/^[\s\S]*?(?:-->|\*\/)/, " ")
        // 2) comentários inteiros lá dentro
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
    );
    cursor = f + MARCA_FIM.length;
  }
  return partes.join("\n");
}

test("os marcadores existem, são DOIS pares, e cercam o que deviam", () => {
  // Controle da Regra 9. Sem isto, apagar um marcador faria `secaoNova()`
  // devolver "" e o teste de léxico passaria varrendo string vazia — a
  // trava viraria enfeite sem ninguém notar.
  const fonte = html();
  const pares = [...fonte.matchAll(/CAPTACAO-OFERTA-01 F2 \(INICIO\)/g)].length;
  assert.equal(pares, 2, `esperava 2 marcadores de início, achei ${pares}`);
  assert.equal(
    [...fonte.matchAll(/CAPTACAO-OFERTA-01 F2 \(FIM\)/g)].length,
    2,
    "número de marcadores de fim não bate com o de início"
  );

  const trecho = secaoNova();
  assert.ok(trecho.length > 500, `seção não encontrada ou vazia (${trecho.length} chars)`);
  assert.match(trecho, /id="simuladorOferta"/, "os marcadores não cercam o markup");
  assert.match(trecho, /function simRender/, "os marcadores não cercam o JS que rende texto");
});

test("o escopo descarta comentário — e o comentário descartado existe mesmo", () => {
  // Controle em duas pontas, para que nenhuma das duas passe por acidente:
  //   (a) a frase existe na PÁGINA (senão o controle não está medindo nada);
  //   (b) a frase NÃO existe no ESCOPO (é a prova de que o descarte funciona).
  // A frase escolhida é do comentário que fez este teste falhar da primeira
  // vez — ele contém a palavra proibida, legitimamente, para explicar a regra.
  const marca = "a página inteira não serve de escopo";
  assert.ok(html().includes(marca), "o comentário de referência sumiu: controle morto");
  assert.ok(
    !secaoNova().includes(marca),
    "o comentário vazou para dentro do escopo: o descarte parou de funcionar"
  );
});

test("PEDRA 4 — o léxico proibido não aparece na seção nova", () => {
  const trecho = secaoNova().toLowerCase();
  for (const palavra of LEXICO_PROIBIDO) {
    assert.ok(
      !trecho.includes(palavra.toLowerCase()),
      `léxico proibido na seção do simulador: ${palavra}`
    );
  }
});

test("PEDRA 4 — o aviso legal que NEGA investimento continua na página", () => {
  // Controle positivo do teste acima. A única ocorrência legítima da palavra
  // é esta negação; se alguém apagá-la para "limpar o léxico", a página perde
  // o aviso e este teste cai — que é o alarme certo.
  assert.match(
    html(),
    /compra programada, não investimento/i,
    "o aviso legal sumiu: a página deixou de negar 'investimento'"
  );
});

test("as palavras proibidas fora da negação continuam ausentes da página inteira", () => {
  // O escopo acima protege a copy nova; este aqui segura o resto da página
  // para os termos que NÃO têm uso legítimo em negação medida.
  const fonte = html().toLowerCase();
  for (const palavra of ["investidor", "rendimento", "lucro", "cdi"]) {
    assert.ok(!fonte.includes(palavra), `léxico proibido na página: ${palavra}`);
  }
});

test("PEDRA 4 — a página não promete contemplação nem prazo", () => {
  const fonte = html().toLowerCase();
  for (const proibido of [
    "garantia de contemplação",
    "contemplação garantida",
    "contemplação em até",
  ]) {
    assert.ok(!fonte.includes(proibido), `promessa na página: ${proibido}`);
  }
});

test("PEDRA 5 — a página não oferece Pix nem transferência direta", () => {
  // Pagamento só por Conta Notarial. "Pix direto" é o defeito que a Conta
  // Notarial existe para eliminar; se ele reaparecer na copy, a trava cai.
  const fonte = html().toLowerCase();
  for (const proibido of ["pix direto", "transferência direta", "sinal em pix"]) {
    assert.ok(!fonte.includes(proibido), `pagamento fora do trilho: ${proibido}`);
  }
});

test("os <option> de tipo de bem continuam sendo os que a rota normaliza", () => {
  // Se alguém trocar o value do <select> para "casa", `normalizarTipoBem`
  // passa a devolver null e o tipo some do lead — em silêncio. Este teste
  // prende as duas pontas.
  const fonte = html();
  const valores = [...fonte.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  const tipos = valores.filter((v) => normalizarTipoBem(v) !== null);
  assert.ok(
    tipos.length >= 2,
    `nenhum <option> da página normaliza para tipo_bem válido: ${valores.join(", ")}`
  );
});

// ----------------------------------------------------------------------------
// ESPELHO — a tabela notarial duplicada no HTML contra a do TS
//
// A página é estática: não tem bundler, não importa `lib/captacao.ts`. A
// tabela do informe está escrita DUAS vezes de propósito. Uma cópia literal
// envelhecida passa no tsc E passa em teste de conteúdo — só o teste de
// ACOPLAMENTO pega. Este é ele: mexer num lado sem o outro quebra a suíte.
// ----------------------------------------------------------------------------

type FaixaHtml = { faixa: number; min: number; tipo: string; valor: number };

function tabelaDoHtml(): FaixaHtml[] {
  const bloco = html().match(/var TAB_NOTARIAL=\[([\s\S]*?)\];/);
  if (!bloco) return [];
  return [...bloco[1].matchAll(
    /\{faixa:(\d+),min:(\d+),tipo:"(fixa|pct)",valor:([0-9.]+)\}/g
  )].map((m) => ({
    faixa: Number(m[1]),
    min: Number(m[2]),
    // O JS abrevia "percentual" como "pct" (byte de página conta). A tradução
    // mora aqui, explícita, e não numa suposição de quem lê depois.
    tipo: m[3] === "pct" ? "percentual" : "fixa",
    valor: Number(m[4]),
  }));
}

test("o HTML declara a tabela notarial de forma legível a este teste", () => {
  // Controle da Regra 9: minificar o bloco quebraria o regex e a comparação
  // abaixo passaria a comparar lista vazia com lista vazia.
  assert.equal(
    tabelaDoHtml().length,
    TABELA_NOTARIAL.length,
    "o parser não achou as onze faixas no HTML — regex ou formato mudou"
  );
});

test("ESPELHO — cada faixa do HTML bate com a do TS, número a número", () => {
  const doHtml = tabelaDoHtml();
  TABELA_NOTARIAL.forEach((ts, i) => {
    const js = doHtml[i];
    assert.ok(js, `faixa ${ts.faixa} não existe no HTML`);
    assert.equal(js.faixa, ts.faixa, `faixa fora de ordem na posição ${i}`);
    assert.equal(js.min, ts.min, `piso divergente na faixa ${ts.faixa}`);
    assert.equal(js.tipo, ts.tipo, `tipo divergente na faixa ${ts.faixa}`);
    assert.equal(js.valor, ts.valor, `valor divergente na faixa ${ts.faixa}`);
  });
});

test("a fonte da tarifa está citada na página, não é número órfão", () => {
  // PEDRA 2: número exibido sem origem é número que ninguém pode conferir.
  // O informe é a única autoridade que temos sobre esta tabela.
  assert.match(
    secaoNova(),
    /Informe Notarial/i,
    "a seção mostra tarifa sem citar o informe que a define"
  );
});

test("a página aponta para a rota que grava o lead", () => {
  // O defeito original da fatia: o formulário terminava em window.open(zap) e
  // NADA persistia. Este teste é a prova de que a porta existe na página.
  assert.match(
    html(),
    /https:\/\/app\.bidcon\.com\.br\/api\/captacao/,
    "a página não chama /api/captacao — o lead volta a se perder"
  );
});
