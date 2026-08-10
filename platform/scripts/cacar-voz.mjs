// ============================================================================
// scripts/cacar-voz.mjs — o inventário CRU de vozes da HeyGen, sem peneira
// AUTORIZADO: Emerson Gomes dos Santos — ordem de 10/08/2026: "caçar a voz da
// marca (Brazilian Consultant), não o Pedro Lima, que foi só socorro".
// ----------------------------------------------------------------------------
// POR QUE ESTE ARQUIVO EXISTE, e por que ele NÃO é o scripts/vozes.mjs.
//
// vozes.mjs é cliente de /api/farol/reel-opcoes, e aquela rota é um CARDÁPIO:
// consulta 3 rótulos de idioma, peneira por pareceBr() e corta em
// slice(0, 20). Para escolher voz feminina entre as candidatas óbvias isso
// serve. Para CAÇAR uma voz específica, não serve — uma voz que a conta não
// indexe como "Portuguese", ou que caia na 21ª posição, simplesmente não
// aparece, e a ausência seria lida como inexistência. Falso negativo.
//
// E há um segundo motivo, medido em 10/08: lib/heygen.ts listarVozes() mapeia
// o objeto da API para {id, nome, genero, idioma, origem} e DESCARTA o resto.
// A ordem pede "se é premium" e "quais têm amostra de áudio acessível" — dois
// campos que aquele mapa joga fora. Por isso aqui o objeto vem CRU: eu imprimo
// as chaves que a API de fato devolve, em vez de assumir quais são.
//
// DUAS FONTES, DE PROPÓSITO. /v3/voices é o que a lib usa. /v2/voices é o
// inventário legado, que costuma trazer preview_audio e as flags de suporte.
// O tipo OpcaoVoz do repo já prevê origem "v3" | "v2" — mas listarVozes só
// usa a v3. Aqui as duas são consultadas e comparadas: se um id aparece numa e
// não na outra, isso É o diagnóstico.
//
// O SEGREDO NÃO ENTRA NO HISTÓRICO NEM NA TELA. Mesmo padrão de vozes.mjs: a
// chave vem da env da sessão ou de um prompt com eco desligado. Nunca é
// impressa, nunca é logada, nunca é gravada em arquivo.
//
// SÓ LÊ, E SÓ GET. Não existe um único POST neste arquivo. Não dispara render,
// não publica, não grava, não gasta. Listar voz é chamada gratuita.
//
// Rodar:  cd platform && node scripts/cacar-voz.mjs
// ============================================================================
import { createInterface } from "node:readline";

const BASE = "https://api.heygen.com";
const TIMEOUT_MS = 20_000;

/** A voz que a API recusou em 10/08 às 11h31. Se ela NÃO estiver no
 *  inventário, isso prova a hipótese "exclusiva do Video Agent". */
const ID_RECUSADA = "05601cd1a3f34777b78dce4e1ff9c66c";

/** Pedro Lima, o socorro que está na env hoje. Serve de CONTROLE: se nem ele
 *  aparecer, o problema é a listagem, não a voz. Sem esse controle, uma lista
 *  vazia seria indistinguível de uma voz ausente. */
const ID_SOCORRO = "6872a840c4194f42a7f8ce0aee47660c";

/** Mais largo do que a ordem pediu, de propósito: "brazil" pega "Brazilian",
 *  e "bidcon" pega o caso de a voz ter sido clonada com o nome da marca. */
const PADRAO_CACA = /brazil|consultant|porta.?voz|bidcon|brasil/i;

// ---------------------------------------------------------------------------
// Entrada do segredo
// ---------------------------------------------------------------------------

function perguntarOculto(pergunta) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const eraTTY = process.stdin.isTTY;
    process.stdout.write(pergunta);
    rl.output.write = () => {}; // engole o eco das teclas
    rl.question("", (resposta) => {
      rl.close();
      if (eraTTY) process.stdout.write("\n");
      resolve(resposta.trim());
    });
  });
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/**
 * GET cru. Nunca lança: todo erro vira {ok:false, erro} com o status HTTP
 * junto, porque é o status que distingue 401 (chave errada) de 404 (endpoint
 * não existe nesta conta) de 429 (cota).
 */
async function get(caminho, chave) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${BASE}${caminho}`, {
      headers: { "x-api-key": chave, "content-type": "application/json" },
      signal: ctrl.signal,
    });
    const txt = await r.text();
    let j = null;
    try {
      j = JSON.parse(txt);
    } catch {
      /* deixa null: o corpo cru vai na mensagem de erro abaixo */
    }
    if (!r.ok) {
      const msg = j?.error?.message ?? j?.message ?? txt.slice(0, 200);
      const cod = j?.error?.code ? ` code=${j.error.code}` : "";
      return { ok: false, erro: `http_${r.status}${cod} ${msg}` };
    }
    return { ok: true, data: j };
  } catch (e) {
    if (e?.name === "AbortError") return { ok: false, erro: `timeout_${TIMEOUT_MS}ms` };
    return { ok: false, erro: `excecao ${e?.message ?? e}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Acha a lista de vozes sem chutar o nome do campo.
 *
 * v2 e v3 não devolvem o mesmo envelope, e eu não quero escrever
 * `data.voices` e receber [] em silêncio se um dia mudar. Então varro o JSON
 * e fico com o MAIOR array de objetos — e devolvo o caminho junto, para
 * imprimir de onde saiu. Assim, se vier vazio, dá para ver se foi por não
 * achar o campo ou por a conta não ter vozes.
 */
function acharLista(raiz) {
  let melhor = { caminho: "(nenhum)", lista: [] };
  const visitar = (no, caminho, prof) => {
    if (prof > 5 || no === null || typeof no !== "object") return;
    if (Array.isArray(no)) {
      const objetos = no.filter((x) => x && typeof x === "object" && !Array.isArray(x));
      if (objetos.length > melhor.lista.length) melhor = { caminho, lista: objetos };
      return;
    }
    for (const [k, v] of Object.entries(no)) visitar(v, `${caminho}.${k}`, prof + 1);
  };
  visitar(raiz, "$", 0);
  return melhor;
}

/** Primeiro campo não-vazio entre vários nomes possíveis. */
function campo(o, ...nomes) {
  for (const n of nomes) {
    const v = o?.[n];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "boolean" || typeof v === "number") return String(v);
  }
  return null;
}

function normalizar(o, origem) {
  return {
    id: campo(o, "voice_id", "id"),
    nome: campo(o, "name", "display_name", "voice_name") ?? "(sem nome)",
    genero: campo(o, "gender"),
    idioma: campo(o, "language", "language_name", "locale"),
    premium: campo(o, "premium", "is_premium"),
    amostra: campo(o, "preview_audio", "sample_url", "preview_url", "audio_url"),
    origem,
    cru: o,
  };
}

// ---------------------------------------------------------------------------
// Coleta
// ---------------------------------------------------------------------------

/** v2: um payload só, sem parâmetros — é o inventário inteiro. */
async function coletarV2(chave) {
  const r = await get("/v2/voices", chave);
  if (!r.ok) return { origem: "v2", erro: r.erro, vozes: [], caminho: null };
  const { caminho, lista } = acharLista(r.data);
  return { origem: "v2", erro: null, caminho, vozes: lista.map((o) => normalizar(o, "v2")) };
}

/**
 * v3: paginada. Não presumo o nome do parâmetro de página — peço um limite
 * alto e, se o envelope trouxer algum token, sigo com ele. O que o script
 * ACHOU de token é impresso, para não virar suposição silenciosa.
 */
async function coletarV3(chave) {
  const vistas = new Map();
  let token = null;
  let caminho = null;
  let paginas = 0;
  const tokensVistos = [];

  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams({ limit: "200" });
    if (token) q.set("token", token);
    const r = await get(`/v3/voices?${q.toString()}`, chave);
    if (!r.ok) {
      if (paginas === 0) return { origem: "v3", erro: r.erro, vozes: [], caminho: null, paginas };
      break; // já trouxe alguma coisa: para e reporta o que tem
    }
    paginas++;
    const achado = acharLista(r.data);
    caminho = caminho ?? achado.caminho;
    for (const o of achado.lista) {
      const v = normalizar(o, "v3");
      if (v.id && !vistas.has(v.id)) vistas.set(v.id, v);
    }
    const raiz = r.data?.data ?? r.data ?? {};
    const prox = campo(raiz, "token", "next_token", "page_token", "cursor");
    if (!prox || prox === token) break;
    tokensVistos.push(prox.slice(0, 8) + "…");
    token = prox;
  }
  return { origem: "v3", erro: null, caminho, vozes: [...vistas.values()], paginas, tokensVistos };
}

// ---------------------------------------------------------------------------
// Amostras
// ---------------------------------------------------------------------------

/**
 * "Amostra acessível" não é "o campo existe": é "a URL responde". Um HEAD
 * curto responde isso sem baixar o áudio. Falha vira status textual, nunca
 * exceção — a lista tem de sair inteira mesmo se um link estiver podre.
 */
async function amostraAcessivel(url) {
  if (!url) return "sem URL";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { method: "HEAD", signal: ctrl.signal });
    return r.ok ? `OK ${r.status}` : `HTTP ${r.status}`;
  } catch (e) {
    return e?.name === "AbortError" ? "timeout" : "erro de rede";
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Peneiras de leitura
// ---------------------------------------------------------------------------

const ehMasculina = (v) => String(v.genero ?? "").trim().toLowerCase().startsWith("m");
const ehPtBr = (v) => /portug|pt[-_ ]?br|brazil|brasil/i.test(String(v.idioma ?? ""));

function linha(n = 78) {
  return "=".repeat(n);
}

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------

async function main() {
  let chave = process.env.HEYGEN_API_KEY;
  if (chave) {
    console.log("• HEYGEN_API_KEY veio da env da sessão.");
  } else {
    chave = await perguntarOculto("HEYGEN_API_KEY (não aparece na tela): ");
  }
  if (!chave) {
    console.error("\nERRO: chave vazia. Sem ela a API responde 401 e nada pode ser medido.");
    process.exit(1);
  }

  console.log("\nConsultando o inventário COMPLETO (v2 e v3), sem filtro de idioma...\n");

  const [v2, v3] = await Promise.all([coletarV2(chave), coletarV3(chave)]);

  // --- 0. Saúde das duas fontes -------------------------------------------
  console.log(linha());
  console.log("FONTES");
  console.log(linha());
  for (const f of [v2, v3]) {
    if (f.erro) {
      console.log(`  ${f.origem}: FALHOU — ${f.erro}`);
    } else {
      const extra = f.origem === "v3" ? `, ${f.paginas} página(s)` : "";
      console.log(`  ${f.origem}: ${f.vozes.length} vozes  (campo: ${f.caminho}${extra})`);
    }
  }
  if (v3.tokensVistos?.length) console.log(`  v3 paginou com token: ${v3.tokensVistos.join(" -> ")}`);

  const todas = new Map();
  for (const f of [v3, v2]) for (const v of f.vozes) if (v.id && !todas.has(v.id)) todas.set(v.id, v);
  const inventario = [...todas.values()];

  if (inventario.length === 0) {
    console.error("\nInventário VAZIO nas duas fontes. Não conclua nada daqui:");
    console.error("uma lista vazia por falha de chamada é indistinguível de conta sem vozes.");
    process.exit(1);
  }
  console.log(`  UNIÃO: ${inventario.length} vozes distintas`);

  // Quais chaves a API realmente devolve — para nunca mais eu assumir.
  const amostraCru = inventario.find((v) => v.origem === "v2") ?? inventario[0];
  console.log(`\n  campos crus (${amostraCru.origem}): ${Object.keys(amostraCru.cru).join(", ")}`);

  // --- 1. Controle ---------------------------------------------------------
  console.log(`\n${linha()}`);
  console.log("CONTROLE — a listagem é confiável?");
  console.log(linha());
  const socorro = todas.get(ID_SOCORRO);
  console.log(
    socorro
      ? `  Pedro Lima (socorro) ESTÁ no inventário: ${socorro.nome} [${socorro.origem}]\n  -> a listagem é confiável; ausência de outra voz significa ausência mesmo.`
      : `  Pedro Lima (socorro) NÃO está no inventário.\n  -> ATENÇÃO: a listagem NÃO é confiável. Não conclua nada sobre a outra voz.`
  );

  // --- 2. A caça ----------------------------------------------------------
  console.log(`\n${linha()}`);
  console.log("CAÇA — a voz da marca, por NOME");
  console.log(linha());
  const achadas = inventario.filter((v) => PADRAO_CACA.test(v.nome));
  if (achadas.length === 0) {
    console.log(`  Nenhuma voz com nome casando /${PADRAO_CACA.source}/i.`);
  } else {
    for (const v of achadas) {
      console.log(`\n  ${v.nome}`);
      console.log(`      id:      ${v.id}`);
      console.log(`      idioma:  ${v.idioma ?? "?"}`);
      console.log(`      gênero:  ${v.genero ?? "?"}`);
      console.log(`      premium: ${v.premium ?? "(campo não existe)"}`);
      console.log(`      origem:  ${v.origem}`);
      console.log(`      amostra: ${v.amostra ?? "(sem URL)"}`);
      console.log(`      CRU:     ${JSON.stringify(v.cru)}`);
    }
  }

  // --- 3. O id recusado em 10/08 ------------------------------------------
  console.log(`\n${linha()}`);
  console.log("O ID QUE A API RECUSOU EM 10/08");
  console.log(linha());
  const recusada = todas.get(ID_RECUSADA);
  console.log(
    recusada
      ? `  ${ID_RECUSADA} ESTÁ no inventário: "${recusada.nome}" [${recusada.origem}]\n` +
          `  -> a voz existe na API. A recusa no render tem outra causa.`
      : `  ${ID_RECUSADA} NÃO aparece em nenhuma das duas fontes.\n` +
          `  -> compatível com "exclusiva do produto Video Agent": existe no estúdio,\n` +
          `     não existe para a API de vídeo. Trocar a env por este id não adianta.`
  );

  // --- 4. Masculinas pt-BR ------------------------------------------------
  console.log(`\n${linha()}`);
  console.log("MASCULINAS pt-BR — do inventário COMPLETO, não do cardápio de 20");
  console.log(linha());
  const masc = inventario.filter((v) => ehMasculina(v) && ehPtBr(v));
  const semGenero = inventario.filter((v) => ehPtBr(v) && !v.genero).length;
  console.log(`  ${inventario.filter(ehPtBr).length} pt-BR no total; ${masc.length} marcadas masculinas.`);
  if (semGenero) console.log(`  (${semGenero} vozes pt-BR sem campo 'gender' — não entraram nesta peneira.)`);

  const dez = masc.slice(0, 10);
  console.log(`\n  Conferindo se a amostra de áudio responde (HEAD, sem baixar)...\n`);
  const estados = await Promise.all(dez.map((v) => amostraAcessivel(v.amostra)));

  dez.forEach((v, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${v.nome}  [${v.idioma ?? "?"}]`);
    console.log(`      id:      ${v.id}`);
    console.log(`      premium: ${v.premium ?? "(campo não existe)"}`);
    console.log(`      amostra: ${estados[i]}`);
    if (v.amostra) console.log(`               ${v.amostra}`);
  });

  if (masc.length > 10) console.log(`\n  (+${masc.length - 10} outras masculinas pt-BR não listadas.)`);
  console.log("");
}

main().catch((e) => {
  console.error("ERRO inesperado:", e?.message ?? e);
  process.exit(1);
});
