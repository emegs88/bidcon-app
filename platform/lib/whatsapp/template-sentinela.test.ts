// ============================================================================
// Teste de lib/whatsapp/template-sentinela.ts — o par (name, language) preso.
// ----------------------------------------------------------------------------
// O QUE ESTE ARQUIVO IMPEDE, E QUE JÁ ACONTECEU
//
// A Meta recusou 75 envios com (#132001) "Template name does not exist in the
// translation". Cinco ciclos, quinze recusas cada, zero entregues — medido em
// wa_mensagens/sentinela_log em 19/08/2026. O nome que saiu no fio tinha len 21,
// igual ao literal caractere por caractere: o nome não era o problema. Sobrava
// o outro lado do par, e esse outro lado era um literal solto dentro da rota,
// onde `scripts/testes.mjs` não alcança (o arnês varre `lib/`, e só).
//
// Literal em rota é literal sem rede. Trocar `pt_BR` por `pt-BR` — o erro mais
// comum do #132001, porque a Meta escreve o idioma com underscore e o resto da
// web escreve com hífen — passaria no tsc, passaria no build, e derrubaria a
// fila inteira em silêncio por mais dois dias e meio. Aqui, quebra.
//
// CONTROLE em todo bloco: uma asserção que passa pela guarda e produz o valor
// bom. Sem ela, uma implementação que recusasse TUDO deixaria este arquivo
// verde enquanto o Sentinela nunca mais enviasse nada — que é o defeito, não
// a cura.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  IDIOMA_SENTINELA,
  IDIOMAS_QUE_FALHAM,
  NOME_SENTINELA_DOCUMENTADO,
  parDoSentinela,
} from "@/lib/whatsapp/template-sentinela";

// ---------------------------------------------------------------------------
// O IDIOMA — o lado do par que custou 75 envios
// ---------------------------------------------------------------------------

test("IDIOMA: é exatamente 'pt_BR', underscore e BR maiúsculo", () => {
  /* Igualdade literal de propósito. A Graph compara isto por igualdade exata
   * contra a tradução aprovada; não há normalização do lado de lá. Se alguém
   * "arrumar" para o padrão BCP-47, esta linha é a que grita. */
  assert.equal(IDIOMA_SENTINELA, "pt_BR");
});

test("IDIOMA: nenhuma das grafias que já sabemos que quebram passa", () => {
  /* A lista não está só aqui dentro: é constante exportada, para quem for
   * mexer no idioma ler antes de mexer. O teste garante que ela continue
   * sendo a lista do que NÃO vale. */
  for (const ruim of IDIOMAS_QUE_FALHAM) {
    assert.notEqual(
      IDIOMA_SENTINELA,
      ruim,
      `IDIOMA_SENTINELA virou ${JSON.stringify(ruim)} — a Meta devolve #132001`
    );
  }
  // CONTROLE: a lista de armadilhas não está vazia. Um `IDIOMAS_QUE_FALHAM`
  // esvaziado por engano faria o laço acima passar sem verificar nada.
  assert.ok(IDIOMAS_QUE_FALHAM.length >= 5);
  assert.ok(IDIOMAS_QUE_FALHAM.includes("pt-BR"));
});

test("IDIOMA: não tem espaço em volta nem caractere invisível", () => {
  // A hipótese que a medição eliminou para o NOME continua viva para o idioma
  // enquanto ninguém a prender.
  assert.equal(IDIOMA_SENTINELA, IDIOMA_SENTINELA.trim());
  assert.equal(IDIOMA_SENTINELA.length, 5);
});

// ---------------------------------------------------------------------------
// O NOME DOCUMENTADO — referência, não fonte da verdade
// ---------------------------------------------------------------------------

test("NOME: o documentado bate com docs/TEMPLATE-sentinela_retomada_01.md, len 21", () => {
  /* len 21 é o número medido no fio em wa_mensagens. Deixá-lo explícito aqui
   * é o que transforma "parece igual" em "é igual". */
  assert.equal(NOME_SENTINELA_DOCUMENTADO, "sentinela_retomada_01");
  assert.equal(NOME_SENTINELA_DOCUMENTADO.length, 21);
});

// ---------------------------------------------------------------------------
// parDoSentinela — o que efetivamente vai no fio
// ---------------------------------------------------------------------------

test("PAR: nome bom produz o par completo, e o idioma vem do módulo", () => {
  // CONTROLE do arquivo inteiro. Se este falhar, a guarda está recusando o
  // caminho feliz e o Sentinela fica mudo com os testes verdes.
  const d = parDoSentinela("sentinela_retomada_01");
  assert.equal(d.ok, true);
  if (!d.ok) return;
  assert.deepEqual(d.par, { name: "sentinela_retomada_01", language: "pt_BR" });
  assert.equal(d.divergeDoDoc, false);
});

test("PAR: o language do par NUNCA é decidido pelo chamador", () => {
  /* A rota mandava `languageCode: "pt_BR"` como literal seu. Se o par voltasse
   * a permitir que cada chamador escolhesse, voltaríamos ao estado em que o
   * idioma vive fora do alcance do arnês — que é a causa, não o sintoma. */
  const d = parDoSentinela("qualquer_outro_nome");
  assert.equal(d.ok, true);
  if (!d.ok) return;
  assert.equal(d.par.language, IDIOMA_SENTINELA);
});

test("PAR: env ausente ou vazia NÃO vira par — recusa com motivo", () => {
  /* Sem env não há envio: o portão continua sendo a env, e a linha fica em
   * `aguardando_template`, que é reversível e visível. Medido: as 20 linhas
   * nesse estado voltam sozinhas para a varredura (o WHERE da
   * `sentinela_a_tocar` inclui `aguardando_template`), então recusar aqui não
   * perde ninguém. */
  assert.deepEqual(parDoSentinela(undefined), { ok: false, motivo: "env_ausente" });
  assert.deepEqual(parDoSentinela(null), { ok: false, motivo: "env_ausente" });
  assert.deepEqual(parDoSentinela(""), { ok: false, motivo: "env_ausente" });
});

test("PAR: nome com espaço em volta é RECUSADO, não aparado", () => {
  /* Aparar esconderia uma env mal colada: o envio passaria, o operador nunca
   * saberia que colou errado, e o sintoma voltaria depois noutro lugar sem
   * rastro. Recusar deixa o motivo no log e a linha reversível. */
  for (const cru of [" sentinela_retomada_01", "sentinela_retomada_01 ", "  ", "\n"]) {
    assert.deepEqual(
      parDoSentinela(cru),
      { ok: false, motivo: "nome_com_espaco" },
      `aceitou ${JSON.stringify(cru)}`
    );
  }
});

test("PAR: nome diferente do documentado passa, mas ACUSA a divergência", () => {
  /* A env é a fonte da verdade do envio, não o doc — trocar para um `_02` é
   * legítimo. O que não pode é a troca ser silenciosa: quem lê o log precisa
   * ver que o nome no fio não é o nome registrado, e decidir. */
  const d = parDoSentinela("sentinela_retomada_02");
  assert.equal(d.ok, true);
  if (!d.ok) return;
  assert.equal(d.divergeDoDoc, true);
  assert.equal(d.par.name, "sentinela_retomada_02");
});
