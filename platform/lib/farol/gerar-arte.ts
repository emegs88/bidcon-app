// ============================================================================
// lib/farol/gerar-arte.ts — gerar arte do acervo, subir ao bucket, inserir
// PENDENTE. Toda a lógica mora aqui; a rota é casco.
// AUTORIZADO: Emerson Gomes dos Santos — 10/08/2026, respondendo à pergunta
// "qual modelo, qual chave" do relatório da noite:
//   "(gpt-image-2, OPENAI_API_KEY, rota /api/farol/arte/gerar"
// ----------------------------------------------------------------------------
// POR QUE ESTE ARQUIVO EXISTE EM lib/ E NÃO NA ROTA. Duas razões, e as duas já
// custaram caro nesta casa:
//   1. Route handler do Next só admite um conjunto FECHADO de exports. Uma
//      constante exportada de dentro da rota reprova o `next build` com "X is
//      not a valid Route export field" — e o `tsc --noEmit` passa limpo, então
//      o erro só aparece no portão de 2 minutos. Está escrito em
//      docs/ponto-cego-do-build.md.
//   2. `scripts/testes.mjs` varre SÓ `DIRS = ["lib"]`. Lógica que mora em
//      `app/` não tem teste — e uma função que GASTA DINHEIRO é a última que
//      deveria viver sem teste.
//
// ----------------------------------------------------------------------------
// AS TRÊS TRAVAS QUE ESTE MÓDULO CARREGA, E POR QUÊ
// ----------------------------------------------------------------------------
// Este é o primeiro código da casa que gasta dinheiro por conta própria. As
// travas não são zelo — são a diferença entre um bug de digitação custar
// centavos e custar uma fatura.
//
//   · KILL SWITCH `FAROL_ARTE_GERAR` — nasce DESARMADO. Sem `=on` a função
//     recusa antes de tocar a rede. Um deploy não pode começar a gastar por
//     estar no ar.
//   · TETO_POR_CHAMADA — quantas imagens uma única chamada pode gerar, no
//     máximo. Existe porque o corpo do POST é dado de fora: um array com 50
//     categorias, por engano ou não, seriam 50 chamadas pagas. O teto não
//     confia no chamador.
//   · status 'pendente', SEMPRE — a 0076 diz no comentário da tabela que
//     'aprovada' é escrito só pelo painel, com confirmação nominal, e que nada
//     no código automatiza a transição. Este módulo é "nada no código".
//
// ----------------------------------------------------------------------------
// O TAMANHO — DESVIO DECLARADO em relação ao 1152×2048 dos documentos
// ----------------------------------------------------------------------------
// O card foi desenhado citando 1152×2048, e a própria 0076 registra a anomalia
// de preço dizendo que "a tabela publicada cobre três presets (1024×1024,
// 1024×1536, 1536×1024) e NÃO cobre tamanho livre — qualquer número que se
// calcule para 1152×2048 é extrapolação".
//
// Gero em 1024×1536, que é preset. Duas consequências, ambas boas:
//   · o preço passa a ser PUBLICADO em vez de extrapolado — some a anomalia que
//     a migração registrou como dívida;
//   · `recorteCentral` já cobre os dois formatos com esta proporção. A conta,
//     que é a mesma que o teste de farol-arte repete:
//       story 1080×1920 → escala max(1080/1024, 1920/1536) = 1,25
//                       → 1280×1920, corta 100px de cada lado. Sem tarja.
//       feed  1080×1080 → escala max(1080/1024, 1080/1536) = 1,0547
//                       → 1080×1620, corta 270px em cima e embaixo,
//                         preservando de 16,67% a 83,33% da altura.
//     A REGRA DE COMPOSIÇÃO manda o interesse ficar entre 22% e 78% da altura.
//     22–78 cabe dentro de 16,67–83,33 com folga dos dois lados: a lição a1
//     continua valendo em 1024×1536 sem reescrever prompt nenhum.
//
// E `largura`/`altura` não são copiadas da constante: são LIDAS DO ARQUIVO
// (`dimensoesPng`). A 0076 chama essas colunas de "dimensão REAL do arquivo" e
// é delas que sai o recorte — se a API devolver outra coisa um dia, o card se
// ajusta sozinho em vez de recortar por uma constante que mentiu.
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";

import { BUCKET_ARTES } from "@/lib/farol-arte";
import { CATEGORIAS, montarPrompt, type Categoria } from "@/lib/farol/prompts-arte";

/** Kill switch. Ausente, vazio, "true", "1" ou "ON" = DESARMADO. Só "on" arma. */
export const ENV_KILL_SWITCH = "FAROL_ARTE_GERAR";

export function gerarArteLigado(): boolean {
  return process.env[ENV_KILL_SWITCH] === "on";
}

/** O modelo, na grafia que Emerson autorizou. Vai para a coluna `modelo`. */
export const MODELO = "gpt-image-2";

/**
 * `medium`, e isto é herança de decisão, não escolha nova: o véu navy de 78%
 * apaga o detalhe fino que `high` compraria (ver VEU_NAVY em lib/farol-arte.ts,
 * com a condição de reabertura). Quem exibir arte SEM véu reabre esta linha.
 */
export const QUALIDADE = "medium";

/** Ver o bloco O TAMANHO no cabeçalho para a aritmética que sustenta o preset. */
export const TAMANHO = "1024x1536";

/**
 * Teto DURO de imagens por chamada. Não é configurável de fora de propósito —
 * um teto que o chamador pode aumentar não é teto.
 */
export const TETO_POR_CHAMADA = 3;

/**
 * Prazo da chamada de imagem. Generoso porque geração de imagem leva dezenas de
 * segundos — e curto o bastante para não passar do `maxDuration` da rota.
 */
export const PRAZO_MS = 120_000;

/** Teto de bytes do PNG que aceitamos subir. Espelha TETO_BYTES da leitura. */
export const TETO_BYTES = 8 * 1024 * 1024;

// ---------------------------------------------------------------------------
// dimensoesPng — ler a dimensão dos BYTES, não do que se pediu
// ---------------------------------------------------------------------------

/**
 * Extrai largura/altura do cabeçalho IHDR de um PNG, ou `null` se os bytes não
 * forem um PNG.
 *
 * O layout é fixo e não precisa de biblioteca: 8 bytes de assinatura, 4 de
 * tamanho do chunk, 4 do rótulo "IHDR", e então largura e altura em 4 bytes
 * big-endian cada. Daí o mínimo de 24 bytes.
 *
 * Confere a assinatura por conta própria (não delega) para que a função seja um
 * teste completo de "isto é um PNG" — quem chama recebe `null` tanto para lixo
 * quanto para um JPEG, e nos dois casos a decisão é a mesma: não subir.
 */
export function dimensoesPng(
  b: Uint8Array
): { largura: number; altura: number } | null {
  if (b.length < 24) return null;

  const ASSINATURA = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < ASSINATURA.length; i++) {
    if (b[i] !== ASSINATURA[i]) return null;
  }
  // O primeiro chunk de um PNG válido é obrigatoriamente o IHDR.
  if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) {
    return null;
  }

  const u32 = (o: number) =>
    ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

  const largura = u32(16);
  const altura = u32(20);
  // Zero é dimensão inválida por especificação, e é exatamente o que um arquivo
  // truncado ou zerado produziria aqui.
  if (largura <= 0 || altura <= 0) return null;
  return { largura, altura };
}

// ---------------------------------------------------------------------------
// O caminho dentro do bucket
// ---------------------------------------------------------------------------

/**
 * `AAAA/MM/<uuid>.png`, na forma que a 0076 dá de exemplo.
 *
 * O uuid é sorteado, não derivado da categoria: `caminho` é UNIQUE na tabela, e
 * um nome derivado faria a segunda arte da mesma categoria colidir com a
 * primeira — apagando no bucket (upsert) ou estourando no insert. Acervo é
 * feito de várias tentativas da MESMA categoria; colisão por nome seria o
 * defeito garantido.
 */
export function caminhoDaArte(agora: Date, id: string): string {
  const ano = agora.getUTCFullYear();
  const mes = String(agora.getUTCMonth() + 1).padStart(2, "0");
  return `${ano}/${mes}/${id}.png`;
}

// ---------------------------------------------------------------------------
// A chamada à OpenAI
// ---------------------------------------------------------------------------

/**
 * Não reusa o `postOpenAI` de lib/ia.ts de propósito: aquele é module-private e
 * tem prazo de 12s, dimensionado para embedding e chat. Geração de imagem leva
 * dezenas de segundos — reusá-lo significaria afrouxar o prazo de TODA chamada
 * de texto da casa para acomodar uma de imagem. Duas necessidades diferentes,
 * dois relógios.
 *
 * A chave é lida aqui dentro, nunca no import: ler no topo do módulo explode o
 * build/SSG de quem só importa um tipo daqui. Mesma doutrina de lib/ia.ts.
 */
export type RespostaImagem = {
  b64: string;
  uso: unknown;
};

export async function pedirImagem(prompt: string): Promise<RespostaImagem> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Falta OPENAI_API_KEY (env de servidor).");

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PRAZO_MS);
  try {
    const resp = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MODELO,
        prompt,
        size: TAMANHO,
        quality: QUALIDADE,
        n: 1,
      }),
      signal: ctrl.signal,
    });

    if (!resp.ok) {
      // Corpo do erro NÃO entra na mensagem: pode trazer detalhe da conta. Só o
      // status, que é o que diagnostica.
      throw new Error(`OpenAI /images/generations respondeu ${resp.status}`);
    }

    const json = (await resp.json()) as {
      data?: { b64_json?: string }[];
      usage?: unknown;
    };
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI não devolveu b64_json.");

    // `usage` vai CRU para o banco. A 0076 é explícita: guardar o objeto como a
    // API o devolveu é o que permite trocar extrapolação por medição depois.
    return { b64, uso: json?.usage ?? null };
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// gerarArte — uma categoria, uma imagem, uma linha pendente
// ---------------------------------------------------------------------------

export type ArteGerada = {
  id: string;
  categoria: Categoria;
  caminho: string;
  largura: number;
  altura: number;
  bytes: number;
};

export type ResultadoGeracao =
  | { ok: true; arte: ArteGerada }
  | { ok: false; categoria: Categoria; erro: string };

/**
 * Gera UMA arte e devolve o resultado sem lançar.
 *
 * Não lança porque o chamador natural é um laço sobre várias categorias: uma
 * falha na segunda não pode descartar a primeira, que já foi PAGA e já está no
 * bucket. Erro vira `{ ok: false }` e o laço segue.
 *
 * A ordem — subir o arquivo ANTES de inserir a linha — é deliberada. Se o
 * insert falhar depois de subir, sobra um arquivo órfão no bucket: lixo barato,
 * invisível, sem consequência. Na ordem inversa sobraria uma LINHA apontando
 * para arquivo que não existe — e essa linha entra na fila da curadoria, é
 * aprovada por alguém que vê um quadrado quebrado, e vira post sem fundo.
 * Órfão de arquivo é lixo; órfão de linha é defeito.
 */
export async function gerarArte(
  db: SupabaseClient,
  categoria: Categoria
): Promise<ResultadoGeracao> {
  if (!gerarArteLigado()) {
    return { ok: false, categoria, erro: "desarmado" };
  }
  if (!(CATEGORIAS as readonly string[]).includes(categoria)) {
    return { ok: false, categoria, erro: "categoria_invalida" };
  }

  // A ÚNICA porta do prompt. Nunca montar texto à mão aqui: `montarPrompt` é o
  // que garante que as proibições entram, e entram por último.
  const prompt = montarPrompt(categoria);

  let resposta: RespostaImagem;
  try {
    resposta = await pedirImagem(prompt);
  } catch (e) {
    return {
      ok: false,
      categoria,
      erro: `openai:${e instanceof Error ? e.message : "desconhecida"}`,
    };
  }

  const bytes = Buffer.from(resposta.b64, "base64");
  if (bytes.byteLength === 0) return { ok: false, categoria, erro: "png_vazio" };
  if (bytes.byteLength > TETO_BYTES) {
    return { ok: false, categoria, erro: `png_grande:${bytes.byteLength}` };
  }

  // Dimensão do ARQUIVO. Se não for PNG, não sobe — e não é só higiene: um byte
  // que não é PNG viraria linha no acervo com dimensão inventada, e o recorte
  // central sai da dimensão.
  const dim = dimensoesPng(new Uint8Array(bytes));
  if (!dim) return { ok: false, categoria, erro: "nao_e_png" };

  const id = crypto.randomUUID();
  const caminho = caminhoDaArte(new Date(), id);

  const up = await db.storage.from(BUCKET_ARTES).upload(caminho, bytes, {
    contentType: "image/png",
    // `upsert: false` de propósito: com uuid sorteado uma colisão significaria
    // que algo está muito errado, e sobrescrever esconderia isso.
    upsert: false,
  });
  if (up.error) {
    return { ok: false, categoria, erro: `upload:${up.error.message}` };
  }

  // Coluna a coluna, como manda a casa para service-role.
  // `status` NÃO é escrito aqui: o default da tabela é 'pendente' e deixá-lo
  // vir do banco significa que nem um erro de digitação neste objeto poderia
  // fazer nascer uma arte aprovada.
  // `custo_usd` fica NULO — a API devolve tokens, não dólares, e a 0076 diz que
  // nulo quer dizer "não medido", nunca "de graça".
  const { error } = await db.from("farol_arte").insert({
    id,
    caminho,
    largura: dim.largura,
    altura: dim.altura,
    categoria,
    prompt,
    modelo: MODELO,
    qualidade: QUALIDADE,
    uso: resposta.uso,
  });

  if (error) {
    // Insert falhou depois do upload: o arquivo fica órfão. Logado com o
    // caminho para que a limpeza seja possível — ver a nota de ordem acima.
    console.error("[gerar-arte] insert falhou, arquivo órfão no bucket:", {
      caminho,
      erro: error.message,
    });
    return { ok: false, categoria, erro: `insert:${error.message}` };
  }

  return {
    ok: true,
    arte: {
      id,
      categoria,
      caminho,
      largura: dim.largura,
      altura: dim.altura,
      bytes: bytes.byteLength,
    },
  };
}

// ---------------------------------------------------------------------------
// gerarLote — o teto aplicado
// ---------------------------------------------------------------------------

/**
 * Corta a lista pedida no teto e devolve o que será gerado.
 *
 * Separada de `gerarLote` para ser testável SEM rede e sem custo: o teto é a
 * trava que protege a fatura, e uma trava que só se exercita gastando dinheiro
 * não se exercita nunca.
 */
export function aplicarTeto(pedidas: readonly Categoria[]): Categoria[] {
  return pedidas.slice(0, TETO_POR_CHAMADA);
}

/**
 * Gera várias, em SÉRIE. Não em paralelo de propósito: paralelo dispara todas
 * as chamadas pagas antes de saber se a primeira sequer funciona. Em série, um
 * erro de prompt ou de chave custa UMA imagem em vez de três.
 */
export async function gerarLote(
  db: SupabaseClient,
  pedidas: readonly Categoria[]
): Promise<ResultadoGeracao[]> {
  const out: ResultadoGeracao[] = [];
  for (const c of aplicarTeto(pedidas)) {
    out.push(await gerarArte(db, c));
  }
  return out;
}
