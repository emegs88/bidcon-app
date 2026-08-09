// ============================================================================
// lib/farol/saber.test.ts — a privacidade do FAQ VIVO, provada
// AUTORIZADO: Emerson Gomes dos Santos — OS "FAROL-SABER-01", 08/08/2026:
// "privacidade como REGRA DURA no código, não no prompt".
// ----------------------------------------------------------------------------
// Runner NATIVO do Node, mesmo padrão de lib/farol/reel-texto.test.ts. Rodar:
//   npx tsx --tsconfig tsconfig.test.json --test lib/farol/saber.test.ts
//
// POR QUE ESTE ARQUIVO EXISTE. A OS mandou a privacidade ser regra de CÓDIGO e
// não de prompt. Uma regra de código que ninguém testa é uma regra de prompt
// com sintaxe melhor: continua sendo uma promessa. `anonimizar()` roda no
// caminho único de escrita de dados que vieram de conversa de cliente real —
// se ela falhar, o vazamento é silencioso, permanente e vira linha de banco.
//
// O que este arquivo prova, em ordem de gravidade:
//   1) telefone, e-mail, CPF/CNPJ e @ não sobrevivem à anonimização;
//   2) o kill-switch FAROL_SABER desarmado não gasta embedding nem muda nada;
//   3) `ehPergunta` não deixa "oi"/"bom dia" entupirem a base;
//   4) `similaridade` é cosseno de verdade (é ela que decide o agrupamento).
//
// O QUE ELE **NÃO** PROVA, escrito para não parecer esquecimento: nome próprio
// solto ("aqui é o Marcos") continua passando — está declarado no doc de
// `anonimizar` e é por isso que existe a SEGUNDA trava, a de a tabela 0072 não
// ter coluna para telefone, nome ou conversa_id. O último teste deste arquivo
// documenta esse limite em vez de fingir que ele não existe.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  anonimizar,
  ehPergunta,
  similaridade,
  ultimaPerguntaDoCliente,
  blocoSaber,
  saberLigado,
  SEMENTES,
} from "./saber";

// ----------------------------------------------------------------------------
// 1) PRIVACIDADE — o teste que mais importa
// ----------------------------------------------------------------------------
test("telefone brasileiro em qualquer formato não sobrevive", () => {
  for (const bruto of [
    "me liga no (11) 98765-4321 por favor",
    "meu zap é 11987654321",
    "chama no 11 98765 4321",
    "tel 1198765432",
  ]) {
    const limpo = anonimizar(bruto);
    assert.ok(!/\d{8,}/.test(limpo.replace(/\D/g, "")), `vazou dígitos em: ${limpo}`);
    assert.ok(/\[telefone\]|\[numero\]/.test(limpo), `sem marcador em: ${limpo}`);
  }
});

test("e-mail vira marcador, e o domínio não sobra pendurado", () => {
  const limpo = anonimizar("manda pro joao.silva+cotas@gmail.com que eu vejo");
  assert.ok(limpo.includes("[email]"));
  assert.ok(!limpo.includes("gmail"));
  assert.ok(!limpo.includes("@gmail.com"));
});

test("CPF e CNPJ não passam, com ou sem pontuação", () => {
  assert.ok(anonimizar("meu cpf é 123.456.789-09").includes("[cpf]"));
  assert.ok(anonimizar("cnpj 12.345.678/0001-95").includes("[cnpj]"));
  assert.ok(anonimizar("cnpj 12345678000195").includes("[cnpj]"));
  // CPF SEM pontuação NÃO vira "[cpf]": onze dígitos colados são exatamente a
  // forma de um celular com DDD. A primeira versão deste teste exigia "[cpf]"
  // aqui e "[telefone]" para "11987654321" — duas asserções sobre a MESMA
  // forma, impossíveis de satisfazer juntas. Foi assim que a ambiguidade
  // apareceu. A decisão está escrita em anonimizar(): forma ambígua recebe o
  // marcador neutro, que é estável e não dilui o agrupamento do FAQ VIVO.
  assert.ok(anonimizar("cpf 12345678909").includes("[numero]"));
  // A prova real: nenhuma sequência longa de dígitos sobrou em lugar nenhum.
  for (const b of ["123.456.789-09", "12345678909", "12.345.678/0001-95"]) {
    assert.ok(!/\d{7,}/.test(anonimizar(b).replace(/\D/g, "")));
  }
});

test("@ de perfil e link viram marcador", () => {
  const limpo = anonimizar("segue @joao_consorcio e vê https://insta.com/p/abc123");
  assert.ok(limpo.includes("[perfil]"));
  assert.ok(limpo.includes("[link]"));
  assert.ok(!limpo.includes("joao_consorcio"));
  assert.ok(!limpo.includes("insta.com"));
});

test("a pergunta em si sobrevive — anonimizar não destrói o assunto", () => {
  // Se a anonimização comesse o texto útil, o FAQ VIVO agruparia lixo.
  const limpo = anonimizar("como funciona a junção de duas cartas? me liga (11) 98765-4321");
  assert.ok(limpo.includes("junção"));
  assert.ok(limpo.includes("como funciona"));
  assert.ok(limpo.includes("[telefone]"));
});

test("anonimizar é idempotente — rodar duas vezes não corrompe o marcador", () => {
  const uma = anonimizar("liga (11) 98765-4321 ou manda pro a@b.com");
  assert.equal(anonimizar(uma), uma);
});

// ----------------------------------------------------------------------------
// 2) KILL-SWITCH — a OS pediu DESARMADO
// ----------------------------------------------------------------------------
test("FAROL_SABER desarmado: bloco vazio e ZERO ida à rede", async () => {
  const anterior = process.env.FAROL_SABER;
  delete process.env.FAROL_SABER;
  try {
    assert.equal(saberLigado(), false);

    // O db abaixo explode se for tocado. É assim que se prova "não gastou
    // embedding": não basta o retorno ser "", o caminho não pode ter sido
    // percorrido. Se blocoSaber chamasse a busca, este teste falharia.
    const dbQueNaoPodeSerUsado = {
      rpc: () => {
        throw new Error("blocoSaber tocou o banco com o kill-switch desarmado");
      },
    };
    const bloco = await blocoSaber(dbQueNaoPodeSerUsado, "como funciona a conta notarial?");
    assert.equal(bloco, "");
  } finally {
    if (anterior === undefined) delete process.env.FAROL_SABER;
    else process.env.FAROL_SABER = anterior;
  }
});

test("FAROL_SABER só liga com o valor exato 'on'", () => {
  const anterior = process.env.FAROL_SABER;
  try {
    for (const v of ["", "off", "true", "1", "ON", "sim"]) {
      process.env.FAROL_SABER = v;
      assert.equal(saberLigado(), false, `"${v}" não deveria ligar`);
    }
    process.env.FAROL_SABER = "on";
    assert.equal(saberLigado(), true);
  } finally {
    if (anterior === undefined) delete process.env.FAROL_SABER;
    else process.env.FAROL_SABER = anterior;
  }
});

test("ligado, mas sem nada parecido no acervo: bloco continua vazio", async () => {
  const anterior = process.env.FAROL_SABER;
  process.env.FAROL_SABER = "on";
  try {
    // Pergunta curta demais nem chega a gastar embedding (piso de 8 chars).
    const db = {
      rpc: () => {
        throw new Error("não deveria buscar com pergunta curta");
      },
    };
    assert.equal(await blocoSaber(db, "oi"), "");
  } finally {
    if (anterior === undefined) delete process.env.FAROL_SABER;
    else process.env.FAROL_SABER = anterior;
  }
});

// ----------------------------------------------------------------------------
// 3) A PENEIRA DO FAQ VIVO
// ----------------------------------------------------------------------------
test("saudação e agradecimento NÃO entram na base", () => {
  for (const ruido of ["oi", "bom dia", "obrigado", "ok", "blz", "?", "como?", "tá bom"]) {
    assert.equal(ehPergunta(ruido), false, `"${ruido}" não é pergunta de FAQ`);
  }
});

test("pergunta de verdade entra, com ou sem interrogação", () => {
  for (const boa of [
    "como funciona a junção de cartas?",
    "quanto fica a entrada de uma carta de 250 mil",
    "vocês atendem imóvel comercial",
    "posso vender minha cota contemplada por aí",
    "o que acontece se a administradora não aprovar",
  ]) {
    assert.equal(ehPergunta(boa), true, `"${boa}" deveria entrar`);
  }
});

// ----------------------------------------------------------------------------
// 4) O COSSENO QUE DECIDE O AGRUPAMENTO
// ----------------------------------------------------------------------------
test("similaridade: idêntico = 1, ortogonal = 0, oposto = -1", () => {
  assert.ok(Math.abs(similaridade([1, 0, 0], [1, 0, 0]) - 1) < 1e-9);
  assert.ok(Math.abs(similaridade([1, 0, 0], [0, 1, 0])) < 1e-9);
  assert.ok(Math.abs(similaridade([1, 0, 0], [-1, 0, 0]) + 1) < 1e-9);
});

test("similaridade ignora magnitude — é ângulo, não tamanho", () => {
  // Importa porque embeddings não vêm normalizados por contrato.
  assert.ok(Math.abs(similaridade([3, 4], [30, 40]) - 1) < 1e-9);
});

test("vetor zero devolve 0 e não NaN — NaN quebraria o agrupamento em silêncio", () => {
  assert.equal(similaridade([0, 0, 0], [1, 2, 3]), 0);
  assert.ok(!Number.isNaN(similaridade([0, 0], [0, 0])));
});

// ----------------------------------------------------------------------------
// 5) O RECORTE DA PERGUNTA NO HISTÓRICO
// ----------------------------------------------------------------------------
test("pega a ÚLTIMA fala do cliente, ignorando o que veio depois", () => {
  const hist = [
    { papel: "cliente", conteudo: "oi" },
    { papel: "prosperito", conteudo: "olá! como posso ajudar?" },
    { papel: "cliente", conteudo: "como funciona a conta notarial?" },
    { papel: "prosperito", conteudo: "vou te explicar" },
  ];
  assert.equal(ultimaPerguntaDoCliente(hist), "como funciona a conta notarial?");
});

test("histórico sem cliente, vazio ou nulo devolve string vazia — nunca lança", () => {
  assert.equal(ultimaPerguntaDoCliente([{ papel: "sistema", conteudo: "x" }]), "");
  assert.equal(ultimaPerguntaDoCliente([]), "");
  assert.equal(ultimaPerguntaDoCliente(null), "");
  assert.equal(ultimaPerguntaDoCliente(undefined), "");
});

// ----------------------------------------------------------------------------
// 6) AS SEMENTES — compliance e rastreabilidade
// ----------------------------------------------------------------------------
test("nenhuma semente usa o léxico proibido pela casa", () => {
  // CLAUDE.md: consórcio não é produto de rentabilidade. Uma semente com
  // "investimento" no corpo envenenaria TODA resposta que a recuperasse.
  const proibidos = [
    "investimento",
    "investidor",
    "rendimento",
    "rentabilidade",
    "lucro",
    "cdi",
    "retorno financeiro",
  ];
  for (const s of SEMENTES) {
    // Sementes de compliance CITAM os termos para ensinar a não usá-los. A
    // primeira versão deste teste isentava UMA semente pelo título — e a
    // isenção por string mágica quebrou na segunda semente de compliance
    // ("Como a Bidcon apresenta o custo mensal", que diz "não existe
    // rendimento"). A isenção agora é um campo declarado no próprio dado:
    // escrever uma semente nova com o léxico exige declarar de propósito.
    if (s.ensina_lexico_proibido) continue;
    const corpo = `${s.titulo} ${s.conteudo}`.toLowerCase();
    for (const termo of proibidos) {
      assert.ok(!corpo.includes(termo), `semente "${s.titulo}" usa "${termo}"`);
    }
  }
});

test("a isenção de léxico é usada com parcimônia e só por semente de compliance", () => {
  // A válvula de escape do teste acima precisa de uma trava, senão a saída
  // fácil para um teste vermelho vira "declara a isenção e segue". Duas regras:
  // ela é rara, e só existe em semente que fala de vocabulário/compliance.
  const isentas = SEMENTES.filter((s) => s.ensina_lexico_proibido);
  assert.ok(isentas.length <= 3, `isenções demais (${isentas.length}) — o léxico está vazando`);
  for (const s of isentas) {
    assert.ok(
      s.tags.includes("compliance") || s.tags.includes("lexico"),
      `semente "${s.titulo}" se isentou do léxico sem ser semente de compliance`
    );
  }
});

test("nenhuma semente promete contemplação", () => {
  for (const s of SEMENTES) {
    const corpo = `${s.titulo} ${s.conteudo}`.toLowerCase();
    assert.ok(
      !/(garantia de contempla|contempla\w* garantid|contempla\w* em \d)/.test(corpo),
      `semente "${s.titulo}" flerta com promessa de contemplação`
    );
  }
});

test("toda semente declara de onde saiu — é o que impede inventar lei", () => {
  for (const s of SEMENTES) {
    assert.ok(s.origem_no_repo.length > 0, `semente "${s.titulo}" sem origem`);
    assert.ok(s.tags.length > 0, `semente "${s.titulo}" sem tag`);
    assert.ok(s.conteudo.length > 80, `semente "${s.titulo}" curta demais para servir de contexto`);
  }
});

test("a chave natural (fonte, titulo) da 0072 não colide entre as sementes", () => {
  // Se colidisse, o upsert da rota faria uma semente sobrescrever a outra e a
  // base nasceria com menos verbetes do que a lista tem — em silêncio.
  const chaves = new Set(SEMENTES.map((s) => `${s.fonte}||${s.titulo}`));
  assert.equal(chaves.size, SEMENTES.length);
});

// ----------------------------------------------------------------------------
// 7) O LIMITE DECLARADO — documentado, não escondido
// ----------------------------------------------------------------------------
test("LIMITE CONHECIDO: nome próprio solto ainda passa por anonimizar()", () => {
  // Este teste falha DE PROPÓSITO no dia em que alguém melhorar `anonimizar`
  // para pegar nomes — e nesse dia o comentário do header e a segunda trava
  // precisam ser revistos junto. Ele existe para que o limite seja uma decisão
  // registrada, e não uma surpresa.
  assert.ok(anonimizar("aqui é o Marcos, quero vender minha cota").includes("Marcos"));
});
