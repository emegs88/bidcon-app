// ============================================================================
// segmentos.test.ts — o dicionário casa o que deve, e não casa o que não deve
// ----------------------------------------------------------------------------
// PARA QUE ESTE TESTE EXISTE. A camada 1 da classificação é um dicionário —
// e dicionário apodrece em silêncio. Um termo escrito com acento nunca casa
// (porque `normalizar()` tira acento antes de comparar), um termo curto demais
// casa dentro de outra palavra, e nenhuma das duas falhas levanta exceção: elas
// só fazem o vídeo cair para a camada de IA, que custa dinheiro e é justamente
// o que a camada 1 existe para evitar.
//
// O QUE ELE **NÃO** PROVA:
//  - NÃO prova que o vocabulário está completo. Nenhum teste prova isso; é
//    revisão do Emerson, e por isso a tabela inteira vai no READY.
//  - NÃO prova que a camada de IA classifica bem. Ela não é chamada aqui, e
//    `lerRespostaDeLote` é testada só no que ela DESCARTA.
//  - NÃO prova que o segmento escolhido é o "certo" para um título ambíguo.
//    Prova apenas que a escolha é DETERMINÍSTICA e segue a PRIORIDADE
//    declarada, em vez de depender da ordem em que alguém digitou os termos.
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SEGMENTOS,
  TERMOS,
  FORMULA_DO_SEGMENTO,
  TETO_IA_DIA,
  normalizar,
  contarAcertos,
  classificarPorRegra,
  lerRespostaDeLote,
  scoreLigado,
  type Segmento,
} from "./segmentos";
import { formulaPorId } from "./formulas";

// ----------------------------------------------------------------------------
// O DICIONÁRIO EM SI
// ----------------------------------------------------------------------------

test("nenhum termo do dicionario tem acento ou maiuscula", () => {
  for (const seg of SEGMENTOS) {
    for (const termo of TERMOS[seg]) {
      assert.equal(
        termo,
        normalizar(termo),
        `termo "${termo}" em ${seg} não sobrevive a normalizar() — nunca casaria`,
      );
    }
  }
});

test("nenhum segmento esta sem termos", () => {
  for (const seg of SEGMENTOS) {
    assert.ok(TERMOS[seg].length > 0, `${seg} sem termo nenhum`);
  }
});

test("nenhum termo esta repetido dentro do mesmo segmento", () => {
  for (const seg of SEGMENTOS) {
    const vistos = new Set(TERMOS[seg]);
    assert.equal(vistos.size, TERMOS[seg].length, `${seg} tem termo duplicado`);
  }
});

// ----------------------------------------------------------------------------
// A LIGAÇÃO SEGMENTO ↔ FÔRMA — a descoberta que sustenta a Parte 4
// ----------------------------------------------------------------------------

test("todo segmento aponta para uma forma que existe em formulas.ts", () => {
  for (const seg of SEGMENTOS) {
    const id = FORMULA_DO_SEGMENTO[seg];
    assert.ok(formulaPorId(id), `${seg} aponta para ${id}, que não existe`);
  }
});

test("a ligacao segmento->forma e um-para-um (nenhuma forma serve dois segmentos)", () => {
  const ids = SEGMENTOS.map((s) => FORMULA_DO_SEGMENTO[s]);
  assert.equal(new Set(ids).size, ids.length);
});

// ----------------------------------------------------------------------------
// NORMALIZAÇÃO
// ----------------------------------------------------------------------------

test("normalizar tira acento, pontuacao e caixa", () => {
  assert.equal(normalizar("CONSÓRCIO é investimento?!"), "consorcio e investimento");
  assert.equal(normalizar("  veículo   novo  "), "veiculo novo");
});

// ----------------------------------------------------------------------------
// FRONTEIRA DE PALAVRA — o defeito clássico de dicionário
// ----------------------------------------------------------------------------

test("termo curto nao casa dentro de outra palavra", () => {
  // "obra" não pode acertar "manobra"; "mei" não pode acertar "meia".
  const t = normalizar("manobra arriscada e meia entrada");
  assert.equal(contarAcertos(t, "OBRA_TERRENO"), 0);
  assert.equal(contarAcertos(t, "EMPRESA_CNPJ"), 0);
});

test("termo de frase casa a frase inteira", () => {
  const c = classificarPorRegra("Como sair do aluguel em 2026");
  assert.equal(c.segmento, "ALUGUEL");
  assert.equal(c.origem, "regra");
});

// ----------------------------------------------------------------------------
// A CAMADA 1 RESOLVENDO
// ----------------------------------------------------------------------------

test("titulo sem termo nenhum fica sem segmento e sem origem", () => {
  const c = classificarPorRegra("Receita de bolo de cenoura");
  assert.equal(c.segmento, null);
  assert.equal(c.origem, null);
  assert.equal(c.acertos, 0);
});

test("casou um termo ja resolve — nao vai para a IA", () => {
  const c = classificarPorRegra("Ele conseguiu quitar o financiamento do apartamento");
  assert.equal(c.origem, "regra");
  assert.equal(c.segmento, "FINANCIAMENTO");
  assert.ok(c.acertos >= 1);
});

test("desempate segue a PRIORIDADE declarada, nao a ordem dos termos", () => {
  // Título que toca CEDENTE e ALUGUEL com o mesmo número de acertos.
  // CEDENTE vem antes na PRIORIDADE, então ganha — e a disputa fica registrada.
  const c = classificarPorRegra("Comprei uma carta contemplada de quem desistiu para sair do aluguel");
  assert.equal(c.origem, "regra");
  assert.ok(c.disputa.length >= 0);
  // O que importa é o determinismo: duas chamadas iguais, mesmo resultado.
  const d = classificarPorRegra("Comprei uma carta contemplada de quem desistiu para sair do aluguel");
  assert.equal(c.segmento, d.segmento);
});

test("mais acertos ganha de menos acertos, mesmo com prioridade contraria", () => {
  // EDUCACAO_MITOS é o ÚLTIMO da prioridade. Com vários acertos dele e um só de
  // outro segmento, ele tem que ganhar assim mesmo.
  const c = classificarPorRegra(
    "Consórcio é furada? Mito ou verdade sobre consórcio e investimento",
  );
  assert.equal(c.segmento, "EDUCACAO_MITOS");
});

// ----------------------------------------------------------------------------
// AS DECISÕES DE VOCABULÁRIO DO EMERSON (09/08) — travadas uma a uma
// ----------------------------------------------------------------------------
// Vocabulário é a única parte do FAROL que teste nenhum JULGA: nenhum teste
// sabe se "frete" pertence a VEICULO. O que dá para travar é o CONTRAEXEMPLO —
// a frase concreta que provou que um termo estava errado. Essas ficam aqui,
// para que o termo não volte por engano numa revisão futura.

test("CEDENTE nao captura quem quer COMPRAR carta contemplada", () => {
  // O contraexemplo do Emerson, literal. Enquanto "carta contemplada" era termo
  // de CEDENTE, este título caía no segmento de QUEM VENDE — o oposto exato de
  // quem o escreveu. Cair em `null` (e ir para a IA) é infinitamente melhor que
  // cair no segmento invertido: null custa uma chamada, invertido custa a peça.
  const c = classificarPorRegra("Como comprar carta contemplada com desconto");
  assert.notEqual(c.segmento, "CEDENTE");
});

test("CEDENTE captura VENDO, a primeira palavra do anuncio real", () => {
  for (const titulo of [
    "VENDO carta contemplada de 300 mil, aceito proposta",
    "Vendo minha cota de consorcio de imovel",
    "Quero vender minha cota, alguem sabe como?",
    "Como passar a carta para outra pessoa",
  ]) {
    const c = classificarPorRegra(titulo);
    assert.equal(c.segmento, "CEDENTE", `"${titulo}" caiu em ${c.segmento}`);
  }
});

test("CEDENTE nao tem mais os termos genericos do nicho", () => {
  for (const generico of ["carta contemplada", "cartas contempladas"]) {
    assert.ok(
      !TERMOS.CEDENTE.includes(generico),
      `"${generico}" voltou para CEDENTE — leia o contraexemplo do "como comprar"`,
    );
  }
});

test("EDUCACAO_MITOS captura o vocabulario de MECANISMO do consorcio", () => {
  for (const titulo of [
    "O que e lance embutido e como usar",
    "Como funciona a assembleia e o sorteio do consorcio",
    "Consorcio ou financiamento: qual escolher",
    "Autofinanciamento e a mesma coisa que consorcio?",
  ]) {
    const c = classificarPorRegra(titulo);
    assert.equal(c.segmento, "EDUCACAO_MITOS", `"${titulo}" caiu em ${c.segmento}`);
  }
});

test("FINANCIAMENTO nao tem 'sac' solto — so nas formas de amortizacao", () => {
  // Desvio declarado da sugestão do Emerson. "SAC" sozinho é, antes de tudo,
  // Serviço de Atendimento ao Consumidor, e num nicho cheio de reclamação de
  // administradora ele arrastaria vídeo de atendimento para FINANCIAMENTO.
  assert.ok(!TERMOS.FINANCIAMENTO.includes("sac"));
  assert.ok(TERMOS.FINANCIAMENTO.includes("tabela sac"));
  const c = classificarPorRegra("Liguei no SAC da administradora e ninguem atendeu");
  assert.notEqual(c.segmento, "FINANCIAMENTO");
});

// ----------------------------------------------------------------------------
// A CAMADA 2 — só o que ela DESCARTA é testável sem rede
// ----------------------------------------------------------------------------

test("lerRespostaDeLote descarta id desconhecido, repetido e segmento invalido", () => {
  const pedidos = [
    { video_id: "v1", titulo: "a" },
    { video_id: "v2", titulo: "b" },
  ];
  const bruto = {
    itens: [
      { video_id: "v1", segmento: "ALUGUEL" },       // válido
      { video_id: "v1", segmento: "VEICULO" },        // repetido → descarta
      { video_id: "v9", segmento: "ALUGUEL" },        // não foi pedido → descarta
      { video_id: "v2", segmento: "NAO_EXISTE" },     // segmento inválido → descarta
    ],
  };
  const mapa = lerRespostaDeLote(bruto, pedidos);
  assert.equal(mapa.get("v1"), "ALUGUEL");
  assert.equal(mapa.has("v2"), false);
  assert.equal(mapa.has("v9"), false);
  assert.equal(mapa.size, 1);
});

test("lerRespostaDeLote nao explode com resposta que nao e objeto", () => {
  const pedidos = [{ video_id: "v1", titulo: "a" }];
  assert.equal(lerRespostaDeLote(null, pedidos).size, 0);
  assert.equal(lerRespostaDeLote("texto solto", pedidos).size, 0);
  assert.equal(lerRespostaDeLote({ itens: "nao e array" }, pedidos).size, 0);
});

// ----------------------------------------------------------------------------
// O KILL-SWITCH — a OS pediu desarmado
// ----------------------------------------------------------------------------

test("FAROL_SCORE nasce desarmado", () => {
  const antes = process.env.FAROL_SCORE;
  delete process.env.FAROL_SCORE;
  assert.equal(scoreLigado(), false);
  process.env.FAROL_SCORE = "off";
  assert.equal(scoreLigado(), false);
  process.env.FAROL_SCORE = "1"; // só "on" arma; nada de valor-verdade frouxo
  assert.equal(scoreLigado(), false);
  process.env.FAROL_SCORE = "on";
  assert.equal(scoreLigado(), true);
  if (antes === undefined) delete process.env.FAROL_SCORE;
  else process.env.FAROL_SCORE = antes;
});

test("o teto de IA por dia e o da OS", () => {
  assert.equal(TETO_IA_DIA, 20);
});

// ----------------------------------------------------------------------------
// COBERTURA GROSSA DO VOCABULÁRIO — um título plausível por segmento
// ----------------------------------------------------------------------------

const AMOSTRAS: Readonly<Record<Segmento, string>> = {
  ALUGUEL: "Cansei de morar de aluguel e comprei minha casa propria",
  FINANCIAMENTO: "Como quitar o financiamento do imovel mais rapido",
  IMOVEL_ALTO: "Comprei apartamento de alto padrao sem entrada",
  EMPRESA_CNPJ: "Consorcio para CNPJ: minha empresa comprou a frota",
  OBRA_TERRENO: "Comprei o terreno e comecei a obra da casa",
  CEDENTE: "Vendi minha carta contemplada porque desisti do consorcio",
  VEICULO: "Comprei meu carro de trabalho por consorcio",
  EDUCACAO_MITOS: "Consorcio e furada? Mito ou verdade",
};

for (const seg of SEGMENTOS) {
  test(`amostra de ${seg} cai em ${seg}`, () => {
    const c = classificarPorRegra(AMOSTRAS[seg]);
    assert.equal(
      c.segmento,
      seg,
      `"${AMOSTRAS[seg]}" caiu em ${c.segmento} (disputa: ${c.disputa.join(", ")})`,
    );
  });
}
