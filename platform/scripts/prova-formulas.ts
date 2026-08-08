// ============================================================================
// Bancada de prova das fôrmas (FAROL-FORMULAS-02).
//   npx tsx --tsconfig tsconfig.json scripts/prova-formulas.ts
// ----------------------------------------------------------------------------
// Renderiza TODAS as fôrmas contra duas cartas REAIS do estoque, passa cada
// roteiro e cada legenda pelo mesmo `revisarLegenda()` da produção e conta as
// palavras. Não é código de produção e nada aqui roda em request: é o jeito de
// não descobrir um texto reprovado às 11h30, com a HeyGen já cobrada.
//
// RÉGUA DE DURAÇÃO: o roteiro clássico tem 88 palavras e rendeu 31 segundos de
// vídeo — ~170 palavras por minuto. Divida o contador por 2,84 para ter os
// segundos. Mantenha esta bancada verde ao mexer nas fôrmas.
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
