// ============================================================================
// DIAG-CONTAINER-01 — o A/B de containers, no servidor, atrás da sessão admin
// AUTORIZADO: Emerson Gomes dos Santos — 11/08/2026:
//   "o A/B vai para o servidor (IG_ACCESS_TOKEN e IG_USER_ID são Sensitive sem
//    Reveal; ninguém cola segredo em arquivo). Rota POST
//    /api/admin/farol/diag-container, mesmo guard do inventário de vozes."
// ----------------------------------------------------------------------------
// ESTA ROTA É CASCO. Route handlers só admitem um conjunto FECHADO de exports
// (ver docs/ponto-cego-do-build.md) e `scripts/testes.mjs` varre apenas `lib/`.
// Logo, tudo que é decisão — a árvore de leitura, o limiar de "travado", o
// detector de dedupe, o caminho da cópia — mora em `lib/farol/diag-container.ts`
// e está sob teste. Aqui só há I/O: baixar, subir, chamar a Graph, imprimir.
//
// ----------------------------------------------------------------------------
// O QUE ESTA ROTA NÃO FAZ, E É O PONTO
// ----------------------------------------------------------------------------
// NÃO PUBLICA. Aqui só existe a CRIAÇÃO de container; o endpoint que publica
// não é chamado nem NOMEADO neste arquivo. O teste em
// lib/farol/diag-container.test.ts lê ESTE FONTE — comentário incluído — e
// falha se o nome aparecer. Um comentário promete; um teste garante. A omissão
// do nome na prosa é o preço de varrer o fonte cru em vez de confiar num parser
// que se engana, e é um preço barato.
//
// NÃO LIMPA NADA depois. Container órfão expira sozinho em 24h (é a regra da
// Meta, não uma esperança nossa), e o objeto de diagnóstico fica sob `diag/` no
// bucket. Medido antes de escrever: nada no produto faz `.list()` no
// `farol-videos` — só `createBucket`, `upload` e `getPublicUrl` por caminho
// explícito. O artefato é inerte: não entra em fila, não vira reel, não aparece
// em tela.
//
// NÃO GRAVA NO BANCO. Os dois `container_id` voltam no corpo do POST e o painel
// os devolve no GET `?conferir`. É uma escolha, e ela tem um custo que eu
// declaro: recarregar a página perde os ids. O que se ganha é não criar tabela,
// não pedir migração e não deixar sujeira de diagnóstico no schema por causa de
// uma medição que roda três vezes na vida. Quem quiser reler depois copia os
// ids da resposta — eles estão na tela, à vista.
//
// ----------------------------------------------------------------------------
// A GUARDA É UMA SÓ, E ISSO É DELIBERADO
// ----------------------------------------------------------------------------
// Os botões de /admin/farol exigem confirmação nominal porque disparam ações
// irreversíveis. Este POST cria dois containers que expiram sozinhos em 24h e
// sobe um arquivo inerte: não publica, não gasta crédito, não altera nenhuma
// linha. Exigir a palavra aqui treinaria o operador a digitá-la por reflexo —
// que é como se enfraquece a trava justamente onde ela importa. A guarda é
// `checarAdminConsoleApi()`, e é ela sozinha. O desvio está declarado ao
// Emerson, não só neste comentário.
// ============================================================================
import { NextResponse } from "next/server";
import { checarAdminConsoleApi } from "@/lib/admin-console";
import { createXtvClient } from "@/lib/supabase-xtv";
import { chamarGraph } from "@/lib/instagram/publicar";
import {
  BITRATE_A_KBPS,
  BITRATE_B_KBPS,
  BUCKET_DIAG,
  BYTES_A,
  BYTES_B,
  bytesConferem,
  caminhoCopiaA,
  carimbo,
  corpoContainerDiag,
  HEYGEN_SEM_BITRATE,
  lerAB,
  NOTA_RESUMABLE,
  VIDEO_A_ORIGEM,
  VIDEO_B,
} from "@/lib/farol/diag-container";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/**
 * 300s. O caminho caro é baixar ~13,8 MB do Storage e subir de volta, mais duas
 * chamadas à Graph que baixam o vídeo DENTRO da chamada. Precedente na casa:
 * arte/gerar e pauta usam o mesmo teto.
 */
export const maxDuration = 300;

const IG_GRAPH_VERSION = "v25.0";
const TIMEOUT_IG_MS = 20_000;

/** Os campos que interessam. Os mesmos de lib/farol/container.ts, por acordo. */
const CAMPOS = "id,status,status_code,copyright_check_status";

/**
 * Nomes de env conferidos por NOME, nunca por valor. Faltando, a resposta diz
 * QUAL falta — 503 com o nome, não 500 mudo.
 */
function envFaltando(): string[] {
  return [
    "BIDCON_XTV_URL",
    "BIDCON_XTV_SERVICE_ROLE_KEY",
    "IG_ACCESS_TOKEN",
    "IG_USER_ID",
  ].filter((n) => !process.env[n]);
}

/**
 * GET no container. Vive aqui, e não na lib, pelo mesmo motivo que
 * `statusContainer` vive na rota do reel: I/O não desce para a camada pura.
 * Nunca lança; o erro da Graph volta LITERAL (code/subcode/message) — é o
 * diagnóstico, e mastigá-lo seria jogar fora justamente o que se veio buscar.
 */
async function lerContainer(
  id: string
): Promise<{ ok: boolean; status_code: string | null; copyright: string | null; erro?: string }> {
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) return { ok: false, status_code: null, copyright: null, erro: "env_ausente(IG_ACCESS_TOKEN)" };

  const url =
    `https://graph.instagram.com/${IG_GRAPH_VERSION}/${id}` +
    `?fields=${encodeURIComponent(CAMPOS)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_IG_MS);
  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    const data: unknown = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = (data as { error?: { message?: string; code?: number; error_subcode?: number } })
        ?.error;
      const partes = [
        err?.code !== undefined ? `code=${err.code}` : null,
        err?.error_subcode !== undefined ? `subcode=${err.error_subcode}` : null,
        err?.message ?? `http_${resp.status}`,
      ].filter(Boolean);
      return { ok: false, status_code: null, copyright: null, erro: partes.join(" ").slice(0, 500) };
    }
    const o = (data ?? {}) as Record<string, unknown>;
    // `copyright_check_status` às vezes vem OBJETO. Serializar em vez de
    // descartar: o campo existe justamente para ser lido inteiro.
    const cc =
      o.copyright_check_status === null || o.copyright_check_status === undefined
        ? null
        : typeof o.copyright_check_status === "string"
          ? o.copyright_check_status
          : JSON.stringify(o.copyright_check_status).slice(0, 300);
    return {
      ok: true,
      status_code: o.status_code === undefined || o.status_code === null ? null : String(o.status_code),
      copyright: cc,
    };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, status_code: null, copyright: null, erro: `timeout_instagram_api(${TIMEOUT_IG_MS}ms)` };
    }
    return {
      ok: false,
      status_code: null,
      copyright: null,
      erro: e instanceof Error ? e.message.slice(0, 500) : "erro_desconhecido",
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// POST — preparo + dois containers
// ---------------------------------------------------------------------------

export async function POST() {
  const acesso = await checarAdminConsoleApi();
  if (!acesso.ok) {
    return NextResponse.json({ erro: acesso.motivo }, { status: acesso.status });
  }

  const faltam = envFaltando();
  if (faltam.length) {
    return NextResponse.json(
      {
        erro: `env ausente neste ambiente: ${faltam.join(", ")}.`,
        detalhe:
          "IG_ACCESS_TOKEN e IG_USER_ID são Sensitive sem Reveal no projeto " +
          "bidcon-plataforma na Vercel. Em preview elas precisam estar marcadas " +
          "para o ambiente de preview, senão o A/B só roda em produção.",
      },
      { status: 503 }
    );
  }

  const agora = Date.now();
  const marca = carimbo(agora);
  const destino = caminhoCopiaA(marca);

  // ---- 1. PREPARO: bytes de A para uma URL NOVA -----------------------------
  // Por que copiar em vez de reusar a URL original: o nosso próprio código
  // registra que a Meta devolvia o MESMO container para a mesma URL. Com a URL
  // antiga, um FINISHED rápido seria RECONHECIMENTO, não transcode.
  const db = createXtvClient();

  const baixado = await db.storage.from(BUCKET_DIAG).download(VIDEO_A_ORIGEM);
  if (baixado.error || !baixado.data) {
    return NextResponse.json(
      {
        erro: `não consegui baixar a origem de A (${VIDEO_A_ORIGEM}).`,
        detalhe: baixado.error?.message ?? "download vazio",
      },
      { status: 502 }
    );
  }
  const bytes = Buffer.from(await baixado.data.arrayBuffer());

  // AS MESMAS OPÇÕES DE `hospedarVideo` (reel-publicar/route.ts:339), e isso é
  // medição, não zelo: o caminho REST do Storage renderiza
  // `cache-control: public, 3600` (malformado) enquanto o SDK renderiza
  // `public, max-age=3600`. Um cabeçalho torto em A enviesaria o próprio A/B
  // que ele existe para rodar.
  const subiu = await db.storage.from(BUCKET_DIAG).upload(destino, bytes, {
    contentType: "video/mp4",
    upsert: true,
  });
  if (subiu.error) {
    return NextResponse.json(
      { erro: "não consegui subir a cópia de A.", detalhe: subiu.error.message },
      { status: 502 }
    );
  }

  const urlA = db.storage.from(BUCKET_DIAG).getPublicUrl(destino).data.publicUrl;
  const urlB = db.storage.from(BUCKET_DIAG).getPublicUrl(VIDEO_B).data.publicUrl;

  // ---- 2. DOIS CONTAINERS, e nada além disso -------------------------------
  const respA = await chamarGraph("media", corpoContainerDiag(urlA));
  const respB = await chamarGraph("media", corpoContainerDiag(urlB));

  // Log com FORMA, não conteúdo: nenhum token, nenhuma chave.
  console.log("[diag-container] criados", {
    quem: acesso.email,
    carimbo: marca,
    bytes_a: bytes.length,
    bytes_a_conferem: bytesConferem(bytes.length, BYTES_A),
    id_a: respA.id ?? null,
    id_b: respB.id ?? null,
    erro_a: respA.erro ?? null,
    erro_b: respB.erro ?? null,
  });

  return NextResponse.json({
    ok: true,
    carimbo: marca,
    criado_em: new Date(agora).toISOString(),
    a: {
      rotulo: `A — cópia do 07/08 (${BITRATE_A_KBPS} kbps, PUBLICOU)`,
      url: urlA,
      bytes: bytes.length,
      bytes_esperados: BYTES_A,
      bytes_conferem: bytesConferem(bytes.length, BYTES_A),
      container_id: respA.id ?? null,
      erro: respA.erro ?? null,
    },
    b: {
      rotulo: `B — 11/08 (${BITRATE_B_KBPS} kbps, travou)`,
      url: urlB,
      bytes_esperados: BYTES_B,
      container_id: respB.id ?? null,
      erro: respB.erro ?? null,
    },
    nota_resumable: NOTA_RESUMABLE,
    heygen: HEYGEN_SEM_BITRATE,
  });
}

// ---------------------------------------------------------------------------
// GET ?conferir — os literais dos dois, lado a lado
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  const acesso = await checarAdminConsoleApi();
  if (!acesso.ok) {
    return NextResponse.json({ erro: acesso.motivo }, { status: acesso.status });
  }

  const q = new URL(req.url).searchParams;
  if (!q.has("conferir")) {
    return NextResponse.json(
      {
        erro: "use ?conferir com os dois ids.",
        detalhe: "GET ?conferir&a=<container_id>&b=<container_id>&desde=<ISO>",
      },
      { status: 400 }
    );
  }

  const idA = q.get("a");
  const idB = q.get("b");
  if (!idA || !idB) {
    return NextResponse.json(
      { erro: "faltam os ids: ?conferir&a=<id>&b=<id>." },
      { status: 400 }
    );
  }

  const [a, b] = await Promise.all([lerContainer(idA), lerContainer(idB)]);

  // Idade a partir do `desde` que o POST devolveu. Ausente ou ilegível ⟹ NaN, e
  // NaN nunca vira "travado": sem relógio, a leitura é sempre "aguardando".
  // Deixar o relógio de fora é o que impede a rota de declarar derrota com base
  // em nada.
  const desde = q.get("desde");
  const t0 = desde ? new Date(desde).getTime() : Number.NaN;
  const idadeMs = Number.isFinite(t0) ? Date.now() - t0 : Number.NaN;

  const leitura = lerAB({
    idA,
    idB,
    codeA: a.status_code,
    codeB: b.status_code,
    idadeMs,
  });

  console.log("[diag-container] conferido", {
    quem: acesso.email,
    idade_min: Number.isFinite(idadeMs) ? Math.floor(idadeMs / 60_000) : null,
    code_a: a.status_code,
    code_b: b.status_code,
    veredito: leitura.veredito,
  });

  return NextResponse.json({
    ok: true,
    idade_min: Number.isFinite(idadeMs) ? Math.floor(idadeMs / 60_000) : null,
    a: {
      rotulo: `A — cópia do 07/08 (${BITRATE_A_KBPS} kbps, PUBLICOU)`,
      container_id: idA,
      // `null` é informação: quer dizer "a Meta não devolveu o campo", que é
      // diferente de "devolveu vazio". Quem imprime decide como mostrar.
      status_code: a.status_code,
      copyright_check_status: a.copyright,
      erro: a.erro ?? null,
    },
    b: {
      rotulo: `B — 11/08 (${BITRATE_B_KBPS} kbps, travou)`,
      container_id: idB,
      status_code: b.status_code,
      copyright_check_status: b.copyright,
      erro: b.erro ?? null,
    },
    leitura,
  });
}
