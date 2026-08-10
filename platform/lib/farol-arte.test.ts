// ============================================================================
// lib/farol-arte.test.ts — prova do FALLBACK e da aritmética do recorte
// AUTORIZADO: Emerson Gomes dos Santos — FAROL-ARTE-01, 09/08/2026:
//   "O FALLBACK OBRIGATÓRIO com teste — é onde mora o risco real da fatia:
//    arte inexistente, id inválido, arquivo corrompido, bucket fora do ar ou
//    lento devem TODOS cair no card de hoje, idêntico, sem drama e sem post
//    perdido. Exercitável com id inventado, custo zero."
// ----------------------------------------------------------------------------
// Rodar isolado:
//   npx tsx --tsconfig tsconfig.test.json --test lib/farol-arte.test.ts
//
// POR QUE ESTE ARQUIVO EXISTE. O resto da fatia falha ALTO: se a arte não
// carregar, o card sai navy e alguém vê. O fallback falha BAIXO — ele só é
// exercitado no dia em que algo já deu errado, que é justamente o dia em que
// ninguém quer descobrir que ele nunca funcionou. Este é o único código da
// fatia cujo defeito custa o POST DO DIA, e por isso é o único com teste.
//
// O QUE ESTE ARQUIVO NÃO FAZ, DECLARADO: não sobe rede, não toca Supabase, não
// gera imagem e não gasta um centavo. Todos os modos de falha abaixo são
// alcançados por dentro — id inventado, env ausente, endereço não roteável,
// bytes de mentira. Nenhum teste aqui depende da chave da OpenAI, que na data
// deste commit ainda não existe nesta máquina.
//
// A FORMA DAS ASSERÇÕES É DE PROPÓSITO: elas provam o CONTRATO ("devolve null e
// não lança"), nunca o caminho interno. Um teste que exigisse "caiu pelo ramo
// X" passaria a quebrar em toda refatoração e, pior, aceitaria um `null` vindo
// do ramo errado. O chamador só sabe distinguir duas coisas — veio arte, ou não
// veio — e é exatamente isso que se prende aqui.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  buscarArte,
  recorteCentral,
  tipoPelaAssinatura,
  PRAZO_MS,
  TETO_BYTES,
  VEU_NAVY,
  BUCKET_ARTES,
  VALIDADE_URL_S,
} from "./farol-arte";

/** uuid sintaticamente válido que não existe em banco nenhum. */
const UUID_INVENTADO = "0f9c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f";

/**
 * Roda `fn` com as env vars do Supabase no estado pedido e restaura depois.
 * `undefined` REMOVE a variável — é assim que se encena "o serviço não está
 * configurado", que é o mesmo efeito prático de "o banco não responde" do ponto
 * de vista desta função: `createXtvClient()` lança, e o contrato manda devolver
 * null mesmo assim.
 */
async function comEnv(
  url: string | undefined,
  chave: string | undefined,
  fn: () => Promise<void>
) {
  const antes = {
    url: process.env.BIDCON_XTV_URL,
    chave: process.env.BIDCON_XTV_SERVICE_ROLE_KEY,
  };
  if (url === undefined) delete process.env.BIDCON_XTV_URL;
  else process.env.BIDCON_XTV_URL = url;
  if (chave === undefined) delete process.env.BIDCON_XTV_SERVICE_ROLE_KEY;
  else process.env.BIDCON_XTV_SERVICE_ROLE_KEY = chave;
  try {
    await fn();
  } finally {
    if (antes.url === undefined) delete process.env.BIDCON_XTV_URL;
    else process.env.BIDCON_XTV_URL = antes.url;
    if (antes.chave === undefined) delete process.env.BIDCON_XTV_SERVICE_ROLE_KEY;
    else process.env.BIDCON_XTV_SERVICE_ROLE_KEY = antes.chave;
  }
}

// ---------------------------------------------------------------------------
// 1. RECORTE CENTRAL — a aritmética que faz UMA arte servir os dois formatos
// ---------------------------------------------------------------------------
// Estes dois casos são a CONFERÊNCIA citada em lib/farol-arte.ts e na migração
// 0076. Se algum deles mudar, a decisão de gerar em 1152×2048 mudou junto e
// precisa ser reaberta — não é um número de layout, é a justificativa do
// tamanho escolhido.

test("recorte: 1152x2048 no story 1080x1920 é redução pura, sem corte", () => {
  const r = recorteCentral({ largura: 1152, altura: 2048 }, 1080, 1920);
  assert.equal(r.largura, 1080);
  assert.equal(r.altura, 1920);
  // Offset zero nos dois eixos é o que prova que NADA foi cortado. É esta linha
  // que sustenta "reduz para 1080×1920 sem upscale e sem recorte".
  assert.equal(r.esquerda, 0);
  assert.equal(r.topo, 0);
});

test("recorte: 1152x2048 no feed 1080x1080 corta 420px de cada ponta", () => {
  const r = recorteCentral({ largura: 1152, altura: 2048 }, 1080, 1080);
  assert.equal(r.largura, 1080);
  assert.equal(r.altura, 1920);
  assert.equal(r.esquerda, 0);
  assert.equal(r.topo, -420);
  // O centro tem de ficar no centro: o que sobra embaixo é igual ao que sobra
  // em cima. Sem esta asserção, um recorte "de cima para baixo" passaria nas
  // duas anteriores e decapitaria a arte todo dia.
  const sobraBaixo = r.altura + r.topo - 1080;
  assert.equal(sobraBaixo, -r.topo);
});

test("recorte: nunca deixa tarja — a imagem sempre cobre o canvas", () => {
  // Varredura de proporções, inclusive as opostas à do acervo (arte deitada
  // num canvas em pé). A invariante é uma só e vale para todas.
  const artes = [
    { largura: 1152, altura: 2048 },
    { largura: 2048, altura: 1152 },
    { largura: 1024, altura: 1024 },
    { largura: 1536, altura: 1024 },
    { largura: 864, altura: 1536 },
  ];
  const telas = [
    [1080, 1080],
    [1080, 1920],
  ] as const;
  for (const a of artes) {
    for (const [cw, ch] of telas) {
      const r = recorteCentral(a, cw, ch);
      assert.ok(
        r.largura >= cw && r.altura >= ch,
        `arte ${a.largura}x${a.altura} em ${cw}x${ch} não cobriu`
      );
      // Excedente repartido: o deslocamento nunca é positivo (imagem menor que
      // a caixa deslocada para dentro deixaria tarja do outro lado).
      assert.ok(r.esquerda <= 0 && r.topo <= 0);
    }
  }
});

test("recorte: preserva a proporção da arte — nada é esticado", () => {
  // Arte esticada num eixo é pior do que arte nenhuma, e é o defeito que passa
  // despercebido: ninguém repara que um fundo abstrato está 6% mais largo.
  const a = { largura: 1152, altura: 2048 };
  for (const [cw, ch] of [
    [1080, 1080],
    [1080, 1920],
  ] as const) {
    const r = recorteCentral(a, cw, ch);
    const original = a.largura / a.altura;
    const final = r.largura / r.altura;
    assert.ok(
      Math.abs(original - final) < 0.005,
      `proporção mudou em ${cw}x${ch}: ${original} → ${final}`
    );
  }
});

// ---------------------------------------------------------------------------
// 2. ARQUIVO CORROMPIDO — o guarda de assinatura
// ---------------------------------------------------------------------------
// Este é o modo de falha que a ordem nomeia e que, sem este guarda, seria o mais
// caro de diagnosticar: lixo vira data URI, o satori estoura DENTRO do stream e
// o cliente recebe conexão vazia em vez de erro (a cicatriz já documentada em
// renderKit). Aqui ele morre antes, com motivo no log.

test("assinatura: reconhece PNG, JPEG e WEBP de verdade", () => {
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
  ]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
  ]);
  assert.equal(tipoPelaAssinatura(png), "image/png");
  assert.equal(tipoPelaAssinatura(jpeg), "image/jpeg");
  assert.equal(tipoPelaAssinatura(webp), "image/webp");
});

test("assinatura: recusa lixo, HTML de erro e arquivo truncado", () => {
  // Lixo puro.
  assert.equal(
    tipoPelaAssinatura(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])),
    null
  );
  // O caso REAL mais provável: o storage devolve 200 com uma página de erro.
  // `content-type` diria text/html, mas o guarda não confia nele — confia nos
  // bytes, e por isso pega também o caso em que o content-type mente.
  const html = new TextEncoder().encode("<!DOCTYPE html><html><body>erro");
  assert.equal(tipoPelaAssinatura(html), null);
  // PNG legítimo porém truncado no meio da assinatura: upload interrompido.
  assert.equal(
    tipoPelaAssinatura(new Uint8Array([0x89, 0x50, 0x4e])),
    null
  );
  // Vazio.
  assert.equal(tipoPelaAssinatura(new Uint8Array([])), null);
});

test("assinatura: PNG com um byte trocado é recusado", () => {
  // Corrupção de um bit só na assinatura. Se este passasse, o guarda estaria
  // conferindo tamanho e não conteúdo.
  const quase = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b, 0, 0, 0, 0,
  ]);
  assert.equal(tipoPelaAssinatura(quase), null);
});

// ---------------------------------------------------------------------------
// 3. O CONTRATO DE `buscarArte` — todo caminho de falha devolve null, sem lançar
// ---------------------------------------------------------------------------

test("fallback: sem id devolve null (o caminho NORMAL do card sem ?arte=)", async () => {
  assert.equal(await buscarArte(undefined), null);
  assert.equal(await buscarArte(null), null);
  assert.equal(await buscarArte(""), null);
});

test("fallback: id inválido devolve null SEM tocar o banco", async () => {
  // Env removida de propósito: se qualquer um destes chegasse a
  // `createXtvClient()`, ele lançaria — e o teste ainda veria null, mas pelo
  // motivo errado. Como o guarda de uuid vem antes, nem isso acontece.
  await comEnv(undefined, undefined, async () => {
    for (const ruim of [
      "nao-e-uuid",
      "123",
      "../../etc/passwd",
      "0f9c1d2e-3a4b-4c5d-8e6f", // uuid pela metade
      "0f9c1d2e3a4b4c5d8e6f7a8b9c0d1e2f", // sem hífen
      "0f9c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2g", // 'g' não é hex
      "'; drop table farol_arte; --",
    ]) {
      assert.equal(await buscarArte(ruim), null, `deveria recusar: ${ruim}`);
    }
  });
});

test("fallback: banco indisponível devolve null em vez de lançar", async () => {
  // Env ausente faz `createXtvClient()` lançar dentro de `carregar`. Do ponto de
  // vista do card é indistinguível de "o Supabase caiu": uma exceção no meio do
  // caminho. O contrato manda que ela NÃO suba — o post do dia não pode morrer
  // porque o enfeite não carregou.
  await comEnv(undefined, undefined, async () => {
    assert.equal(await buscarArte(UUID_INVENTADO), null);
  });
});

test("fallback: id inventado com env válida devolve null e respeita o prazo", async () => {
  // 192.0.2.0/24 é TEST-NET-1 (RFC 5737): reservado para documentação e
  // garantidamente não roteável. Serve de "bucket/banco fora do ar ou LENTO"
  // sem depender da rede da máquina que roda o teste.
  //
  // O DESFECHO PODE SER UM DE DOIS, e os dois são aceitos de propósito: em rede
  // que responde ICMP a conexão é recusada na hora (cai pelo catch), e em rede
  // que engole o pacote ela pendura até o prazo (cai pelo Promise.race). A
  // asserção prende o que importa nos DOIS casos — devolveu null, não lançou, e
  // não passou do prazo. Prender o caminho interno tornaria este teste
  // dependente da rede, que é o contrário do que ele existe para provar.
  const t0 = Date.now();
  await comEnv("http://192.0.2.1:1", "chave-de-teste-sem-valor", async () => {
    assert.equal(await buscarArte(UUID_INVENTADO), null);
  });
  const gasto = Date.now() - t0;
  assert.ok(
    gasto < PRAZO_MS + 1500,
    `demorou ${gasto}ms — o prazo de ${PRAZO_MS}ms não segurou`
  );
});

test("fallback: nunca lança, aconteça o que acontecer", async () => {
  // Rede final. Se um dia alguém acrescentar um caminho novo em `carregar` e
  // esquecer o guarda, é aqui que aparece.
  await comEnv("http://192.0.2.1:1", "x", async () => {
    for (const entrada of [null, undefined, "", "lixo", UUID_INVENTADO]) {
      await assert.doesNotReject(async () => {
        await buscarArte(entrada as string | null | undefined);
      }, `lançou para: ${String(entrada)}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. AS CONSTANTES QUE CARREGAM DECISÃO
// ---------------------------------------------------------------------------
// Não são "testes de constante" ociosos: cada um destes valores foi objeto de
// uma decisão registrada, e trocá-lo sem reabrir a decisão é o defeito que este
// bloco pega. A falha aqui é um lembrete, não um erro de digitação.

test("véu: 78% de #0A0E1A — é ele que sustenta a qualidade `medium`", () => {
  // A ordem foi literal: "véu navy 78% por cima da arte". E a escolha de
  // `medium` em vez de `high` foi aceita PORQUE este véu apaga o detalhe fino
  // que `high` compra. Mexer neste número reabre a decisão de qualidade — ver a
  // CONDIÇÃO DE REABERTURA em lib/farol-arte.ts e na migração 0076.
  assert.equal(VEU_NAVY, "rgba(10, 14, 26, 0.78)");
});

test("prazo e teto continuam nos valores medidos", () => {
  assert.equal(PRAZO_MS, 2500);
  assert.equal(TETO_BYTES, 8 * 1024 * 1024);
  // O bucket é parte do contrato com o storage: renomear aqui sem renomear lá
  // faz TODA arte cair no fallback silenciosamente — o card continua saindo, e
  // ninguém descobre que o acervo parou de ser usado.
  assert.equal(BUCKET_ARTES, "farol-artes");
});

test("a URL da arte é ASSINADA, e a validade é curta", () => {
  // O bucket é PRIVADO por decisão de coordenação: arte rejeitada não pode ser
  // servível por URL direta. Baixar para `getPublicUrl` devolveria uma URL que
  // o storage recusa, e o modo de falha seria SILENCIOSO — todo card sairia sem
  // arte, para todo mundo, e o fallback esconderia o estrago. Ver POR QUE
  // ASSINADA em lib/farol-arte.ts.
  assert.equal(VALIDADE_URL_S, 60);
  assert.ok(VALIDADE_URL_S * 1000 > PRAZO_MS, "validade menor que o prazo do fetch");
});

// ---------------------------------------------------------------------------
// 5. A TRAVA DO `preview` — o caminho de publicação nunca o passa
// ---------------------------------------------------------------------------
// AUTORIZADO: Emerson Gomes dos Santos, coordenação 10/08:
//   "buscarArte ganha um parâmetro `preview` que ignora o filtro de status,
//    usado SÓ pelo painel de curadoria em sessão admin. O caminho de publicação
//    nunca aceita preview — travar isso em teste."
//
// POR QUE ESTE TESTE LÊ CÓDIGO-FONTE, contrariando a regra do cabeçalho deste
// arquivo ("provam o CONTRATO, nunca o caminho interno"). A propriedade que
// precisa ser travada não é um comportamento de `buscarArte` — é um fato sobre
// os SÍTIOS DE CHAMADA: "ninguém no caminho de publicação passa preview".
// Nenhuma asserção de runtime dentro da lib consegue enxergar isso; a função
// não tem como saber quem a chamou nem por quê. O objeto sob teste aqui é o
// grafo de chamadas, e a única forma honesta de inspecioná-lo sem carregar o
// Next inteiro é ler o texto. Declarado por ser exceção.
//
// O QUE ELE PEGA: alguém acrescenta `{ preview: true }` na rota do card para
// "testar rápido", e o post do dia passa a publicar arte não julgada. Esse é o
// defeito que a fatia inteira existe para impedir.

/**
 * Conta os argumentos de uma chamada, lendo parênteses balanceados a partir do
 * `(` de abertura. Não é regex de propósito: `buscarArte(f(a, b))` tem UM
 * argumento, e uma regex que contasse vírgulas diria dois. Ignora vírgula
 * dentro de (), [], {} e dentro de string.
 */
function contarArgumentos(texto: string, posAbre: number): number {
  let profundidade = 0;
  let args = 1;
  let aspa: string | null = null;
  for (let i = posAbre; i < texto.length; i++) {
    const c = texto[i];
    if (aspa) {
      if (c === "\\") i++;
      else if (c === aspa) aspa = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { aspa = c; continue; }
    if (c === "(" || c === "[" || c === "{") profundidade++;
    else if (c === ")" || c === "]" || c === "}") {
      profundidade--;
      if (profundidade === 0) return args;
    } else if (c === "," && profundidade === 1) args++;
  }
  throw new Error("parênteses não fecharam — chamada malformada?");
}

/** Todo .ts/.tsx sob `dir`, recursivo. */
function varrer(dir: string, achados: string[] = []): string[] {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (item.name === "node_modules" || item.name.startsWith(".")) continue;
    const caminho = join(dir, item.name);
    if (item.isDirectory()) varrer(caminho, achados);
    else if (/\.tsx?$/.test(item.name)) achados.push(caminho);
  }
  return achados;
}

test("publicação: nenhum chamador fora do painel de curadoria passa `preview`", () => {
  // `__dirname` e não `process.cwd()`: a suíte roda os testes por caminho
  // absoluto, e o cwd depende de onde `npm test` foi disparado.
  const plataforma = join(__dirname, "..");

  // A ÚNICA porta que pode passar preview é o painel de curadoria em sessão
  // admin. Enquanto ele não existe, esta lista está vazia de propósito — e a
  // recomendação registrada é que ele use uma ROTA ADMIN PRÓPRIA, e não um
  // `?preview=1` na rota pública do card: um parâmetro de query transformaria
  // a trava numa checagem de sessão dentro de uma rota que hoje é pública, que
  // é exatamente o tipo de mistura que produz vazamento.
  const PERMITIDOS = [
    join("app", "api", "admin", "farol", "arte-preview"),
  ];

  const arquivos = [
    ...varrer(join(plataforma, "app")),
    ...varrer(join(plataforma, "lib")),
  ].filter((f) => !f.endsWith("farol-arte.ts") && !f.endsWith("farol-arte.test.ts"));

  const chamadores: string[] = [];
  for (const arquivo of arquivos) {
    const texto = readFileSync(arquivo, "utf8");
    const re = /\bbuscarArte\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto))) {
      const abre = m.index + m[0].length - 1;
      const n = contarArgumentos(texto, abre);
      const relativo = arquivo.slice(plataforma.length + 1);
      chamadores.push(`${relativo}:${n}`);
      if (n > 1 && !PERMITIDOS.some((p) => relativo.startsWith(p))) {
        assert.fail(
          `${relativo} chama buscarArte com ${n} argumentos. Só o painel de ` +
            `curadoria (${PERMITIDOS.join(", ")}) pode passar { preview }. ` +
            `Ver a trava do preview em lib/farol-arte.test.ts.`
        );
      }
    }
  }

  // Contra-prova do próprio teste: se um dia a varredura parar de achar o
  // chamador real, ela passaria a aprovar por vacuidade — verde sem cobertura,
  // que é a mesma lição do portão de "zero arquivo encontrado" da suíte.
  assert.ok(
    chamadores.some((c) => c.startsWith(join("app", "api", "card-image"))),
    `a varredura não achou a rota do card entre os chamadores (achou: ${
      chamadores.join(", ") || "nenhum"
    }) — o teste estaria passando por vacuidade`
  );
});

test("preview não quebra o contrato do fallback", () => {
  // O que se prende aqui é modesto e verdadeiro: `preview` é opcional, e
  // esquecê-lo cai no lado SEGURO. Não dá para provar por runtime que o filtro
  // de status foi aplicado sem subir um banco — quem prova isso é a trava de
  // sítio de chamada acima, mais a leitura de `carregar`.
  // Sequencial, e não Promise.all: `comEnv` mexe em `process.env`, que é global
  // do processo — rodar em paralelo faria um restaurar a env debaixo do outro.
  return (async () => {
    for (const op of [undefined, { preview: false }, { preview: true }]) {
      await comEnv("http://192.0.2.1:1", "x", async () => {
        await assert.doesNotReject(async () => {
          assert.equal(await buscarArte(UUID_INVENTADO, op), null);
        }, `lançou com opções ${JSON.stringify(op)}`);
      });
    }
  })();
});
