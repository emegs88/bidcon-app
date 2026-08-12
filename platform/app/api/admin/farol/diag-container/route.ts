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
import { lerContainerGraph } from "@/lib/instagram/ler-container";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/**
 * 300s. O caminho caro é baixar ~13,8 MB do Storage e subir de volta, mais duas
 * chamadas à Graph que baixam o vídeo DENTRO da chamada. Precedente na casa:
 * arte/gerar e pauta usam o mesmo teto.
 */
export const maxDuration = 300;

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

// ---------------------------------------------------------------------------
// O LEITOR NÃO MORA MAIS AQUI — DIAG-CONTAINER-02
// ---------------------------------------------------------------------------
// Havia aqui um `lerContainer` próprio, com um comentário que dizia "vive aqui,
// e não na lib, pelo mesmo motivo que `statusContainer` vive na rota do reel:
// I/O não desce para a camada pura". A frase era verdadeira sobre `lib/farol/`
// e cega sobre `lib/instagram/`, que JÁ É a camada de I/O da Graph nesta casa.
//
// O preço dessa cegueira foi medido em 11/08/2026: os dois leitores pediam a
// MESMA string de campos, e mesmo assim um funcionou e o outro mentiu — porque
// só o do reel-publicar descia um degrau na escada quando a Graph recusava o
// conjunto com `code=100`. Este devolvia `status_code: null` e a árvore chamava
// isso de "travado".
//
// Agora há UM leitor: `lerContainerGraph`, em lib/instagram/ler-container.ts.
// Ele já vem com a escada, com o erro literal e com `campos_usados`, que é como
// se distingue "a Meta não devolveu copyright" de "não perguntamos por ele".
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

  const [a, b] = await Promise.all([
    lerContainerGraph(idA),
    lerContainerGraph(idB),
  ]);

  // Idade a partir do `desde` que o POST devolveu. Ausente ou ilegível ⟹ NaN, e
  // NaN nunca vira "travado": sem relógio, a leitura é sempre "aguardando".
  // Deixar o relógio de fora é o que impede a rota de declarar derrota com base
  // em nada.
  const desde = q.get("desde");
  const t0 = desde ? new Date(desde).getTime() : Number.NaN;
  const idadeMs = Number.isFinite(t0) ? Date.now() - t0 : Number.NaN;

  // O ERRO ENTRA NA ÁRVORE. Era isto que faltava em 11/08: a rota tinha o erro
  // na mão (`code=100 ...`) e passava só o `status_code: null` adiante, de modo
  // que "não consegui perguntar" chegava em `lerAB` com a mesma cara de "a Meta
  // não respondeu nada". Agora os dois literais viajam juntos.
  const leitura = lerAB({
    idA,
    idB,
    codeA: a.resumo?.status_code ?? null,
    codeB: b.resumo?.status_code ?? null,
    erroA: a.erro,
    erroB: b.erro,
    idadeMs,
  });

  console.log("[diag-container] conferido", {
    quem: acesso.email,
    idade_min: Number.isFinite(idadeMs) ? Math.floor(idadeMs / 60_000) : null,
    code_a: a.resumo?.status_code ?? null,
    code_b: b.resumo?.status_code ?? null,
    erro_a: a.erro,
    erro_b: b.erro,
    degraus_a: a.degraus,
    degraus_b: b.degraus,
    veredito: leitura.veredito,
  });

  return NextResponse.json({
    ok: true,
    idade_min: Number.isFinite(idadeMs) ? Math.floor(idadeMs / 60_000) : null,
    a: ladoJson(`A — cópia do 07/08 (${BITRATE_A_KBPS} kbps, PUBLICOU)`, idA, a),
    b: ladoJson(`B — 11/08 (${BITRATE_B_KBPS} kbps, travou)`, idB, b),
    leitura,
  });
}

/**
 * Um lado, do jeito que o painel lê.
 *
 * `campos_usados` e `degraus` SAEM NA RESPOSTA de propósito. Sem eles, um
 * `copyright_check_status: null` é ambíguo entre "a Meta não devolveu" e "a
 * escada desceu e nem chegamos a pedir o campo" — e essa ambiguidade é a mesma
 * família do defeito que esta fatia conserta. Com eles, o operador confere na
 * tela qual pergunta foi de fato feita.
 */
function ladoJson(
  rotulo: string,
  containerId: string,
  l: Awaited<ReturnType<typeof lerContainerGraph>>
) {
  return {
    rotulo,
    container_id: containerId,
    // `null` é informação: quer dizer "a Meta não devolveu o campo", que é
    // diferente de "devolveu vazio". Quem imprime decide como mostrar.
    status_code: l.resumo?.status_code ?? null,
    copyright_check_status: l.resumo?.copyright_check_status ?? null,
    /** A reclamação por extenso, quando a Graph manda uma. */
    status: l.resumo?.status ?? null,
    campos_usados: l.campos_usados,
    degraus: l.degraus,
    erro: l.erro,
  };
}
