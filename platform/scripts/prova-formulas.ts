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
import { roteiroDaFormula, montarLegendaReel } from "@/lib/farol/reel-texto";
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

let reprovas = 0;

for (const f of FORMULAS) {
  for (const c of [IMOVEL, VEICULO]) {
    if (!f.tipos.includes(c.tipo as "imovel" | "veiculo")) continue;
    const roteiro = roteiroDaFormula(c, f);
    const veredito = revisarLegenda(roteiro);
    if (veredito) reprovas++;
    console.log(`\n=== ${f.id} ${f.nome} · ${c.tipoLabel} · ${f.duracao_alvo}s`);
    console.log(`--- linter: ${veredito ?? "OK"}`);
    console.log(roteiro);
    console.log(`--- palavras: ${roteiro.split(/\s+/).length}`);
  }
}

for (const c of [IMOVEL, VEICULO]) {
  const l = montarLegendaReel(c, "2026-08-08");
  const veredito = revisarLegenda(l);
  if (veredito) reprovas++;
  console.log(`\n=== LEGENDA ${c.tipoLabel} — linter: ${veredito ?? "OK"}`);
  console.log(l);
}

console.log(`\n\nREPROVAS: ${reprovas}`);
