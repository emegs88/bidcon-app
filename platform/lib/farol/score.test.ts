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
//    LITERALMENTE, incluindo o defeito de sinal documentado no ACHADO 1 — que é
//    testado como comportamento conhecido, não como acerto.
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
  CONSTANTE_DECAIMENTO_DIAS,
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

test("ACHADO 2: exp(-dias/30) e constante de tempo, nao meia-vida de 30 dias", () => {
  // Aos 30 dias a recência vale exp(-1) = 0,3679 — e NÃO 0,5.
  const aos30 = recencia(CONSTANTE_DECAIMENTO_DIAS);
  assert.ok(Math.abs(aos30 - Math.exp(-1)) < 1e-12);
  assert.ok(aos30 < 0.5, "se isto virar 0.5, a fórmula foi trocada sem avisar");
  // A meia-vida REAL da fórmula escrita é 30*ln2 = 20,79 dias.
  const meiaVidaReal = CONSTANTE_DECAIMENTO_DIAS * Math.LN2;
  assert.ok(Math.abs(recencia(meiaVidaReal) - 0.5) < 1e-12);
  assert.ok(Math.abs(meiaVidaReal - 20.79) < 0.01);
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

test("ACHADO 1: a recencia multiplicativa inverte o ranking no lado negativo", () => {
  // Isto NÃO é um acerto — é o defeito documentado, travado em teste para que
  // ninguém o descubra por acidente em produção. Dois vídeos igualmente ruins
  // (composto negativo): o VELHO fica com score maior que o NOVO.
  const composto = -2;
  const scoreVelho = composto * recencia(90);
  const scoreNovo = composto * recencia(1);
  assert.ok(
    scoreVelho > scoreNovo,
    "se isto falhar, a fórmula mudou — reveja o ACHADO 1",
  );
  // E é por isso que recomendarPauta() filtra por composto > 0.
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

test("indice aplica os pesos da OS", () => {
  // Com todas as peças iguais, os dois z valem 0 e sobra só a parte de frações.
  const ps = [peca("a", "P1"), peca("b", "P1"), peca("c", "P1")];
  const idx = indices(ps);
  for (const p of idx) {
    assert.ok(Math.abs(p.indice - (0.35 * 0.4 + 0.35 * 0.5)) < 1e-12);
  }
});

test("ACHADO 6: os termos de z dominam o indice apesar do peso menor", () => {
  // Retenção sobe de 40% para 90% (+50 pontos percentuais) → +0,175 no índice.
  // Um z de shares de +1,2 com peso 0,20 já vale +0,24. O termo de MENOR peso
  // mexe mais. Documentado, não corrigido por conta própria.
  const base = [peca("a", "P1"), peca("b", "P1"), peca("c", "P1")];
  const soRetencao = indices([
    { ...base[0], retencao: 0.9 },
    base[1],
    base[2],
  ]);
  const ganhoRetencao = soRetencao[0].indice - soRetencao[1].indice;
  assert.ok(Math.abs(ganhoRetencao - 0.35 * 0.5) < 1e-9);

  const soShares = indices([
    { ...base[0], compartilhamentos: 200 },
    base[1],
    base[2],
  ]);
  const ganhoShares = soShares[0].indice - soShares[1].indice;
  assert.ok(
    ganhoShares > ganhoRetencao,
    `shares moveu ${ganhoShares}, retenção moveu ${ganhoRetencao}`,
  );
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
