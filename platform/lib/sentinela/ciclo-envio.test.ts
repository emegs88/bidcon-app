// ============================================================================
// Teste de lib/sentinela/ciclo-envio.ts — a unidade "ciclo".
// ----------------------------------------------------------------------------
// O DEFEITO QUE ESTE ARQUIVO PRENDE é de relógio, não de lógica de negócio, e
// por isso é do tipo que passa em toda revisão: o Sentinela roda 2×/dia (12h e
// 18h) e o RADAR roda 8×/dia (a cada 3h). Contar falhas por janela fixa faz
// seis dos oito RADARs do dia não encontrarem o ciclo — e "não encontrar" não
// vira silêncio, vira `falhas = 0`, condição marcada como julgada, e a FASE 3
// FECHANDO o alerta grave que o RADAR anterior abriu. O vigia se desmentiria
// sozinho seis vezes por dia.
//
// Por isso a unidade é o ciclo, e por isso ele é reconstruído por LACUNA e não
// por hora cheia. O teste da virada de hora abaixo é o que impede alguém de
// "simplificar" para `date_trunc('hour')`.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";

import { ultimoCicloDeEnvio, type LinhaEnvio } from "@/lib/sentinela/ciclo-envio";

/** Monta um ciclo: `n` linhas a partir de `base`, 2s entre elas (THROTTLE_MS). */
const ciclo = (base: string, falhas: number, feitos: number): LinhaEnvio[] => {
  const t0 = Date.parse(base);
  const out: LinhaEnvio[] = [];
  let i = 0;
  for (let k = 0; k < falhas; k++, i++)
    out.push({ acao: "envio_falha", criado_em: new Date(t0 + i * 2000).toISOString() });
  for (let k = 0; k < feitos; k++, i++)
    out.push({ acao: "envio_ok", criado_em: new Date(t0 + i * 2000).toISOString() });
  return out;
};

// ---------------------------------------------------------------------------
// O CASO REAL
// ---------------------------------------------------------------------------

test("os cinco ciclos de 15 falhas: julga o ÚLTIMO, não a soma dos 75", () => {
  /* Somar a janela daria 75 e o número seria uma ficção: nenhuma execução
   * tentou 75. O alerta tem de dizer o que ESTE ciclo fez, senão o operador
   * conserta o template, o ciclo seguinte entrega tudo, e o alerta continua
   * gritando 75 por causa dos ciclos velhos. */
  const linhas = [
    ...ciclo("2026-08-18T12:00:00.000Z", 15, 0),
    ...ciclo("2026-08-18T18:00:00.000Z", 15, 0),
    ...ciclo("2026-08-19T12:00:00.000Z", 15, 0),
  ];
  const c = ultimoCicloDeEnvio(linhas);
  assert.ok(c);
  assert.equal(c.falhas, 15);
  assert.equal(c.feitos, 0);
  assert.equal(c.inicio, "2026-08-19T12:00:00.000Z");
});

test("um ciclo novo e LIMPO apaga o passado sujo — é assim que o alerta fecha", () => {
  /* CONTROLE do teste de cima, e a metade que costuma faltar: se o último
   * ciclo entregou tudo, o vigia precisa poder calar, senão o alerta grave
   * nunca mais fecha e o painel vira ruído permanente. */
  const linhas = [
    ...ciclo("2026-08-19T12:00:00.000Z", 15, 0),
    ...ciclo("2026-08-19T18:00:00.000Z", 0, 12),
  ];
  const c = ultimoCicloDeEnvio(linhas);
  assert.ok(c);
  assert.equal(c.falhas, 0);
  assert.equal(c.feitos, 12);
});

// ---------------------------------------------------------------------------
// A LACUNA — por que não é `date_trunc('hour')`
// ---------------------------------------------------------------------------

test("execução que atravessa a virada da hora continua sendo UM ciclo", () => {
  /* O dia em que o cron atrasar. Agrupando por hora cheia, estas 15 falhas
   * viram 7 e 8 — as duas abaixo de qualquer limiar — e o vigia emudece
   * exatamente sob a carga que ele existe para ver. */
  const t0 = Date.parse("2026-08-19T11:59:46.000Z");
  const linhas: LinhaEnvio[] = Array.from({ length: 15 }, (_, i) => ({
    acao: "envio_falha",
    criado_em: new Date(t0 + i * 2000).toISOString(),
  }));
  const c = ultimoCicloDeEnvio(linhas);
  assert.ok(c);
  assert.equal(c.falhas, 15, "a virada da hora nao pode partir o ciclo em dois");
});

test("lacuna de 6h separa ciclos; lacuna de 30s não", () => {
  const c1 = ultimoCicloDeEnvio([
    ...ciclo("2026-08-19T12:00:00.000Z", 9, 0),
    ...ciclo("2026-08-19T18:00:00.000Z", 2, 1),
  ]);
  assert.equal(c1?.falhas, 2, "6h e fronteira");
  // CONTROLE: meio minuto de pausa (uma retentativa lenta) NÃO parte o ciclo.
  const c2 = ultimoCicloDeEnvio([
    ...ciclo("2026-08-19T12:00:00.000Z", 5, 0),
    ...ciclo("2026-08-19T12:00:30.000Z", 4, 0),
  ]);
  assert.equal(c2?.falhas, 9, "30s nao e fronteira");
});

// ---------------------------------------------------------------------------
// O QUE NÃO CONTA
// ---------------------------------------------------------------------------

test("opt_out, aguardando_template e o heartbeat NÃO entram na conta", () => {
  /* Opt-out é decisão de quem recebe: contá-lo como falha inflaria o número
   * que decide o alerta e o vigia gritaria "envio quebrado" por gente que só
   * pediu para sair. `varredura_ok` é heartbeat e existe em todo ciclo,
   * inclusive nos que não enviaram nada. */
  const linhas: LinhaEnvio[] = [
    { acao: "parada_opt_out", criado_em: "2026-08-19T12:00:00.000Z" },
    { acao: "aguardando_template", criado_em: "2026-08-19T12:00:02.000Z" },
    { acao: "envio_falha", criado_em: "2026-08-19T12:00:04.000Z" },
    { acao: "varredura_ok", criado_em: "2026-08-19T12:00:06.000Z" },
  ];
  const c = ultimoCicloDeEnvio(linhas);
  assert.ok(c);
  assert.equal(c.falhas, 1);
  assert.equal(c.feitos, 0);
});

// ---------------------------------------------------------------------------
// OS DOIS NULLs — e por que o chamador trata os dois igual
// ---------------------------------------------------------------------------

test("log não medido volta null — não julga", () => {
  assert.equal(ultimoCicloDeEnvio(null), null);
});

test("janela SEM envio nenhum volta null: fila seca não é envio saudável", () => {
  /* A sutileza que decide se o vigia mente. Uma janela sem `envio_ok` nem
   * `envio_falha` significa que ninguém estava elegível — não que o canal
   * funciona. Devolver `{falhas: 0}` faria a rota marcar a condição como
   * julgada e a FASE 3 FECHARIA um alerta de pane porque a fila secou, que é
   * o contrário de uma boa notícia. */
  assert.equal(ultimoCicloDeEnvio([]), null);
  assert.equal(
    ultimoCicloDeEnvio([{ acao: "varredura_ok", criado_em: "2026-08-19T12:00:00.000Z" }]),
    null,
    "so heartbeat nao e ciclo de envio"
  );
});

test("data ilegível não vira ciclo fantasma", () => {
  // `Date.parse` de lixo devolve NaN; ordenar com NaN embaralha tudo em
  // silêncio e o ciclo sai com o tamanho errado.
  const c = ultimoCicloDeEnvio([
    { acao: "envio_falha", criado_em: "nao-e-data" },
    { acao: "envio_falha", criado_em: "2026-08-19T12:00:00.000Z" },
  ]);
  assert.ok(c);
  assert.equal(c.falhas, 1);
});

test("ordem embaralhada na leitura não muda o resultado", () => {
  /* O PostgREST devolve na ordem que a query pedir, e alguém pode trocar o
   * `order` um dia. O ciclo não pode depender disso. */
  const linhas = [
    ...ciclo("2026-08-19T18:00:00.000Z", 2, 1),
    ...ciclo("2026-08-19T12:00:00.000Z", 9, 0),
  ];
  const c = ultimoCicloDeEnvio(linhas);
  assert.equal(c?.falhas, 2);
  assert.equal(c?.feitos, 1);
});
