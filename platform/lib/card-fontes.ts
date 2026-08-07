// ============================================================================
// VISUAL-KIT-APLICADO-01 — fontes da marca para o gerador de card (satori)
// AUTORIZADO: Emerson Gomes dos Santos — OS "VISUAL-KIT-APLICADO-01",
// 06/08/2026 ~23h30: "Space Grotesk (títulos) e IBM Plex Mono (números)
// carregadas como ArrayBuffer no runtime a partir dos espelhos raw do
// google/fonts (URLs que o kit anterior já validou), com cache em módulo;
// fallback: stack padrão + registrar."
// ----------------------------------------------------------------------------
// DESVIO DECLARADO (1) — "URLs que o kit anterior já validou" NÃO EXISTEM.
// Medi em 06/08/2026, no repo inteiro:
//   grep -rn "Space Grotesk\|IBM Plex\|gstatic\|google/fonts\|next/font\|@font-face"
// devolve APENAS nomes de font-family em CSS (app/interno/simulador-porto e
// simulador-disal). Nenhuma URL, nenhum loader, nenhum .ttf versionado. O kit
// anterior parou no documento; não deixou nada validado em código. Descobri e
// validei as URLs eu mesmo, com GET real (HEAD não serve: devolve corpo vazio
// e mascara 404) e conferência de magic bytes.
//
// DESVIO DECLARADO (2) — O ESPELHO DO GOOGLE/FONTS NÃO SERVE PARA ESTE
// RENDERIZADOR, e isto não é preferência: é medição.
//
//   a) `ofl/spacegrotesk` contém UM ÚNICO arquivo de fonte. Listagem real pela
//      API do GitHub em 06/08/2026: DESCRIPTION, METADATA.pb, OFL.txt,
//      SpaceGrotesk[wght].ttf, config.yaml, upstream_info.md. Não existe
//      subpasta `static/` (GET nela = 404). Ou seja: no google/fonts, Space
//      Grotesk SÓ EXISTE COMO FONTE VARIÁVEL.
//
//   b) O @vercel/og embutido no Next NÃO PARSEIA FONTE VARIÁVEL. Tentei, e o
//      servidor de produção não devolveu nem um 500 — devolveu conexão vazia
//      (`curl: (52) Empty reply from server`), porque o erro estoura durante o
//      pipe do stream:
//        TypeError: Cannot read properties of undefined (reading '256')
//          at parseFvarAxis  (@vercel/og/index.node.js:10935)
//          at parseFvarTable (…:10961)
//          at addFonts       (…:16251)
//      `fvar` é justamente a tabela de eixos variáveis. Registrar aquele .ttf
//      derruba o render. Não é "sai sem variar o peso": é crash.
//
// SOLUÇÃO MEDIDA: os pacotes `@fontsource/*` publicam INSTÂNCIAS ESTÁTICAS
// (uma por peso, sem tabela `fvar`) geradas a partir das mesmas fontes upstream
// e sob a mesma licença OFL. Validadas em 06/08/2026, versão fixada 5.3.0:
//
//   space-grotesk-latin-400-normal.woff .... 200 · 17.004 B · magic 774f4646
//   space-grotesk-latin-700-normal.woff .... 200 · 16.416 B · magic 774f4646
//   ibm-plex-mono-latin-400-normal.woff .... 200 · 13.144 B · magic 774f4646
//   ibm-plex-mono-latin-600-normal.woff .... 200 · 13.208 B · magic 774f4646
//
// Efeito colateral bem-vindo: 59 KB no total contra os ~412 KB dos .ttf do
// google/fonts — o cold start fica 7× mais barato no caminho crítico da Meta.
// E aqui Space Grotesk TEM peso 700 de verdade, coisa que a variável não daria.
//
// VERSÃO FIXADA (@5.3.0), não `@latest`: o render do satori é determinístico —
// conferi pedindo a mesma arte duas vezes e comparando sha256. Deixar a URL
// flutuar em `latest` jogaria fora essa propriedade, e um dia o card mudaria
// sozinho sem nenhum commit. Subir de versão passa a ser uma decisão, com diff.
//
// SUBSET `latin`: cobre o que a arte escreve — CRÉDITO, Administradora, ç/ã/õ,
// o separador `·` (U+00B7) e o travessão `—` (U+2014) do fallback de
// administradora vazia. Não há texto fora disso nesta rota.
//
// POR QUE O DEFAULT 1200×630 NÃO CHAMA ISTO: a OS exige o card do WhatsApp byte
// a byte intacto. Fonte muda pixel. Então quem chama `fontesDoKit()` é só o
// ramo feed/story; o default segue na stack padrão do renderizador, sem rede.
//
// CACHE COM RETRY: o cache guarda a PROMESSA (não o resultado), então dez
// requests concorrentes no mesmo lambda frio fazem UM download, não dez. Mas se
// o download falhar, o cache se apaga: uma indisponibilidade de 3s do CDN não
// pode condenar o container inteiro a renderizar sem a marca até o próximo
// deploy.
//
// FALLBACK É SILENCIOSO PRO CLIENTE E BARULHENTO PRO LOG: rede caiu, o card
// SAI — com a stack padrão — e o motivo fica em `[card-fontes]`. A alternativa
// (500) deixaria o feed do Instagram sem imagem por causa de uma fonte, o que
// é trocar um problema estético por um funcional.
// ============================================================================

const CDN = "https://cdn.jsdelivr.net/npm/@fontsource";

/** Fixada de propósito — ver header. */
const VERSAO = "5.3.0";

/** Timeout por arquivo. Este download está no caminho crítico da Meta. */
const TIMEOUT_FONTE_MS = 6_000;

export const FAMILIA_TITULO = "Space Grotesk";
export const FAMILIA_NUMERO = "IBM Plex Mono";

/** Stack final de cada família — o `sans-serif`/`monospace` é o fallback. */
export const FONT_TITULO = `${FAMILIA_TITULO}, sans-serif`;
export const FONT_NUMERO = `${FAMILIA_NUMERO}, monospace`;

/** Formato que o `ImageResponse` espera em `options.fonts`. */
export type FonteSatori = {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 700;
  style: "normal";
};

type Alvo = { url: string; name: string; weight: 400 | 700 };

// `weight` aqui é o que o SATORI vai casar com o `fontWeight` do CSS, não o
// nome do arquivo: o SemiBold 600 do Plex entra como 700 porque é o peso forte
// que o layout pede, e o Plex não tem 700 no subset que estamos usando.
const ALVOS: Alvo[] = [
  {
    url: `${CDN}/space-grotesk@${VERSAO}/files/space-grotesk-latin-400-normal.woff`,
    name: FAMILIA_TITULO,
    weight: 400,
  },
  {
    url: `${CDN}/space-grotesk@${VERSAO}/files/space-grotesk-latin-700-normal.woff`,
    name: FAMILIA_TITULO,
    weight: 700,
  },
  {
    url: `${CDN}/ibm-plex-mono@${VERSAO}/files/ibm-plex-mono-latin-400-normal.woff`,
    name: FAMILIA_NUMERO,
    weight: 400,
  },
  {
    url: `${CDN}/ibm-plex-mono@${VERSAO}/files/ibm-plex-mono-latin-600-normal.woff`,
    name: FAMILIA_NUMERO,
    weight: 700,
  },
];

/**
 * Baixa uma fonte e confere que é MESMO uma fonte legível por este satori.
 * A conferência não é paranoia, é cicatriz: um 404 de CDN vem como texto curto
 * e, sem checagem, esse texto chegaria ao satori como "fonte" e derrubaria o
 * render com um erro de parse ilegível.
 * ACEITOS: wOFF (WOFF 1.0), 00010000 (TrueType), OTTO (CFF/OpenType).
 * RECUSADO de propósito: wOF2 — o satori não descomprime WOFF2, e um WOFF2
 * aceito aqui viraria o mesmo crash silencioso que a fonte variável causou.
 */
async function baixar(url: string): Promise<ArrayBuffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_FONTE_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      console.warn("[card-fontes] http", resp.status, url);
      return null;
    }
    const buf = await resp.arrayBuffer();
    if (buf.byteLength < 1024) {
      console.warn("[card-fontes] arquivo pequeno demais:", buf.byteLength, url);
      return null;
    }
    const m = new Uint8Array(buf.slice(0, 4));
    const woff = m[0] === 0x77 && m[1] === 0x4f && m[2] === 0x46 && m[3] === 0x46; // "wOFF"
    const ttf = m[0] === 0x00 && m[1] === 0x01 && m[2] === 0x00 && m[3] === 0x00;
    const otf = m[0] === 0x4f && m[1] === 0x54 && m[2] === 0x54 && m[3] === 0x4f; // "OTTO"
    if (!woff && !ttf && !otf) {
      console.warn("[card-fontes] magic inesperado:", Array.from(m), url);
      return null;
    }
    return buf;
  } catch (e) {
    console.warn(
      "[card-fontes] falhou:",
      url,
      e instanceof Error ? e.message : "erro_desconhecido"
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function carregar(): Promise<FonteSatori[] | null> {
  const inicio = Date.now();
  const baixados = await Promise.all(ALVOS.map((a) => baixar(a.url)));

  // Tudo ou nada. Meia tipografia (números na marca, títulos no fallback) fica
  // pior do que a stack padrão inteira, que ao menos é coerente consigo mesma.
  if (baixados.some((b) => b === null)) {
    console.warn("[card-fontes] carga incompleta — usando stack padrão");
    return null;
  }

  const fontes: FonteSatori[] = ALVOS.map((a, i) => ({
    name: a.name,
    data: baixados[i] as ArrayBuffer,
    weight: a.weight,
    style: "normal" as const,
  }));

  console.log("[card-fontes] carregadas:", {
    arquivos: fontes.length,
    bytes: fontes.reduce((s, f) => s + f.data.byteLength, 0),
    ms: Date.now() - inicio,
  });
  return fontes;
}

let cache: Promise<FonteSatori[] | null> | null = null;

/**
 * Fontes do kit, com cache de módulo. Devolve `null` quando a carga falha —
 * quem chama passa `fonts: undefined` e o satori usa a stack padrão.
 * Em falha o cache se apaga, para a próxima request tentar de novo (ver header).
 */
export function fontesDoKit(): Promise<FonteSatori[] | null> {
  if (!cache) {
    cache = carregar()
      .then((f) => {
        if (!f) cache = null;
        return f;
      })
      .catch((e) => {
        console.warn(
          "[card-fontes] erro inesperado:",
          e instanceof Error ? e.message : "erro_desconhecido"
        );
        cache = null;
        return null;
      });
  }
  return cache;
}

/** Zera o cache. Existe para o ramo de recuperação da rota — ver uso. */
export function esquecerFontes(): void {
  cache = null;
}
