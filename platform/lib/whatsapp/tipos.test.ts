// ============================================================================
// lib/whatsapp/tipos.test.ts — OUVIDO-01 v2, o portão do item (a)+(b).
// ----------------------------------------------------------------------------
// O TESTE QUE O PRÓPRIO tipos.ts CITA PELO NOME
//
// `tipos.ts` diz, no cabeçalho: "o teste `TIPOS espelha o CHECK da 0091` existe
// para que a divergência apareça no portão, e não no cliente". Este arquivo é
// o que faz essa frase deixar de ser promessa.
//
// ----------------------------------------------------------------------------
// POR QUE O ESPELHO LÊ O SQL DO DISCO (e compara nos DOIS sentidos)
//
// Repetir a lista aqui à mão provaria nada: seriam duas cópias minhas
// concordando uma com a outra, e as duas erradas juntas no dia em que eu
// errasse a digitação. O teste lê `0091_wa_mensagens_tipo.sql`, EXTRAI a lista
// de dentro do CHECK e compara conjunto com conjunto.
//
// O precedente da casa é `lib/reserve/0017.test.ts`, que faz paridade estática
// lendo a migration. Uma diferença deliberada: o 0017 só pergunta
// `SQL.includes(valor_do_TS)` — um sentido só. Isso deixa passar o caso de um
// valor existir no SQL e não no TS, que é justamente o modo de falhar que dói
// aqui: o banco aceitaria um valor que o escritor nunca produz, e ninguém veria.
// Aqui a comparação é de igualdade de conjuntos, então os DOIS lados gritam.
//
// ----------------------------------------------------------------------------
// A PROPRIEDADE QUE SUSTENTA A FATIA INTEIRA
//
// `normalizarTipo` NUNCA pode devolver algo fora da lista do CHECK. Se devolver,
// o INSERT do webhook falha, e um INSERT que falha aqui é a mensagem do cliente
// sumindo INTEIRA — estritamente pior que o defeito que estamos consertando.
// O teste "toda saída de normalizarTipo cabe no CHECK" é o que trava isso, e é
// o mais importante do arquivo.
//
// Regra 9 — todo controle tem os dois lados. O caso que o banco REJEITOU no
// controle vivo da 0091 ('audio_de_voz') reaparece aqui de propósito: é a prova
// de que o extrator de lista está lendo mesmo, e não devolvendo tudo.
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  TIPOS_META,
  TIPOS_MENSAGEM,
  TIPO_DESCONHECIDO,
  MARCA_AUDIO_RECEBIDO,
  PREFIXO_TRANSCRICAO,
  normalizarTipo,
  placeholderDoTipo,
  cerebroConsegueLer,
  textoFallback,
  type TipoMensagem,
} from "./tipos";

// ---- a migration como texto -------------------------------------------------
const AQUI = dirname(fileURLToPath(import.meta.url));
const SQL_PATH = resolve(AQUI, "../../supabase/migrations/0091_wa_mensagens_tipo.sql");
const SQL = readFileSync(SQL_PATH, "utf8");

/** Tira os comentários `--` ANTES de procurar valores. O cabeçalho da 0091
 *  cita 'desconhecido', 'unknown' e 'unsupported' em prosa; sem esta limpeza o
 *  extrator colheria prosa e o espelho passaria por acidente. */
const SQL_SEM_COMENTARIO = SQL.replace(/--[^\n]*/g, "");

/** A lista de dentro do `tipo in (...)` do CHECK, e só ela. */
function listaDoCheck(): string[] {
  const m = SQL_SEM_COMENTARIO.match(
    /add\s+constraint\s+wa_mensagens_tipo_check\s+check\s*\([\s\S]*?tipo\s+in\s*\(([\s\S]*?)\)/i
  );
  assert.ok(m, "não achei o CHECK wa_mensagens_tipo_check na 0091");
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

// ============================================================================
// CASO 1 — o espelho
// ============================================================================

test("TIPOS espelha o CHECK da 0091", () => {
  // Igualdade de CONJUNTOS: sobra no SQL grita, falta no SQL grita.
  assert.deepEqual([...listaDoCheck()].sort(), [...TIPOS_MENSAGEM].sort());
});

test("CONTROLE do espelho: o extrator lê mesmo a lista, e não tudo", () => {
  // Regra 9. Se `listaDoCheck` devolvesse o arquivo inteiro, ou vazio, o teste
  // acima passaria/falharia por motivo errado. Estes dois lados fixam isso:
  const lista = listaDoCheck();
  assert.equal(lista.length, 16, "o CHECK da 0091 tem 16 valores");
  // O MESMO valor que o banco recusou no controle vivo da 0091. Se ele
  // aparecesse aqui, o extrator estaria colhendo prosa em vez do CHECK.
  assert.equal(lista.includes("audio_de_voz"), false);
  assert.equal(lista.includes("audio"), true);
});

test("a 0091 é re-executável (Regra 3) e não inventa passado (Regra 19)", () => {
  const sql = SQL_SEM_COMENTARIO.toLowerCase();
  assert.ok(/add\s+column\s+if\s+not\s+exists\s+tipo\b/.test(sql), "coluna aditiva");
  assert.ok(/drop\s+constraint\s+if\s+exists/.test(sql), "CHECK recriável");
  // Sem backfill: adivinhar o tipo das 976 linhas antigas seria gravar mentira
  // que nenhuma consulta futura desfaz.
  assert.equal(/update\s+public\.wa_mensagens/.test(sql), false, "sem backfill");
  assert.equal(/\bnot\s+null\b/.test(sql), false, "a coluna NÃO é NOT NULL");
});

// ============================================================================
// CASO 2 — normalizarTipo: o escritor é quem protege o CHECK
// ============================================================================

test("toda saída de normalizarTipo cabe no CHECK — a propriedade que sustenta a fatia", () => {
  // O teste mais importante do arquivo. Enquanto ele passar, o CHECK da 0091
  // NÃO PODE recusar um INSERT do webhook, faça a Meta o que fizer.
  const permitidos = new Set<string>(listaDoCheck());
  const estranhos = [
    "audio_de_voz", "AUDIO", "  video  ", "tipo_que_a_meta_ainda_nao_inventou",
    "🙂", "text; drop table wa_mensagens", "null", "undefined", "0", "[]",
    ...TIPOS_MENSAGEM,
  ];
  for (const bruto of estranhos) {
    const t = normalizarTipo(bruto);
    assert.ok(t !== null, `'${bruto}' não deveria dar null`);
    assert.ok(permitidos.has(t), `normalizarTipo('${bruto}') = '${t}' fora do CHECK`);
  }
});

test("normalizarTipo devolve o vocabulário da Meta intacto", () => {
  for (const t of TIPOS_META) assert.equal(normalizarTipo(t), t);
});

test("normalizarTipo apara espaço e caixa", () => {
  assert.equal(normalizarTipo("  AUDIO "), "audio");
  assert.equal(normalizarTipo("Image"), "image");
});

test("normalizarTipo manda o que não conhece para 'desconhecido'", () => {
  assert.equal(normalizarTipo("audio_de_voz"), TIPO_DESCONHECIDO);
  assert.equal(normalizarTipo("tipo_novo_da_meta"), TIPO_DESCONHECIDO);
});

test("'unknown' e 'unsupported' da Meta NÃO viram 'desconhecido'", () => {
  // Doutrina: "a Meta disse que não suporta" e "a Meta disse algo que nunca
  // vimos" são fatos diferentes e não podem virar o mesmo registro.
  assert.equal(normalizarTipo("unknown"), "unknown");
  assert.equal(normalizarTipo("unsupported"), "unsupported");
  assert.notEqual(normalizarTipo("unknown"), TIPO_DESCONHECIDO);
});

test("ausente é null, e null NÃO é 'desconhecido' — Regra 19", () => {
  // "a Meta não declarou tipo" ≠ "a Meta declarou tipo que não conhecemos".
  // Achatar os dois apagaria a diferença de forma irreversível.
  assert.equal(normalizarTipo(null), null);
  assert.equal(normalizarTipo(undefined), null);
  assert.equal(normalizarTipo(""), null);
  assert.equal(normalizarTipo("   "), null);
  // O outro lado do controle: o que NÃO é ausente jamais devolve null.
  assert.notEqual(normalizarTipo("qualquer_coisa"), null);
});

// ============================================================================
// CASO 3 — cerebroConsegueLer: a rede é por CONTEÚDO, não por tipo
// ============================================================================

test("cerebroConsegueLer é falso para vazio, espaço e não-string", () => {
  assert.equal(cerebroConsegueLer(""), false);
  assert.equal(cerebroConsegueLer("   "), false);
  assert.equal(cerebroConsegueLer(null), false);
  assert.equal(cerebroConsegueLer(undefined), false);
});

test("cerebroConsegueLer é falso para TODA marca que nós mesmos escrevemos", () => {
  // Iterado sobre os tipos, não escrito à mão: placeholder novo entra nesta
  // verificação sozinho, sem ninguém lembrar de vir aqui.
  let marcas = 0;
  for (const t of TIPOS_MENSAGEM) {
    const p = placeholderDoTipo(t);
    if (p === null) continue;
    marcas++;
    assert.equal(cerebroConsegueLer(p), false, `marca '${p}' não pode virar turno`);
  }
  assert.ok(marcas > 0, "CONTROLE: se não há marca nenhuma, o teste acima é vazio");
});

test("cerebroConsegueLer é VERDADEIRO para transcrição — transcrição é a fala do cliente", () => {
  assert.equal(cerebroConsegueLer(`${PREFIXO_TRANSCRICAO} quero vender minha cota`), true);
  // e o controle do outro lado: a marca de ANTES da transcrição não passa.
  assert.equal(cerebroConsegueLer(MARCA_AUDIO_RECEBIDO), false);
});

test("a rede é por CONTEÚDO: tipo nunca visto com texto passa; sem texto, não", () => {
  // O ponto da fatia. Um tipo que a Meta inventar amanhã não está em lista
  // nenhuma de barrados — e mesmo assim é barrado, se vier vazio.
  const inventado = normalizarTipo("tipo_que_a_meta_inventar_amanha");
  assert.equal(inventado, TIPO_DESCONHECIDO);
  assert.equal(cerebroConsegueLer("bom dia, quero vender"), true);
  assert.equal(cerebroConsegueLer(""), false);
});

// ============================================================================
// CASO 4 — placeholderDoTipo: poucos DE PROPÓSITO, para o vigia poder gritar
// ============================================================================

test("os tipos que esta fatia trata ganham marca legível", () => {
  assert.equal(placeholderDoTipo("audio"), MARCA_AUDIO_RECEBIDO);
  assert.equal(placeholderDoTipo("video"), "[vídeo recebido]");
  assert.equal(placeholderDoTipo("sticker"), "[figurinha recebida]");
  assert.equal(placeholderDoTipo("location"), "[localização recebida]");
});

test("tipo não tratado devolve null — é isso que mantém o vigia capaz de gritar", () => {
  // Se alguém trocar isto por `"[" + tipo + " recebido]"`, o conteúdo-vazio
  // passa a ser zero POR CONSTRUÇÃO, e um contador que nunca sai de zero não
  // vigia nada. Este teste é o que faz essa mudança doer no portão.
  assert.equal(placeholderDoTipo("text"), null);
  assert.equal(placeholderDoTipo("interactive"), null);
  assert.equal(placeholderDoTipo(TIPO_DESCONHECIDO), null);
  assert.equal(placeholderDoTipo(null), null);

  // CONTROLE: sobrou tipo SEM marca? Se um dia não sobrar, o vigia do
  // conteúdo-vazio ficou cego e este teste é quem avisa.
  const semMarca = TIPOS_MENSAGEM.filter((t) => placeholderDoTipo(t) === null);
  assert.ok(semMarca.length > 0, "CONTROLE: todo tipo virou marca — o vigia cegou");
});

// ============================================================================
// CASO 5 — textoFallback: a rede, nunca o caminho
// ============================================================================

test("no áudio, a frase da ordem sai AO PÉ DA LETRA", () => {
  // O caso que a ordem estava olhando. Nenhuma liberdade aqui.
  assert.equal(
    textoFallback("audio"),
    "Recebi teu áudio! Consegues me escrever em texto? Assim te respondo certinho 😊"
  );
});

test("nos demais tipos troca só o substantivo — o bot não mente sobre o que recebeu", () => {
  // DESVIO DECLARADO em tipos.ts: a frase literal diria "Recebi teu áudio!"
  // para quem mandou figurinha. Forma, pedido e emoji ficam idênticos.
  assert.equal(
    textoFallback("sticker"),
    "Recebi tua figurinha! Consegues me escrever em texto? Assim te respondo certinho 😊"
  );
  assert.ok(textoFallback("video").includes("teu vídeo"));
  assert.ok(textoFallback("location").includes("tua localização"));
});

test("sem tipo, o fallback é genérico e ainda assim honesto", () => {
  assert.ok(textoFallback(null).includes("tua mensagem"));
  assert.ok(textoFallback("interactive").includes("tua mensagem"));
});

test("CONTROLE: o fallback nunca sai vazio e nunca perde o pedido", () => {
  // Um fallback vazio seria um turno vazio saindo — o defeito que a fatia
  // conserta, do lado de fora.
  const alvos: (TipoMensagem | null)[] = [null, ...TIPOS_MENSAGEM];
  for (const t of alvos) {
    const frase = textoFallback(t);
    assert.ok(frase.trim().length > 0, `fallback vazio para '${t}'`);
    assert.ok(frase.includes("escrever em texto"), `fallback sem o pedido: '${frase}'`);
    assert.ok(cerebroConsegueLer(frase), "o fallback é fala de verdade");
  }
});
