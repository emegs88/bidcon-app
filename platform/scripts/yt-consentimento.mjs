// ============================================================================
// YT-REAUTH-01 · scripts/yt-consentimento.mjs
// AUTORIZADO: Emerson Gomes dos Santos — OS "YT-REAUTH-01":
// "preparar o fluxo de reautorização do YouTube (rota admin ou script que
//  imprime a URL de consentimento ...). E na MESMA tela de consentimento, JÁ
//  INCLUIR os 2 escopos que o FAROL_YT_COMENTA esperava."
// ----------------------------------------------------------------------------
// O QUE ESTE SCRIPT É, E O QUE ELE NÃO É.
//
// Ele IMPRIME a URL do consentimento do Google. Só isso. Não fala com o Google,
// não troca código, não grava env, não vê o refresh_token — a troca continua
// sendo do /api/youtube/oauth/callback, e o token continua indo pra env pela
// mão do Emerson.
//
// POR QUE ELE EXISTE, se a rota /api/youtube/oauth/start já monta essa URL.
// Porque a rota RESPONDE 307 e é guardada por `Authorization: Bearer`. Navegador
// nenhum manda cabeçalho quando você digita uma URL na barra — então a rota,
// sozinha, não é utilizável pelo caminho para o qual foi feita. Este script é a
// ponte: ele manda o Bearer, lê o `Location`, e te devolve uma URL que você cola
// no navegador certo.
//
// POR QUE ELE NÃO REMONTA A URL SOZINHO. Seria fácil: ler YT_CLIENT_ID, montar
// os query params, assinar o `state`. Seria também uma SEGUNDA implementação do
// HMAC do `state` e uma SEGUNDA lista de escopos — e duas listas com o mesmo
// nome divergem na primeira vez que alguém edita uma só. Esse defeito já custou
// uma manhã nesta casa (DIAG-CONTAINER-02). Aqui a fonte da verdade continua
// sendo `lib/youtube/upload.ts`, e este script é um cliente dela.
//
// CONSEQUÊNCIA BOA DISSO: os escopos que ele imprime são os que o servidor
// REALMENTE pediu, lidos da URL que voltou — medição, não promessa. Se alguém
// mexer em `ESCOPOS` e esquecer, a mudança aparece aqui na hora.
//
// O SEGREDO NUNCA VAI PRO STDOUT. `DISPARO_SECRET` é lido, usado num cabeçalho e
// esquecido. Nem em erro, nem truncado.
//
// Uso (a partir de platform/):
//   node scripts/yt-consentimento.mjs
//   node scripts/yt-consentimento.mjs https://app.bidcon.com.br   (base alternativa)
//
// O segredo vem de process.env.DISPARO_SECRET; se não houver, do .env.local.
// ============================================================================
import { readFileSync } from "node:fs";

const BASE_PADRAO = "https://app.bidcon.com.br";
const CAMINHO_START = "/api/youtube/oauth/start";

/** Validade do `state` assinado, em minutos. Espelha VALIDADE_STATE_MS do lib. */
const VALIDADE_STATE_MIN = 15;

function morrer(msg) {
  console.error(`ERRO: ${msg}`);
  process.exit(1);
}

// ---- segredo: env do processo primeiro, .env.local depois -------------------
function lerSegredo() {
  if (process.env.DISPARO_SECRET) return process.env.DISPARO_SECRET;
  let texto;
  try {
    texto = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return null; // sem arquivo e sem env: o chamador explica
  }
  for (const linha of texto.split("\n")) {
    const m = linha.match(/^DISPARO_SECRET=(.*)$/);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

const base = (process.argv[2] ?? BASE_PADRAO).replace(/\/+$/, "");
const segredo = lerSegredo();
if (!segredo) {
  morrer(
    "DISPARO_SECRET ausente.\n" +
      "  Defina no ambiente:  DISPARO_SECRET=... node scripts/yt-consentimento.mjs\n" +
      "  ou coloque a linha DISPARO_SECRET=... no platform/.env.local"
  );
}

// ---- pede a URL ao servidor, sem seguir o redirecionamento ------------------
// `redirect: "manual"` é o ponto do exercício: queremos LER o Location, não ir
// até ele. Seguir levaria este script à tela de login do Google, que não serve
// de nada num terminal.
let resp;
try {
  resp = await fetch(`${base}${CAMINHO_START}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${segredo}` },
    redirect: "manual",
  });
} catch (e) {
  morrer(`não consegui falar com ${base}: ${e?.message ?? e}`);
}

if (resp.status === 401) {
  morrer(
    "o servidor recusou o Bearer (401).\n" +
      "  O DISPARO_SECRET desta máquina não é o mesmo que está na Vercel."
  );
}

const local = resp.headers.get("location");
if (!local) {
  const corpo = (await resp.text()).slice(0, 300);
  morrer(`resposta inesperada (HTTP ${resp.status}), sem Location:\n${corpo}`);
}

// ---- o que o servidor REALMENTE pediu ---------------------------------------
let escopos = [];
let accessType = "(ausente)";
let prompt = "(ausente)";
try {
  const q = new URL(local).searchParams;
  escopos = (q.get("scope") ?? "").split(" ").filter(Boolean);
  accessType = q.get("access_type") ?? "(ausente)";
  prompt = q.get("prompt") ?? "(ausente)";
} catch {
  // URL ilegível é sinal de defeito no servidor, mas a URL crua ainda serve —
  // imprimo assim mesmo e deixo o aviso abaixo dizer que não consegui conferir.
}

const linhas = [
  "",
  "URL DO CONSENTIMENTO — cole no navegador LOGADO EM @Bidconoficial:",
  "",
  local,
  "",
  "-----------------------------------------------------------------",
  `Escopos que o servidor pediu (${escopos.length}):`,
  ...(escopos.length ? escopos.map((s) => `  · ${s}`) : ["  (não consegui ler a URL)"]),
  "",
  `access_type=${accessType}   prompt=${prompt}`,
  "  access_type=offline é o que faz existir refresh_token.",
  "  prompt=consent é o que força um token NOVO numa reautorização.",
  "",
  `Esta URL vale ${VALIDADE_STATE_MIN} minutos (o \`state\` é assinado e expira).`,
  "",
  "Conta errada gera um token válido que sobe Short no canal errado.",
  "Confira o avatar no canto do Google antes de clicar em Permitir.",
  "",
  "Depois de autorizar, o callback imprime o valor UMA vez. Copie para a",
  "env YT_REFRESH_TOKEN na Vercel e faça um redeploy para ela valer.",
  "-----------------------------------------------------------------",
  "",
];
console.log(linhas.join("\n"));
