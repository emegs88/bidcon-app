// ============================================================================
// Teste do pivô sem-entrada (PROSPERITO-SEM-ENTRADA-01)
// ----------------------------------------------------------------------------
// Dois grupos, com pesos diferentes.
//
// O PRIMEIRO é o que importa mais: a varredura das palavras proibidas sobre
// TODOS_OS_TEXTOS. Não confio na minha própria revisão de texto — reli o
// arquivo três vezes e ainda assim quero uma máquina lendo cada frase atrás de
// "garantido", de prazo e de percentual de lance. Se alguém amanhã acrescentar
// uma frase gentil e promissora ao módulo, é este teste que fica vermelho.
//
// O SEGUNDO é a máquina de estados: ordem das perguntas, o que conta como
// respondido, e a ficha que chega ao humano.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CAMPOS,
  ENV_KILL_SWITCH,
  PARTE_1_VERDADE,
  PARTE_2_PORTA,
  TEXTO_FECHAMENTO,
  TEXTO_LANCE_EMBUTIDO,
  TODOS_OS_TEXTOS,
  blocoSemEntrada,
  fichaColetada,
  proximoCampo,
  proximoPasso,
  textoAbertura,
  type EstadoPivo,
} from "./pivo-sem-entrada";

// ---------------------------------------------------------------------------
// GRUPO 1 — o que este módulo tem PROIBIDO dizer
// ---------------------------------------------------------------------------

function normalizar(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

test("nenhum texto promete contemplação", () => {
  // "vai ser contemplado", "será contemplado", "te contemplo" — qualquer forma
  // que afirme o fato futuro. Note que o módulo PODE (e deve) usar
  // "quando você for contemplado" e "chance de ser contemplado": a diferença
  // entre condição e promessa é justamente o que está sendo protegido aqui.
  const PROMESSAS = [
    /\bvai ser contemplad/,
    /\bvai contemplar\b/,
    /\bsera contemplad/,
    /\bvoce sera\b/,
    /\bte contemplo\b/,
    /\bcontemplacao garantida\b/,
    /\bcerteza de (?:ser )?contempl/,
  ];
  for (const texto of TODOS_OS_TEXTOS) {
    const n = normalizar(texto);
    for (const p of PROMESSAS) {
      assert.equal(
        p.test(n),
        false,
        `texto promete contemplação (${p}): ${texto.slice(0, 70)}…`,
      );
    }
  }
});

test("nenhum texto usa a palavra garantido", () => {
  for (const texto of TODOS_OS_TEXTOS) {
    const n = normalizar(texto);
    assert.equal(
      /\bgarant(?:ido|ida|ia|imos|e)\b/.test(n),
      false,
      `texto usa "garantido": ${texto.slice(0, 70)}…`,
    );
  }
});

test("nenhum texto dá prazo de contemplação", () => {
  // Prazo é qualquer número seguido de unidade de tempo. O módulo fala de
  // tempo o tempo todo ("a diferença está no tempo") — o que não pode é
  // quantificar.
  for (const texto of TODOS_OS_TEXTOS) {
    const n = normalizar(texto);
    assert.equal(
      /\b\d+\s*(?:mes|meses|dia|dias|ano|anos|semana|semanas)\b/.test(n),
      false,
      `texto dá prazo numérico: ${texto.slice(0, 70)}…`,
    );
    assert.equal(
      /\bem media (?:de )?\d/.test(n),
      false,
      `texto dá média de prazo: ${texto.slice(0, 70)}…`,
    );
  }
});

test("nenhum texto sugere percentual de lance", () => {
  // Nem "%" nem "por cento" — não existe percentual que ganhe, e dizer um
  // número é inventar um.
  for (const texto of TODOS_OS_TEXTOS) {
    const n = normalizar(texto);
    assert.equal(/\d\s*%/.test(n), false, `texto tem percentual: ${texto.slice(0, 70)}…`);
    assert.equal(
      /\bpor cento\b/.test(n),
      false,
      `texto tem "por cento": ${texto.slice(0, 70)}…`,
    );
  }
});

test("nenhum texto trata consórcio como produto de rentabilidade", () => {
  // Léxico proibido da casa. Consórcio não é investimento.
  const PROIBIDAS = [
    /\binvestimento\b/,
    /\binvestidor\b/,
    /\brendimento\b/,
    /\brentabilidade\b/,
    /\blucro\b/,
    /\bcdi\b/,
  ];
  for (const texto of TODOS_OS_TEXTOS) {
    const n = normalizar(texto);
    for (const p of PROIBIDAS) {
      assert.equal(
        p.test(n),
        false,
        `texto usa léxico proibido (${p}): ${texto.slice(0, 70)}…`,
      );
    }
  }
});

test("TODOS_OS_TEXTOS cobre de fato tudo que vai ao cliente", () => {
  // A varredura acima só vale se a lista estiver completa. Este teste é o que
  // impede alguém de acrescentar uma fala nova e esquecer de listá-la — as
  // varreduras passariam sem nunca ter lido o texto novo.
  for (const t of [PARTE_1_VERDADE, PARTE_2_PORTA, TEXTO_LANCE_EMBUTIDO, TEXTO_FECHAMENTO]) {
    assert.ok(TODOS_OS_TEXTOS.includes(t), "texto exportado fora de TODOS_OS_TEXTOS");
  }
  // 4 blocos + 3 perguntas
  assert.equal(TODOS_OS_TEXTOS.length, 4 + CAMPOS.length);
  for (const t of TODOS_OS_TEXTOS) {
    assert.ok(t.trim().length > 0, "texto vazio na lista");
  }
});

test("o lance embutido diz que o crédito recebido diminui", () => {
  // O oposto da varredura: aqui a ausência é que seria o defeito. A meia
  // verdade sobre lance embutido ("aumenta a chance") sem a outra metade
  // ("diminui o que você recebe") é o que se conta por aí.
  const n = normalizar(TEXTO_LANCE_EMBUTIDO);
  assert.ok(/diminui/.test(n), "não diz que o valor recebido diminui");
  assert.ok(/menor/.test(n), "não diz que o crédito que chega é menor");
});

test("a parte 1 não suaviza: a entrada continua indispensável", () => {
  const n = normalizar(PARTE_1_VERDADE);
  assert.ok(/indispensavel/.test(n));
});

test("o fechamento avisa que quem fecha é humano", () => {
  const n = normalizar(TEXTO_FECHAMENTO);
  assert.ok(/pessoa do time|time|gente/.test(n), "não anuncia a passagem ao humano");
});

// ---------------------------------------------------------------------------
// GRUPO 2 — a máquina de estados
// ---------------------------------------------------------------------------

test("estado vazio abre com as duas partes e a primeira pergunta", () => {
  const passo = proximoPasso({});
  assert.equal(passo.etapa, "abertura");
  assert.equal(passo.completo, false);
  assert.ok(passo.texto.includes(PARTE_1_VERDADE), "abertura sem a verdade");
  assert.ok(passo.texto.includes(PARTE_2_PORTA), "abertura sem a porta");
  // A ordem importa: a verdade vem ANTES da porta, senão vira contorno de
  // objeção.
  assert.ok(
    passo.texto.indexOf(PARTE_1_VERDADE) < passo.texto.indexOf(PARTE_2_PORTA),
    "a porta veio antes da verdade",
  );
});

test("proximoPasso sem argumento equivale a estado vazio", () => {
  assert.equal(proximoPasso().texto, textoAbertura());
});

test("as perguntas saem uma de cada vez, na ordem pressa → credito → parcela", () => {
  const estado: EstadoPivo = {};

  estado.pressa = null; // perguntado, ainda sem resposta
  assert.equal(proximoCampo(estado), "pressa");

  estado.pressa = "dá pra esperar";
  assert.equal(proximoCampo(estado), "credito");
  const p2 = proximoPasso(estado);
  assert.equal(p2.etapa, "credito");
  assert.equal(p2.completo, false);

  estado.credito = "uns 200 mil";
  assert.equal(proximoCampo(estado), "parcela");
  const p3 = proximoPasso(estado);
  assert.equal(p3.etapa, "parcela");
  assert.equal(p3.completo, false);

  estado.parcela = "1500";
  assert.equal(proximoCampo(estado), null);
});

test("cada pergunta é uma só — não há três num balão", () => {
  // Conta pontos de interrogação por fala. Mais de dois já é um balão que
  // recebe uma resposta só; a segunda interrogação existente é retórica
  // dentro da mesma pergunta ("precisa com urgência, ou dá pra esperar?").
  const estado: EstadoPivo = { pressa: "x", credito: "y" };
  const passo = proximoPasso(estado);
  const interrogacoes = (passo.texto.match(/\?/g) ?? []).length;
  assert.ok(interrogacoes <= 2, `pergunta com ${interrogacoes} interrogações`);
});

test("campo respondido com null ou vazio conta como NÃO respondido", () => {
  // Repetir a pergunta é melhor do que entregar ficha furada ao humano.
  assert.equal(proximoCampo({ pressa: null }), "pressa");
  assert.equal(proximoCampo({ pressa: "" }), "pressa");
  assert.equal(proximoCampo({ pressa: "   " }), "pressa");
});

test("estado parcialmente preenchido NÃO volta para a abertura", () => {
  // A abertura só existe quando nada foi perguntado. Um cliente que já ouviu a
  // verdade não pode ouvi-la de novo.
  const passo = proximoPasso({ pressa: null });
  assert.notEqual(passo.etapa, "abertura");
});

test("todos os campos respondidos ⇒ fechamento com completo true", () => {
  const passo = proximoPasso({ pressa: "sem pressa", credito: "300 mil", parcela: "2 mil" });
  assert.equal(passo.etapa, "fechamento");
  assert.equal(passo.completo, true);
  assert.equal(passo.texto, TEXTO_FECHAMENTO);
});

test("a ficha só traz campo com resposta de verdade", () => {
  // Campo vazio no painel tem de significar "não sabemos", nunca "respondeu
  // vazio".
  const ficha = fichaColetada({ pressa: "  dá pra esperar  ", credito: null, parcela: "" });
  assert.deepEqual(ficha, { pressa: "dá pra esperar" });
});

test("ficha de estado vazio é objeto vazio", () => {
  assert.deepEqual(fichaColetada({}), {});
});

test("a ficha completa tem exatamente os três campos", () => {
  const ficha = fichaColetada({ pressa: "a", credito: "b", parcela: "c" });
  assert.deepEqual(Object.keys(ficha).sort(), [...CAMPOS].sort());
});

test("o kill-switch tem o nome combinado", () => {
  assert.equal(ENV_KILL_SWITCH, "PROSPERITO_SEM_ENTRADA");
});

// ---------------------------------------------------------------------------
// GRUPO 3 — a ponte com o cérebro
// ---------------------------------------------------------------------------

function comSwitch<T>(valor: string | undefined, fn: () => T): T {
  const antes = process.env[ENV_KILL_SWITCH];
  if (valor === undefined) delete process.env[ENV_KILL_SWITCH];
  else process.env[ENV_KILL_SWITCH] = valor;
  try {
    return fn();
  } finally {
    if (antes === undefined) delete process.env[ENV_KILL_SWITCH];
    else process.env[ENV_KILL_SWITCH] = antes;
  }
}

test("desarmado, o bloco é vazio — o system fica idêntico ao de hoje", () => {
  // Os três jeitos de não estar armado: ausente, vazio, e qualquer outro valor.
  assert.equal(comSwitch(undefined, () => blocoSemEntrada(true)), "");
  assert.equal(comSwitch("", () => blocoSemEntrada(true)), "");
  assert.equal(comSwitch("true", () => blocoSemEntrada(true)), "");
  assert.equal(comSwitch("ON", () => blocoSemEntrada(true)), "");
  assert.equal(comSwitch("1", () => blocoSemEntrada(true)), "");
});

test("armado mas cliente não é sem-entrada ⇒ bloco vazio", () => {
  assert.equal(comSwitch("on", () => blocoSemEntrada(false)), "");
});

test("armado e sem-entrada ⇒ bloco com as duas partes na ordem", () => {
  const b = comSwitch("on", () => blocoSemEntrada(true));
  assert.ok(b.length > 0);
  assert.ok(b.includes(PARTE_1_VERDADE));
  assert.ok(b.includes(PARTE_2_PORTA));
  assert.ok(b.indexOf(PARTE_1_VERDADE) < b.indexOf(PARTE_2_PORTA), "porta antes da verdade");
});

test("o bloco reusa as constantes — não existe segunda cópia dos textos", () => {
  // Este é o teste que dá sentido a todo o GRUPO 1. Se o bloco tivesse frases
  // próprias, a varredura de palavras proibidas estaria vigiando um texto que
  // nunca chega ao modelo.
  const b = comSwitch("on", () => blocoSemEntrada(true));
  for (const t of TODOS_OS_TEXTOS) {
    assert.ok(b.includes(t), `bloco não reusa: ${t.slice(0, 50)}…`);
  }
});

test("o bloco manda perguntar uma de cada vez e proíbe promessa", () => {
  const b = normalizar(comSwitch("on", () => blocoSemEntrada(true)));
  assert.ok(/uma pergunta por mensagem/.test(b), "não exige uma pergunta por mensagem");
  assert.ok(/nunca as tres/.test(b));
  assert.ok(/proibido/.test(b), "não lista o que é proibido");
});

test("o bloco não introduz palavra proibida por conta própria", () => {
  // A instrução PODE citar "garantido" para proibir. O que não pode é oferecer
  // prazo ou percentual. Varredura mais estreita que a do GRUPO 1, de propósito.
  const b = normalizar(comSwitch("on", () => blocoSemEntrada(true)));
  assert.equal(/\b\d+\s*(?:mes|meses|dia|dias|ano|anos)\b/.test(b), false);
  assert.equal(/\d\s*%/.test(b), false);
});
