// ============================================================================
// publicar.test.ts — a retentativa da publicação, sob teste (10/08/2026)
// ----------------------------------------------------------------------------
// O QUE ESTE ARQUIVO PROTEGE. Em 10/08/2026 o post das 11h se perdeu com
// `code=9004 subcode=2207052` — o envelope genérico da Meta para "não consegui
// buscar a mídia nesta URI" — enquanto o card estava demonstravelmente são. Ao
// investigar apareceu o defeito real, e era nosso: `publicarContainer` tinha
// retentativa e o passo `media` não tinha, embora seja o passo `media` que faz
// a Meta BAIXAR a imagem. A retentativa estava no passo errado.
//
// O RISCO QUE ESTE TESTE COBRE não é a Meta — é a próxima refatoração. As três
// regras abaixo parecem detalhes e nenhuma delas aparece na leitura casual:
//
//   1. duas tentativas, nunca três: virar laço transforma um incidente de um
//      dia numa fila de chamadas repetidas contra a Graph;
//   2. o resultado que volta é o da SEGUNDA tentativa, não o da primeira —
//      trocar isso faz o conserto existir e nunca funcionar, porque o sucesso
//      da repetição seria descartado;
//   3. `env_ausente(...)` NÃO repete. É o único erro que a segunda tentativa
//      comprovadamente não conserta (nasce antes da rede), e repetir só gastaria
//      3s do teto de 60s do cron.
//
// E cobre também os DOIS WARNS. Eles não são enfeite: sem eles, uma retentativa
// que salvou o post do dia fica idêntica, no log, a uma que nunca precisou
// existir — e daqui a um mês ninguém sabe dizer se ela alguma vez serviu. Um
// conserto que não pode ser medido é indistinguível de um que não funciona, e é
// por isso que a asserção do log está aqui junto com a do comportamento.
//
// Nada aqui toca a rede: `comRetentativa` recebe a função que tenta, e o teste
// passa uma que conta chamadas. A espera vai como 0 pelo mesmo motivo — a suíte
// mede a ORQUESTRAÇÃO, e dormir 3s de verdade só a tornaria lenta o bastante
// para alguém querer apagá-la.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import {
  comRetentativa,
  inutilRepetir,
  ESPERA_RETENTATIVA_MS,
  type RespostaGraph,
} from "./publicar";

/**
 * Executa `fn` com console.warn/error capturados. Devolve o resultado e as
 * linhas — o log faz parte do contrato, então ele é medido, não só silenciado.
 */
async function comLogCapturado<T>(
  fn: () => Promise<T>
): Promise<{ valor: T; linhas: string[] }> {
  const linhas: string[] = [];
  const warnOriginal = console.warn;
  const errorOriginal = console.error;
  console.warn = (...args: unknown[]) => void linhas.push(String(args[0]));
  console.error = (...args: unknown[]) => void linhas.push(String(args[0]));
  try {
    return { valor: await fn(), linhas };
  } finally {
    console.warn = warnOriginal;
    console.error = errorOriginal;
  }
}

/** Fila de respostas: a 1ª chamada devolve a 1ª, e assim por diante. */
function tentadorDe(...respostas: RespostaGraph[]) {
  const chamadas: number[] = [];
  const tentar = async (): Promise<RespostaGraph> => {
    const i = chamadas.length;
    chamadas.push(i);
    return respostas[Math.min(i, respostas.length - 1)];
  };
  return { tentar, contar: () => chamadas.length };
}

// ---------------------------------------------------------------------------
// inutilRepetir — a única exceção, e o que NÃO é exceção
// ---------------------------------------------------------------------------
test("inutilRepetir: env ausente não se conserta repetindo", () => {
  assert.equal(inutilRepetir("env_ausente(IG_ACCESS_TOKEN)"), true);
  assert.equal(inutilRepetir("env_ausente(IG_USER_ID)"), true);
});

test("inutilRepetir: o erro que derrubou 10/08 É retentável", () => {
  // A regressão que mais importa: se alguém "otimizar" a lista de erros
  // permanentes e incluir o 9004, o conserto some sem quebrar mais nada.
  assert.equal(
    inutilRepetir("code=9004 subcode=2207052 Only photo or video can be accepted as media type"),
    false
  );
});

test("inutilRepetir: OAuth e 4xx são retentados — não sei provar que são permanentes", () => {
  assert.equal(inutilRepetir("code=190 Invalid OAuth access token"), false);
  assert.equal(inutilRepetir("http_400"), false);
  assert.equal(inutilRepetir("timeout_ig(20000ms)"), false);
});

test("inutilRepetir: erro ausente não bloqueia a segunda tentativa", () => {
  // `RespostaGraph.erro` é opcional. `ok:false` sem mensagem tem que repetir,
  // e não cair no ramo do env por acidente de string vazia.
  assert.equal(inutilRepetir(undefined), false);
  assert.equal(inutilRepetir(""), false);
});

// ---------------------------------------------------------------------------
// comRetentativa — quantas chamadas, e qual resultado volta
// ---------------------------------------------------------------------------
test("comRetentativa: sucesso de primeira não chama duas vezes", async () => {
  const t = tentadorDe({ ok: true, id: "17999" });
  const { valor, linhas } = await comLogCapturado(() =>
    comRetentativa("container", t.tentar, 0)
  );
  assert.equal(t.contar(), 1, "deu certo de primeira: não pode haver 2ª chamada");
  assert.deepEqual(valor, { ok: true, id: "17999" });
  assert.deepEqual(linhas, [], "caminho feliz não escreve log");
});

test("comRetentativa: falhou e passou na 2ª — o resultado que volta é o da 2ª", async () => {
  // A regra 2 do header. Devolver `primeira` aqui faria o conserto existir no
  // código e nunca funcionar na prática.
  const t = tentadorDe(
    { ok: false, erro: "code=9004 subcode=2207052 Only photo or video..." },
    { ok: true, id: "18120" }
  );
  const { valor } = await comLogCapturado(() => comRetentativa("container", t.tentar, 0));
  assert.equal(t.contar(), 2);
  assert.equal(valor.ok, true);
  assert.equal(valor.id, "18120");
});

test("comRetentativa: falhou nas duas — devolve o erro da SEGUNDA, e para em 2", async () => {
  const t = tentadorDe({ ok: false, erro: "erro_1" }, { ok: false, erro: "erro_2" });
  const { valor } = await comLogCapturado(() => comRetentativa("container", t.tentar, 0));
  assert.equal(t.contar(), 2, "duas tentativas, nunca três — isto não é um laço");
  assert.equal(valor.ok, false);
  assert.equal(valor.erro, "erro_2");
});

test("comRetentativa: env ausente sai na primeira, com o erro intacto", async () => {
  const t = tentadorDe({ ok: false, erro: "env_ausente(IG_ACCESS_TOKEN)" });
  const { valor, linhas } = await comLogCapturado(() =>
    comRetentativa("container", t.tentar, 0)
  );
  assert.equal(t.contar(), 1, "não adianta repetir o que nasce antes da rede");
  assert.equal(valor.erro, "env_ausente(IG_ACCESS_TOKEN)");
  assert.deepEqual(linhas, [], "saída silenciosa: não houve 2ª tentativa para anunciar");
});

// ---------------------------------------------------------------------------
// O log — é ele que torna o conserto medível
// ---------------------------------------------------------------------------
test("comRetentativa: a 2ª tentativa é anunciada ANTES de acontecer", async () => {
  const t = tentadorDe({ ok: false, erro: "erro_1" }, { ok: true, id: "1" });
  const { linhas } = await comLogCapturado(() => comRetentativa("container", t.tentar, 0));
  assert.ok(
    linhas.some((l) => l.includes("2ª tentativa")),
    `esperava o aviso da 2ª tentativa, veio: ${JSON.stringify(linhas)}`
  );
});

test("comRetentativa: quando a 2ª SALVA, isso fica escrito — senão ninguém saberia", async () => {
  const t = tentadorDe({ ok: false, erro: "erro_1" }, { ok: true, id: "1" });
  const { linhas } = await comLogCapturado(() => comRetentativa("container", t.tentar, 0));
  assert.ok(
    linhas.some((l) => l.includes("aceito na 2ª tentativa")),
    `o sucesso da repetição precisa aparecer no log, veio: ${JSON.stringify(linhas)}`
  );
});

test("comRetentativa: falha dupla diz DUAS tentativas — não parece falha simples", async () => {
  const t = tentadorDe({ ok: false, erro: "erro_1" }, { ok: false, erro: "erro_2" });
  const { linhas } = await comLogCapturado(() => comRetentativa("container", t.tentar, 0));
  assert.ok(
    linhas.some((l) => l.includes("DUAS tentativas")),
    `esperava o log de falha dupla, veio: ${JSON.stringify(linhas)}`
  );
});

test("comRetentativa: o rótulo do chamador aparece no log", async () => {
  // Os dois passos usam o mesmo mecanismo; sem o rótulo, o log não diria qual
  // deles falhou — que é a informação que faltou no diagnóstico de 10/08.
  const t = tentadorDe({ ok: false, erro: "x" }, { ok: false, erro: "y" });
  const { linhas } = await comLogCapturado(() =>
    comRetentativa("publicação", t.tentar, 0)
  );
  assert.ok(linhas.every((l) => l.includes("publicação")));
  assert.ok(linhas.every((l) => !l.includes("container")));
});

// ---------------------------------------------------------------------------
// A espera padrão
// ---------------------------------------------------------------------------
test("ESPERA_RETENTATIVA_MS: 3s, o mesmo valor para os dois passos", () => {
  // Fixado porque era o número que já estava em `publicarContainer` antes desta
  // fatia. Se alguém quiser mudá-lo, que mude de propósito e aqui.
  assert.equal(ESPERA_RETENTATIVA_MS, 3000);
});
