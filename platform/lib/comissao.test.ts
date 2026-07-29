// ============================================================================
// Grade de comissão — testes de ACESSO, não de aritmética.
//
// Runner NATIVO do Node (mesmo padrão de lib/disal/*.test.ts). Rodar:
//   npx tsx --test lib/comissao.test.ts
//
// POR QUÊ este arquivo existe: em 28/07/2026 a Disal foi cadastrada em
// consorcios.administradoras (id 2) SEM grade de comissão. A partir daí a
// resposta da API passou a ser `cadastrada: true, grades: []` — diferente do
// `cadastrada: false` de antes. Se algum consumidor tratasse "cadastrada"
// como sinal de que há grade, ou se um filtro degradasse para "todas as
// grades" quando a chave da administradora falta, a tela da Disal passaria a
// exibir a grade da PORTO. O número pareceria plausível e ninguém notaria.
//
// Os dados abaixo são os reais do projeto xtv em 28/07/2026: Porto id 1 com
// 6 grades (2,5% em todos os segmentos), Disal id 2 com zero.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  gradesVigentesDaAdministradora,
  gradeDoSegmento,
  calcularComissao,
  type GradeComissao,
} from "./comissao";

const HOJE = "2026-07-28";

// espelho das linhas reais de consorcios.comissoes (todas da Porto, id 1)
const GRADES_NO_BANCO: GradeComissao[] = [
  { administradora_id: 1, segmento: "auto", parcelamento_adesao: "qualquer", pct_total: "2.500",
    cronograma: [0.25, 0.25, 0.25, 0.25], vigencia_inicio: "2026-07-01", vigencia_fim: null,
    observacao: "Grade oficial Porto." },
  { administradora_id: 1, segmento: "imovel", parcelamento_adesao: "a_vista", pct_total: "2.500",
    cronograma: [0.2, 0.1, 0.1, 0.15, 0.2, 0.25], vigencia_inicio: "2026-07-01", vigencia_fim: null,
    observacao: "Grade oficial Porto." },
  { administradora_id: 1, segmento: "imovel", parcelamento_adesao: "12x", pct_total: "2.500",
    cronograma: new Array(12).fill(1 / 12), vigencia_inicio: "2026-07-01", vigencia_fim: null,
    observacao: "Grade oficial Porto." },
  { administradora_id: 1, segmento: "pesados", parcelamento_adesao: "qualquer", pct_total: "2.500",
    cronograma: [0.2, 0.1, 0.1, 0.15, 0.2, 0.25], vigencia_inicio: "2026-07-01", vigencia_fim: null,
    observacao: "Grade oficial Porto." },
];

const PORTO = 1;
const DISAL = 2;

test("Disal cadastrada (id 2) e SEM grade: a resposta é vazia, não a grade da Porto", () => {
  const grades = gradesVigentesDaAdministradora(GRADES_NO_BANCO, DISAL, HOJE);
  assert.deepEqual(grades, [], "administradora cadastrada sem grade tem de devolver lista vazia");
});

test("cadastrada: true com grades: [] deixa o bloco de comissão MUDO", () => {
  // é este o payload que /api/comissoes?administradora=disal devolve hoje
  const respostaDaApi = { administradora: "disal", cadastrada: true, grades: [] as GradeComissao[] };

  // exatamente o caminho da tela: grade do segmento -> cálculo
  for (const segmento of ["imovel", "auto", "pesados"]) {
    const grade = gradeDoSegmento(respostaDaApi.grades, segmento);
    assert.equal(grade, null, `segmento ${segmento} não pode achar grade`);
    assert.equal(calcularComissao(grade, 900_000), null, `segmento ${segmento} não pode calcular comissão`);
  }

  // e o resultado é IDÊNTICO ao de uma administradora inexistente:
  // estar cadastrada não é ter grade.
  const inexistente = { cadastrada: false, grades: [] as GradeComissao[] };
  assert.deepEqual(
    gradeDoSegmento(respostaDaApi.grades, "imovel"),
    gradeDoSegmento(inexistente.grades, "imovel"),
    "cadastrada:true sem grade tem de se comportar como não cadastrada",
  );
});

test("administradora não cadastrada (id null) não degrada para 'todas as grades'", () => {
  const grades = gradesVigentesDaAdministradora(GRADES_NO_BANCO, null, HOJE);
  assert.deepEqual(grades, [], "sem id, o filtro não pode virar 'sem filtro'");
});

test("a Porto continua enxergando a própria grade (o filtro não quebrou nada)", () => {
  const grades = gradesVigentesDaAdministradora(GRADES_NO_BANCO, PORTO, HOJE);
  assert.equal(grades.length, 4);
  assert.ok(grades.every((g) => g.administradora_id === PORTO));

  const grade = gradeDoSegmento(grades, "imovel"); // "qualquer" -> "a_vista"
  assert.ok(grade, "imóvel à vista tem grade");
  assert.equal(grade!.parcelamento_adesao, "a_vista");

  const c = calcularComissao(grade, 300_000);
  assert.ok(c);
  assert.equal(c!.pctTotal, 2.5);
  assert.equal(c!.totalRS, 7500); // 2,5% de 300.000
  assert.equal(c!.parcelas, 6);
  assert.equal(c!.cronogramaRS.reduce((s, v) => s + v, 0), 7500, "o cronograma soma o total");
});

test("nenhuma grade vencida entra", () => {
  const vencida: GradeComissao[] = [
    { ...GRADES_NO_BANCO[0], vigencia_inicio: "2026-01-01", vigencia_fim: "2026-06-30" },
  ];
  assert.deepEqual(gradesVigentesDaAdministradora(vencida, PORTO, HOJE), []);
  const futura: GradeComissao[] = [{ ...GRADES_NO_BANCO[0], vigencia_inicio: "2026-09-01" }];
  assert.deepEqual(gradesVigentesDaAdministradora(futura, PORTO, HOJE), []);
});

test("no dia em que a Disal ganhar grade própria, o bloco acende sozinho", () => {
  const comGradeDisal: GradeComissao[] = [
    ...GRADES_NO_BANCO,
    { administradora_id: DISAL, segmento: "imovel", parcelamento_adesao: "a_vista", pct_total: "1.800",
      cronograma: [0.5, 0.5], vigencia_inicio: "2026-07-01", vigencia_fim: null,
      observacao: "Grade Disal (hipotética — não existe no banco hoje)." },
  ];
  const grades = gradesVigentesDaAdministradora(comGradeDisal, DISAL, HOJE);
  assert.equal(grades.length, 1);
  const c = calcularComissao(gradeDoSegmento(grades, "imovel"), 600_000);
  assert.ok(c);
  assert.equal(c!.pctTotal, 1.8, "usa a grade da Disal, não os 2,5% da Porto");
  assert.equal(c!.totalRS, 10800);
});

test("ausência de grade devolve null, nunca zero", () => {
  // zero é um valor ("a comissão é R$ 0,00"); null é a verdade ("não sei").
  assert.equal(calcularComissao(null, 900_000), null);
});
