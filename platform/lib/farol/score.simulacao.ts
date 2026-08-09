// ============================================================================
// score.simulacao.ts — a cara da recomendação ANTES de existir dado real
// ----------------------------------------------------------------------------
// NÃO É CÓDIGO DE PRODUÇÃO. Nada importa este arquivo; ele não é chamado por
// rota, cron ou teste. É um GERADOR DE RELATÓRIO, e existe por uma exigência
// literal da OS FAROL-SCORE-01:
//
//   "Reportar no READY (...) uma simulação com dados sintéticos mostrando a
//    saída de recomendarPauta() — para ele ver a cara da recomendação antes de
//    existir dado real."
//
// POR QUE ELE FICA NO REPOSITÓRIO EM VEZ DE SER DESCARTADO. Os números que
// foram para o READY saíram daqui. Um script de uma vez só, apagado depois,
// produz um relatório que ninguém consegue REFAZER — e número que não se refaz
// não é medição, é alegação. Com o arquivo versionado, qualquer pessoa (e o
// Claude de daqui a três meses) roda de novo e confere:
//
//   npx tsx --tsconfig tsconfig.test.json lib/farol/score.simulacao.ts
//
// A data é FIXA (`AGORA`) de propósito: com `new Date()` a saída mudaria todo
// dia e deixaria de conferir com o relatório.
//
// OS DADOS SÃO INVENTADOS — três canais com linhas de base deliberadamente
// desproporcionais (~2.000, ~180.000 e um canal novo sem base), porque é
// exatamente essa desproporção que a tese da OS afirma saber tratar.
// ============================================================================

import { classificarPorRegra } from "./segmentos";
import { pontuar, recomendarPauta, type MetricaPeca, type VideoBruto } from "./score";

const AGORA = new Date("2026-08-09T12:00:00.000Z");
const DIA = 86_400_000;
const em = (d: number) => new Date(AGORA.getTime() - d * DIA).toISOString();

// Canais sintéticos com bases MUITO diferentes de propósito — é a tese da OS.
const CRU: Array<[string, string, number, number, number, number, number]> = [
  // [canal, titulo, dias, views, likes, comentarios, duracao_s]
  // -- CANAL PEQUENO (rotina ~2.000 views) ------------------------------------
  ["UC_pequeno", "Consorcio de imovel: como funciona o lance", 40, 2100, 60, 8, 61],
  ["UC_pequeno", "Simulacao de consorcio passo a passo", 33, 1900, 55, 6, 58],
  ["UC_pequeno", "Erros de quem entra em consorcio", 27, 2000, 51, 9, 44],
  ["UC_pequeno", "Fundo de reserva explicado", 21, 2200, 63, 7, 70],
  ["UC_pequeno", "Taxa de administracao vale a pena?", 15, 1800, 47, 5, 65],
  ["UC_pequeno", "Cansei de morar de aluguel e comprei minha casa propria", 9, 47000, 3100, 410, 52],
  ["UC_pequeno", "Sair do aluguel em 2026 sem financiamento", 5, 31000, 2400, 290, 38],
  // -- CANAL GRANDE (rotina ~180.000 views) -----------------------------------
  ["UC_grande", "5 dicas de investimento imobiliario", 44, 175000, 6100, 380, 90],
  ["UC_grande", "O que ninguem te conta sobre financiamento", 36, 190000, 7000, 420, 85],
  ["UC_grande", "Como quitar o financiamento do imovel mais rapido", 28, 205000, 8200, 510, 78],
  ["UC_grande", "Amortizar ou investir? A conta real", 19, 168000, 5900, 340, 96],
  ["UC_grande", "Saldo devedor: a pegadinha do banco", 12, 182000, 6400, 360, 88],
  ["UC_grande", "Quitei meu financiamento e mostro os numeros", 6, 240000, 9100, 620, 74],
  // -- CANAL NOVO (3 videos — base incompleta de proposito) --------------------
  ["UC_novo", "Comprei meu carro de trabalho por consorcio", 8, 22000, 1400, 130, 41],
  ["UC_novo", "Motorista de app: carro zero sem entrada", 4, 15000, 980, 90, 35],
  ["UC_novo", "Trocar de carro todo ano da conta?", 2, 6000, 410, 40, 47],
];

const videos: VideoBruto[] = CRU.map(([canal, titulo, dias, views, likes, comentarios, duracao_s], i) => ({
  video_id: `v${i + 1}`,
  canal,
  titulo,
  publicado_em: em(dias),
  views, likes, comentarios, duracao_s,
  segmento: classificarPorRegra(titulo).segmento,
}));

const pontuados = pontuar(videos, { agora: AGORA });

console.log("=== PARTE 1+2 — CADA VÍDEO PONTUADO E CLASSIFICADO ===\n");
console.log(
  ["canal", "dias", "vel/dia", "base", "outlier", "score", "segmento", "orig"].join("\t"),
);
for (const v of [...pontuados].sort((a, b) => b.score - a.score)) {
  console.log([
    v.canal,
    v.dias,
    v.velocidade.toFixed(0),
    v.base_canal === null ? "—" : v.base_canal.toFixed(0),
    v.outlier === null ? "—" : v.outlier.toFixed(2) + "x",
    v.score.toFixed(3),
    v.segmento ?? "—",
    v.base_incompleta ? "BASE_INCOMPLETA" : "",
  ].join("\t"));
}

for (const [rotulo, pecas] of [
  ["PARTIDA A FRIO (0 peças nossas medidas)", []],
  ["COM HISTÓRICO (12 peças medidas)", Array.from({ length: 12 }, (_, i): MetricaPeca => ({
    peca_id: `p${i}`,
    formula: i % 3 === 0 ? "P1" : i % 3 === 1 ? "P2" : "P7",
    persona: i % 3 === 1 ? "porta_voz" : "valentina",
    segmento: i % 3 === 0 ? "ALUGUEL" : i % 3 === 1 ? "FINANCIAMENTO" : "VEICULO",
    retencao: 0.34 + (i % 5) * 0.03,
    pct_nao_seguidores: 0.55 + (i % 4) * 0.05,
    salvamentos: 20 + i * 3,
    compartilhamentos: 10 + i * 2,
    comentarios: 5 + i,
    leads: i % 4,
  }))],
] as const) {
  const saida = recomendarPauta({ videos: pontuados, pecas: pecas as any, agora: AGORA });
  console.log(`\n\n=== PARTE 4 — recomendarPauta() · ${rotulo} ===`);
  console.log(`gerado_em=${saida.gerado_em}  partida_a_frio=${saida.partida_a_frio}  n_pecas=${saida.n_pecas_medidas}  confianca=${saida.confianca}\n`);
  for (const s of saida.segmentos) {
    console.log(`▸ ${s.segmento}  →  ${s.formula} / ${s.persona} / ${s.duracao_alvo}s   [confianca: ${s.confianca}]`);
    console.log(`  duracao_mercado=${s.duracao_mercado_s ?? "—"}s  n_videos=${s.n_videos}  outlier_medio=${s.outlier_medio?.toFixed(2) ?? "—"}  indice_interno=${s.indice_interno?.toFixed(3) ?? "—"} (n=${s.n_pecas_internas})`);
    console.log(`  por_que: ${s.por_que}`);
    console.log(`  top: ${s.top.map((t) => `${t.titulo?.slice(0, 34)}… (${t.outlier?.toFixed(1) ?? "—"}x)`).join(" | ")}\n`);
  }
  if (saida.sem_recomendacao.length) {
    console.log("  sem recomendação:");
    for (const x of saida.sem_recomendacao) console.log(`   · ${x.segmento}: ${x.motivo}`);
  }
}
