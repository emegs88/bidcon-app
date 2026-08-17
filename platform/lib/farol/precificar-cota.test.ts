// ============================================================================
// Testes de lib/farol/precificar-cota.ts — EXTRATO-ANALISE-01, Entregas 2 e 3.
// ----------------------------------------------------------------------------
// OS NÚMEROS DAQUI SÃO MEDIDOS, NÃO INVENTADOS. A cota de referência é a da
// mensagem 27 da conversa 9eb5f278 (o `EXTRATO.pdf` que o cedente mandou):
//
//   crédito R$ 130.584,16 · parcela R$ 854,67 · 109 parcelas restantes
//   saldo devedor declarado no extrato: R$ 93.147,03
//
// Dela saem os dois valores que este arquivo trava:
//   break-even do ágio  R$ 37.425,13  (28,66% do crédito)
//   ágio no teto 1,00%  R$ 74.008,56  (56,67% do crédito)
//
// O segundo é a razão de existir metade destes testes. A ordem pediu varredura
// de 5% a 40%; nesta cota o teto de imóvel só morde perto de 56,7%. Uma tela que
// parasse em 40% e mostrasse linha em branco mentiria por omissão — daí o
// `aviso` com a frase literal que o Emerson mandou escrever.
//
// TOLERÂNCIAS: dinheiro é comparado com folga de centavos e taxa com folga de
// 1e-6, porque bisseção converge por aproximação. Travar bit a bit transformaria
// um teste de regra de negócio num teste de ponto flutuante.
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  custoAoMes,
  dentroDoTeto,
  cenario,
  agioDeBreakEven,
  agioMaximoNoTeto,
  varrerAgio,
  posicaoNoEstoque,
  estadoDoExtrato,
  naturezaParaFee,
  bloqueioDeVitrine,
  rotuloPiso,
  TETO_CUSTO_AM,
  FAIXA_PADRAO,
  LIMITE_BUSCA_TETO,
  type Comparavel,
  type EntradaPrecificacao,
} from "./precificar-cota";
import { taxaEfetivaMensal } from "../custo-efetivo";
import { tirMensal } from "../tir";
import { FEE_MINIMO } from "../reserve/fee-plan";

// ----- A cota real, medida -------------------------------------------------

const CREDITO = 130584.16;
const PARCELA = 854.67;
const PRAZO = 109;

/** R$ 37.425,13 — medido. */
const BREAK_EVEN = CREDITO - PARCELA * PRAZO;

/** Entrada neutra; cada teste sobrescreve só o que interessa a ele. */
function entrada(over: Partial<EntradaPrecificacao> = {}): EntradaPrecificacao {
  return {
    valor_credito: CREDITO,
    valor_parcela: PARCELA,
    parcelas_restantes: PRAZO,
    estado: "contemplada",
    tipo_bem: "imovel",
    ...over,
  };
}

// ============================================================================
// custoAoMes — os dois `null` opostos, separados (desvio aprovado pelo Emerson)
// ============================================================================

test("custoAoMes: falta de dado vira `incompleta` com o nome do que falta", () => {
  const c = custoAoMes(null, null, null);
  assert.equal(c.tipo, "incompleta");
  if (c.tipo !== "incompleta") return;
  assert.deepEqual(c.faltam, ["saldo", "valor da parcela", "parcelas restantes"]);
});

test("custoAoMes: `incompleta` nomeia SÓ o campo que falta", () => {
  const c = custoAoMes(50000, null, 109);
  assert.equal(c.tipo, "incompleta");
  if (c.tipo !== "incompleta") return;
  assert.deepEqual(c.faltam, ["valor da parcela"]);
});

test("custoAoMes: parcela x prazo <= saldo é `sem_custo`, não é falta de dado", () => {
  // 854,67 x 109 = 93.159,03. Um saldo maior que isso significa pagar menos do
  // que se recebe.
  const c = custoAoMes(100000, PARCELA, PRAZO);
  assert.equal(c.tipo, "sem_custo");
});

test("custoAoMes: `sem_custo` e `incompleta` NÃO são o mesmo estado", () => {
  // É o desvio aprovado: na vitrine os dois viram "—"; numa tela de análise o
  // mesmo traço para um extrato ilegível e para a melhor cota do estoque seria
  // o verde vazio outra vez.
  const semCusto = custoAoMes(100000, PARCELA, PRAZO);
  const incompleta = custoAoMes(100000, null, PRAZO);
  assert.notEqual(semCusto.tipo, incompleta.tipo);
});

test("custoAoMes: saldo <= 0 é `inviavel`, e inviável não é zero", () => {
  const c = custoAoMes(0, PARCELA, PRAZO);
  assert.equal(c.tipo, "inviavel");
  const negativo = custoAoMes(-1, PARCELA, PRAZO);
  assert.equal(negativo.tipo, "inviavel");
});

test("custoAoMes: com dado completo devolve `ok` com a taxa em % a.m.", () => {
  const c = custoAoMes(80584.16, PARCELA, PRAZO);
  assert.equal(c.tipo, "ok");
  if (c.tipo !== "ok") return;
  assert.ok(c.taxa_am > 0, "taxa deve ser positiva");
  assert.ok(c.taxa_am < 100, "taxa não pode saturar aqui");
});

test("custoAoMes: NÃO reimplementa matemática — delega a taxaEfetivaMensal", () => {
  const saldo = 80584.16;
  const c = custoAoMes(saldo, PARCELA, PRAZO);
  assert.equal(c.tipo, "ok");
  if (c.tipo !== "ok") return;
  assert.equal(c.taxa_am, taxaEfetivaMensal(saldo, PARCELA, PRAZO));
});

// ============================================================================
// dentroDoTeto
// ============================================================================

test("dentroDoTeto: `sem_custo` está sempre dentro", () => {
  assert.equal(dentroDoTeto({ tipo: "sem_custo" }, TETO_CUSTO_AM.imovel), true);
});

test("dentroDoTeto: o limite é inclusivo", () => {
  assert.equal(dentroDoTeto({ tipo: "ok", taxa_am: 1.0 }, 1.0), true);
  assert.equal(dentroDoTeto({ tipo: "ok", taxa_am: 1.000001 }, 1.0), false);
});

test("dentroDoTeto: ausência de dado NUNCA é aprovação", () => {
  assert.equal(dentroDoTeto({ tipo: "incompleta", faltam: ["saldo"] }, 1.0), false);
  assert.equal(dentroDoTeto({ tipo: "inviavel" }, 1.0), false);
});

test("TETO_CUSTO_AM: imóvel 1,00% e veículo 1,50% a.m., como manda a ordem", () => {
  assert.equal(TETO_CUSTO_AM.imovel, 1.0);
  assert.equal(TETO_CUSTO_AM.veiculo, 1.5);
});

// ============================================================================
// agioDeBreak-even — forma fechada, sem busca
// ============================================================================

test("agioDeBreakEven: na cota real dá R$ 37.425,13 (28,66% do crédito)", () => {
  const a = agioDeBreakEven(CREDITO, PARCELA, PRAZO);
  assert.ok(a !== null);
  assert.ok(Math.abs((a as number) - 37425.13) < 0.01, `esperado ~37425,13, veio ${a}`);
  assert.ok(Math.abs((a as number) / CREDITO - 0.2866) < 0.0001);
});

test("agioDeBreakEven: é exatamente a fronteira entre sem_custo e ok", () => {
  const a = agioDeBreakEven(CREDITO, PARCELA, PRAZO) as number;
  // Um centavo abaixo da virada: ainda sem custo.
  assert.equal(custoAoMes(CREDITO - (a - 0.01), PARCELA, PRAZO).tipo, "sem_custo");
  // Um real acima: já tem custo.
  assert.equal(custoAoMes(CREDITO - (a + 1), PARCELA, PRAZO).tipo, "ok");
});

test("agioDeBreakEven: devolve null quando a cota já nasce com custo de graça", () => {
  // parcela x prazo > crédito: nem com ágio zero a cota é sem_custo.
  assert.equal(agioDeBreakEven(50000, PARCELA, PRAZO), null);
});

// ============================================================================
// agioMaximoNoTeto — bisseção, nunca Newton (doutrina do CLAUDE.md)
// ============================================================================

test("agioMaximoNoTeto: na cota real o teto de 1,00% morde em R$ 74.008,56", () => {
  const a = agioMaximoNoTeto(CREDITO, PARCELA, PRAZO, TETO_CUSTO_AM.imovel);
  assert.ok(a !== null);
  assert.ok(Math.abs((a as number) - 74008.56) < 1, `esperado ~74008,56, veio ${a}`);
});

test("agioMaximoNoTeto: no valor devolvido o custo cabe, e um real acima estoura", () => {
  const teto = TETO_CUSTO_AM.imovel;
  const a = agioMaximoNoTeto(CREDITO, PARCELA, PRAZO, teto) as number;

  const dentro = custoAoMes(CREDITO - a, PARCELA, PRAZO);
  assert.equal(dentro.tipo, "ok");
  if (dentro.tipo === "ok") assert.ok(dentro.taxa_am <= teto, `${dentro.taxa_am} > ${teto}`);

  const fora = custoAoMes(CREDITO - (a + 1), PARCELA, PRAZO);
  assert.equal(fora.tipo, "ok");
  if (fora.tipo === "ok") assert.ok(fora.taxa_am > teto, `${fora.taxa_am} <= ${teto}`);
});

test("agioMaximoNoTeto: teto mais folgado admite ágio maior (custo é monotônico)", () => {
  const imovel = agioMaximoNoTeto(CREDITO, PARCELA, PRAZO, TETO_CUSTO_AM.imovel) as number;
  const veiculo = agioMaximoNoTeto(CREDITO, PARCELA, PRAZO, TETO_CUSTO_AM.veiculo) as number;
  assert.ok(veiculo > imovel, `veículo ${veiculo} deveria passar de imóvel ${imovel}`);
});

test("agioMaximoNoTeto: null quando o teto não limita nem no extremo da busca", () => {
  // Medido: crédito 100.000 · parcela 60 · 100 parcelas. No extremo da busca
  // (95% de ágio) o saldo é 5.000 e o total pago é 6.000 — custo de 0,3732% a.m.,
  // ainda abaixo de 1%. Logo não existe ágio que faça o teto morder, e o null é
  // a resposta, não uma falha.
  const noExtremo = custoAoMes(100000 * (1 - LIMITE_BUSCA_TETO), 60, 100);
  assert.equal(noExtremo.tipo, "ok");
  if (noExtremo.tipo === "ok") assert.ok(noExtremo.taxa_am < TETO_CUSTO_AM.imovel);

  assert.equal(agioMaximoNoTeto(100000, 60, 100, TETO_CUSTO_AM.imovel), null);
});

test("agioMaximoNoTeto: parcela pequena com prazo longo AINDA encontra o teto", () => {
  // Contraprova do teste acima, e correção de um chute meu: "parcela pequena"
  // não implica "teto não morde". Com 100 x 500 o total pago é 50.000 contra um
  // saldo de 5.000 no extremo — o custo explode e o teto limita em 90.069,07.
  const a = agioMaximoNoTeto(100000, 100, 500, TETO_CUSTO_AM.imovel);
  assert.ok(a !== null);
  assert.ok(Math.abs((a as number) - 90069.07) < 1, `veio ${a}`);
});

test("agioMaximoNoTeto: zero quando nem de graça a cota cabe no teto", () => {
  // Parcela alta demais: com ágio zero o custo já passa de 1% a.m.
  const a = agioMaximoNoTeto(100000, 3000, 60, TETO_CUSTO_AM.imovel);
  assert.equal(a, 0);
});

test("agioMaximoNoTeto: entrada inválida devolve null, não um número", () => {
  assert.equal(agioMaximoNoTeto(0, PARCELA, PRAZO, 1.0), null);
  assert.equal(agioMaximoNoTeto(CREDITO, 0, PRAZO, 1.0), null);
  assert.equal(agioMaximoNoTeto(CREDITO, PARCELA, 0, 1.0), null);
  assert.equal(agioMaximoNoTeto(CREDITO, PARCELA, PRAZO, 0), null);
});

// ============================================================================
// varrerAgio — a tabela da Entrega 2
// ============================================================================

test("varrerAgio: a faixa pedida vai de 5% a 40% de 1 em 1 ponto (36 linhas)", () => {
  assert.equal(FAIXA_PADRAO.min, 0.05);
  assert.equal(FAIXA_PADRAO.max, 0.4);
  assert.equal(FAIXA_PADRAO.passo, 0.01);

  const v = varrerAgio(entrada());
  const naFaixa = v.linhas.filter((l) => l.agio_pct <= FAIXA_PADRAO.max + 1e-6);
  assert.equal(naFaixa.length, 36, "5%..40% de 1 em 1 são 36 pontos");
});

test("varrerAgio: na cota real o teto NÃO limita na faixa, e a frase é literal", () => {
  const v = varrerAgio(entrada());
  assert.equal(v.status, "ok");
  assert.equal(v.teto_nao_limita_na_faixa, true);
  // Frase ordenada pelo Emerson, ao pé da letra.
  assert.equal(v.aviso, "o teto não limita nesta faixa");
});

test("varrerAgio: quando o teto morde fora da faixa, a linha do ponto exato é acrescentada", () => {
  const v = varrerAgio(entrada());
  const ultima = v.linhas[v.linhas.length - 1];
  assert.ok(
    ultima.agio_pct > FAIXA_PADRAO.max,
    "a última linha deve estar além dos 40% pedidos — é ela que responde 'a partir de quanto encalha'",
  );
  assert.ok(Math.abs(ultima.agio - 74008.56) < 1);
  assert.equal(v.linhas.length, 37, "36 da faixa + 1 do ponto exato do teto");
});

test("varrerAgio: nenhuma linha DENTRO da faixa pedida estoura o teto nesta cota", () => {
  const v = varrerAgio(entrada());
  const naFaixa = v.linhas.filter((l) => l.agio_pct <= FAIXA_PADRAO.max + 1e-6);
  for (const l of naFaixa) {
    assert.equal(l.dentro_do_teto, true, `${(l.agio_pct * 100).toFixed(0)}% estourou`);
  }
});

test("varrerAgio: reporta o break-even e o ágio máximo no teto", () => {
  const v = varrerAgio(entrada());
  assert.ok(Math.abs((v.agio_break_even as number) - 37425.13) < 0.01);
  assert.ok(Math.abs((v.agio_maximo_no_teto as number) - 74008.56) < 1);
  assert.equal(v.teto_am, TETO_CUSTO_AM.imovel);
});

test("varrerAgio: abaixo do break-even as linhas são sem_custo; acima, ok", () => {
  const v = varrerAgio(entrada());
  for (const l of v.linhas) {
    const esperado = l.agio < BREAK_EVEN ? "sem_custo" : "ok";
    assert.equal(l.custo.tipo, esperado, `ágio ${l.agio} deveria ser ${esperado}`);
  }
});

test("varrerAgio: estado ausente é `incompleta` — nunca vira cancelada por atalho", () => {
  const v = varrerAgio(entrada({ estado: null }));
  assert.equal(v.status, "incompleta");
  assert.ok(v.faltam.some((f) => f.includes("situação da cota")));
  assert.equal(v.linhas.length, 0, "incompleta não pode produzir preço nenhum");
  assert.equal(v.agio_maximo_no_teto, null);
  assert.equal(v.aviso, null);
  assert.equal(v.bloqueio, null, "sem estado não há bandeira — e null não é 'liberado'");
});

test("varrerAgio: tipo do bem ausente é `incompleta` — sem teto não há veredito", () => {
  const v = varrerAgio(entrada({ tipo_bem: null }));
  assert.equal(v.status, "incompleta");
  assert.ok(v.faltam.some((f) => f.includes("tipo do bem")));
  assert.equal(v.teto_am, null);
});

test("varrerAgio: cada campo faltante aparece nomeado, para virar pergunta ao cedente", () => {
  const v = varrerAgio({
    valor_credito: null,
    valor_parcela: null,
    parcelas_restantes: null,
    estado: null,
    tipo_bem: null,
  });
  assert.equal(v.status, "incompleta");
  assert.equal(v.faltam.length, 5);
  assert.ok(v.faltam.some((f) => f.includes("crédito")));
  assert.ok(v.faltam.some((f) => f.includes("parcela")));
  assert.ok(v.faltam.some((f) => f.includes("restantes")));
});

test("varrerAgio: zero e negativo não passam por 'preenchido'", () => {
  assert.equal(varrerAgio(entrada({ valor_credito: 0 })).status, "incompleta");
  assert.equal(varrerAgio(entrada({ valor_parcela: -1 })).status, "incompleta");
  assert.equal(varrerAgio(entrada({ parcelas_restantes: 0 })).status, "incompleta");
});

test("varrerAgio: o aviso passa no léxico proibido da casa", () => {
  const v = varrerAgio(entrada());
  const texto = v.aviso as string;
  assert.doesNotMatch(texto, /investimento|investidor|rendimento|retorno|lucro|CDI/i);
  assert.doesNotMatch(texto, /contempla(ção|do|da)/i);
  assert.doesNotMatch(texto, /prazo de venda|garant/i);
  assert.doesNotMatch(texto, /juros|CET/i);
});

test("varrerAgio: com teto que morde dentro da faixa, não há aviso", () => {
  // Parcela alta o bastante para o teto de 1% morder cedo.
  const v = varrerAgio(entrada({ valor_parcela: 1600 }));
  assert.equal(v.status, "ok");
  assert.equal(v.teto_nao_limita_na_faixa, false);
  assert.equal(v.aviso, null, "aviso só existe quando o teto realmente não limita");
  assert.ok(v.linhas.some((l) => l.dentro_do_teto === false), "alguma linha deve estourar");
});

// ============================================================================
// cenário: fee, piso nomeado, e quem recebe o quê
// ============================================================================

test("cenario: entrada do comprador é o ágio — o fee mora DENTRO dele", () => {
  const c = cenario(40000, CREDITO, PARCELA, PRAZO, "contemplada", 1.0);
  assert.equal(c.entrada_comprador, c.agio);
  assert.equal(c.ao_cedente, c.agio - c.fee);
});

test("cenario: o piso de R$ 2.500 aparece NOMEADO abaixo de R$ 25.000 de ágio", () => {
  const pequeno = cenario(10000, CREDITO, PARCELA, PRAZO, "contemplada", 1.0);
  assert.equal(pequeno.fee, FEE_MINIMO);
  assert.equal(pequeno.piso_aplicado, true, "o piso não pode ser diluído dentro do preço");
  assert.equal(pequeno.ao_cedente, 7500);
});

test("cenario: em R$ 25.000 o percentual alcança o piso e ele deixa de mandar", () => {
  const naVirada = cenario(25000, CREDITO, PARCELA, PRAZO, "contemplada", 1.0);
  assert.equal(naVirada.fee, 2500);
  assert.equal(naVirada.piso_aplicado, false);

  const abaixo = cenario(24999, CREDITO, PARCELA, PRAZO, "contemplada", 1.0);
  assert.equal(abaixo.fee, 2500, "abaixo o piso segura o fee");
  assert.equal(abaixo.piso_aplicado, true);
});

test("cenario: contemplada 10% e cancelada 6% — por isso o estado não se adivinha", () => {
  const contemplada = cenario(40000, CREDITO, PARCELA, PRAZO, "contemplada", 1.0);
  const cancelada = cenario(40000, CREDITO, PARCELA, PRAZO, "cancelada", 1.0);
  assert.equal(contemplada.fee, 4000);
  assert.equal(cancelada.fee, 2400 < FEE_MINIMO ? FEE_MINIMO : 2400);
  assert.notEqual(contemplada.ao_cedente, cancelada.ao_cedente);
});

test("cenario: o custo cai sobre o saldo (crédito - ágio), não sobre o crédito", () => {
  const c = cenario(50000, CREDITO, PARCELA, PRAZO, "contemplada", 1.0);
  assert.deepEqual(c.custo, custoAoMes(CREDITO - 50000, PARCELA, PRAZO));
});

test("cenario: mais ágio nunca barateia — o custo é monotônico crescente", () => {
  let anterior = -Infinity;
  for (let agio = 40000; agio <= 80000; agio += 5000) {
    const c = cenario(agio, CREDITO, PARCELA, PRAZO, "contemplada", 1.0);
    const taxa = c.custo.tipo === "ok" ? c.custo.taxa_am : -1;
    assert.ok(taxa >= anterior, `ágio ${agio} baixou a taxa: ${taxa} < ${anterior}`);
    anterior = taxa;
  }
});

// ============================================================================
// Os TRÊS estados da análise contra os DOIS da vitrine
// (decisão do Emerson em 10/08/2026)
// ============================================================================

test("estadoDoExtrato: false vira `nao_contemplada`, NUNCA `cancelada`", () => {
  // O atalho tentador — tratar `contemplada: false` como cancelada — trocaria o
  // fee de 10% por 6% em silêncio. Cancelamento é informação da administradora,
  // e entra por correção humana na tela; não sai de dedução nossa.
  assert.equal(estadoDoExtrato(true), "contemplada");
  assert.equal(estadoDoExtrato(false), "nao_contemplada");
});

test("estadoDoExtrato: null continua null — campo não lido não vira estado", () => {
  assert.equal(estadoDoExtrato(null), null);
});

test("naturezaParaFee: só `cancelada` muda o percentual", () => {
  assert.equal(naturezaParaFee("contemplada"), "contemplada");
  assert.equal(naturezaParaFee("nao_contemplada"), "contemplada");
  assert.equal(naturezaParaFee("cancelada"), "cancelada");
});

test("bloqueioDeVitrine: a frase da regra da casa, ao pé da letra", () => {
  assert.deepEqual(bloqueioDeVitrine("contemplada"), { bloqueia: false, motivo: null });
  assert.deepEqual(bloqueioDeVitrine("nao_contemplada"), {
    bloqueia: true,
    motivo: "não contemplada — não entra na vitrine",
  });
  assert.deepEqual(bloqueioDeVitrine("cancelada"), {
    bloqueia: true,
    motivo: "cancelada — não entra na vitrine",
  });
});

test("varrerAgio: `nao_contemplada` PRECIFICA normalmente — o bloqueio é de publicação", () => {
  // Medido: a aritmética é bit a bit a mesma da contemplada (mesmos fees, mesmo
  // ágio no teto). O que muda é só a bandeira. Recusar o cálculo aqui deixaria o
  // cedente sem resposta a uma pergunta legítima.
  const contemplada = varrerAgio(entrada({ estado: "contemplada" }));
  const nao = varrerAgio(entrada({ estado: "nao_contemplada" }));

  assert.equal(nao.status, "ok");
  assert.equal(nao.linhas.length, contemplada.linhas.length);
  assert.equal(nao.agio_maximo_no_teto, contemplada.agio_maximo_no_teto);
  assert.deepEqual(
    nao.linhas.map((l) => l.fee),
    contemplada.linhas.map((l) => l.fee),
    "não contemplada paga os mesmos 10% — o estado não mexe no fee",
  );
});

test("varrerAgio: a bandeira bloqueante viaja JUNTO com o preço, não em vez dele", () => {
  const nao = varrerAgio(entrada({ estado: "nao_contemplada" }));
  assert.equal(nao.bloqueio?.bloqueia, true);
  assert.equal(nao.bloqueio?.motivo, "não contemplada — não entra na vitrine");
  assert.ok(nao.linhas.length > 0, "bloquear publicação não é apagar o preço");

  const ok = varrerAgio(entrada({ estado: "contemplada" }));
  assert.equal(ok.bloqueio?.bloqueia, false);
  assert.equal(ok.bloqueio?.motivo, null);
});

// ============================================================================
// O piso com percentual efetivo — regra de tela do Emerson
// ============================================================================

test("rotuloPiso: a frase do Emerson, com o percentual efetivo dentro dela", () => {
  // Medido na linha de 5% da cota real: ágio R$ 6.529,21, fee travado no piso de
  // R$ 2.500 — que são 38,29% do ágio, não os 10% nominais. É este número que
  // decide se o negócio faz sentido para o cedente pequeno.
  assert.equal(rotuloPiso(2500 / 6529.21), "piso aplicado — 38,3% do ágio neste preço");
  assert.equal(rotuloPiso(0.25), "piso aplicado — 25,0% do ágio neste preço");
});

test("rotuloPiso: vírgula decimal, porque a tela é brasileira", () => {
  assert.doesNotMatch(rotuloPiso(0.125), /\d\.\d/, "ponto decimal não passa");
  assert.match(rotuloPiso(0.125), /12,5%/);
});

test("rotuloPiso: o texto passa no léxico proibido da casa", () => {
  const t = rotuloPiso(0.383);
  assert.doesNotMatch(t, /investimento|investidor|rendimento|retorno|lucro|CDI/i);
  assert.doesNotMatch(t, /juros|CET/i);
});

test("cenario: onde o piso manda, o efetivo dispara muito acima dos 10% nominais", () => {
  // Medido: fee 2.500 sobre ágio 6.529,21 = 38,2895%.
  const c = cenario(6529.21, CREDITO, PARCELA, PRAZO, "contemplada", 1.0);
  assert.equal(c.piso_aplicado, true);
  assert.equal(c.fee, FEE_MINIMO);
  assert.ok(Math.abs(c.fee_pct_efetivo - 0.382895) < 1e-6, `veio ${c.fee_pct_efetivo}`);
  assert.equal(c.rotulo_piso, "piso aplicado — 38,3% do ágio neste preço");
});

test("cenario: sem piso, o efetivo é o percentual nominal e não há rótulo", () => {
  const c = cenario(40000, CREDITO, PARCELA, PRAZO, "contemplada", 1.0);
  assert.equal(c.piso_aplicado, false);
  assert.ok(Math.abs(c.fee_pct_efetivo - 0.1) < 1e-9);
  assert.equal(c.rotulo_piso, null, "rótulo sem piso seria ruído");
});

test("cenario: `fee_pct_efetivo` é o fee REAL sobre o ágio, sempre", () => {
  for (const agio of [6529.21, 10000, 20000, 24999, 25000, 40000, 80000]) {
    const c = cenario(agio, CREDITO, PARCELA, PRAZO, "contemplada", 1.0);
    assert.ok(
      Math.abs(c.fee_pct_efetivo - c.fee / agio) < 1e-12,
      `ágio ${agio}: efetivo ${c.fee_pct_efetivo} != ${c.fee}/${agio}`,
    );
  }
});

test("cenario: em cancelada o piso manda muito mais longe (até ~R$ 41.666 de ágio)", () => {
  // Medido: 6% de 41.666 ainda não alcança R$ 2.500. Um cedente de cota
  // cancelada com ágio de R$ 40.000 paga piso, e o efetivo é 6,3% — não 6%.
  const c = cenario(40000, CREDITO, PARCELA, PRAZO, "cancelada", 1.0);
  assert.equal(c.piso_aplicado, true);
  assert.equal(c.fee, FEE_MINIMO);
  assert.equal(c.rotulo_piso, "piso aplicado — 6,3% do ágio neste preço");

  const acima = cenario(41667, CREDITO, PARCELA, PRAZO, "cancelada", 1.0);
  assert.equal(acima.piso_aplicado, false);
  assert.equal(acima.rotulo_piso, null);
});

test("varrerAgio: na cota real o piso manda de 5% a 19% do crédito — 15 linhas", () => {
  // Medido. É o achado que virou regra de tela: nas quinze primeiras linhas o
  // fee é o mesmo R$ 2.500 e só o efetivo distingue uma da outra.
  const v = varrerAgio(entrada());
  const comPiso = v.linhas.filter((l) => l.piso_aplicado);
  assert.equal(comPiso.length, 15);
  for (const l of comPiso) {
    assert.equal(l.fee, FEE_MINIMO);
    assert.ok(l.rotulo_piso !== null, "linha com piso sem rótulo é o piso diluído de novo");
  }
  // A primeira linha sem piso é a de 20%: ágio R$ 26.116,83, fee R$ 2.611,68.
  const primeiraSemPiso = v.linhas.find((l) => !l.piso_aplicado);
  assert.ok(Math.abs((primeiraSemPiso as (typeof v.linhas)[number]).agio - 26116.83) < 0.01);
  assert.equal(primeiraSemPiso?.rotulo_piso, null);
});

// ============================================================================
// Cruzamento das duas canônicas da casa
// ============================================================================

test("taxaEfetivaMensal (%) e tirMensal (fração) concordam no mesmo fluxo", () => {
  // As duas funções canônicas da casa têm UNIDADES diferentes: `tirMensal`
  // devolve fração (0,0027) e `taxaEfetivaMensal` devolve percentual (0,27).
  // Este teste existe para que a diferença fique medida e não vire bug de
  // alguém multiplicar por 100 duas vezes.
  const saldo = CREDITO - 50000;
  const fluxo = [saldo, ...Array.from({ length: PRAZO }, () => -PARCELA)];

  const pct = taxaEfetivaMensal(saldo, PARCELA, PRAZO);
  const fracao = tirMensal(fluxo);
  assert.ok(pct !== null && fracao !== null);
  assert.ok(
    Math.abs((pct as number) - (fracao as number) * 100) < 1e-6,
    `taxaEfetivaMensal=${pct} vs tirMensal*100=${(fracao as number) * 100}`,
  );
});

test("LIMITE_BUSCA_TETO fica além da faixa pedida — é o que permite achar o teto", () => {
  assert.ok(LIMITE_BUSCA_TETO > FAIXA_PADRAO.max);
  assert.ok(LIMITE_BUSCA_TETO < 1, "ceder 100% do crédito não é cenário de ágio");
});

// ============================================================================
// Entrega 3 — posição no estoque
// ============================================================================

const UNIVERSO: Comparavel[] = [
  { id: "a", valor_credito: 120000, custo_am: 0.4 }, // dentro da banda
  { id: "b", valor_credito: 130000, custo_am: 0.8 }, // dentro
  { id: "c", valor_credito: 150000, custo_am: 0.2 }, // dentro
  { id: "d", valor_credito: 60000, custo_am: 0.1 }, // FORA (crédito baixo)
  { id: "e", valor_credito: 300000, custo_am: 0.05 }, // FORA (crédito alto)
];

test("posicaoNoEstoque: a banda de ±20% filtra o universo", () => {
  const p = posicaoNoEstoque({ tipo: "ok", taxa_am: 0.5 }, CREDITO, UNIVERSO);
  assert.equal(p.comparaveis, 3, "só a, b e c caem em 130.584 ±20%");
});

test("posicaoNoEstoque: a posição conta quantas comparáveis são mais baratas", () => {
  const p = posicaoNoEstoque({ tipo: "ok", taxa_am: 0.5 }, CREDITO, UNIVERSO);
  // mais baratas que 0,5: c (0,2) e a (0,4)
  assert.equal(p.mais_baratas, 2);
  assert.equal(p.posicao, 3);
});

test("posicaoNoEstoque: `sem_custo` entra em primeiro — nada é mais barato", () => {
  const p = posicaoNoEstoque({ tipo: "sem_custo" }, CREDITO, UNIVERSO);
  assert.equal(p.posicao, 1);
  assert.equal(p.mais_baratas, 0);
});

test("posicaoNoEstoque: sem custo calculável a posição é null, não um lugar inventado", () => {
  const inc = posicaoNoEstoque({ tipo: "incompleta", faltam: ["saldo"] }, CREDITO, UNIVERSO);
  assert.equal(inc.posicao, null);
  assert.equal(inc.comparaveis, 3, "o universo continua sendo informação útil");

  const inv = posicaoNoEstoque({ tipo: "inviavel" }, CREDITO, UNIVERSO);
  assert.equal(inv.posicao, null);
});

test("posicaoNoEstoque: mediana com quantidade ímpar é o valor do meio", () => {
  const p = posicaoNoEstoque({ tipo: "ok", taxa_am: 0.5 }, CREDITO, UNIVERSO);
  // custos dentro da banda ordenados: 0,2 · 0,4 · 0,8
  assert.equal(p.mediana_am, 0.4);
});

test("posicaoNoEstoque: mediana com quantidade par é a média dos dois do meio", () => {
  const universo: Comparavel[] = [
    { id: "a", valor_credito: 130000, custo_am: 0.2 },
    { id: "b", valor_credito: 130000, custo_am: 0.4 },
    { id: "c", valor_credito: 130000, custo_am: 0.6 },
    { id: "d", valor_credito: 130000, custo_am: 1.0 },
  ];
  const p = posicaoNoEstoque({ tipo: "ok", taxa_am: 0.5 }, CREDITO, universo);
  assert.equal(p.mediana_am, 0.5);
});

test("posicaoNoEstoque: estoque vazio devolve mediana null, não zero", () => {
  const p = posicaoNoEstoque({ tipo: "ok", taxa_am: 0.5 }, CREDITO, []);
  assert.equal(p.comparaveis, 0);
  assert.equal(p.mediana_am, null, "zero seria um número falso com cara de medição");
  assert.equal(p.posicao, 1);
});

test("posicaoNoEstoque: comparável com custo não-finito é descartado", () => {
  const universo: Comparavel[] = [
    { id: "a", valor_credito: 130000, custo_am: 0.4 },
    { id: "b", valor_credito: 130000, custo_am: Number.NaN },
  ];
  const p = posicaoNoEstoque({ tipo: "ok", taxa_am: 0.5 }, CREDITO, universo);
  assert.equal(p.comparaveis, 1);
});
