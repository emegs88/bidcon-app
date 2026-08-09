// ============================================================================
// score.test.ts — a aritmética do outlier, e as bordas onde ela quebraria
// ----------------------------------------------------------------------------
// PARA QUE ESTE TESTE EXISTE. Este arquivo é o único lugar do FAROL onde um
// erro não aparece como exceção. Um NaN entra num `sort` e não é maior nem
// menor que nada — ele embaralha o ranking e não escreve uma linha no log. Uma
// divisão por mediana zero vira Infinity e ganha de todo mundo, para sempre.
// Os testes de borda aqui valem mais que os de caminho feliz.
//
// O QUE ELE **NÃO** PROVA:
//  - NÃO prova que a fórmula da OS é a melhor. Prova que ela foi implementada
//    como o Emerson DECIDIU em 09/08 — que não é, em três pontos, o que a OS
//    dizia por escrito. Os testes de ACHADO 1, 2 e 6 travam a fórmula NOVA;
//    antes desta revisão eles travavam o defeito como comportamento conhecido.
//  - NÃO prova nada sobre a Parte 3 com dado real: `farol_metricas` não existe
//    (ACHADO 7). `indices()` e `agregar()` são testadas como matemática pura.
//  - NÃO prova que a classificação de segmento está certa — isso é
//    segmentos.test.ts. Aqui o segmento chega pronto na fixture.
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  mediana,
  media,
  desvioPadrao,
  zScores,
  recencia,
  diasDesde,
  pontuar,
  pontuavel,
  indices,
  agregar,
  recomendarPauta,
  confiancaDe,
  MIN_AMOSTRAS_BASE,
  MIN_PECAS_INTERNAS,
  MEIA_VIDA_DIAS,
  TOP_POR_SEGMENTO,
  type VideoBruto,
  type MetricaPeca,
} from "./score";

const AGORA = new Date("2026-08-09T12:00:00.000Z");
const DIA = 86_400_000;

/** Um vídeo publicado há `dias` dias, com as métricas dadas. */
function video(
  id: string,
  canal: string,
  dias: number,
  views: number,
  extra: Partial<VideoBruto> = {},
): VideoBruto {
  return {
    video_id: id,
    canal,
    titulo: id,
    publicado_em: new Date(AGORA.getTime() - dias * DIA).toISOString(),
    views,
    likes: 0,
    comentarios: 0,
    duracao_s: 45,
    ...extra,
  };
}

// ============================================================================
// ESTATÍSTICA PURA
// ============================================================================

test("mediana com numero impar e par de amostras", () => {
  assert.equal(mediana([3, 1, 2]), 2);
  assert.equal(mediana([4, 1, 3, 2]), 2.5);
});

test("mediana de lista vazia e null, nunca zero", () => {
  // Zero É um valor (um canal pode ter mediana zero). Ausência não é zero, e
  // confundir os dois faria `outlier` dividir por um número inventado.
  assert.equal(mediana([]), null);
  assert.equal(media([]), null);
  assert.equal(desvioPadrao([]), null);
});

test("desvio padrao e populacional (divide por n)", () => {
  // [2,4,4,4,5,5,7,9] tem desvio populacional exatamente 2.
  assert.equal(desvioPadrao([2, 4, 4, 4, 5, 5, 7, 9]), 2);
});

test("zScores centra em zero e escala pelo desvio", () => {
  const z = zScores([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(z[0], -1.5); // (2-5)/2
  assert.equal(z[7], 2);    // (9-5)/2
  assert.ok(Math.abs((media(z) ?? 1)) < 1e-12);
});

test("GUARDA: zScores com desvio zero devolve zero, nao NaN", () => {
  const z = zScores([5, 5, 5, 5]);
  assert.deepEqual(z, [0, 0, 0, 0]);
  assert.ok(z.every(Number.isFinite));
});

test("ACHADO 9: coorte plana em valor NAO-BINARIO tambem devolve zero", () => {
  // Este é o caso que o guarda `sd === 0` deixava passar, e é por isso que o
  // teste acima não o pegava: 5 é exato em binário, então [5,5,5,5] dá média
  // exatamente 5 e desvio exatamente 0. Já 0,4 NÃO é exato — a média de três
  // sai 0,4000000000000001 e o desvio sai 5,55e-17, que não é zero. A divisão
  // acontecia e devolvia z = -1 para todos: um número com cara de medição.
  assert.deepEqual(zScores([0.4, 0.4, 0.4]), [0, 0, 0]);
  assert.deepEqual(zScores([0.1, 0.1, 0.1]), [0, 0, 0]);
  assert.deepEqual(zScores([0.7, 0.7, 0.7, 0.7, 0.7]), [0, 0, 0, 0, 0]);
  // A prova de que o defeito era real, e não um medo teórico:
  const m = (0.4 + 0.4 + 0.4) / 3;
  assert.notEqual(m, 0.4, "se isto passar a ser igual, o IEEE-754 mudou");
});

test("ACHADO 9: o guarda relativo nao engole sinal de verdade", () => {
  // O risco de um guarda por epsilon é apagar diferença legítima. Não apaga:
  // uma diferença de 1% ainda produz z cheio, e escalas grandes também.
  const z = zScores([0.4, 0.404, 0.4]);
  assert.ok(Math.abs(z[1]) > 1, `z do diferente ficou ${z[1]}`);
  const grande = zScores([1_000_000, 1_000_001, 1_000_000]);
  assert.ok(Math.abs(grande[1]) > 1, `z em escala grande ficou ${grande[1]}`);
  // E zeros puros continuam caindo no guarda, sem dividir por zero.
  assert.deepEqual(zScores([0, 0, 0]), [0, 0, 0]);
});

test("GUARDA: zScores com menos de duas amostras devolve zero", () => {
  assert.deepEqual(zScores([7]), [0]);
  assert.deepEqual(zScores([]), []);
});

test("recencia vale 1 no dia zero e cai monotonicamente", () => {
  assert.equal(recencia(0), 1);
  assert.ok(recencia(1) > recencia(10));
  assert.ok(recencia(10) > recencia(100));
  assert.ok(recencia(1000) > 0);
});

test("ACHADO 2: a meia-vida e REAL — aos 30 dias vale exatamente 0,5", () => {
  // Este é o teste que o Emerson pediu para travar a decisão de 09/08.
  // Se alguém "simplificar" o Math.LN2 para fora da fórmula, isto quebra: a
  // versão sem ln2 dá exp(-1) = 0,3679 aqui.
  assert.ok(Math.abs(recencia(MEIA_VIDA_DIAS) - 0.5) < 1e-12);
  assert.ok(Math.abs(recencia(2 * MEIA_VIDA_DIAS) - 0.25) < 1e-12);
  assert.ok(Math.abs(recencia(3 * MEIA_VIDA_DIAS) - 0.125) < 1e-12);
  // E a armadilha antiga fica nomeada, para não voltar por engano:
  assert.ok(
    Math.abs(recencia(MEIA_VIDA_DIAS) - Math.exp(-1)) > 0.1,
    "isto é exp(-dias/30) de volta — constante de tempo, meia-vida de 20,79d",
  );
});

test("ACHADO 2: a troca deixou o decaimento mais LENTO, nao mais rapido", () => {
  // Consequência declarada da decisão: peça de 30 dias passou a pesar 0,500
  // onde pesava 0,368, e a de 60 dias, 0,250 onde pesava 0,135. O topo do
  // ranking fica menos enviesado para o que foi publicado ontem.
  assert.ok(recencia(30) > Math.exp(-30 / 30));
  assert.ok(recencia(60) > Math.exp(-60 / 30));
});

test("diasDesde tem piso 1 — video de duas horas nao divide por zero", () => {
  assert.equal(diasDesde(new Date(AGORA.getTime() - 2 * 3600_000), AGORA), 1);
  assert.equal(diasDesde(new Date(AGORA.getTime() - 5 * DIA), AGORA), 5);
});

// ============================================================================
// PARTE 1 — pontuar()
// ============================================================================

test("video sem publicado_em nao e pontuavel e some da saida", () => {
  const vs: VideoBruto[] = [
    video("a", "C1", 5, 1000),
    { video_id: "b", canal: "C1", publicado_em: null, views: 999999 },
  ];
  assert.equal(pontuavel(vs[0]), true);
  assert.equal(pontuavel(vs[1]), false);
  const p = pontuar(vs, { agora: AGORA });
  assert.equal(p.length, 1);
  assert.equal(p[0].video_id, "a");
});

test("velocidade e views/dias com o piso da OS", () => {
  const p = pontuar([video("a", "C1", 10, 5000)], { agora: AGORA });
  assert.equal(p[0].dias, 10);
  assert.equal(p[0].velocidade, 500);
});

test("engajamento soma likes e comentarios sobre views", () => {
  const p = pontuar([video("a", "C1", 10, 1000, { likes: 80, comentarios: 20 })], {
    agora: AGORA,
  });
  assert.equal(p[0].engajamento, 0.1);
});

test("ACHADO 3: comentarios ausente conta zero — subestima, nunca inventa", () => {
  const p = pontuar([video("a", "C1", 10, 1000, { likes: 50, comentarios: null })], {
    agora: AGORA,
  });
  assert.equal(p[0].engajamento, 0.05);
});

test("base_canal exige MIN_AMOSTRAS_BASE videos — com menos, fica base_incompleta", () => {
  // Canal com 4 vídeos: abaixo do mínimo de 5.
  const poucos = [1, 2, 3, 4].map((i) => video("p" + i, "POUCO", i, 1000 * i));
  const p = pontuar(poucos, { agora: AGORA });
  for (const v of p) {
    assert.equal(v.base_canal, null, "mediana com 4 amostras não pode existir");
    assert.equal(v.outlier, null);
    assert.equal(v.base_incompleta, true);
  }
  assert.equal(MIN_AMOSTRAS_BASE, 5);
});

test("com 5+ videos a base existe e o outlier e velocidade/mediana", () => {
  // Cinco vídeos do mesmo canal, todos a 10 dias. Velocidades: 100..500.
  // Mediana = 300. O de 500 tem outlier 500/300 = 1.667.
  const vs = [1, 2, 3, 4, 5].map((i) => video("v" + i, "C1", 10, i * 1000));
  const p = pontuar(vs, { agora: AGORA });
  const v5 = p.find((x) => x.video_id === "v5")!;
  assert.equal(v5.base_canal, 300);
  assert.ok(Math.abs(v5.outlier! - 500 / 300) < 1e-12);
  assert.equal(v5.base_incompleta, false);
  // O do meio está exatamente na média do canal: outlier 1.0.
  const v3 = p.find((x) => x.video_id === "v3")!;
  assert.equal(v3.outlier, 1);
});

test("GUARDA: mediana zero nao vira Infinity — vira base indefinida", () => {
  // Cinco vídeos, três com zero views. Mediana das velocidades = 0.
  const vs = [
    video("z1", "C0", 10, 0),
    video("z2", "C0", 10, 0),
    video("z3", "C0", 10, 0),
    video("z4", "C0", 10, 5000),
    video("z5", "C0", 10, 9000),
  ];
  const p = pontuar(vs, { agora: AGORA });
  for (const v of p) {
    assert.equal(v.base_canal, null);
    assert.equal(v.outlier, null);
    assert.equal(v.base_incompleta, true);
    assert.ok(Number.isFinite(v.score), "score virou Infinity/NaN");
  }
});

test("A TESE DA OS: romper a propria base ganha de volume absoluto", () => {
  // Canal pequeno: costuma fazer 2.000 views; um vídeo fez 20.000 (10x).
  // Canal grande: costuma fazer 2.000.000; um vídeo fez 200.000 (0,1x).
  // O da OS: "o primeiro rompeu, o segundo só existiu".
  const pequenos = [1, 2, 3, 4].map((i) => video("pq" + i, "PEQUENO", 10, 2000));
  const grandes = [1, 2, 3, 4].map((i) => video("gd" + i, "GRANDE", 10, 2_000_000));
  const vs = [
    ...pequenos,
    video("PQ_ROMPEU", "PEQUENO", 10, 20_000),
    ...grandes,
    video("GD_EXISTIU", "GRANDE", 10, 200_000),
  ];
  const p = pontuar(vs, { agora: AGORA });
  const rompeu = p.find((x) => x.video_id === "PQ_ROMPEU")!;
  const existiu = p.find((x) => x.video_id === "GD_EXISTIU")!;
  assert.ok(rompeu.outlier! > 9, `outlier do que rompeu: ${rompeu.outlier}`);
  assert.ok(existiu.outlier! < 0.2, `outlier do que só existiu: ${existiu.outlier}`);
  assert.ok(
    rompeu.score > existiu.score,
    "o vídeo de 20 mil views tem que ganhar do de 200 mil",
  );
});

test("base_canal usa todo o historico; o z usa so a janela", () => {
  // 5 vídeos velhos (fora da janela de 90d) + 1 novo. A base do canal PRECISA
  // dos velhos para existir; o z não pode compará-lo com eles.
  const velhos = [1, 2, 3, 4, 5].map((i) => video("old" + i, "C1", 200 + i, 10_000));
  const novo = video("novo", "C1", 5, 50_000);
  const p = pontuar([...velhos, novo], { agora: AGORA });
  const n = p.find((x) => x.video_id === "novo")!;
  assert.notEqual(n.base_canal, null, "os velhos tinham que formar a base");
  assert.equal(n.base_incompleta, false);
  assert.equal(n.fora_da_janela, false);
  for (const v of p.filter((x) => x.video_id.startsWith("old"))) {
    assert.equal(v.fora_da_janela, true);
  }
});

test("ACHADO 1: score nunca e negativo — o clamp esta NA ORIGEM", () => {
  // A decisão do Emerson (09/08): o defeito tem que ser inalcançável em
  // qualquer caminho, não só no da recomendação. `score` é coluna de banco.
  // Uma pilha onde é impossível todo mundo ficar acima da média: com 6 vídeos
  // e z-score, alguém sempre fica com composto negativo.
  const vs = [
    video("gigante", "C1", 3, 500_000, { likes: 40_000, comentarios: 5_000 }),
    ...[1, 2, 3, 4, 5].map((i) => video("p" + i, "C1", 10 + i, 800, { likes: 5 })),
  ];
  const p = pontuar(vs, { agora: AGORA });
  const negativos = p.filter((v) => v.composto < 0);
  assert.ok(negativos.length > 0, "a fixture tinha que produzir composto negativo");
  for (const v of p) {
    assert.ok(v.score >= 0, `${v.video_id} saiu com score ${v.score}`);
  }
});

test("ACHADO 1: o clamp e no score, e `composto` continua intacto ao lado", () => {
  // Efeito colateral declarado: quem está abaixo da média empata em 0 e perde
  // a ordem relativa. Quem quiser o grau tem `composto`, que NÃO foi clampado.
  const vs = [
    video("gigante", "C1", 3, 500_000, { likes: 40_000, comentarios: 5_000 }),
    ...[1, 2, 3, 4, 5].map((i) => video("p" + i, "C1", 10 + i, 800, { likes: 5 })),
  ];
  const p = pontuar(vs, { agora: AGORA });
  const ruins = p.filter((v) => v.composto < 0);
  for (const v of ruins) {
    assert.equal(v.score, 0, "abaixo da média tem que empatar em zero");
    assert.ok(v.composto < 0, "e `composto` tem que preservar o sinal");
  }
});

test("ACHADO 1: a inversao antiga nao acontece mais", () => {
  // A prova direta do defeito que foi fechado. Antes do clamp, dois vídeos
  // igualmente ruins (composto -2) davam score -0,25 (velho) e -2 (novo), e o
  // VELHO ganhava. Agora ambos dão 0 — empatam, que é a leitura honesta.
  const clamp = (composto: number, dias: number) => Math.max(0, composto) * recencia(dias);
  assert.equal(clamp(-2, 90), 0);
  assert.equal(clamp(-2, 1), 0);
  assert.ok(
    clamp(-2, 90) <= clamp(-2, 1),
    "se o velho voltar a ganhar do novo, o clamp saiu da origem",
  );
  // E no lado positivo a recência continua fazendo o que deve: o novo ganha.
  assert.ok(clamp(2, 1) > clamp(2, 90));
});

// ============================================================================
// PARTE 3 — indice() e agregar()
// ============================================================================

function peca(id: string, formula: string, extra: Partial<MetricaPeca> = {}): MetricaPeca {
  return {
    peca_id: id,
    formula,
    persona: "valentina",
    segmento: "ALUGUEL",
    retencao: 0.4,
    pct_nao_seguidores: 0.5,
    salvamentos: 10,
    compartilhamentos: 10,
    comentarios: 5,
    leads: 2,
    ...extra,
  };
}

test("ACHADO 6: coorte toda igual da indice ZERO, nao a soma das fracoes", () => {
  // Com os quatro termos em z, peças idênticas não se destacam de nada e o
  // índice é 0. Antes da correção este teste esperava 0.35*0.4 + 0.35*0.5 =
  // 0,425 — o resto de fração que sobrava dos dois termos crus.
  const ps = [peca("a", "P1"), peca("b", "P1"), peca("c", "P1")];
  for (const p of indices(ps)) {
    assert.ok(Math.abs(p.indice) < 1e-12, `indice ${p.indice} para coorte plana`);
  }
});

test("ACHADO 6: os pesos escritos sao os pesos exercidos", () => {
  // A prova da correção: mover UM termo por um z equivalente move o índice na
  // proporção do peso daquele termo. Retenção (0,35) tem que mexer MAIS que
  // shares (0,20) para o mesmo deslocamento em desvios-padrão.
  const base = [peca("a", "P1"), peca("b", "P1"), peca("c", "P1")];

  const soRetencao = indices([{ ...base[0], retencao: 0.9 }, base[1], base[2]]);
  const ganhoRetencao = soRetencao[0].indice - soRetencao[1].indice;

  const soShares = indices([{ ...base[0], compartilhamentos: 200 }, base[1], base[2]]);
  const ganhoShares = soShares[0].indice - soShares[1].indice;

  // Mesma forma de coorte (um outlier, dois iguais) → mesmo z em ambos os
  // casos. Então a razão dos ganhos tem que ser a razão dos pesos: 0,35/0,20.
  assert.ok(
    ganhoRetencao > ganhoShares,
    `retenção (peso 0,35) moveu ${ganhoRetencao}; shares (peso 0,20) moveu ${ganhoShares}`,
  );
  assert.ok(
    Math.abs(ganhoRetencao / ganhoShares - 0.35 / 0.2) < 1e-9,
    "a razão dos ganhos tem que ser a razão dos pesos",
  );
});

test("ACHADO 6: leads, o de menor peso, e o que menos move", () => {
  // O sintoma original era o termo de peso 0,10 dominando. Fecha aqui.
  const base = [peca("a", "P1"), peca("b", "P1"), peca("c", "P1")];
  const mover = (extra: Partial<MetricaPeca>) => {
    const r = indices([{ ...base[0], ...extra }, base[1], base[2]]);
    return r[0].indice - r[1].indice;
  };
  const gLeads = mover({ leads: 200 });
  const gShares = mover({ compartilhamentos: 200 });
  const gRet = mover({ retencao: 0.9 });
  const gNaoSeg = mover({ pct_nao_seguidores: 0.95 });
  assert.ok(gLeads < gShares, "leads (0,10) não pode mover mais que shares (0,20)");
  assert.ok(gShares < gRet, "shares (0,20) não pode mover mais que retenção (0,35)");
  assert.ok(Math.abs(gRet - gNaoSeg) < 1e-9, "os dois de peso 0,35 movem igual");
});

test("agregar sempre expoe o n junto da media", () => {
  const idx = indices([peca("a", "P1"), peca("b", "P1"), peca("c", "P7")]);
  const porFormula = agregar(idx, "formula");
  const p1 = porFormula.find((a) => a.chave === "P1")!;
  const p7 = porFormula.find((a) => a.chave === "P7")!;
  assert.equal(p1.n, 2);
  assert.equal(p7.n, 1);
  assert.ok(p1.minimo <= p1.media && p1.media <= p1.maximo);
});

// ============================================================================
// PARTE 4 — recomendarPauta()
// ============================================================================

/** Uma pilha sintética: 6 vídeos de ALUGUEL num canal pequeno que rompeu. */
function pilhaAluguel(): VideoBruto[] {
  const rotina = [1, 2, 3, 4, 5].map((i) =>
    video("rot" + i, "CANAL_A", 40 + i, 2000, { segmento: "ALUGUEL" }),
  );
  const estourou = [
    video("hit1", "CANAL_A", 6, 60_000, { segmento: "ALUGUEL", likes: 4000, comentarios: 500 }),
    video("hit2", "CANAL_A", 9, 45_000, { segmento: "ALUGUEL", likes: 3000, comentarios: 300 }),
    video("hit3", "CANAL_A", 12, 30_000, { segmento: "ALUGUEL", likes: 2000, comentarios: 200 }),
  ];
  return [...rotina, ...estourou];
}

test("PARTIDA A FRIO: com menos de 10 pecas medidas o interno nao decide", () => {
  const p = pontuar(pilhaAluguel(), { agora: AGORA });
  const r = recomendarPauta({
    videos: p,
    pecas: [peca("a", "P1"), peca("b", "P1")], // n=2, o "fingir estatística"
    agora: AGORA,
  });
  assert.equal(r.partida_a_frio, true);
  assert.equal(r.n_pecas_medidas, 2);
  assert.equal(r.confianca, "baixa");
  for (const s of r.segmentos) {
    assert.equal(s.indice_interno, null, "o interno não podia ter opinado");
    assert.equal(s.n_pecas_internas, 0);
    assert.equal(s.confianca, "baixa");
  }
  assert.equal(MIN_PECAS_INTERNAS, 10);
});

test("PARTIDA A FRIO: a frase por_que nao cita estatistica interna", () => {
  const p = pontuar(pilhaAluguel(), { agora: AGORA });
  const r = recomendarPauta({ videos: p, pecas: [], agora: AGORA });
  const aluguel = r.segmentos.find((s) => s.segmento === "ALUGUEL")!;
  assert.match(aluguel.por_que, /o externo decide sozinho/);
  assert.doesNotMatch(aluguel.por_que, /reten[cç][aã]o/);
});

test("o externo sozinho ja recomenda, com evidencia numerica", () => {
  const p = pontuar(pilhaAluguel(), { agora: AGORA });
  const r = recomendarPauta({ videos: p, pecas: [], agora: AGORA });
  const aluguel = r.segmentos.find((s) => s.segmento === "ALUGUEL")!;
  assert.equal(aluguel.formula, "P1");
  assert.equal(aluguel.persona, "valentina");
  assert.equal(aluguel.duracao_alvo, 40);
  assert.ok(aluguel.n_videos >= 1);
  assert.ok(aluguel.outlier_medio! > 1, "os hits tinham que estar acima da base");
  assert.match(aluguel.por_que, /outlier m[eé]dio/);
});

test("ACHADO 1 NEUTRALIZADO: video abaixo da media da janela nao entra no topo", () => {
  const p = pontuar(pilhaAluguel(), { agora: AGORA });
  const r = recomendarPauta({ videos: p, pecas: [], agora: AGORA });
  const aluguel = r.segmentos.find((s) => s.segmento === "ALUGUEL")!;
  for (const t of aluguel.top) {
    const orig = p.find((x) => x.video_id === t.video_id)!;
    assert.ok(orig.composto > 0, `${t.video_id} entrou com composto ${orig.composto}`);
  }
});

test("o topo respeita TOP_POR_SEGMENTO", () => {
  const muitos: VideoBruto[] = [];
  for (let i = 0; i < 30; i++) {
    muitos.push(video("m" + i, "CANAL_B", 3, 1000 + i * 500, { segmento: "VEICULO" }));
  }
  const p = pontuar(muitos, { agora: AGORA });
  const r = recomendarPauta({ videos: p, pecas: [], agora: AGORA });
  const veic = r.segmentos.find((s) => s.segmento === "VEICULO");
  if (veic) assert.ok(veic.top.length <= TOP_POR_SEGMENTO);
  assert.equal(TOP_POR_SEGMENTO, 5);
});

test("video sem segmento classificado nao recomenda nada", () => {
  const semSeg = [1, 2, 3, 4, 5, 6].map((i) => video("s" + i, "C1", 5, 10_000 * i));
  const p = pontuar(semSeg, { agora: AGORA });
  const r = recomendarPauta({ videos: p, pecas: [], agora: AGORA });
  assert.equal(r.segmentos.length, 0);
  assert.equal(r.sem_recomendacao.length, 8, "todos os 8 segmentos sem evidência");
});

test("o tipo da carta do dia exclui forma que nao serve, com motivo escrito", () => {
  const p = pontuar(pilhaAluguel(), { agora: AGORA });
  // P1 (ALUGUEL) só serve imóvel. Num dia de veículo, ela tem que sair.
  const r = recomendarPauta({ videos: p, pecas: [], agora: AGORA, tipo: "veiculo" });
  assert.equal(r.segmentos.find((s) => s.segmento === "ALUGUEL"), undefined);
  const fora = r.sem_recomendacao.find((s) => s.segmento === "ALUGUEL")!;
  assert.match(fora.motivo, /não serve a carta de veiculo/);
});

test("ACHADO 5: duracao_alvo vem da forma; a do mercado sai so como evidencia", () => {
  // Vídeos do mercado com 8 minutos. A duração-alvo NÃO pode virar 480.
  const longos = pilhaAluguel().map((v) => ({ ...v, duracao_s: 480 }));
  const p = pontuar(longos, { agora: AGORA });
  const r = recomendarPauta({ videos: p, pecas: [], agora: AGORA });
  const aluguel = r.segmentos.find((s) => s.segmento === "ALUGUEL")!;
  assert.equal(aluguel.duracao_alvo, 40, "o teto medido da P1 tem que sobreviver");
  assert.equal(aluguel.duracao_mercado_s, null, "8 min não é evidência de Short");
});

test("duracao de mercado curta aparece como evidencia, sem mexer no alvo", () => {
  const curtos = pilhaAluguel().map((v) => ({ ...v, duracao_s: 52 }));
  const p = pontuar(curtos, { agora: AGORA });
  const r = recomendarPauta({ videos: p, pecas: [], agora: AGORA });
  const aluguel = r.segmentos.find((s) => s.segmento === "ALUGUEL")!;
  assert.equal(aluguel.duracao_mercado_s, 52);
  assert.equal(aluguel.duracao_alvo, 40);
});

test("BASE INCOMPLETA: canal novo entra marcado e derruba a confianca", () => {
  // Canal com 3 vídeos só — nunca vai ter mediana.
  const novo = [1, 2, 3].map((i) =>
    video("n" + i, "CANAL_NOVO", i + 1, 40_000 * i, {
      segmento: "VEICULO",
      likes: 3000,
      comentarios: 400,
    }),
  );
  const p = pontuar(novo, { agora: AGORA });
  assert.ok(p.every((v) => v.base_incompleta));
  const r = recomendarPauta({ videos: p, pecas: [], agora: AGORA });
  const veic = r.segmentos.find((s) => s.segmento === "VEICULO");
  if (veic) {
    assert.equal(veic.base_incompleta, true);
    assert.equal(veic.outlier_medio, null);
    assert.equal(veic.confianca, "baixa");
    assert.match(veic.por_que, /sem linha de base/);
    assert.doesNotMatch(veic.por_que, /outlier m[eé]dio/);
  }
});

test("com 10+ pecas o interno passa a opinar e a confianca pode subir", () => {
  const p = pontuar(pilhaAluguel(), { agora: AGORA });
  const pecas = Array.from({ length: 12 }, (_, i) =>
    peca("x" + i, "P1", { segmento: "ALUGUEL", retencao: 0.41 }),
  );
  const r = recomendarPauta({ videos: p, pecas, agora: AGORA });
  assert.equal(r.partida_a_frio, false);
  const aluguel = r.segmentos.find((s) => s.segmento === "ALUGUEL")!;
  assert.notEqual(aluguel.indice_interno, null);
  assert.ok(aluguel.n_pecas_internas >= 3);
  assert.match(aluguel.por_que, /reten[cç][aã]o de 41% em 12 pe[cç]as/);
});

test("a escada da confianca esta escrita e e testavel isolada", () => {
  assert.equal(
    confiancaDe({ partida_a_frio: true, n_videos: 5, base_incompleta: false, n_pecas_internas: 50 }),
    "baixa",
  );
  assert.equal(
    confiancaDe({ partida_a_frio: false, n_videos: 1, base_incompleta: false, n_pecas_internas: 50 }),
    "baixa",
  );
  assert.equal(
    confiancaDe({ partida_a_frio: false, n_videos: 5, base_incompleta: true, n_pecas_internas: 50 }),
    "baixa",
  );
  assert.equal(
    confiancaDe({ partida_a_frio: false, n_videos: 2, base_incompleta: false, n_pecas_internas: 1 }),
    "media",
  );
  assert.equal(
    confiancaDe({ partida_a_frio: false, n_videos: 3, base_incompleta: false, n_pecas_internas: 3 }),
    "alta",
  );
});

test("a saida nunca tem NaN nem Infinity, nem nos casos degenerados", () => {
  const degenerado: VideoBruto[] = [
    video("d1", "CD", 1, 0, { segmento: "ALUGUEL", likes: 0, comentarios: 0 }),
    video("d2", "CD", 1, 0, { segmento: "ALUGUEL" }),
    video("d3", "CD", 1, 0, { segmento: "ALUGUEL" }),
    video("d4", "CD", 1, 0, { segmento: "ALUGUEL" }),
    video("d5", "CD", 1, 0, { segmento: "ALUGUEL" }),
  ];
  const p = pontuar(degenerado, { agora: AGORA });
  for (const v of p) {
    assert.ok(Number.isFinite(v.score), `score ${v.score}`);
    assert.ok(Number.isFinite(v.composto));
    assert.ok(Number.isFinite(v.velocidade));
    assert.ok(Number.isFinite(v.engajamento));
  }
  const r = recomendarPauta({ videos: p, pecas: [], agora: AGORA });
  for (const s of r.segmentos) {
    assert.ok(Number.isFinite(s.score_medio));
  }
});

test("pontuar e recomendarPauta sao deterministicas", () => {
  const vs = pilhaAluguel();
  const a = JSON.stringify(recomendarPauta({ videos: pontuar(vs, { agora: AGORA }), agora: AGORA }));
  const b = JSON.stringify(recomendarPauta({ videos: pontuar(vs, { agora: AGORA }), agora: AGORA }));
  assert.equal(a, b);
});
