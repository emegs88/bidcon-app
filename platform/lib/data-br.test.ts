// ============================================================================
// data-br.test.ts — a conversão de fuso travada por fixture de instante CONHECIDO
// ----------------------------------------------------------------------------
// PARA QUE ESTE TESTE EXISTE. O defeito que ele fecha não quebrava nada: a tela
// mostrava "14:00" onde deveria mostrar "11:00" e seguia funcionando. Nenhum
// teste de renderização pegaria isso, porque o valor era uma hora válida, bem
// formatada, no formato brasileiro. Só uma FIXTURE DE INSTANTE CONHECIDO pega —
// alguém precisa afirmar, por escrito, que este instante em UTC é aquela hora
// em São Paulo.
//
// AS DUAS PRIMEIRAS FIXTURES SÃO AS PROVAS DO EMERSON, literais, medidas por
// ele na tela em 09/08/2026. Elas não são exemplos didáticos: são o bug.
//
// O QUE ELE **NÃO** PROVA: não prova que a tela CHAMA estas funções. Isso é
// grep, não teste — e por isso `dataHora`/`dataBR` locais foram apagadas em vez
// de mantidas ao lado, para que não exista a versão errada para alguém chamar.
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import { dataHoraBR, dataHoraAnoBR, dataBR, diaBR, TZ_BR } from "./data-br";

// Formatador em UTC — é o que a Vercel produzia. Serve para PROVAR que a
// fixture distingue os dois casos, sem depender do fuso de quem roda o teste.
const EM_UTC = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

test("PROVA DO EMERSON 1: post_publicado de 08/08 as 14:00Z e 11:00 em SP", () => {
  const instante = "2026-08-08T14:00:00Z";
  assert.equal(dataHoraBR(instante), "08/08, 11:00");
  // E a prova de que a fixture não é vazia: em UTC ela dá o número errado que
  // o Emerson viu na tela. Se um dia os dois derem igual, a fixture apodreceu.
  assert.equal(EM_UTC.format(new Date(instante)), "08/08, 14:00");
});

test("PROVA DO EMERSON 2: reel_destravado as 12:12Z e 09:12 em SP", () => {
  const instante = "2026-08-08T12:12:00Z";
  assert.equal(dataHoraBR(instante), "08/08, 09:12");
  assert.equal(EM_UTC.format(new Date(instante)), "08/08, 12:12");
});

test("a diferenca e de exatamente 3 horas fora do horario de verao", () => {
  // Não é decoração: é a régua que torna qualquer outra fixture conferível de
  // cabeça. Meia-noite em SP é 03:00Z.
  assert.equal(dataHoraBR("2026-08-08T03:00:00Z"), "08/08, 00:00");
  assert.equal(dataHoraBR("2026-08-08T02:59:00Z"), "07/08, 23:59");
});

test("O ATALHO PROIBIDO: subtrair 3h na mao erra o historico", () => {
  // Alguém vai olhar isto e pensar "é só tirar três horas". Não é. O Brasil
  // teve horário de verão até 2019, e o `Intl` sabe disso: em 01/02/2018 o
  // deslocamento era de DUAS horas, não três.
  assert.equal(dataHoraBR("2018-02-01T01:30:00Z"), "31/01, 23:30"); // −02:00
  assert.equal(dataHoraBR("2019-07-01T01:30:00Z"), "30/06, 22:30"); // −03:00
  // Se o dia 01/02/2018 passar a dar "30/01, 22:30", alguém trocou o Intl por
  // aritmética e o histórico foi junto.
});

test("diaBR e a data civil de Sao Paulo, nao o slice do ISO", () => {
  // O caso que o `iso.slice(0, 10)` errava: 22h de 07/08 em São Paulo é
  // 01:00Z do dia 08. O slice agrupava no dia 08; a data civil é 07.
  const madrugada = "2026-08-08T01:00:00Z";
  assert.equal(diaBR(madrugada), "2026-08-07");
  assert.equal(madrugada.slice(0, 10), "2026-08-08", "o atalho antigo, para comparação");
  // E fora da faixa das 21h–00h os dois coincidem — que é justamente por que o
  // defeito sobreviveu tanto tempo: ele só aparece de madrugada.
  assert.equal(diaBR("2026-08-08T14:00:00Z"), "2026-08-08");
});

test("diaBR devolve formato ordenavel, com zero a esquerda", () => {
  // A ordenação da tabela e o `.gte()` do Supabase dependem disto: "2026-1-5"
  // não é comparável como string, "2026-01-05" é.
  assert.equal(diaBR("2026-01-05T15:00:00Z"), "2026-01-05");
  assert.match(diaBR("2026-12-31T15:00:00Z")!, /^\d{4}-\d{2}-\d{2}$/);
});

test("dataBR mostra a data civil de SP com o ano", () => {
  assert.equal(dataBR("2026-08-08T14:00:00Z"), "08/08/2026");
  // Virada de ano na madrugada — o caso em que errar o fuso erra o ANO.
  assert.equal(dataBR("2027-01-01T01:00:00Z"), "31/12/2026");
});

test("dataHoraAnoBR: as MESMAS provas do Emerson, com o ano", () => {
  // As telas de /admin fora do FAROL (revisão, audit-logs, conversas ×4) usam
  // este formato e tinham o mesmo defeito. As provas valem para elas também.
  assert.equal(dataHoraAnoBR("2026-08-08T14:00:00Z"), "08/08/2026, 11:00");
  assert.equal(dataHoraAnoBR("2026-08-08T12:12:00Z"), "08/08/2026, 09:12");
});

test("dataHoraAnoBR: na virada do ano o defeito errava o ANO, nao so a hora", () => {
  // 22h de 31/12/2026 em São Paulo é 01:00Z de 01/01/2027. A tela em UTC
  // mostrava "01/01/2027, 01:00": dia errado, mês errado, ano errado. Numa
  // tela de audit-log isso não é cosmético — é a data de um registro de
  // auditoria apontando para o ano seguinte.
  assert.equal(dataHoraAnoBR("2027-01-01T01:00:00Z"), "31/12/2026, 22:00");
});

test("GUARDA: nulo, vazio e data invalida nao viram 'Invalid Date' na tela", () => {
  for (const lixo of [null, undefined, "", "ontem", "2026-13-45", NaN]) {
    assert.equal(dataHoraBR(lixo as never), "—", `dataHoraBR(${String(lixo)})`);
    assert.equal(dataHoraAnoBR(lixo as never), "—", `dataHoraAnoBR(${String(lixo)})`);
    assert.equal(dataBR(lixo as never), "—", `dataBR(${String(lixo)})`);
    assert.equal(diaBR(lixo as never), null, `diaBR(${String(lixo)})`);
  }
});

test("aceita Date e number, nao so string ISO", () => {
  const d = new Date("2026-08-08T14:00:00Z");
  assert.equal(dataHoraBR(d), "08/08, 11:00");
  assert.equal(dataHoraBR(d.getTime()), "08/08, 11:00");
  assert.equal(diaBR(d.getTime()), "2026-08-08");
});

test("o fuso e fixo e nao vem de env", () => {
  // Se isto virar `process.env.TZ` algum dia, a preview passa a divergir da
  // produção em silêncio. Fixo é decisão, está no cabeçalho.
  assert.equal(TZ_BR, "America/Sao_Paulo");
});
