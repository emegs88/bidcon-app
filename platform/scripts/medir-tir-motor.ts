// ============================================================================
// scripts/medir-tir-motor.ts — TIR-MOTOR-01, MEDIÇÃO PURA. Não conserta nada.
//   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/medir-tir-motor.ts
// AUTORIZADO: Emerson Gomes dos Santos — item 6: "MEDIR A DIVERGÊNCIA primeiro:
//   rodar a bisseção de lib/tir.ts contra o bidcon_custo_am gravado nas mesmas
//   ~2.421 cartas; reportar quantas divergem e por quanto. Não decidir sem o
//   número."
// ----------------------------------------------------------------------------
// SOMENTE LEITURA. Nenhum insert, update, delete ou DDL. Roda contra a xtv em
// produção porque é lá que estão os números publicados — e é exatamente o
// número publicado que está sob suspeita.
//
// POR QUE ELE IMPORTA `tirMensal` EM VEZ DE REESCREVER A BISSEÇÃO: porque o que
// está sendo medido é O CÓDIGO, não uma ideia do código. Uma reimplementação
// "igualzinha" mediria a minha memória do arquivo, e o defeito que se procura é
// justamente o de duas cópias divergirem.
//
// O SEGUNDO MOTOR É REPLICADO, e não importado, porque ele mora no banco em
// plpgsql (`public.bidcon_tir_mensal_serie`, Newton-Raphson, 80 iterações,
// chute inicial r = 0,01, trava em -0,9999). A réplica está abaixo, traduzida
// linha a linha, e o relatório PROVA a réplica antes de usá-la: se ela não
// reproduzir o `bidcon_custo_am` gravado, a réplica é que está errada e nenhuma
// conclusão sobre o Newton vale. Essa prova vem primeiro no relatório.
//
// A SÉRIE É PLANA em 100% das cartas — medido: 0 de 2.422 têm
// `parcelas_detalhe`. Então `bidcon_serie_from_detalhe` cai no ramo
// `array_agg(p_parcela) from generate_series(1, p_prazo)`, e o fluxo é
// [crédito − entrada, −parcela × prazo]. UMA troca de sinal, e só uma.
// ============================================================================
// SÃO TRÊS MOTORES, e não dois — descoberto durante esta medição:
//   (1) `bidcon_tir_mensal_serie` (plpgsql, Newton) grava `bidcon_custo_am`. É a
//       coluna PUBLICADA em /api/vitrine, no painel do fundo, no /minha-carta e
//       no cérebro do WhatsApp.
//   (2) `lib/tir.ts` `tirMensal` (bisseção sobre fluxo genérico) — simulador e
//       junção.
//   (3) `lib/custo-efetivo.ts` `taxaEfetivaMensal` (bisseção sobre o VP da
//       Price) — é ESTE o número impresso no card, na página da carta e o que
//       `dentroDoTeto` usa para decidir o selo do FAROL.
// Comparar só (1)×(2) responderia menos do que a pergunta pede: o selo é
// decidido por (3). Os três entram.
import { createXtvClient } from "@/lib/supabase-xtv";
import { tirMensal } from "@/lib/tir";
import { custoEfetivoCarta } from "@/lib/custo-efetivo";

/** Teto de custo por tipo, em % a.m. — a régua que decide o selo. */
const TETO_PCT = { imovel: 1.0, veiculo: 1.5 } as const;

type Linha = {
  id: string;
  ref: number | null;
  tipo: string;
  credito: number;
  entrada: number;
  parcela: number;
  parcelas: number;
  custo_am: number | null;
};

/**
 * RÉPLICA FIEL de `public.bidcon_tir_mensal_serie` (Newton-Raphson).
 * Traduzida do plpgsql, com as mesmas 80 iterações, o mesmo chute inicial, a
 * mesma trava em -0,9999, os mesmos dois critérios de parada e o mesmo
 * `round(r, 6)` final. Devolve também POR QUE parou — é isso que responde
 * "convergiu ou apenas acabou o orçamento de iterações".
 */
function newtonReplica(
  credito: number,
  entrada: number,
  parcela: number,
  n: number
): { r: number; saida: "convergiu" | "derivada_zero" | "estourou_80"; iters: number } {
  let r = 0.01;
  let saida: "convergiu" | "derivada_zero" | "estourou_80" = "estourou_80";
  let k = 0;
  for (k = 1; k <= 80; k++) {
    let npv = credito - (entrada ?? 0);
    let d = 0;
    for (let t = 1; t <= n; t++) {
      const den = Math.pow(1 + r, t);
      npv -= parcela / den;
      d += (t * parcela) / (den * (1 + r));
    }
    if (Math.abs(d) < 1e-9) { saida = "derivada_zero"; break; }
    let nr = r - npv / d;
    if (nr <= -0.9999) nr = -0.9999;
    if (Math.abs(nr - r) < 1e-9) { r = nr; saida = "convergiu"; break; }
    r = nr;
  }
  return { r: Number(r.toFixed(6)), saida, iters: k };
}

/** Quantas vezes o fluxo troca de sinal. É a hipótese que a doutrina nomeia. */
function trocasDeSinal(fluxo: number[]): number {
  let trocas = 0;
  let ultimo = 0;
  for (const f of fluxo) {
    if (f === 0) continue;
    const s = f > 0 ? 1 : -1;
    if (ultimo !== 0 && s !== ultimo) trocas++;
    ultimo = s;
  }
  return trocas;
}

function pct(v: number | null): string {
  return v == null ? "—" : v.toFixed(4);
}
function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function quantil(ordenado: number[], q: number): number {
  if (ordenado.length === 0) return NaN;
  const i = (ordenado.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? ordenado[lo] : ordenado[lo] + (ordenado[hi] - ordenado[lo]) * (i - lo);
}

async function main() {
  const sb = createXtvClient();

  // Paginado: o PostgREST corta em 1.000 por resposta, e um corte silencioso
  // aqui viraria "medi 1.000 e disse 2.422".
  const linhas: Linha[] = [];
  const PAGINA = 1000;
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await sb
      .from("vw_vitrine_viva")
      .select("id, ref, tipo, credito, entrada, parcela, parcelas, custo_am")
      .order("id", { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error) throw new Error(`leitura falhou: ${error.message}`);
    if (!data || data.length === 0) break;
    linhas.push(...(data as Linha[]));
    if (data.length < PAGINA) break;
  }

  console.log(`\nCARTAS LIDAS DA vw_vitrine_viva: ${linhas.length}\n`);

  const semInsumo: Linha[] = [];
  const comparadas: {
    l: Linha;
    can: number | null;      // motor (3) canônico, cru — o que o card imprime
    bis: number | null;      // bisseção, em % a.m. (não arredondada)
    bisRound: number | null; // bisseção, arredondada como a trigger arredonda
    newt: number;            // réplica de Newton, em % a.m.
    newtRound: number;
    saida: string;
    iters: number;
    trocas: number;
    difBis: number;          // |bisseção − gravado| em p.p. a.m.
    difNewt: number;         // |réplica − gravado| em p.p. a.m.
  }[] = [];

  for (const l of linhas) {
    const ok =
      l.credito != null && l.entrada != null && l.parcela != null &&
      l.parcelas != null && l.parcelas > 0;
    if (!ok || l.custo_am == null) { semInsumo.push(l); continue; }

    const fluxo = [l.credito - l.entrada, ...Array(l.parcelas).fill(-l.parcela)];
    const r = tirMensal(fluxo);
    const bis = r == null ? null : r * 100;
    const bisRound = bis == null ? null : Number(bis.toFixed(2));

    const nw = newtonReplica(l.credito, l.entrada, l.parcela, l.parcelas);
    const newt = nw.r * 100;

    // Motor (3): o que o card imprime e o que `dentroDoTeto` julga.
    const can = custoEfetivoCarta({
      valor_credito: l.credito,
      valor_entrada: l.entrada,
      valor_parcela: l.parcela,
      qtd_parcelas: l.parcelas,
    });

    comparadas.push({
      l, can, bis, bisRound, newt,
      newtRound: Number(newt.toFixed(2)),
      saida: nw.saida, iters: nw.iters,
      trocas: trocasDeSinal(fluxo),
      difBis: bis == null ? NaN : Math.abs(bis - l.custo_am),
      difNewt: Math.abs(newt - l.custo_am),
    });
  }

  // ---------------------------------------------------------------- PROVA (0)
  console.log("=".repeat(78));
  console.log("(0) A RÉPLICA DO NEWTON É FIEL? — sem isto, nada abaixo vale.");
  console.log("=".repeat(78));
  const replicaBate = comparadas.filter((c) => c.newtRound === c.l.custo_am).length;
  const replicaDifs = comparadas.map((c) => c.difNewt).sort((a, b) => a - b);
  console.log(`  réplica reproduz o gravado (2 casas): ${replicaBate}/${comparadas.length}`);
  console.log(`  maior diferença réplica × gravado:    ${quantil(replicaDifs, 1).toExponential(3)} p.p. a.m.`);

  // ------------------------------------------------------------- DIVERGÊNCIA
  console.log("\n" + "=".repeat(78));
  console.log("(1) BISSEÇÃO (lib/tir.ts) × GRAVADO (bidcon_custo_am, Newton na trigger)");
  console.log("=".repeat(78));
  const semRaiz = comparadas.filter((c) => c.bis == null);
  const validas = comparadas.filter((c) => c.bis != null);
  const iguais = validas.filter((c) => c.bisRound === c.l.custo_am);
  const difs = validas.map((c) => c.difBis).sort((a, b) => a - b);
  console.log(`  comparáveis .................. ${comparadas.length}`);
  console.log(`  bisseção devolveu null ....... ${semRaiz.length}`);
  console.log(`  IGUAIS na 2ª casa ............ ${iguais.length}`);
  console.log(`  DIVERGEM na 2ª casa .......... ${validas.length - iguais.length}`);
  console.log(`  diferença |bisseção − gravado| em pontos percentuais ao mês:`);
  console.log(`     mediana ${quantil(difs, 0.5).toExponential(3)}`);
  console.log(`     p95     ${quantil(difs, 0.95).toExponential(3)}`);
  console.log(`     máximo  ${quantil(difs, 1).toExponential(3)}`);

  // ------------------------------------------------------------------- SELO
  console.log("\n" + "=".repeat(78));
  console.log("(2) O CORTE QUE DECIDE A URGÊNCIA — quantas TROCAM DE LADO no teto");
  console.log("    (imóvel 1,00% a.m. · veículo 1,50% a.m.)");
  console.log("=".repeat(78));
  const trocamLado = validas.filter((c) => {
    const teto = c.l.tipo === "imovel" ? TETO_PCT.imovel : TETO_PCT.veiculo;
    return (c.l.custo_am! <= teto) !== (c.bisRound! <= teto);
  });
  console.log(`  TROCAM DE SELO: ${trocamLado.length} de ${validas.length}`);
  for (const c of trocamLado.slice(0, 20)) {
    const teto = c.l.tipo === "imovel" ? TETO_PCT.imovel : TETO_PCT.veiculo;
    console.log(
      `   ref ${c.l.ref} ${c.l.tipo} teto ${teto} | gravado ${pct(c.l.custo_am)} | bisseção ${pct(c.bis)}`
    );
  }

  // ------------------------------------------------- O SELO DE VERDADE (2-B)
  console.log("\n" + "=".repeat(78));
  console.log("(2-B) O SELO COMO A CASA REALMENTE O DECIDE");
  console.log("      `dentroDoTeto` usa o motor (3) CRU (custo <= teto), não a coluna.");
  console.log("      Aqui: quem entra/sai se olharmos a COLUNA PUBLICADA em vez dele.");
  console.log("=".repeat(78));
  const comCanonico = comparadas.filter((c) => c.can != null);
  const difCan = comCanonico
    .map((c) => Math.abs(c.can! - c.l.custo_am!))
    .sort((a, b) => a - b);
  console.log(`  cartas com custo canônico calculável: ${comCanonico.length}/${comparadas.length}`);
  console.log(`  |motor(3) − coluna gravada| em p.p. a.m.:`);
  console.log(`     mediana ${quantil(difCan, 0.5).toExponential(3)}`);
  console.log(`     p95     ${quantil(difCan, 0.95).toExponential(3)}`);
  console.log(`     máximo  ${quantil(difCan, 1).toExponential(3)}`);
  const difBisCan = comCanonico
    .filter((c) => c.bis != null)
    .map((c) => Math.abs(c.can! - c.bis!))
    .sort((a, b) => a - b);
  console.log(`  |motor(3) − motor(2)| máximo: ${quantil(difBisCan, 1).toExponential(3)} p.p. a.m.`);
  const selo = comCanonico.filter((c) => {
    const teto = c.l.tipo === "imovel" ? TETO_PCT.imovel : TETO_PCT.veiculo;
    return (c.can! <= teto) !== (c.l.custo_am! <= teto);
  });
  console.log(`\n  CARTAS EM QUE A COLUNA E O MOTOR DO SELO DISCORDAM: ${selo.length}`);
  for (const c of selo.slice(0, 20)) {
    const teto = c.l.tipo === "imovel" ? TETO_PCT.imovel : TETO_PCT.veiculo;
    console.log(
      `   ref ${c.l.ref} · ${c.l.tipo} · id ${c.l.id}\n` +
      `     crédito ${brl(c.l.credito)} · entrada ${brl(c.l.entrada)} · ${c.l.parcelas}x ${brl(c.l.parcela)}\n` +
      `     teto ${teto.toFixed(2)} | COLUNA ${pct(c.l.custo_am)} (${c.l.custo_am! <= teto ? "dentro" : "FORA"})` +
      ` | motor do selo ${pct(c.can)} (${c.can! <= teto ? "dentro" : "FORA"})`
    );
  }

  // ------------------------------------------------------------- AS 10 PIORES
  console.log("\n" + "=".repeat(78));
  console.log("(3) AS 10 PIORES DIVERGÊNCIAS");
  console.log("=".repeat(78));
  const piores = [...validas].sort((a, b) => b.difBis - a.difBis).slice(0, 10);
  for (const c of piores) {
    console.log(
      `\n  ref ${c.l.ref} · ${c.l.tipo} · id ${c.l.id}\n` +
      `    crédito ${brl(c.l.credito)} · entrada ${brl(c.l.entrada)} · ` +
      `${c.l.parcelas}x de ${brl(c.l.parcela)}\n` +
      `    GRAVADO (Newton) ${pct(c.l.custo_am)}%  ×  BISSEÇÃO ${pct(c.bis)}%  ` +
      `→ diferença ${c.difBis.toExponential(3)} p.p.\n` +
      `    Newton: ${c.saida} em ${c.iters} iterações · trocas de sinal no fluxo: ${c.trocas}`
    );
  }

  // ------------------------------------------------------- NEWTON NÃO CONVERGE
  console.log("\n" + "=".repeat(78));
  console.log("(4) O NEWTON DA TRIGGER CHEGOU A NÃO CONVERGIR?");
  console.log("=".repeat(78));
  const naoConvergiu = comparadas.filter((c) => c.saida !== "convergiu");
  const multiSinal = comparadas.filter((c) => c.trocas > 1);
  console.log(`  cartas cujo fluxo troca de sinal MAIS de uma vez: ${multiSinal.length}`);
  console.log(`  Newton que NÃO convergiu em 80 iterações ........ ${naoConvergiu.length}`);
  for (const c of naoConvergiu.slice(0, 10)) {
    console.log(
      `   ref ${c.l.ref} ${c.l.tipo} · ${c.saida} · crédito ${brl(c.l.credito)} ` +
      `entrada ${brl(c.l.entrada)} ${c.l.parcelas}x ${brl(c.l.parcela)} ` +
      `· gravado ${pct(c.l.custo_am)} · bisseção ${pct(c.bis)}`
    );
  }

  // ------------------------------------------------------------- SEM COMPARAR
  console.log("\n" + "=".repeat(78));
  console.log("(5) CARTAS QUE NÃO ENTRARAM NA COMPARAÇÃO");
  console.log("=".repeat(78));
  console.log(`  ${semInsumo.length} carta(s) sem custo gravado ou sem insumo completo:`);
  for (const l of semInsumo.slice(0, 10)) {
    console.log(
      `   ref ${l.ref} · ${l.tipo} · id ${l.id}\n` +
      `     crédito ${l.credito == null ? "—" : brl(l.credito)} · ` +
      `entrada ${l.entrada == null ? "—" : brl(l.entrada)} · ` +
      `parcelas ${l.parcelas ?? "—"} · parcela ${l.parcela == null ? "—" : brl(l.parcela)} · ` +
      `custo_am ${pct(l.custo_am)}`
    );
  }
  console.log("");
}

main().catch((e) => {
  console.error("MEDIÇÃO FALHOU:", e instanceof Error ? e.message : e);
  process.exit(1);
});
